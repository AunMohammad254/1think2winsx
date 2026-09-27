'use server';

import { getAdminDb } from '@/lib/supabase/db';
import { requireAdminSession } from '@/lib/admin-session';

export type FraudAlert = {
    id: string;
    type: 'FAST_ATTEMPT' | 'MULTI_ACCOUNT' | 'BULK_REDEMPTION';
    severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
    title: string;
    description: string;
    timestamp: string;
    userId?: string;
    details: Record<string, any>;
};

export async function getFraudAlerts(): Promise<FraudAlert[]> {
    // 1. Ensure caller is authenticated admin
    await requireAdminSession();

    const adminDb = getAdminDb();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // 2. Fetch primary datasets in parallel
    const [
        attemptsResult,
        eventsResult,
        redemptionsResult,
        questionsResult,
        usersResult,
        quizzesResult,
        prizesResult,
    ] = await Promise.all([
        adminDb.from('QuizAttempt').select('id, userId, quizId, score, createdAt, completedAt').eq('isCompleted', true).gte('createdAt', sevenDaysAgo),
        adminDb.from('SecurityEvent').select('userId, ip, timestamp').gte('timestamp', sevenDaysAgo),
        adminDb.from('PrizeRedemption').select('id, userId, prizeId, status, requestedAt, pointsUsed').gte('createdAt', oneDayAgo),
        adminDb.from('Question').select('id, quizId'),
        adminDb.from('User').select('id, name, email'),
        adminDb.from('Quiz').select('id, title'),
        adminDb.from('Prize').select('id, name'),
    ]);

    const attempts = attemptsResult.data || [];
    const events = eventsResult.data || [];
    const redemptions = redemptionsResult.data || [];
    const questions = questionsResult.data || [];
    const users = usersResult.data || [];
    const quizzes = quizzesResult.data || [];
    const prizes = prizesResult.data || [];

    // Maps for fast lookups
    const userMap = new Map<string, { name: string | null; email: string }>();
    users.forEach((u: any) => userMap.set(u.id, { name: u.name, email: u.email }));

    const quizMap = new Map<string, string>();
    quizzes.forEach((q: any) => quizMap.set(q.id, q.title));

    const prizeMap = new Map<string, string>();
    prizes.forEach((p: any) => prizeMap.set(p.id, p.name));

    const questionCountMap = new Map<string, number>();
    questions.forEach((q: any) => {
        questionCountMap.set(q.quizId, (questionCountMap.get(q.quizId) || 0) + 1);
    });

    const alerts: FraudAlert[] = [];

    // ============================================
    // Check 1: FAST_ATTEMPT (Bot Detection)
    // ============================================
    attempts.forEach((a: any) => {
        if (!a.completedAt || !a.createdAt) return;

        const durationMs = new Date(a.completedAt).getTime() - new Date(a.createdAt).getTime();
        const durationSec = durationMs / 1000;
        const qCount = questionCountMap.get(a.quizId) || 5;
        const secPerQuestion = durationSec / qCount;

        // Less than 1.5 seconds per question is highly suspicious
        if (secPerQuestion < 1.5) {
            const user = userMap.get(a.userId) || { name: 'Unknown User', email: '' };
            const quizTitle = quizMap.get(a.quizId) || 'Unknown Quiz';
            const severity = secPerQuestion < 0.8 ? 'CRITICAL' : 'HIGH';

            alerts.push({
                id: `fast-${a.id}`,
                type: 'FAST_ATTEMPT',
                severity,
                title: 'Suspiciously Fast Quiz Completion',
                description: `User completed quiz "${quizTitle}" in ${durationSec.toFixed(1)}s (${secPerQuestion.toFixed(2)}s/question).`,
                timestamp: a.completedAt,
                userId: a.userId,
                details: {
                    attemptId: a.id,
                    quizId: a.quizId,
                    quizTitle,
                    durationSeconds: durationSec,
                    questionsCount: qCount,
                    secondsPerQuestion: secPerQuestion,
                    score: a.score,
                    userName: user.name,
                    userEmail: user.email,
                },
            });
        }
    });

    // ============================================
    // Check 2: MULTI_ACCOUNT (Same IP, Multiple Users)
    // ============================================
    const ipUsersMap = new Map<string, Set<string>>();
    events.forEach((e: any) => {
        if (!e.ip || !e.userId) return;
        if (!ipUsersMap.has(e.ip)) {
            ipUsersMap.set(e.ip, new Set());
        }
        ipUsersMap.get(e.ip)!.add(e.userId);
    });

    ipUsersMap.forEach((userIds: Set<string>, ip: string) => {
        if (ip === 'unknown' || ip === 'anonymous' || ip === '::1' || ip === '127.0.0.1') return;

        if (userIds.size > 1) {
            const list = Array.from(userIds).map((uid: string) => {
                const u = userMap.get(uid) || { name: 'Unknown', email: '' };
                return { id: uid, name: u.name, email: u.email };
            });

            const severity = userIds.size >= 3 ? 'HIGH' : 'MEDIUM';

            alerts.push({
                id: `ip-${ip.replace(/[^a-zA-Z0-9]/g, '-')}`,
                type: 'MULTI_ACCOUNT',
                severity,
                title: 'Multi-Account Access from Same IP',
                description: `Detected ${userIds.size} unique user accounts accessing from IP address: ${ip}`,
                timestamp: new Date().toISOString(), // Current check time
                details: {
                    ip,
                    accountsCount: userIds.size,
                    accounts: list,
                },
            });
        }
    });

    // ============================================
    // Check 3: BULK_REDEMPTION (Unusual Prize Velocity)
    // ============================================
    const userRedemptionsMap = new Map<string, any[]>();
    redemptions.forEach((r: any) => {
        if (!r.userId) return;
        if (!userRedemptionsMap.has(r.userId)) {
            userRedemptionsMap.set(r.userId, []);
        }
        userRedemptionsMap.get(r.userId)!.push(r);
    });

    userRedemptionsMap.forEach((userRedemptions: any[], uid: string) => {
        if (userRedemptions.length > 2) {
            const user = userMap.get(uid) || { name: 'Unknown User', email: '' };
            const list = userRedemptions.map((ur: any) => ({
                id: ur.id,
                prizeName: prizeMap.get(ur.prizeId) || 'Unknown Prize',
                status: ur.status,
                requestedAt: ur.requestedAt,
            }));

            alerts.push({
                id: `bulk-${uid}`,
                type: 'BULK_REDEMPTION',
                severity: 'HIGH',
                title: 'Bulk Redemptions Requested',
                description: `User has requested ${userRedemptions.length} prize redemptions within the last 24 hours.`,
                timestamp: userRedemptions[0].requestedAt,
                userId: uid,
                details: {
                    userName: user.name,
                    userEmail: user.email,
                    redemptionsCount: userRedemptions.length,
                    redemptions: list,
                },
            });
        }
    });

    // Sort alerts by severity (CRITICAL -> HIGH -> MEDIUM) and timestamp descending
    const severityWeight = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };
    return alerts.sort((a, b) => {
        const wA = severityWeight[a.severity] || 0;
        const wB = severityWeight[b.severity] || 0;
        if (wA !== wB) return wB - wA;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
}
