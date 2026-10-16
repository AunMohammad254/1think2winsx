'use client';

import { useEffect, useRef, useState } from 'react';
import { isWindowClosed, localWindowEnd, remainingSeconds } from '@/lib/quiz-clock';

interface UseQuizCountdownOptions {
  /** True from the moment the player presses Start until they finish. */
  running: boolean;
  /** The quiz's length in minutes; null while the quiz is still loading. */
  durationMinutes: number | null;
  /** ISO time the answering window closes (server clock), if the quiz has one. */
  endsAt?: string | null;
  /** Server clock (epoch ms) when it sent `endsAt`; used to cancel out a wrong device clock. */
  serverNow?: number | null;
  /** Called once when the countdown reaches zero while running. */
  onExpire?: () => void;
}

/**
 * Countdown for a quiz attempt.
 *
 * Unlike a counter decremented once per second, this recomputes the remaining time from the clock on
 * every tick, so a throttled background tab or a sleeping laptop cannot make it drift, and it follows
 * the server's deadline so a late joiner is not shown time the database will not accept.
 */
export function useQuizCountdown({ running, durationMinutes, endsAt = null, serverNow = null, onExpire }: UseQuizCountdownOptions) {
  const [now, setNow] = useState(() => Date.now());
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  // Convert the server's deadline to this device's clock once, when it arrives
  useEffect(() => {
    setWindowEnd(localWindowEnd(endsAt, serverNow, Date.now()));
  }, [endsAt, serverNow]);

  // Remember when the player pressed Start
  useEffect(() => {
    if (running) {
      startedAtRef.current = Date.now();
    } else {
      startedAtRef.current = null;
      expiredRef.current = false;
    }
  }, [running]);

  // Tick every second, and immediately when a hidden tab comes back
  useEffect(() => {
    if (durationMinutes === null) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [durationMinutes]);

  const timeRemaining =
    durationMinutes === null
      ? null
      : remainingSeconds({
          nowMs: now,
          durationMinutes,
          startedAtMs: running ? startedAtRef.current : null,
          windowEndLocalMs: windowEnd,
        });

  useEffect(() => {
    if (running && timeRemaining === 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpireRef.current?.();
    }
  }, [running, timeRemaining]);

  return { timeRemaining, windowClosed: isWindowClosed(windowEnd, now) };
}
