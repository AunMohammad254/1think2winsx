import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

type Handler = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => void;
const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as { id: string } | null, isLoading: false },
  router: { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() },
  params: new URLSearchParams(),
  suspend: false,
  live: false,
  fetchWithRetry: vi.fn(),
  poll: null as null | { task: () => Promise<boolean>; opts: Record<string, unknown> },
  broadcast: null as null | { enabled: boolean; onSignal: (s: Record<string, unknown>) => void },
  handlers: {} as Record<string, Handler>,
  channel: { on: vi.fn(), subscribe: vi.fn() },
  removeChannel: vi.fn(),
  push: { notify: vi.fn(), open: vi.fn() },
  loader: null as null | (() => Promise<unknown>),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  wallet: { getWalletBalanceForDeduction: vi.fn(), deductWalletForQuizAccess: vi.fn(), getQuizAccessPrice: vi.fn() },
}));
vi.mock('@/app/live-quiz.css', () => ({}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/quizzes',
  useSearchParams: () => { if (h.suspend) throw new Promise(() => {}); return h.params; },
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/fetch-retry', () => ({ fetchWithRetry: (...a: unknown[]) => h.fetchWithRetry(...a) }));
vi.mock('@/hooks/useJitteredPolling', () => ({ useJitteredPolling: (task: () => Promise<boolean>, opts: Record<string, unknown>) => { h.poll = { task, opts }; } }));
vi.mock('@/hooks/useQuizBroadcast', () => ({ useQuizBroadcast: (o: { enabled: boolean; onSignal: (s: Record<string, unknown>) => void }) => { h.broadcast = o; } }));
vi.mock('@/lib/live-config', () => ({ get LIVE_BROADCAST_ENABLED() { return h.live; } }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ channel: () => h.channel, removeChannel: h.removeChannel }) }));
vi.mock('@/components/LazyStreamPlayer', () => ({ default: () => null }));
vi.mock('@/actions/wallet-deduction-actions', () => ({
  getWalletBalanceForDeduction: () => h.wallet.getWalletBalanceForDeduction(),
  deductWalletForQuizAccess: (...a: unknown[]) => h.wallet.deductWalletForQuizAccess(...a),
  getQuizAccessPrice: () => h.wallet.getQuizAccessPrice(),
}));
vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return {
    default: (loader: () => Promise<unknown>) => {
      h.loader = loader;
      return React.forwardRef(function LiveQuizPushStub(props: { onAnswered?: () => void }, ref) {
        React.useImperativeHandle(ref, () => h.push);
        return React.createElement('button', { onClick: props.onAnswered }, 'answered live quiz');
      });
    },
  };
});

import QuizzesPage from '@/app/quizzes/page';

const NOW = new Date('2026-10-16T10:00:00Z').getTime();
const quiz = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Quiz ${id}`, description: `About ${id}`, duration: 10, passingScore: 50, status: 'active', questionCount: 5, hasAccess: false,
  createdAt: '2026-10-01', updatedAt: '2026-10-01', pushedAt: null, ...over,
});
const list = [
  quiz('a', { title: 'Cricket Classics' }),
  quiz('b', { isCompleted: true, score: 80 }),
  quiz('c', { hasNewQuestions: true, newQuestionsCount: 2, description: 'Hockey legends' }),
  quiz('d', { status: 'upcoming', startsAt: '2026-10-16T12:00:00Z' }),
  quiz('e', { status: 'upcoming', startsAt: null }),
];
const ok = (data: Record<string, unknown> = {}) => jsonResponse({ quizzes: list, hasAccess: false, paymentInfo: null, walletEnabled: true, ...data });

beforeEach(() => {
  h.auth = { user: { id: 'u1' }, isLoading: false };
  h.params = new URLSearchParams();
  h.suspend = false;
  h.live = false;
  h.handlers = {};
  h.channel.on.mockReset().mockImplementation((_t: string, cfg: { event: string }, cb: Handler) => { h.handlers[cfg.event] = cb; return h.channel; });
  h.channel.subscribe.mockReset().mockReturnValue(h.channel);
  h.removeChannel.mockReset();
  for (const f of [h.router.push, h.router.replace, h.push.notify, h.push.open, ...Object.values(h.toast), ...Object.values(h.wallet)]) f.mockReset();
  h.fetchWithRetry.mockReset().mockImplementation(async () => ok());
  h.wallet.getWalletBalanceForDeduction.mockResolvedValue({ success: true, balance: 10 });
  h.wallet.getQuizAccessPrice.mockResolvedValue({ success: true, price: 2 });
  h.wallet.deductWalletForQuizAccess.mockResolvedValue({ success: true, newBalance: 8 });
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const loaded = () => screen.findByText('Cricket Classics');
const card = (title: string) => screen.getByText(title).closest('.quiz-card') as HTMLElement;

describe('quizzes page: loading', () => {
  it('sends signed-out visitors to login, and shows skeletons while auth or the flag loads', () => {
    h.auth = { user: null, isLoading: true };
    const { rerender, container } = render(<QuizzesPage />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    h.auth = { user: null, isLoading: false };
    rerender(<QuizzesPage />);
    expect(h.router.push).toHaveBeenCalledWith('/login');
  });

  it('shows a fallback while search params suspend', () => {
    h.suspend = true;
    const { container } = render(<QuizzesPage />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('lists quizzes and filters by tab and search', async () => {
    render(<QuizzesPage />);
    await loaded();
    expect(h.fetchWithRetry).toHaveBeenCalledWith('/api/quizzes', undefined, { retries: 2 });
    expect(screen.getByText(/Unlock 24-hour access for just 2 PKR/)).toBeInTheDocument();
    const tab = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
    tab(/^Available/);
    expect(screen.queryByText('Quiz b')).toBeNull();
    tab(/^Completed/);
    expect(screen.getByText('Quiz b')).toBeInTheDocument();
    expect(screen.queryByText('Cricket Classics')).toBeNull();
    tab(/^New Questions/);
    expect(screen.getByText('Quiz c')).toBeInTheDocument();
    tab(/^All Quizzes/);
    fireEvent.change(screen.getByPlaceholderText('Search quizzes...'), { target: { value: 'hockey' } });
    expect(screen.getByText('Quiz c')).toBeInTheDocument();
    expect(screen.queryByText('Cricket Classics')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search quizzes...'), { target: { value: 'zzz' } });
    expect(screen.getByText('Try adjusting your search or filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    expect(screen.getByText('Cricket Classics')).toBeInTheDocument();
  });

  it('explains an empty list without a search', async () => {
    h.fetchWithRetry.mockImplementation(async () => ok({ quizzes: undefined, hasAccess: undefined }));
    render(<QuizzesPage />);
    expect(await screen.findByText('There are no quizzes matching your criteria at the moment.')).toBeInTheDocument();
  });

  it('reports each kind of load failure', async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => jsonResponse({ message: 'Slow down!' }, 429), 'Slow down!'],
      [() => jsonResponse({}, 429), 'Too many requests. Please try again later.'],
      [() => jsonResponse({ error: 'Quiz service paused' }, 503), 'Quiz service paused'],
      [() => jsonResponse({ error: { code: 1 } }, 500), 'Failed to fetch quizzes'],
      [() => new Response('<html>', { status: 502 }), 'Failed to fetch quizzes'],
      [() => { throw new Error('offline'); }, 'offline'],
      [() => { throw 'odd'; }, 'Failed to load quizzes'],
    ];
    for (const [response, message] of cases) {
      h.fetchWithRetry.mockImplementationOnce(response);
      const { unmount } = render(<QuizzesPage />);
      expect(await screen.findByText(message)).toBeInTheDocument();
      unmount();
    }
    expect(h.toast.error).toHaveBeenCalledWith('Failed to load quizzes');
  });

  it('shows an access error the server sends with the list, and treats 304 as up to date', async () => {
    h.fetchWithRetry.mockImplementationOnce(async () => ok({ accessError: 'Your access expired' }));
    render(<QuizzesPage />);
    expect(await screen.findByText('Your access expired')).toBeInTheDocument();
    h.fetchWithRetry.mockImplementationOnce(async () => new Response(null, { status: 304 }));
    let result: boolean | undefined;
    await act(async () => { result = await h.poll!.task(); });
    expect(result).toBe(true);
    expect(h.fetchWithRetry).toHaveBeenLastCalledWith('/api/quizzes?fresh=1', undefined, { retries: 0 });
    expect(h.poll!.opts).toMatchObject({ intervalMs: 60_000, enabled: true });
  });
});

describe('quizzes page: access and payment', () => {
  it('shows the access countdown', async () => {
    // The countdown reads `new Date()`, which the Date.now mock doesn't reach, so the
    // expiry is set from the real clock.
    const expiresAt = new Date(new Date().valueOf() + 2 * 3600_000 + 5 * 60_000 + 7_000).toISOString();
    h.fetchWithRetry.mockImplementation(async () => ok({ hasAccess: true, paymentInfo: { id: 'p', expiresAt, timeRemaining: 1 } }));
    render(<QuizzesPage />);
    expect(await screen.findByText('Full Access Active')).toBeInTheDocument();
    expect(screen.getByText(/You have full access/)).toBeInTheDocument();
    // The countdown is filled in by an effect after the access banner renders.
    expect(await screen.findByText(/^2h 5m [67]s$/)).toBeInTheDocument();
  });

  it('expires access that has already run out', async () => {
    h.fetchWithRetry.mockImplementation(async () => ok({ hasAccess: true, paymentInfo: { id: 'p', expiresAt: '2000-01-01T00:00:00Z', timeRemaining: 0 } }));
    render(<QuizzesPage />);
    await waitFor(() => expect(h.toast.warning).toHaveBeenCalledWith('Your 24-hour access has expired'));
  });

  it('opens a quiz into the live popup when the player has access', async () => {
    h.fetchWithRetry.mockImplementation(async () => ok({ hasAccess: true }));
    render(<QuizzesPage />);
    await loaded();
    fireEvent.click(card('Cricket Classics'));
    expect(h.push.open).toHaveBeenCalledWith('a');
  });

  it('explains when an upcoming quiz goes live', async () => {
    render(<QuizzesPage />);
    await loaded();
    fireEvent.click(card('Quiz d'));
    expect(h.toast.info).toHaveBeenCalledWith(expect.stringMatching(/"Quiz d" hasn't started yet\. It goes live .+\./));
    fireEvent.click(card('Quiz e'));
    expect(h.toast.info).toHaveBeenLastCalledWith('"Quiz e" hasn\'t started yet. It goes live soon.');
  });

  it('pays from the wallet and refreshes the list', async () => {
    render(<QuizzesPage />);
    await loaded();
    fireEvent.click(card('Cricket Classics'));
    fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
    expect(await screen.findByText('Confirm Payment', { selector: 'h3' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Unlock Arena Access')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Payment' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Payment successful! You now have 24-hour access.'));
    expect(h.wallet.deductWalletForQuizAccess).toHaveBeenCalledWith(2);
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(2);
  });

  it('sends a short balance to the wallet page', async () => {
    h.wallet.getWalletBalanceForDeduction.mockResolvedValue({ success: false });
    h.wallet.getQuizAccessPrice.mockResolvedValue({ success: false });
    render(<QuizzesPage />);
    await loaded();
    fireEvent.click(card('Cricket Classics'));
    fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
    expect(await screen.findByText('Insufficient Balance')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(card('Cricket Classics'));
    fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
    fireEvent.click(await screen.findByRole('button', { name: /Manage Wallet/ }));
    expect(h.router.push).toHaveBeenCalledWith('/profile/wallet');
  });

  it('defaults a missing balance and price', async () => {
    h.wallet.getWalletBalanceForDeduction.mockResolvedValue({ success: true });
    h.wallet.getQuizAccessPrice.mockResolvedValue({ success: true });
    render(<QuizzesPage />);
    await loaded();
    fireEvent.click(card('Cricket Classics'));
    fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
    expect(await screen.findByText('Insufficient Balance')).toBeInTheDocument();
    expect(screen.getAllByText('2.00 PKR').length).toBeGreaterThan(0);
  });

  it('handles failed wallet payments', async () => {
    h.wallet.deductWalletForQuizAccess
      .mockResolvedValueOnce({ success: false, insufficientBalance: true })
      .mockResolvedValueOnce({ success: false, error: 'Wallet locked' })
      .mockResolvedValueOnce({ success: false })
      .mockRejectedValueOnce('odd')
      .mockResolvedValueOnce({ success: true });
    render(<QuizzesPage />);
    await loaded();
    const confirm = async () => {
      fireEvent.click(card('Cricket Classics'));
      fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm Payment' }));
    };
    await confirm();
    expect(await screen.findByText('Insufficient Balance')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await confirm();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Wallet locked'));
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === '×')!);
    await confirm();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Payment failed'));
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === '×')!);
    await confirm();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === '×')!);
    await confirm();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
    expect(screen.queryByText('Payment failed')).toBeNull();
  });

  it('closes the payment modal', async () => {
    render(<QuizzesPage />);
    await loaded();
    fireEvent.click(card('Cricket Classics'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Unlock Arena Access')).toBeNull();
  });
});

describe('quizzes page: live updates', () => {
  it('opens a deep-linked quiz when already on the page, and strips the parameter', async () => {
    const { rerender } = render(<QuizzesPage />);
    await loaded();
    h.params = new URLSearchParams('openQuiz=abc&tab=live');
    rerender(<QuizzesPage />);
    expect(h.push.open).toHaveBeenCalledWith('abc');
    expect(h.router.replace).toHaveBeenCalledWith('/quizzes?tab=live', { scroll: false });
    h.params = new URLSearchParams('openQuiz=xyz');
    rerender(<QuizzesPage />);
    expect(h.push.open).toHaveBeenLastCalledWith('xyz');
    expect(h.router.replace).toHaveBeenLastCalledWith('/quizzes', { scroll: false });
  });

  it('KNOWN BUG: a deep link on a fresh page load is dropped', async () => {
    // The effect runs while the page still shows its skeleton (walletEnabled is null), before the
    // LiveQuizPush ref exists, so open() is a no-op; it then strips ?openQuiz, so nothing retries.
    h.params = new URLSearchParams('openQuiz=abc');
    render(<QuizzesPage />);
    await loaded();
    expect(h.router.replace).toHaveBeenCalledWith('/quizzes', { scroll: false });
    expect(h.push.open).not.toHaveBeenCalled();
  });

  it('reacts to realtime inserts, pushes and deletes', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { unmount } = render(<QuizzesPage />);
    await loaded();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => h.handlers.INSERT({}));
    act(() => h.handlers.UPDATE({ new: { id: 'a', title: 'Cricket Classics', pushedAt: '2026-10-16T10:00:00Z' } }));
    expect(h.push.notify).toHaveBeenCalledWith('a', 'Cricket Classics');
    act(() => h.handlers.UPDATE({ new: { id: 'a', title: 'Cricket Classics', pushedAt: '2026-10-16T10:00:00Z' } }));
    act(() => h.handlers.UPDATE({ new: { id: 'b', title: 'Quiz b', pushedAt: null } }));
    expect(h.push.notify).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(h.fetchWithRetry).toHaveBeenLastCalledWith('/api/quizzes?fresh=1', undefined, { retries: 2 });
    vi.useRealTimers();
    act(() => h.handlers.DELETE({ old: { id: 'b' } }));
    expect(screen.queryByText('Quiz b')).toBeNull();
    act(() => h.handlers.INSERT({}));
    unmount();
    expect(h.removeChannel).toHaveBeenCalled();
  });

  it('applies broadcast signals in place, fetching only for unknown quizzes', async () => {
    h.live = true;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<QuizzesPage />);
    await loaded();
    expect(h.channel.on).not.toHaveBeenCalled();
    expect(h.broadcast!.enabled).toBe(true);
    act(() => h.broadcast!.onSignal({ op: 'UPDATE', id: 'a', title: 'Cricket Classics LIVE', status: 'active', pushedAt: '2026-10-16T10:00:00Z' }));
    expect(h.push.notify).toHaveBeenCalledWith('a', 'Cricket Classics LIVE');
    expect(screen.getByText('Cricket Classics LIVE')).toBeInTheDocument();
    act(() => h.broadcast!.onSignal({ op: 'UPDATE', id: 'a', title: 'Cricket Classics LIVE', status: 'active', pushedAt: '2026-10-16T10:00:00Z' }));
    expect(h.push.notify).toHaveBeenCalledTimes(1);
    const calls = h.fetchWithRetry.mock.calls.length;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => h.broadcast!.onSignal({ op: 'INSERT', id: 'zz', title: 'New one', status: 'active', pushedAt: null }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(h.fetchWithRetry.mock.calls.length).toBe(calls + 1);
  });

  it('refetches when a quiz is answered in the live popup', async () => {
    render(<QuizzesPage />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'answered live quiz' }));
    await waitFor(() => expect(h.fetchWithRetry).toHaveBeenLastCalledWith('/api/quizzes?fresh=1', undefined, { retries: 2 }));
    await expect(h.loader!()).resolves.toBeTruthy();
  });

  it('refetches when an upcoming quiz reaches its start time, but not for far-off ones', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const timers = vi.spyOn(window, 'setTimeout');
    h.fetchWithRetry.mockImplementation(async () => ok({ quizzes: [quiz('a', { title: 'Cricket Classics' }), quiz('soon', { status: 'upcoming', startsAt: new Date(NOW + 60_000).toISOString() })] }));
    const { unmount } = render(<QuizzesPage />);
    await loaded();
    const goLive = timers.mock.calls.find(([, ms]) => ms === 61_000);
    expect(goLive).toBeDefined();
    (goLive![0] as () => void)();
    await waitFor(() => expect(h.fetchWithRetry).toHaveBeenLastCalledWith('/api/quizzes?fresh=1', undefined, { retries: 2 }));
    unmount();
    timers.mockClear();
    h.fetchWithRetry.mockImplementation(async () => ok({ quizzes: [quiz('a', { title: 'Cricket Classics' }), quiz('later', { status: 'upcoming', startsAt: new Date(NOW + 40 * 86_400_000).toISOString() })] }));
    render(<QuizzesPage />);
    await loaded();
    expect(timers.mock.calls.some(([, ms]) => typeof ms === 'number' && ms > 2_000_000_000)).toBe(false);
  });

  it('keeps the wallet-enabled default when the list response omits it', async () => {
    h.fetchWithRetry.mockImplementation(async () => ok({ walletEnabled: undefined }));
    render(<QuizzesPage />);
    expect(await within(document.body).findByText('Cricket Classics')).toBeInTheDocument();
  });
});
