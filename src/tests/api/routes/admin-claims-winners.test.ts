// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, authOk, argOf, hasOp, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();
const validateAdminSession = vi.fn();
const logger = { logSecurityEvent: vi.fn(), logInvalidInput: vi.fn() };
const findAllAdmin = vi.fn();
const winnerDb = { findByQuizId: vi.fn(), existsForQuiz: vi.fn(), create: vi.fn(), markNotificationSent: vi.fn() };
const createNotification = vi.fn();

vi.mock('@/lib/supabase/db', async () => {
  const shared = await vi.importActual<typeof import('@/lib/supabase/db-modules/shared')>('@/lib/supabase/db-modules/shared');
  return {
    getAdminDb: () => adminDb.client,
    mapWithConcurrency: shared.mapWithConcurrency,
    prizeRedemptionDb: { findAllAdmin: (...a: unknown[]) => findAllAdmin(...a) },
    userDb: {},
    notificationDb: { create: (...a: unknown[]) => createNotification(...a) },
  };
});
vi.mock('@/lib/supabase/db-modules/winner.db', () => ({ quizWinnerDb: winnerDb }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: (...a: unknown[]) => validateAdminSession(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { admin: 'admin' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: logger }));

const claims = await import('@/app/api/admin/claims/route');
const board = await import('@/app/api/admin/lucky-winner/[quizId]/route');
const draw = await import('@/app/api/admin/lucky-winner/[quizId]/draw/route');

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [requireAuth, requireCSRFToken, applyRateLimit, recordSecurityEvent, validateAdminSession, findAllAdmin, createNotification, ...Object.values(logger), ...Object.values(winnerDb)]) fn.mockReset();
  requireAuth.mockResolvedValue(authOk('admin-1'));
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  validateAdminSession.mockResolvedValue({ valid: true, email: 'boss@example.test' });
  winnerDb.existsForQuiz.mockResolvedValue(false);
  winnerDb.findByQuizId.mockResolvedValue(null);
  winnerDb.create.mockImplementation(async (data: Record<string, unknown>) => ({ id: `w-${data.userId}`, ...data }));
  createNotification.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GET /api/admin/claims', () => {
  const get = (qs = '', headers: Record<string, string> = {}) => claims.GET(makeRequest(`/api/admin/claims${qs}`, { headers }));

  it('uses the get_admin_claims RPC and logs the view', async () => {
    adminDb.setRpc('get_admin_claims', { data: { success: true, claims: [{ id: 'c1' }], pagination: { page: 1 } } });
    const body = await (await get('?status=pending&page=1&limit=500', { 'x-real-ip': '9.9.9.9', 'user-agent': 'UA' })).json();
    expect(adminDb.rpcCalls[0].args).toEqual({ p_status: 'pending', p_page: 1, p_limit: 100 });
    expect(body).toEqual({ claims: [{ id: 'c1' }], pagination: { page: 1 } });
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADMIN_ACCESS', ip: '9.9.9.9', userAgent: 'UA', details: expect.objectContaining({ method: 'supabase_rpc', resultCount: 1 }) }));
    adminDb.setRpc('get_admin_claims', { data: { success: true } });
    expect((await (await get()).json()).claims).toEqual([]);
  });

  it('falls back to a direct query when the RPC fails or throws', async () => {
    adminDb.setRpc('get_admin_claims', { error: { message: 'missing' } });
    findAllAdmin.mockResolvedValue({ data: [{ id: 'c1', User: [{ name: 'A' }], Prize: { name: 'Watch' } }], page: 2, limit: 20, count: 21, totalPages: 2 });
    const body = await (await get('?page=2', { 'x-forwarded-for': '1.1.1.1' })).json();
    expect(findAllAdmin).toHaveBeenCalledWith({ status: undefined, page: 2, limit: 20 });
    expect(body).toEqual({ claims: [{ id: 'c1', User: [{ name: 'A' }], Prize: { name: 'Watch' }, user: { name: 'A' }, prize: { name: 'Watch' } }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 } });

    adminDb.client.rpc.mockImplementationOnce(() => { throw new Error('rpc down'); });
    findAllAdmin.mockResolvedValue({ data: null, page: 1, limit: 20, count: 0, totalPages: 0 });
    expect((await (await get()).json()).claims).toEqual([]);
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: 'unknown' }));
  });

  it('guards and reports errors', async () => {
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await get()).status).toBe(429);
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), undefined, { endpoint: '/api/admin/claims', rateLimiter: 'admin' });
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await get()).status).toBe(403);
    adminDb.setRpc('get_admin_claims', { data: null });
    findAllAdmin.mockRejectedValueOnce(new Error('db'));
    expect((await get('', { 'x-real-ip': '3.3.3.3' })).status).toBe(500);
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'API_ERROR', ip: '3.3.3.3', details: { error: 'db', action: 'GET_CLAIMS' } }));
    findAllAdmin.mockRejectedValueOnce('odd');
    await get();
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ details: { error: 'Unknown error', action: 'GET_CLAIMS' } }));
  });
});

describe('PUT /api/admin/claims', () => {
  const put = (body: unknown, headers: Record<string, string> = {}) => claims.PUT(makeRequest('/api/admin/claims', { method: 'PUT', body, headers }));

  it('updates through update_claim_status', async () => {
    adminDb.setRpc('update_claim_status', { data: { success: true, message: 'Done', points_refunded: 50 } });
    const body = await (await put({ claimId: 'c1', status: 'rejected', notes: 'fake' }, { 'x-forwarded-for': '1.1.1.1', 'user-agent': 'UA' })).json();
    expect(adminDb.rpcCalls[0]).toEqual({ fn: 'update_claim_status', args: { p_claim_id: 'c1', p_status: 'rejected', p_notes: 'fake' } });
    expect(body).toEqual({ message: 'Done', claim: { id: 'c1', status: 'rejected' } });
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ ip: '1.1.1.1', details: expect.objectContaining({ pointsRefunded: 50 }) }));
    adminDb.setRpc('update_claim_status', { data: { success: true } });
    expect((await (await put({ claimId: 'c1', status: 'fulfilled' })).json()).message).toBe('Claim fulfilled successfully');
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: 'unknown', details: expect.objectContaining({ pointsRefunded: null }) }));
  });

  it('relays an update_claim_status refusal', async () => {
    adminDb.setRpc('update_claim_status', { data: { success: false, error: 'Already fulfilled' } });
    expect(await (await put({ claimId: 'c1', status: 'approved' })).json()).toEqual({ message: 'Already fulfilled' });
    adminDb.setRpc('update_claim_status', { data: { success: false } });
    expect(await (await put({ claimId: 'c1', status: 'approved' })).json()).toEqual({ message: 'Failed to update claim' });
  });

  it('falls back to approve_claim and reject_claim_with_refund', async () => {
    adminDb.setRpc('update_claim_status', { error: { message: 'not found' } });
    adminDb.setRpc('approve_claim', { data: { success: true } });
    adminDb.setRpc('reject_claim_with_refund', { data: { success: true, points_refunded: 20 } });
    expect((await (await put({ claimId: 'c1', status: 'approved' })).json()).message).toBe('Claim approved successfully');
    expect((await (await put({ claimId: 'c1', status: 'rejected' }, { 'x-forwarded-for': '2.2.2.2' })).json()).message).toBe('Claim rejected and points refunded');

    adminDb.setRpc('approve_claim', { data: { success: false, error: 'Out of stock' } });
    expect(await (await put({ claimId: 'c1', status: 'approved' })).json()).toEqual({ message: 'Out of stock' });
    adminDb.setRpc('approve_claim', { data: { success: false } });
    expect(await (await put({ claimId: 'c1', status: 'approved' })).json()).toEqual({ message: 'Failed to approve claim' });
    adminDb.setRpc('reject_claim_with_refund', { data: { success: false } });
    expect(await (await put({ claimId: 'c1', status: 'rejected' })).json()).toEqual({ message: 'Failed to reject claim' });
    adminDb.setRpc('reject_claim_with_refund', { data: { success: false, error: 'Locked' } });
    expect(await (await put({ claimId: 'c1', status: 'rejected' })).json()).toEqual({ message: 'Locked' });
  });

  it('as a last resort refunds a rejection with a NON-atomic read-then-write of points', async () => {
    adminDb.setRpc('update_claim_status', { data: null });
    adminDb.client.rpc.mockImplementation((fn: string) => {
      if (fn === 'update_claim_status') return { then: (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok) } as never;
      throw new Error(`${fn} missing`);
    });
    adminDb.setTable('PrizeRedemption', (call) => (hasOp(call, 'update') ? { data: { id: 'c1', status: 'rejected', processedAt: 'now', notes: 'old' } } : { data: { id: 'c1', userId: 'u1', status: 'pending', pointsUsed: 300, notes: 'old', User: { points: 50 } } }));

    const body = await (await put({ claimId: 'c1', status: 'rejected' })).json();

    expect(argOf(adminDb.callsTo('User', 'update')[0], 'update')).toMatchObject({ points: 350 });
    expect(argOf(adminDb.callsTo('PrizeRedemption', 'update')[0], 'update')).toMatchObject({ status: 'rejected', notes: 'old' });
    expect(body).toEqual({ message: 'Claim status updated successfully', claim: { id: 'c1', status: 'rejected', processedAt: 'now', notes: 'old' } });

    // approve_claim throwing also falls through to the direct update
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(200);
    // and so does update_claim_status itself throwing
    adminDb.client.rpc.mockImplementation(() => { throw new Error('all down'); });
    expect((await put({ claimId: 'c1', status: 'fulfilled' })).status).toBe(200);
  });

  it('last resort: no refund when not rejecting or already rejected; 404 / 500 on failures', async () => {
    adminDb.client.rpc.mockImplementation(() => ({ then: (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: { message: 'missing' } }).then(ok) }) as never);
    adminDb.setTable('PrizeRedemption', (call) => (hasOp(call, 'update') ? { data: { id: 'c1', status: 'fulfilled' } } : { data: { id: 'c1', status: 'rejected', User: null } }));
    await put({ claimId: 'c1', status: 'fulfilled', notes: 'sent' }, { 'x-forwarded-for': '4.4.4.4' });
    await put({ claimId: 'c1', status: 'rejected' });
    expect(adminDb.callsTo('User')).toHaveLength(0);

    adminDb.setTable('PrizeRedemption', (call) => (hasOp(call, 'update') ? { data: null } : { data: { id: 'c1', status: 'pending', userId: 'u', pointsUsed: 1, User: null } }));
    await put({ claimId: 'c1', status: 'rejected' });
    expect(argOf(adminDb.callsTo('User', 'update')[0], 'update')).toMatchObject({ points: 1 });

    adminDb.setTable('PrizeRedemption', { data: null, error: { message: 'rls' } });
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(404);
    adminDb.setTable('PrizeRedemption', (call) => (hasOp(call, 'update') ? { error: { message: 'rls' } } : { data: { id: 'c1', status: 'pending' } }));
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(500);
  });

  it('validates, guards and reports errors', async () => {
    expect((await put({ claimId: 'c1', status: 'deleted' })).status).toBe(400);
    expect(logger.logInvalidInput).toHaveBeenCalled();
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(403);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(429);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(401);
    requireAuth.mockRejectedValueOnce(new Error('x'));
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(500);
    const { z } = await import('zod');
    requireAuth.mockRejectedValueOnce(new z.ZodError([]));
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(400);
  });
});

const attempts = (scores: number[]) => scores.map((score, i) => ({ id: `a${i}`, userId: `u${i}`, score, completedAt: `2026-10-0${i + 1}`, user: { name: `P${i}`, email: `p${i}@x` } }));
const ctx = { params: Promise.resolve({ quizId: 'quiz-1' }) };

describe('GET /api/admin/lucky-winner/[quizId]', () => {
  const get = () => board.GET(makeRequest('/api/admin/lucky-winner/quiz-1'), ctx);

  it('returns the leaderboard, the tied top scorers and the prize', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T', prizeId: 'p1' } });
    adminDb.setTable('Prize', { data: { id: 'p1', name: 'Watch' } });
    adminDb.setTable('QuizAttempt', { data: attempts([90, 90, 50]) });
    winnerDb.findByQuizId.mockResolvedValue({ id: 'w' });

    const body = await (await get()).json();

    expect(body).toMatchObject({ prize: { id: 'p1', name: 'Watch' }, totalAttempts: 3, maxScore: 90, tiedCount: 2, winnerAlreadyDrawn: true, existingWinner: { id: 'w' } });
    const q = adminDb.callsTo('QuizAttempt')[0];
    expect(q.ops.find((o) => o.op === 'not')?.args).toEqual(['completedAt', 'is', null]);
  });

  it('uses a synthetic bumper prize, and handles no attempts', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', isBumperPrize: true } });
    adminDb.setTable('QuizAttempt', { data: null });
    const body = await (await get()).json();
    expect(body).toMatchObject({ prize: { id: 'bumper', name: 'Bumper Prize' }, totalAttempts: 0, maxScore: 0, tiedCount: 0, existingWinner: null, winnerAlreadyDrawn: false });
  });

  it('refuses quizzes without a prize, unknown quizzes, non-admins, and reports errors', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1' } });
    expect((await get()).status).toBe(422);
    adminDb.setTable('Quiz', { data: null });
    expect((await get()).status).toBe(404);
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', prizeId: 'p' } });
    adminDb.setTable('QuizAttempt', { error: { message: 'x' } });
    expect((await get()).status).toBe(500);
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await get()).status).toBe(401);
    expect((await board.GET(makeRequest('/x'), { params: Promise.resolve({ quizId: '' }) })).status).toBe(400);
  });
});

describe('POST /api/admin/lucky-winner/[quizId]/draw', () => {
  const run = (body?: unknown) => draw.POST(body === undefined ? new NextRequest('http://localhost/x', { method: 'POST' }) : makeRequest('/x', { body }), ctx);
  beforeEach(() => adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'Cricket', prizeId: 'p1' } }));

  it('picks the single top scorer without a draw and notifies them', async () => {
    adminDb.setTable('QuizAttempt', { data: attempts([90, 50]) });
    const body = await (await run()).json();
    expect(body.message).toBe('Single winner selected — no draw needed.');
    expect(body.winners).toEqual([expect.objectContaining({ userId: 'u0', name: 'P0', selectionMethod: 'auto_single_winner' })]);
    expect(winnerDb.create).toHaveBeenCalledWith(expect.objectContaining({ quizId: 'quiz-1', userId: 'u0', prizeId: 'p1', selectedBy: 'boss@example.test', seed: expect.stringMatching(/^[0-9a-f]{64}$/) }));
    expect(createNotification).toHaveBeenCalledWith('u0', expect.objectContaining({ title: '🏆 Congratulations! You Won a Prize!' }));
    expect(winnerDb.markNotificationSent).toHaveBeenCalledWith('w-u0');
  });

  it('draws one winner from tied top scorers and gives the others consolation points', async () => {
    adminDb.setTable('QuizAttempt', { data: attempts([90, 90, 90, 10]) });
    adminDb.setRpc('increment_user_points', (args) => (args.p_user_id === 'u2' ? { error: { message: 'x' } } : { data: 5 }));
    const body = await (await run({ numberOfWinners: 1, consolationPoints: 5 })).json();
    expect(body.draw).toMatchObject({ totalAttempts: 4, maxScore: 90, tiedCount: 3, winnerCount: 1 });
    expect(body.winners[0].selectionMethod).toBe('random_draw');
    expect(['u0', 'u1', 'u2']).toContain(body.winners[0].userId);
    const consoled = adminDb.rpcCalls.map((c) => c.args.p_user_id);
    expect(consoled).toHaveLength(2);
    expect(consoled).not.toContain(body.winners[0].userId);
    expect(body.consolation.losersAwarded).toBe(consoled.includes('u2') ? 1 : 2);

    adminDb.setRpc('increment_user_points', { error: { message: 'down' } });
    expect((await (await run({ consolationPoints: 5 })).json()).consolation).toEqual({ points: 5, losersAwarded: 0 });
  });

  it('cannot record more than one winner per quiz: the unique index fails the second insert', async () => {
    adminDb.setTable('QuizAttempt', { data: attempts([90, 90]) });
    winnerDb.create.mockResolvedValueOnce({ id: 'w1', userId: 'u0' }).mockRejectedValueOnce({ code: '23505', message: 'duplicate key value violates unique constraint "QuizWinner_quizId_unique"' });
    const res = await run({ numberOfWinners: 2 });
    expect(res.status).toBe(500);
    expect(winnerDb.create).toHaveBeenCalledTimes(2);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('records a bumper-prize winner without a prize id, and survives notification failures', async () => {
    adminDb.setTable('Quiz', { data: { id: 'quiz-1', title: 'T', isBumperPrize: true } });
    adminDb.setTable('QuizAttempt', { data: [{ id: 'a', userId: 'u', score: 1, completedAt: 'c', user: null }] });
    validateAdminSession.mockResolvedValue({ valid: true });
    createNotification.mockRejectedValue(new Error('push'));
    const body = await (await run({ consolationPoints: -5, numberOfWinners: 0 })).json();
    expect(winnerDb.create.mock.calls[0][0]).not.toHaveProperty('prizeId');
    expect(winnerDb.create.mock.calls[0][0].selectedBy).toBe('admin');
    expect(body.winners[0].name).toBe('Unknown');
    expect(body.consolation).toEqual({ points: 0, losersAwarded: 0 });
  });

  it('refuses a second draw with the existing winner', async () => {
    winnerDb.existsForQuiz.mockResolvedValue(true);
    winnerDb.findByQuizId.mockResolvedValue({ id: 'w-old' });
    const res = await run();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'WINNER_ALREADY_DRAWN', existingWinner: { id: 'w-old' } });
  });

  it('refuses without attempts, a prize, a quiz or an admin, and reports errors', async () => {
    adminDb.setTable('QuizAttempt', { data: null });
    expect((await run()).status).toBe(422);
    adminDb.setTable('QuizAttempt', { error: { message: 'x' } });
    expect((await run()).status).toBe(500);
    adminDb.setTable('Quiz', { data: { id: 'quiz-1' } });
    expect((await run()).status).toBe(422);
    adminDb.setTable('Quiz', { data: null });
    expect((await run()).status).toBe(404);
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await run()).status).toBe(401);
    expect((await draw.POST(makeRequest('/x', { method: 'POST' }), { params: Promise.resolve({ quizId: '' }) })).status).toBe(400);
  });

  it('covers every index of a large tie (the shuffle keeps re-seeding)', async () => {
    adminDb.setTable('QuizAttempt', { data: attempts(Array(60).fill(7)) });
    const body = await (await run({ numberOfWinners: 1 })).json();
    expect(body.draw.tiedCount).toBe(60);
    expect(body.winners).toHaveLength(1);
  });
});
