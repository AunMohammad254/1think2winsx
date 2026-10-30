// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, authOk, eqValue, argOf, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
let adminDb: SupabaseMock;
let serverClient: SupabaseMock;
const dailyPaymentDb = { findFirstActive: vi.fn(), findMany: vi.fn() };
const userDb = { findByEmail: vi.fn() };
const quizDb = { findMany: vi.fn() };
const recordSecurityEvent = vi.fn();
const requireAuth = vi.fn();
const applyRateLimit = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getDb: async () => db.client, getAdminDb: () => adminDb.client, dailyPaymentDb, userDb, quizDb }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => serverClient.client }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { general: 'general' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const service = await import('@/lib/wallet/service');
const payment = await import('@/lib/payment-middleware');
const walletActions = await import('@/actions/wallet-deduction-actions');
const walletEnabledRoute = await import('@/app/api/settings/wallet-enabled/route');
const dailyPaymentRoute = await import('@/app/api/daily-payment/route');
const paymentsRoute = await import('@/app/api/payments/route');

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const req = () => makeRequest('/api/quizzes/q');

beforeEach(() => {
  db = createSupabaseMock();
  adminDb = createSupabaseMock();
  serverClient = createSupabaseMock({ user: { id: 'user-1', email: 'player@example.test' } });
  for (const fn of [...Object.values(dailyPaymentDb), userDb.findByEmail, quizDb.findMany, recordSecurityEvent, requireAuth, applyRateLimit, revalidatePath]) fn.mockReset();
  service.__resetWalletFlagStateForTests();
  vi.stubEnv('WALLET_FEATURE_ENABLED', '');
  requireAuth.mockResolvedValue(authOk('user-1'));
  applyRateLimit.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('wallet service', () => {
  it('getWalletBalance returns the stored balance, 0 for unknown users, and an error on failure', async () => {
    userDb.findByEmail.mockResolvedValueOnce({ walletBalance: 42.5 });
    expect(await service.getWalletBalance('a@b.c')).toEqual({ success: true, balance: 42.5 });
    userDb.findByEmail.mockResolvedValueOnce(null);
    expect(await service.getWalletBalance('a@b.c')).toEqual({ success: true, balance: 0 });
    userDb.findByEmail.mockRejectedValueOnce(new Error('db'));
    expect(await service.getWalletBalance('a@b.c')).toEqual({ success: false, error: 'Failed to fetch wallet balance' });
  });

  it('getQuizAccessPrice quotes the OLDEST active quiz, like pay_quiz_access charges', async () => {
    quizDb.findMany.mockResolvedValueOnce([{ accessPrice: 5 }]);
    expect(await service.getQuizAccessPrice()).toEqual({ success: true, price: 5 });
    // A free-entry quiz (a live match) never sets the day pass price
    expect(quizDb.findMany).toHaveBeenCalledWith({ status: 'active', freeEntry: false, limit: 1, orderBy: 'createdAt', orderDir: 'asc' });
    quizDb.findMany.mockResolvedValueOnce([]);
    expect(await service.getQuizAccessPrice()).toEqual({ success: true, price: 2 });
    quizDb.findMany.mockResolvedValueOnce([{ accessPrice: null }]);
    expect(await service.getQuizAccessPrice()).toEqual({ success: true, price: 2 });
    quizDb.findMany.mockRejectedValueOnce(new Error('db'));
    expect(await service.getQuizAccessPrice()).toEqual({ success: false, error: 'Failed to fetch price' });
  });

  describe('deductForQuizAccess', () => {
    it('lets the database decide the price, ignoring the amount from the browser', async () => {
      serverClient.setRpc('pay_quiz_access', { data: { success: true, newBalance: 8, paymentId: 'pay-1' } });
      const res = await service.deductForQuizAccess('user-1', 'e', 0.01, 'quiz-9');
      expect(serverClient.rpcCalls).toEqual([{ fn: 'pay_quiz_access', args: { p_quiz_id: 'quiz-9' } }]);
      expect(res).toEqual({ success: true, message: 'Payment successful! You now have 24-hour quiz access.', newBalance: 8, paymentId: 'pay-1' });
    });

    it('passes null for the quiz and says when access is already active', async () => {
      serverClient.setRpc('pay_quiz_access', { data: { success: true, alreadyActive: true } });
      const res = await service.deductForQuizAccess('u', 'e', 2);
      expect(serverClient.rpcCalls[0].args).toEqual({ p_quiz_id: null });
      expect(res.message).toBe('You already have active quiz access.');
    });

    it('reports an insufficient balance with the amounts', async () => {
      serverClient.setRpc('pay_quiz_access', { data: { success: false, error: 'Insufficient balance', insufficientBalance: true, requiredAmount: 2, currentBalance: 1 } });
      expect(await service.deductForQuizAccess('u', 'e', 2)).toEqual({ success: false, error: 'Insufficient balance', insufficientBalance: true, requiredAmount: 2, currentBalance: 1 });
      serverClient.setRpc('pay_quiz_access', { data: { success: false } });
      expect(await service.deductForQuizAccess('u', 'e', 2)).toMatchObject({ success: false, error: 'Payment failed', insufficientBalance: false });
    });

    it('fails safely when the RPC errors, returns nothing or throws', async () => {
      const failed = { success: false, error: 'Failed to process payment. Please try again.' };
      serverClient.setRpc('pay_quiz_access', { error: { message: 'x' } });
      expect(await service.deductForQuizAccess('u', 'e', 2)).toEqual(failed);
      serverClient.setRpc('pay_quiz_access', { data: null });
      expect(await service.deductForQuizAccess('u', 'e', 2)).toEqual(failed);
      serverClient.client.rpc.mockImplementationOnce(() => { throw new Error('network'); });
      expect(await service.deductForQuizAccess('u', 'e', 2)).toEqual(failed);
    });
  });

  it('invalidateWalletEnabledCache forces the next call to re-read the flag', async () => {
    adminDb.setTable('AppSettings', { data: { value: 'false' } });
    expect(await service.isWalletEnabled()).toBe(false);
    adminDb.setTable('AppSettings', { data: { value: 'true' } });
    expect(await service.isWalletEnabled()).toBe(false); // cached
    service.invalidateWalletEnabledCache();
    expect(await service.isWalletEnabled()).toBe(true);
  });

  it('logs and retries later when mirroring the env flag fails', async () => {
    vi.stubEnv('WALLET_FEATURE_ENABLED', 'false');
    adminDb.setTable('AppSettings', [{ data: { value: 'true' } }, { error: { message: 'write failed' } }]);
    expect(await service.isWalletEnabled()).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(adminDb.callsTo('AppSettings', 'upsert')).toHaveLength(1);
    expect(argOf(adminDb.callsTo('AppSettings', 'upsert')[0], 'upsert')).toEqual({ key: 'wallet_enabled', value: 'false' });
    expect(console.error).toHaveBeenCalledWith('AppSettings sync failed:', { message: 'write failed' });

    service.__resetWalletFlagStateForTests();
    adminDb.setTable('AppSettings', { error: { message: 'read failed' } });
    await service.isWalletEnabled();
    await new Promise((r) => setTimeout(r, 0));
    expect(console.error).toHaveBeenLastCalledWith('AppSettings sync failed:', { message: 'read failed' });
  });
});

describe('payment middleware', () => {
  it('grants free access when the wallet is disabled, without looking up payments', async () => {
    vi.stubEnv('WALLET_FEATURE_ENABLED', 'false');
    expect(await payment.checkPaymentAccess('user-1')).toEqual({ hasAccess: true });
    expect(dailyPaymentDb.findFirstActive).not.toHaveBeenCalled();
  });

  it('grants access with the time remaining for an active payment', async () => {
    vi.stubEnv('WALLET_FEATURE_ENABLED', 'true');
    const expiresAt = iso(HOUR);
    dailyPaymentDb.findFirstActive.mockResolvedValue({ id: 'pay-1', expiresAt });
    const res = await payment.checkPaymentAccess('user-1');
    expect(res).toMatchObject({ hasAccess: true, payment: { id: 'pay-1', expiresAt: new Date(expiresAt) } });
    expect(res.payment!.timeRemaining).toBeGreaterThan(3590);
  });

  it('denies and logs when there is no payment or it has expired', async () => {
    vi.stubEnv('WALLET_FEATURE_ENABLED', 'true');
    dailyPaymentDb.findFirstActive.mockResolvedValueOnce(null);
    expect(await payment.checkPaymentAccess('user-1', req())).toMatchObject({ hasAccess: false, error: expect.stringMatching(/No active payment/) });
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('UNAUTHORIZED_ACCESS', expect.anything(), 'user-1', { reason: 'No active payment found' });

    const expiredAt = iso(-1000);
    dailyPaymentDb.findFirstActive.mockResolvedValueOnce({ id: 'pay-old', expiresAt: expiredAt });
    expect(await payment.checkPaymentAccess('user-1', req())).toMatchObject({ hasAccess: false, error: expect.stringMatching(/expired/) });
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('UNAUTHORIZED_ACCESS', expect.anything(), 'user-1', { paymentId: 'pay-old', expiredAt });

    // without a request there is nothing to log against
    recordSecurityEvent.mockClear();
    dailyPaymentDb.findFirstActive.mockResolvedValueOnce(null);
    await payment.checkPaymentAccess('user-1');
    dailyPaymentDb.findFirstActive.mockResolvedValueOnce({ id: 'x', expiresAt: expiredAt });
    await payment.checkPaymentAccess('user-1');
    expect(recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('fails closed when the lookup throws', async () => {
    vi.stubEnv('WALLET_FEATURE_ENABLED', 'true');
    dailyPaymentDb.findFirstActive.mockRejectedValueOnce(new Error('db'));
    expect(await payment.checkPaymentAccess('user-1', req())).toEqual({ hasAccess: false, error: 'Failed to verify payment access' });
    expect(recordSecurityEvent).toHaveBeenCalledWith('SUSPICIOUS_ACTIVITY', expect.anything(), 'user-1', { error: 'db' });
    dailyPaymentDb.findFirstActive.mockRejectedValueOnce('odd');
    await payment.checkPaymentAccess('user-1', req());
    expect(recordSecurityEvent).toHaveBeenLastCalledWith('SUSPICIOUS_ACTIVITY', expect.anything(), 'user-1', { error: 'Unknown error' });
    dailyPaymentDb.findFirstActive.mockRejectedValueOnce(new Error('db'));
    expect((await payment.checkPaymentAccess('user-1')).hasAccess).toBe(false);
  });

  it('requirePaymentAccess answers 402 or lets the request through', async () => {
    vi.stubEnv('WALLET_FEATURE_ENABLED', 'true');
    dailyPaymentDb.findFirstActive.mockResolvedValueOnce(null);
    const res = await payment.requirePaymentAccess('user-1', req());
    expect(res!.status).toBe(402);
    expect(await res!.json()).toMatchObject({ requiresPayment: true });
    dailyPaymentDb.findFirstActive.mockResolvedValueOnce({ id: 'p', expiresAt: iso(HOUR) });
    expect(await payment.requirePaymentAccess('user-1', req())).toBeNull();
  });

  it('getRemainingAccessTime never goes below zero', async () => {
    dailyPaymentDb.findFirstActive.mockResolvedValueOnce({ expiresAt: iso(10_500) });
    expect(await payment.getRemainingAccessTime('u')).toBeGreaterThanOrEqual(9);
    dailyPaymentDb.findFirstActive.mockResolvedValueOnce({ expiresAt: iso(-HOUR) });
    expect(await payment.getRemainingAccessTime('u')).toBe(0);
    dailyPaymentDb.findFirstActive.mockResolvedValueOnce(null);
    expect(await payment.getRemainingAccessTime('u')).toBe(0);
    dailyPaymentDb.findFirstActive.mockRejectedValueOnce(new Error('db'));
    expect(await payment.getRemainingAccessTime('u')).toBe(0);
  });

  it('cleanupExpiredPayments marks completed payments past expiry as expired', async () => {
    db.setTable('DailyPayment', { data: [{ id: 'a' }, { id: 'b' }] });
    expect(await payment.cleanupExpiredPayments()).toBe(2);
    const call = db.callsTo('DailyPayment')[0];
    expect(argOf(call, 'update')).toMatchObject({ status: 'expired' });
    expect(eqValue(call, 'status')).toBe('completed');
    db.setTable('DailyPayment', { data: null });
    expect(await payment.cleanupExpiredPayments()).toBe(0);
    db.setTable('DailyPayment', { error: { message: 'x' } });
    expect(await payment.cleanupExpiredPayments()).toBe(0);
  });
});

describe('wallet deduction server actions', () => {
  it('getWalletBalanceForDeduction reads the balance of the session user', async () => {
    userDb.findByEmail.mockResolvedValue({ walletBalance: 10 });
    expect(await walletActions.getWalletBalanceForDeduction()).toEqual({ success: true, balance: 10 });
    expect(userDb.findByEmail).toHaveBeenCalledWith('player@example.test');
  });

  it('requires a signed-in user with an email', async () => {
    serverClient.setUser(null);
    expect(await walletActions.getWalletBalanceForDeduction()).toEqual({ success: false, error: 'You must be logged in' });
    expect(await walletActions.deductWalletForQuizAccess(2)).toEqual({ success: false, error: 'You must be logged in' });
    serverClient.setUser({ id: 'u' });
    expect(await walletActions.getWalletBalanceForDeduction()).toEqual({ success: false, error: 'You must be logged in' });
  });

  it('deducts through the service and refreshes the wallet and quiz pages on success', async () => {
    serverClient.setRpc('pay_quiz_access', { data: { success: true, paymentId: 'p' } });
    expect((await walletActions.deductWalletForQuizAccess(2, 'quiz-1')).success).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/profile/wallet');
    expect(revalidatePath).toHaveBeenCalledWith('/quizzes');

    revalidatePath.mockClear();
    serverClient.setRpc('pay_quiz_access', { data: { success: false } });
    expect((await walletActions.deductWalletForQuizAccess(2)).success).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('turns exceptions into friendly errors', async () => {
    serverClient.auth.getUser.mockRejectedValueOnce(new Error('x'));
    expect(await walletActions.getWalletBalanceForDeduction()).toEqual({ success: false, error: 'Failed to fetch wallet balance' });
    serverClient.auth.getUser.mockRejectedValueOnce(new Error('x'));
    expect(await walletActions.deductWalletForQuizAccess(2)).toEqual({ success: false, error: 'Failed to process payment. Please try again.' });
  });

  it('getQuizAccessPrice and isWalletEnabled pass through to the service', async () => {
    quizDb.findMany.mockResolvedValue([{ accessPrice: 3 }]);
    expect(await walletActions.getQuizAccessPrice()).toEqual({ success: true, price: 3 });
    vi.stubEnv('WALLET_FEATURE_ENABLED', 'true');
    expect(await walletActions.isWalletEnabled()).toBe(true);
  });
});

describe('payment routes', () => {
  it('GET /api/settings/wallet-enabled reports the flag with a 60 s cache', async () => {
    vi.stubEnv('WALLET_FEATURE_ENABLED', 'false');
    const res = await walletEnabledRoute.GET();
    expect(await res.json()).toEqual({ walletEnabled: false });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60');
  });

  it('the old free-access endpoints are gone (410)', async () => {
    for (const res of [await dailyPaymentRoute.POST(req()), await paymentsRoute.POST(req())]) {
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: 'Gone', message: 'Use the wallet to purchase quiz access.' });
    }
  });

  it('GET /api/payments reports current access and history', async () => {
    dailyPaymentDb.findFirstActive.mockResolvedValue({ id: 'pay-1', amount: 2, expiresAt: iso(HOUR) });
    dailyPaymentDb.findMany.mockResolvedValue([{ id: 'pay-1' }]);
    const body = await (await paymentsRoute.GET(req())).json();
    expect(body).toMatchObject({ hasAccess: true, currentPayment: { id: 'pay-1', amount: 2 }, paymentHistory: [{ id: 'pay-1' }] });
    expect(body.currentPayment).toEqual({ id: 'pay-1', amount: 2, expiresAt: expect.any(String) });
    expect(dailyPaymentDb.findMany).toHaveBeenCalledWith('user-1', 10);

    dailyPaymentDb.findFirstActive.mockResolvedValue(null);
    expect(await (await paymentsRoute.GET(req())).json()).toMatchObject({ hasAccess: false, currentPayment: null });
  });

  it('GET /api/payments enforces auth and rate limits, and handles errors', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await paymentsRoute.GET(req())).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await paymentsRoute.GET(req())).status).toBe(429);
    dailyPaymentDb.findFirstActive.mockRejectedValueOnce(new Error('db'));
    expect((await paymentsRoute.GET(req())).status).toBe(500);
  });
});
