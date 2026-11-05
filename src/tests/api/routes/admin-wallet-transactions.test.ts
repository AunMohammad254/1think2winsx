// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const validateAdminSession = vi.fn();
const isWalletEnabled = vi.fn();
const requireCSRFToken = vi.fn();
const notify = vi.fn();
const notifyMany = vi.fn();

vi.mock('@/lib/supabase/db', async () => {
  const shared = await vi.importActual<typeof import('@/lib/supabase/db-modules/shared')>('@/lib/supabase/db-modules/shared');
  return {
    getAdminDb: () => adminDb.client,
    mapWithConcurrency: shared.mapWithConcurrency,
    notificationDb: { create: (...a: unknown[]) => notify(...a), createMany: (...a: unknown[]) => notifyMany(...a) },
  };
});
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: (...a: unknown[]) => validateAdminSession(...a) }));
vi.mock('@/lib/wallet/service', () => ({ isWalletEnabled: (...a: unknown[]) => isWalletEnabled(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));

const route = await import('@/app/api/admin/wallet-transactions/route');
const bulk = await import('@/app/api/admin/wallet-transactions/bulk-process/route');

const pendingTx = (over: Record<string, unknown> = {}) => ({ id: 'tx-1', userId: 'user-1', amount: 500, status: 'pending', User: { id: 'user-1', walletBalance: 100 }, ...over });

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [validateAdminSession, isWalletEnabled, requireCSRFToken, notify, notifyMany]) fn.mockReset();
  validateAdminSession.mockResolvedValue({ valid: true, email: 'admin@example.test' });
  isWalletEnabled.mockResolvedValue(true);
  requireCSRFToken.mockResolvedValue(null);
  notify.mockResolvedValue({});
  notifyMany.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GET /api/admin/wallet-transactions', () => {
  const list = (qs = '') => route.GET(makeRequest(`/api/admin/wallet-transactions${qs}`));

  it('uses the get_admin_wallet_transactions RPC with paging', async () => {
    adminDb.setRpc('get_admin_wallet_transactions', { data: { success: true, transactions: [{ id: 'tx' }], pagination: { page: 2 } } });
    const body = await (await list('?status=pending&page=2&limit=10')).json();
    expect(adminDb.rpcCalls[0]).toEqual({ fn: 'get_admin_wallet_transactions', args: { p_status: 'pending', p_page: 2, p_limit: 10 } });
    expect(body).toEqual({ success: true, transactions: [{ id: 'tx', proofImage: null }], pagination: { page: 2 } });
  });

  it('turns private receipt references into signed links, only for the transaction owner\'s own receipt', async () => {
    const createSignedUrls = vi.fn(async (paths: string[]) => ({
      data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?token=t`, error: null })),
      error: null,
    }));
    Object.assign(adminDb.storage, { createSignedUrls });
    adminDb.setRpc('get_admin_wallet_transactions', { data: { success: true, transactions: [
      { id: 'a', userId: 'user-1', proofImage: 'receipts/user-1/r.png' },
      { id: 'b', userId: 'user-2', proofImage: 'receipts/user-1/r.png' }, // points at someone else's receipt
      { id: 'c', userId: 'user-3', proofImage: 'https://old.example/r.png' },
    ] } });
    const body = await (await list()).json();
    expect(adminDb.client.storage.from).toHaveBeenCalledWith('receipts');
    expect(createSignedUrls).toHaveBeenCalledWith(['user-1/r.png'], 3600);
    expect(body.transactions.map((t: { proofImage: string | null }) => t.proofImage)).toEqual([
      'https://signed.example/user-1/r.png?token=t', null, 'https://old.example/r.png',
    ]);
  });

  it('defaults to every status, page 1 and 50 rows, tolerating a missing list', async () => {
    adminDb.setRpc('get_admin_wallet_transactions', { data: { success: true } });
    const body = await (await list()).json();
    expect(adminDb.rpcCalls[0].args).toEqual({ p_status: 'all', p_page: 1, p_limit: 50 });
    expect(body.transactions).toEqual([]);
  });

  it('falls back to a direct query when the RPC fails or throws', async () => {
    adminDb.setRpc('get_admin_wallet_transactions', { error: { message: 'missing' } });
    adminDb.setTable('WalletTransaction', { data: [{ id: 'tx', userId: 'u', amount: 5, status: 'pending', User: [{ id: 'u', name: 'A' }] }] });

    const body = await (await list('?status=approved&page=3&limit=20')).json();

    expect(body.transactions[0]).toMatchObject({ id: 'tx', amount: 5, processedAt: null, user: { id: 'u', name: 'A' } });
    const query = adminDb.callsTo('WalletTransaction')[0];
    expect(query.ops.find((o) => o.op === 'range')?.args).toEqual([40, 59]);
    expect(eqValue(query, 'status')).toBe('approved');

    adminDb.client.rpc.mockImplementationOnce(() => { throw new Error('rpc exploded'); });
    adminDb.setTable('WalletTransaction', { data: null });
    expect((await (await list('?status=all')).json()).transactions).toEqual([]);
    expect(eqValue(adminDb.callsTo('WalletTransaction')[1], 'status')).toBeUndefined();
  });

  it('keeps an object user join as-is', async () => {
    adminDb.setTable('WalletTransaction', { data: [{ id: 'tx', processedAt: 'when', User: { id: 'u' } }] });
    const body = await (await list()).json();
    expect(body.transactions[0]).toMatchObject({ processedAt: 'when', user: { id: 'u' } });
  });

  it('guards on the admin session and the wallet flag', async () => {
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await list()).status).toBe(401);
    isWalletEnabled.mockResolvedValueOnce(false);
    const res = await list();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('WALLET_DISABLED');
  });

  it('returns 500 when the fallback query fails', async () => {
    adminDb.setTable('WalletTransaction', { error: { message: 'x' } });
    expect((await list()).status).toBe(500);
  });
});

describe('PATCH /api/admin/wallet-transactions', () => {
  const patch = (body: unknown) => route.PATCH(makeRequest('/api/admin/wallet-transactions', { method: 'PATCH', body }));

  it('approves atomically through the RPC and notifies the player', async () => {
    adminDb.setRpc('approve_wallet_transaction', { data: { success: true, new_balance: 600 } });
    adminDb.setTable('WalletTransaction', { data: { userId: 'user-1', amount: 500 } });

    const body = await (await patch({ transactionId: 'tx-1', action: 'approve' })).json();

    expect(adminDb.rpcCalls[0]).toEqual({ fn: 'approve_wallet_transaction', args: { p_transaction_id: 'tx-1', p_processed_by: 'admin@example.test' } });
    expect(body).toEqual({ success: true, message: 'Transaction approved successfully', status: 'approved', newBalance: 600 });
    expect(notify).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: 'Deposit Approved', message: expect.stringContaining('500 PKR') }));
    expect(adminDb.callsTo('User', 'update')).toHaveLength(0);
  });

  it('rejects through the RPC with the reason', async () => {
    validateAdminSession.mockResolvedValue({ valid: true });
    adminDb.setRpc('reject_wallet_transaction', { data: { success: true } });
    adminDb.setTable('WalletTransaction', { data: { userId: 'user-1', amount: 500 } });

    const body = await (await patch({ transactionId: 'tx-1', action: 'reject', notes: 'blurry receipt' })).json();

    expect(adminDb.rpcCalls[0]).toEqual({ fn: 'reject_wallet_transaction', args: { p_transaction_id: 'tx-1', p_processed_by: 'admin', p_reason: 'blurry receipt' } });
    expect(body).toEqual({ success: true, message: 'Transaction rejected' });
    expect(notify).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: 'Deposit Rejected', message: expect.stringContaining('blurry receipt') }));
  });

  it('still succeeds when the transaction lookup or the notification fails after the RPC', async () => {
    validateAdminSession.mockResolvedValue({ valid: true }); // a session without an email
    adminDb.setRpc('approve_wallet_transaction', { data: { success: true } });
    adminDb.setTable('WalletTransaction', { data: null });
    expect((await patch({ transactionId: 'tx-1', action: 'approve' })).status).toBe(200);
    expect(adminDb.rpcCalls[0].args.p_processed_by).toBe('admin');
    expect(notify).not.toHaveBeenCalled();

    adminDb.setTable('WalletTransaction', { data: { userId: 'u', amount: 1 } });
    notify.mockRejectedValue(new Error('push down'));
    expect((await patch({ transactionId: 'tx-1', action: 'approve' })).status).toBe(200);
    adminDb.setRpc('reject_wallet_transaction', { data: { success: true } });
    expect((await patch({ transactionId: 'tx-1', action: 'reject' })).status).toBe(200);
    adminDb.setTable('WalletTransaction', { data: null });
    expect((await patch({ transactionId: 'tx-1', action: 'reject' })).status).toBe(200);
  });

  it('relays an RPC refusal', async () => {
    adminDb.setRpc('approve_wallet_transaction', { data: { success: false, error: 'Already processed' } });
    expect(await (await patch({ transactionId: 'tx-1', action: 'approve' })).json()).toEqual({ error: 'Already processed' });
    adminDb.setRpc('approve_wallet_transaction', { data: { success: false } });
    expect(await (await patch({ transactionId: 'tx-1', action: 'approve' })).json()).toEqual({ error: 'Failed to approve' });
    adminDb.setRpc('approve_wallet_transaction', { data: null });
    expect(await (await patch({ transactionId: 'tx-1', action: 'approve' })).json()).toEqual({ error: 'Failed to approve' });
    adminDb.setRpc('reject_wallet_transaction', { data: { success: false } });
    const refused = await patch({ transactionId: 'tx-1', action: 'reject' });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Failed to reject' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('fails without touching the balance when the RPC errors or throws (no direct-write fallback)', async () => {
    adminDb.setTable('WalletTransaction', { data: pendingTx() });
    adminDb.setRpc('approve_wallet_transaction', { error: { message: 'timeout' } });
    expect((await patch({ transactionId: 'tx-1', action: 'approve' })).status).toBe(500);
    adminDb.setRpc('reject_wallet_transaction', { error: { message: 'timeout' } });
    expect((await patch({ transactionId: 'tx-1', action: 'reject', notes: 'x' })).status).toBe(500);
    adminDb.client.rpc.mockImplementation(() => { throw new Error('rpc down'); });
    const res = await patch({ transactionId: 'tx-1', action: 'approve' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to process transaction' });

    expect(adminDb.callsTo('User')).toHaveLength(0);
    expect(adminDb.callsTo('WalletTransaction')).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('validates the request and guards on session and CSRF', async () => {
    expect((await patch({ action: 'approve' })).status).toBe(400);
    expect((await patch({ transactionId: 'tx-1', action: 'delete' })).status).toBe(400);
    expect((await patch({ transactionId: 'tx-1' })).status).toBe(400);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await patch({ transactionId: 'tx-1', action: 'approve' })).status).toBe(403);
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await patch({ transactionId: 'tx-1', action: 'approve' })).status).toBe(401);
    expect(adminDb.rpcCalls).toHaveLength(0);
  });
});

describe('POST /api/admin/wallet-transactions/bulk-process', () => {
  const run = (body: unknown) => bulk.POST(makeRequest('/api/admin/wallet-transactions/bulk-process', { body }));
  const rows = [{ id: 'tx-a', userId: 'user-a', amount: 100 }, { id: 'tx-b', userId: 'user-b', amount: 200 }];
  const inArgs = (call: { ops: { op: string; args: unknown[] }[] } | undefined) => call?.ops.find((o) => o.op === 'in')?.args;
  const sentNotifications = () => notifyMany.mock.calls.flatMap(([items]) => items as Array<Record<string, unknown>>);

  it('approves each deposit once through the locking RPC, never by writing the balance itself', async () => {
    adminDb.setTable('WalletTransaction', { data: rows });
    adminDb.setRpc('approve_wallet_transaction', { data: { success: true, new_balance: 600 } });

    const body = await (await run({ transactionIds: ['tx-a', 'tx-b', 'tx-a'], action: 'approve' })).json();

    expect(body).toEqual({ success: true, message: 'Successfully processed 2 transactions. 0 failed.', results: { success: 2, failed: 0, errors: [] } });
    expect(adminDb.rpcCalls).toEqual([
      { fn: 'approve_wallet_transaction', args: { p_transaction_id: 'tx-a', p_processed_by: 'admin@example.test' } },
      { fn: 'approve_wallet_transaction', args: { p_transaction_id: 'tx-b', p_processed_by: 'admin@example.test' } },
    ]);
    expect(inArgs(adminDb.callsTo('WalletTransaction')[0])).toEqual(['id', ['tx-a', 'tx-b']]);
    expect(adminDb.callsTo('User', 'update')).toHaveLength(0);
    expect(adminDb.callsTo('WalletTransaction', 'update')).toHaveLength(0);
    // Every depositor's notification goes in one createMany call
    expect(notifyMany).toHaveBeenCalledTimes(1);
    expect(notifyMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'user-a', title: 'Deposit Approved', message: expect.stringContaining('100 PKR') }),
      expect.objectContaining({ userId: 'user-b', title: 'Deposit Approved', message: expect.stringContaining('200 PKR') }),
    ]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('runs at most five approvals at once and still reports them in request order', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `tx-${i}`);
    adminDb.setTable('WalletTransaction', { data: [] });
    let inFlight = 0;
    let peak = 0;
    // A slow RPC (a promise in place of the mock's thenable: the route only awaits it)
    (adminDb.client.rpc as unknown as Mock<(fn: string, args?: Record<string, unknown>) => Promise<unknown>>).mockImplementation(async (_fn, args = {}) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return args.p_transaction_id === 'tx-3' ? { data: { success: false, error: 'Transaction is not pending' }, error: null } : { data: { success: true }, error: null };
    });

    const body = await (await run({ transactionIds: ids, action: 'approve' })).json();

    expect(peak).toBe(5);
    expect(adminDb.client.rpc).toHaveBeenCalledTimes(12);
    expect(body.results).toEqual({ success: 11, failed: 1, errors: ['tx-3: Transaction is not pending'] });
  });

  it('credits a deposit once when two admins approve it at the same time', async () => {
    // The database function locks the row and refuses a deposit that is no longer pending
    const settled = new Set<string>();
    adminDb.setTable('WalletTransaction', { data: rows });
    adminDb.setRpc('approve_wallet_transaction', (args) => {
      const id = args.p_transaction_id as string;
      if (settled.has(id)) return { data: { success: false, error: 'Transaction is not pending' } };
      settled.add(id);
      return { data: { success: true } };
    });

    const [first, second] = await Promise.all([
      run({ transactionIds: ['tx-a'], action: 'approve' }).then((r) => r.json()),
      run({ transactionIds: ['tx-a'], action: 'approve' }).then((r) => r.json()),
    ]);

    expect(first.results.success + second.results.success).toBe(1);
    expect([...first.results.errors, ...second.results.errors]).toEqual(['tx-a: Transaction is not pending']);
    expect(sentNotifications()).toHaveLength(1);
  });

  it('rejects with the reason and reports each deposit that was not processed', async () => {
    adminDb.setTable('WalletTransaction', { data: [{ id: 'tx-1', userId: 'user-1', amount: 500 }] });
    adminDb.setRpc('reject_wallet_transaction', (args) => {
      switch (args.p_transaction_id) {
        case 'done': return { data: { success: false, error: 'Transaction is not pending' } };
        case 'down': return { error: { message: 'connection reset' } };
        case 'empty': return { data: null };
        case 'boom': throw new Error('row exploded');
        case 'weird': throw 'string failure';
        default: return { data: { success: true } };
      }
    });

    const body = await (await run({ transactionIds: ['tx-1', 'done', 'down', 'empty', 'boom', 'weird'], action: 'reject', notes: 'fake' })).json();

    expect(body.results).toEqual({
      success: 1,
      failed: 5,
      errors: ['done: Transaction is not pending', 'down: connection reset', 'empty: not processed', 'boom: row exploded', 'weird: string failure'],
    });
    expect(adminDb.rpcCalls[0]).toEqual({ fn: 'reject_wallet_transaction', args: { p_transaction_id: 'tx-1', p_processed_by: 'admin@example.test', p_reason: 'fake' } });
    expect(sentNotifications()).toEqual([expect.objectContaining({ userId: 'user-1', title: 'Deposit Rejected', message: expect.stringContaining('Reason: fake') })]);
  });

  it('swallows notification failures, defaults the reason, and skips deposits it found no row for', async () => {
    validateAdminSession.mockResolvedValue({ valid: true }); // a session without an email
    adminDb.setRpc('approve_wallet_transaction', { data: { success: true } });
    adminDb.setRpc('reject_wallet_transaction', { data: { success: true } });
    adminDb.setTable('WalletTransaction', { data: [{ id: 'tx-1', userId: 'user-1', amount: 500 }] });
    notifyMany.mockRejectedValue(new Error('push down'));
    expect((await (await run({ transactionIds: ['tx-1'], action: 'approve' })).json()).results.success).toBe(1);
    expect(adminDb.rpcCalls[0].args.p_processed_by).toBe('admin');

    notifyMany.mockReset().mockResolvedValue(undefined);
    await run({ transactionIds: ['tx-1'], action: 'reject', notes: '' });
    expect(adminDb.rpcCalls[1].args.p_reason).toBeNull();
    expect(notifyMany).toHaveBeenLastCalledWith([expect.objectContaining({ userId: 'user-1', message: expect.stringContaining('Reason: Not provided') })]);

    notifyMany.mockReset().mockResolvedValue(undefined);
    adminDb.setTable('WalletTransaction', { data: null });
    expect((await (await run({ transactionIds: ['tx-1'], action: 'reject' })).json()).results.success).toBe(1);
    expect(sentNotifications()).toEqual([]);
  });

  it('changes nothing when the deposit lookup fails', async () => {
    adminDb.setTable('WalletTransaction', { error: { message: 'db down' } });
    expect((await run({ transactionIds: ['tx-1'], action: 'approve' })).status).toBe(500);
    expect(adminDb.rpcCalls).toHaveLength(0);
  });

  it('requires a CSRF token, like the single-transaction PATCH', async () => {
    requireCSRFToken.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await run({ transactionIds: ['tx-1'], action: 'approve' })).status).toBe(403);
    expect(adminDb.rpcCalls).toHaveLength(0);
  });

  it('validates input and guards on session and the wallet flag', async () => {
    const invalid = [
      {},
      { transactionIds: 'tx-1', action: 'approve' },
      { transactionIds: [], action: 'approve' },
      { transactionIds: [''], action: 'approve' },
      { transactionIds: [7], action: 'approve' },
      { transactionIds: ['a'] },
      { transactionIds: ['a'], action: 'nuke' },
    ];
    for (const body of invalid) expect((await run(body)).status).toBe(400);
    const capped = await run({ transactionIds: Array.from({ length: 101 }, (_, i) => `tx-${i}`), action: 'approve' });
    expect(capped.status).toBe(400);
    expect((await capped.json()).error).toBe('At most 100 transactions can be processed at once');
    expect((await bulk.POST(makeRequest('/api/admin/wallet-transactions/bulk-process', { method: 'POST', rawBody: 'null' }))).status).toBe(400);
    expect(adminDb.rpcCalls).toHaveLength(0);

    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await run({ transactionIds: ['a'], action: 'approve' })).status).toBe(401);
    isWalletEnabled.mockResolvedValueOnce(false);
    expect((await run({ transactionIds: ['a'], action: 'approve' })).status).toBe(503);
  });

  it('returns 500 for a body that is not JSON', async () => {
    const res = await bulk.POST(makeRequest('/api/admin/wallet-transactions/bulk-process', { method: 'POST', rawBody: 'nope' }));
    expect(res.status).toBe(500);
  });
});
