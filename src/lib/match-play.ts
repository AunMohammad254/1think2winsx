import type { PublicMatch } from '@/lib/match-feed';

/**
 * A live match's feed, read for the quiz page's stream pop-up (src/hooks/useMatchPush.ts): which over takes
 * answers now, the score line its header shows, and the questions this device locked in.
 */

export type FeedQuestion = PublicMatch['questions'][number];

/**
 * How far this device's clock is behind the server's, from a feed response: its `serverNow`, plus the
 * seconds Cloudflare kept the copy (Age), against when it arrived.
 */
export function clockOffset(serverNow: string, age: string | null, receivedAt: number): number {
  const ageSeconds = Number(age);
  return Date.parse(serverNow) + (Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds * 1000 : 0) - receivedAt;
}

export interface OpenOver {
  innings: 1 | 2;
  over: number;
  /** When the first of its questions closes, on the server's clock */
  closesAtMs: number;
  questions: FeedQuestion[];
}

/**
 * The over whose questions take answers at `now` (the server's clock), or null. Only one does at a time
 * once a match is under way; should two, the later one.
 */
export function openOver(questions: FeedQuestion[], now: number): OpenOver | null {
  const open = questions.filter((q) => q.state === 'open' && q.closesAt !== null && Date.parse(q.closesAt) > now);
  if (open.length === 0) return null;
  const last = open.reduce((a, b) => (b.innings * 1000 + b.over > a.innings * 1000 + a.over ? b : a));
  const group = open.filter((q) => q.innings === last.innings && q.over === last.over);
  return { innings: last.innings, over: last.over, closesAtMs: Math.min(...group.map((q) => Date.parse(q.closesAt!))), questions: group };
}

const ANSWERED_KEY = (owner: string, quizId: string) => `t2w:match-answered:${owner}:${quizId}`;

/**
 * The match questions this player locked in on this device. Kept here rather than read from the server: at
 * Go live every player on the quiz page would ask at once. Another device doesn't know them; locking one
 * in again there changes nothing (the server keeps the first answer). Empty when storage is unavailable.
 */
export function readAnswered(owner: string, quizId: string): Set<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(ANSWERED_KEY(owner, quizId)) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function rememberAnswered(owner: string, quizId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(ANSWERED_KEY(owner, quizId), JSON.stringify([...ids]));
  } catch {
    // Private mode or storage full: a locked-in over may pop up again after a reload
  }
}

/** "Lahore 48/2 (6.0 overs, target 150)": the innings being played */
export function scoreLine(feed: Pick<PublicMatch, 'innings' | 'match'>): string {
  const current = feed.innings[feed.innings.length - 1];
  if (!current) return feed.match.title;
  return `${current.battingTeam} ${current.runs}/${current.wickets} (${current.oversText} overs${current.target !== null ? `, target ${current.target}` : ''})`;
}
