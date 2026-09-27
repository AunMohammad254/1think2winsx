'use server';

import { getAdminDb } from '@/lib/supabase/db';
import { requireAdminSession } from '@/lib/admin-session';
import { unstable_cache } from 'next/cache';

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
    liveQuizEngagement: {
        totalLiveQuizzes: number;
        totalLiveAttempts: number;
        avgAttemptsPerLiveQuiz: number;
    };
    scoreDistribution: {
        range: string;
        count: number;
    }[];
    notificationEfficacy: {
        totalSent: number;
        totalRead: number;
        ctr: number;
    };
};

const fetchCachedAnalytics = unstable_cache(
    async () => {
        // Aggregation runs server-side in get_admin_analytics()
        const adminDb = getAdminDb();
        const { data, error } = await adminDb.rpc('get_admin_analytics');
        if (error || !data) {
            throw new Error(error?.message || 'Failed to load analytics data');
        }

        const typedData = data as any;

        // 1. Live Quiz Engagement
        const { data: liveQuizzes } = await adminDb.from('Quiz').select('id').not('pushedAt', 'is', null).limit(100);
        const liveQuizIds = liveQuizzes?.map(q => q.id) || [];
        let totalLiveAttempts = 0;
        if (liveQuizIds.length > 0) {
            const { count } = await adminDb.from('QuizAttempt').select('*', { count: 'exact', head: true }).in('quizId', liveQuizIds);
            totalLiveAttempts = count || 0;
        }
        typedData.liveQuizEngagement = {
            totalLiveQuizzes: liveQuizIds.length,
            totalLiveAttempts: totalLiveAttempts,
            avgAttemptsPerLiveQuiz: liveQuizIds.length > 0 ? Math.round(totalLiveAttempts / liveQuizIds.length) : 0,
        };

        // 2. Score Distribution (limited to recent 1000 for snapshot to avoid unbounded memory)
        const { data: scores } = await adminDb.from('QuizAttempt').select('score').not('score', 'is', null).limit(1000);
        const dist = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };
        (scores || []).forEach(s => {
            const score = s.score || 0;
            if (score <= 20) dist['0-20']++;
            else if (score <= 40) dist['21-40']++;
            else if (score <= 60) dist['41-60']++;
            else if (score <= 80) dist['61-80']++;
            else dist['81-100']++;
        });
        typedData.scoreDistribution = Object.entries(dist).map(([range, count]) => ({ range, count }));

        // 3. Notification Efficacy (limited to recent 1000 to save memory)
        const { data: notifications } = await adminDb.from('Notification').select('read').eq('type', 'quiz_results').limit(1000);
        const notifs = notifications || [];
        const totalSent = notifs.length;
        const totalRead = notifs.filter(n => n.read).length;
        typedData.notificationEfficacy = {
            totalSent,
            totalRead,
            ctr: totalSent > 0 ? Math.round((totalRead / totalSent) * 100) : 0,
        };

        return typedData as AnalyticsData;
    },
    ['admin_analytics_data'],
    {
        revalidate: 300, // Cache for 5 minutes to prevent excessive DB hits
        tags: ['admin_analytics_data']
    }
);

export async function getAnalyticsData(): Promise<AnalyticsData> {
    // 1. Ensure caller is authenticated admin
    await requireAdminSession();

    // 2. Return cached DB results
    return fetchCachedAnalytics();
}
