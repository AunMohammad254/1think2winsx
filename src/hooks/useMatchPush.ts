'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useJitteredPolling } from '@/hooks/useJitteredPolling';
import type { LiveQuizPushHandle } from '@/components/quiz/LiveQuizPush';
import type { LiveMatchCard } from '@/lib/quiz-catalog';
import type { PublicMatch } from '@/lib/match-feed';
import { clockOffset, openOver, scoreLine } from '@/lib/match-play';

// Ball by ball while a match is on (the feed is cached 3 s at the edge)
const POLL_MS = 3_000;
const PLAYED = new Set<LiveMatchCard['status']>(['setup', 'live', 'innings_break']);

/**
 * Live matches on the quiz page (match mode): each over's questions pop up on the stream like a pushed
 * quiz (LiveQuizPush's `match`), so players answer while they watch. It follows the first match taken
 * live that is still being played (the /api/live snapshot lists them), and polls that match's shared feed
 * (GET /api/live/matches/[id], one cached copy for everyone) only while there is one.
 *
 * The player's earlier answers are read once per match (GET /api/quizzes/[id]/answers): an over they
 * already answered doesn't pop up again after a reload, and a full match still takes their answers.
 */
export function useMatchPush(matches: LiveMatchCard[], push: RefObject<LiveQuizPushHandle | null>): void {
  const matchId = matches.find((m) => PLAYED.has(m.status))?.id ?? null;
  // The player's answered questions, for the match's quiz
  const answered = useRef<{ quizId: string; ids: Set<string> } | null>(null);
  // When this page first saw each over taking answers, for its countdown ring
  const firstSeen = useRef(new Map<string, number>());

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

      if (answered.current?.quizId !== quizId) {
        const mine = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}/answers`);
        // Read again on the next check; until then nothing pops up that may already be answered
        if (!mine.ok) return false;
        const data: { answers: Array<{ questionId: string }> } = await mine.json();
        answered.current = { quizId, ids: new Set(data.answers.map((a) => a.questionId)) };
      }
      const { ids } = answered.current;
      // Full: only a player who already joined may answer
      push.current?.setEntriesClosed(quizId, feed.match.entriesClosed && ids.size === 0);

      const over = openOver(feed.questions, receivedAt + offset);
      const questions = over?.questions.filter((q) => !ids.has(q.id)) ?? [];
      if (!over || questions.length === 0) return true;
      const key = `${feed.match.id}:${over.innings}.${over.over}`;
      if (!firstSeen.current.has(key)) firstSeen.current.set(key, receivedAt);
      const closesAtMs = over.closesAtMs - offset;
      push.current?.match({
        key,
        quizId,
        matchTitle: feed.match.title,
        over: over.over,
        score: scoreLine(feed),
        closesAtMs,
        windowMs: closesAtMs - firstSeen.current.get(key)!,
        questions: questions.map((q) => ({ id: q.id, text: q.text, textRomanUrdu: q.textRomanUrdu, options: q.options })),
      });
      return true;
    } catch {
      return false;
    }
  }, [matchId, push]);

  // At once when a match goes live, then every few seconds while the tab is visible
  useEffect(() => {
    if (matchId) void check();
  }, [matchId, check]);
  useJitteredPolling(check, { intervalMs: POLL_MS, jitterMs: 1_000, maxBackoffMs: 30_000, enabled: matchId !== null });
}
