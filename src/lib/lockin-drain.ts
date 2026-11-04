import { getAdminDb } from '@/lib/supabase/db';

/**
 * Lock-ins queued at the edge. For a big event, the edge-shield Worker takes lock-ins off Hostinger: it puts each
 * one on a Cloudflare Queue, and the queue's consumer saves them in batches (submit_lockin_batch, migration
 * 20261104180000) up to a couple of minutes later. Saving a quiz's result closes its questions, and a queued
 * lock-in judged after that is refused, so the result waits until the database has processed every lock-in the
 * edge received for the quiz.
 *
 * LOCKIN_EDGE=true in the app's environment says the queue is in use. Set it whenever the Worker's LOCKIN_EDGE is
 * on, and keep it on until the last event's queue is empty.
 */

export interface LockinDrain {
  /** Lock-ins the edge took for this quiz */
  received: number;
  /** Of those, the ones the database has processed, whatever their outcome */
  processed: number;
}

const STATUS_TIMEOUT_MS = 5_000;

/** The quiz's queued lock-ins, or null when the edge queue isn't in use. Throws when a count can't be read. */
export async function lockinDrain(quizId: string): Promise<LockinDrain | null> {
  if (process.env.LOCKIN_EDGE !== 'true') return null;
  const [received, processed] = await Promise.all([edgeReceived(quizId), dbProcessed(quizId)]);
  return { received, processed };
}

/** The edge's tally, from the Worker's own endpoint (it answers on /api/* before the request reaches the app). */
async function edgeReceived(quizId: string): Promise<number> {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) throw new Error('LOCKIN_EDGE is on but NEXT_PUBLIC_SITE_URL or CRON_SECRET is missing');
  const response = await fetch(`${site.replace(/\/+$/, '')}/api/edge/lockin-status?quiz=${encodeURIComponent(quizId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`lockin-status answered ${response.status}`);
  const received = Number((await response.json().catch(() => null))?.received);
  if (!Number.isInteger(received) || received < 0) throw new Error('lockin-status sent no count');
  return received;
}

async function dbProcessed(quizId: string): Promise<number> {
  const { data, error } = await getAdminDb().from('LockinDrain').select('processed').eq('quizId', quizId).maybeSingle();
  if (error) throw error;
  return (data as { processed: number } | null)?.processed ?? 0;
}
