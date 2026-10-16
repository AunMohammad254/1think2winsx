// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const validateAdminSession = vi.fn();
const isWalletEnabled = vi.fn();
const requireCSRFToken = vi.fn();
const notify = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client, notificationDb: { create: (...a: unknown[]) => notify(...a) } }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: (...a: unknown[]) => validateAdminSession(...a) }));
vi.mock('@/lib/wallet/service', () => ({ isWalletEnabled: (...a: unknown[]) => isWalletEnabled(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));

const route = await import('@/app/api/admin/wallet-transactions/route');
const bulk = await import('@/app/api/admin/wallet-transactions/bulk-process/route');

const pendingTx = (over: Record<string, unknown> = {}) => ({ id: 'tx-1', userId: 'user-1', amount: 500, status: 'pending', User: { id: 'user-1', walletBalance: 100 }, ...over });

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [validateAdminSession, isWalletEnabled, requireCSRFToken, notify]) fn.mockReset();
  validateAdminSession.mockResolvedValue({ valid: true, email: 'admin@example.test' });
  isWalletEnabled.mockResolvedValue(true);
  requireCSRFToken.mockResolvedValue(null);
  notify.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GET /api/admin/wallet-transactions', () => {
  const list = (qs = '') => route.GET(makeRequest(`/api/admin/wallet-transactions${qs}`));

  it('uses the get_admin_wallet_transactions RPC with paging', async () => {
    adminDb.setRpc('get_admin_wallet_transactions', { data: { success: true, transactions: [{ id: 'tx' }], pagination: { page: 2 } } });
    const body = await (await list('?status=pending&page=2&limit=10')).json();
    expect(adminDb.rpcCalls[0]).toEqual({ fn: 'get_admin_wallet_transactions', args: { p_status: 'pending', p_page: 2, p_limit: 10 } });
    expect(body).toEqual({ success: true, transactions: [{ id: 'tx' }], pagination: { page: 2 } });
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
    adminDb.setRpc('reject_wallet_transaction', { data: { success: false } });
    expect(await (await patch({ transactionId: 'tx-1', action: 'reject' })).json()).toEqual({ error: 'Failed to reject' });
  });

  it('falls back to a NON-atomic read-then-write approval when the RPC errors', async () => {
    adminDb.setRpc('approve_wallet_transaction', { error: { message: 'timeout' } });
    adminDb.setTable('WalletTransaction', [{ data: pendingTx() }, { data: { id: 'tx-1', status: 'approved' } }]);

    const body = await (await patch({ transactionId: 'tx-1', action: 'approve' })).json();

    // balance is read (100) and written back as 100 + 500 in a separate query
    expect(argOf(adminDb.callsTo('User', 'update')[0], 'update')).toMatchObject({ walletBalance: 600 });
    const statusUpdate = adminDb.callsTo('WalletTransaction', 'update')[0];
    expect(argOf(statusUpdate, 'update')).toMatchObject({ status: 'approved', processedBy: 'admin@example.test' });
    // the status update is not conditional on the row still being pending
    expect(eqValue(statusUpdate, 'status')).toBeUndefined();
    expect(body).toMatchObject({ success: true, newBalance: 600, transaction: { status: 'approved' } });
  });

  it('fallback approval handles array joins, missing users and notification failures', async () => {
    adminDb.client.rpc.mockImplementation(() => { throw new Error('rpc down'); });
    adminDb.setTable('WalletTransaction', [{ data: pendingTx({ User: [{ walletBalance: 50 }] }) }, { data: {} }]);
    notify.mockRejectedValue(new Error('x'));
    expect((await (await patch({ transactionId: 'tx-1', action: 'approve' })).json()).newBalance).toBe(550);

    adminDb.setTable('WalletTransaction', [{ data: pendingTx({ User: null }) }, { data: {} }]);
    expect((await (await patch({ transactionId: 'tx-1', action: 'approve' })).json()).newBalance).toBe(500);
  });

  it('fallback rejection stores the notes', async () => {
    adminDb.setRpc('reject_wallet_transaction', { error: { message: 'x' } });
    adminDb.setTable('WalletTransaction', [{ data: pendingTx() }, { data: { status: 'rejected' } }]);
    notify.mockRejectedValue(new Error('x'));
    const body = await (await patch({ transactionId: 'tx-1', action: 'reject' })).json();
    expect(argOf(adminDb.callsTo('WalletTransaction', 'update')[0], 'update')).toMatchObject({ status: 'rejected', adminNotes: null });
    expect(body).toMatchObject({ success: true, transaction: { status: 'rejected' } });
    expect(adminDb.callsTo('User', 'update')).toHaveLength(0);
  });

  it('fallback refuses missing or already-processed transactions', async () => {
    adminDb.client.rpc.mockImplementation(() => { throw new Error('rpc down'); });
    adminDb.setTable('WalletTransaction', { data: null, error: { message: 'none' } });
    expect((await patch({ transactionId: 'tx-1', action: 'approve' })).status).toBe(404);
    adminDb.setTable('WalletTransaction', { data: pendingTx({ status: 'approved' }) });
    const res = await patch({ transactionId: 'tx-1', action: 'reject' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Transaction is already approved');
  });

  it('fallback returns 500 when the status update fails', async () => {
    adminDb.client.rpc.mockImplementation(() => { throw new Error('rpc down'); });
    adminDb.setTable('WalletTransaction', [{ data: pendingTx() }, { error: { message: 'x' } }]);
    expect((await patch({ transactionId: 'tx-1', action: 'approve' })).status).toBe(500);
    adminDb.setTable('WalletTransaction', [{ data: pendingTx() }, { error: { message: 'x' } }]);
    expect((await patch({ transactionId: 'tx-1', action: 'reject' })).status).toBe(500);
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

  it('approves each pending deposit with a separate read-then-write (not atomic)', async () => {
    adminDb.setTable('WalletTransaction', (call) =>
      eqValue(call, 'id') === 'tx-a' ? { data: pendingTx({ id: 'tx-a', amount: 100, User: [{ walletBalance: 0 }] }) } : { data: pendingTx({ id: 'tx-b', amount: 200, User: null }) });

    const body = await (await run({ transactionIds: ['tx-a', 'tx-b'], action: 'approve' })).json();

    expect(body).toEqual({ success: true, message: 'Successfully processed 2 transactions. 0 failed.', results: { success: 2, failed: 0, errors: [] } });
    expect(adminDb.callsTo('User', 'update').map((c) => (argOf(c, 'update') as { walletBalance: number }).walletBalance)).toEqual([100, 200]);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('rejects with notes and reports per-row failures', async () => {
    adminDb.setTable('WalletTransaction', (call) => {
      if (hasUpdate(call)) return { data: null };
      const id = eqValue(call, 'id');
      if (id === 'missing') return { data: null, error: { message: 'none' } };
      if (id === 'done') return { data: pendingTx({ status: 'approved' }) };
      if (id === 'boom') throw new Error('row exploded');
      if (id === 'weird') throw 'string failure';
      return { data: pendingTx() };
    });
    notify.mockRejectedValue(new Error('push down'));

    const body = await (await run({ transactionIds: ['tx-1', 'missing', 'done', 'boom', 'weird'], action: 'reject', notes: 'fake' })).json();

    expect(body.results).toEqual({
      success: 1,
      failed: 4,
      errors: ['Transaction missing not found', 'Transaction done is already approved', 'Failed to process boom: row exploded', 'Failed to process weird: string failure'],
    });
    expect(argOf(adminDb.callsTo('WalletTransaction', 'update')[0], 'update')).toMatchObject({ status: 'rejected', adminNotes: 'fake' });
  });

  it('swallows notification failures on approval and defaults rejection notes', async () => {
    adminDb.setTable('WalletTransaction', { data: pendingTx() });
    notify.mockRejectedValue(new Error('x'));
    expect((await (await run({ transactionIds: ['tx-1'], action: 'approve' })).json()).results.success).toBe(1);
    notify.mockResolvedValue({});
    await run({ transactionIds: ['tx-1'], action: 'reject' });
    expect(notify).toHaveBeenLastCalledWith('user-1', expect.objectContaining({ message: expect.stringContaining('Reason: Not provided') }));
  });

  it('has no CSRF check, unlike the single-transaction PATCH', async () => {
    requireCSRFToken.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    adminDb.setTable('WalletTransaction', { data: pendingTx() });
    expect((await run({ transactionIds: ['tx-1'], action: 'approve' })).status).toBe(200);
    expect(requireCSRFToken).not.toHaveBeenCalled();
  });

  it('validates input and guards on session and the wallet flag', async () => {
    for (const body of [{}, { transactionIds: 'tx-1', action: 'approve' }, { transactionIds: [], action: 'approve' }, { transactionIds: ['a'] }, { transactionIds: ['a'], action: 'nuke' }]) {
      expect((await run(body)).status).toBe(400);
    }
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

function hasUpdate(call: { ops: { op: string }[] }) {
  return call.ops.some((o) => o.op === 'update');
}
