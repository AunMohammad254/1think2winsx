import { z } from 'zod';

/**
 * Player reviews (table "Review", migration 20261106180000_player_reviews): the shapes and limits the
 * Review modal, /api/reviews and /admin/reviews share. No server imports: client components read it.
 */

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Not approved',
};

// The same limits as the table's CHECK constraints
export const REVIEW_COMMENT_MIN = 10;
export const REVIEW_COMMENT_MAX = 500;
export const REVIEW_NAME_MAX = 40;
export const REVIEW_NOTE_MAX = 300;

/** What a player sends from the Review modal */
export const reviewInputSchema = z.object({
  rating: z.number().int().min(1, 'Choose a star rating').max(5, 'Choose a star rating'),
  comment: z
    .string()
    .trim()
    .min(REVIEW_COMMENT_MIN, `Write at least ${REVIEW_COMMENT_MIN} characters`)
    .max(REVIEW_COMMENT_MAX, `Keep it under ${REVIEW_COMMENT_MAX} characters`),
  displayName: z
    .string()
    .trim()
    .min(2, 'Enter the name to show (at least 2 characters)')
    .max(REVIEW_NAME_MAX, `The name can be at most ${REVIEW_NAME_MAX} characters`),
  // Optional: an empty box means no city
  city: z
    .string()
    .trim()
    .max(REVIEW_NAME_MAX, `The city can be at most ${REVIEW_NAME_MAX} characters`)
    .refine((value) => value === '' || value.length >= 2, 'Enter a city of at least 2 characters, or leave it empty')
    .transform((value) => value || null),
});

export type ReviewInput = z.input<typeof reviewInputSchema>;
export type ReviewValues = z.output<typeof reviewInputSchema>;

/** A row of "Review" */
export interface Review {
  id: string;
  userId: string;
  rating: number;
  comment: string;
  displayName: string;
  city: string | null;
  status: ReviewStatus;
  moderationNote: string | null;
  moderatedAt: string | null;
  moderatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a player sees of their own review (not who moderated it) */
export type OwnReview = Pick<Review, 'id' | 'rating' | 'comment' | 'displayName' | 'city' | 'status' | 'moderationNote' | 'updatedAt'>;

/** What the home page shows of an approved review */
export type PublicReview = Pick<Review, 'id' | 'rating' | 'comment' | 'displayName' | 'city' | 'createdAt'>;

export interface ReviewSummary {
  /** Approved reviews only */
  count: number;
  /** Mean star rating, one decimal; 0 with no reviews */
  average: number;
}

export interface PublicReviewsResponse {
  reviews: PublicReview[];
  summary: ReviewSummary;
}

export const toOwnReview = (review: Review): OwnReview => ({
  id: review.id,
  rating: review.rating,
  comment: review.comment,
  displayName: review.displayName,
  city: review.city,
  status: review.status,
  moderationNote: review.moderationNote,
  updatedAt: review.updatedAt,
});

/** "Areeba K." from "Areeba Khan": the default name to show, so a full name isn't published by accident */
export function defaultDisplayName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0].slice(0, REVIEW_NAME_MAX);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.`.slice(0, REVIEW_NAME_MAX) : first;
}
