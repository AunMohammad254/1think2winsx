import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  board: {} as Record<string, unknown>,
  timeframes: [] as string[],
  hover: true,
  inView: false,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/hooks/useLeaderboard', () => ({ useLeaderboard: (tf: string) => { h.timeframes.push(tf); return h.board; } }));
vi.mock('@/hooks/useHasHover', () => ({ useHasHover: () => h.hover }));
// Real motion components write animated box-shadows that jsdom's CSS parser rejects, so render plain elements.
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  ...(await import('@/tests/helpers/motion-mock')).motionPassthrough,
  useInView: () => h.inView,
}));

import LeaderboardPage from '@/app/leaderboard/page';
import LeaderboardRow from '@/app/leaderboard/components/LeaderboardRow';
import PodiumSection from '@/app/leaderboard/components/PodiumSection';
import AnimatedScore from '@/app/leaderboard/components/AnimatedScore';
import type { LeaderboardEntry } from '@/app/leaderboard/types';

const entry = (rank: number, userName: string, over: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  id: `id-${userName}`, rank, userName, quizzesTaken: 4, correctAnswers: 30, totalScore: 1000 - rank * 10, winCount: rank === 1 ? 2 : 0, ...over,
});
const entries = [entry(1, 'Ali'), entry(2, 'Sara'), entry(3, 'Zed'), entry(4, 'Hina'), entry(5, 'Omar', { quizzesTaken: 0 })];
const board = (over: Record<string, unknown> = {}) => ({
  leaderboard: entries, loading: false, error: null, lastUpdated: '2026-10-15T10:00:00Z', playCounter: false, prevData: new Map(), dataLoaded: true, handleRetry: vi.fn(), ...over,
});

beforeEach(() => {
  h.user = null;
  h.board = board();
  h.timeframes = [];
  h.hover = true;
  h.inView = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('leaderboard page', () => {
  it('shows a skeleton until the first load', () => {
    h.board = board({ loading: true, dataLoaded: false, lastUpdated: '' });
    const { container } = render(<LeaderboardPage />);
    expect(container.querySelectorAll('.bg-slate-800').length).toBeGreaterThan(5);
    expect(screen.queryByText(/Last updated/)).toBeNull();
  });

  it('shows errors with a retry, and an empty board', async () => {
    const handleRetry = vi.fn();
    h.board = board({ error: 'Failed to load leaderboard data.', handleRetry });
    const { rerender } = render(<LeaderboardPage />);
    const retry = screen.getByRole('button', { name: 'Try Again' });
    fireEvent.mouseEnter(retry);
    fireEvent.mouseLeave(retry);
    fireEvent.click(retry);
    expect(handleRetry).toHaveBeenCalled();
    h.board = board({ leaderboard: [] });
    rerender(<LeaderboardPage />);
    expect(await screen.findByText('No attempts recorded yet')).toBeInTheDocument();
  });

  it('lists the board and switches timeframe', async () => {
    render(<LeaderboardPage />);
    expect(await screen.findByText('Champion')).toBeInTheDocument();
    expect(screen.getAllByText('Hina').length).toBeGreaterThan(0);
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
    expect(h.timeframes).toContain('monthly');
    expect(h.timeframes.at(-1)).toBe('allTime');
  });

  it('shows a signed-in player their own stats', async () => {
    h.user = { id: 'u', user_metadata: { name: 'Hina' } };
    render(<LeaderboardPage />);
    expect(await screen.findByText('Your current position on the board')).toBeInTheDocument();
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
  });

  it('nudges a signed-in player who is not ranked yet', async () => {
    h.user = { id: 'u', email: 'newbie@x.com' };
    h.hover = false;
    render(<LeaderboardPage />);
    expect(await screen.findByText('You are not ranked yet')).toBeInTheDocument();
    expect(screen.getByText('Your Position')).toBeInTheDocument();
  });

  it('shows the error and back-to-top buttons without hover support', async () => {
    h.hover = false;
    h.board = board({ error: 'Failed to load leaderboard data.' });
    render(<LeaderboardPage />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Try Again' }));
    expect(screen.getByText('Failed to load leaderboard data.')).toBeInTheDocument();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 600 });
    act(() => void window.dispatchEvent(new Event('scroll')));
    expect(await screen.findByText('↑')).toBeInTheDocument();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('shows a back-to-top button after scrolling', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    window.scrollTo = scrollTo;
    render(<LeaderboardPage />);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 600 });
    act(() => void window.dispatchEvent(new Event('scroll')));
    fireEvent.click(await screen.findByText('↑'));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    act(() => void window.dispatchEvent(new Event('scroll')));
    await waitFor(() => expect(screen.queryByText('↑')).toBeNull());
    vi.unstubAllGlobals();
  });
});

describe('leaderboard rows', () => {
  const row = (e: LeaderboardEntry, prev: [string, { rank: number; score: number }][] = [], play = false) =>
    <LeaderboardRow entry={e} index={0} isCurrentUser={false} prevData={new Map(prev)} playCounter={play} />;

  it('shows rank movement up and down', () => {
    const { rerender } = render(row(entry(2, 'Sara'), [['Sara', { rank: 5, score: 900 }]]));
    expect(screen.getByText('+3')).toBeInTheDocument();
    rerender(row(entry(6, 'Sara'), [['Sara', { rank: 2, score: 980 }]]));
    expect(screen.getByText('-4')).toBeInTheDocument();
  });

  it('flashes a changed score while on screen', () => {
    vi.useFakeTimers();
    h.inView = true;
    const { container } = render(row(entry(4, 'Hina', { totalScore: 700 }), [['Hina', { rank: 4, score: 600 }]], true));
    const flashes = () => container.querySelectorAll('span.absolute').length;
    const before = flashes();
    act(() => { vi.advanceTimersByTime(900); });
    expect(flashes()).toBeLessThan(before);
  });

  it('works without hover support', () => {
    h.hover = false;
    render(row(entry(1, 'Ali')));
    expect(screen.getByText('Ali')).toBeInTheDocument();
  });
});

describe('podium', () => {
  it('renders nothing without entries, and one to three places', () => {
    const { container, rerender } = render(<PodiumSection entries={[]} playCounter={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PodiumSection entries={[entry(1, 'Ali')]} playCounter={false} />);
    expect(screen.getByText('Champion')).toBeInTheDocument();
    expect(screen.queryByText('Rank #2')).toBeNull();
    h.hover = false;
    rerender(<PodiumSection entries={entries.slice(0, 3)} playCounter />);
    expect(screen.getByText('Rank #2')).toBeInTheDocument();
    expect(screen.getByText('Rank #3')).toBeInTheDocument();
  });

  it('copes with a podium that has a gap', () => {
    h.inView = true;
    render(<PodiumSection entries={[undefined, entry(2, 'Sara')] as unknown as LeaderboardEntry[]} playCounter={false} />);
    expect(screen.queryByText('Champion')).toBeNull();
    expect(screen.getByText('Rank #2')).toBeInTheDocument();
  });
});

describe('AnimatedScore', () => {
  it('counts from the shown value to the new one when playing', async () => {
    const { container, rerender } = render(<AnimatedScore value={10} play={false} />);
    expect(container.textContent).toBe('10');
    rerender(<AnimatedScore value={50} play duration={0.01} />);
    await waitFor(() => expect(container.textContent).toBe('50'));
  });

  it('survives a frame that lands after unmounting', async () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault(); };
    window.addEventListener('error', onError);
    const { rerender, unmount } = render(<AnimatedScore value={10} play={false} />);
    rerender(<AnimatedScore value={500} play duration={1} />);
    unmount();
    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
  });
});
