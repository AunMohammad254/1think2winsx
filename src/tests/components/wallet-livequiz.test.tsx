import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  fetchWithRetry: vi.fn(),
  getCSRFToken: vi.fn(),
  bank: {} as Record<string, unknown>,
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.getCSRFToken() }));
vi.mock('@/lib/fetch-retry', () => ({ fetchWithRetry: (...a: unknown[]) => h.fetchWithRetry(...a) }));
vi.mock('@/types/wallet', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/types/wallet')>();
  Object.assign(h.bank, real.ADMIN_BANK_DETAILS);
  return { ...real, ADMIN_BANK_DETAILS: h.bank };
});

import TransactionHistory from '@/components/wallet/TransactionHistory';
import DepositForm from '@/components/wallet/DepositForm';
import LiveQuizPush, { type LiveQuizPushHandle } from '@/components/quiz/LiveQuizPush';
import type { WalletTransaction } from '@/types/wallet';

const tx = (over: Partial<WalletTransaction>): WalletTransaction => ({
  id: Math.random().toString(36), userId: 'u', amount: 100, paymentMethod: 'Easypaisa', transactionId: 'TX1', status: 'approved',
  createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', ...over,
});

describe('TransactionHistory', () => {
  it('shows loading and empty states', () => {
    const { rerender } = render(<TransactionHistory transactions={[]} isLoading />);
    expect(screen.getByRole('status', { name: 'Loading transactions' })).toBeInTheDocument();
    rerender(<TransactionHistory transactions={[]} />);
    expect(screen.getByText('No Transactions')).toBeInTheDocument();
  });

  it('labels deposits by status and quiz-access deductions', () => {
    render(
      <TransactionHistory
        transactions={[
          tx({ status: 'approved' }),
          tx({ status: 'rejected', transactionId: 'TX2' }),
          tx({ status: 'pending', transactionId: 'quiz_access_x' }),
          tx({ amount: -2, paymentMethod: 'QuizAccess' as WalletTransaction['paymentMethod'], adminNotes: 'Daily pass' }),
          tx({ amount: -2, paymentMethod: 'Easypaisa', adminNotes: null }),
        ]}
      />,
    );
    expect(screen.getByRole('listitem', { name: 'Deposit of 100 PKR, status Approved' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Deposit of 100 PKR, status Rejected' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Deposit of 100 PKR, status Pending' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem', { name: 'Quiz Access of 2 PKR, status completed' })).toHaveLength(2);
    expect(screen.getByText('+100')).toBeInTheDocument();
    expect(screen.getByText('TX1')).toBeInTheDocument();
    expect(screen.queryByText('quiz_access_x')).toBeNull();
    expect(screen.getByText('Daily pass')).toBeInTheDocument();
  });

  it('loads more on demand', () => {
    render(<TransactionHistory transactions={Array.from({ length: 7 }, (_, i) => tx({ id: String(i) }))} initialLimit={3} loadMoreCount={3} />);
    expect(screen.getByText('Showing 3 of 7 transactions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load 4 more transactions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 more transactions' }));
    expect(screen.getByText('Showing 7 of 7 transactions')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('DepositForm', () => {
  const fill = (amount: string, txId: string, file?: File) => {
    fireEvent.change(screen.getByLabelText('Amount (PKR)'), { target: { value: amount } });
    fireEvent.change(screen.getByLabelText('Transaction ID / Reference Number'), { target: { value: txId } });
    if (file) fireEvent.change(screen.getByLabelText(/Proof of Payment/), { target: { files: [file] } });
  };
  const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'Deposit form' }));

  it('validates amount, transaction id and proof before submitting', async () => {
    const onSubmit = vi.fn();
    render(<DepositForm onSubmit={onSubmit} />);
    fill('2', 'x');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Minimum deposit amount is 5 PKR');
    fill('50', '   ');
    submit();
    expect(await screen.findByText('Please enter the transaction ID from your payment app')).toBeInTheDocument();
    fill('50', 'TX9');
    submit();
    expect(await screen.findByText('Please upload a screenshot of your payment as proof')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the deposit and resets on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: true });
    render(<DepositForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Jazzcash' }));
    expect(screen.getByText(/Jazzcash details not available yet/)).toBeInTheDocument();
    fill('50', ' TX9 ', new File(['x'], 'proof.png', { type: 'image/png' }));
    expect(screen.getByText('Selected')).toBeInTheDocument();
    submit();
    expect(await screen.findByText('Deposit request submitted successfully!')).toBeInTheDocument();
    const fd = onSubmit.mock.calls[0][0] as FormData;
    expect([fd.get('amount'), fd.get('paymentMethod'), fd.get('transactionId')]).toEqual(['50', 'Jazzcash', 'TX9']);
    expect(fd.get('proofImage')).toBeInstanceOf(File);
    expect(screen.getByLabelText('Amount (PKR)')).toHaveValue(null);
  });

  it('shows the server error, or a default one', async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce({ success: false, error: 'Duplicate transaction ID' }).mockResolvedValueOnce({ success: false });
    render(<DepositForm onSubmit={onSubmit} />);
    fill('50', 'TX9', new File(['x'], 'proof.png'));
    submit();
    expect(await screen.findByText('Duplicate transaction ID')).toBeInTheDocument();
    submit();
    expect(await screen.findByText('Failed to submit deposit request')).toBeInTheDocument();
  });

  it('shows the account for each payment method that has one configured', () => {
    Object.assign(h.bank, {
      jazzcash: { accountName: 'JC Name', accountNumber: '0300' },
      bank: { bankName: 'HBL', accountName: 'Bank Name', accountNumber: '1234', iban: 'PK00HBL' },
    });
    const { rerender } = render(<DepositForm onSubmit={vi.fn()} isSubmitting />);
    expect(screen.getByRole('button', { name: /Submitting/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Jazzcash' }));
    expect(screen.getByText('JC Name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Bank' }));
    expect(screen.getByText('PK00HBL')).toBeInTheDocument();
    h.bank.bank = { bankName: 'HBL', accountName: 'Bank Name', accountNumber: '1234' };
    rerender(<DepositForm onSubmit={vi.fn()} />);
    expect(screen.queryByText('IBAN:')).toBeNull();
    delete h.bank.bank;
    delete h.bank.easypaisa;
    rerender(<DepositForm onSubmit={vi.fn()} key="fresh" />);
    expect(screen.getByText(/Send payment to this account/).parentElement!.textContent).not.toContain('Account Name');
    fireEvent.click(screen.getByRole('radio', { name: 'Bank' }));
    expect(screen.getByText(/Bank transfer details not available yet/)).toBeInTheDocument();
  });
});

describe('LiveQuizPush', () => {
  const quiz = { id: 'q1', title: 'Live Cricket', questions: [{ id: 'a', text: 'Who?', options: ['Babar', 'Rizwan'] }, { id: 'b', text: 'When?', options: ['1992', '2009'] }] };
  let ref: React.RefObject<LiveQuizPushHandle | null>;
  const setup = (onAnswered = vi.fn()) => {
    ref = createRef<LiveQuizPushHandle>();
    const utils = render(<LiveQuizPush ref={ref} onAnswered={onAnswered} />);
    return { ...utils, onAnswered };
  };

  beforeEach(() => {
    h.fetchWithRetry.mockReset().mockImplementation(async () => jsonResponse({ quiz }));
    h.getCSRFToken.mockReset().mockResolvedValue('tok');
    h.toast.success.mockReset();
    h.toast.error.mockReset();
    window.innerWidth = 1024;
  });
  afterEach(() => vi.useRealTimers());

  it('renders nothing until a quiz is pushed', () => {
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a toast that hides itself after 8 seconds', () => {
    vi.useFakeTimers();
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    expect(screen.getByText('New quiz just dropped')).toBeInTheDocument();
    act(() => ref.current!.notify('q1', 'Live Cricket')); // a second push restarts the timer
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.queryByText('New quiz just dropped')).toBeNull();
  });

  it('closes the toast from its X button', () => {
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    expect(screen.queryByText('New quiz just dropped')).toBeNull();
  });

  it('opens from the toast, answers every question and locks the answer', async () => {
    const { onAnswered } = setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    fireEvent.click(screen.getByText('New quiz just dropped'));
    expect(await screen.findByText('1. Who?')).toBeInTheDocument();
    expect(h.fetchWithRetry).toHaveBeenCalledWith('/api/quizzes/q1', undefined, { retries: 3 });
    const submit = screen.getByRole('button', { name: 'Answer all 2 questions' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByText('Rizwan'));
    fireEvent.click(screen.getByText('1992'));
    expect(screen.getByText('Rizwan').className).toContain('picked');

    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    expect(await screen.findByText('Answer locked in — waiting for results')).toBeInTheDocument();
    const [url, init, opts] = h.fetchWithRetry.mock.calls.at(-1)!;
    expect(url).toBe('/api/quizzes/q1/submit');
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(JSON.parse(init.body)).toEqual({ answers: [{ questionId: 'a', selectedOption: 1 }, { questionId: 'b', selectedOption: 0 }] });
    expect(opts).toEqual({ retries: 4, retryOn: [502, 503, 504] });
    expect(h.toast.success).toHaveBeenCalledWith('Answer locked in!');
    expect(onAnswered).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Babar'));
    expect(screen.getByText('Babar').className).not.toContain('picked');
  });

  it('keeps answers across close and reopen, and toggles split view', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    expect(await screen.findByText('1. Who?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Babar'));
    fireEvent.click(screen.getByTitle('Split view'));
    expect(screen.getByText('Split view: the stream keeps playing beside the quiz.')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Back to popup'));
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.queryByText('1. Who?')).toBeNull();
    act(() => ref.current!.open('q1'));
    expect(await screen.findByText('Babar')).toHaveClass('picked');

    const panel = screen.getByText('1. Who?').closest('.quiz-pop')!;
    fireEvent.click(screen.getByText('1. Who?'));
    expect(screen.getByText('1. Who?')).toBeInTheDocument();
    fireEvent.click(panel);
    expect(screen.queryByText('1. Who?')).toBeNull();
  });

  it('opens in split view on phones, from the toast and from a deep link', async () => {
    window.innerWidth = 500;
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    fireEvent.click(screen.getByText('New quiz just dropped'));
    expect(await screen.findByText('Split view: the stream keeps playing beside the quiz.')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Close'));
    act(() => ref.current!.open('q2'));
    expect(await screen.findByText('Split view: the stream keeps playing beside the quiz.')).toBeInTheDocument();
  });

  it('a new push of the same quiz starts fresh and loads it once', async () => {
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    fireEvent.click(screen.getByText('New quiz just dropped'));
    await screen.findByText('1. Who?');
    fireEvent.click(screen.getByTitle('Close'));
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    h.fetchWithRetry.mockClear();
    fireEvent.click(screen.getByText('New quiz just dropped'));
    await screen.findByText('1. Who?');
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('explains why a quiz could not be loaded', async () => {
    setup();
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ upcoming: true, startsAt: '2026-10-20T15:00:00Z' }, 403));
    act(() => ref.current!.open('q1'));
    expect(await screen.findByText(/hasn't started yet/)).toBeInTheDocument();
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ error: 'Quiz ended' }, 410));
    act(() => ref.current!.open('q2'));
    expect(await screen.findByText('Quiz ended')).toBeInTheDocument();
    h.fetchWithRetry.mockResolvedValueOnce(new Response('not json', { status: 500 }));
    act(() => ref.current!.open('q3'));
    expect(await screen.findByText('This quiz is no longer available')).toBeInTheDocument();
    h.fetchWithRetry.mockRejectedValueOnce(new Error('offline'));
    act(() => ref.current!.open('q4'));
    expect(await screen.findByText('offline')).toBeInTheDocument();
    h.fetchWithRetry.mockRejectedValueOnce('odd');
    act(() => ref.current!.open('q5'));
    expect(await screen.findByText('Failed to load quiz')).toBeInTheDocument();
    // a failed load is not retried by reopening from the toast path
    act(() => ref.current!.notify('q5', 'Again'));
    h.fetchWithRetry.mockClear();
    h.fetchWithRetry.mockRejectedValueOnce('odd');
    fireEvent.click(screen.getByText('New quiz just dropped'));
    expect(await screen.findByText('Failed to load quiz')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Close'));
    fireEvent.click(document.body);
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('reports submit failures and allows another try', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(screen.getByText('Babar'));
    fireEvent.click(screen.getByText('2009'));
    const lock = () => fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));

    h.getCSRFToken.mockResolvedValueOnce(null);
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ error: 'Too many submissions' }, 429));
    lock();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Too many submissions'));
    expect(h.fetchWithRetry.mock.calls.at(-1)![1].headers['X-CSRF-Token']).toBe('');
    h.fetchWithRetry.mockResolvedValueOnce(new Response('x', { status: 500 }));
    lock();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to submit'));
    h.fetchWithRetry.mockRejectedValueOnce(new Error('network down'));
    lock();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('network down'));
    h.fetchWithRetry.mockRejectedValueOnce('odd');
    lock();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to submit your answer'));
    expect(screen.getByRole('button', { name: 'Lock in answer' })).toBeEnabled();
  });

  it('ignores a submit while one is in flight', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(screen.getByText('Babar'));
    fireEvent.click(screen.getByText('2009'));
    let release!: (r: Response) => void;
    h.fetchWithRetry.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    const busy = await screen.findByRole('button', { name: 'Submitting...' });
    expect(busy).toBeDisabled();
    await act(async () => release(jsonResponse({})));
    expect(await screen.findByText('Answer locked in — waiting for results')).toBeInTheDocument();
  });
});
