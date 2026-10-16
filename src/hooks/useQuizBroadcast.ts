'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseQuizSignal, QUIZ_SIGNAL_EVENT, QUIZ_SIGNAL_TOPIC, type QuizSignal } from '@/lib/quiz-signal';

/**
 * Listen for "a quiz changed" signals on the private `quizzes` Broadcast channel (see lib/quiz-signal).
 *
 * This is only a speed-up: the page keeps its jittered poll, so if the socket cannot connect (plan
 * connection limit, blocked WebSockets, outage) players still see changes within about a minute.
 */
export function useQuizBroadcast({ enabled, onSignal }: { enabled: boolean; onSignal: (signal: QuizSignal) => void }): void {
  const onSignalRef = useRef(onSignal);
  useEffect(() => {
    onSignalRef.current = onSignal;
  }, [onSignal]);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      try {
        // Private channels authorise with the signed-in user's JWT
        await supabase.realtime.setAuth();
      } catch (err) {
        console.error('[useQuizBroadcast] could not authorise the realtime connection:', err);
        return;
      }
      if (cancelled) return;

      channel = supabase
        .channel(QUIZ_SIGNAL_TOPIC, { config: { private: true } })
        .on('broadcast', { event: QUIZ_SIGNAL_EVENT }, (message) => {
          const signal = parseQuizSignal(message);
          if (signal) onSignalRef.current(signal);
        })
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Not fatal: the page's poll covers us. Logged so a misconfigured policy is easy to spot.
            console.warn(`[useQuizBroadcast] channel ${status}`, err ?? '');
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [enabled]);
}
