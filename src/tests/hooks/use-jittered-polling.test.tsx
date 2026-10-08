import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useJitteredPolling } from '@/hooks/useJitteredPolling';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useJitteredPolling', () => {
  it('polls on the interval plus jitter, not exactly on the interval', async () => {
    const task = vi.fn().mockResolvedValue(true);
    renderHook(() => useJitteredPolling(task, { intervalMs: 60_000, jitterMs: 20_000, random: () => 0.5 }));
    await vi.advanceTimersByTimeAsync(69_999); // 60 s + 0.5 * 20 s = 70 s
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('different clients get different delays (the whole point of jitter)', async () => {
    const early = vi.fn().mockResolvedValue(true);
    const late = vi.fn().mockResolvedValue(true);
    renderHook(() => useJitteredPolling(early, { intervalMs: 1_000, jitterMs: 1_000, random: () => 0 }));
    renderHook(() => useJitteredPolling(late, { intervalMs: 1_000, jitterMs: 1_000, random: () => 0.99 }));
    await vi.advanceTimersByTimeAsync(1_001);
    expect(early).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('does not poll while the tab is hidden, and catches up when it returns', async () => {
    const task = vi.fn().mockResolvedValue(true);
    renderHook(() => useJitteredPolling(task, { intervalMs: 10_000, jitterMs: 0 }));
    setHidden(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(task).not.toHaveBeenCalled();
    setHidden(false); // overdue -> refreshes right away
    await vi.advanceTimersByTimeAsync(10);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially while the task keeps failing, and resets after a success', async () => {
    const task = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    renderHook(() => useJitteredPolling(task, { intervalMs: 1_000, jitterMs: 0, maxBackoffMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(1_000); // t=1000: 1st call (fails) -> next after 1_000 * 2^1
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999); // t=2999
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // t=3000: 2nd call (fails) -> next after 1_000 * 2^2
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999); // t=6999
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // t=7000: 3rd call succeeds -> back to the base interval
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(999); // t=7999
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1); // t=8000
    expect(task).toHaveBeenCalledTimes(4);
  });

  it('treats a thrown error as a failure', async () => {
    const task = vi.fn().mockRejectedValue(new Error('network'));
    renderHook(() => useJitteredPolling(task, { intervalMs: 1_000, jitterMs: 0 }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500); // backed off to 2 s, so not yet
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled and stops on unmount', async () => {
    const task = vi.fn().mockResolvedValue(true);
    const off = renderHook(() => useJitteredPolling(task, { intervalMs: 1_000, jitterMs: 0, enabled: false }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(task).not.toHaveBeenCalled();
    off.unmount();

    const on = renderHook(() => useJitteredPolling(task, { intervalMs: 1_000, jitterMs: 0 }));
    on.unmount();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(task).not.toHaveBeenCalled();
  });
});
