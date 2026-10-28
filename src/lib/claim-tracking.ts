/* v8 ignore next -- an import line has no logic; Vitest's rewrite of it reports a phantom branch */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAdminDb } from '@/lib/supabase/db';
import { getClientIp } from '@/lib/client-ip';
import type { PlayerClaimEvent } from '@/lib/claim-tracking-shared';

/**
 * Server side of prize claim tracking (migration 20261028120000_claim_tracking): the winner's handover
 * code, where a claim was sent from, and the timeline the winner sees. The parts the browser shares
 * are in claim-tracking-shared.ts.
 *
 * The handover code is 6 digits the winner gives whoever hands over the prize. It is derived here from
 * the claim, its "handoverVersion" and a server secret, so the database never holds it: someone who can
 * read the tables still can't mark a prize delivered. A new version (an admin's reset, or the claim
 * sent again for delivery) makes a new code.
 */

/** Wrong codes allowed before the code locks (decide_claim refuses the code from then on) */
export const HANDOVER_MAX_FAILURES = 5;

function handoverKey(): Buffer | null {
  const secret = process.env.CLAIM_HANDOVER_SECRET?.trim();
  if (secret) return Buffer.from(secret);
  // Without its own secret, one derived from the service key: always set on the server, and the key
  // itself never goes into a code
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return serviceKey ? createHmac('sha256', serviceKey).update('1think2win claim handover code v1').digest() : null;
}

/** The winner's handover code for this version of the claim, or null when the server has no secret to make it. */
export function handoverCode(claimId: string, version: number): string | null {
  const key = handoverKey();
  if (!key) return null;
  const mac = createHmac('sha256', key).update(`${claimId}:${version}`).digest();
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/** Whether `input` (spaces allowed) is the claim's current code. */
export function checkHandoverCode(claimId: string, version: number, input: string): boolean {
  const expected = handoverCode(claimId, version);
  const given = input.replace(/\s/g, '');
  if (!expected || !/^\d{6}$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/**
 * Records the IP and browser a claim was sent from, which the risk flags compare across accounts.
 * Best effort: the claim is already saved, so a failure is only logged.
 */
export async function recordClaimOrigin(
  claimId: string,
  userId: string,
  headers: { get(name: string): string | null },
): Promise<void> {
  try {
    const { error } = await getAdminDb().rpc('record_claim_origin', {
      p_claim_id: claimId,
      p_user_id: userId,
      p_ip: getClientIp(headers),
      p_user_agent: headers.get('user-agent') ?? '',
    });
    if (error) throw error;
  } catch (err) {
    console.error('[claims] Could not record where a claim came from:', err);
  }
}

const PLAYER_EVENTS = new Set<PlayerClaimEvent['event']>([
  'submitted', 'approved', 'rejected', 'delivered', 'reopened', 'handover_failed', 'code_reset',
]);

interface EventRow { claimId: string; event: PlayerClaimEvent['event']; note: string | null; createdAt: string }

/**
 * Each claim's timeline as its winner may see it, oldest first: no admins, IPs or risk details, and an
 * admin's note only on a rejection. A claim with no entries (or a database without the migration) gets
 * an empty list rather than an error, so the rest of the page still loads.
 */
export async function playerTimelines(claimIds: string[]): Promise<Map<string, PlayerClaimEvent[]>> {
  const timelines = new Map<string, PlayerClaimEvent[]>(claimIds.map((id) => [id, []]));
  if (claimIds.length === 0) return timelines;
  const { data, error } = await getAdminDb()
    .from('PrizeClaimEvent')
    .select('claimId, event, note, createdAt')
    .in('claimId', claimIds)
    .order('createdAt', { ascending: true });
  if (error) {
    console.error('[claims] Could not load claim timelines:', error);
    return timelines;
  }
  for (const row of (data || []) as EventRow[]) {
    if (!PLAYER_EVENTS.has(row.event)) continue;
    timelines.get(row.claimId)?.push({
      event: row.event,
      at: row.createdAt,
      ...(row.event === 'rejected' ? { note: row.note } : {}),
    });
  }
  return timelines;
}

/** A timeline entry as admins see it: who, any note, and the details (origin IP, risk, handover) */
export interface AdminClaimEvent {
  id: string;
  event: PlayerClaimEvent['event'];
  actor: string;
  note: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/** A claim's full timeline for the admin Claims screen, oldest first. */
export async function adminTimeline(claimId: string): Promise<AdminClaimEvent[]> {
  const { data, error } = await getAdminDb()
    .from('PrizeClaimEvent')
    .select('id, event, actor, note, details, createdAt')
    .eq('claimId', claimId)
    .order('createdAt', { ascending: true });
  if (error) throw error;
  return (data || []) as AdminClaimEvent[];
}

export interface TrackedClaimFields {
  /** The winner's handover code, only while the claim is approved (on its way) */
  handoverCode: string | null;
  timeline: PlayerClaimEvent[];
}

/**
 * Adds the handover code and timeline to the winner's own claims. Call only for claims the signed-in
 * player owns.
 */
export async function withClaimTracking<T extends { id: string; status: string; handoverVersion?: number | null }>(
  claims: T[],
): Promise<(T & TrackedClaimFields)[]> {
  const timelines = await playerTimelines(claims.map((c) => c.id));
  return claims.map((claim) => ({
    ...claim,
    handoverCode: claim.status === 'approved' ? handoverCode(claim.id, claim.handoverVersion ?? 1) : null,
    // playerTimelines has an entry for every id it was given
    timeline: timelines.get(claim.id)!,
  }));
}
