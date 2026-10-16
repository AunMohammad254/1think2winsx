// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let sb: SupabaseMock;
const checkLimit = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => sb.client }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { deposit: { checkLimit: (...a: unknown[]) => checkLimit(...a) } } }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const actions = await import('@/app/profile/wallet/actions');

const receipt = (bytes = 1024, name = 'receipt.jpg') => new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
function depositForm(over: Record<string, string | File | null> = {}) {
  const fields: Record<string, string | File | null> = { amount: '500', paymentMethod: 'Easypaisa', transactionId: ' 7263652728817 ', proofImage: receipt(), ...over };
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== null) form.append(k, v);
  return form;
}
// WalletTransaction is queried for: pending count, duplicate count, then the created row
const counts = (pending: number | null, dupes: number | null, created: Record<string, unknown> = { data: { id: 'tx-1', paymentMethod: 'Easypaisa', status: 'pending' } }) =>
  sb.setTable('WalletTransaction', [{ count: pending }, { count: dupes }, created]);

beforeEach(() => {
  sb = createSupabaseMock({ user: { id: 'user-1', email: 'player@example.test' } });
  checkLimit.mockReset().mockResolvedValue({ success: true });
  revalidatePath.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('submitDepositRequest', () => {
  it('uploads the receipt and submits through the submit_deposit_request RPC', async () => {
    counts(0, 0);
    sb.setRpc('submit_deposit_request', { data: { success: true, id: 'tx-1' } });

    const res = await actions.submitDepositRequest(depositForm());

    expect(res).toMatchObject({ success: true, message: 'Deposit request submitted successfully', transaction: { id: 'tx-1', status: 'pending' } });
    const [path] = sb.storage.upload.mock.calls[0] as [string];
    expect(path).toMatch(/^user-1\/\d+_[a-z0-9]+\.jpg$/);
    expect(sb.rpcCalls[0]).toEqual({ fn: 'submit_deposit_request', args: { p_amount: 500, p_payment_method: 'Easypaisa', p_transaction_id: '7263652728817', p_proof_image: `https://storage.example.test/${path}` } });
    expect(eqValue(sb.callsTo('WalletTransaction')[2], 'id')).toBe('tx-1');
    expect(checkLimit).toHaveBeenCalledWith(expect.anything(), 'user-1', 'deposit');
    // the limiter gets a header-less stand-in request, so the key is the user id, not an IP
    expect(checkLimit.mock.calls[0][0].headers.get('x-forwarded-for')).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith('/profile/wallet');
  });

  it('still reports success when the new row cannot be read back', async () => {
    counts(null, null, { data: null, error: { message: 'race' } });
    sb.setRpc('submit_deposit_request', { data: { success: true, id: 'tx-1' } });
    expect(await actions.submitDepositRequest(depositForm({ proofImage: receipt(10, 'noext') }))).toEqual({ success: true, message: 'Deposit request submitted successfully' });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it.each(['noext', 'receipt.', 'receipt.j?g'])('stores a receipt named %j as .png', async (name) => {
    counts(0, 0);
    sb.setRpc('submit_deposit_request', { data: { success: true, id: 'tx-1' } });
    await actions.submitDepositRequest(depositForm({ proofImage: receipt(10, name) }));
    const [path] = sb.storage.upload.mock.calls[0] as [string];
    expect(path).toMatch(/^user-1\/\d+_[a-z0-9]+\.png$/);
  });

  it.each([
    ['a missing amount', { amount: null }, 'Minimum deposit amount is 5 PKR'],
    ['an amount below the minimum', { amount: '4.99' }, 'Minimum deposit amount is 5 PKR'],
    ['an unknown payment method', { paymentMethod: 'Crypto' }, 'Invalid payment method'],
    ['a blank transaction id', { transactionId: '   ' }, 'Transaction ID is required'],
    ['a missing transaction id', { transactionId: null }, 'Transaction ID is required'],
  ])('rejects %s before touching the database', async (_label, over, error) => {
    expect(await actions.submitDepositRequest(depositForm(over))).toEqual({ success: false, error });
    expect(sb.calls).toHaveLength(0);
  });

  it('caps pending deposits at two', async () => {
    counts(2, 0);
    expect((await actions.submitDepositRequest(depositForm())).error).toMatch(/already have 2 pending deposit requests/);
    sb.setTable('WalletTransaction', { error: { message: 'x' } });
    expect((await actions.submitDepositRequest(depositForm())).error).toBe('Failed to validate request. Please try again.');
  });

  it('blocks a duplicate amount and method within the hour', async () => {
    counts(1, 1);
    expect((await actions.submitDepositRequest(depositForm())).error).toMatch(/same amount and payment method/);
    const dupeQuery = sb.callsTo('WalletTransaction')[1];
    expect(eqValue(dupeQuery, 'amount')).toBe(500);
    expect(eqValue(dupeQuery, 'paymentMethod')).toBe('Easypaisa');
  });

  it('ignores a failed duplicate check', async () => {
    sb.setTable('WalletTransaction', [{ count: 0 }, { error: { message: 'x' } }, { data: { id: 'tx-1' } }]);
    sb.setRpc('submit_deposit_request', { data: { success: true, id: 'tx-1' } });
    expect((await actions.submitDepositRequest(depositForm())).success).toBe(true);
  });

  it('requires a receipt under 5 MB and reports upload failures', async () => {
    counts(0, 0);
    expect((await actions.submitDepositRequest(depositForm({ proofImage: null }))).error).toMatch(/screenshot is required/);
    counts(0, 0);
    expect((await actions.submitDepositRequest(depositForm({ proofImage: receipt(0) }))).error).toMatch(/screenshot is required/);
    counts(0, 0);
    expect((await actions.submitDepositRequest(depositForm({ proofImage: receipt(5 * 1024 * 1024 + 1) }))).error).toBe('Receipt image must be less than 5MB');
    counts(0, 0);
    sb.storage.upload.mockResolvedValueOnce({ data: null, error: { message: 'bucket full' } } as never);
    expect((await actions.submitDepositRequest(depositForm())).error).toBe('Failed to upload receipt image. Please try again.');
  });

  it('relays RPC errors and refusals', async () => {
    counts(0, 0);
    sb.setRpc('submit_deposit_request', { error: { message: 'Duplicate transaction ID' } });
    expect((await actions.submitDepositRequest(depositForm())).error).toBe('Duplicate transaction ID');
    counts(0, 0);
    sb.setRpc('submit_deposit_request', { error: { message: '' } });
    expect((await actions.submitDepositRequest(depositForm())).error).toBe('Failed to submit request');
    counts(0, 0);
    sb.setRpc('submit_deposit_request', { data: { success: false, error: 'Wallet disabled' } });
    expect((await actions.submitDepositRequest(depositForm())).error).toBe('Wallet disabled');
    counts(0, 0);
    sb.setRpc('submit_deposit_request', { data: { success: false } });
    expect((await actions.submitDepositRequest(depositForm())).error).toBe('Submission failed');
  });

  it('requires a session and honours the rate limit', async () => {
    checkLimit.mockResolvedValueOnce({ success: false });
    expect((await actions.submitDepositRequest(depositForm())).error).toBe('Too many deposit requests. Please try again later.');
    sb.setUser(null);
    expect((await actions.submitDepositRequest(depositForm())).error).toBe('You must be logged in to submit a deposit request');
  });

  it('turns exceptions into a generic error', async () => {
    checkLimit.mockRejectedValueOnce(new Error('redis down'));
    expect(await actions.submitDepositRequest(depositForm())).toEqual({ success: false, error: 'Failed to submit deposit request. Please try again.' });
  });
});

describe('getWalletBalance', () => {
  it('reads the balance by email', async () => {
    sb.setTable('User', { data: { walletBalance: 75 } });
    expect(await actions.getWalletBalance()).toEqual({ success: true, balance: 75 });
    expect(eqValue(sb.callsTo('User')[0], 'email')).toBe('player@example.test');
    sb.setTable('User', { data: { walletBalance: null } });
    expect(await actions.getWalletBalance()).toEqual({ success: true, balance: 0 });
  });

  it('returns 0 for an unsynced user and errors otherwise', async () => {
    sb.setTable('User', { error: { code: 'PGRST116' } });
    expect(await actions.getWalletBalance()).toEqual({ success: true, balance: 0 });
    sb.setTable('User', { error: { code: '500' } });
    expect(await actions.getWalletBalance()).toEqual({ success: false, error: 'Failed to fetch wallet balance' });
    sb.auth.getUser.mockRejectedValueOnce(new Error('x'));
    expect(await actions.getWalletBalance()).toEqual({ success: false, error: 'Failed to fetch wallet balance' });
    sb.setUser(null);
    expect((await actions.getWalletBalance()).error).toBe('You must be logged in to view wallet balance');
  });
});

describe('getTransactionHistory', () => {
  it("lists the player's transactions newest first", async () => {
    sb.setTable('User', { data: { id: 'db-user' } });
    sb.setTable('WalletTransaction', { data: [{ id: 't', paymentMethod: 'Bank', status: 'approved' }] });
    expect(await actions.getTransactionHistory()).toEqual({ success: true, transactions: [{ id: 't', paymentMethod: 'Bank', status: 'approved' }] });
    expect(eqValue(sb.callsTo('WalletTransaction')[0], 'userId')).toBe('db-user');
    sb.setTable('WalletTransaction', { data: null });
    expect(await actions.getTransactionHistory()).toEqual({ success: true, transactions: [] });
  });

  it('returns an empty list for an unsynced user and errors otherwise', async () => {
    sb.setTable('User', { data: null, error: { code: 'PGRST116' } });
    expect(await actions.getTransactionHistory()).toEqual({ success: true, transactions: [] });
    sb.setTable('User', { data: { id: 'db-user' } });
    sb.setTable('WalletTransaction', { error: { message: 'x' } });
    expect(await actions.getTransactionHistory()).toEqual({ success: false, error: 'Failed to fetch transaction history' });
    sb.auth.getUser.mockRejectedValueOnce(new Error('x'));
    expect(await actions.getTransactionHistory()).toEqual({ success: false, error: 'Failed to fetch transaction history' });
    sb.setUser(null);
    expect((await actions.getTransactionHistory()).error).toBe('You must be logged in to view transaction history');
  });
});
