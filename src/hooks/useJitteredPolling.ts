'use client';

import { useEffect, useRef } from 'react';

export interface JitteredPollingOptions {
  /** Base delay between polls (ms). */
  intervalMs: number;
  /** Random extra delay added to every poll, 0..jitterMs (ms). Spreads synchronized clients out. */
  jitterMs?: number;
  /** Upper bound for the failure backoff (ms). Default 5 min. */
  maxBackoffMs?: number;
  /** Poll only while true (e.g. signed in). */
  enabled?: boolean;
  /** Injected for tests. */
  random?: () => number;
}

/**
 * Poll `task` on a timer that
 *  - adds random jitter, so clients that started together don't stay phase-aligned,
 *  - pauses while the tab is hidden (a background tab polling every minute for hours is pure waste),
 *    and catches up shortly after the tab becomes visible again,
 *  - backs off exponentially while `task` keeps failing (return `false` or throw to signal failure).
 *
 * `task` may return `false` for failure; any other result (including `undefined`) counts as success.
 */
export function useJitteredPolling(
  task: () => Promise<boolean | void>,
  { intervalMs, jitterMs = 0, maxBackoffMs = 5 * 60_000, enabled = true, random = Math.random }: JitteredPollingOptions
): void {
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let failures = 0;
    let lastRunAt = Date.now();

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const delay = () => {
      const backoff = failures > 0 ? Math.min(maxBackoffMs, intervalMs * 2 ** failures) : intervalMs;
      return backoff + random() * jitterMs;
    };

    const schedule = (ms: number) => {
      clear();
      if (stopped || document.hidden) return; // resumed by the visibilitychange handler
      timer = setTimeout(run, ms);
    };

    const run = async () => {
      timer = null;
      if (stopped || document.hidden) return;
      lastRunAt = Date.now();
      try {
        const result = await taskRef.current();
        failures = result === false ? failures + 1 : 0;
      } catch {
        failures += 1;
      }
      schedule(delay());
    };

    const onVisibility = () => {
      if (stopped) return;
      if (document.hidden) {
        clear();
        return;
      }
      // Back in the foreground: refresh now if we're overdue, with a small random delay so a
      // push that wakes many devices at once doesn't produce a synchronized burst.
      const overdue = Date.now() - lastRunAt >= intervalMs;
      schedule(overdue ? random() * Math.min(jitterMs, 3_000) : delay());
    };

    schedule(delay());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, jitterMs, maxBackoffMs, random]);
}
