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
const countByStatus = vi.fn();
const statusCounts = { pending: 2, approved: 1, fulfilled: 0, rejected: 4 };
const winnerDb = { findByQuizId: vi.fn(), existsForQuiz: vi.fn(), create: vi.fn(), markNotificationSent: vi.fn() };
const createNotification = vi.fn();

vi.mock('@/lib/supabase/db', async () => {
  const shared = await vi.importActual<typeof import('@/lib/supabase/db-modules/shared')>('@/lib/supabase/db-modules/shared');
  return {
    getAdminDb: () => adminDb.client,
    mapWithConcurrency: shared.mapWithConcurrency,
    prizeRedemptionDb: { findAllAdmin: (...a: unknown[]) => findAllAdmin(...a), countByStatus: (...a: unknown[]) => countByStatus(...a) },
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

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [requireAuth, requireCSRFToken, applyRateLimit, recordSecurityEvent, validateAdminSession, findAllAdmin, countByStatus, createNotification, ...Object.values(logger), ...Object.values(winnerDb)]) fn.mockReset();
  requireAuth.mockResolvedValue(authOk('admin-1'));
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  validateAdminSession.mockResolvedValue({ valid: true, email: 'boss@example.test' });
  countByStatus.mockResolvedValue(statusCounts);
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
    expect(body).toEqual({ claims: [{ id: 'c1' }], pagination: { page: 1 }, statusCounts });
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADMIN_ACCESS', ip: '9.9.9.9', userAgent: 'UA', details: expect.objectContaining({ method: 'supabase_rpc', resultCount: 1 }) }));
    adminDb.setRpc('get_admin_claims', { data: { success: true } });
    expect((await (await get()).json()).claims).toEqual([]);
  });

  it('falls back to a direct query when the RPC fails or throws', async () => {
    adminDb.setRpc('get_admin_claims', { error: { message: 'missing' } });
    findAllAdmin.mockResolvedValue({ data: [{ id: 'c1', User: [{ name: 'A' }], Prize: { name: 'Watch' } }], page: 2, limit: 20, count: 21, totalPages: 2 });
    const body = await (await get('?page=2', { 'x-forwarded-for': '1.1.1.1' })).json();
    expect(findAllAdmin).toHaveBeenCalledWith({ status: undefined, page: 2, limit: 20 });
    expect(body).toEqual({ claims: [{ id: 'c1', User: [{ name: 'A' }], Prize: { name: 'Watch' }, user: { name: 'A' }, prize: { name: 'Watch' } }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 }, statusCounts });

    // PostgREST returns a to-one join as an object or a one-element array; both are flattened
    findAllAdmin.mockResolvedValue({ data: [{ id: 'c2', User: { name: 'B' }, Prize: [{ name: 'Bike' }] }], page: 1, limit: 20, count: 1, totalPages: 1 });
    expect((await (await get()).json()).claims[0]).toMatchObject({ user: { name: 'B' }, prize: { name: 'Bike' } });

    adminDb.client.rpc.mockImplementationOnce(() => { throw new Error('rpc down'); });
    findAllAdmin.mockResolvedValue({ data: null, page: 1, limit: 20, count: 0, totalPages: 0 });
    expect((await (await get()).json()).claims).toEqual([]);
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: 'unknown' }));
  });

  it('still lists claims when the status totals cannot be counted', async () => {
    countByStatus.mockRejectedValueOnce(new Error('count down'));
    adminDb.setRpc('get_admin_claims', { data: { success: true, claims: [{ id: 'c1' }], pagination: { page: 1 } } });
    expect(await (await get()).json()).toEqual({ claims: [{ id: 'c1' }], pagination: { page: 1 }, statusCounts: null });
    expect(console.warn).toHaveBeenCalledWith('Failed to count claims by status:', expect.objectContaining({ message: 'count down' }));
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
    await put({ claimId: 'c1', status: 'rejected' });
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: 'unknown', details: expect.objectContaining({ method: 'supabase_rpc_reject' }) }));

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

  it('reissues through reissue_claim, which moves the points and stock in the database', async () => {
    // 1. Send it again
    adminDb.setRpc('reissue_claim', { data: { success: true, status: 'pending', previousStatus: 'fulfilled', pointsRefunded: 0 } });
    const redeliveryRes = await put({
      claimId: 'c1',
      status: 'pending',
      action: 'reissue',
      reissueMode: 'redelivery',
      notes: 'Customer reported missing package',
    });
    expect(redeliveryRes.status).toBe(200);
    expect(await redeliveryRes.json()).toEqual({
      message: 'Claim reissued for re-delivery successfully',
      claim: { id: 'c1', status: 'pending' },
    });
    expect(adminDb.rpcCalls[0]).toEqual({
      fn: 'reissue_claim',
      args: { p_claim_id: 'c1', p_mode: 'redelivery', p_notes: 'Customer reported missing package', p_admin_email: 'player@example.test' },
    });

    // 2. Refund instead, so the player may claim again (the mode follows the status when not given)
    adminDb.setRpc('reissue_claim', { data: { success: true, status: 'rejected', previousStatus: 'approved', pointsRefunded: 250 } });
    const reclaimRes = await put({ claimId: 'c2', status: 'rejected', action: 'reissue' });
    expect(reclaimRes.status).toBe(200);
    expect(await reclaimRes.json()).toEqual({
      message: 'Claim reissued. Points refunded and player may now re-claim this reward.',
      claim: { id: 'c2', status: 'rejected' },
    });
    expect(adminDb.rpcCalls[1].args).toMatchObject({ p_claim_id: 'c2', p_mode: 'reclaim', p_notes: null });
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      details: { action: 'REISSUE_CLAIM_ALLOW_RECLAIM', claimId: 'c2', previousStatus: 'approved', pointsRefunded: 250 },
    }));
    expect(adminDb.callsTo('User')).toHaveLength(0);
    expect(adminDb.callsTo('Prize')).toHaveLength(0);
  });

  it("passes on reissue_claim's refusals, and reports database errors", async () => {
    adminDb.setRpc('reissue_claim', { data: { success: false, code: 'invalid_status', error: 'Only approved or fulfilled claims can be reissued (this one is rejected)' } });
    const refused = await put({ claimId: 'c1', status: 'pending', action: 'reissue', reissueMode: 'redelivery' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ message: 'Only approved or fulfilled claims can be reissued (this one is rejected)' });

    adminDb.setRpc('reissue_claim', { data: { success: false, code: 'not_found', error: 'Claim not found' } });
    expect((await put({ claimId: 'nope', status: 'rejected', action: 'reissue' })).status).toBe(404);

    adminDb.setRpc('reissue_claim', { data: null });
    const empty = await put({ claimId: 'c1', status: 'rejected', action: 'reissue' });
    expect(empty.status).toBe(409);
    expect(await empty.json()).toEqual({ message: 'Failed to reissue claim' });

    adminDb.setRpc('reissue_claim', { error: { message: 'function reissue_claim does not exist' } });
    expect((await put({ claimId: 'c1', status: 'rejected', action: 'reissue' })).status).toBe(500);
  });
});

