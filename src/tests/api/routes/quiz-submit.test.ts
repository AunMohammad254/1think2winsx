// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, routeParams, authOk, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getDb: async () => db.client }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { quiz: 'quiz' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));

import { POST } from '@/app/api/quizzes/[id]/submit/route';

const answers = [
  { questionId: 'q1', selectedOption: 0 },
  { questionId: 'q2', selectedOption: 3 },
];
const submit = (body: unknown = { answers }) => POST(makeRequest('/api/quizzes/quiz-1/submit', { body }), routeParams({ id: 'quiz-1' }));

beforeEach(() => {
  db = createSupabaseMock();
  requireAuth.mockReset().mockResolvedValue(authOk('user-1'));
  requireCSRFToken.mockReset().mockResolvedValue(null);
  applyRateLimit.mockReset().mockResolvedValue(null);
  recordSecurityEvent.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/quizzes/[id]/submit', () => {
  it('submits through the submit_quiz_attempt RPC and reports pending evaluation', async () => {
    db.setRpc('submit_quiz_attempt', { data: { success: true, attemptId: 'att-1', answersSubmitted: 2, totalQuestions: 5 } });

    const res = await submit();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.rpcCalls).toEqual([
      { fn: 'submit_quiz_attempt', args: { p_user_id: 'user-1', p_quiz_id: 'quiz-1', p_answers: answers, p_daily_payment_id: null } },
    ]);
    expect(body.message).toBe('Quiz predictions submitted successfully');
    expect(body.results).toMatchObject({ attemptId: 'att-1', totalQuestions: 5, submittedAnswers: 2, status: 'pending_evaluation', score: null, points: null });
    expect(body.results.note).toMatch(/^Your predictions have been submitted/);
    expect(recordSecurityEvent).toHaveBeenCalledWith('QUIZ_SUBMITTED', expect.anything(), 'user-1', expect.objectContaining({ quizId: 'quiz-1', attemptId: 'att-1' }));
  });

  it('uses the re-attempt wording and falls back to the answer count for totalQuestions', async () => {
    db.setRpc('submit_quiz_attempt', { data: { success: true, attemptId: 'att-2', answersSubmitted: 2, isReattempt: true } });

    const body = await (await submit()).json();

    expect(body.message).toBe('New quiz predictions submitted successfully');
    expect(body.results.totalQuestions).toBe(2);
    expect(body.results.note).toMatch(/^Your predictions for the new questions/);
  });

  it('stops at the CSRF check', async () => {
    requireCSRFToken.mockResolvedValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));
    const res = await submit();
    expect(res.status).toBe(403);
    expect(requireAuth).not.toHaveBeenCalled();
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('returns the auth failure response for signed-out callers', async () => {
    requireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await submit();
    expect(res.status).toBe(401);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('returns 429 and logs when rate limited', async () => {
    applyRateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many' }, { status: 429 }));
    const res = await submit();
    expect(res.status).toBe(429);
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), 'user-1', expect.objectContaining({ rateLimiter: 'quiz' }));
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('rejects a body that is not JSON', async () => {
    const res = await POST(makeRequest('/api/quizzes/quiz-1/submit', { method: 'POST', rawBody: '{nope' }), routeParams({ id: 'quiz-1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
  });

  it.each([
    ['no answers', { answers: [] }],
    ['an out-of-range option', { answers: [{ questionId: 'q1', selectedOption: 10 }] }],
    ['a fractional option', { answers: [{ questionId: 'q1', selectedOption: 1.5 }] }],
    ['an empty question id', { answers: [{ questionId: '', selectedOption: 1 }] }],
    ['a missing answers field', {}],
  ])('rejects %s', async (_label, body) => {
    const res = await submit(body);
    expect(res.status).toBe(400);
    expect(recordSecurityEvent).toHaveBeenCalledWith('INVALID_INPUT', expect.anything(), 'user-1', expect.anything());
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('returns 500 when the RPC errors or returns nothing', async () => {
    db.setRpc('submit_quiz_attempt', { error: { message: 'boom' } });
    expect((await submit()).status).toBe(500);
    db.setRpc('submit_quiz_attempt', { data: null });
    expect((await submit()).status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenCalledWith('QUIZ_SUBMISSION_ERROR', expect.anything(), 'user-1', { quizId: 'quiz-1' });
  });

  it.each([
    ['payment_required', 402],
    ['not_found', 404],
    ['invalid', 400],
    ['forbidden', 403],
    ['closed', 403],
    ['something_new', 500],
  ])('maps the RPC code %s to HTTP %i', async (code, status) => {
    db.setRpc('submit_quiz_attempt', { data: { success: false, code, error: `reason ${code}` } });
    const res = await submit();
    const body = await res.json();
    expect(res.status).toBe(status);
    expect(body.error).toBe(`reason ${code}`);
    expect(body.requiresPayment).toBe(status === 402 ? true : undefined);
  });

  it('logs rejected submissions as invalid input, but not a late (closed) submit', async () => {
    db.setRpc('submit_quiz_attempt', { data: { success: false, code: 'forbidden' } });
    await submit();
    expect(recordSecurityEvent).toHaveBeenCalledWith('INVALID_INPUT', expect.anything(), 'user-1', expect.objectContaining({ code: 'forbidden' }));

    recordSecurityEvent.mockReset();
    db.setRpc('submit_quiz_attempt', { data: { success: false, code: 'closed' } });
    const res = await submit();
    expect((await res.json()).error).toBe('Failed to submit quiz');
    expect(recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('treats a failed RPC result without a code as a server error', async () => {
    db.setRpc('submit_quiz_attempt', { data: { success: false } });
    const res = await submit();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to submit quiz');
  });

  it('returns 500 and logs when something throws', async () => {
    requireAuth.mockRejectedValue(new Error('auth exploded'));
    const res = await submit();
    expect(res.status).toBe(500);
    expect(recordSecurityEvent).toHaveBeenCalledWith('QUIZ_SUBMISSION_ERROR', expect.anything(), undefined, { error: 'auth exploded', quizId: 'quiz-1' });

    requireAuth.mockRejectedValue('not an Error');
    await submit();
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('QUIZ_SUBMISSION_ERROR', expect.anything(), undefined, { error: 'Unknown error', quizId: 'quiz-1' });
  });
});
