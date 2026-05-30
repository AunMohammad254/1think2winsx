'use server';

import { getAdminDb } from '@/lib/supabase/db';
import { requireAdminSession } from '@/lib/admin-session';

export type RevenueDataPoint = {
    date: string;
    amount: number;
};

export type RetentionCohort = {
    cohortName: string;
    registered: number;
    active: number;
    rate: number;
};

export type AnalyticsData = {
    revenue: RevenueDataPoint[];
    funnel: {
        stage: string;
        count: number;
        percentage: number;
    }[];
    retention: {
        dau: number;
        wau: number;
        mau: number;
        stickiness: number;
        cohorts: RetentionCohort[];
    };
    prizes: {
        redemptionsByStatus: { status: string; count: number }[];
        stockByCategory: { category: string; stock: number }[];
        totalClaimedValue: number;
    };
};

export async function getAnalyticsData(): Promise<AnalyticsData> {
    // 1. Ensure caller is authenticated admin
    await requireAdminSession();

    const adminDb = getAdminDb();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Run primary queries in parallel
    const [
        paymentsResult,
        attemptsResult,
        quizzesResult,
        redemptionsResult,
        prizesResult,
        usersResult,
    ] = await Promise.all([
        adminDb.from('Payment').select('amount, createdAt').eq('status', 'completed').gte('createdAt', thirtyDaysAgo),
        adminDb.from('QuizAttempt').select('id, userId, score, quizId, isCompleted, createdAt').gte('createdAt', thirtyDaysAgo),
        adminDb.from('Quiz').select('id, passingScore'),
        adminDb.from('PrizeRedemption').select('status, pointsUsed, prizeId'),
        adminDb.from('Prize').select('id, name, category, stock, value'),
        adminDb.from('User').select('id, createdAt').gte('createdAt', thirtyDaysAgo),
    ]);

    const payments = paymentsResult.data || [];
    const attempts = attemptsResult.data || [];
    const quizzes = quizzesResult.data || [];
    const redemptions = redemptionsResult.data || [];
    const prizes = prizesResult.data || [];
    const users = usersResult.data || [];

    // ============================================
    // 1. Revenue aggregation (Last 30 days)
    // ============================================
    const revenueMap = new Map<string, number>();
    // Pre-fill last 30 days
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateString = d.toISOString().split('T')[0];
        revenueMap.set(dateString, 0);
    }

    payments.forEach((p: any) => {
        const dateString = p.createdAt.split('T')[0];
        if (revenueMap.has(dateString)) {
            revenueMap.set(dateString, (revenueMap.get(dateString) || 0) + (p.amount || 0));
        }
    });

    const revenue: RevenueDataPoint[] = Array.from(revenueMap.entries()).map(([date, amount]) => ({
        date,
        amount,
    }));

    // ============================================
    // 2. Quiz Funnel calculation
    // ============================================
    const totalAttempts = attempts.length;
    const completedAttempts = attempts.filter((a: any) => a.isCompleted).length;
    
    // Build quiz passing score map
    const passingScores = new Map<string, number>();
    quizzes.forEach((q: any) => passingScores.set(q.id, q.passingScore || 80));

    const passedAttempts = attempts.filter((a: any) => {
        if (!a.isCompleted) return false;
        const passingScore = passingScores.get(a.quizId) || 80;
        return (a.score || 0) >= passingScore;
    }).length;

    const funnel = [
        { stage: 'Quiz Started', count: totalAttempts, percentage: 100 },
        { stage: 'Completed', count: completedAttempts, percentage: totalAttempts > 0 ? Math.round((completedAttempts / totalAttempts) * 100) : 0 },
        { stage: 'Passed Quiz', count: passedAttempts, percentage: totalAttempts > 0 ? Math.round((passedAttempts / totalAttempts) * 100) : 0 },
    ];

    // ============================================
    // 3. Player Retention & Stickiness
    // ============================================
    // DAU attempts
    const dauUsers = new Set(
        attempts
            .filter((a: any) => a.createdAt >= oneDayAgo)
            .map((a: any) => a.userId)
    );
    // WAU attempts
    const wauUsers = new Set(
        attempts
            .filter((a: any) => a.createdAt >= sevenDaysAgo)
            .map((a: any) => a.userId)
    );
    // MAU attempts
    const mauUsers = new Set(attempts.map((a: any) => a.userId));

    const dau = dauUsers.size;
    const wau = wauUsers.size;
    const mau = mauUsers.size;
    const stickiness = mau > 0 ? Math.round((dau / mau) * 1000) / 10 : 0;

    // Cohort analysis (last 4 weeks)
    const cohorts: RetentionCohort[] = [];
    const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
    
    for (let w = 0; w < 4; w++) {
        const cohortStart = new Date(now.getTime() - (w + 1) * MS_PER_WEEK);
        const cohortEnd = new Date(now.getTime() - w * MS_PER_WEEK);
        const cohortName = `Week -${w + 1}`;

        // Users registered in this cohort
        const cohortUsers = users.filter((u: any) => {
            const date = new Date(u.createdAt);
            return date >= cohortStart && date < cohortEnd;
        });

        if (cohortUsers.length === 0) {
            cohorts.push({ cohortName, registered: 0, active: 0, rate: 0 });
            continue;
        }

        const cohortUserIds = new Set(cohortUsers.map((u: any) => u.id));

        // Attempts by these users
        const activeCohortUsers = attempts.filter((a: any) => cohortUserIds.has(a.userId));
        const activeCount = new Set(activeCohortUsers.map((a: any) => a.userId)).size;

        cohorts.push({
            cohortName,
            registered: cohortUsers.length,
            active: activeCount,
            rate: Math.round((activeCount / cohortUsers.length) * 100),
        });
    }

    // ============================================
    // 4. Prize breakdown & redemptions
    // ============================================
    const redemptionsMap = new Map<string, number>();
    redemptions.forEach((r: any) => {
        redemptionsMap.set(r.status, (redemptionsMap.get(r.status) || 0) + 1);
    });

    const redemptionsByStatus = Array.from(redemptionsMap.entries()).map(([status, count]) => ({
        status,
        count,
    }));

    const stockMap = new Map<string, number>();
    prizes.forEach((p: any) => {
        const cat = p.category || 'General';
        stockMap.set(cat, (stockMap.get(cat) || 0) + (p.stock || 0));
    });

    const stockByCategory = Array.from(stockMap.entries()).map(([category, stock]) => ({
        category,
        stock,
    }));

    // Calculate total claimed prize values (from approved redemptions)
    const prizeValues = new Map<string, number>();
    prizes.forEach((p: any) => prizeValues.set(p.id, p.value || 0));

    const totalClaimedValue = redemptions
        .filter((r: any) => r.status === 'approved')
        .reduce((sum: number, r: any) => sum + (prizeValues.get(r.prizeId) || 0), 0);

    return {
        revenue,
        funnel,
        retention: {
            dau,
            wau,
            mau,
            stickiness,
            cohorts,
        },
        prizes: {
            redemptionsByStatus,
            stockByCategory,
            totalClaimedValue,
        },
    };
}
