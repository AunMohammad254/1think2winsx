// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, routeParams, authOk, argOf, eqValue, hasOp, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
let ids = 0;
const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();
const clearQuizListCache = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client, generateId: () => `gen-${++ids}` }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { admin: 'admin' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/quiz-cache', () => ({ clearQuizListCache: () => clearQuizListCache() }));

const list = await import('@/app/api/admin/quizzes/route');
const one = await import('@/app/api/admin/quizzes/[id]/route');

const P = routeParams({ id: 'quiz-1' });
/** What the admin action log recorded (lib/admin-action-log writes through the mocked admin client). */
const logged = () => adminDb.callsTo('AdminActionLog', 'insert').map((c) => argOf(c, 'insert'));
const isHead = (call: { ops: { op: string; args: unknown[] }[] }) => call.ops.some((o) => o.op === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head);

beforeEach(() => {
  adminDb = createSupabaseMock();
  ids = 0;
  for (const fn of [requireAuth, requireCSRFToken, applyRateLimit, recordSecurityEvent, clearQuizListCache]) fn.mockReset();
  requireAuth.mockResolvedValue(authOk('admin-1'));
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/admin/quizzes', () => {
  const get = (qs = '') => list.GET(makeRequest(`/api/admin/quizzes${qs}`));

  it('lists quizzes with question and attempt stats from two batch queries', async () => {
    adminDb.setTable('Quiz', { data: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], count: 25 });
    adminDb.setTable('Question', { data: [{ id: 'q1', quizId: 'a', status: 'active', hasCorrectAnswer: true }, { id: 'q2', quizId: 'a', status: 'paused', hasCorrectAnswer: false }] });
    adminDb.setTable('QuizAttempt', { data: [{ quizId: 'a', isCompleted: true, score: 80 }, { quizId: 'a', isCompleted: true, score: 61 }, { quizId: 'a', isCompleted: false, score: 0 }] });

    const body = await (await get('?page=2&limit=10&status=active&search=cricket')).json();

    expect(body.quizzes[0].stats).toEqual({ totalQuestions: 2, activeQuestions: 1, questionsWithAnswers: 1, totalAttempts: 3, completedAttempts: 2, completionRate: 67, averageScore: 71 });
    expect(body.quizzes[1].stats).toMatchObject({ totalQuestions: 0, totalAttempts: 0, completionRate: 0, averageScore: 0 });
    expect(body.pagination).toEqual({ page: 2, limit: 10, totalCount: 25, totalPages: 3, hasNext: true, hasPrev: true });
    const q = adminDb.callsTo('Quiz')[0];
    expect(q.ops.find((o) => o.op === 'range')?.args).toEqual([10, 19]);
    expect(eqValue(q, 'status')).toBe('active');
    expect(argOf(q, 'or')).toBe('title.ilike.%cricket%,description.ilike.%cricket%');
  });

  it('caps the page size at 50 and skips batch queries for an empty page', async () => {
    adminDb.setTable('Quiz', { data: null, count: null });
    const body = await (await get('?limit=500')).json();
    expect(body.pagination).toEqual({ page: 1, limit: 50, totalCount: 0, totalPages: 0, hasNext: false, hasPrev: false });
    expect(adminDb.callsTo('Question')).toHaveLength(0);
  });

  it('tolerates missing batch results', async () => {
    adminDb.setTable('Quiz', { data: [{ id: 'a' }], count: 1 });
    adminDb.setTable('Question', { data: null });
    adminDb.setTable('QuizAttempt', { data: null });
    expect((await (await get()).json()).quizzes[0]._count).toEqual({ questions: 0, attempts: 0 });
  });

  it('guards and reports errors', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await get()).status).toBe(403);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await get()).status).toBe(429);
    adminDb.setTable('Quiz', { error: new Error('db') });
    expect((await get()).status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUIZ_LIST_ERROR', expect.anything(), undefined, { error: 'db' });
    adminDb.setTable('Quiz', { error: { message: 'plain' } });
    await get();
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUIZ_LIST_ERROR', expect.anything(), undefined, { error: 'Unknown error' });
  });
});

describe('POST /api/admin/quizzes', () => {
  const post = (body: unknown) => list.POST(makeRequest('/api/admin/quizzes', { body }));

  it('creates the quiz and its questions with the answer key', async () => {
    adminDb.setTable('Quiz', { data: { id: 'gen-1', title: 'Final', status: 'active' } });
    adminDb.setTable('Question', { data: [{ id: 'gen-2', status: 'active', hasCorrectAnswer: true }, { id: 'gen-3', status: 'paused', hasCorrectAnswer: true }] });

    const res = await post({ title: 'Final', startsAt: '2026-11-01T18:00', questions: [{ text: 'Q1', options: ['a', 'b'], correctAnswer: 1 }, { text: 'Q2', options: ['c', 'd'], correctAnswer: 0, isActive: false }] });
    const body = await res.json();

    expect(res.status).toBe(201);
    const quizInsert = argOf(adminDb.callsTo('Quiz')[0], 'insert') as Record<string, unknown>;
    expect(quizInsert).toMatchObject({ id: 'gen-1', title: 'Final', duration: 30, passingScore: 70, status: 'active' });
    expect(typeof quizInsert.startsAt).toBe('string');
    const questions = argOf(adminDb.callsTo('Question')[0], 'insert') as Record<string, unknown>[];
    // The key is stored, but the questions stay open: a saved result closes a question to answers
    expect(questions.map((q) => [q.quizId, q.options, q.correctOption, q.hasCorrectAnswer, q.status])).toEqual([['gen-1', '["a","b"]', 1, false, 'active'], ['gen-1', '["c","d"]', 0, false, 'paused']]);
    expect(body.quiz.stats).toMatchObject({ totalQuestions: 2, activeQuestions: 1, questionsWithAnswers: 2 });
    // Players see the new quiz now, not when the shared catalogue's cache runs out
    expect(clearQuizListCache).toHaveBeenCalledTimes(1);
    expect(logged()).toEqual([{
      quizId: 'gen-1', quizTitle: 'Final', action: 'quiz_created', adminEmail: 'player@example.test', details: { questions: 2 },
    }]);
  });

  it('uses the explicit status, or paused for an inactive quiz, and skips empty question lists', async () => {
    adminDb.setTable('Quiz', { data: { id: 'gen-1' } });
    await post({ title: 'T', status: 'draft' });
    expect(argOf(adminDb.callsTo('Quiz')[0], 'insert')).toMatchObject({ status: 'draft', startsAt: null });
    await post({ title: 'T', isActive: false });
    expect(argOf(adminDb.callsTo('Quiz')[1], 'insert')).toMatchObject({ status: 'paused' });
    expect(adminDb.callsTo('Question')).toHaveLength(0);
    adminDb.setTable('Question', { data: null });
    expect((await (await post({ title: 'T', questions: [{ text: 'q', options: ['a', 'b'], correctAnswer: 0 }] })).json()).quiz.questions).toEqual([]);
  });

  it('validates, guards and reports insert failures', async () => {
    expect((await post({ title: '' })).status).toBe(400);
    expect((await post({ title: 'T', questions: [{ text: 'q', options: ['only one'], correctAnswer: 0 }] })).status).toBe(400);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post({ title: 'T' })).status).toBe(403);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await post({ title: 'T' })).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await post({ title: 'T' })).status).toBe(429);
    adminDb.setTable('Quiz', { error: { message: 'x' } });
    expect((await post({ title: 'T' })).status).toBe(500);
    adminDb.setTable('Quiz', { data: { id: 'q' } });
    adminDb.setTable('Question', { error: new Error('questions failed') });
    expect((await post({ title: 'T', questions: [{ text: 'q', options: ['a', 'b'], correctAnswer: 0 }] })).status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUIZ_CREATION_ERROR', expect.anything(), undefined, { error: 'questions failed' });
  });
});

describe('GET /api/admin/quizzes/[id]', () => {
  const get = () => one.GET(makeRequest('/api/admin/quizzes/quiz-1'), P);

  it('returns the quiz with questions, recent attempts and stats', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T' } });
    adminDb.setTable('Question', (call) => (isHead(call) ? { count: 3 } : { data: [{ id: 'q', status: 'active', hasCorrectAnswer: true }, { id: 'r', status: 'paused' }] }));
    adminDb.setTable('QuizAttempt', (call) => {
      if (isHead(call)) return { count: eqValue(call, 'isCompleted') ? 3 : 4 };
      if (argOf(call, 'select') === 'score') return { data: [{ score: 50 }, { score: 100 }] };
      if (call.ops.find((o) => o.op === 'order')?.args[0] === 'score') return { data: [{ score: 100, completedAt: 'c', User: [{ name: 'Top' }] }] };
      return { data: [{ id: 'att', User: [{ name: 'A' }] }, { id: 'att2', User: { name: 'B' } }] };
    });

    const { quiz } = await (await get()).json();

    expect(quiz.recentAttempts.map((a: { user: { name: string } }) => a.user.name)).toEqual(['A', 'B']);
    expect(quiz.stats).toEqual({ totalQuestions: 3, activeQuestions: 1, questionsWithAnswers: 1, totalAttempts: 4, completedAttempts: 3, completionRate: 75, averageScore: 75, highestScore: { score: 100, user: { name: 'Top' }, completedAt: 'c' } });
    expect(recordSecurityEvent).toHaveBeenCalledWith('ADMIN_QUIZ_VIEWED', expect.anything(), 'admin-1', { quizId: 'quiz-1', title: 'T' });
  });

  it("gives the admin the quiz's entry limit and points pool, or the defaults when none are saved", async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T' } });
    adminDb.setTable('QuizAdminSettings', { data: [{ quizId: 'quiz-1', maxEntries: 750, pointsPool: 30_000 }] });
    expect((await (await get()).json()).quiz).toMatchObject({ maxEntries: 750, pointsPool: 30_000 });
    adminDb.setTable('QuizAdminSettings', { data: [] });
    expect((await (await get()).json()).quiz).toMatchObject({ maxEntries: 2000, pointsPool: 0 });
    // Before the migration there is no table, so nothing can have been saved
    adminDb.setTable('QuizAdminSettings', { error: { code: 'PGRST205', message: "Could not find the table 'public.QuizAdminSettings'" } });
    expect((await (await get()).json()).quiz).toMatchObject({ maxEntries: 2000, pointsPool: 0 });
  });

  it('fails rather than show the defaults when the settings cannot be read, so a save cannot overwrite them', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T' } });
    adminDb.setTable('QuizAdminSettings', { error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    expect((await get()).status).toBe(500);
  });

  it('treats a missing completed-attempt count as none', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T' } });
    adminDb.setTable('QuizAttempt', (call) => (isHead(call) ? { count: eqValue(call, 'isCompleted') ? null : 2 } : { data: [] }));
    const { quiz } = await (await get()).json();
    expect(quiz.stats).toMatchObject({ totalAttempts: 2, completedAttempts: 0, completionRate: 0 });
  });

  it('handles a quiz with no attempts and an object user join', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1' } });
    adminDb.setTable('QuizAttempt', (call) => (call.ops.find((o) => o.op === 'order')?.args[0] === 'score' ? { data: [{ score: 9, User: { name: 'Solo' } }] } : { data: null, count: null }));
    const { quiz } = await (await get()).json();
    expect(quiz).toMatchObject({ questions: [], recentAttempts: [], stats: { totalAttempts: 0, completionRate: 0, averageScore: 0, highestScore: { user: { name: 'Solo' } } } });
    adminDb.setTable('QuizAttempt', { data: [], count: 0 });
    expect((await (await get()).json()).quiz.stats.highestScore).toBeNull();
  });

  it('404s, guards and reports errors', async () => {
    adminDb.setTable('Quiz', { data: null, error: { code: 'PGRST116' } });
    expect((await get()).status).toBe(404);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await get()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await get()).status).toBe(429);
    requireAuth.mockRejectedValueOnce(new Error('boom'));
    expect((await get()).status).toBe(500);
    requireAuth.mockRejectedValueOnce('odd');
    await get();
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUIZ_DETAILS_ERROR', expect.anything(), undefined, { error: 'Unknown error', quizId: 'quiz-1' });
  });
});

describe('PATCH /api/admin/quizzes/[id]', () => {
  const patch = (body: unknown) => one.PATCH(makeRequest('/api/admin/quizzes/quiz-1', { method: 'PATCH', body }), P);

  it('updates only the sent fields and returns the quiz with counts', async () => {
    adminDb.setTable('Quiz', [{ data: { id: 'quiz-1' } }, { data: { id: 'quiz-1', title: 'New', status: 'paused' } }]);
    adminDb.setTable('Question', { data: [{ id: 'q' }] });
    adminDb.setTable('QuizAttempt', { count: 5 });

    const body = await (await patch({ title: 'New', status: 'paused' })).json();

    expect(argOf(adminDb.callsTo('Quiz', 'update')[0], 'update')).toMatchObject({ title: 'New', status: 'paused' });
    expect(body.quiz).toMatchObject({ title: 'New', stats: { totalQuestions: 1, totalAttempts: 5 } });
    // Pausing here used to leave players on the old state until the catalogue's cache ran out
    expect(clearQuizListCache).toHaveBeenCalledTimes(1);
    expect(logged()).toEqual([{
      quizId: 'quiz-1', quizTitle: 'New', action: 'quiz_status_changed', adminEmail: 'player@example.test',
      details: { changes: { title: 'New', status: 'paused' } },
    }]);
  });

  it('handles missing counts', async () => {
    adminDb.setTable('Quiz', [{ data: { id: 'quiz-1' } }, { data: { id: 'quiz-1' } }]);
    expect((await (await patch({ title: 'X' })).json()).quiz.stats).toEqual({ totalQuestions: 0, totalAttempts: 0 });
    // No status sent: an edit
    expect(logged()).toEqual([expect.objectContaining({ action: 'quiz_edited', details: { changes: { title: 'X' } } })]);
  });

  it('validates, 404s, guards and reports errors', async () => {
    expect((await patch({ passingScore: 101 })).status).toBe(400);
    adminDb.setTable('Quiz', { data: null });
    expect((await patch({ title: 'X' })).status).toBe(404);
    adminDb.setTable('Quiz', [{ data: { id: 'quiz-1' } }, { error: new Error('update failed') }]);
    expect((await patch({ title: 'X' })).status).toBe(500);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await patch({})).status).toBe(403);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await patch({})).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await patch({})).status).toBe(429);
    requireAuth.mockRejectedValueOnce('odd');
    await patch({});
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUIZ_UPDATE_ERROR', expect.anything(), undefined, { error: 'Unknown error', quizId: 'quiz-1' });
  });
});

describe('PUT /api/admin/quizzes/[id] (full edit)', () => {
  const put = (body: unknown) => one.PUT(makeRequest('/api/admin/quizzes/quiz-1', { method: 'PUT', body }), P);
  const question = (over: Record<string, unknown> = {}) => ({ text: 'Q', options: ['a', 'b'], correctAnswer: 1, ...over });

  beforeEach(() => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T' } });
    adminDb.setTable('Question', (call) => (hasOp(call, 'update') || hasOp(call, 'insert') || hasOp(call, 'delete') ? { data: null } : { data: [{ id: 'keep', text: 'Kept?', options: '["a","b"]' }, { id: 'drop', text: 'Dropped?', options: '["a","b"]' }] }));
    adminDb.setTable('QuizAttempt', { count: 2 });
  });

  it('updates, inserts and deletes questions nobody answered', async () => {
    const res = await put({ title: 'T', status: 'active', duration: 20, timeUpDuration: 30, passingScore: 60, questions: [question({ id: 'keep' }), question({ id: 'temp-1', isActive: false }), question()] });
    expect(res.status).toBe(200);

    expect(argOf(adminDb.callsTo('Quiz', 'update')[0], 'update')).toMatchObject({ title: 'T', status: 'active', duration: 20, timeUpDuration: 30, passingScore: 60 });
    expect(clearQuizListCache).toHaveBeenCalledTimes(1);
    expect(adminDb.callsTo('Answer')).toHaveLength(0);
    expect(adminDb.callsTo('Question', 'delete')[0].ops.find((o) => o.op === 'in')?.args).toEqual(['id', ['drop']]);
    expect(eqValue(adminDb.callsTo('Question', 'update')[0], 'id')).toBe('keep');
    const inserts = adminDb.callsTo('Question', 'insert').map((c) => argOf(c, 'insert') as Record<string, unknown>);
    expect(inserts.map((q) => [q.id, q.status, q.correctOption, q.hasCorrectAnswer])).toEqual([['gen-1', 'paused', 1, false], ['gen-2', 'active', 1, false]]);
    expect(argOf(adminDb.callsTo('Question', 'update')[0], 'update')).toMatchObject({ correctOption: 1, hasCorrectAnswer: false });
    // Options unchanged: not rewritten (the database refuses an options write to an answered question)
    expect(argOf(adminDb.callsTo('Question', 'update')[0], 'update')).not.toHaveProperty('options');
    expect((await res.json()).quiz.stats).toEqual({ totalQuestions: 2, totalAttempts: 2 });
    expect(logged()).toEqual([{
      quizId: 'quiz-1', quizTitle: 'T', action: 'quiz_edited', adminEmail: 'player@example.test', details: { status: 'active', questions: 3 },
    }]);
  });

  it('refuses, before saving anything, to remove an answered question or change its options', async () => {
    // Removing the question used to delete every player's answer to it; new options re-mapped them
    adminDb.setTable('QuestionAttempt', (call) => ({ data: eqValue(call, 'questionId') === 'drop' ? [{ id: 'qa-1' }] : [] }));
    const removed = await put({ title: 'T', questions: [question({ id: 'keep' })] });
    expect(removed.status).toBe(409);
    expect(await removed.json()).toEqual({
      error: 'Players have already answered "Dropped?", so it can\'t be removed and its options can\'t change. You can still edit its wording.',
      code: 'QUESTION_ANSWERED',
    });
    const reordered = await put({ title: 'T', questions: [question({ id: 'keep' }), question({ id: 'drop', options: ['b', 'a'] })] });
    expect(reordered.status).toBe(409);
    expect(adminDb.calls.filter((c) => ['update', 'insert', 'delete'].some((op) => hasOp(c, op)))).toHaveLength(0);
    // Nothing changed, so nothing to refresh
    expect(clearQuizListCache).not.toHaveBeenCalled();

    // New wording for the answered question is fine
    expect((await put({ title: 'T', questions: [question({ id: 'keep' }), question({ id: 'drop', text: 'Dropped catch?' })] })).status).toBe(200);
  });

  it("keeps a question's saved result: the key typed here never closes or reopens a question", async () => {
    adminDb.setTable('Question', (call) => (hasOp(call, 'update') ? { data: null } : { data: [{ id: 'done', hasCorrectAnswer: true }] }));
    await put({ title: 'T', questions: [question({ id: 'done', text: 'Toss?', correctAnswer: 0 })] });
    const update = argOf(adminDb.callsTo('Question', 'update')[0], 'update') as Record<string, unknown>;
    expect(update).toMatchObject({ text: 'Toss?', options: '["a","b"]', status: 'active' });
    expect(update).not.toHaveProperty('correctOption');
    expect(update).not.toHaveProperty('hasCorrectAnswer');
  });

  it('PAUSES the quiz when the edit sends neither status nor isActive, and ignores a passing score of 0', async () => {
    await put({ title: 'T', passingScore: 0 });
    const update = argOf(adminDb.callsTo('Quiz', 'update')[0], 'update') as Record<string, unknown>;
    expect(update.status).toBe('paused');
    expect(update).not.toHaveProperty('passingScore');
    expect(adminDb.callsTo('Answer')).toHaveLength(0);

    await put({ title: 'T', isActive: true, questions: [question({ id: 'keep' }), question({ id: 'drop' })] });
    expect(argOf(adminDb.callsTo('Quiz', 'update')[1], 'update')).toMatchObject({ status: 'active' });
    expect(adminDb.callsTo('Answer')).toHaveLength(0);
  });

  it('handles no existing questions and empty results', async () => {
    adminDb.setTable('Question', { data: null });
    adminDb.setTable('QuizAttempt', { count: null });
    const body = await (await put({ title: 'T', questions: [question()] })).json();
    expect(body.quiz).toMatchObject({ questions: [], stats: { totalQuestions: 0, totalAttempts: 0 } });
  });

  it('validates, 404s, guards and reports errors', async () => {
    expect((await put({ title: 'T', questions: [question({ correctAnswer: 9 })] })).status).toBe(400);
    adminDb.setTable('Quiz', { data: null });
    expect((await put({ title: 'T' })).status).toBe(404);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await put({ title: 'T' })).status).toBe(403);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await put({ title: 'T' })).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await put({ title: 'T' })).status).toBe(429);
    requireAuth.mockRejectedValueOnce(new Error('kaput'));
    expect((await put({ title: 'T' })).status).toBe(500);
    requireAuth.mockRejectedValueOnce('odd');
    await put({ title: 'T' });
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUIZ_COMPLETE_UPDATE_ERROR', expect.anything(), undefined, { error: 'Unknown error', quizId: 'quiz-1' });
  });
});

describe('DELETE /api/admin/quizzes/[id]', () => {
  const del = () => one.DELETE(makeRequest('/api/admin/quizzes/quiz-1', { method: 'DELETE' }), P);

  it('deletes answers, attempts, questions, winnings and the quiz', async () => {
    adminDb.setTable('Quiz', (call) => (hasOp(call, 'delete') ? { error: null } : { data: { id: 'quiz-1', title: 'T' } }));
    adminDb.setTable('Question', { data: [{ id: 'q1' }] });
    adminDb.setTable('QuizAttempt', (call) => (isHead(call) ? { count: 3 } : { data: [{ id: 'a1' }] }));

    const body = await (await del()).json();

    expect(body).toEqual({ message: 'Quiz deleted successfully', deletedQuiz: { id: 'quiz-1', title: 'T' } });
    const order = adminDb.calls.filter((c) => hasOp(c, 'delete')).map((c) => c.table);
    expect(order).toEqual(['Answer', 'QuestionAttempt', 'Question', 'Answer', 'QuestionAttempt', 'QuizAttempt', 'Winning', 'Quiz']);
    expect(recordSecurityEvent).toHaveBeenCalledWith('ADMIN_QUIZ_DELETED', expect.anything(), 'admin-1', { quizId: 'quiz-1', title: 'T', attemptCount: 3 });
    expect(clearQuizListCache).toHaveBeenCalledTimes(1);
    // Kept after the quiz is gone: no foreign key ties the record to it
    expect(logged()).toEqual([{
      quizId: 'quiz-1', quizTitle: 'T', action: 'quiz_deleted', adminEmail: 'player@example.test', details: { attempts: 3 },
    }]);
  });

  it.each(['QuizSettlement', 'QuizWinner'])('refuses to delete a quiz with %s rows, deleting nothing', async (table) => {
    // Its payout history would cascade away while the paid points stay
    adminDb.setTable('Quiz', (call) => (hasOp(call, 'delete') ? { error: null } : { data: { id: 'quiz-1', title: 'T' } }));
    adminDb.setTable(table, (call) => ({ count: eqValue(call, 'quizId') === 'quiz-1' ? 1 : 0 }));
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'This quiz has been settled: deleting it would erase who won and what was paid. Pause it instead.',
      code: 'QUIZ_SETTLED',
    });
    expect(adminDb.calls.filter((c) => hasOp(c, 'delete'))).toHaveLength(0);
  });

  it('deletes nothing when the payout history cannot be checked', async () => {
    adminDb.setTable('Quiz', (call) => (hasOp(call, 'delete') ? { error: null } : { data: { id: 'quiz-1', title: 'T' } }));
    adminDb.setTable('QuizSettlement', { error: { message: 'timeout' } });
    expect((await del()).status).toBe(500);
    expect(adminDb.calls.filter((c) => hasOp(c, 'delete'))).toHaveLength(0);
  });

  it('skips child deletes when there are none', async () => {
    adminDb.setTable('Quiz', (call) => (hasOp(call, 'delete') ? { error: null } : { data: { id: 'quiz-1', title: 'T' } }));
    adminDb.setTable('Question', { data: [] });
    adminDb.setTable('QuizAttempt', { data: null, count: null });
    await del();
    expect(adminDb.callsTo('Answer')).toHaveLength(0);
  });

  it('404s, guards and reports errors', async () => {
    adminDb.setTable('Quiz', { data: null });
    expect((await del()).status).toBe(404);
    adminDb.setTable('Quiz', (call) => (hasOp(call, 'delete') ? { error: new Error('fk') } : { data: { id: 'quiz-1' } }));
    expect((await del()).status).toBe(500);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await del()).status).toBe(403);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await del()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await del()).status).toBe(429);
    requireAuth.mockRejectedValueOnce('odd');
    await del();
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUIZ_DELETION_ERROR', expect.anything(), undefined, { error: 'Unknown error', quizId: 'quiz-1' });
  });
});
