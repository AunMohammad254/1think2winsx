// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, eqValue, argOf, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
const auth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();
const logger = { logUnauthorizedAccess: vi.fn(), logInvalidInput: vi.fn(), logSecurityEvent: vi.fn() };

vi.mock('@/lib/supabase/db', () => ({
  getDb: async () => db.client,
  // Claim tracking (the timeline, where a claim came from) reads and writes with the server key
  getAdminDb: () => db.client,
  generateId: () => 'gen-id',
  prizeDb: {},
  userDb: {},
  prizeRedemptionDb: {},
}));
vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { prizeRedemption: 'prizeRedemption', general: 'general' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: logger }));

const redemptionRoute = await import('@/app/api/prize-redemption/route');
const prizesRoute = await import('@/app/api/prizes/route');

const session = (over: Record<string, unknown> = {}) => ({ user: { id: 'user-1', email: 'player@example.test', ...over }, expires: 'later' });
const prize = (over: Record<string, unknown> = {}) => ({ id: 'prize-1', name: 'Smart Watch', pointsRequired: 250, isActive: true, stock: 5, ...over });
const okForm = { prizeId: 'prize-1', fullName: 'Ali Khan', whatsappNumber: '+923001234567', address: 'House 1, Street 2, Lahore' };

beforeEach(() => {
  db = createSupabaseMock();
  for (const fn of [auth, requireCSRFToken, applyRateLimit, recordSecurityEvent, ...Object.values(logger)]) fn.mockReset();
  auth.mockResolvedValue(session());
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/prize-redemption', () => {
  const redeem = (body: unknown = okForm, headers: Record<string, string> = {}) =>
    redemptionRoute.POST(makeRequest('/api/prize-redemption', { body, headers }));

  it('redeems atomically through redeem_prize and reports the new balance', async () => {
    db.setTable('User', { data: { id: 'user-1', points: 400 } });
    db.setTable('Prize', { data: prize() });
    db.setRpc('redeem_prize', { data: { success: true, redemption_id: 'red-1', points_used: 250, new_balance: 150 } });

    const res = await redeem(okForm, { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'jest' });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(db.rpcCalls[0]).toEqual({
      fn: 'redeem_prize',
      args: { p_user_id: 'user-1', p_prize_id: 'prize-1', p_full_name: 'Ali Khan', p_whatsapp_number: '+923001234567', p_address: 'House 1, Street 2, Lahore' },
    });
    expect(body.redemption).toEqual({ id: 'red-1', prizeName: 'Smart Watch', pointsUsed: 250, status: 'pending', newBalance: 150 });
    // Where it came from, for the risk flags
    expect(db.rpcCalls[1]).toEqual({
      fn: 'record_claim_origin',
      args: { p_claim_id: 'red-1', p_user_id: 'user-1', p_ip: '1.2.3.4', p_user_agent: 'jest' },
    });
    expect(eqValue(db.callsTo('User')[0], 'email')).toBe('player@example.test');
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'PRIZE_REDEMPTION', userId: 'user-1', ip: '1.2.3.4', userAgent: 'jest' }));
  });

  it('sends nulls for omitted delivery details and falls back to the prize cost', async () => {
    db.setTable('User', { data: { id: 'user-1', points: 400 } });
    db.setTable('Prize', { data: prize({ stock: null }) });
    db.setRpc('redeem_prize', { data: null });

    const body = await (await redeem({ prizeId: 'prize-1' })).json();

    expect(db.rpcCalls[0].args).toMatchObject({ p_full_name: null, p_whatsapp_number: null, p_address: null });
    expect(body.redemption).toEqual({ prizeName: 'Smart Watch', pointsUsed: 250, status: 'pending' });
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ ip: 'unknown', userAgent: undefined }));
  });

  it('refuses before touching the database when points are short or the prize is gone', async () => {
    db.setTable('User', { data: { id: 'user-1', points: 100 } });
    db.setTable('Prize', { data: prize() });
    let res = await redeem();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: 'Insufficient points', required: 250, available: 100 });

    db.setTable('Prize', { data: prize({ stock: 0 }) });
    res = await redeem();
    expect((await res.json()).message).toBe('This prize is currently out of stock');

    for (const p of [{ data: null }, { data: prize({ isActive: false }) }, { error: { message: 'x' } }]) {
      db.setTable('Prize', p);
      expect((await redeem()).status).toBe(404);
    }
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('returns 404 when the player row is missing', async () => {
    db.setTable('User', { data: null, error: { message: 'no rows' } });
    expect((await redeem()).status).toBe(404);
  });

  it('passes on the reason the database refused', async () => {
    db.setTable('User', { data: { id: 'user-1', points: 400 } });
    db.setTable('Prize', { data: prize() });
    db.setRpc('redeem_prize', { data: { success: false, error: 'Insufficient points', required: 250, available: 10 } });
    let res = await redeem();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: 'Insufficient points', required: 250, available: 10 });

    db.setRpc('redeem_prize', { data: { success: false } });
    res = await redeem();
    expect((await res.json()).message).toBe('Redemption failed');
  });

  it('does not fall back to a non-atomic redemption when the RPC errors', async () => {
    db.setTable('User', { data: { id: 'user-1', points: 400 } });
    db.setTable('Prize', { data: prize() });
    db.setRpc('redeem_prize', { error: { message: 'function redeem_prize does not exist' } });

    const res = await redeem();

    expect(res.status).toBe(500);
    expect(db.callsTo('User', 'update')).toHaveLength(0);
    expect(db.callsTo('PrizeRedemption', 'insert')).toHaveLength(0);
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'API_ERROR', details: { error: 'Unknown error', action: 'REDEEM_PRIZE' } }));
  });

  it('validates the form', async () => {
    for (const body of [{}, { prizeId: 'p', fullName: 'A' }, { prizeId: 'p', whatsappNumber: 'call me' }, { prizeId: 'p', address: 'short' }]) {
      const res = await redeem(body);
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe('Invalid input');
    }
    expect(logger.logInvalidInput).toHaveBeenCalledTimes(4);
  });

  it('needs an email in the session', async () => {
    auth.mockResolvedValue(session({ email: undefined }));
    const res = await redeem();
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('User email not found in session');
  });

  it('stops at CSRF, the rate limit and missing sessions', async () => {
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await redeem()).status).toBe(403);

    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await redeem()).status).toBe(429);
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), undefined, { endpoint: '/api/prize-redemption', rateLimiter: 'prizeRedemption' });

    auth.mockResolvedValueOnce(null);
    expect((await redeem()).status).toBe(401);
    auth.mockResolvedValueOnce({ user: null });
    expect((await redeem()).status).toBe(401);
    expect(logger.logUnauthorizedAccess).toHaveBeenCalledTimes(2);
  });

  it('logs thrown errors with their message', async () => {
    auth.mockRejectedValue(new Error('auth down'));
    const res = await redeem(okForm, { 'x-forwarded-for': '9.9.9.9' });
    expect(res.status).toBe(500);
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ ip: '9.9.9.9', details: { error: 'auth down', action: 'REDEEM_PRIZE' } }));
  });

  it('answers 400 for a ZodError thrown inside the handler', async () => {
    const { z } = await import('zod');
    auth.mockRejectedValue(new z.ZodError([]));
    const res = await redeem();
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Invalid input data');
  });
});

describe('GET /api/prize-redemption', () => {
  const history = (headers: Record<string, string> = {}) => redemptionRoute.GET(makeRequest('/api/prize-redemption', { headers }));

  it("lists the player's redemptions newest first, flattening the prize join, with each one's timeline", async () => {
    vi.stubEnv('CLAIM_HANDOVER_SECRET', 'test-handover-secret');
    db.setTable('User', { data: { id: 'user-1' } });
    db.setTable('PrizeRedemption', { data: [
      { id: 'r1', status: 'pending', Prize: [{ name: 'Watch' }] },
      { id: 'r2', status: 'approved', handoverVersion: 1, Prize: { name: 'Phone' } },
    ] });
    db.setTable('PrizeClaimEvent', { data: [
      { claimId: 'r2', event: 'submitted', note: null, createdAt: '2026-10-01T10:00:00Z' },
      { claimId: 'r2', event: 'approved', note: 'Calling you Monday', createdAt: '2026-10-02T10:00:00Z' },
    ] });

    const body = await (await history()).json();

    const { handoverCode } = await import('@/lib/claim-tracking');
    expect(body.redemptions).toEqual([
      { id: 'r1', status: 'pending', Prize: [{ name: 'Watch' }], prize: { name: 'Watch' }, handoverCode: null, timeline: [] },
      {
        id: 'r2', status: 'approved', handoverVersion: 1, Prize: { name: 'Phone' }, prize: { name: 'Phone' },
        // Only an approved claim shows its code; an approval's note stays with the admins
        handoverCode: handoverCode('r2', 1),
        timeline: [{ event: 'submitted', at: '2026-10-01T10:00:00Z' }, { event: 'approved', at: '2026-10-02T10:00:00Z' }],
      },
    ]);
    expect(body.redemptions[1].handoverCode).toMatch(/^\d{6}$/);
    const call = db.callsTo('PrizeRedemption')[0];
    expect(eqValue(call, 'userId')).toBe('user-1');
    expect(argOf(call, 'order')).toBe('requestedAt');
  });

  it('returns an empty list for an unsynced account or no rows', async () => {
    db.setTable('User', { data: null });
    let body = await (await history()).json();
    expect(body.redemptions).toEqual([]);
    db.setTable('User', { data: { id: 'user-1' } });
    db.setTable('PrizeRedemption', { data: null });
    body = await (await history()).json();
    expect(body.redemptions).toEqual([]);
  });

  it('requires a signed-in user with an email', async () => {
    for (const s of [null, { user: null }, session({ email: undefined })]) {
      auth.mockResolvedValueOnce(s);
      expect((await history()).status).toBe(401);
    }
  });

  it('honours the rate limit', async () => {
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await history()).status).toBe(429);
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), undefined, { endpoint: '/api/prize-redemption', rateLimiter: 'general' });
  });

  it('returns 500 when the query fails', async () => {
    db.setTable('User', { data: { id: 'user-1' } });
    db.setTable('PrizeRedemption', { error: new Error('timeout') });
    const res = await history({ 'x-forwarded-for': '5.5.5.5', 'user-agent': 'ua' });
    expect(res.status).toBe(500);
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ ip: '5.5.5.5', userAgent: 'ua', details: { error: 'timeout', action: 'GET_REDEMPTION_HISTORY' } }));
    db.setTable('PrizeRedemption', { error: { message: 'plain object' } });
    await history();
    expect(logger.logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ ip: 'unknown', details: { error: 'Unknown error', action: 'GET_REDEMPTION_HISTORY' } }));
  });
});

describe('GET /api/prizes', () => {
  it('returns the active prizes cheapest first', async () => {
    db.setTable('Prize', { data: [prize()] });
    const res = await prizesRoute.GET();
    expect(await res.json()).toEqual({ success: true, data: [prize()], message: 'Prizes retrieved successfully' });
    expect(argOf(db.callsTo('Prize')[0], 'order')).toBe('pointsRequired');
  });

  it('seeds four default prizes when the table is empty (a public GET that writes)', async () => {
    db.setTable('Prize', [{ data: [] }, { data: null }, { data: [prize({ name: 'Wireless Earbuds' })] }]);
    const body = await (await prizesRoute.GET()).json();
    const insert = db.callsTo('Prize', 'insert')[0];
    expect((argOf(insert, 'insert') as unknown[]).map((p) => (p as { name: string }).name)).toEqual(['Wireless Earbuds', 'Smart Watch', 'Android Phone', 'CD 70 Bike']);
    expect(body.data[0].name).toBe('Wireless Earbuds');
  });

  it('returns 500 when reading or seeding fails', async () => {
    db.setTable('Prize', { error: { message: 'boom' } });
    expect((await prizesRoute.GET()).status).toBe(500);
    db.setTable('Prize', [{ data: null }, { error: { message: 'rls' } }]);
    expect((await prizesRoute.GET()).status).toBe(500);
  });
});

describe('POST /api/prizes', () => {
  const post = (body: unknown) => prizesRoute.POST(makeRequest('/api/prizes', { body }));

  describe('redeem action', () => {
    beforeEach(() => {
      db.setTable('User', { data: { points: 400 } });
      db.setTable('Prize', { data: prize() });
    });

    it('redeems through the RPC when there is no pending request', async () => {
      db.setRpc('redeem_prize', { data: { success: true, redemption_id: 'red-9', points_used: 250, new_balance: 150 } });
      const res = await post({ action: 'redeem', prizeId: 'prize-1' });
      expect(res.status).toBe(201);
      expect((await res.json()).redemption).toMatchObject({ id: 'red-9', pointsUsed: 250, newBalance: 150, prize: { id: 'prize-1' } });
      expect(db.rpcCalls[0]).toEqual({ fn: 'redeem_prize', args: { p_user_id: 'user-1', p_prize_id: 'prize-1' } });
    });

    it('succeeds when the RPC returns no result body', async () => {
      db.setRpc('redeem_prize', { data: null });
      const res = await post({ action: 'redeem', prizeId: 'prize-1' });
      expect(res.status).toBe(201);
    });

    it("passes on redeem_prize's refusal of a prize the player already claimed", async () => {
      const already = 'You have already claimed this prize. Each prize can only be claimed once per account.';
      db.setRpc('redeem_prize', { data: { success: false, code: 'already_claimed', error: already } });
      const res = await post({ action: 'redeem', prizeId: 'prize-1' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: already });
    });

    it('checks the player, prize and balance first', async () => {
      db.setTable('User', { data: null });
      expect((await post({ action: 'redeem', prizeId: 'prize-1' })).status).toBe(404);
      db.setTable('User', { data: { points: 400 } });
      db.setTable('Prize', { data: prize({ isActive: false }) });
      expect((await post({ action: 'redeem', prizeId: 'prize-1' })).status).toBe(404);
      db.setTable('Prize', { data: prize({ pointsRequired: 900 }) });
      const res = await post({ action: 'redeem', prizeId: 'prize-1' });
      expect(await res.json()).toEqual({ message: 'Insufficient points', required: 900, available: 400 });
      expect((await post({ action: 'redeem' })).status).toBe(400);
    });

    it('relays an RPC refusal', async () => {
      db.setRpc('redeem_prize', { data: { success: false, error: 'Out of stock' } });
      expect(await (await post({ action: 'redeem', prizeId: 'prize-1' })).json()).toEqual({ message: 'Out of stock' });
      db.setRpc('redeem_prize', { data: { success: false } });
      expect(await (await post({ action: 'redeem', prizeId: 'prize-1' })).json()).toEqual({ message: 'Redemption failed' });
    });

    it('falls back to a NON-atomic deduct-then-insert when the RPC error mentions "function"', async () => {
      db.setRpc('redeem_prize', { error: { message: 'function redeem_prize(text, text) does not exist' } });
      db.setTable('PrizeRedemption', { data: { id: 'gen-id', Prize: [{ name: 'Smart Watch' }] } });

      const res = await post({ action: 'redeem', prizeId: 'prize-1' });

      expect(res.status).toBe(201);
      const update = db.callsTo('User', 'update')[0];
      expect(argOf(update, 'update')).toMatchObject({ points: 150 });
      expect(argOf(db.callsTo('PrizeRedemption', 'insert')[0], 'insert')).toMatchObject({ id: 'gen-id', userId: 'user-1', prizeId: 'prize-1', pointsUsed: 250, status: 'pending' });
      expect((await res.json()).redemption.prize).toEqual({ name: 'Smart Watch' });
    });

    it('also takes the fallback for Postgres error 42883 and fails if the insert fails', async () => {
      db.setRpc('redeem_prize', { error: { code: '42883', message: 'undefined' } });
      db.setTable('PrizeRedemption', { data: { id: 'x', Prize: { name: 'Watch' } } });
      expect((await post({ action: 'redeem', prizeId: 'prize-1' })).status).toBe(201);

      db.setTable('PrizeRedemption', { error: { message: 'insert failed' } });
      expect((await post({ action: 'redeem', prizeId: 'prize-1' })).status).toBe(500);
    });

    it('rethrows other RPC errors', async () => {
      db.setRpc('redeem_prize', { error: { code: '40001', message: 'serialization failure' } });
      expect((await post({ action: 'redeem', prizeId: 'prize-1' })).status).toBe(500);
    });
  });

  describe('admin prize creation', () => {
    beforeEach(() => vi.stubEnv('ADMIN_EMAILS', 'boss@example.test,player@example.test'));

    it('creates a prize for an admin', async () => {
      db.setTable('Prize', { data: { id: 'gen-id', name: 'Bike' } });
      const res = await post({ name: 'Bike', type: 'bike', pointsRequired: '1000', imageUrl: '/bike.svg' });
      expect(res.status).toBe(201);
      expect(argOf(db.callsTo('Prize', 'insert')[0], 'insert')).toMatchObject({ name: 'Bike', type: 'bike', pointsRequired: 1000, isActive: true });
    });

    it('rejects image hosts next/image cannot load', async () => {
      const res = await post({ name: 'Bike', type: 'bike', pointsRequired: 10, imageUrl: 'https://evil.example/x.png' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Invalid image URL');
      expect((await post({ name: 'Bike', type: 'bike', pointsRequired: 10, imageUrl: 42 })).status).toBe(400);
    });

    it('requires name, type and points', async () => {
      expect((await post({ name: 'Bike' })).status).toBe(400);
    });

    it('forbids non-admins and handles a missing env list or email', async () => {
      vi.stubEnv('ADMIN_EMAILS', 'boss@example.test');
      expect((await post({ name: 'Bike', type: 'bike', pointsRequired: 1 })).status).toBe(403);
      vi.unstubAllEnvs();
      delete process.env.ADMIN_EMAILS;
      auth.mockResolvedValue(session({ email: undefined }));
      expect((await post({ name: 'Bike', type: 'bike', pointsRequired: 1 })).status).toBe(403);
    });

    it('returns 500 when the insert fails', async () => {
      db.setTable('Prize', { error: { message: 'dup' } });
      expect((await post({ name: 'Bike', type: 'bike', pointsRequired: 1 })).status).toBe(500);
    });
  });

  it('requires a session', async () => {
    auth.mockResolvedValueOnce(null);
    expect((await post({ action: 'redeem' })).status).toBe(401);
    auth.mockResolvedValueOnce({});
    expect((await post({ action: 'redeem' })).status).toBe(401);
    expect(logger.logUnauthorizedAccess).toHaveBeenCalledTimes(2);
  });
});
