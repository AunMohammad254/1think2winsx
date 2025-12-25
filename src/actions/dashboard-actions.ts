'use server';

import prisma from '@/lib/prisma';
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
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Run all counts in parallel for efficiency
    const [
        totalUsers,
        recentUsers,
        totalQuizzes,
        activeQuizzes,
        draftQuizzes,
        pausedQuizzes,
        totalAttempts,
        completedAttempts,
        recentAttempts,
        avgScoreResult,
        revenueResult,
    ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        prisma.quiz.count(),
        prisma.quiz.count({ where: { status: 'active' } }),
        prisma.quiz.count({ where: { status: 'draft' } }),
        prisma.quiz.count({ where: { status: 'paused' } }),
        prisma.quizAttempt.count(),
        prisma.quizAttempt.count({ where: { isCompleted: true } }),
        prisma.quizAttempt.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        prisma.quizAttempt.aggregate({
            _avg: { score: true },
            where: { isCompleted: true },
        }),
        prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: 'completed' },
        }),
    ]);

    const averageScore = avgScoreResult._avg.score || 0;
    const totalRevenue = revenueResult._sum.amount || 0;
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
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get recent quiz attempts
    const recentAttempts = await prisma.quizAttempt.findMany({
        where: { isCompleted: true },
        orderBy: { createdAt: 'desc' },
        take: Math.ceil(limit / 2),
        include: {
            user: { select: { id: true, email: true, name: true } },
            quiz: { select: { id: true, title: true } },
        },
    });

    // Get recent user signups
    const recentSignups = await prisma.user.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        orderBy: { createdAt: 'desc' },
        take: Math.ceil(limit / 2),
        select: { id: true, email: true, name: true, createdAt: true },
    });

    // Combine and sort by date
    const activities: RecentActivity[] = [
        ...recentAttempts.map((attempt) => ({
            id: attempt.id,
            type: 'quiz_attempt' as const,
            userId: attempt.user.id,
            userEmail: attempt.user.email,
            userName: attempt.user.name,
            quizId: attempt.quiz.id,
            quizTitle: attempt.quiz.title,
            score: attempt.score,
            createdAt: attempt.createdAt,
        })),
        ...recentSignups.map((user) => ({
            id: user.id,
            type: 'user_signup' as const,
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            quizId: null,
            quizTitle: null,
            score: null,
            createdAt: user.createdAt,
        })),
    ];

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

    // Build where clause
    const where: {
        AND?: Array<{
            OR?: Array<{ title?: { contains: string; mode: 'insensitive' }; description?: { contains: string; mode: 'insensitive' } }>;
            status?: string;
        }>;
    } = {};

    const conditions: Array<{
        OR?: Array<{ title?: { contains: string; mode: 'insensitive' }; description?: { contains: string; mode: 'insensitive' } }>;
        status?: string;
    }> = [];

    if (search) {
        conditions.push({
            OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ],
        });
    }

    if (status && status !== 'all') {
        conditions.push({ status });
    }

    if (conditions.length > 0) {
        where.AND = conditions;
    }

    // Build orderBy
    const orderBy: Record<string, 'asc' | 'desc'> = {};
    if (sortBy === 'title' || sortBy === 'status' || sortBy === 'createdAt') {
        orderBy[sortBy] = sortOrder;
    } else {
        orderBy.createdAt = 'desc';
    }

    // Get total count and quizzes in parallel
    const [total, quizzes] = await Promise.all([
        prisma.quiz.count({ where }),
        prisma.quiz.findMany({
            where,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: {
                _count: {
                    select: {
                        questions: true,
                        attempts: true,
                    },
                },
            },
        }),
    ]);

    return {
        quizzes: quizzes.map((quiz) => ({
            id: quiz.id,
            title: quiz.title,
            description: quiz.description,
            status: quiz.status,
            duration: quiz.duration,
            passingScore: quiz.passingScore,
            createdAt: quiz.createdAt,
            updatedAt: quiz.updatedAt,
            _count: quiz._count,
        })),
        pagination: {
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
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
            const quiz = await prisma.quiz.findUnique({
                where: { id: quizId },
                include: { questions: { select: { id: true } } },
            });

            if (!quiz) {
                return { success: false, error: 'Quiz not found' };
            }

            if (quiz.questions.length === 0) {
                return { success: false, error: 'Cannot publish quiz without questions' };
            }
        }

        const updated = await prisma.quiz.update({
            where: { id: quizId },
            data: { status: newStatus },
            select: { status: true },
        });

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
    const quiz = await prisma.quiz.findUnique({
        where: { id: quizId },
        include: {
            questions: {
                orderBy: { createdAt: 'asc' },
            },
            _count: {
                select: {
                    questions: true,
                    attempts: true,
                },
            },
        },
    });

    return quiz;
}
