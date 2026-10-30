'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useJitteredPolling } from '@/hooks/useJitteredPolling';
import type { LiveQuizPushHandle, MatchPush } from '@/components/quiz/LiveQuizPush';
import type { LiveMatchCard } from '@/lib/quiz-catalog';
import type { PublicMatch } from '@/lib/match-feed';
import { MATCH_POPUP_MARGIN_SECONDS } from '@/lib/match-engine';
import { clockOffset, openOver, readAnswered, rememberAnswered, scoreLine, type FeedQuestion } from '@/lib/match-play';

// Ball by ball while a match is on (the feed is cached 3 s at the edge)
const POLL_MS = 3_000;
const PLAYED = new Set<LiveMatchCard['status']>(['setup', 'live', 'innings_break']);

/**
 * Live matches on the quiz page (match mode): each over's questions pop up on the stream like a pushed
 * quiz (LiveQuizPush's `match`), so players answer while they watch. It follows the first match taken
 * live that is still being played (the /api/live snapshot lists them), and polls that match's shared feed
 * (GET /api/live/matches/[id], one cached copy for everyone) only while there is one: nothing per player
 * reaches the server, however many players watch.
 *
 * - An over pops up once, keyed by its questions (an innings removed and started again gets new ones),
 *   and only with time left to answer it.
 * - The over shown follows its close time, so an early close or a reopen shows in its countdown.
 * - The overs this player locked in are remembered on this device (the returned callback, for
 *   LiveQuizPush's `onMatchLocked`), so they don't pop up again after a reload.
 */
export function useMatchPush(
  matches: LiveMatchCard[],
  push: RefObject<LiveQuizPushHandle | null>,
  userId: string | null,
): (quizId: string, questionIds: string[]) => void {
  const matchId = matches.find((m) => PLAYED.has(m.status))?.id ?? null;
  const owner = userId ?? 'signed-out';
  // The over last handed to the pop-up, followed until it closes (its ring counts from when it was first seen)
  const shown = useRef<{ push: MatchPush; ids: string[] } | null>(null);

  const check = useCallback(async (): Promise<boolean> => {
    try {
      // Only checked while there is a match to follow
      const response = await fetch(`/api/live/matches/${encodeURIComponent(matchId!)}`, { credentials: 'omit' });
      // Hidden again meanwhile: nothing to show
      if (response.status === 404) return true;
      if (!response.ok) return false;
      const feed: PublicMatch = await response.json();
      const receivedAt = Date.now();
      const offset = clockOffset(feed.serverNow, response.headers.get('age'), receivedAt);
      const { quizId } = feed.match;
      const score = scoreLine(feed);
      // Device time a set of questions closes: the first of them still listed
      const closesAt = (questions: FeedQuestion[]) => Math.min(...questions.map((q) => Date.parse(q.closesAt!))) - offset;

      const over = openOver(feed.questions, receivedAt + offset);
      const ids = over?.questions.map((q) => q.id).sort() ?? [];
      const key = `${feed.match.id}:${ids.join('+')}`;
      const answered = readAnswered(owner, quizId);
      const questions = over?.questions.filter((q) => !answered.has(q.id)) ?? [];
      if (over && shown.current?.push.key !== key && questions.length > 0) {
        const closesAtMs = closesAt(over.questions);
        // Not one already too late to answer: it would only chime for an empty countdown
        if (closesAtMs - receivedAt > MATCH_POPUP_MARGIN_SECONDS * 1000) {
          shown.current = {
            ids,
            push: {
              key,
              quizId,
              matchTitle: feed.match.title,
              over: over.over,
              score,
              closesAtMs,
              windowMs: closesAtMs - receivedAt,
              questions: questions.map((q) => ({
                id: q.id, text: q.text, textRomanUrdu: q.textRomanUrdu, options: q.options, optionsRomanUrdu: q.optionsRomanUrdu,
              })),
            },
          };
        }
      }

      // The over shown, as the feed has it now: still open (perhaps reopened, to a new time), or closed
      // early, voided or removed, which closes it in the pop-up now
      const current = shown.current;
      if (!current) return true;
      const stillOpen = feed.questions.filter((q) => current.ids.includes(q.id) && q.state === 'open' && q.closesAt !== null);
      current.push = {
        ...current.push,
        score,
        closesAtMs: stillOpen.length > 0 ? closesAt(stillOpen) : Math.min(current.push.closesAtMs, receivedAt),
      };
      push.current?.match(current.push);
      return true;
    } catch {
      return false;
    }
  }, [matchId, push, owner]);

  // At once when a match goes live, then every few seconds while the tab is visible
  useEffect(() => {
    if (matchId) void check();
  }, [matchId, check]);
  useJitteredPolling(check, { intervalMs: POLL_MS, jitterMs: 1_000, maxBackoffMs: 30_000, enabled: matchId !== null });

  return useCallback((quizId: string, questionIds: string[]) => {
    const answered = readAnswered(owner, quizId);
    for (const id of questionIds) answered.add(id);
    rememberAnswered(owner, quizId, answered);
  }, [owner]);
}
