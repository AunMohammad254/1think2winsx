'use server';

import { adminActionGuard, assertAdmin } from '@/lib/admin-guard';

import { getAdminDb } from '@/lib/supabase/db';
import { quizDb, questionDb } from '@/lib/supabase/db';
import { revalidatePath } from 'next/cache';

// ============================================
// Types
// ============================================

export type DashboardStats = {
    totalUsers: number;
    recentUsers: number;
    totalQuizzes: number;
    activeQuizzes: number;
    draftQuizzes: number;
    pausedQuizzes: number;
    totalAttempts: number;
    completedAttempts: number;
    recentAttempts: number;
    averageScore: number;
    totalRevenue: number;
    completionRate: number;
};

export type RecentActivity = {
    id: string;
    type: 'quiz_attempt' | 'user_signup';
    userId: string;
    userEmail: string;
    userName: string | null;
    quizId: string | null;
    quizTitle: string | null;
    score: number | null;
    createdAt: Date;
};

export type RecentActivityPage = {
    activities: RecentActivity[];
    /** Pass back as `before` for the next, older page; null when there is nothing older. */
    nextCursor: string | null;
};

export type QuizListItem = {
    id: string;
    title: string;
    description: string | null;
    status: string;
    duration: number;
    passingScore: number;
    createdAt: Date;
    updatedAt: Date;
    _count: {
        questions: number;
        attempts: number;
    };
};

export type PaginatedQuizzes = {
    quizzes: QuizListItem[];
    pagination: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
    };
};

type ActionResult<T = undefined> =
    | { success: true; data?: T; message?: string }
    | { success: false; error: string };

// ============================================
// Dashboard Stats Actions
// ============================================

/**
 * Get all dashboard statistics in a single optimized call
 */
export async function getDashboardStats(): Promise<DashboardStats> {
    await assertAdmin();
    const supabase = getAdminDb();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Run all counts in parallel for efficiency
    const [
        usersResult,
        recentUsersResult,
        quizzesResult,
        activeQuizzesResult,
        draftQuizzesResult,
        pausedQuizzesResult,
        attemptsResult,
        completedAttemptsResult,
        recentAttemptsResult,
        avgScoreResult,
        revenueResult,
    ] = await Promise.all([
        supabase.from('User').select('*', { count: 'exact', head: true }),
        supabase.from('User').select('*', { count: 'exact', head: true }).gte('createdAt', sevenDaysAgo),
        supabase.from('Quiz').select('*', { count: 'exact', head: true }),
        supabase.from('Quiz').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('Quiz').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
        supabase.from('Quiz').select('*', { count: 'exact', head: true }).eq('status', 'paused'),
        supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }),
        supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }).eq('isCompleted', true),
        supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }).gte('createdAt', sevenDaysAgo),
        supabase.from('QuizAttempt').select('score').eq('isCompleted', true),
        supabase.from('Payment').select('amount').eq('status', 'completed'),
    ]);

    const totalUsers = usersResult.count || 0;
    const recentUsers = recentUsersResult.count || 0;
    const totalQuizzes = quizzesResult.count || 0;
    const activeQuizzes = activeQuizzesResult.count || 0;
    const draftQuizzes = draftQuizzesResult.count || 0;
    const pausedQuizzes = pausedQuizzesResult.count || 0;
    const totalAttempts = attemptsResult.count || 0;
    const completedAttempts = completedAttemptsResult.count || 0;
    const recentAttempts = recentAttemptsResult.count || 0;

    // Calculate average score
    const scores = avgScoreResult.data || [];
    const averageScore = scores.length > 0
        ? scores.reduce((sum, s) => sum + (s.score || 0), 0) / scores.length
        : 0;

    // Calculate total revenue
    const payments = revenueResult.data || [];
    const totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const completionRate = totalAttempts > 0
        ? Math.round((completedAttempts / totalAttempts) * 100)
        : 0;

    return {
        totalUsers,
        recentUsers,
        totalQuizzes,
        activeQuizzes,
        draftQuizzes,
        pausedQuizzes,
        totalAttempts,
        completedAttempts,
        recentAttempts,
        averageScore: Math.round(averageScore * 10) / 10,
        totalRevenue,
        completionRate,
    };
}

/**
 * One page of the activity feed (completed quiz attempts, and sign-ups of the last 30 days), newest
 * first. The dashboard loads the first page and asks for the next with `before: nextCursor`.
 *
 * Each source is read once, with its user and quiz joined in: this used to cost two more queries per
 * attempt, and split the page in half (4 attempts + 4 sign-ups) whatever had actually happened.
 */
export async function getRecentActivity(
    { before = null, limit = 20 }: { before?: string | null; limit?: number } = {},
): Promise<RecentActivityPage> {
    await assertAdmin();
    if (before !== null && Number.isNaN(Date.parse(before))) throw new Error('Invalid activity cursor');
    const pageSize = Math.min(Math.max(Math.trunc(limit) || 1, 1), 50);
    const supabase = getAdminDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let attemptsQuery = supabase
        .from('QuizAttempt')
        .select('id, userId, quizId, score, createdAt, User:userId (email, name), Quiz:quizId (title)')
        .eq('isCompleted', true)
        .order('createdAt', { ascending: false })
        .limit(pageSize);
    let signupsQuery = supabase
        .from('User')
        .select('id, email, name, createdAt')
        .gte('createdAt', thirtyDaysAgo)
        .order('createdAt', { ascending: false })
        .limit(pageSize);
    if (before) {
        attemptsQuery = attemptsQuery.lt('createdAt', before);
        signupsQuery = signupsQuery.lt('createdAt', before);
    }
    const [attemptsRes, signupsRes] = await Promise.all([attemptsQuery, signupsQuery]);
    if (attemptsRes.error) throw attemptsRes.error;
    if (signupsRes.error) throw signupsRes.error;

    type Joined<T> = T | T[] | null;
    const one = <T,>(v: Joined<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);
    const attempts = (attemptsRes.data || []) as Array<{
        id: string; userId: string; quizId: string; score: number | null; createdAt: string;
        User: Joined<{ email: string; name: string | null }>; Quiz: Joined<{ title: string }>;
    }>;
    const signups = (signupsRes.data || []) as Array<{ id: string; email: string; name: string | null; createdAt: string }>;

    // Each item keeps its raw timestamp: the cursor must match the database's own value exactly
    const merged = [
        ...attempts.map((attempt) => {
            const user = one(attempt.User);
            const quiz = one(attempt.Quiz);
            return {
                at: attempt.createdAt,
                activity: user ? {
                    id: attempt.id,
                    type: 'quiz_attempt' as const,
                    userId: attempt.userId,
                    userEmail: user.email,
                    userName: user.name,
                    quizId: quiz ? attempt.quizId : null,
                    quizTitle: quiz?.title || null,
                    score: attempt.score,
                    createdAt: new Date(attempt.createdAt),
                } : null,
            };
        }),
        ...signups.map((user) => ({
            at: user.createdAt,
            activity: {
                id: user.id,
                type: 'user_signup' as const,
                userId: user.id,
                userEmail: user.email,
                userName: user.name,
                quizId: null,
                quizTitle: null,
                score: null,
                createdAt: new Date(user.createdAt),
            },
        })),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    const page = merged.slice(0, pageSize);
    // Older items may exist when either source filled its page
    const hasMore = merged.length > pageSize || attempts.length === pageSize || signups.length === pageSize;
    return {
        activities: page.flatMap((item) => (item.activity ? [item.activity] : [])),
        nextCursor: hasMore && page.length > 0 ? page[page.length - 1].at : null,
    };
}

// ============================================
// Quiz Management Actions
// ============================================

/**
 * Get paginated quizzes with server-side filtering and search
 */
export async function getQuizzes(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}): Promise<PaginatedQuizzes> {
    await assertAdmin();
    const {
        page = 1,
        pageSize = 10,
        search = '',
        status = 'all',
        sortBy = 'createdAt',
        sortOrder = 'desc',
    } = options;

    const supabase = getAdminDb();

    // Build the query
    let query = supabase.from('Quiz').select('*', { count: 'exact' });

    // Apply search filter
    if (search) {
        query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Apply status filter
    if (status && status !== 'all') {
        query = query.eq('status', status);
    }

    // Apply ordering
    const validSortBy = ['title', 'status', 'createdAt'].includes(sortBy) ? sortBy : 'createdAt';
    query = query.order(validSortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data: quizzes, count, error } = await query;

    if (error) {
        console.error('Error fetching quizzes:', error);
        return {
            quizzes: [],
            pagination: { total: 0, page, pageSize, totalPages: 0 },
        };
    }

    // Get question and attempt counts for each quiz
    const quizzesWithCounts = await Promise.all(
        (quizzes || []).map(async (quiz) => {
            const [questionsResult, attemptsResult] = await Promise.all([
                supabase.from('Question').select('*', { count: 'exact', head: true }).eq('quizId', quiz.id),
                supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }).eq('quizId', quiz.id),
            ]);

            return {
                id: quiz.id,
                title: quiz.title,
                description: quiz.description,
                status: quiz.status,
                duration: quiz.duration,
                passingScore: quiz.passingScore,
                createdAt: new Date(quiz.createdAt),
                updatedAt: new Date(quiz.updatedAt),
                _count: {
                    questions: questionsResult.count || 0,
                    attempts: attemptsResult.count || 0,
                },
            };
        })
    );

    return {
        quizzes: quizzesWithCounts,
        pagination: {
            total: count || 0,
            page,
            pageSize,
            totalPages: Math.ceil((count || 0) / pageSize),
        },
    };
}

/**
 * Toggle quiz status between draft and active
 */
export async function toggleQuizStatus(
    quizId: string,
    newStatus: 'draft' | 'active' | 'paused'
): Promise<ActionResult<{ status: string }>> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        // If publishing, check for questions
        if (newStatus === 'active') {
            const questions = await questionDb.findByQuizId(quizId);

            if (questions.length === 0) {
                return { success: false, error: 'Cannot publish quiz without questions' };
            }
        }

        const updated = await quizDb.update(quizId, { status: newStatus });

        if (!updated) {
            return { success: false, error: 'Quiz not found' };
        }

        revalidatePath('/admin/dashboard');
        revalidatePath('/admin/quizzes');
        revalidatePath('/quizzes');

        return {
            success: true,
            data: { status: updated.status },
            message: `Quiz ${newStatus === 'active' ? 'published' : newStatus === 'paused' ? 'paused' : 'set to draft'} successfully!`,
        };
    } catch (error) {
        console.error('Toggle quiz status error:', error);
        return { success: false, error: 'Failed to update quiz status' };
    }
}

/**
 * Get a single quiz with full details
 */
export async function getQuizById(quizId: string) {
    await assertAdmin();
    const supabase = getAdminDb();

    const { data: quiz, error: quizError } = await supabase
        .from('Quiz')
        .select('*')
        .eq('id', quizId)
        .single();

    if (quizError || !quiz) {
        return null;
    }

    // Get questions
    const { data: questions } = await supabase
        .from('Question')
        .select('*')
        .eq('quizId', quizId)
        .order('createdAt', { ascending: true });

    // Get counts
    const [questionsCount, attemptsCount] = await Promise.all([
        supabase.from('Question').select('*', { count: 'exact', head: true }).eq('quizId', quizId),
        supabase.from('QuizAttempt').select('*', { count: 'exact', head: true }).eq('quizId', quizId),
    ]);

    return {
        ...quiz,
        questions: questions || [],
        _count: {
            questions: questionsCount.count || 0,
            attempts: attemptsCount.count || 0,
        },
    };
}
