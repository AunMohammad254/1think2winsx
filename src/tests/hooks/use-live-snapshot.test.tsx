import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useLiveSnapshot, loadLiveSnapshot, resetLiveSnapshot } from '@/hooks/useLiveSnapshot';
import { useNow } from '@/hooks/useNow';

const snapshot = { version: 'v1', quizzes: [], walletEnabled: false };
const ok = (body: unknown = snapshot) => new Response(JSON.stringify(body), { status: 200 });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetLiveSnapshot();
  fetchMock = vi.fn().mockImplementation(async () => ok());
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useLiveSnapshot', () => {
  it('asks the Cloudflare-cached endpoint once for every section, with no query string and no cookies', async () => {
    const a = renderHook(() => useLiveSnapshot());
    const b = renderHook(() => useLiveSnapshot());
    expect(a.result.current).toEqual({ status: 'loading', snapshot: null });
    await waitFor(() => expect(a.result.current.status).toBe('ready'));
    expect(b.result.current).toEqual({ status: 'ready', snapshot });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/live', { credentials: 'omit' });

    // A section that mounts later reuses the fresh answer
    renderHook(() => useLiveSnapshot());
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes about once a minute while the page stays open, once for all sections', async () => {
    vi.useFakeTimers();
    renderHook(() => useLiveSnapshot());
    renderHook(() => useLiveSnapshot());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(59_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Both sections' pollers fire within the 15 s jitter; the second reuses the first one's answer
    await act(() => vi.advanceTimersByTimeAsync(16_100));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good snapshot when a refresh fails, and reports an error only without one', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('down', { status: 503 }));
    const { result } = renderHook(() => useLiveSnapshot());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.snapshot).toBeNull();

    await act(async () => expect(await loadLiveSnapshot()).toBe(true));
    expect(result.current).toEqual({ status: 'ready', snapshot });

    fetchMock.mockImplementationOnce(async () => { throw new TypeError('offline'); });
    await act(async () => expect(await loadLiveSnapshot()).toBe(false));
    fetchMock.mockImplementationOnce(async () => ok({ unexpected: true }));
    await act(async () => expect(await loadLiveSnapshot()).toBe(false));
    fetchMock.mockImplementationOnce(async () => ok(null));
    await act(async () => expect(await loadLiveSnapshot()).toBe(false));
    expect(result.current).toEqual({ status: 'ready', snapshot });
  });

  it('shares one request between callers asking at once, and skips one while the answer is fresh', async () => {
    const a = loadLiveSnapshot();
    expect(loadLiveSnapshot()).toBe(a);
    await a;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await loadLiveSnapshot(30_000)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await loadLiveSnapshot();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renders as loading on the server, where nothing is fetched', () => {
    function Probe() {
      return <span>{useLiveSnapshot().status}</span>;
    }
    expect(renderToString(<Probe />)).toContain('loading');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useNow', () => {
  it('ticks while enabled, and at once when a hidden tab comes back', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { result, rerender } = renderHook(({ on }) => useNow(1000, on), { initialProps: { on: false } });
    expect(result.current).toBe(1_000_000);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(1_000_000);

    rerender({ on: true });
    expect(result.current).toBe(1_005_000);
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(1_006_000);
    vi.setSystemTime(1_100_000);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current).toBe(1_100_000);
  });

  it('ticks every second by default', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { result, unmount } = renderHook(() => useNow());
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(2_000);
    unmount();
  });
});
