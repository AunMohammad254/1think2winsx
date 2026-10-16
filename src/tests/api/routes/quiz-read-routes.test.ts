// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, routeParams, authOk, eqValue, argOf, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
let adminDb: SupabaseMock;
const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();
const requirePaymentAccess = vi.fn();
const getActiveQuizCatalog = vi.fn();
const getCatalogQuiz = vi.fn();
const isWalletEnabled = vi.fn();
const findFirstActive = vi.fn();
const quizCreate = vi.fn();
const findAttempt = vi.fn();
const findQuestionAttempts = vi.fn();
const cacheClear = vi.fn();
const fetchSpy = vi.fn();

vi.mock('@/lib/supabase/db', () => ({
  getDb: async () => db.client,
  getAdminDb: () => adminDb.client,
  quizDb: { create: (...a: unknown[]) => quizCreate(...a) },
  dailyPaymentDb: { findFirstActive: (...a: unknown[]) => findFirstActive(...a) },
  quizAttemptDb: { findByUserAndQuiz: (...a: unknown[]) => findAttempt(...a) },
  questionAttemptDb: { findByUserAndQuiz: (...a: unknown[]) => findQuestionAttempts(...a) },
  answerDb: {},
  questionDb: {},
}));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { general: 'general', admin: 'admin' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: { logPerformanceMetric: vi.fn() } }));
vi.mock('@/lib/payment-middleware', () => ({ requirePaymentAccess: (...a: unknown[]) => requirePaymentAccess(...a) }));
vi.mock('@/lib/quiz-catalog', () => ({
  getActiveQuizCatalog: (...a: unknown[]) => getActiveQuizCatalog(...a),
  getCatalogQuiz: (...a: unknown[]) => getCatalogQuiz(...a),
}));
vi.mock('@/lib/wallet/service', () => ({ isWalletEnabled: (...a: unknown[]) => isWalletEnabled(...a) }));
vi.mock('@/lib/quiz-cache', () => ({ quizListCache: { clear: (...a: unknown[]) => cacheClear(...a) } }));

const listRoute = await import('@/app/api/quizzes/route');
const detailRoute = await import('@/app/api/quizzes/[id]/route');
const resultsRoute = await import('@/app/api/quizzes/[id]/results/route');

const HOUR = 3_600_000;
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const catalogQuiz = (over: Record<string, unknown> = {}) => ({
  id: 'quiz-1',
  title: 'Cricket night',
  description: 'Predict the match',
  duration: 10,
  passingScore: 70,
  status: 'active',
  pushedAt: iso(-60_000),
  startsAt: null,
  totalAttempts: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  questions: [
    { id: 'q1', text: 'Who wins the toss?', options: '["A","B"]' },
    { id: 'q2', text: 'Top scorer?', options: '["C","D"]' },
  ],
  ...over,
});

beforeEach(() => {
  db = createSupabaseMock();
  adminDb = createSupabaseMock();
  for (const fn of [requireAuth, requireCSRFToken, applyRateLimit, recordSecurityEvent, requirePaymentAccess, getActiveQuizCatalog, getCatalogQuiz, isWalletEnabled, findFirstActive, quizCreate, findAttempt, findQuestionAttempts, cacheClear, fetchSpy]) fn.mockReset();
  requireAuth.mockResolvedValue(authOk('user-1'));
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  requirePaymentAccess.mockResolvedValue(null);
  isWalletEnabled.mockResolvedValue(true);
  findFirstActive.mockResolvedValue({ id: 'pay-1', expiresAt: iso(HOUR) });
  findAttempt.mockResolvedValue(null);
  findQuestionAttempts.mockResolvedValue([]);
  fetchSpy.mockResolvedValue(new Response('ok'));
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/quizzes', () => {
  const list = (headers: Record<string, string> = {}) => listRoute.GET(makeRequest('/api/quizzes', { headers }));

  it("lists the catalogue with the caller's access and per-quiz status", async () => {
    getActiveQuizCatalog.mockResolvedValue([
      catalogQuiz({ id: 'live' }),
      catalogQuiz({ id: 'done', pushedAt: iso(-HOUR) }),
      catalogQuiz({ id: 'paused', status: 'paused' }),
      catalogQuiz({ id: 'soon', status: 'upcoming', pushedAt: null, startsAt: iso(HOUR) }),
      catalogQuiz({ id: 'draft', pushedAt: null }),
    ]);
    db.setTable('QuizAttempt', { data: [{ quizId: 'done', completedAt: '2026-10-10T10:00:00.000Z' }] });
    db.setTable('QuestionAttempt', { data: [{ quizId: 'done', questionId: 'q1' }, { quizId: 'done', questionId: 'q2' }, { quizId: 'live', questionId: 'q1' }] });

    const res = await list();
    const body = await res.json();
    const byId = Object.fromEntries(body.quizzes.map((q: { id: string }) => [q.id, q]));

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ hasAccess: true, walletEnabled: true, accessError: null, paymentInfo: { id: 'pay-1' } });
    expect(body.paymentInfo.timeRemaining).toBeGreaterThan(3500);
    expect(byId.live).toMatchObject({ pushStatus: 'unanswered', isCompleted: false, questionCount: 2, questions: [], hasAccess: true });
    expect(byId.done).toMatchObject({ pushStatus: 'answered', isCompleted: true, hasNewQuestions: false, newQuestionsCount: 0, lastAttemptDate: '2026-10-10T10:00:00.000Z' });
    expect(byId.paused.pushStatus).toBe('time-up');
    expect(byId.soon).toMatchObject({ pushStatus: 'upcoming', pushedAt: null });
    expect(byId.soon.startsAt).not.toBeNull();
    expect(byId.draft).toMatchObject({ pushStatus: null, startsAt: null });
    // the attempts are looked up for this user only
    expect(eqValue(db.callsTo('QuizAttempt')[0], 'userId')).toBe('user-1');
    expect(res.headers.get('ETag')).toMatch(/^".+"$/);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('flags new questions added after the player completed the quiz', async () => {
    getActiveQuizCatalog.mockResolvedValue([catalogQuiz()]);
    db.setTable('QuizAttempt', { data: [{ quizId: 'quiz-1', completedAt: null }] });
    db.setTable('QuestionAttempt', { data: [{ quizId: 'quiz-1', questionId: 'q1' }] });

    const [quiz] = (await (await list()).json()).quizzes;
    expect(quiz).toMatchObject({ isCompleted: true, hasNewQuestions: true, newQuestionsCount: 1, lastAttemptDate: null });
  });

  it('denies access without an active payment while the wallet is on', async () => {
    getActiveQuizCatalog.mockResolvedValue([catalogQuiz()]);
    findFirstActive.mockResolvedValue({ id: 'pay-old', expiresAt: iso(-1000) });

    const body = await (await list()).json();
    expect(body).toMatchObject({ hasAccess: false, paymentInfo: null });
    expect(body.accessError).toMatch(/No active payment/);
  });

  it('treats a failed payment lookup as no payment', async () => {
    getActiveQuizCatalog.mockResolvedValue([catalogQuiz()]);
    findFirstActive.mockRejectedValue(new Error('db down'));
    expect((await (await list()).json()).hasAccess).toBe(false);
  });

  it('makes quizzes free for everyone when the wallet is disabled', async () => {
    getActiveQuizCatalog.mockResolvedValue([catalogQuiz()]);
    isWalletEnabled.mockResolvedValue(false);
    findFirstActive.mockResolvedValue(null);
    const body = await (await list()).json();
    expect(body).toMatchObject({ hasAccess: true, walletEnabled: false, paymentInfo: null });
  });

  it('skips the per-user queries when there are no quizzes', async () => {
    getActiveQuizCatalog.mockResolvedValue([]);
    const body = await (await list()).json();
    expect(body.quizzes).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it('answers 304 when the ETag matches', async () => {
    // paymentInfo.timeRemaining is part of the body, so the clock must not tick between calls
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    try {
      getActiveQuizCatalog.mockResolvedValue([catalogQuiz()]);
      const first = await list();
      const second = await list({ 'if-none-match': first.headers.get('ETag')! });
      expect(second.status).toBe(304);
      expect(second.headers.get('ETag')).toBe(first.headers.get('ETag'));
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes a paying player's ETag every second, because timeRemaining is in the body", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    try {
      getActiveQuizCatalog.mockResolvedValue([catalogQuiz()]);
      const first = await list();
      vi.setSystemTime(Date.now() + 1000);
      const second = await list({ 'if-none-match': first.headers.get('ETag')! });
      expect(second.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the auth and rate-limit responses unchanged', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await list()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await list()).status).toBe(429);
    expect(getActiveQuizCatalog).not.toHaveBeenCalled();
  });

  it('returns 500 when the catalogue fails', async () => {
    getActiveQuizCatalog.mockRejectedValue(new Error('cache miss storm'));
    const res = await list();
    expect(res.status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenCalledWith('QUIZ_LIST_ERROR', expect.anything(), undefined, { error: 'cache miss storm' });
    getActiveQuizCatalog.mockRejectedValue('weird');
    await list();
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('QUIZ_LIST_ERROR', expect.anything(), undefined, { error: 'Unknown error' });
  });
});

describe('GET /api/quizzes cron safety net', () => {
  // The module keeps the last kick time, so each case loads a fresh copy
  const freshList = async () => {
    vi.resetModules();
    return (await import('@/app/api/quizzes/route')).GET;
  };
  beforeEach(() => getActiveQuizCatalog.mockResolvedValue([]));

  it('kicks the scheduler at most once a minute, with the cron secret', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.test');
    vi.stubEnv('CRON_SECRET', 'cron-s3cret');
    const GET = await freshList();
    await GET(makeRequest('/api/quizzes'));
    await GET(makeRequest('/api/quizzes'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://site.example.test/api/cron/process-scheduled');
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer cron-s3cret' });
    vi.unstubAllEnvs();
  });

  it('never kicks without a site URL, or in production without a secret', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    await (await freshList())(makeRequest('/api/quizzes'));
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.test');
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    await (await freshList())(makeRequest('/api/quizzes'));
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('kicks without an auth header outside production when no secret is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.test');
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('NODE_ENV', 'development');
    fetchSpy.mockRejectedValue(new Error('offline'));
    await (await freshList())(makeRequest('/api/quizzes'));
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({});
    vi.unstubAllEnvs();
  });
});

describe('POST /api/quizzes (admin create)', () => {
  const create = (body: unknown) => listRoute.POST(makeRequest('/api/quizzes', { body }));

  it('creates the quiz with defaults and clears the list cache', async () => {
    quizCreate.mockResolvedValue({ id: 'new-quiz', title: 'Final', description: null, duration: 30, passingScore: 70, status: 'active', createdAt: 'c', updatedAt: 'u' });
    adminDb.setTable('Question', { count: 4 });
    adminDb.setTable('QuizAttempt', { count: null });

    const res = await create({ title: 'Final' });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(requireAuth).toHaveBeenCalledWith({ adminOnly: true, context: 'quiz_creation' });
    expect(quizCreate).toHaveBeenCalledWith({ title: 'Final', description: null, duration: 30, timeUpDuration: 60, passingScore: 70, status: 'active' });
    expect(body.quiz).toMatchObject({ id: 'new-quiz', questionCount: 4, totalAttempts: 0 });
    expect(cacheClear).toHaveBeenCalled();
    expect(recordSecurityEvent).toHaveBeenCalledWith('QUIZ_CREATED', expect.anything(), 'user-1', { quizId: 'new-quiz', title: 'Final' });
  });

  it('keeps a provided description', async () => {
    quizCreate.mockResolvedValue({ id: 'q', title: 't', description: 'd' });
    await create({ title: 't', description: 'd', duration: 5, timeUpDuration: 10, passingScore: 50 });
    expect(quizCreate).toHaveBeenCalledWith(expect.objectContaining({ description: 'd', duration: 5, timeUpDuration: 10, passingScore: 50 }));
  });

  it('rejects invalid quiz data', async () => {
    const res = await create({ title: '', duration: 999 });
    expect(res.status).toBe(400);
    expect(quizCreate).not.toHaveBeenCalled();
    expect(recordSecurityEvent).toHaveBeenCalledWith('INVALID_INPUT', expect.anything(), 'user-1', expect.objectContaining({ endpoint: '/api/quizzes' }));
  });

  it('stops at CSRF, auth and the admin rate limit', async () => {
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await create({ title: 'x' })).status).toBe(403);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await create({ title: 'x' })).status).toBe(403);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await create({ title: 'x' })).status).toBe(429);
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), 'user-1', { endpoint: '/api/quizzes', rateLimiter: 'admin' });
    expect(quizCreate).not.toHaveBeenCalled();
  });

  it('returns 500 when creation fails', async () => {
    quizCreate.mockRejectedValue(new Error('insert failed'));
    expect((await create({ title: 'x' })).status).toBe(500);
    quizCreate.mockRejectedValue(0);
    expect((await create({ title: 'x' })).status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('QUIZ_CREATION_ERROR', expect.anything(), undefined, { error: 'Unknown error' });
  });
});

describe('GET /api/quizzes/[id]', () => {
  const open = (id = 'quiz-1') => detailRoute.GET(makeRequest(`/api/quizzes/${id}`), routeParams({ id }));

  it('returns the questions, the server clock and the answering deadline', async () => {
    const pushedAt = iso(-60_000);
    getCatalogQuiz.mockResolvedValue(catalogQuiz({ pushedAt }));

    const res = await open();
    const { quiz } = await res.json();

    expect(res.status).toBe(200);
    expect(quiz).toMatchObject({ id: 'quiz-1', questionCount: 2, totalQuestions: 2, isReattempt: false, newQuestionsCount: 0, previousAttempt: null, pushedAt });
    expect(quiz.questions).toEqual([
      { id: 'q1', text: 'Who wins the toss?', options: '["A","B"]' },
      { id: 'q2', text: 'Top scorer?', options: '["C","D"]' },
    ]);
    expect(quiz.endsAt).toBe(new Date(new Date(pushedAt).getTime() + 10 * 60_000).toISOString());
    expect(Math.abs(quiz.serverNow - Date.now())).toBeLessThan(5000);
    expect(recordSecurityEvent).toHaveBeenCalledWith('QUIZ_ACCESSED', expect.anything(), 'user-1', { quizId: 'quiz-1', title: 'Cricket night' });
  });

  it('only serves the new questions on a re-attempt', async () => {
    getCatalogQuiz.mockResolvedValue(catalogQuiz());
    findAttempt.mockResolvedValue({ id: 'att-1', isCompleted: true, score: 50, points: 5, completedAt: 'then' });
    findQuestionAttempts.mockResolvedValue([{ questionId: 'q1' }]);

    const { quiz } = await (await open()).json();
    expect(quiz).toMatchObject({ isReattempt: true, newQuestionsCount: 1, questionCount: 1, totalQuestions: 2, previousAttempt: { id: 'att-1', score: 50, points: 5 } });
    expect(quiz.questions.map((q: { id: string }) => q.id)).toEqual(['q2']);
  });

  it('serves every question again to a player who started but never finished', async () => {
    getCatalogQuiz.mockResolvedValue(catalogQuiz());
    findAttempt.mockResolvedValue({ id: 'att-1', isCompleted: false });
    findQuestionAttempts.mockResolvedValue([{ questionId: 'q1' }, { questionId: 'q2' }]);
    const { quiz } = await (await open()).json();
    expect(quiz).toMatchObject({ isReattempt: false, questionCount: 2 });
  });

  it('refuses a quiz that is already fully answered', async () => {
    getCatalogQuiz.mockResolvedValue(catalogQuiz());
    findAttempt.mockResolvedValue({ id: 'att-1', isCompleted: true, score: 80, points: 8, completedAt: 'then' });
    findQuestionAttempts.mockResolvedValue([{ questionId: 'q1' }, { questionId: 'q2' }]);

    const res = await open();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ completed: true, totalQuestions: 2, attempt: { id: 'att-1', score: 80 } });
  });

  it("does not reveal an upcoming quiz's questions", async () => {
    const startsAt = iso(HOUR);
    getCatalogQuiz.mockResolvedValue(catalogQuiz({ status: 'upcoming', startsAt }));
    const res = await open();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This quiz hasn't started yet.", upcoming: true, startsAt });
  });

  it('returns 404 for a missing or inactive quiz', async () => {
    getCatalogQuiz.mockResolvedValue(undefined);
    expect((await open('ghost')).status).toBe(404);
    expect(recordSecurityEvent).toHaveBeenCalledWith('QUIZ_NOT_FOUND', expect.anything(), 'user-1', { quizId: 'ghost' });
  });

  it('enforces payment, auth and rate limits', async () => {
    getCatalogQuiz.mockResolvedValue(catalogQuiz());
    requirePaymentAccess.mockResolvedValueOnce(NextResponse.json({}, { status: 402 }));
    expect((await open()).status).toBe(402);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await open()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await open()).status).toBe(429);
  });

  it('returns 500 on unexpected errors', async () => {
    getCatalogQuiz.mockRejectedValue(new Error('down'));
    expect((await open()).status).toBe(500);
    getCatalogQuiz.mockRejectedValue(null);
    await open();
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('QUIZ_ACCESS_ERROR', expect.anything(), undefined, { error: 'Unknown error', quizId: 'quiz-1' });
  });
});

describe('GET /api/quizzes/[id]/results', () => {
  const results = () => resultsRoute.GET(makeRequest('/api/quizzes/quiz-1/results'), routeParams({ id: 'quiz-1' }));
  const attempt = (over: Record<string, unknown> = {}) => ({
    id: 'att-1', userId: 'user-1', quizId: 'quiz-1', score: 75, points: 12, isCompleted: true, isEvaluated: true, completedAt: 'done',
    Quiz: { id: 'quiz-1', title: 'Cricket night', passingScore: 70 },
    ...over,
  });

  it('returns answers, revealing correct options only for published questions', async () => {
    db.setTable('QuizAttempt', { data: attempt() });
    db.setTable('Answer', {
      data: [
        { questionId: 'q1', selectedOption: 0, isCorrect: true, Question: { id: 'q1', text: 'Toss?', options: '["A","B"]', hasCorrectAnswer: true } },
        { questionId: 'q2', selectedOption: 1, isCorrect: false, Question: [{ id: 'q2', text: 'Scorer?', options: '["C","D"]', hasCorrectAnswer: false }] },
        { questionId: 'q3', selectedOption: 2, isCorrect: false, Question: null },
      ],
    });
    adminDb.setTable('Question', { data: [{ id: 'q1', correctOption: 0 }] });

    const res = await results();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(argOf(adminDb.callsTo('Question')[0], 'in')).toBe('id');
    expect(adminDb.callsTo('Question')[0].ops.find((o) => o.op === 'in')?.args[1]).toEqual(['q1']);
    expect(body.results).toMatchObject({ attemptId: 'att-1', score: 75, points: 12, correctAnswers: 1, totalQuestions: 3, passed: true, isEvaluated: true });
    expect(body.results.answers).toEqual([
      { questionId: 'q1', questionText: 'Toss?', options: ['A', 'B'], selectedOption: 0, correctOption: 0, isCorrect: true },
      { questionId: 'q2', questionText: 'Scorer?', options: ['C', 'D'], selectedOption: 1, correctOption: null, isCorrect: false },
      { questionId: 'q3', questionText: '', options: [], selectedOption: 2, correctOption: null, isCorrect: false },
    ]);
    expect(eqValue(db.callsTo('QuizAttempt')[0], 'userId')).toBe('user-1');
  });

  it('marks a score below the pass mark as not passed and skips the answer key when nothing is revealed', async () => {
    db.setTable('QuizAttempt', { data: attempt({ score: 40, Quiz: [{ id: 'quiz-1', passingScore: 70 }] }) });
    db.setTable('Answer', { data: null });
    const body = await (await results()).json();
    expect(body.results).toMatchObject({ passed: false, totalQuestions: 0, correctAnswers: 0 });
    expect(adminDb.calls).toHaveLength(0);
  });

  it('shows no correct option when the answer-key lookup returns nothing', async () => {
    db.setTable('QuizAttempt', { data: attempt() });
    db.setTable('Answer', { data: [{ questionId: 'q1', selectedOption: 0, isCorrect: true, Question: { id: 'q1', text: 'Toss?', options: '["A","B"]', hasCorrectAnswer: true } }] });
    adminDb.setTable('Question', { data: null });
    const body = await (await results()).json();
    expect(body.results.answers[0]).toMatchObject({ questionId: 'q1', correctOption: null });
  });

  it('reports not passed when the quiz join is missing', async () => {
    db.setTable('QuizAttempt', { data: attempt({ Quiz: null }) });
    db.setTable('Answer', { data: [] });
    expect((await (await results()).json()).results.passed).toBe(false);
  });

  it('returns 404 when the player has not completed the quiz', async () => {
    db.setTable('QuizAttempt', { data: null, error: { code: 'PGRST116' } });
    expect((await results()).status).toBe(404);
  });

  it('returns 500 when a query fails', async () => {
    db.setTable('QuizAttempt', { error: { code: '500', message: 'db' } });
    expect((await results()).status).toBe(500);
    db.setTable('QuizAttempt', { data: attempt() });
    db.setTable('Answer', { error: { message: 'answers failed' } });
    expect((await results()).status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('QUIZ_RESULTS_ERROR', expect.anything(), undefined, { error: 'Unknown error', quizId: 'quiz-1' });
  });

  it('returns the auth and rate-limit responses unchanged', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await results()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await results()).status).toBe(429);
  });

  it('logs the message of a thrown Error', async () => {
    requireAuth.mockRejectedValueOnce(new Error('kaput'));
    expect((await results()).status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('QUIZ_RESULTS_ERROR', expect.anything(), undefined, { error: 'kaput', quizId: 'quiz-1' });
  });
});
