// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const requireAdminSession = vi.fn();
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));
vi.mock('@/lib/admin-session', () => ({ requireAdminSession: (...a: unknown[]) => requireAdminSession(...a) }));

const { getFraudAlerts } = await import('@/actions/security-actions');

const at = (iso: string, plusSeconds = 0) => new Date(new Date(iso).getTime() + plusSeconds * 1000).toISOString();
const T = '2026-10-15T10:00:00.000Z';

beforeEach(() => {
  adminDb = createSupabaseMock({
    tables: {
      User: { data: [{ id: 'u1', name: 'Ali', email: 'ali@example.test' }, { id: 'u2', name: 'Sara', email: 'sara@example.test' }, { id: 'u3', name: null, email: 'c@example.test' }] },
      Quiz: { data: [{ id: 'qz', title: 'Cricket night' }] },
      Prize: { data: [{ id: 'p1', name: 'Watch' }] },
      Question: { data: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, quizId: 'qz' })) },
    },
  });
  requireAdminSession.mockReset().mockResolvedValue('admin@example.test');
});

describe('getFraudAlerts', () => {
  it('requires an admin session before reading anything', async () => {
    requireAdminSession.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(getFraudAlerts()).rejects.toThrow('NEXT_REDIRECT');
    expect(adminDb.calls).toHaveLength(0);
  });

  it('flags quizzes answered faster than 1.5 s per question, CRITICAL under 0.8 s', async () => {
    adminDb.setTable('QuizAttempt', {
      data: [
        { id: 'a-crit', userId: 'u1', quizId: 'qz', score: 100, createdAt: T, completedAt: at(T, 5) }, // 0.5 s/q
        { id: 'a-high', userId: 'ghost', quizId: 'qz', score: 90, createdAt: T, completedAt: at(T, 12) }, // 1.2 s/q
        { id: 'a-ok', userId: 'u2', quizId: 'qz', score: 50, createdAt: T, completedAt: at(T, 60) },
        { id: 'a-open', userId: 'u2', quizId: 'qz', createdAt: T, completedAt: null },
        { id: 'a-default-count', userId: 'u2', quizId: 'unknown-quiz', createdAt: T, completedAt: at(T, 5) }, // 5 questions assumed: 1 s/q
      ],
    });

    const alerts = await getFraudAlerts();
    const fast = alerts.filter((a) => a.type === 'FAST_ATTEMPT');

    expect(fast.map((a) => [a.id, a.severity])).toEqual([['fast-a-crit', 'CRITICAL'], ['fast-a-high', 'HIGH'], ['fast-a-default-count', 'HIGH']]);
    expect(fast[0]).toMatchObject({ userId: 'u1', details: { quizTitle: 'Cricket night', questionsCount: 10, userName: 'Ali', score: 100 } });
    expect(fast[1].details).toMatchObject({ userName: 'Unknown User', userEmail: '' });
    expect(fast[2].details).toMatchObject({ quizTitle: 'Unknown Quiz', questionsCount: 5 });
    expect(eqValue(adminDb.callsTo('QuizAttempt')[0], 'isCompleted')).toBe(true);
  });

  it('flags several accounts on one IP, ignoring local and unknown addresses', async () => {
    adminDb.setTable('SecurityEvent', {
      data: [
        { userId: 'u1', ip: '5.5.5.5' }, { userId: 'u2', ip: '5.5.5.5' }, { userId: 'u3', ip: '5.5.5.5' }, { userId: 'u1', ip: '5.5.5.5' },
        { userId: 'u1', ip: '2001:db8::1' }, { userId: 'stranger', ip: '2001:db8::1' },
        { userId: 'u1', ip: '127.0.0.1' }, { userId: 'u2', ip: '127.0.0.1' },
        { userId: 'u1', ip: 'unknown' }, { userId: 'u2', ip: 'unknown' },
        { userId: 'u1', ip: '9.9.9.9' },
        { userId: null, ip: '6.6.6.6' }, { userId: 'u1', ip: null },
      ],
    });

    const multi = (await getFraudAlerts()).filter((a) => a.type === 'MULTI_ACCOUNT');

    expect(multi.map((a) => [a.id, a.severity, a.details.accountsCount])).toEqual([
      ['ip-5-5-5-5', 'HIGH', 3],
      ['ip-2001-db8--1', 'MEDIUM', 2],
    ]);
    expect(multi[1].details.accounts).toEqual([{ id: 'u1', name: 'Ali', email: 'ali@example.test' }, { id: 'stranger', name: 'Unknown', email: '' }]);
  });

  it('flags more than two redemptions by one player in a day', async () => {
    adminDb.setTable('PrizeRedemption', {
      data: [
        { id: 'r1', userId: 'u1', prizeId: 'p1', status: 'pending', requestedAt: T },
        { id: 'r2', userId: 'u1', prizeId: 'gone', status: 'pending', requestedAt: T },
        { id: 'r3', userId: 'u1', prizeId: 'p1', status: 'approved', requestedAt: T },
        { id: 'r4', userId: 'u2', prizeId: 'p1', status: 'pending', requestedAt: T },
        { id: 'r5', userId: 'ghost', prizeId: 'p1', requestedAt: T }, { id: 'r6', userId: 'ghost', prizeId: 'p1', requestedAt: T }, { id: 'r7', userId: 'ghost', prizeId: 'p1', requestedAt: T },
        { id: 'r8', userId: null, prizeId: 'p1' },
      ],
    });

    const bulk = (await getFraudAlerts()).filter((a) => a.type === 'BULK_REDEMPTION');

    expect(bulk.map((a) => a.id)).toEqual(['bulk-u1', 'bulk-ghost']);
    expect(bulk[0].details).toMatchObject({ userName: 'Ali', redemptionsCount: 3 });
    expect(bulk[0].details.redemptions[1]).toEqual({ id: 'r2', prizeName: 'Unknown Prize', status: 'pending', requestedAt: T });
    expect(bulk[1].details.userName).toBe('Unknown User');
  });

  it('sorts by severity, then newest first, and copes with empty tables', async () => {
    adminDb.setTable('QuizAttempt', {
      data: [
        { id: 'old-high', userId: 'u1', quizId: 'qz', createdAt: '2026-10-14T00:00:00.000Z', completedAt: '2026-10-14T00:00:12.000Z' },
        { id: 'new-high', userId: 'u1', quizId: 'qz', createdAt: T, completedAt: at(T, 12) },
        { id: 'crit', userId: 'u1', quizId: 'qz', createdAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-01T00:00:01.000Z' },
      ],
    });
    adminDb.setTable('SecurityEvent', { data: [{ userId: 'u1', ip: '7.7.7.7' }, { userId: 'u2', ip: '7.7.7.7' }] });

    const alerts = await getFraudAlerts();
    expect(alerts.map((a) => a.id)).toEqual(['fast-crit', 'fast-new-high', 'fast-old-high', 'ip-7-7-7-7']);

    for (const t of ['User', 'Quiz', 'Prize', 'Question', 'QuizAttempt', 'SecurityEvent', 'PrizeRedemption']) adminDb.setTable(t, { data: null });
    expect(await getFraudAlerts()).toEqual([]);
  });
});
