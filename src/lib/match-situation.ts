import { BALLS_PER_OVER, MAX_WICKETS, splitOvers, type Ball, type InningsNumber } from '@/lib/match-engine';

/**
 * The match situation an over's quiz is built from (match mode): the score and how the innings is going
 * after a number of complete overs. The quiz about over M is prepared when over M-2 ends and goes out
 * during over M-1, so its facts are "after M-2 overs": they stay true while it is out, and a correction
 * to a later ball doesn't change them.
 *
 * One pure function feeds the questions' lines and choice (src/lib/match-questions.ts), their lead-in,
 * and Gemini's context (src/lib/match-wording.ts). Every number in it is counted from the balls, so the
 * questions never state a number that isn't true.
 */

export type Phase = 'powerplay' | 'middle' | 'death';

export interface MatchSituation {
  innings: InningsNumber;
  battingTeam: string;
  oversPerInnings: number;
  /** The facts are about the innings after this many overs */
  afterOvers: number;
  runs: number;
  wickets: number;
  legalBalls: number;
  /** Runs an over this innings, once two overs are bowled (earlier it says little) */
  runRate: number | null;
  /** Runs an over in the last three complete overs (fewer early on), or null before any */
  recentRate: number | null;
  /** The last complete over */
  lastOver: { number: number; runs: number; wickets: number } | null;
  /** Innings 2: what the batting side needs to win */
  chase: { target: number; needed: number; ballsLeft: number } | null;
  wicketsInHand: number;
}

const MIN_BALLS_FOR_RUN_RATE = 2 * BALLS_PER_OVER;
const RECENT_OVERS = 3;

/** Powerplay is the first 30% of an innings' overs (6 of 20, 3 of 10), the death overs the last 20% (4 of 20, 2 of 10). */
export function phaseOf(over: number, oversPerInnings: number): Phase {
  if (over <= Math.round(oversPerInnings * 0.3)) return 'powerplay';
  if (over > oversPerInnings - Math.round(oversPerInnings * 0.2)) return 'death';
  return 'middle';
}

const perOver = (runs: number, legalBalls: number) => (runs / legalBalls) * BALLS_PER_OVER;

/**
 * The innings `innings` (its balls only) after `afterOvers` overs. `target` is innings 2's (innings 1's runs + 1),
 * null for innings 1.
 */
export function matchSituation(input: {
  balls: Ball[];
  innings: InningsNumber;
  battingTeam: string;
  oversPerInnings: number;
  target: number | null;
  afterOvers: number;
}): MatchSituation {
  const overs = splitOvers(input.balls).slice(0, Math.max(0, input.afterOvers));
  const runs = overs.reduce((sum, over) => sum + over.runs, 0);
  const wickets = overs.reduce((sum, over) => sum + over.wickets, 0);
  const legalBalls = overs.reduce((sum, over) => sum + over.legalBalls, 0);
  const complete = overs.filter((over) => over.complete);
  const recent = complete.slice(-RECENT_OVERS);
  const recentBalls = recent.reduce((sum, over) => sum + over.legalBalls, 0);
  const last = complete[complete.length - 1];
  return {
    innings: input.innings,
    battingTeam: input.battingTeam,
    oversPerInnings: input.oversPerInnings,
    afterOvers: Math.max(0, input.afterOvers),
    runs,
    wickets,
    legalBalls,
    runRate: legalBalls >= MIN_BALLS_FOR_RUN_RATE ? perOver(runs, legalBalls) : null,
    recentRate: recentBalls > 0 ? perOver(recent.reduce((sum, over) => sum + over.runs, 0), recentBalls) : null,
    lastOver: last ? { number: last.number, runs: last.runs, wickets: last.wickets } : null,
    chase: input.target === null ? null : {
      target: input.target,
      needed: Math.max(0, input.target - runs),
      ballsLeft: Math.max(0, input.oversPerInnings * BALLS_PER_OVER - legalBalls),
    },
    wicketsInHand: Math.max(0, MAX_WICKETS - wickets),
  };
}

/**
 * The numbers a question about `over` may state: the facts, which players can check on the broadcast's
 * scoreboard, and any number in a team's name ("Team 11").
 */
export function situationNumbers(s: MatchSituation, over: number, line: number | null, teams: readonly string[]): Set<number> {
  const numbers = [over, s.afterOvers, s.runs, s.wickets, s.wicketsInHand];
  if (line !== null) numbers.push(line);
  if (s.lastOver) numbers.push(s.lastOver.number, s.lastOver.runs, s.lastOver.wickets);
  if (s.chase) numbers.push(s.chase.target, s.chase.needed, s.chase.ballsLeft);
  for (const team of teams) for (const digits of team.match(/\d+/g) ?? []) numbers.push(Number(digits));
  return new Set(numbers);
}
