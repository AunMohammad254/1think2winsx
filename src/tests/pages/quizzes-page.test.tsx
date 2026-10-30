import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import { NEW_NOTICE_EVENT, UNREAD_COUNT_EVENT } from '@/lib/live-catalog';

type Poll = { task: () => Promise<boolean>; opts: Record<string, unknown> };
const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as { id: string } | null, isLoading: false },
  router: { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() },
  params: new URLSearchParams(),
  suspend: false,
  fetchWithRetry: vi.fn(),
  liveFetch: vi.fn(),
  // Keyed by interval: the slow personal poll and the 5 s live check
  polls: {} as Record<number, Poll>,
  push: { notify: vi.fn(), announce: vi.fn(), open: vi.fn(), setEntriesClosed: vi.fn(), match: vi.fn() },
  // Latest props the page gave LazyStreamPlayer
  streamProps: null as null | { onAvailabilityChange?: (available: boolean) => void },
  // false: LiveQuizPush's lazy chunk has not loaded yet
  pushMounted: true,
  // Latest props the page gave LiveQuizPush
  liveProps: null as null | { canUseSharedCopy?: (quizId: string) => boolean },
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
vi.mock('@/hooks/useJitteredPolling', () => ({ useJitteredPolling: (task: () => Promise<boolean>, opts: Record<string, unknown>) => { h.polls[opts.intervalMs as number] = { task, opts }; } }));
vi.mock('@/components/LazyStreamPlayer', () => ({ default: (props: { onAvailabilityChange?: (available: boolean) => void }) => { h.streamProps = props; return null; } }));
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
      const LiveQuizPushStub = React.forwardRef(function LiveQuizPushStub(props: { onAnswered?: () => void; canUseSharedCopy?: (quizId: string) => boolean }, ref) {
        React.useImperativeHandle(ref, () => h.push);
        h.liveProps = props;
        return React.createElement('button', { onClick: props.onAnswered }, 'answered live quiz');
      });
      // Like next/dynamic, renders nothing until the chunk has loaded
      return React.forwardRef(function DynamicStub(props: object, ref) {
        return h.pushMounted ? React.createElement(LiveQuizPushStub, { ...props, ref }) : null;
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
// The public /api/live snapshot (src/lib/live-catalog.ts)
const liveQuiz = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Quiz ${id}`, description: `About ${id}`, duration: 10, passingScore: 50, status: 'active', questionCount: 5,
  totalAttempts: 0, pushedAt: null, startsAt: null, createdAt: '2026-10-01', updatedAt: '2026-10-01', ...over,
});
const snapshot = (version: string, quizzes: Array<Record<string, unknown>>) => jsonResponse({ version, quizzes });
const livePoll = () => h.polls[5_000];

beforeEach(() => {
  h.auth = { user: { id: 'u1' }, isLoading: false };
  h.params = new URLSearchParams();
  h.suspend = false;
  h.polls = {};
  h.pushMounted = true;
  for (const f of [h.router.push, h.router.replace, h.push.notify, h.push.announce, h.push.open, h.push.setEntriesClosed, h.push.match, ...Object.values(h.toast), ...Object.values(h.wallet)]) f.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  h.fetchWithRetry.mockReset().mockImplementation(async () => ok());
  h.liveFetch.mockReset().mockImplementation(async () => snapshot('v0', []));
  vi.stubGlobal('fetch', (...a: unknown[]) => h.liveFetch(...a));
  h.wallet.getWalletBalanceForDeduction.mockResolvedValue({ success: true, balance: 10 });
  h.wallet.getQuizAccessPrice.mockResolvedValue({ success: true, price: 2 });
  h.wallet.deductWalletForQuizAccess.mockResolvedValue({ success: true, newBalance: 8 });
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    await act(async () => { result = await h.polls[300_000].task(); });
    expect(result).toBe(true);
    expect(h.fetchWithRetry).toHaveBeenLastCalledWith('/api/quizzes?fresh=1', undefined, { retries: 0 });
    // The personal list is a slow safety net; public changes come from the 5 s live check
    expect(h.polls[300_000].opts).toMatchObject({ jitterMs: 60_000, enabled: true });
    expect(livePoll().opts).toMatchObject({ jitterMs: 2_000, enabled: true });
  });
});

describe('quizzes page: access and payment', () => {
  it('shows the access countdown', async () => {
    // The countdown reads `new Date()`, which the Date.now mock doesn't reach, so the
    // expiry is set from the real clock.
    const expiresAt = new Date(new Date().valueOf() + 2 * 3600_000 + 5 * 60_000 + 7_000).toISOString();
    h.fetchWithRetry.mockImplementation(async () => ok({ hasAccess: true, paymentInfo: { id: 'p', expiresAt } }));
    render(<QuizzesPage />);
    expect(await screen.findByText('Full Access Active')).toBeInTheDocument();
    expect(screen.getByText(/You have full access/)).toBeInTheDocument();
    // The countdown is filled in by an effect after the access banner renders.
    expect(await screen.findByText(/^2h 5m [67]s$/)).toBeInTheDocument();
  });

  it('expires access that has already run out', async () => {
    h.fetchWithRetry.mockImplementation(async () => ok({ hasAccess: true, paymentInfo: { id: 'p', expiresAt: '2000-01-01T00:00:00Z' } }));
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

  it('opens a deep-linked quiz on a fresh page load, once LiveQuizPush has mounted', async () => {
    h.params = new URLSearchParams('openQuiz=abc');
    const { rerender } = render(<QuizzesPage />);
    await loaded();
    expect(h.router.replace).toHaveBeenCalledWith('/quizzes', { scroll: false });
    expect(h.push.open).toHaveBeenCalledTimes(1);
    expect(h.push.open).toHaveBeenCalledWith('abc');
    rerender(<QuizzesPage />); // the handle re-attaching does not reopen it
    expect(h.push.open).toHaveBeenCalledTimes(1);
  });

  it('shows the countdown of a quiz linked from an "upcoming" notice on the stream, or opens it once it is live', async () => {
    const { rerender } = render(<QuizzesPage />);
    await loaded();
    h.params = new URLSearchParams('upcoming=d&tab=live');
    rerender(<QuizzesPage />);
    expect(h.push.announce).toHaveBeenCalledWith('d', 'Quiz d', '2026-10-16T12:00:00Z');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(h.router.replace).toHaveBeenLastCalledWith('/quizzes?tab=live', { scroll: false });

    // Live by now: straight into the quiz
    h.params = new URLSearchParams('upcoming=a');
    rerender(<QuizzesPage />);
    expect(h.push.open).toHaveBeenCalledWith('a');
    expect(h.router.replace).toHaveBeenLastCalledWith('/quizzes', { scroll: false });

    // An upcoming quiz without a start time, and one that isn't listed (not announced, or cancelled)
    h.params = new URLSearchParams('upcoming=e');
    rerender(<QuizzesPage />);
    expect(h.push.announce).toHaveBeenLastCalledWith('e', 'Quiz e', null);
    h.params = new URLSearchParams('upcoming=gone');
    rerender(<QuizzesPage />);
    expect(h.toast.info).toHaveBeenCalledWith("That quiz hasn't started yet. It shows up here when it goes live.");
  });

  it('resolves an "upcoming" link that arrives before the list and the live quiz component', async () => {
    h.pushMounted = false;
    h.params = new URLSearchParams('upcoming=d');
    const { rerender } = render(<QuizzesPage />);
    await loaded();
    expect(h.push.announce).not.toHaveBeenCalled();
    h.pushMounted = true;
    rerender(<QuizzesPage />);
    expect(h.push.announce).toHaveBeenCalledTimes(1);
    expect(h.push.announce).toHaveBeenCalledWith('d', 'Quiz d', '2026-10-16T12:00:00Z');
    // Resolved once: later list changes don't announce it again
    await act(async () => { await h.polls[300_000].task(); });
    expect(h.push.announce).toHaveBeenCalledTimes(1);
  });

  it("pops a live match's over up on the stream, from the match the live check lists, with no list or page of its own", async () => {
    const closesAt = new Date(Date.now() + 90_000).toISOString();
    const feed = {
      match: { id: 'm1', quizId: 'mq1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 20, status: 'live', settled: false, entriesClosed: false },
      innings: [{ innings: 1, battingTeam: 'Lahore', endReason: null, runs: 48, wickets: 2, oversText: '6.0', target: null, overs: [] }],
      questions: [{ id: 'r', innings: 1, over: 7, text: 'Will over 7 go for 8 or more runs?', textRomanUrdu: 'Kya over 7 mein 8 ya zyada runs banenge?', options: ['Yes', 'No'], state: 'open', closesAt, correctOption: null }],
      // This file mocks Date.now, not new Date()
      serverNow: new Date(Date.now()).toISOString(),
    };
    h.liveFetch.mockImplementation(async (url: string) => {
      if (url === '/api/live/matches/m1') return jsonResponse(feed);
      if (url === '/api/quizzes/mq1/answers') return jsonResponse({ answers: [] });
      return jsonResponse({ version: 'm-a', quizzes: [], matches: [{ id: 'm1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', status: 'live' }] });
    });
    render(<QuizzesPage />);
    await loaded();
    await act(async () => { await livePoll().task(); });
    await waitFor(() => expect(h.push.match).toHaveBeenCalledWith(expect.objectContaining({
      key: 'm1:1.7', quizId: 'mq1', matchTitle: 'Lahore vs Karachi', over: 7, score: 'Lahore 48/2 (6.0 overs)',
    })));
    expect(h.liveFetch).toHaveBeenCalledWith('/api/live/matches/m1', { credentials: 'omit' });
    // Polled every 3 s while a match is on
    expect(h.polls[3_000].opts).toMatchObject({ enabled: true });
    expect(screen.queryByRole('region', { name: 'Live matches' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Lahore vs Karachi/ })).toBeNull();
  });

  it('patches the list in place from the live snapshot, and pops up a newly pushed quiz once', async () => {
    render(<QuizzesPage />);
    await loaded();
    const pushedAt = '2026-10-16T10:00:00.000Z';
    h.liveFetch.mockImplementation(async () => snapshot('v1', [
      liveQuiz('a', { title: 'Cricket Classics LIVE', pushedAt }),
      liveQuiz('c'),
      liveQuiz('zz', { title: 'Brand new quiz' }),
    ]));
    let result: boolean | undefined;
    await act(async () => { result = await livePoll().task(); });
    expect(result).toBe(true);
    expect(h.liveFetch).toHaveBeenCalledWith('/api/live', { credentials: 'omit' });
    expect(h.push.notify).toHaveBeenCalledTimes(1);
    // With its answering window (pushedAt + duration), for the countdown
    expect(h.push.notify).toHaveBeenCalledWith('a', 'Cricket Classics LIVE', '2026-10-16T10:10:00.000Z', 10);
    // A toast says so too, and its button opens the quiz
    expect(h.toast.info).toHaveBeenCalledWith('New quiz live: Cricket Classics LIVE', expect.objectContaining({ description: 'Tap to play now', duration: 10000 }));
    h.toast.info.mock.calls[0][1].action.onClick();
    expect(h.push.open).toHaveBeenCalledWith('a');
    expect(screen.getByText('Cricket Classics LIVE')).toBeInTheDocument();
    expect(screen.getByText('Brand new quiz')).toBeInTheDocument();
    expect(screen.queryByText('Quiz b')).toBeNull();
    const personalCalls = h.fetchWithRetry.mock.calls.length;
    // The same version again changes nothing; a new version keeps the push it already showed
    await act(async () => { await livePoll().task(); });
    h.liveFetch.mockImplementation(async () => snapshot('v2', [liveQuiz('a', { title: 'Cricket Classics LIVE', pushedAt, totalAttempts: 9 })]));
    await act(async () => { await livePoll().task(); });
    expect(h.push.notify).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Brand new quiz')).toBeNull();
    // Public changes never cost a personal request
    expect(h.fetchWithRetry.mock.calls.length).toBe(personalCalls);
  });

  it('closes entries in the quiz panel for a full quiz this player has not entered, never for one they have', async () => {
    render(<QuizzesPage />);
    await loaded();
    // b is completed by this player: they can still answer questions added to it
    h.liveFetch.mockImplementation(async () => snapshot('v1', [
      liveQuiz('a', { entriesClosed: true }), liveQuiz('b', { entriesClosed: true }), liveQuiz('c', { entriesClosed: false }),
    ]));
    await act(async () => { await livePoll().task(); });
    expect(h.push.setEntriesClosed.mock.calls).toEqual([['a', true], ['b', false], ['c', false]]);
    // The limit was raised: the next snapshot reopens a
    h.push.setEntriesClosed.mockClear();
    h.liveFetch.mockImplementation(async () => snapshot('v2', [liveQuiz('a', { entriesClosed: false })]));
    await act(async () => { await livePoll().task(); });
    expect(h.push.setEntriesClosed).toHaveBeenCalledWith('a', false);
  });

  it('pops up a newly announced upcoming quiz once, and has the bell count every new notice at once', async () => {
    const notices: Event[] = [];
    const onNotice = (e: Event) => notices.push(e);
    window.addEventListener(NEW_NOTICE_EVENT, onNotice);
    const announcedAt = '2026-10-16T09:30:00.000Z';
    // Already announced when the page loaded: not news
    h.fetchWithRetry.mockImplementation(async () => ok({ quizzes: [...list, quiz('old', { status: 'upcoming', startsAt: '2026-10-16T13:00:00.000Z', announcedAt })] }));
    render(<QuizzesPage />);
    await loaded();
    h.liveFetch.mockImplementation(async () => snapshot('v1', [
      liveQuiz('a', { title: 'Cricket Classics', pushedAt: '2026-10-16T10:00:00.000Z' }),
      liveQuiz('old', { status: 'upcoming', startsAt: '2026-10-16T13:00:00.000Z', announcedAt }),
      liveQuiz('toss', { title: 'Toss prediction', status: 'upcoming', startsAt: '2026-10-16T11:00:00.000Z', announcedAt }),
    ]));
    await act(async () => { await livePoll().task(); });
    expect(h.push.announce).toHaveBeenCalledTimes(1);
    expect(h.push.announce).toHaveBeenCalledWith('toss', 'Toss prediction', '2026-10-16T11:00:00.000Z');
    // One push and one announcement: the server stored a notification for each
    expect(notices).toHaveLength(2);

    // Announced again (forced, or the 10-minute warning): it pops up again
    h.liveFetch.mockImplementation(async () => snapshot('v2', [
      liveQuiz('a', { title: 'Cricket Classics', pushedAt: '2026-10-16T10:00:00.000Z' }),
      liveQuiz('toss', { title: 'Toss prediction', status: 'upcoming', startsAt: '2026-10-16T11:00:00.000Z', announcedAt: '2026-10-16T10:50:00.000Z' }),
    ]));
    await act(async () => { await livePoll().task(); });
    expect(h.push.announce).toHaveBeenCalledTimes(2);
    expect(notices).toHaveLength(3);
    window.removeEventListener(NEW_NOTICE_EVENT, onNotice);
  });

  it('drops the empty video box when nothing is live', async () => {
    const { container } = render(<QuizzesPage />);
    await loaded();
    expect(container.querySelector('.stream-section')).not.toHaveClass('no-stream');
    act(() => h.streamProps!.onAvailabilityChange!(false));
    expect(container.querySelector('.stream-section')).toHaveClass('no-stream');
  });

  it('waits for the first personal load, and backs off when the live check fails', async () => {
    h.fetchWithRetry.mockImplementationOnce(() => new Promise(() => {}));
    const { unmount } = render(<QuizzesPage />);
    let result: boolean | undefined;
    await act(async () => { result = await livePoll().task(); });
    expect(result).toBe(true);
    expect(h.liveFetch).not.toHaveBeenCalled();
    unmount();

    render(<QuizzesPage />);
    await loaded();
    h.liveFetch.mockImplementationOnce(async () => jsonResponse({ error: 'busy' }, 503));
    await act(async () => { result = await livePoll().task(); });
    expect(result).toBe(false);
    h.liveFetch.mockImplementationOnce(async () => { throw new Error('offline'); });
    await act(async () => { result = await livePoll().task(); });
    expect(result).toBe(false);
  });

  it('refetches the personal list, spread out, when questions change on a completed quiz', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { unmount } = render(<QuizzesPage />);
    await loaded();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const withB = (version: string, questionCount: number) => async () =>
      snapshot(version, [liveQuiz('a', { title: 'Cricket Classics' }), liveQuiz('b', { questionCount })]);
    h.liveFetch.mockImplementation(withB('v1', 6));
    await act(async () => { await livePoll().task(); });
    // A second change before the timer fires restarts it rather than adding a request
    h.liveFetch.mockImplementation(withB('v2', 7));
    await act(async () => { await livePoll().task(); });
    const before = h.fetchWithRetry.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(h.fetchWithRetry.mock.calls.length).toBe(before + 1);
    expect(h.fetchWithRetry).toHaveBeenLastCalledWith('/api/quizzes?fresh=1', undefined, { retries: 2 });
    // A refetch still pending when the page closes is dropped
    h.liveFetch.mockImplementation(withB('v3', 8));
    await act(async () => { await livePoll().task(); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(h.fetchWithRetry.mock.calls.length).toBe(before + 1);
  });

  it('hands the unread notification count from the personal list to the bell', async () => {
    const counts: unknown[] = [];
    const onCount = (e: Event) => counts.push((e as CustomEvent).detail);
    window.addEventListener(UNREAD_COUNT_EVENT, onCount);
    h.fetchWithRetry.mockImplementationOnce(async () => ok({ unreadNotifications: 3 }));
    render(<QuizzesPage />);
    await loaded();
    // A list without a count (e.g. it could not be read) leaves the bell alone
    await act(async () => { await h.polls[300_000].task(); });
    window.removeEventListener(UNREAD_COUNT_EVENT, onCount);
    expect(counts).toEqual([3]);
  });

  it('refetches when a quiz is answered in the live popup', async () => {
    render(<QuizzesPage />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'answered live quiz' }));
    await waitFor(() => expect(h.fetchWithRetry).toHaveBeenLastCalledWith('/api/quizzes?fresh=1', undefined, { retries: 2 }));
    await expect(h.loader!()).resolves.toBeTruthy();
  });

  it('checks the live snapshot when an upcoming quiz reaches its start time, but not for far-off ones', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const timers = vi.spyOn(window, 'setTimeout');
    h.fetchWithRetry.mockImplementation(async () => ok({ quizzes: [quiz('a', { title: 'Cricket Classics' }), quiz('soon', { status: 'upcoming', startsAt: new Date(NOW + 60_000).toISOString() })] }));
    const { unmount } = render(<QuizzesPage />);
    await loaded();
    // The effect that sets the timer runs after the list renders: wait for it rather than checking once
    // (checking once failed when the machine was busy)
    let goLive: (typeof timers.mock.calls)[number] | undefined;
    await waitFor(() => {
      goLive = timers.mock.calls.find(([, ms]) => ms === 61_000);
      expect(goLive).toBeDefined();
    });
    const personalCalls = h.fetchWithRetry.mock.calls.length;
    (goLive![0] as () => void)();
    // The cached public snapshot, not a personal request from every player at the same moment
    await waitFor(() => expect(h.liveFetch).toHaveBeenCalledWith('/api/live', { credentials: 'omit' }));
    expect(h.fetchWithRetry.mock.calls.length).toBe(personalCalls);
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

describe('quizzes page: shared quiz copy', () => {
  const allowed = (quizId: string) => h.liveProps!.canUseSharedCopy!(quizId);

  it('lets a quiz open from the cached copy only while quizzes are free, and only if the player has not answered it', async () => {
    h.fetchWithRetry.mockImplementation(async () => ok({ walletEnabled: false }));
    render(<QuizzesPage />);
    await loaded();
    expect(allowed('a')).toBe(true);
    expect(allowed('b')).toBe(false); // answered: a re-attempt only gets the new questions
    expect(allowed('d')).toBe(false); // not started yet
    expect(allowed('zz')).toBe(false); // not in the list, e.g. an old deep link

    // The wallet came on: back to the personal route, which checks the day pass
    h.fetchWithRetry.mockImplementation(async () => ok({ walletEnabled: true }));
    await act(() => h.polls[300_000].task());
    expect(allowed('a')).toBe(false);
  });
});
