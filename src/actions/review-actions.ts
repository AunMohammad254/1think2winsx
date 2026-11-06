'use server';

import { z } from 'zod';
import { requireAdminSession } from '@/lib/admin-session';
import { notificationDb, reviewDb } from '@/lib/supabase/db';
import type { AdminReview } from '@/lib/supabase/db-modules/review.db';
import { REVIEW_NOTE_MAX, REVIEW_STATUSES, type ReviewStatus } from '@/lib/reviews';
import { invalidatePublicReviews } from '@/lib/review-service';

/**
 * Admin actions for /admin/reviews. Each one checks the admin session first: requireAdminSession()
 * redirects a signed-out caller to /admin/login, and that redirect is left to propagate.
 */

const PAGE_SIZE = 20;
const statusSchema = z.enum(REVIEW_STATUSES);

const listSchema = z.object({
    status: statusSchema.optional(),
    page: z.number().int().min(1).max(10_000).default(1),
});

const moderateSchema = z.object({
    id: z.uuid(),
    status: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(REVIEW_NOTE_MAX, `The note can be at most ${REVIEW_NOTE_MAX} characters`).default(''),
});

export type ListReviewsResult =
    | { success: true; reviews: AdminReview[]; total: number; counts: Record<ReviewStatus, number>; page: number; pageSize: number }
    | { success: false; error: string };

export async function listReviewsAction(input: { status?: ReviewStatus; page?: number }): Promise<ListReviewsResult> {
    await requireAdminSession();
    const parsed = listSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Invalid filter' };
    const { status, page } = parsed.data;

    try {
        const [{ reviews, total }, counts] = await Promise.all([
            reviewDb.list({ status, page, limit: PAGE_SIZE }),
            reviewDb.countByStatus(),
        ]);
        return { success: true, reviews, total, counts, page, pageSize: PAGE_SIZE };
    } catch (err) {
        console.error('[reviews] admin list failed:', err);
        return { success: false, error: 'Failed to load reviews' };
    }
}

export type ModerateReviewResult =
    | { success: true; review: AdminReview; notified: boolean }
    | { success: false; error: string };

/**
 * Approves a review (it appears on the home page) or rejects it (it leaves the home page, if it was
 * there). The player gets an in-app notification, with the note when one is given.
 */
export async function moderateReviewAction(input: { id: string; status: 'approved' | 'rejected'; note?: string }): Promise<ModerateReviewResult> {
    const adminEmail = await requireAdminSession();
    const parsed = moderateSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    const { id, status, note } = parsed.data;

    try {
        const current = await reviewDb.findById(id);
        if (!current) return { success: false, error: 'Review not found' };

        const moderationNote = note || null;
        if (current.status === status && current.moderationNote === moderationNote) {
            return { success: true, review: current, notified: false };
        }

        const review = await reviewDb.moderate(id, { status, moderationNote, moderatedBy: adminEmail });
        invalidatePublicReviews();

        let notified = false;
        try {
            await notificationDb.create(review.userId, reviewNotification(status, moderationNote));
            notified = true;
        } catch (err) {
            // The decision is saved; the player still sees it when they open the Review modal
            console.error('[reviews] notification failed:', err);
        }
        return { success: true, review, notified };
    } catch (err) {
        console.error('[reviews] moderate failed:', err);
        return { success: false, error: 'Failed to update the review' };
    }
}

export type DeleteReviewResult = { success: true } | { success: false; error: string };

/** Deletes a review for good (spam, abuse). The player can write a new one. */
export async function deleteReviewAction(id: string): Promise<DeleteReviewResult> {
    await requireAdminSession();
    if (!z.uuid().safeParse(id).success) return { success: false, error: 'Invalid review' };
    try {
        await reviewDb.remove(id);
        invalidatePublicReviews();
        return { success: true };
    } catch (err) {
        console.error('[reviews] delete failed:', err);
        return { success: false, error: 'Failed to delete the review' };
    }
}

function reviewNotification(status: 'approved' | 'rejected', note: string | null) {
    if (status === 'approved') {
        return {
            title: 'Your review is live',
            message: note
                ? `Thanks for reviewing 1Think 2Win! It now shows on our home page. Our team says: "${note}"`
                : 'Thanks for reviewing 1Think 2Win! It now shows on our home page.',
            type: 'review',
            link: '/#reviews',
        };
    }
    return {
        title: 'Your review was not approved',
        message: note
            ? `Our team didn't publish your review: "${note}" You can edit it and send it again.`
            : "Our team didn't publish your review. You can edit it and send it again.",
        type: 'review',
    };
}
