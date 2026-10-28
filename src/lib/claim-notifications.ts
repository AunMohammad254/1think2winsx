import { notificationDb } from '@/lib/supabase/db';

export interface ClaimDecision {
  /** The claim's new status, or 'code_reset' when the winner got a new handover code */
  status: string;
  prizeName: string;
  /** Points the claim cost: refunded when it is rejected */
  pointsUsed: number;
  /** Quoted in every message, so the winner can tell ours from a scammer's */
  trackingId?: string | null;
  /** The admin's note, passed on to the player as written */
  note?: string | null;
}

/**
 * What the player is told about an admin's decision on their prize claim, or null when they aren't told.
 * Never includes the handover code: notifications show on lock screens.
 */
export function claimDecisionNotification({ status, prizeName, pointsUsed, trackingId, note }: ClaimDecision) {
  const trimmed = note?.trim();
  const withNote = (text: string) => (trimmed ? `${text} Note from our team: ${trimmed}` : text);
  const claim = trackingId ? `Your claim ${trackingId} for ${prizeName}` : `Your claim for ${prizeName}`;
  const base = { type: 'prize_claim', link: '/profile' };
  switch (status) {
    case 'approved':
      return {
        ...base,
        title: '🎁 Prize claim approved',
        message: withNote(`${claim} was approved. We'll contact you about delivery. Your handover code is on your profile: give it only to the person handing you the prize.`),
      };
    case 'rejected':
      return { ...base, title: 'Prize claim rejected', message: withNote(`${claim} was rejected, and your ${pointsUsed} points were refunded.`) };
    case 'fulfilled':
      return { ...base, title: '📦 Prize delivered', message: withNote(`${claim} is marked as delivered.`) };
    case 'code_reset':
      return { ...base, title: '🔑 New handover code', message: `${claim} has a new handover code, on your profile. The old one no longer works.` };
    default:
      return null;
  }
}

/**
 * Tells the player (bell + web push) about the decision. Best effort: the claim is already saved, so
 * a failure is only logged. Returns whether the player was told.
 */
export async function notifyClaimDecision(userId: string, decision: ClaimDecision): Promise<boolean> {
  const notification = claimDecisionNotification(decision);
  if (!notification) return false;
  try {
    await notificationDb.create(userId, notification);
    return true;
  } catch (err) {
    console.error('[claims] Failed to notify the player:', err);
    return false;
  }
}
