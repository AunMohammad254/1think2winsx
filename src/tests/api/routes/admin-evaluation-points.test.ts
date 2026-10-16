// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, authOk, argOf, eqValue, hasOp, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();
const createBatchForUsers = vi.fn();

vi.mock('@/lib/supabase/db', async () => {
  const shared = await vi.importActual<typeof import('@/lib/supabase/db-modules/shared')>('@/lib/supabase/db-modules/shared');
  return {
    getAdminDb: () => adminDb.client,
    fetchAllByKeyset: shared.fetchAllByKeyset,
    notificationDb: { createBatchForUsers: (...a: unknown[]) => createBatchForUsers(...a) },
    quizDb: {}, userDb: {}, quizAttemptDb: {},
  };
});
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { admin: 'admin' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/logger', () => ({ default: { log: vi.fn() } }));
vi.mock('@/lib/transaction-manager', () => ({ executeCriticalTransaction: async (op: () => Promise<unknown>) => op() }));

const evaluation = await import('@/app/api/admin/quiz-evaluation/route');
let points: typeof import('@/app/api/admin/points-allocation/route');

beforeEach(async () => {
  adminDb = createSupabaseMock();
  for (const fn of [requireAuth, requireCSRFToken, applyRateLimit, recordSecurityEvent, createBatchForUsers]) fn.mockReset();
  requireAuth.mockResolvedValue(authOk('admin-1'));
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  createBatchForUsers.mockResolvedValue(undefined);
  vi.resetModules();
  points = await import('@/app/api/admin/points-allocation/route'); // fresh history cache per test
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const guards = async (call: () => Promise<Response>, csrf: boolean) => {
  if (csrf) {
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await call()).status).toBe(403);
  }
  requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
  expect((await call()).status).toBe(401);
  applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
  expect((await call()).status).toBe(429);
  expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), 'admin-1', expect.objectContaining({ rateLimiter: 'admin' }));
};

describe('POST /api/admin/quiz-evaluation', () => {
  const post = (body: unknown) => evaluation.POST(makeRequest('/api/admin/quiz-evaluation', { body }));
  const setup = () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'Cricket night' } });
    adminDb.setTable('Question', { data: [{ id: 'q1' }, { id: 'q2' }] });
    adminDb.setRpc('evaluate_question', { data: { success: true } });
    adminDb.setRpc('finalize_quiz_scores', { data: { success: true, evaluatedAttempts: 3, totalQuestions: 2 } });
    adminDb.setTable('QuizAttempt', (call) => {
      if (call.ops.find((o) => o.op === 'order')?.args[0] === 'score') return { data: [{ userId: 'u1', score: 100, User: [{ email: 'a@x' }] }, { userId: 'u2', score: 50, User: null }] };
      if (call.ops.some((o) => o.op === 'gt')) return { data: [] };
      return { data: [{ id: 'a1', userId: 'u1' }, { id: 'a2', userId: 'u2' }, { id: 'a3', userId: 'u1' }] };
    });
  };

  it('grades each question in the database, finalises scores and tells each player once', async () => {
    setup();
    const body = await (await post({ quizId: 'quiz-1', correctAnswers: { q1: 1, q2: 0, stray: 3 } })).json();

    expect(adminDb.rpcCalls).toEqual([
      { fn: 'evaluate_question', args: { p_question_id: 'q1', p_correct_option: 1 } },
      { fn: 'evaluate_question', args: { p_question_id: 'q2', p_correct_option: 0 } },
      { fn: 'finalize_quiz_scores', args: { p_quiz_id: 'quiz-1' } },
    ]);
    expect(createBatchForUsers).toHaveBeenCalledWith(['u1', 'u2'], expect.objectContaining({ title: '🏅 Quiz Results Available!', link: '/quiz/quiz-1/results' }));
    expect(body).toEqual({
      success: true,
      message: 'Quiz evaluated successfully',
      evaluatedAttempts: 3,
      results: [
        { userId: 'u1', userEmail: 'a@x', percentage: 100, totalQuestions: 2 },
        { userId: 'u2', percentage: 50, totalQuestions: 2 },
      ],
    });
  });

  it('requires an answer for every question', async () => {
    setup();
    const res = await post({ quizId: 'quiz-1', correctAnswers: { q1: 1 } });
    expect(res.status).toBe(400);
    expect((await res.json()).missingQuestions).toEqual(['q2']);
    expect(adminDb.rpcCalls).toHaveLength(0);
  });

  it('stops at the first failed grading or a failed finalise', async () => {
    setup();
    adminDb.setRpc('evaluate_question', { data: { success: false } });
    let res = await post({ quizId: 'quiz-1', correctAnswers: { q1: 1, q2: 0 } });
    expect(await res.json()).toEqual({ message: 'Failed to evaluate question', questionId: 'q1' });
    adminDb.setRpc('evaluate_question', { error: { message: 'x' } });
    expect((await post({ quizId: 'quiz-1', correctAnswers: { q1: 1, q2: 0 } })).status).toBe(500);

    adminDb.setRpc('evaluate_question', { data: { success: true } });
    adminDb.setRpc('finalize_quiz_scores', { data: null });
    res = await post({ quizId: 'quiz-1', correctAnswers: { q1: 1, q2: 0 } });
    expect(await res.json()).toEqual({ message: 'Failed to finalize quiz scores' });
    adminDb.setRpc('finalize_quiz_scores', { error: { message: 'x' } });
    expect((await post({ quizId: 'quiz-1', correctAnswers: { q1: 1, q2: 0 } })).status).toBe(500);
  });

  it('still succeeds when notifying fails, or when nobody attempted', async () => {
    setup();
    createBatchForUsers.mockRejectedValue(new Error('push down'));
    expect((await post({ quizId: 'quiz-1', correctAnswers: { q1: 1, q2: 0 } })).status).toBe(200);
    expect(console.error).toHaveBeenCalledWith('[QUIZ_EVALUATION] Failed to send evaluation notifications:', expect.any(Error));

    createBatchForUsers.mockClear();
    adminDb.setTable('QuizAttempt', { data: [] });
    const body = await (await post({ quizId: 'quiz-1', correctAnswers: { q1: 1, q2: 0 } })).json();
    expect(createBatchForUsers).not.toHaveBeenCalled();
    expect(body.results).toEqual([]);
    adminDb.setTable('QuizAttempt', { data: null });
    expect((await post({ quizId: 'quiz-1', correctAnswers: { q1: 1, q2: 0 } })).status).toBe(200);
  });

  it('validates, 404s, guards and reports errors', async () => {
    expect((await post({ quizId: '', correctAnswers: {} })).status).toBe(400);
    expect((await post({ quizId: 'q', correctAnswers: { a: 12 } })).status).toBe(400);
    adminDb.setTable('Quiz', { data: null });
    expect((await post({ quizId: 'nope', correctAnswers: {} })).status).toBe(404);
    adminDb.setTable('Quiz', { data: { id: 'quiz-1' } });
    adminDb.setTable('Question', { data: null });
    adminDb.setRpc('finalize_quiz_scores', { data: { success: true } });
    expect((await post({ quizId: 'quiz-1', correctAnswers: {} })).status).toBe(200);
    await guards(() => post({ quizId: 'q', correctAnswers: {} }), true);
    requireAuth.mockRejectedValueOnce(new Error('x'));
    expect((await post({ quizId: 'q', correctAnswers: {} })).status).toBe(500);
  });
});

describe('GET /api/admin/quiz-evaluation', () => {
  const get = (qs = '?quizId=quiz-1') => evaluation.GET(makeRequest(`/api/admin/quiz-evaluation${qs}`));

  it('reports how far evaluation has got', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T', prizeId: 'p1' } });
    adminDb.setTable('Question', { data: [{ id: 'q1', hasCorrectAnswer: true }, { id: 'q2', hasCorrectAnswer: false }] });
    adminDb.setTable('QuizAttempt', { data: [{ id: 'a1', isEvaluated: true, User: [{ name: 'A' }] }, { id: 'a2', isEvaluated: false, User: { name: 'B' } }] });
    const body = await (await get()).json();
    expect(body.quiz).toEqual({ id: 'quiz-1', title: 'T', prizeId: 'p1', totalQuestions: 2, questionsWithAnswers: 1 });
    expect(body.evaluation).toEqual({ totalAttempts: 2, evaluatedAttempts: 1, pendingAttempts: 1, isFullyEvaluated: false });
    expect(body.attempts.map((a: { user: { name: string } }) => a.user.name)).toEqual(['A', 'B']);
  });

  it('is fully evaluated when every attempt is graded and every question answered', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1' } });
    adminDb.setTable('Question', { data: null });
    adminDb.setTable('QuizAttempt', { data: null });
    expect((await (await get()).json()).evaluation).toEqual({ totalAttempts: 0, evaluatedAttempts: 0, pendingAttempts: 0, isFullyEvaluated: true });
    adminDb.setTable('Question', { data: [{ id: 'q1', hasCorrectAnswer: true }] });
    adminDb.setTable('QuizAttempt', { data: [{ id: 'a1', isEvaluated: true }] });
    expect((await (await get()).json()).evaluation.isFullyEvaluated).toBe(true);
  });

  it('needs a quiz id, 404s, guards and reports errors', async () => {
    expect((await get('')).status).toBe(400);
    adminDb.setTable('Quiz', { data: null, error: { code: 'PGRST116' } });
    expect((await get()).status).toBe(404);
    await guards(() => get(), false);
    requireAuth.mockRejectedValueOnce(new Error('x'));
    expect((await get()).status).toBe(500);
  });
});

describe('POST /api/admin/points-allocation', () => {
  const post = (body: unknown) => points.POST(makeRequest('/api/admin/points-allocation', { body }));
  const attempts = (scores: number[]) => scores.map((score, i) => ({ id: `a${i}`, userId: `u${i}`, score, User: i % 2 ? { email: `u${i}@x`, name: null } : [{ email: `u${i}@x`, name: `U${i}` }] }));

  it('gives points to the top percentage, skipping zero scores', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T' } });
    adminDb.setTable('QuizAttempt', (call) => (hasOp(call, 'update') ? { data: null } : { data: attempts([90, 80, 0, 0, 10, 5, 4, 3, 2, 1]) }));
    adminDb.setTable('User', (call) => (hasOp(call, 'update') ? { data: null } : { data: { points: eqValue(call, 'id') === 'u0' ? 100 : null } }));

    const body = await (await post({ quizId: 'quiz-1', pointsPerWinner: 25, percentageThreshold: 30 })).json();

    expect(body.allocation).toEqual({ totalAttempts: 10, topPercentageCount: 3, eligibleWinners: 2, pointsPerWinner: 25, totalPointsDistributed: 50, percentageThreshold: 30 });
    expect(body.winners).toEqual([
      { userId: 'u0', userEmail: 'u0@x', userName: 'U0', score: 90, pointsAwarded: 25, newTotalPoints: 125 },
      { userId: 'u1', userEmail: 'u1@x', userName: null, score: 80, pointsAwarded: 25, newTotalPoints: 25 },
    ]);
    // read-then-write of User.points instead of the atomic increment_user_points RPC
    expect(argOf(adminDb.callsTo('User', 'update')[0], 'update')).toMatchObject({ points: 125 });
    expect(adminDb.rpcCalls).toHaveLength(0);
  });

  it('awards AGAIN when run twice for the same quiz (no idempotency guard)', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T' } });
    adminDb.setTable('QuizAttempt', (call) => (hasOp(call, 'update') ? { data: null } : { data: attempts([90]) }));
    let stored = 0;
    adminDb.setTable('User', (call) => {
      if (hasOp(call, 'update')) {
        stored = (argOf(call, 'update') as { points: number }).points;
        return { data: null };
      }
      return { data: { points: stored } };
    });
    await post({ quizId: 'quiz-1', pointsPerWinner: 10 });
    await post({ quizId: 'quiz-1', pointsPerWinner: 10 });
    expect(stored).toBe(20);
  });

  it('awards at least one winner, and refuses when nobody qualifies', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1' } });
    adminDb.setTable('QuizAttempt', (call) => (hasOp(call, 'update') ? { data: null } : { data: attempts([5, 4, 3]) }));
    adminDb.setTable('User', { data: { points: 0 } });
    expect((await (await post({ quizId: 'quiz-1', percentageThreshold: 0.01 })).json()).allocation.topPercentageCount).toBe(1);

    adminDb.setTable('QuizAttempt', { data: attempts([0, 0]) });
    expect((await (await post({ quizId: 'quiz-1' })).json()).message).toBe('No eligible winners found (all top performers scored 0)');
    adminDb.setTable('QuizAttempt', { data: [] });
    expect((await (await post({ quizId: 'quiz-1' })).json()).message).toBe('No evaluated quiz attempts found for this quiz');
    adminDb.setTable('QuizAttempt', { data: null });
    expect((await post({ quizId: 'quiz-1' })).status).toBe(400);
  });

  it('validates, 404s, guards and reports errors', async () => {
    expect((await post({ quizId: 'q', pointsPerWinner: 5000 })).status).toBe(400);
    adminDb.setTable('Quiz', { data: null });
    expect((await post({ quizId: 'q' })).status).toBe(404);
    await guards(() => post({ quizId: 'q' }), true);
    requireAuth.mockRejectedValueOnce(new Error('x'));
    expect((await post({ quizId: 'q' })).status).toBe(500);
  });
});

describe('GET /api/admin/points-allocation', () => {
  const get = (qs = '') => points.GET(makeRequest(`/api/admin/points-allocation${qs}`));

  it('lists past awards and caches each page for three minutes', async () => {
    adminDb.setTable('QuizAttempt', { data: [{ id: 'a1', userId: 'u1', quizId: 'q', score: 90, points: 25, updatedAt: 'w', User: [{ id: 'u1', name: 'Ali', email: 'a@x' }], Quiz: { id: 'q', title: 'T' } }, { id: 'a2', User: null, Quiz: [] }], count: 45 });

    const body = await (await get('?quizId=q&page=2&limit=20')).json();

    expect(body.attempts[0]).toEqual({ id: 'a1', userId: 'u1', quizId: 'q', score: 90, pointsAwarded: 25, completedAt: 'w', user: { id: 'u1', username: 'Ali', email: 'a@x' }, quiz: { id: 'q', title: 'T' } });
    expect(body.attempts[1]).toMatchObject({ user: { id: '', username: '', email: '' }, quiz: { id: '', title: '' } });
    expect(body.pagination).toEqual({ page: 2, limit: 20, totalCount: 45, totalPages: 3, hasNext: true, hasPrev: true });
    expect(eqValue(adminDb.callsTo('QuizAttempt')[0], 'quizId')).toBe('q');

    await get('?quizId=q&page=2&limit=20');
    expect(adminDb.callsTo('QuizAttempt')).toHaveLength(1);
  });

  it('expires and prunes cached pages', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    adminDb.setTable('QuizAttempt', { data: null, count: null });
    for (let p = 1; p <= 51; p++) await get(`?page=${p}`);
    clock.mockReturnValue(now + 3 * 60_000 + 1);
    await get('?page=1');
    await get('?page=52');
    expect(adminDb.callsTo('QuizAttempt')).toHaveLength(53);
    clock.mockRestore();
  });

  it('caps the page size, guards and reports errors', async () => {
    adminDb.setTable('QuizAttempt', { data: [], count: 0 });
    expect((await (await get('?limit=999')).json()).pagination.limit).toBe(100);
    await guards(() => get('?x=1'), false);
    adminDb.setTable('QuizAttempt', { error: { message: 'x' } });
    expect((await get('?fresh=1&page=9')).status).toBe(500);
  });
});
