// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const validateAdminSession = vi.fn();
const isWalletEnabled = vi.fn();
const notify = vi.fn();
// pdfParse stands in for PDFParse#getText; pdfDestroy records the cleanup
const pdfParse = vi.fn();
const pdfDestroy = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client, notificationDb: { create: (...a: unknown[]) => notify(...a) } }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: (...a: unknown[]) => validateAdminSession(...a) }));
vi.mock('@/lib/wallet/service', () => ({ isWalletEnabled: (...a: unknown[]) => isWalletEnabled(...a) }));
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    constructor(private options: { data: unknown }) {}
    getText() { return pdfParse(this.options.data); }
    destroy() { return pdfDestroy(); }
  },
}));

const { POST } = await import('@/app/api/admin/wallet-transactions/reconcile/route');

function upload(content: string | null, name = 'statement.txt', type = 'text/plain', autoApprove?: boolean) {
  const form = new FormData();
  if (content !== null) form.append('file', new File([content], name, { type }));
  if (autoApprove !== undefined) form.append('auto_approve', String(autoApprove));
  return POST(new NextRequest('http://localhost/api/admin/wallet-transactions/reconcile', { method: 'POST', body: form }));
}

const pending = (id: string, transactionId: string, amount: number, createdAt = '2026-01-15T10:00:00.000Z') =>
  ({ id, transactionId, amount, paymentMethod: 'easypaisa', createdAt, userId: `user-${id}` });

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [validateAdminSession, isWalletEnabled, notify, pdfParse, pdfDestroy]) fn.mockReset();
  validateAdminSession.mockResolvedValue({ valid: true, email: 'admin@example.test' });
  isWalletEnabled.mockResolvedValue(true);
  notify.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/admin/wallet-transactions/reconcile', () => {
  it('matches Easypaisa SMS lines by reference, case-insensitively, without approving by default', async () => {
    adminDb.setTable('WalletTransaction', { data: [pending('a', '7263652728817', 500), pending('b', 'abc12345678', 100), pending('c', 'NOPE0000000', 999)] });
    const text = [
      'PKR 500 received from 03121234567. Ref# 7263652728817 at 10:22PM',
      'You have received Rs. 100 from 0301-1234567. TxnID: ABC12345678',
      'You have received Rs. 100 again. TxnID: ABC12345678', // duplicate reference is dropped
      'tiny',
    ].join('\n');

    const body = await (await upload(text)).json();

    expect(body.statementEntriesFound).toBe(2);
    expect(body.matchedIds).toEqual(['a', 'b']);
    expect(body.matchDetails).toEqual([
      expect.objectContaining({ pendingId: 'a', matchType: 'exact_id', confidence: 'high', statementRef: '7263652728817', statementAmount: 500, autoApproved: false }),
      expect.objectContaining({ pendingId: 'b', matchType: 'exact_id', statementRef: 'ABC12345678', statementAmount: 100 }),
    ]);
    expect(body.unmatchedPending).toEqual([{ id: 'c', transactionId: 'NOPE0000000', amount: 999, paymentMethod: 'easypaisa', createdAt: '2026-01-15T10:00:00.000Z' }]);
    expect(body.message).toBe('Found 2 matching transaction(s). 1 pending transactions unmatched.');
    expect(adminDb.rpcCalls).toHaveLength(0);
    const q = adminDb.callsTo('WalletTransaction')[0];
    expect(eqValue(q, 'status')).toBe('pending');
    expect(q.ops.find((o) => o.op === 'gt')?.args).toEqual(['amount', 0]);
  });

  it('falls back to amount + date within 24 hours, and only once per statement line', async () => {
    adminDb.setTable('WalletTransaction', {
      data: [
        pending('near', 'X1', 250, '2026-01-15T09:00:00.000Z'),
        pending('twin', 'X2', 250, '2026-01-15T09:30:00.000Z'), // same amount, but the line is already used
        pending('far', 'X3', 75, '2026-03-01T00:00:00.000Z'),
      ],
    });
    const text = [
      'Easypaisa: 250 PKR credited on 2026-01-15 from a friend',
      'Easypaisa: Rs 75 credited 15 Jan 2026 from a friend',
      'Easypaisa: Rs 60 credited 45/45/2026 then 01/16/2026',
    ].join('\n');

    const body = await (await upload(text)).json();

    expect(body.matchDetails).toEqual([expect.objectContaining({ pendingId: 'near', matchType: 'amount_date', confidence: 'medium' })]);
    expect(body.unmatchedPending.map((p: { id: string }) => p.id)).toEqual(['twin', 'far']);
  });

  it('parses JazzCash statements, including the pipe-delimited export', async () => {
    adminDb.setTable('WalletTransaction', { data: [pending('j1', 'JC1234567890', 150), pending('j2', 'JC9876543210', 250), pending('j3', 'NOMATCH', 7, '2026-01-15T00:00:00.000Z')] });
    const text = [
      'JazzCash account statement for Ali',
      'Transaction ID: JC1234567890  Amount: PKR 150.00  Date: 15-Jan-2026',
      'JC9876543210|250.00|2026-01-15|Received',
      'BAD9|5.00|99-99-99|Received',
      'Amount: 7 Date: 15-Jan-2026 no reference',
      'Amount: 1,000 Date: 32-Jan-2026', // shaped like a date, but not a real one
      'Received something without numbers',
    ].join('\n');

    const body = await (await upload(text)).json();

    expect(body.statementEntriesFound).toBe(5);
    expect(body.matchedIds).toEqual(['j1', 'j2', 'j3']);
  });

  it.each([
    ['comma', 'statement.csv', 'Date,Description,Reference,Amount\n2026-01-15,"Deposit",TX1,"1,500"\n2026-01-15,refund,TX2,-5\nnot-a-date,deposit,,0'],
    ['semicolon', 'statement.txt', 'Date;Narration;Txn ID;Credit\n2026-01-15;deposit;TX1;1500'],
    ['pipe', 'statement.txt', 'time|particulars|ref|pkr\n2026-01-15|deposit|TX1|1500'],
  ])('reads %s separated bank exports', async (_label, name, csv) => {
    adminDb.setTable('WalletTransaction', { data: [pending('a', 'tx1', 1500)] });
    const body = await (await upload(csv, name, 'text/csv')).json();
    expect(body.matchedIds).toEqual(['a']);
  });

  it('falls back to line parsing when a .csv file has no usable columns or rows', async () => {
    adminDb.setTable('WalletTransaction', { data: [pending('a', '7263652728817', 500)] });
    const onlyHeader = await (await upload('Date,Amount', 'one.csv')).json();
    expect(onlyHeader.statementEntriesFound).toBe(0);
    const noSeparators = await (await upload('PKR 500 received Ref# 7263652728817\nsecond line here', 'sms.csv')).json();
    expect(noSeparators.matchedIds).toEqual(['a']);
    const headerWithoutKnownColumns = await (await upload('foo,bar\nbaz,qux\nPKR 500 received Ref# 7263652728817', 'x.txt')).json();
    expect(headerWithoutKnownColumns.statementEntriesFound).toBe(1);
  });

  it('extracts text from PDFs', async () => {
    pdfParse.mockResolvedValue({ text: 'PKR 500 received. Ref# 7263652728817' });
    adminDb.setTable('WalletTransaction', { data: [pending('a', '7263652728817', 500)] });
    const body = await (await upload('%PDF-binary', 'statement.pdf', 'application/pdf')).json();
    expect(body.matchedIds).toEqual(['a']);
    expect(Buffer.isBuffer(pdfParse.mock.calls[0][0])).toBe(true);
    expect(pdfDestroy).toHaveBeenCalledTimes(1);
  });

  it('reports unreadable PDFs and empty files', async () => {
    pdfParse.mockRejectedValue(new Error('corrupt'));
    const pdf = await upload('%PDF', 'x.pdf', '');
    expect(pdf.status).toBe(500);
    expect((await pdf.json()).error).toBe('Failed to parse PDF file');
    expect(pdfDestroy).toHaveBeenCalledTimes(1);
    const empty = await upload('   \n  ');
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBe('Could not extract text from file');
  });

  it('says so when the statement has no transactions or nothing is pending', async () => {
    const none = await (await upload('hello world, nothing here')).json();
    expect(none).toMatchObject({ success: true, statementEntriesFound: 0, matchedIds: [] });
    expect(adminDb.calls).toHaveLength(0);

    adminDb.setTable('WalletTransaction', { data: [] });
    const nothingPending = await (await upload('PKR 500 received Ref# 7263652728817')).json();
    expect(nothingPending).toMatchObject({ success: true, message: 'No pending deposit transactions to match against.', statementEntriesFound: 1 });

    adminDb.setTable('WalletTransaction', { data: null });
    expect((await (await upload('PKR 500 received Ref# 7263652728817')).json()).matchedIds).toEqual([]);
  });

  it('auto-approves matches through the approve RPC and notifies the players', async () => {
    adminDb.setTable('WalletTransaction', { data: [pending('a', '7263652728817', 500)] });
    adminDb.setRpc('approve_wallet_transaction', { data: { success: true } });

    const body = await (await upload('PKR 500 received Ref# 7263652728817', 's.txt', 'text/plain', true)).json();

    expect(adminDb.rpcCalls[0]).toEqual({ fn: 'approve_wallet_transaction', args: { p_transaction_id: 'a', p_processed_by: 'reconcile:admin@example.test' } });
    expect(body.autoApproved).toEqual(['a']);
    expect(body.message).toBe('Matched 1 transaction(s). Auto-approved 1. 0 still pending review.');
    expect(notify).toHaveBeenCalledWith('user-a', expect.objectContaining({ title: 'Deposit Approved' }));
  });

  it('when the RPC fails, marks the deposit approved WITHOUT crediting the wallet', async () => {
    validateAdminSession.mockResolvedValue({ valid: true });
    adminDb.setTable('WalletTransaction', (call) => (call.ops.some((o) => o.op === 'update') ? { data: null } : { data: [pending('a', '7263652728817', 500)] }));
    adminDb.setRpc('approve_wallet_transaction', { error: { message: 'rpc failed' } });

    const body = await (await upload('PKR 500 received Ref# 7263652728817', 's.txt', 'text/plain', true)).json();

    const update = adminDb.callsTo('WalletTransaction', 'update')[0];
    expect(argOf(update, 'update')).toMatchObject({ status: 'approved', processedBy: 'reconcile:admin' });
    expect(eqValue(update, 'status')).toBe('pending');
    expect(adminDb.callsTo('User')).toHaveLength(0); // no balance credit anywhere
    expect(body.autoApproved).toEqual(['a']);
    expect(notify).toHaveBeenCalled();
  });

  it('collects approval errors and survives notification failures', async () => {
    adminDb.setTable('WalletTransaction', (call) =>
      call.ops.some((o) => o.op === 'update') ? { error: { message: 'update failed' } } : { data: [pending('a', 'REF0000001', 1), pending('b', 'REF0000002', 2), pending('c', 'REF0000003', 3), pending('d', 'REF0000004', 4)] });
    adminDb.setRpc('approve_wallet_transaction', (args) => {
      if (args.p_transaction_id === 'a') return { data: { success: false } };
      if (args.p_transaction_id === 'b') throw new Error('rpc threw');
      if (args.p_transaction_id === 'c') throw 'not an error';
      return { data: { success: true } };
    });
    notify.mockRejectedValue(new Error('push down'));

    const text = ['Ref# REF0000001 PKR 1', 'Ref# REF0000002 PKR 2', 'Ref# REF0000003 PKR 3', 'Ref# REF0000004 PKR 4'].join('\n');
    const body = await (await upload(text, 's.txt', 'text/plain', true)).json();

    expect(body.autoApproved).toEqual(['d']);
    expect(body.approvalErrors).toEqual([
      { id: 'a', error: 'update failed' },
      { id: 'b', error: 'rpc threw' },
      { id: 'c', error: 'Unknown error' },
    ]);
  });

  it('guards on the admin session, the wallet flag and a missing file', async () => {
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await upload('x')).status).toBe(401);
    isWalletEnabled.mockResolvedValueOnce(false);
    expect((await upload('x')).status).toBe(503);
    const res = await upload(null);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No file uploaded');
  });

  it('returns 500 when the pending lookup fails or the body is not a form', async () => {
    adminDb.setTable('WalletTransaction', { error: { message: 'db' } });
    const res = await upload('PKR 500 received Ref# 7263652728817');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Database query failed');

    const notForm = await POST(new NextRequest('http://localhost/x', { method: 'POST', body: 'plain', headers: { 'content-type': 'text/plain' } }));
    expect(notForm.status).toBe(500);
  });
});
