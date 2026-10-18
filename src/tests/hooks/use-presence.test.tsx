import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePresence } from '@/hooks/usePresence';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('usePresence', () => {
  it('starts unmounted when closed and mounts as soon as it opens', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: false } });
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(false);
    rerender({ open: true });
    expect(result.current).toBe(true);
  });

  it('stays mounted for the exit animation, then unmounts', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(149));
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('reopening mid-exit keeps it mounted', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 300), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => void vi.advanceTimersByTime(200));
    rerender({ open: true });
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(true);
  });
});
