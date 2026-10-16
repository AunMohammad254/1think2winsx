// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, authOk, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const requireAuth = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();
const validateAdminSession = vi.fn();
const auth = vi.fn();
const findByUserId = vi.fn();
const logger = { logUnauthorizedAccess: vi.fn(), logSecurityEvent: vi.fn() };

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client, prizeRedemptionDb: { findByUserId: (...a: unknown[]) => findByUserId(...a) } }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: (...a: unknown[]) => validateAdminSession(...a) }));
vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { admin: 'admin' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: logger }));

const stats = await import('@/app/api/admin/stats/route');
const dbStats = await import('@/app/api/admin/db-stats/route');
const embed = await import('@/app/api/admin/stream-embed/route');
const verify = await import('@/app/api/admin/verify/route');
const redemptions = await import('@/app/api/user/redemptions/route');

const isHead = (call: { ops: { op: string; args: unknown[] }[] }) => call.ops.some((o) => o.op === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head);
const recent = (call: { ops: { op: string }[] }) => call.ops.some((o) => o.op === 'gte');

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [requireAuth, applyRateLimit, recordSecurityEvent, validateAdminSession, auth, findByUserId, ...Object.values(logger)]) fn.mockReset();
  requireAuth.mockResolvedValue(authOk('admin-1', 'boss@example.test'));
  applyRateLimit.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/admin/stats', () => {
  const get = () => stats.GET(makeRequest('/api/admin/stats'));

  it('returns counts, recent activity, revenue and the average score, cached for a minute', async () => {
    adminDb.setTable('*', (call) => (isHead(call) ? { count: recent(call) ? 2 : 10 } : { data: [{ amount: 100 }, { amount: null }, { amount: 50 }] }));
    adminDb.setRpc('get_quiz_attempt_avg_score', { data: '72.456' });

    const res = await get();

    expect(await res.json()).toEqual({
      totalUsers: 10, totalQuizzes: 10, totalQuizAttempts: 10, totalPayments: 10, totalPrizes: 10,
      recentUsers: 2, recentQuizAttempts: 2, totalRevenue: 150, averageScore: 72.46, paymentsByStatus: [],
    });
    expect(eqValue(adminDb.calls.find((c) => c.table === 'Payment' && !isHead(c)), 'status')).toBe('completed');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60, stale-while-revalidate=30');
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADMIN_ACCESS' }), expect.anything());
  });

  it('defaults everything to zero on an empty database', async () => {
    adminDb.setTable('*', { data: null, count: null });
    adminDb.setRpc('get_quiz_attempt_avg_score', { data: null });
    expect(await (await get()).json()).toMatchObject({ totalUsers: 0, recentUsers: 0, totalRevenue: 0, averageScore: 0 });
  });

  it('logs refused access, honours the rate limit and reports errors', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await get()).status).toBe(403);
    expect(logger.logUnauthorizedAccess).toHaveBeenCalledWith(undefined, '/api/admin/stats', expect.anything());
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await get()).status).toBe(429);
    adminDb.client.from.mockImplementation(() => { throw new Error('db'); });
    expect((await get()).status).toBe(500);
  });
});

describe('GET /api/admin/db-stats', () => {
  const get = () => dbStats.GET(makeRequest('/api/admin/db-stats'));

  it('builds the overview, recent activity, top quizzes and prize distribution', async () => {
    adminDb.setTable('*', (call) => {
      if (isHead(call)) return { count: recent(call) ? 1 : eqValue(call, 'isCompleted') ? 3 : 4 };
      return { data: [{ id: 'q1', title: 'A' }, { id: 'q2', title: 'B' }, { id: 'q3', title: 'C' }] };
    });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { data: [{ quiz_id: 'q2', attempt_count: '9' }, { quiz_id: 'q1', attempt_count: '2' }] });
    adminDb.setRpc('get_quiz_attempt_avg_score', { data: 66.666 });
    adminDb.setRpc('get_prize_distribution', { data: [{ prize_id: 'p', prize_name: 'Watch', prize_type: 'watch', win_count: '3' }, { prize_id: 'x', win_count: 1 }] });

    const body = await (await get()).json();

    expect(body.overview).toEqual({ totalUsers: 4, totalQuizzes: 4, totalQuestions: 4, totalAttempts: 4, totalPayments: 4, totalWinnings: 4, averageScore: 66.67, completionRate: 75 });
    expect(body.recentActivity).toEqual({ newUsers: 1, newAttempts: 1, newPayments: 1, newWinnings: 1 });
    expect(body.topQuizzes).toEqual([{ id: 'q2', title: 'B', attemptCount: 9 }, { id: 'q1', title: 'A', attemptCount: 2 }, { id: 'q3', title: 'C', attemptCount: 0 }]);
    expect(body.prizeDistribution).toEqual([{ prizeId: 'p', prizeName: 'Watch', prizeType: 'watch', count: 3 }, { prizeId: 'x', prizeName: 'Unknown', prizeType: 'Unknown', count: 1 }]);
  });

  it('handles an empty database without the batch RPC', async () => {
    adminDb.setTable('*', { data: null, count: null });
    const body = await (await get()).json();
    expect(body.overview).toMatchObject({ totalAttempts: 0, completionRate: 0, averageScore: 0 });
    expect(body.topQuizzes).toEqual([]);
    expect(body.prizeDistribution).toEqual([]);
    expect(adminDb.rpcCalls.map((c) => c.fn)).not.toContain('get_quiz_attempt_counts_by_quiz');
  });

  it('logs refused access, honours the rate limit and reports errors', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await get()).status).toBe(403);
    expect(logger.logUnauthorizedAccess).toHaveBeenCalled();
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await get()).status).toBe(429);
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), 'admin-1', { endpoint: '/api/admin/db-stats', rateLimiter: 'admin' });
    adminDb.client.from.mockImplementation(() => { throw new Error('db'); });
    expect((await get()).status).toBe(500);
  });
});

describe('/api/admin/stream-embed', () => {
  const post = (body: unknown) => embed.POST(makeRequest('/api/admin/stream-embed', { body }));

  it('GET returns the saved stream with defaults', async () => {
    adminDb.setRpc('get_live_stream_config', { data: { embedHtml: '<iframe/>', embedUrl: 'u', title: 'T', platform: 'youtube', isActive: true, updatedAt: 'w', updatedBy: 'boss' } });
    expect(await (await embed.GET(makeRequest('/x'))).json()).toEqual({ success: true, embedHtml: '<iframe/>', embedUrl: 'u', title: 'T', platform: 'youtube', isActive: true, updatedAt: 'w', updatedBy: 'boss' });
    adminDb.setRpc('get_live_stream_config', { data: null });
    expect(await (await embed.GET(makeRequest('/x'))).json()).toEqual({ success: true, embedHtml: '', embedUrl: null, title: 'Livestream', platform: 'custom', isActive: false });
  });

  it('GET refuses non-admins and reports errors', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await embed.GET(makeRequest('/x'))).status).toBe(403);
    adminDb.setRpc('get_live_stream_config', { error: { message: 'rpc' } });
    expect(await (await embed.GET(makeRequest('/x'))).json()).toEqual({ success: false, embedHtml: '', error: 'rpc' });
    adminDb.client.rpc.mockImplementationOnce(() => { throw new Error('boom'); });
    expect((await (await embed.GET(makeRequest('/x'))).json()).error).toBe('boom');
    adminDb.client.rpc.mockImplementationOnce(() => { throw 'odd'; });
    expect((await (await embed.GET(makeRequest('/x'))).json()).error).toBe('Unknown error');
  });

  it('POST sanitises the embed HTML to an allow-list before saving', async () => {
    adminDb.setRpc('update_live_stream_config', (args) => ({ data: { success: true, embedHtml: args.p_embed_html, title: args.p_title, isActive: args.p_is_active } }));
    const dirty = '<iframe src="https://www.youtube.com/embed/x" onload="evil()"></iframe><script>alert(1)</script><iframe src="https://evil.example/x"></iframe><img src=x onerror=alert(1)>';

    const body = await (await post({ embedHtml: dirty })).json();

    const saved = adminDb.rpcCalls[0].args;
    expect(saved).toMatchObject({ p_embed_url: null, p_title: 'Livestream', p_platform: 'custom', p_is_active: true, p_admin_email: 'boss@example.test' });
    expect(saved.p_embed_html).toContain('src="https://www.youtube.com/embed/x"');
    for (const bad of ['onload', '<script', 'evil.example', '<img', 'onerror']) expect(saved.p_embed_html).not.toContain(bad);
    expect(body.success).toBe(true);
  });

  it('POST accepts a URL alone and validates the input', async () => {
    adminDb.setRpc('update_live_stream_config', { data: { success: true } });
    await post({ embedUrl: 'https://youtube.com/live', title: 'Final', platform: 'youtube', isActive: false });
    expect(adminDb.rpcCalls[0].args).toMatchObject({ p_embed_html: null, p_embed_url: 'https://youtube.com/live', p_is_active: false });
    expect((await (await post({})).json()).error).toBe('Either embedHtml or embedUrl is required');
    expect((await (await post({ embedHtml: '<p>x</p>' })).json()).error).toBe('Embed HTML is required (minimum 10 characters)');
  });

  it('POST reports RPC failures and refusals', async () => {
    requireAuth.mockResolvedValue({ ...authOk('a'), user: { id: 'a' } });
    adminDb.setRpc('update_live_stream_config', { error: { message: 'rpc' } });
    expect(await (await post({ embedUrl: 'u' })).json()).toEqual({ success: false, error: 'rpc' });
    adminDb.setRpc('update_live_stream_config', { data: { success: false, error: 'locked' } });
    expect((await (await post({ embedUrl: 'u' })).json()).error).toBe('locked');
    adminDb.setRpc('update_live_stream_config', { data: null });
    expect((await (await post({ embedUrl: 'u' })).json()).error).toBe('Failed to save stream configuration');
    expect(adminDb.rpcCalls.at(-1)!.args.p_admin_email).toBe('admin');
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post({ embedUrl: 'u' })).status).toBe(403);
    expect((await (await embed.POST(makeRequest('/x', { method: 'POST', rawBody: 'bad' }))).json()).error).toMatch(/JSON|Unexpected/);
    requireAuth.mockRejectedValueOnce('odd');
    expect((await (await post({ embedUrl: 'u' })).json()).error).toBe('Failed to save embed code');
  });
});

describe('GET /api/admin/verify and /api/user/redemptions', () => {
  it('verify reports the admin session', async () => {
    validateAdminSession.mockResolvedValueOnce({ valid: true, email: 'boss@x' });
    expect(await (await verify.GET()).json()).toEqual({ isAdmin: true, email: 'boss@x' });
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await verify.GET()).status).toBe(401);
    validateAdminSession.mockRejectedValueOnce(new Error('x'));
    expect((await verify.GET()).status).toBe(500);
  });

  it("redemptions lists the signed-in player's history", async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findByUserId.mockResolvedValue([{ id: 'r' }]);
    expect(await (await redemptions.GET()).json()).toEqual({ success: true, data: [{ id: 'r' }] });
    expect(findByUserId).toHaveBeenCalledWith('u1');
    findByUserId.mockRejectedValueOnce(new Error('db'));
    expect((await redemptions.GET()).status).toBe(500);
    auth.mockResolvedValueOnce(null);
    expect((await redemptions.GET()).status).toBe(401);
    auth.mockResolvedValueOnce({ user: null });
    expect((await redemptions.GET()).status).toBe(401);
  });
});
