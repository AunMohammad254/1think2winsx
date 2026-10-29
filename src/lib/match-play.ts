import type { PublicMatch } from '@/lib/match-feed';

/**
 * The match screen's arithmetic, kept apart from the screen (src/components/match/MatchScreen.tsx).
 */

export type FeedQuestion = PublicMatch['questions'][number];

/** The player's answer to each question they answered, by question id */
export type MyAnswers = Record<string, number>;

/**
 * How far this device's clock is behind the server's, from a feed response: its `serverNow`, plus the
 * seconds Cloudflare kept the copy (Age), against when it arrived. Countdowns add it to Date.now().
 */
export function clockOffset(serverNow: string, age: string | null, receivedAt: number): number {
  const ageSeconds = Number(age);
  return Date.parse(serverNow) + (Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds * 1000 : 0) - receivedAt;
}

/** Still taking answers at `now` (the feed's state can be a few seconds old) */
export const isOpen = (q: FeedQuestion, now: number) =>
  q.state === 'open' && (q.closesAt === null || Date.parse(q.closesAt) > now);

export interface OverGroup {
  key: string;
  innings: 1 | 2;
  over: number;
  questions: FeedQuestion[];
}

/** Questions grouped by over (in the feed's order: innings, then over) */
export function byOver(questions: FeedQuestion[]): OverGroup[] {
  const groups: OverGroup[] = [];
  for (const q of questions) {
    const key = `${q.innings}.${q.over}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.questions.push(q);
    else groups.push({ key, innings: q.innings, over: q.over, questions: [q] });
  }
  return groups;
}

/** The soonest the group's questions still open at `now` close, or null when none has a closing time */
export function closesAt(group: OverGroup, now: number): number | null {
  const times = group.questions.flatMap((q) => (q.closesAt && isOpen(q, now) ? [Date.parse(q.closesAt)] : []));
  return times.length > 0 ? Math.min(...times) : null;
}

/** How the player did on the questions settled so far */
export function tally(questions: FeedQuestion[], answers: MyAnswers): { right: number; settled: number } {
  const settled = questions.filter((q) => q.state === 'settled' && answers[q.id] !== undefined);
  return { right: settled.filter((q) => answers[q.id] === q.correctOption).length, settled: settled.length };
}

/** 83 seconds as 1:23 */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
