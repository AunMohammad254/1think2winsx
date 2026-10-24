// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, routeParams, authOk, argOf, eqValue, hasOp, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client, generateId: () => 'gen-q' }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { admin: 'admin' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));

const list = await import('@/app/api/admin/questions/route');
const one = await import('@/app/api/admin/questions/[id]/route');

const P = routeParams({ id: 'q1' });
const isHead = (call: { ops: { op: string; args: unknown[] }[] }) => call.ops.some((o) => o.op === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head);
const row = (over: Record<string, unknown> = {}) => ({ id: 'q1', quizId: 'quiz-1', text: 'Toss?', options: '["A","B","C"]', correctOption: 1, hasCorrectAnswer: true, status: 'active', Quiz: [{ id: 'quiz-1', title: 'T' }], ...over });

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [requireAuth, requireCSRFToken, applyRateLimit, recordSecurityEvent]) fn.mockReset();
  requireAuth.mockResolvedValue(authOk('admin-1'));
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const guards = async (call: () => Promise<Response>, opts: { csrf?: boolean; rateEvent?: boolean } = {}) => {
  if (opts.csrf) {
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await call()).status).toBe(403);
  }
  requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
  expect((await call()).status).toBe(401);
  applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
  expect((await call()).status).toBe(429);
  if (opts.rateEvent) expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), 'admin-1', expect.objectContaining({ rateLimiter: 'admin' }));
};

describe('POST /api/admin/questions', () => {
  const post = (body: unknown) => list.POST(makeRequest('/api/admin/questions', { body }));

  it('creates a question with the answer key when one is given, still open to answers', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T' } });
    adminDb.setTable('Question', { data: { id: 'gen-q', quizId: 'quiz-1', text: 'Toss?', options: '["A","B"]', correctOption: 1, hasCorrectAnswer: false, status: 'active' } });
    const res = await post({ quizId: 'quiz-1', text: 'Toss?', options: ['A', 'B'], correctOption: 1 });
    expect(res.status).toBe(201);
    expect(argOf(adminDb.callsTo('Question')[0], 'insert')).toMatchObject({ id: 'gen-q', options: '["A","B"]', correctOption: 1, hasCorrectAnswer: false, status: 'active' });
    expect((await res.json()).question.options).toEqual(['A', 'B']);
  });

  it('creates a prediction question without an answer yet', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1' } });
    adminDb.setTable('Question', { data: { id: 'gen-q', options: '["A","B"]' } });
    await post({ quizId: 'quiz-1', text: 'Who wins?', options: ['A', 'B'], correctOption: null });
    expect(argOf(adminDb.callsTo('Question')[0], 'insert')).toMatchObject({ correctOption: null, hasCorrectAnswer: false });
    await post({ quizId: 'quiz-1', text: 'Who wins?', options: ['A', 'B'] });
    expect(argOf(adminDb.callsTo('Question')[1], 'insert')).toMatchObject({ hasCorrectAnswer: false });
  });

  it('rejects bad data, an out-of-range answer and unknown quizzes', async () => {
    expect((await post({ quizId: 'quiz-1', text: '', options: ['A', 'B'] })).status).toBe(400);
    adminDb.setTable('Quiz', { data: { id: 'quiz-1' } });
    expect((await (await post({ quizId: 'quiz-1', text: 'x', options: ['A', 'B'], correctOption: 2 })).json()).error).toBe('Invalid correct option index');
    adminDb.setTable('Quiz', { data: null, error: { code: 'PGRST116' } });
    expect((await post({ quizId: 'nope', text: 'x', options: ['A', 'B'] })).status).toBe(404);
  });

  it('guards and reports insert failures', async () => {
    await guards(() => post({ quizId: 'q', text: 'x', options: ['A', 'B'] }), { csrf: true, rateEvent: true });
    adminDb.setTable('Quiz', { data: { id: 'quiz-1' } });
    adminDb.setTable('Question', { error: new Error('insert failed') });
    expect((await post({ quizId: 'quiz-1', text: 'x', options: ['A', 'B'] })).status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUESTION_CREATION_ERROR', expect.anything(), undefined, { error: 'insert failed' });
    adminDb.setTable('Question', { error: { message: 'plain' } });
    await post({ quizId: 'quiz-1', text: 'x', options: ['A', 'B'] });
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUESTION_CREATION_ERROR', expect.anything(), undefined, { error: 'Unknown error' });
  });
});

describe('GET /api/admin/questions', () => {
  const get = (qs = '') => list.GET(makeRequest(`/api/admin/questions${qs}`));

  it('pages questions with an answer count each', async () => {
    adminDb.setTable('Question', { data: [row(), row({ id: 'q2', Quiz: { id: 'quiz-2' } })], count: 45 });
    adminDb.setTable('Answer', (call) => ({ count: eqValue(call, 'questionId') === 'q1' ? 12 : null }));

    const body = await (await get('?quizId=quiz-1&status=active&page=2&limit=20')).json();

    expect(body.questions.map((q: { id: string; answerCount: number; quiz: { id: string } }) => [q.id, q.answerCount, q.quiz.id])).toEqual([['q1', 12, 'quiz-1'], ['q2', 0, 'quiz-2']]);
    expect(body.questions[0].options).toEqual(['A', 'B', 'C']);
    expect(body.pagination).toEqual({ page: 2, limit: 20, totalCount: 45, totalPages: 3, hasNext: true, hasPrev: true });
    const q = adminDb.callsTo('Question')[0];
    expect(eqValue(q, 'quizId')).toBe('quiz-1');
    expect(eqValue(q, 'status')).toBe('active');
  });

  it('caps the page size and handles no rows', async () => {
    adminDb.setTable('Question', { data: null, count: null });
    const body = await (await get('?limit=1000')).json();
    expect(body).toEqual({ questions: [], pagination: { page: 1, limit: 100, totalCount: 0, totalPages: 0, hasNext: false, hasPrev: false } });
  });

  it('guards and reports errors', async () => {
    await guards(() => get());
    adminDb.setTable('Question', { error: new Error('db') });
    expect((await get()).status).toBe(500);
    adminDb.setTable('Question', { error: { message: 'x' } });
    await get();
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('ADMIN_QUESTION_LIST_ERROR', expect.anything(), undefined, { error: 'Unknown error' });
  });
});

describe('GET /api/admin/questions/[id]', () => {
  const get = () => one.GET(makeRequest('/api/admin/questions/q1'), P);

  it('returns the question, recent answers and stats', async () => {
    adminDb.setTable('Question', { data: row() });
    adminDb.setTable('Answer', (call) => {
      if (isHead(call)) return { count: eqValue(call, 'isCorrect') ? 1 : 4 };
      return {
        data: [
          { id: 'a1', selectedOption: 1, isCorrect: true, QuizAttempt: [{ User: [{ name: 'Ali' }] }] },
          { id: 'a2', selectedOption: 0, isCorrect: false, QuizAttempt: { User: { name: 'Sara' } } },
          { id: 'a3', selectedOption: 0, isCorrect: false, QuizAttempt: null },
        ],
      };
    });

    const { question } = await (await get()).json();

    expect(question.quiz).toEqual({ id: 'quiz-1', title: 'T' });
    expect(question.recentAnswers.map((a: { user: { name: string } | null }) => a.user?.name ?? null)).toEqual(['Ali', 'Sara', null]);
    expect(question.stats).toEqual({
      totalAnswers: 4,
      correctAnswerCount: 1,
      correctAnswerRate: 25,
      answerDistribution: [
        { option: 0, text: 'A', count: 2, percentage: 50, isCorrect: false },
        { option: 1, text: 'B', count: 1, percentage: 25, isCorrect: true },
        { option: 2, text: 'C', count: 0, percentage: 0, isCorrect: false },
      ],
    });
    // routine reads are filed as suspicious activity
    expect(recordSecurityEvent).toHaveBeenCalledWith('SUSPICIOUS_ACTIVITY', expect.anything(), 'admin-1', { questionId: 'q1', quizId: 'quiz-1' });
  });

  it('computes the distribution from only the last 20 answers but divides by the total', async () => {
    adminDb.setTable('Question', { data: row({ Quiz: { id: 'quiz-1' } }) });
    adminDb.setTable('Answer', (call) => (isHead(call) ? { count: eqValue(call, 'isCorrect') ? null : 1000 } : { data: Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, selectedOption: 0 })) }));
    const { question } = await (await get()).json();
    expect(question.stats.answerDistribution[0]).toMatchObject({ count: 20, percentage: 2 });
    expect(question.stats.correctAnswerCount).toBe(0);
  });

  it('handles a question with no answers', async () => {
    adminDb.setTable('Question', { data: row() });
    adminDb.setTable('Answer', { data: null, count: null });
    const { question } = await (await get()).json();
    expect(question.stats).toMatchObject({ totalAnswers: 0, correctAnswerRate: 0 });
    expect(question.recentAnswers).toEqual([]);
  });

  it('404s, guards, and files errors as unauthorized access', async () => {
    adminDb.setTable('Question', { data: null });
    expect((await get()).status).toBe(404);
    await guards(get);
    requireAuth.mockRejectedValueOnce(new Error('boom'));
    expect((await get()).status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('UNAUTHORIZED_ACCESS', expect.anything(), undefined, { error: 'boom', questionId: 'q1' });
    requireAuth.mockRejectedValueOnce('odd');
    await get();
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('UNAUTHORIZED_ACCESS', expect.anything(), undefined, { error: 'Unknown error', questionId: 'q1' });
  });
});

describe('PATCH /api/admin/questions/[id]', () => {
  const patch = (body: unknown) => one.PATCH(makeRequest('/api/admin/questions/q1', { method: 'PATCH', body }), P);

  it('updates the sent fields; a new answer key leaves the question open (Settle Quizzes saves results)', async () => {
    adminDb.setTable('Question', (call) => (hasOp(call, 'update') ? { data: row({ text: 'New', Quiz: { id: 'quiz-1' } }) } : { data: row() }));
    const body = await (await patch({ text: 'New', options: ['A', 'B'], correctOption: 0, status: 'paused' })).json();
    const update = argOf(adminDb.callsTo('Question', 'update')[0], 'update') as Record<string, unknown>;
    expect(update).toMatchObject({ text: 'New', options: '["A","B"]', correctOption: 0, status: 'paused' });
    expect(update).not.toHaveProperty('hasCorrectAnswer');
    expect(body.question).toMatchObject({ text: 'New', quiz: { id: 'quiz-1' } });
    await patch({});
    expect(Object.keys(argOf(adminDb.callsTo('Question', 'update')[1], 'update') as object)).toEqual(['updatedAt']);
  });

  it("refuses new options for a question players answered, but saves its wording and doesn't rewrite the same options", async () => {
    adminDb.setTable('Question', (call) => (hasOp(call, 'update') ? { data: row() } : { data: row() }));
    adminDb.setTable('QuestionAttempt', { data: [{ id: 'qa-1' }] });
    const refused = await patch({ options: ['C', 'B', 'A'] });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: 'Players have already answered "Toss?", so it can\'t be removed and its options can\'t change. You can still edit its wording.',
      code: 'QUESTION_ANSWERED',
    });
    expect(adminDb.callsTo('Question', 'update')).toHaveLength(0);

    expect((await patch({ text: 'Toss winner?', options: ['A', 'B', 'C'] })).status).toBe(200);
    const update = argOf(adminDb.callsTo('Question', 'update')[0], 'update') as Record<string, unknown>;
    expect(update).toMatchObject({ text: 'Toss winner?' });
    expect(update).not.toHaveProperty('options');
  });

  it('checks the answer index against new or current options', async () => {
    adminDb.setTable('Question', { data: row() });
    expect((await (await patch({ options: ['A', 'B'], correctOption: 2 })).json()).error).toBe('Invalid correct option index');
    expect((await (await patch({ correctOption: 3 })).json()).error).toBe('Invalid correct option index for current options');
    adminDb.setTable('Question', (call) => (hasOp(call, 'update') ? { data: row() } : { data: row() }));
    expect((await patch({ correctOption: 2 })).status).toBe(200);
  });

  it('validates, 404s, guards and reports errors', async () => {
    expect((await patch({ status: 'deleted' })).status).toBe(400);
    adminDb.setTable('Question', { data: null });
    expect((await patch({ text: 'x' })).status).toBe(404);
    adminDb.setTable('Question', (call) => (hasOp(call, 'update') ? { error: new Error('update failed') } : { data: row() }));
    expect((await patch({ text: 'x' })).status).toBe(500);
    await guards(() => patch({ text: 'x' }), { csrf: true, rateEvent: true });
    requireAuth.mockRejectedValueOnce('odd');
    await patch({});
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('UNAUTHORIZED_ACCESS', expect.anything(), undefined, { error: 'Unknown error', questionId: 'q1' });
  });
});

describe('DELETE /api/admin/questions/[id]', () => {
  const del = () => one.DELETE(makeRequest('/api/admin/questions/q1', { method: 'DELETE' }), P);

  it('deletes a question nobody answered', async () => {
    adminDb.setTable('Question', (call) => (hasOp(call, 'delete') ? { error: null } : { data: row() }));
    adminDb.setTable('Answer', { data: [] });
    adminDb.setTable('QuestionAttempt', { data: [] });
    const body = await (await del()).json();
    expect(body).toEqual({ message: 'Question deleted successfully', deletedQuestion: { id: 'q1', text: 'Toss?', quiz: { id: 'quiz-1', title: 'T' } } });
    expect(adminDb.calls.filter((c) => hasOp(c, 'delete')).map((c) => c.table)).toEqual(['Question']);
    expect(recordSecurityEvent).toHaveBeenCalledWith('SUSPICIOUS_ACTIVITY', expect.anything(), 'admin-1', expect.objectContaining({ quizTitle: 'T' }));
  });

  it.each(['Answer', 'QuestionAttempt'])('refuses to delete a question with answers in "%s", and deletes nothing', async (table) => {
    // Deleting the question used to delete every player's answer to it
    adminDb.setTable('Question', (call) => (hasOp(call, 'delete') ? { error: null } : { data: row() }));
    adminDb.setTable(table, { data: [{ id: 'a-1' }] });
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('QUESTION_ANSWERED');
    expect(adminDb.calls.filter((c) => hasOp(c, 'delete'))).toHaveLength(0);
  });

  it('handles an object quiz join and no answers', async () => {
    adminDb.setTable('Question', (call) => (hasOp(call, 'delete') ? { error: null } : { data: row({ Quiz: { id: 'quiz-1', title: 'Obj' } }) }));
    adminDb.setTable('Answer', { data: null });
    expect((await (await del()).json()).deletedQuestion.quiz.title).toBe('Obj');
    adminDb.setTable('Question', (call) => (hasOp(call, 'delete') ? { error: null } : { data: row({ Quiz: null }) }));
    expect((await del()).status).toBe(200);
  });

  it('404s, guards and reports errors', async () => {
    adminDb.setTable('Question', { data: null });
    expect((await del()).status).toBe(404);
    adminDb.setTable('Question', (call) => (hasOp(call, 'delete') ? { error: new Error('fk') } : { data: row() }));
    expect((await del()).status).toBe(500);
    await guards(del, { csrf: true });
    requireAuth.mockRejectedValueOnce('odd');
    await del();
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('UNAUTHORIZED_ACCESS', expect.anything(), undefined, { error: 'Unknown error', questionId: 'q1' });
  });
});
