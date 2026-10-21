import { notificationDb } from '@/lib/supabase/db';

export interface ClaimDecision {
  status: string;
  prizeName: string;
  /** Points the claim cost: refunded when it is rejected */
  pointsUsed: number;
  /** The admin's note, passed on to the player as written */
  note?: string | null;
}

/** What the player is told about an admin's decision on their prize claim, or null when they aren't told. */
export function claimDecisionNotification({ status, prizeName, pointsUsed, note }: ClaimDecision) {
  const trimmed = note?.trim();
  const withNote = (text: string) => (trimmed ? `${text} Note from our team: ${trimmed}` : text);
  const base = { type: 'prize_claim', link: '/profile' };
  switch (status) {
    case 'approved':
      return { ...base, title: '🎁 Prize claim approved', message: withNote(`Your claim for ${prizeName} was approved. We'll contact you about delivery.`) };
    case 'rejected':
      return { ...base, title: 'Prize claim rejected', message: withNote(`Your claim for ${prizeName} was rejected, and your ${pointsUsed} points were refunded.`) };
    case 'fulfilled':
      return { ...base, title: '📦 Prize delivered', message: withNote(`Your claim for ${prizeName} is marked as delivered.`) };
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
