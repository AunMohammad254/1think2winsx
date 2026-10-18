'use client';

import { useEffect, useState } from 'react';

/**
 * The current time (epoch ms), updated every `intervalMs` while `enabled`, and at once when a hidden
 * tab comes back. For countdowns: each render recomputes from the clock, so a throttled background
 * tab cannot make them drift.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, enabled]);
  return now;
}
