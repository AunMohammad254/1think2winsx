import { loadMatch, matchView, type QuestionState } from '@/lib/match-service';
import type { EndReason, InningsNumber, MatchStatus } from '@/lib/match-engine';
import { romanUrduOption } from '@/lib/match-questions';

/**
 * What players see of a live match (GET /api/live/matches/[id], read by the quiz page to pop each over's
 * questions up on the stream): the score, ball by ball, and the questions sent so far with their results.
 * The same for every player, so Cloudflare serves one copy to the whole crowd; never drafts, the scorer's
 * settings or anything else only admins see.
 *
 * Each process keeps a match's copy for a moment and loads it once however many requests miss the edge
 * cache together (one per Cloudflare location every few seconds).
 */

export interface PublicMatch {
  match: {
    id: string;
    /** Answers go to this quiz (/api/quizzes/[quizId]/submit) */
    quizId: string;
    title: string;
    teamA: string;
    teamB: string;
    oversPerInnings: number;
    status: MatchStatus;
    /** Its quiz is settled: points are in */
    settled: boolean;
    /** As many players as may join have joined: players who haven't answered yet can't any more */
    entriesClosed: boolean;
  };
  innings: Array<{
    innings: InningsNumber;
    battingTeam: string;
    endReason: EndReason | null;
    runs: number;
    wickets: number;
    oversText: string;
    target: number | null;
    overs: Array<{ number: number; runs: number; wickets: number; complete: boolean; balls: string[] }>;
  }>;
  questions: Array<{
    id: string;
    innings: InningsNumber;
    over: number;
    text: string;
    textRomanUrdu: string | null;
    options: string[];
    /** Each option in Roman Urdu, or null where it has none */
    optionsRomanUrdu: Array<string | null>;
    state: QuestionState;
    closesAt: string | null;
    /** Only once settled */
    correctOption: number | null;
  }>;
  /** The server's clock when this copy was made (a cached copy is older by its Age header) */
  serverNow: string;
}

/** The public part of a match, or null while players can't see it (not taken live yet, or hidden). */
export async function buildPublicMatch(matchId: string, now = Date.now()): Promise<PublicMatch | null> {
  const loaded = await loadMatch(matchId, now, true);
  if (!loaded || !loaded.published) return null;
  const view = matchView(loaded, now);
  return {
    match: {
      id: view.match.id,
      quizId: view.match.quizId,
      title: view.match.title,
      teamA: view.match.teamA,
      teamB: view.match.teamB,
      oversPerInnings: view.match.oversPerInnings,
      status: view.match.status,
      settled: view.settled,
      entriesClosed: view.players!.entries >= view.players!.maxEntries,
    },
    innings: view.innings.map((innings) => ({
      ...innings,
      overs: innings.overs.map((over) => ({ ...over, balls: over.balls.map((ball) => ball.label) })),
    })),
    questions: view.questions.map((q) => ({
      id: q.id, innings: q.innings, over: q.over, text: q.text, textRomanUrdu: q.textRomanUrdu, options: q.options,
      optionsRomanUrdu: q.options.map(romanUrduOption), state: q.state, closesAt: q.closesAt, correctOption: q.correctOption,
    })),
    serverNow: view.serverNow,
  };
}

const TTL_MS = 1_500;
const cache = new Map<string, { at: number; data: PublicMatch | null }>();
const inflight = new Map<string, Promise<PublicMatch | null>>();

/** buildPublicMatch, kept TTL_MS per match and loaded once at a time. A failed load isn't kept. */
export function getPublicMatch(matchId: string): Promise<PublicMatch | null> {
  const now = Date.now();
  const kept = cache.get(matchId);
  if (kept && now - kept.at < TTL_MS) return Promise.resolve(kept.data);
  const running = inflight.get(matchId);
  if (running) return running;
  const load = buildPublicMatch(matchId, now)
    .then((data) => {
      // Old entries go, so unknown ids can't pile up
      for (const [id, entry] of cache) if (now - entry.at >= TTL_MS) cache.delete(id);
      cache.set(matchId, { at: now, data });
      return data;
    })
    .finally(() => inflight.delete(matchId));
  inflight.set(matchId, load);
  return load;
}
