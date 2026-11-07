/**
 * Review Database Operations
 *
 * "Review" is service-role only (RLS on, no policies), so everything here uses the admin client.
 * Player-facing calls take the player's id from the signed-in session; the public list only ever
 * returns approved reviews, without user ids.
 */

import { getAdminDb } from './shared'
import { REVIEW_STATUSES, type PublicReview, type Review, type ReviewStatus, type ReviewSummary, type ReviewValues } from '@/lib/reviews'

/** A review with the player's account name and email, for the admin page */
export interface AdminReview extends Review {
    user: { name: string | null; email: string } | null
}

const ADMIN_SELECT = '*, user:User(name, email)'
const PUBLIC_SELECT = 'id, rating, comment, displayName, city, createdAt'
/** The average is worked out from at most this many approved ratings */
const SUMMARY_SAMPLE = 5000

export const reviewDb = {
    async findByUser(userId: string): Promise<Review | null> {
        const { data, error } = await getAdminDb().from('Review').select('*').eq('userId', userId).maybeSingle()
        if (error) throw error
        return data as Review | null
    },

    /** Writes the player's one review. A new or edited review always waits for approval again. */
    async upsertForUser(userId: string, values: ReviewValues): Promise<Review> {
        const { data, error } = await getAdminDb()
            .from('Review')
            .upsert(
                {
                    userId,
                    ...values,
                    status: 'pending',
                    moderationNote: null,
                    moderatedAt: null,
                    moderatedBy: null,
                    updatedAt: new Date().toISOString(),
                },
                { onConflict: 'userId' }
            )
            .select('*')
            .single()
        if (error) throw error
        return data as Review
    },

    /** Approved reviews, newest first */
    async listApproved(limit: number): Promise<PublicReview[]> {
        const { data, error } = await getAdminDb()
            .from('Review')
            .select(PUBLIC_SELECT)
            .eq('status', 'approved')
            .order('createdAt', { ascending: false })
            .limit(limit)
        if (error) throw error
        return (data || []) as PublicReview[]
    },

    async approvedSummary(): Promise<ReviewSummary> {
        const { data, error, count } = await getAdminDb()
            .from('Review')
            .select('rating', { count: 'exact' })
            .eq('status', 'approved')
            .limit(SUMMARY_SAMPLE)
        if (error) throw error
        const ratings = (data || []) as { rating: number }[]
        const total = ratings.reduce((sum, row) => sum + row.rating, 0)
        return {
            count: count ?? ratings.length,
            average: ratings.length ? Math.round((total / ratings.length) * 10) / 10 : 0,
        }
    },

    /** One page of reviews for the admin, newest first, optionally of one status */
    async list(options: { status?: ReviewStatus; page: number; limit: number }): Promise<{ reviews: AdminReview[]; total: number }> {
        let query = getAdminDb().from('Review').select(ADMIN_SELECT, { count: 'exact' })
        if (options.status) query = query.eq('status', options.status)
        const from = (options.page - 1) * options.limit
        const { data, error, count } = await query
            .order('createdAt', { ascending: false })
            .range(from, from + options.limit - 1)
        if (error) throw error
        return { reviews: (data || []) as AdminReview[], total: count || 0 }
    },

    async countByStatus(): Promise<Record<ReviewStatus, number>> {
        const adminDb = getAdminDb()
        const counts = await Promise.all(
            REVIEW_STATUSES.map(async (status) => {
                const { count, error } = await adminDb
                    .from('Review')
                    .select('id', { count: 'exact', head: true })
                    .eq('status', status)
                if (error) throw error
                return [status, count || 0] as const
            })
        )
        return Object.fromEntries(counts) as Record<ReviewStatus, number>
    },

    async findById(id: string): Promise<AdminReview | null> {
        const { data, error } = await getAdminDb().from('Review').select(ADMIN_SELECT).eq('id', id).maybeSingle()
        if (error) throw error
        return data as AdminReview | null
    },

    async moderate(id: string, changes: { status: ReviewStatus; moderationNote: string | null; moderatedBy: string }): Promise<AdminReview> {
        const now = new Date().toISOString()
        const { data, error } = await getAdminDb()
            .from('Review')
            .update({ ...changes, moderatedAt: now, updatedAt: now })
            .eq('id', id)
            .select(ADMIN_SELECT)
            .single()
        if (error) throw error
        return data as AdminReview
    },

    async remove(id: string): Promise<void> {
        const { error } = await getAdminDb().from('Review').delete().eq('id', id)
        if (error) throw error
    },
}
