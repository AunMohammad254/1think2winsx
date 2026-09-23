/**
 * QuizWinner Database Operations
 *
 * The QuizWinner table is a one-record-per-quiz audit ledger.
 * Once a winner is recorded it is immutable — no update/delete.
 */

import { getAdminDb, generateId } from './shared';
import type { Insertable } from '../database.types';

export const quizWinnerDb = {
    /**
     * Find winner for a quiz (returns null if no draw has been run yet).
     */
    async findByQuizId(quizId: string) {
        const adminDb = getAdminDb();
        const { data, error } = await adminDb
            .from('QuizWinner')
            .select(`
                *,
                user:userId (id, name, email, phone),
                prize:prizeId (id, name, description, imageUrl),
                quiz:quizId (id, title)
            `)
            .eq('quizId', quizId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
    },

    /**
     * Check whether a draw has already been run for this quiz.
     */
    async existsForQuiz(quizId: string): Promise<boolean> {
        const adminDb = getAdminDb();
        const { data, error } = await adminDb
            .from('QuizWinner')
            .select('id')
            .eq('quizId', quizId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        return !!data;
    },

    /**
     * Record a winner. Throws if a winner already exists for this quiz
     * (enforced by unique index on quizId — idempotency guard).
     */
    async create(winnerData: Insertable<'QuizWinner'>) {
        const adminDb = getAdminDb();
        const now = new Date().toISOString();
        const { data, error } = await adminDb
            .from('QuizWinner')
            .insert({
                id: generateId(),
                createdAt: now,
                updatedAt: now,
                ...winnerData,
            } as any)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    /**
     * Mark notification as sent (called after winner notification is dispatched).
     */
    async markNotificationSent(id: string) {
        const adminDb = getAdminDb();
        const { data, error } = await adminDb
            .from('QuizWinner')
            .update({ notificationSent: true, updatedAt: new Date().toISOString() } as any)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    /**
     * Attach a prizeRedemptionId to the winner record.
     */
    async linkRedemption(id: string, prizeRedemptionId: string) {
        const adminDb = getAdminDb();
        const { data, error } = await adminDb
            .from('QuizWinner')
            .update({ prizeRedemptionId, updatedAt: new Date().toISOString() } as any)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    /**
     * List all recorded winners (admin view, paginated).
     */
    async findMany(options?: { limit?: number; offset?: number }) {
        const adminDb = getAdminDb();
        const limit = options?.limit ?? 50;
        const offset = options?.offset ?? 0;

        const { data, error } = await adminDb
            .from('QuizWinner')
            .select(`
                *,
                user:userId (id, name, email),
                prize:prizeId (id, name),
                quiz:quizId (id, title)
            `)
            .order('selectedAt', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;
        return data || [];
    },
};
