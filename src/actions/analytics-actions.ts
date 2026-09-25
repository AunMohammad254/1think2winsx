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

    // Aggregation runs server-side in get_admin_analytics() (same pattern as
    // get_leaderboard()): pulling raw QuizAttempt/User rows here and reducing
    // them in JS used to silently truncate at PostgREST's db-max-rows (1000),
    // making every number on this page wrong past that many rows in a 30-day
    // window - see supabase/migrations/20260926090000_fix_admin_analytics_row_cap.sql.
    const adminDb = getAdminDb();
    const { data, error } = await adminDb.rpc('get_admin_analytics');
    if (error || !data) {
        throw new Error(error?.message || 'Failed to load analytics data');
    }

    return data as unknown as AnalyticsData;
}
