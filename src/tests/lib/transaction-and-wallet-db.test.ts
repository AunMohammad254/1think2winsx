// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
let adminDb: SupabaseMock;
const logSecurityEvent = vi.fn();
const validateAdminSession = vi.fn();
const requireCSRFToken = vi.fn();
const invalidateWalletEnabledCache = vi.fn();

vi.mock('@/lib/supabase/db-modules/shared', () => ({ getDb: async () => db.client, getAdminDb: () => adminDb.client, generateId: () => 'gen-id' }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: { logSecurityEvent: (...a: unknown[]) => logSecurityEvent(...a) } }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: (...a: unknown[]) => validateAdminSession(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/wallet/service', () => ({ invalidateWalletEnabledCache: (...a: unknown[]) => invalidateWalletEnabledCache(...a) }));

const { walletTransactionDb, dailyPaymentDb } = await import('@/lib/supabase/db-modules/wallet.db');
const tm = await import('@/lib/transaction-manager');
const settingsRoute = await import('@/app/api/admin/settings/route');

beforeEach(() => {
  db = createSupabaseMock();
  adminDb = createSupabaseMock();
  for (const fn of [logSecurityEvent, validateAdminSession, requireCSRFToken, invalidateWalletEnabledCache]) fn.mockReset();
  validateAdminSession.mockResolvedValue({ valid: true, email: 'admin@example.test' });
  requireCSRFToken.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe('walletTransactionDb', () => {
  it("findByUserId lists a player's transactions newest first", async () => {
    db.setTable('WalletTransaction', { data: [{ id: 't' }] });
    expect(await walletTransactionDb.findByUserId('u1')).toEqual([{ id: 't' }]);
    const call = db.callsTo('WalletTransaction')[0];
    expect(eqValue(call, 'userId')).toBe('u1');
    expect(call.ops.find((o) => o.op === 'order')?.args).toEqual(['createdAt', { ascending: false }]);
    db.setTable('WalletTransaction', { data: null });
    expect(await walletTransactionDb.findByUserId('u1')).toEqual([]);
  });

  it('findPending pages oldest first with defaults', async () => {
    adminDb.setTable('WalletTransaction', { data: null });
    expect(await walletTransactionDb.findPending()).toEqual([]);
    expect(adminDb.callsTo('WalletTransaction')[0].ops.find((o) => o.op === 'range')?.args).toEqual([0, 49]);
    await walletTransactionDb.findPending({ limit: 10, offset: 20 });
    expect(adminDb.callsTo('WalletTransaction')[1].ops.find((o) => o.op === 'range')?.args).toEqual([20, 29]);
  });

  it('findById returns the row, null for no rows, and throws other errors', async () => {
    db.setTable('WalletTransaction', { data: { id: 't' } });
    expect(await walletTransactionDb.findById('t')).toEqual({ id: 't' });
    db.setTable('WalletTransaction', { data: null, error: { code: 'PGRST116' } });
    expect(await walletTransactionDb.findById('t')).toBeNull();
    db.setTable('WalletTransaction', { error: { code: '500' } });
    await expect(walletTransactionDb.findById('t')).rejects.toEqual({ code: '500' });
  });

  it('create stamps an id and timestamps', async () => {
    adminDb.setTable('WalletTransaction', { data: { id: 'gen-id' } });
    await walletTransactionDb.create({ userId: 'u', amount: 5 } as never);
    expect(argOf(adminDb.callsTo('WalletTransaction')[0], 'insert')).toMatchObject({ id: 'gen-id', userId: 'u', amount: 5, createdAt: expect.any(String), updatedAt: expect.any(String) });
  });

  it('approve and reject set the status and who processed it', async () => {
    adminDb.setTable('WalletTransaction', { data: { id: 't' } });
    await walletTransactionDb.approve('t', 'admin');
    await walletTransactionDb.reject('t', 'admin', 'blurry');
    const [approve, reject] = adminDb.callsTo('WalletTransaction', 'update');
    expect(argOf(approve, 'update')).toMatchObject({ status: 'approved', processedBy: 'admin' });
    expect(argOf(reject, 'update')).toMatchObject({ status: 'rejected', processedBy: 'admin', adminNotes: 'blurry' });
  });

  it('every write rethrows database errors', async () => {
    db.setTable('WalletTransaction', { error: { message: 'x' } });
    adminDb.setTable('WalletTransaction', { error: { message: 'x' } });
    await expect(walletTransactionDb.findByUserId('u')).rejects.toBeTruthy();
    await expect(walletTransactionDb.findPending()).rejects.toBeTruthy();
    await expect(walletTransactionDb.create({} as never)).rejects.toBeTruthy();
    await expect(walletTransactionDb.approve('t', 'a')).rejects.toBeTruthy();
    await expect(walletTransactionDb.reject('t', 'a')).rejects.toBeTruthy();
  });
});

describe('dailyPaymentDb', () => {
  it('findActiveByUserId and findFirstActive only return completed, unexpired payments', async () => {
    db.setTable('DailyPayment', { data: [{ id: 'p' }] });
    expect(await dailyPaymentDb.findActiveByUserId('u')).toEqual([{ id: 'p' }]);
    db.setTable('DailyPayment', { data: { id: 'p' } });
    expect(await dailyPaymentDb.findFirstActive('u')).toEqual({ id: 'p' });
    for (const call of db.callsTo('DailyPayment')) {
      expect(eqValue(call, 'status')).toBe('completed');
      expect(call.ops.find((o) => o.op === 'gt')?.args[0]).toBe('expiresAt');
    }
    expect(db.callsTo('DailyPayment')[1].ops.some((o) => o.op === 'maybeSingle')).toBe(true);
    db.setTable('DailyPayment', { data: null });
    expect(await dailyPaymentDb.findActiveByUserId('u')).toEqual([]);
  });

  it('findMany limits the history', async () => {
    db.setTable('DailyPayment', { data: null });
    expect(await dailyPaymentDb.findMany('u')).toEqual([]);
    expect(argOf(db.callsTo('DailyPayment')[0], 'limit')).toBe(10);
    await dailyPaymentDb.findMany('u', 3);
    expect(argOf(db.callsTo('DailyPayment')[1], 'limit')).toBe(3);
  });

  it('create stamps an id and timestamps', async () => {
    adminDb.setTable('DailyPayment', { data: { id: 'gen-id' } });
    expect(await dailyPaymentDb.create({ userId: 'u' } as never)).toEqual({ id: 'gen-id' });
    expect(argOf(adminDb.callsTo('DailyPayment')[0], 'insert')).toMatchObject({ id: 'gen-id', userId: 'u' });
  });

  it('rethrows database errors', async () => {
    db.setTable('DailyPayment', { error: { message: 'x' } });
    adminDb.setTable('DailyPayment', { error: { message: 'x' } });
    await expect(dailyPaymentDb.findActiveByUserId('u')).rejects.toBeTruthy();
    await expect(dailyPaymentDb.findFirstActive('u')).rejects.toBeTruthy();
    await expect(dailyPaymentDb.findMany('u')).rejects.toBeTruthy();
    await expect(dailyPaymentDb.create({} as never)).rejects.toBeTruthy();
  });
});

describe('TransactionManager', () => {
  it('runs the operation once and logs start and success', async () => {
    expect(await tm.executeTransaction(async () => 42, { userId: 'u', context: 'ctx' })).toBe(42);
    expect(logSecurityEvent.mock.calls.map((c) => c[0].details.action)).toEqual(['transaction_start', 'transaction_success']);
    expect(logSecurityEvent.mock.calls[0][0]).toMatchObject({ userId: 'u', endpoint: 'ctx' });
    await tm.executeTransaction(async () => 1);
    expect(logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'system', endpoint: 'transaction' }));
  });

  it('retries retryable errors with exponential backoff', async () => {
    vi.useFakeTimers();
    const op = vi.fn().mockRejectedValueOnce(new Error('Connection reset by peer')).mockResolvedValueOnce('ok');
    const done = tm.executeTransaction(op, { maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('wraps non-retryable errors immediately, keeping the cause', async () => {
    const original = new Error('duplicate key');
    const err = await tm.executeTransaction(async () => { throw original; }, { context: 'quiz' }).catch((e) => e);
    expect(err.message).toBe("Transaction failed in context 'quiz' after 1 attempts: duplicate key");
    expect(err.cause).toBe(original);
  });

  it('gives up after the last retryable attempt', async () => {
    vi.useFakeTimers();
    const op = vi.fn().mockRejectedValue(new Error('Service unavailable'));
    const done = tm.executeTransaction(op, { maxRetries: 2 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await done).message).toMatch(/after 2 attempts: Service unavailable/);
  });

  it('times out slow operations', async () => {
    vi.useFakeTimers();
    const done = tm.executeTransaction(() => new Promise(() => {}), { timeout: 50, maxRetries: 1 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(50);
    expect((await done).message).toMatch(/Transaction timeout after 50ms/);
  });

  it('throws a generic error when asked for zero attempts', async () => {
    await expect(tm.executeTransaction(async () => 1, { maxRetries: 0 })).rejects.toThrow('Transaction failed after all retries');
  });

  it('logs critical transactions around a single attempt', async () => {
    expect(await tm.executeCriticalTransaction(async () => 'paid', { context: 'payout', userId: 'u', amount: 10, description: 'd' })).toBe('paid');
    const actions = logSecurityEvent.mock.calls.map((c) => c[0].details.action);
    expect(actions).toEqual(['critical_transaction_start', 'transaction_start', 'transaction_success', 'critical_transaction_success']);
    expect(logSecurityEvent.mock.calls[1][0].endpoint).toBe('critical_payout');

    logSecurityEvent.mockClear();
    await expect(tm.executeCriticalTransaction(async () => { throw new Error('nope'); }, { context: 'payout', userId: '' })).rejects.toThrow(/nope/);
    const failure = logSecurityEvent.mock.calls.at(-1)![0];
    expect(failure).toMatchObject({ userId: 'system', details: { action: 'critical_transaction_failure', amount: 0 } });
  });

  it('healthCheck reports healthy, degraded and unhealthy', async () => {
    adminDb.setTable('User', { data: [{ id: 'u' }] });
    expect((await tm.TransactionManager.healthCheck()).status).toBe('healthy');

    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(0).mockReturnValueOnce(2000);
    expect((await tm.TransactionManager.healthCheck())).toMatchObject({ status: 'degraded', details: { averageLatency: 2000 } });
    now.mockReturnValueOnce(0).mockReturnValueOnce(6000);
    expect((await tm.TransactionManager.healthCheck()).status).toBe('unhealthy');
    now.mockRestore();

    adminDb.setTable('User', { error: { message: 'down' } });
    expect(await tm.TransactionManager.healthCheck()).toMatchObject({ status: 'unhealthy', details: { canConnect: false, lastError: 'down' } });
    adminDb.client.from.mockImplementationOnce(() => { throw new Error('no client'); });
    expect((await tm.TransactionManager.healthCheck()).details.lastError).toBe('no client');
  });

  it('re-exports the db helpers used by quiz submission', () => {
    expect(tm.generateId).toBeTypeOf('function');
  });
});

describe('/api/admin/settings', () => {
  const put = (body: unknown) => settingsRoute.PUT(makeRequest('/api/admin/settings', { method: 'PUT', body }));

  it('GET lists the settings for admins', async () => {
    adminDb.setTable('AppSettings', { data: [{ key: 'wallet_enabled', value: 'true' }] });
    expect(await (await settingsRoute.GET(makeRequest('/api/admin/settings'))).json()).toEqual({ settings: [{ key: 'wallet_enabled', value: 'true' }] });
    adminDb.setTable('AppSettings', { data: null });
    expect(await (await settingsRoute.GET(makeRequest('/api/admin/settings'))).json()).toEqual({ settings: [] });
    adminDb.setTable('AppSettings', { error: { message: 'x' } });
    expect((await settingsRoute.GET(makeRequest('/api/admin/settings'))).status).toBe(500);
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await settingsRoute.GET(makeRequest('/api/admin/settings'))).status).toBe(401);
  });

  it('PUT upserts a setting and invalidates the wallet flag cache for wallet_enabled', async () => {
    adminDb.setTable('AppSettings', { data: { key: 'wallet_enabled', value: 'false' } });
    const body = await (await put({ key: 'wallet_enabled', value: 'false' })).json();
    expect(body.message).toBe("Setting 'wallet_enabled' updated successfully.");
    expect(argOf(adminDb.callsTo('AppSettings')[0], 'upsert')).toMatchObject({ key: 'wallet_enabled', value: 'false', updatedBy: 'admin@example.test' });
    expect(invalidateWalletEnabledCache).toHaveBeenCalledTimes(1);

    validateAdminSession.mockResolvedValue({ valid: true });
    await put({ key: 'site_title', value: '' });
    expect(argOf(adminDb.callsTo('AppSettings')[1], 'upsert')).toMatchObject({ updatedBy: 'admin' });
    expect(invalidateWalletEnabledCache).toHaveBeenCalledTimes(1);
  });

  it('PUT validates, guards and reports failures', async () => {
    expect((await put({ key: '', value: 'x' })).status).toBe(400);
    expect((await put({ key: 'k', value: 'x'.repeat(1001) })).status).toBe(400);
    adminDb.setTable('AppSettings', { error: { message: 'x' } });
    expect((await put({ key: 'k', value: 'v' })).status).toBe(500);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await put({ key: 'k', value: 'v' })).status).toBe(403);
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await put({ key: 'k', value: 'v' })).status).toBe(401);
  });
});
