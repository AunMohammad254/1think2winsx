'use server';

import { getDb } from '@/lib/supabase/db';
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
    const supabase = await getDb();
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
 * Get recent activity feed (quiz attempts and user signups)
 */
export async function getRecentActivity(limit: number = 10): Promise<RecentActivity[]> {
    const supabase = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Get recent quiz attempts with user and quiz info
    const { data: recentAttempts } = await supabase
        .from('QuizAttempt')
        .select('id, userId, quizId, score, createdAt')
        .eq('isCompleted', true)
        .order('createdAt', { ascending: false })
        .limit(Math.ceil(limit / 2));

    // Get user and quiz details for attempts
    const attemptActivities: RecentActivity[] = [];
    for (const attempt of recentAttempts || []) {
        const { data: user } = await supabase
            .from('User')
            .select('id, email, name')
            .eq('id', attempt.userId)
            .single();

        const { data: quiz } = await supabase
            .from('Quiz')
            .select('id, title')
            .eq('id', attempt.quizId)
            .single();

        if (user) {
            attemptActivities.push({
                id: attempt.id,
                type: 'quiz_attempt',
                userId: user.id,
                userEmail: user.email,
                userName: user.name,
                quizId: quiz?.id || null,
                quizTitle: quiz?.title || null,
                score: attempt.score,
                createdAt: new Date(attempt.createdAt),
            });
        }
    }

    // Get recent user signups
    const { data: recentSignups } = await supabase
        .from('User')
        .select('id, email, name, createdAt')
        .gte('createdAt', thirtyDaysAgo)
        .order('createdAt', { ascending: false })
        .limit(Math.ceil(limit / 2));

    const signupActivities: RecentActivity[] = (recentSignups || []).map((user) => ({
        id: user.id,
        type: 'user_signup' as const,
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        quizId: null,
        quizTitle: null,
        score: null,
        createdAt: new Date(user.createdAt),
    }));

    // Combine and sort by date
    const activities = [...attemptActivities, ...signupActivities];

    // Sort by date descending and limit
    return activities
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
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
    const {
        page = 1,
        pageSize = 10,
        search = '',
        status = 'all',
        sortBy = 'createdAt',
        sortOrder = 'desc',
    } = options;

    const supabase = await getDb();

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
    const supabase = await getDb();

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
