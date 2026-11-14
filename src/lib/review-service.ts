import { reviewDb } from '@/lib/supabase/db';
import type { PublicReviewsResponse } from '@/lib/reviews';

/**
 * The approved reviews every home-page visitor loads (/api/reviews). Server-only. Kept in memory for a
 * minute, so a busy home page costs the database one read a minute rather than one per visitor, and
 * dropped as soon as an admin approves, rejects or deletes a review or a player edits theirs.
 */

/** How many reviews the home page shows */
export const PUBLIC_REVIEW_LIMIT = 12;
export const PUBLIC_REVIEWS_TTL_MS = 60_000;

let cached: { value: PublicReviewsResponse; fetchedAt: number } | null = null;
let inflight: Promise<PublicReviewsResponse> | null = null;

export async function getPublicReviews(): Promise<PublicReviewsResponse> {
  if (cached && Date.now() - cached.fetchedAt < PUBLIC_REVIEWS_TTL_MS) return cached.value;
  // Visitors arriving together share one read
  if (!inflight) {
    inflight = Promise.all([reviewDb.listApproved(PUBLIC_REVIEW_LIMIT), reviewDb.approvedSummary()])
      .then(([reviews, summary]) => {
        const value = { reviews, summary };
        cached = { value, fetchedAt: Date.now() };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Forget the cached list (after any change to which reviews are approved). */
export function invalidatePublicReviews(): void {
  cached = null;
}
