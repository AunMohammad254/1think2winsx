import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('sonner', () => ({ toast: h.toast }));

import WalletTransactionsManager from '@/components/admin/WalletTransactionsManager';

const tx = (id: string, over: Record<string, unknown> = {}) => ({
  id, userId: 'u', amount: 500, paymentMethod: 'Easypaisa', transactionId: `TX-${id}`, status: 'pending', proofImage: null, adminNotes: null,
  processedAt: null, processedBy: null, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z',
  user: { id: 'u', name: `User ${id}`, email: `${id}@x.com` }, ...over,
});
const list = [
  tx('t1', { proofImage: 'https://cdn/receipt.png' }),
  tx('t2', { paymentMethod: 'Jazzcash', user: { id: 'u', name: null, email: 'nameless@x.com' } }),
  tx('t3', { status: 'approved', processedAt: '2026-10-02T10:00:00Z', processedBy: 'admin@x' }),
  tx('t4', { status: 'rejected', adminNotes: 'Amount mismatch', processedAt: '2026-10-02T10:00:00Z', user: null }),
];

let fetchMock: ReturnType<typeof vi.fn>;
let hrefSetter: ReturnType<typeof vi.fn<(v: string) => void>>;
const realLocation = window.location;
const calls = (method: string) => fetchMock.mock.calls.filter(([, i]) => i?.method === method);

beforeEach(() => {
  for (const f of Object.values(h.toast)) f.mockReset();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) return jsonResponse({ message: 'Done', matchedIds: [], statementEntriesFound: 0 });
    return jsonResponse({ transactions: list });
  });
  vi.stubGlobal('fetch', fetchMock);
  hrefSetter = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { get href() { return 'http://localhost/admin'; }, set href(v: string) { hrefSetter(v); } } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const loaded = () => screen.findByText('User t1');
// A transaction's card: climb from its reference code to the child of the list container.
const card = (id: string) => {
  let el = screen.getByText(`TX-${id}`) as HTMLElement;
  while (el.parentElement && !el.parentElement.classList.contains('space-y-4')) el = el.parentElement;
  return el;
};

describe('WalletTransactionsManager', () => {
  it('lists deposits with stats, receipts and processing details', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/wallet-transactions?status=pending');
    expect(screen.getByText('PKR 500', { selector: 'p.text-2xl' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Image' })).toHaveAttribute('href', 'https://cdn/receipt.png');
    expect(screen.getAllByText('No receipt').length).toBe(3);
    expect(screen.getAllByText('Unknown User')).toHaveLength(2);
    expect(screen.getByText('n')).toBeInTheDocument(); // initial from the email
    expect(screen.getByText('Amount mismatch')).toBeInTheDocument();
    expect(screen.getByText(/by admin@x/)).toBeInTheDocument();
  });

  it('filters by status, method and search, with matching empty states', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    const [statusSelect, methodSelect] = screen.getAllByRole('combobox');
    fireEvent.change(methodSelect, { target: { value: 'Jazzcash' } });
    expect(screen.queryByText('User t1')).toBeNull();
    expect(screen.getByText('nameless@x.com')).toBeInTheDocument();
    fireEvent.change(methodSelect, { target: { value: 'all' } });
    const search = screen.getByPlaceholderText('Search by name, email, or transaction ID...');
    for (const term of ['user t1', 'nameless@', 'tx-t3', 'easypaisa']) {
      fireEvent.change(search, { target: { value: term } });
      expect(screen.queryByText('No Matching Transactions')).toBeNull();
    }
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No transactions match "zzz". Try adjusting your search.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
    expect(screen.getByText('User t1')).toBeInTheDocument();

    fetchMock.mockImplementation(async () => jsonResponse({}));
    fireEvent.change(statusSelect, { target: { value: 'approved' } });
    expect(await screen.findByText('No approved transactions found.')).toBeInTheDocument();
    fireEvent.change(statusSelect, { target: { value: 'all' } });
    expect(await screen.findByText('No deposit requests have been made yet.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/wallet-transactions?status=all');
  });

  it('refreshes, and handles expired sessions and failed loads', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Transactions refreshed'));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('/admin/login'));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to fetch transactions'));
    expect(screen.getByText('No Transactions Found')).toBeInTheDocument();
    fetchMock.mockRejectedValueOnce('odd');
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to load transactions'));
  });

  it('approves a deposit optimistically, and rolls back on failure', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    const approve = () => fireEvent.click(within(card('t1')).getByRole('button', { name: /Approve/ }));
    approve();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Deposit approved! Funds added to user wallet.', expect.anything()));
    expect(JSON.parse(calls('PATCH')[0][1].body)).toEqual({ transactionId: 't1', action: 'approve' });

    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'Already processed' }, 409));
    approve();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Already processed'));
    expect(within(card('t1')).getByText('Pending Review')).toBeInTheDocument();
    fetchMock.mockImplementationOnce(async () => jsonResponse({}, 500));
    approve();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to approve transaction'));
    fetchMock.mockImplementationOnce(async () => { throw 'odd'; });
    approve();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
  });

  it('ignores a second approve while one is processing', async () => {
    let release!: (r: Response) => void;
    render(<WalletTransactionsManager />);
    await loaded();
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)));
    fireEvent.click(within(card('t1')).getByRole('button', { name: /Approve/ }));
    fireEvent.click(within(card('t2')).getByRole('button', { name: /Approve/ }));
    fireEvent.click(within(card('t2')).getByRole('button', { name: /Reject/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reject Deposit/ }));
    expect(calls('PATCH')).toHaveLength(1);
    release(jsonResponse({}));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
  });

  it('rejects a deposit with a reason', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    fireEvent.click(within(card('t1')).getByRole('button', { name: /Reject/ }));
    fireEvent.change(screen.getByPlaceholderText(/Invalid transaction ID/), { target: { value: 'Wrong amount' } });
    fireEvent.click(screen.getByRole('button', { name: /Reject Deposit/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Transaction rejected', expect.anything()));
    expect(JSON.parse(calls('PATCH')[0][1].body)).toEqual({ transactionId: 't1', action: 'reject', notes: 'Wrong amount' });
    expect(screen.queryByText('Reject Deposit', { selector: 'h3' })).toBeNull();
  });

  it('reports reject failures and closes the modal by cancel or backdrop', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    const open = () => fireEvent.click(within(card('t1')).getByRole('button', { name: /Reject/ }));
    open();
    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'Not pending' }, 409)).mockImplementationOnce(async () => jsonResponse({}, 500)).mockImplementationOnce(async () => { throw 'x'; });
    const confirm = () => fireEvent.click(screen.getByRole('button', { name: /Reject Deposit/ }));
    confirm();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Not pending'));
    confirm();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to reject transaction'));
    confirm();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByText('Please provide a reason for rejection. This will be visible to the user.'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Please provide a reason', { exact: false })).toBeNull();
    open();
    fireEvent.click(screen.getByText(/Please provide a reason/).parentElement!.parentElement!);
    expect(screen.queryByText(/Please provide a reason/)).toBeNull();
  });

  it('selects pending deposits and approves them in bulk', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.queryByText(/selected$/)).toBeNull();
    fireEvent.click(screen.getByTitle('Select all pending on this page'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByTitle('Select all pending on this page'));
    fireEvent.click(screen.getByRole('button', { name: /Approve Selected/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Done'));
    const post = fetchMock.mock.calls.find(([u]) => u === '/api/admin/wallet-transactions/bulk-process')!;
    expect(JSON.parse(post[1].body)).toEqual({ transactionIds: ['t1', 't2'], action: 'approve' });
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('reports bulk approve failures', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    fireEvent.click(screen.getByTitle('Select all pending on this page'));
    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'Partial failure' }, 500)).mockImplementationOnce(async () => jsonResponse({}, 500)).mockImplementationOnce(async () => { throw 'x'; });
    const bulk = () => fireEvent.click(screen.getByRole('button', { name: /Approve Selected/ }));
    bulk();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Partial failure'));
    bulk();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to bulk approve'));
    bulk();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
    expect(h.toast.error).toHaveBeenLastCalledWith('Failed to bulk approve');
  });

  it('"Reject Selected" rejects every selected deposit through bulk-process with the reason', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    fireEvent.click(screen.getByTitle('Select all pending on this page'));
    fireEvent.click(screen.getByRole('button', { name: /Reject Selected/ }));
    fireEvent.change(screen.getByPlaceholderText(/Invalid transaction ID/), { target: { value: 'Duplicates' } });
    fireEvent.click(screen.getByRole('button', { name: /Reject Deposit/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Done'));
    const post = fetchMock.mock.calls.find(([u]) => u === '/api/admin/wallet-transactions/bulk-process')!;
    expect(JSON.parse(post[1].body)).toEqual({ transactionIds: ['t1', 't2'], action: 'reject', notes: 'Duplicates' });
    expect(calls('PATCH')).toHaveLength(0);
    expect(screen.queryByText('Reject Deposit', { selector: 'h3' })).toBeNull();
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('keeps the reject modal open with the selection when a bulk reject fails', async () => {
    render(<WalletTransactionsManager />);
    await loaded();
    fireEvent.click(screen.getByTitle('Select all pending on this page'));
    fireEvent.click(screen.getByRole('button', { name: /Reject Selected/ }));
    fireEvent.change(screen.getByPlaceholderText(/Invalid transaction ID/), { target: { value: 'Duplicates' } });
    let fail!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { fail = r; }));
    fireEvent.click(screen.getByRole('button', { name: /Reject Deposit/ }));
    expect(await screen.findByRole('button', { name: /Processing/ })).toBeDisabled();
    fail(jsonResponse({ error: 'Partial failure' }, 500));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Partial failure'));
    expect(screen.getByText('Reject Deposit', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Invalid transaction ID/)).toHaveValue('Duplicates');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  describe('statement reconciliation', () => {
    const upload = (container: HTMLElement) =>
      fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['csv'], 'statement.csv')] } });
    const reconcile = (data: unknown, status = 200) =>
      fetchMock.mockImplementationOnce(async (url: string) => (url.endsWith('/reconcile') ? jsonResponse(data, status) : jsonResponse({ transactions: list })));

    it('auto-approves matches and warns about unmatched deposits', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { container } = render(<WalletTransactionsManager />);
      await loaded();
      const click = vi.spyOn(container.querySelector('input[type=file]') as HTMLInputElement, 'click');
      fireEvent.click(screen.getByTitle(/Reconcile bank statement/));
      expect(click).toHaveBeenCalled();
      reconcile({ matchedIds: ['t1'], autoApproved: ['t1'], unmatchedPending: ['t2'], statementEntriesFound: 7 });
      upload(container);
      await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('✅ Statement reconciled: 1 transaction(s) auto-approved from 7 statement entries.', { duration: 6000 }));
      expect(h.toast.warning).toHaveBeenCalledWith(expect.stringContaining('1 pending deposit(s) could not be matched'), { duration: 8000 });
      const form = fetchMock.mock.calls.find(([u]) => u.endsWith('/reconcile'))![1].body as FormData;
      expect(form.get('auto_approve')).toBe('true');
    });

    it('selects matches for review when not auto-approving', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { container } = render(<WalletTransactionsManager />);
      await loaded();
      reconcile({ matchedIds: ['t1', 't2'], statementEntriesFound: 3 });
      upload(container);
      await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Found 2 matching transaction(s) from 3 statement entries — selected for review.', { duration: 5000 }));
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      expect(h.toast.warning).not.toHaveBeenCalled();
    });

    it('reports when nothing matched, and reconcile errors', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { container } = render(<WalletTransactionsManager />);
      await loaded();
      reconcile({});
      upload(container);
      await waitFor(() => expect(h.toast.info).toHaveBeenCalledWith('Statement parsed: 0 entries found. No matching pending transactions.'));
      reconcile({ error: 'Unreadable PDF' }, 400);
      upload(container);
      await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Unreadable PDF'));
      reconcile({}, 500);
      upload(container);
      await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to reconcile statement'));
      fetchMock.mockImplementationOnce(async () => { throw 'x'; });
      upload(container);
      await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Error reconciling statement'));
      fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [] } });
      expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/reconcile'))).toHaveLength(4);
    });
  });
});
