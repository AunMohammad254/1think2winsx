import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const board = (names: string[]) => ({
  leaderboard: names.map((userName, i) => ({ userName, rank: i + 1, totalScore: 100 - i })),
  total: names.length,
  timeframe: 'allTime',
  lastUpdated: '2026-10-15T00:00:00Z',
});
const json = (body: unknown, ok = true) => ({ ok, statusText: ok ? 'OK' : 'Server Error', json: async () => body }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
let useLeaderboard: typeof import('@/hooks/useLeaderboard').useLeaderboard;

beforeEach(async () => {
  vi.resetModules();
  ({ useLeaderboard } = await import('@/hooks/useLeaderboard')); // fresh module-level cache
  fetchMock = vi.fn().mockResolvedValue(json(board(['Ali', 'Sara'])));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useLeaderboard', () => {
  it('loads the board for the timeframe', async () => {
    const { result } = renderHook(() => useLeaderboard('weekly'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard?timeframe=weekly&limit=50');
    expect(result.current.leaderboard.map((e) => e.userName)).toEqual(['Ali', 'Sara']);
    expect(result.current.lastUpdated).toBe('2026-10-15T00:00:00Z');
    expect(result.current.playCounter).toBe(false);
  });

  it('serves a timeframe from the one-minute cache when switching back', async () => {
    const { result, rerender } = renderHook(({ tf }) => useLeaderboard(tf), { initialProps: { tf: 'weekly' as const } as { tf: 'weekly' | 'monthly' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ tf: 'monthly' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ tf: 'weekly' });
    await waitFor(() => expect(result.current.leaderboard).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows an error and retries on demand, bypassing the cache', async () => {
    fetchMock.mockResolvedValueOnce(json({}, false));
    const { result } = renderHook(() => useLeaderboard('allTime'));
    await waitFor(() => expect(result.current.error).toBe('Failed to load leaderboard data. Please try again later.'));
    act(() => result.current.handleRetry());
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.leaderboard).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('polls every 5 minutes, animates changes, and pauses while the tab is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const { result } = renderHook(() => useLeaderboard('allTime'));
    // waitFor polls with setTimeout, which is faked here: flush the first load by hand
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.loading).toBe(false);

    fetchMock.mockResolvedValue(json(board(['Sara', 'Ali'])));
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.leaderboard[0].userName).toBe('Sara');
    expect(result.current.playCounter).toBe(true);
    expect(result.current.prevData.get('Ali')).toEqual({ rank: 1, score: 100 });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.playCounter).toBe(false);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // @ts-expect-error restore the jsdom default
    delete document.hidden;
  });

  it('animates when a cached board is applied after the first load', async () => {
    const { result } = renderHook(() => useLeaderboard('allTime'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const second = renderHook(() => useLeaderboard('allTime'));
    await waitFor(() => expect(second.result.current.leaderboard).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useHasHover', () => {
  it('asks matchMedia once and caches the answer for the page', async () => {
    vi.resetModules();
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const { useHasHover } = await import('@/hooks/useHasHover');
    expect(renderHook(() => useHasHover()).result.current).toBe(true);
    expect(renderHook(() => useHasHover()).result.current).toBe(true);
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(matchMedia).toHaveBeenCalledWith('(hover: hover)');
    matchMedia.mockRestore();
  });

  it('answers false during server rendering', async () => {
    vi.resetModules();
    const { useHasHover } = await import('@/hooks/useHasHover');
    vi.stubGlobal('window', undefined);
    expect(useHasHover()).toBe(false);
    vi.unstubAllGlobals();
  });
});
