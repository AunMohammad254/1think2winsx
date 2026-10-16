import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuizCountdown } from '@/hooks/useQuizCountdown';

const START = new Date('2026-10-09T10:00:00.000Z').getTime();
const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useQuizCountdown', () => {
  it('shows the full duration before Start for a quiz without a fixed window', () => {
    const { result } = renderHook(() => useQuizCountdown({ running: false, durationMinutes: 30 }));
    expect(result.current.timeRemaining).toBe(30 * 60);
    expect(result.current.windowClosed).toBe(false);
  });

  it('is null while the quiz is still loading', () => {
    const { result } = renderHook(() => useQuizCountdown({ running: false, durationMinutes: null }));
    expect(result.current.timeRemaining).toBeNull();
  });

  it('counts down in real time once running and fires onExpire exactly once at zero', async () => {
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(
      ({ running }) => useQuizCountdown({ running, durationMinutes: 1, onExpire }),
      { initialProps: { running: false } },
    );
    rerender({ running: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.timeRemaining).toBe(30);
    expect(onExpire).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(result.current.timeRemaining).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a late joiner starts with the time left in the answering window, not a full timer', () => {
    // Went live 20 min ago, 30 min long; server and device agree on the time
    const pushedAt = START - 20 * MIN;
    const { result } = renderHook(() =>
      useQuizCountdown({ running: false, durationMinutes: 30, endsAt: new Date(pushedAt + 30 * MIN).toISOString(), serverNow: START }),
    );
    expect(result.current.timeRemaining).toBe(10 * 60);
  });

  it('is not fooled by a device clock that is 2 hours ahead of the server', () => {
    const endsAt = new Date(START + 10 * MIN).toISOString(); // 10 min left on the SERVER clock
    const serverNow = START - 2 * 60 * MIN; // server says it is two hours earlier than the device
    const adjustedEndsAt = new Date(serverNow + 10 * MIN).toISOString();
    expect(endsAt).not.toBe(adjustedEndsAt);
    const { result } = renderHook(() =>
      useQuizCountdown({ running: false, durationMinutes: 30, endsAt: adjustedEndsAt, serverNow }),
    );
    expect(result.current.timeRemaining).toBe(10 * 60);
    expect(result.current.windowClosed).toBe(false);
  });

  it('reports a closed window (so Start can be disabled) and 0 remaining', () => {
    const endsAt = new Date(START - 5 * MIN).toISOString();
    const { result } = renderHook(() => useQuizCountdown({ running: false, durationMinutes: 30, endsAt, serverNow: START }));
    expect(result.current.windowClosed).toBe(true);
    expect(result.current.timeRemaining).toBe(0);
  });

  it('does not drift when the timers are starved (throttled background tab)', async () => {
    const { result, rerender } = renderHook(
      ({ running }) => useQuizCountdown({ running, durationMinutes: 10 }),
      { initialProps: { running: false } },
    );
    rerender({ running: true });
    // The tab is frozen for 3 minutes; the clock moves but no interval fires
    vi.setSystemTime(START + 3 * MIN);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current.timeRemaining).toBe(7 * 60); // a decrement-by-one counter would still say 10:00
  });
});
