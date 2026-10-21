// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, authOk, type SupabaseMock } from '@/tests/helpers/supabase-mock';

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

  it('decides through the four-argument update_claim_status and tells the player, note included', async () => {
    adminDb.setTable('PrizeRedemption', { data: { userId: 'u1', pointsUsed: 100, Prize: { name: 'Smartwatch' } } });
    adminDb.setRpc('update_claim_status', { data: { success: true, status: 'approved', previousStatus: 'pending', pointsRefunded: 0 } });

    const res = await put({ claimId: 'c1', status: 'approved', notes: 'Ships on Monday' }, { 'x-forwarded-for': '1.1.1.1', 'user-agent': 'UA' });

    // All four arguments named: with three, PostgREST couldn't choose between production's two overloads (HTTP 300)
    expect(adminDb.rpcCalls).toEqual([{
      fn: 'update_claim_status',
      args: { p_claim_id: 'c1', p_status: 'approved', p_notes: 'Ships on Monday', p_admin_email: 'player@example.test' },
    }]);
    expect(await res.json()).toEqual({ message: 'Claim approved successfully', claim: { id: 'c1', status: 'approved' }, notified: true });
    expect(createNotification).toHaveBeenCalledWith('u1', {
      type: 'prize_claim',
      link: '/profile',
      title: '🎁 Prize claim approved',
      message: "Your claim for Smartwatch was approved. We'll contact you about delivery. Note from our team: Ships on Monday",
    });
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      ip: '1.1.1.1',
      userAgent: 'UA',
      details: { action: 'UPDATE_CLAIM_STATUS', claimId: 'c1', previousStatus: 'pending', newStatus: 'approved', pointsRefunded: 0, playerNotified: true },
    }));
    // No fallback to approve_claim and friends: they check is_admin(), which a server call never passes
    expect(adminDb.callsTo('User')).toHaveLength(0);
  });

  it('tells a rejected player their points came back, also before the migration (no previousStatus / pointsRefunded)', async () => {
    adminDb.setTable('PrizeRedemption', { data: { userId: 'u2', pointsUsed: 250, Prize: [{ name: 'Earbuds' }] } });
    adminDb.setRpc('update_claim_status', { data: { success: true, status: 'rejected', message: 'Claim status updated successfully' } });

    const body = await (await put({ claimId: 'c2', status: 'rejected' })).json();

    expect(body).toEqual({ message: 'Claim rejected successfully', claim: { id: 'c2', status: 'rejected' }, notified: true });
    expect(adminDb.rpcCalls[0].args).toEqual({ p_claim_id: 'c2', p_status: 'rejected', p_notes: null, p_admin_email: 'player@example.test' });
    expect(createNotification).toHaveBeenCalledWith('u2', expect.objectContaining({
      title: 'Prize claim rejected',
      message: 'Your claim for Earbuds was rejected, and your 250 points were refunded.',
    }));
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      ip: 'unknown',
      details: expect.objectContaining({ previousStatus: null, pointsRefunded: null }),
    }));

    // A claim whose prize was deleted still gets a readable message; an admin without an email leaves
    // "processed by" to the database
    adminDb.setTable('PrizeRedemption', { data: { userId: 'u3', pointsUsed: 50, Prize: null } });
    adminDb.setRpc('update_claim_status', { data: { success: true } });
    requireAuth.mockResolvedValueOnce(authOk('admin-1', ''));
    await put({ claimId: 'c3', status: 'fulfilled' });
    expect(adminDb.rpcCalls[1].args).toMatchObject({ p_admin_email: null });
    expect(createNotification).toHaveBeenLastCalledWith('u3', expect.objectContaining({
      title: '📦 Prize delivered',
      message: 'Your claim for the prize is marked as delivered.',
    }));

    // Sending a decided claim back to pending happens through Reissue; the player isn't told twice
    adminDb.setRpc('update_claim_status', { data: { success: true } });
    createNotification.mockClear();
    await put({ claimId: 'c3', status: 'pending' });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('relays a refusal and tells nobody', async () => {
    adminDb.setTable('PrizeRedemption', { data: { userId: 'u1', pointsUsed: 100, Prize: { name: 'Smartwatch' } } });
    adminDb.setRpc('update_claim_status', { data: { success: false, code: 'invalid_status', error: "This claim is approved, so it can't be marked approved" } });
    let res = await put({ claimId: 'c1', status: 'approved' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "This claim is approved, so it can't be marked approved" });

    adminDb.setRpc('update_claim_status', { data: { success: false, code: 'not_found', error: 'Claim not found' } });
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(404);
    adminDb.setRpc('update_claim_status', { data: null });
    res = await put({ claimId: 'c1', status: 'approved' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: 'Failed to update claim' });
    expect(createNotification).not.toHaveBeenCalled();
    expect(logger.logSecurityEvent).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown claim, 500 when the database fails, and keeps a decision whose notification failed', async () => {
    adminDb.setTable('PrizeRedemption', { data: null });
    expect((await put({ claimId: 'nope', status: 'approved' })).status).toBe(404);
    expect(adminDb.rpcCalls).toHaveLength(0);

    adminDb.setTable('PrizeRedemption', { error: { message: 'db down' } });
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(500);

    adminDb.setTable('PrizeRedemption', { data: { userId: 'u1', pointsUsed: 100, Prize: { name: 'Smartwatch' } } });
    adminDb.setRpc('update_claim_status', { error: { message: 'could not choose the best candidate function' } });
    expect((await put({ claimId: 'c1', status: 'approved' })).status).toBe(500);

    adminDb.setRpc('update_claim_status', { data: { success: true, status: 'approved' } });
    createNotification.mockRejectedValueOnce(new Error('push down'));
    const res = await put({ claimId: 'c1', status: 'approved' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ notified: false });
    expect(console.error).toHaveBeenCalledWith('[claims] Failed to notify the player:', expect.objectContaining({ message: 'push down' }));
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

    // 2. Refund instead, so the player may claim again (no status needed: reissue_claim sets it)
    adminDb.setRpc('reissue_claim', { data: { success: true, status: 'rejected', previousStatus: 'approved', pointsRefunded: 250 } });
    const reclaimRes = await put({ claimId: 'c2', action: 'reissue', reissueMode: 'reclaim' });
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

    // An admin session without an email leaves "processed by" to the database
    requireAuth.mockResolvedValueOnce(authOk('admin-1', ''));
    await put({ claimId: 'c3', action: 'reissue', reissueMode: 'redelivery' });
    expect(adminDb.rpcCalls[2].args).toMatchObject({ p_claim_id: 'c3', p_admin_email: null });
  });

  it("passes on reissue_claim's refusals, and reports database errors", async () => {
    adminDb.setRpc('reissue_claim', { data: { success: false, code: 'invalid_status', error: 'Only approved or fulfilled claims can be reissued (this one is rejected)' } });
    const refused = await put({ claimId: 'c1', status: 'pending', action: 'reissue', reissueMode: 'redelivery' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ message: 'Only approved or fulfilled claims can be reissued (this one is rejected)' });

    adminDb.setRpc('reissue_claim', { data: { success: false, code: 'not_found', error: 'Claim not found' } });
    expect((await put({ claimId: 'nope', action: 'reissue', reissueMode: 'reclaim' })).status).toBe(404);

    adminDb.setRpc('reissue_claim', { data: null });
    const empty = await put({ claimId: 'c1', action: 'reissue', reissueMode: 'reclaim' });
    expect(empty.status).toBe(409);
    expect(await empty.json()).toEqual({ message: 'Failed to reissue claim' });

    adminDb.setRpc('reissue_claim', { error: { message: 'function reissue_claim does not exist' } });
    expect((await put({ claimId: 'c1', action: 'reissue', reissueMode: 'reclaim' })).status).toBe(500);
  });

  it('needs a mode for a reissue and a status for an update', async () => {
    for (const body of [
      { claimId: 'c1', status: 'rejected', action: 'reissue' },
      { claimId: 'c1', action: 'reissue', reissueMode: 'refund' },
      { claimId: 'c1', notes: 'no status' },
      { claimId: 'c1', action: 'update' },
    ]) {
      expect((await put(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(adminDb.rpcCalls).toHaveLength(0);
  });
});

