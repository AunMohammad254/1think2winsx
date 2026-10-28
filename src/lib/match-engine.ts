/**
 * Match mode's rules (migration 20261029120000_match_mode): how balls make overs and innings, when each
 * over's questions open, close and settle, and what one console event changes. Pure: the server loads
 * the match (src/lib/match-service.ts), applyEvent works out the change, and apply_match_change stores
 * it in one transaction.
 *
 * The balls are the source of truth and the questions follow from them, so an undone ball takes back
 * whatever it caused: a result, a void, the end of an innings. Only opening questions can't be taken
 * back (players may have answered).
 *
 * Questions shown during over N are about over N+1:
 *   - they open at over N's first delivery (over 1's when the innings starts),
 *   - close after over N's 5th legal ball, at over N+1's first delivery, at a fallback time, or when the
 *     innings ends, whichever comes first,
 *   - are settled from over N+1's balls once it is complete, or voided if it never is.
 */

export type Extra = 'none' | 'wide' | 'no_ball' | 'bye' | 'leg_bye';
export type InningsNumber = 1 | 2;
export type MatchStatus = 'setup' | 'live' | 'innings_break' | 'completed' | 'abandoned';
export type EndReason = 'overs' | 'all_out' | 'target' | 'admin';

export const EXTRAS: readonly Extra[] = ['none', 'wide', 'no_ball', 'bye', 'leg_bye'];
export const BALLS_PER_OVER = 6;
export const MAX_WICKETS = 10;
/** Most runs one delivery can add (5 overthrows on a 2, say): anything above is a typing mistake */
export const MAX_RUNS_PER_BALL = 7;

export interface Ball {
  id: string;
  innings: InningsNumber;
  /** Order within the innings, from 1 */
  seq: number;
  /** Off the bat, or byes / leg byes for those extras, or runs taken off a wide */
  runs: number;
  extra: Extra;
  /** The penalty run of a wide or no-ball */
  extraRuns: number;
  wicket: boolean;
}

export interface Innings {
  innings: InningsNumber;
  battingTeam: string;
  /** null while it is being played */
  endReason: EndReason | null;
}

export interface MatchConfig {
  teams: [string, string];
  oversPerInnings: number;
  questionsPerOver: number;
  firstWindowSeconds: number;
  lockFallbackSeconds: number;
}

export interface MatchQuestion {
  id: string;
  innings: InningsNumber;
  over: number;
  market: string;
  params: Record<string, unknown>;
  /** 'paused' is a void */
  status: 'active' | 'paused';
  hasResult: boolean;
  correctOption: number | null;
  /** Its close time has passed */
  closed: boolean;
}

export interface MatchState {
  config: MatchConfig;
  status: MatchStatus;
  /** Started innings, in order */
  innings: Innings[];
  /** Balls not undone, by innings then seq */
  balls: Ball[];
  questions: MatchQuestion[];
}

export const isLegal = (ball: Pick<Ball, 'extra'>) => ball.extra !== 'wide' && ball.extra !== 'no_ball';
export const ballRuns = (ball: Pick<Ball, 'runs' | 'extraRuns'>) => ball.runs + ball.extraRuns;

export interface Over {
  /** From 1 */
  number: number;
  balls: Ball[];
  legalBalls: number;
  runs: number;
  wickets: number;
  complete: boolean;
}

/** An innings' balls, in order, split into overs: an over ends with its 6th legal ball. */
export function splitOvers(balls: Ball[]): Over[] {
  const overs: Over[] = [];
  for (const ball of balls) {
    let over = overs[overs.length - 1];
    if (!over || over.complete) {
      over = { number: overs.length + 1, balls: [], legalBalls: 0, runs: 0, wickets: 0, complete: false };
      overs.push(over);
    }
    over.balls.push(ball);
    if (isLegal(ball)) over.legalBalls++;
    over.runs += ballRuns(ball);
    if (ball.wicket) over.wickets++;
    over.complete = over.legalBalls === BALLS_PER_OVER;
  }
  return overs;
}

export interface InningsScore {
  runs: number;
  wickets: number;
  legalBalls: number;
  overs: Over[];
  /** Cricket's overs notation: 12.3 is 12 overs and 3 balls */
  oversText: string;
  /** What the balls say ended it, or null */
  endedBy: Exclude<EndReason, 'admin'> | null;
}

/** The score of one innings; `target` is what the side batting second needs (innings 1's runs + 1). */
export function scoreInnings(balls: Ball[], oversPerInnings: number, target: number | null): InningsScore {
  const overs = splitOvers(balls);
  const runs = overs.reduce((sum, over) => sum + over.runs, 0);
  const wickets = overs.reduce((sum, over) => sum + over.wickets, 0);
  const legalBalls = overs.reduce((sum, over) => sum + over.legalBalls, 0);
  const completeOvers = overs.filter((over) => over.complete).length;
  const endedBy = target !== null && runs >= target ? 'target'
    : wickets >= MAX_WICKETS ? 'all_out'
    : completeOvers >= oversPerInnings ? 'overs'
    : null;
  return {
    runs, wickets, legalBalls, overs, endedBy,
    oversText: `${Math.floor(legalBalls / BALLS_PER_OVER)}.${legalBalls % BALLS_PER_OVER}`,
  };
}

// ── Markets: what a question asks, and how its over settles it ───────────────────────────────────
// Every match question is Yes (option 0) / No (option 1). Lines are set when it opens
// (src/lib/match-questions.ts) so each is close to an even chance. No market asks about wides or
// no-balls: those are what spot-fixing targets.

const offTheBat = (ball: Ball) => ball.extra === 'none' || ball.extra === 'no_ball';
const lineOf = (params: Record<string, unknown>): number | null =>
  typeof params.line === 'number' && Number.isFinite(params.line) ? params.line : null;

const MARKETS: Record<string, (over: Over, params: Record<string, unknown>) => boolean | null> = {
  over_runs_at_least: (over, params) => {
    const line = lineOf(params);
    return line === null ? null : over.runs >= line;
  },
  boundary_in_over: (over) => over.balls.some((ball) => offTheBat(ball) && (ball.runs === 4 || ball.runs === 6)),
  wicket_in_over: (over) => over.wickets > 0,
  dots_at_least: (over, params) => {
    const line = lineOf(params);
    return line === null ? null : over.balls.filter((ball) => isLegal(ball) && ballRuns(ball) === 0).length >= line;
  },
};

export const MARKET_NAMES = Object.keys(MARKETS);

/** The correct option (0 = Yes, 1 = No) of a question about a complete over, or null when it can't be settled. */
export function resolveMarket(market: string, params: Record<string, unknown>, over: Over): number | null {
  const resolve = MARKETS[market];
  const yes = resolve ? resolve(over, params) : null;
  return yes === null ? null : yes ? 0 : 1;
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────

export type MatchEvent =
  | { type: 'start_innings'; battingTeam: string }
  | { type: 'ball'; runs: number; extra: Extra; wicket: boolean }
  | { type: 'undo' }
  | { type: 'end_innings' }
  | { type: 'close_answers' }
  | { type: 'abandon' };

/** Over `over` of innings `innings` needs its questions now; they close after `closesInSeconds` at the latest */
export interface ReleaseSlot {
  innings: InningsNumber;
  over: number;
  closesInSeconds: number;
}

/** What one event changes: the fields apply_match_change takes, before the server writes the new questions */
export interface MatchChange {
  startInnings?: { innings: InningsNumber; battingTeam: string };
  endInnings?: { innings: InningsNumber; reason: EndReason };
  reopenInnings?: { innings: InningsNumber };
  ball?: Ball;
  undoBall?: string;
  release: ReleaseSlot[];
  lock: string[];
  closeAll?: true;
  resolve: Array<{ id: string; option: number }>;
  void: string[];
  pending: string[];
  status: MatchStatus;
}

export type EventOutcome = { ok: true; change: MatchChange; state: MatchState } | { ok: false; error: string };

const fail = (error: string): EventOutcome => ({ ok: false, error });

/** The innings being played or last played, or null before the first */
export const currentInnings = (state: Pick<MatchState, 'innings'>): Innings | null => state.innings[state.innings.length - 1] ?? null;

/** The target of innings 2 (innings 1's runs + 1), or null for innings 1 */
export function targetFor(innings: InningsNumber, balls: Ball[], oversPerInnings: number): number | null {
  if (innings === 1) return null;
  return scoreInnings(balls.filter((ball) => ball.innings === 1), oversPerInnings, null).runs + 1;
}

/**
 * What `event` changes, or why it can't happen. `newId` names a new ball. The returned state is the match
 * after the change, as the next load will see it.
 */
export function applyEvent(state: MatchState, event: MatchEvent, newId: () => string): EventOutcome {
  if (state.status === 'abandoned') return fail('This match was abandoned: nothing more can be recorded');
  // A finished match can still take back its last ball (a wrongly recorded winning run, say)
  if (state.status === 'completed' && event.type !== 'undo') return fail('This match has finished: only its last ball can be undone');
  const innings = state.innings.map((i) => ({ ...i }));
  let balls = state.balls;
  const change: Partial<MatchChange> = {};
  let status: MatchStatus = state.status;
  const current = innings[innings.length - 1];

  switch (event.type) {
    case 'start_innings': {
      const number = innings.length + 1;
      if (current && !current.endReason) return fail('The innings being played has to end first');
      if (number > 2) return fail('Both innings have been played');
      const team = event.battingTeam.trim();
      if (!state.config.teams.includes(team)) return fail('Choose one of the two teams to bat');
      if (current && current.battingTeam === team) return fail(`${team} batted in the first innings`);
      innings.push({ innings: number as InningsNumber, battingTeam: team, endReason: null });
      change.startInnings = { innings: number as InningsNumber, battingTeam: team };
      break;
    }
    case 'ball': {
      if (!current) return fail('Start an innings before recording balls');
      if (current.endReason) return fail('This innings is over: start the next one, or undo its last ball');
      if (!EXTRAS.includes(event.extra)) return fail('Unknown kind of delivery');
      if (!Number.isInteger(event.runs) || event.runs < 0 || event.runs > MAX_RUNS_PER_BALL) {
        return fail(`Runs must be a whole number from 0 to ${MAX_RUNS_PER_BALL}`);
      }
      const seq = balls.filter((ball) => ball.innings === current.innings).length + 1;
      const ball: Ball = {
        id: newId(), innings: current.innings, seq, runs: event.runs, extra: event.extra,
        extraRuns: isLegal(event) ? 0 : 1, wicket: event.wicket === true,
      };
      balls = [...balls, ball];
      change.ball = ball;
      break;
    }
    case 'undo': {
      if (!current) return fail('There is nothing to undo');
      if (current.endReason === 'admin') return fail('This innings was ended by hand, so its balls stay as they are');
      const last = [...balls].reverse().find((ball) => ball.innings === current.innings);
      if (!last) return fail('There is no ball to undo in this innings');
      balls = balls.filter((ball) => ball.id !== last.id);
      change.undoBall = last.id;
      break;
    }
    case 'end_innings': {
      if (!current || current.endReason) return fail('No innings is being played');
      current.endReason = 'admin';
      change.endInnings = { innings: current.innings, reason: 'admin' };
      break;
    }
    case 'close_answers':
      change.closeAll = true;
      break;
    case 'abandon':
      status = 'abandoned';
      change.closeAll = true;
      break;
  }

  const plan = planQuestions({ ...state, innings, balls, status });
  // The balls decide whether an innings they could end is over; one ended by hand stays ended
  for (const record of innings) {
    const ended = plan.endedBy.get(record.innings) ?? null;
    if (record.endReason === null && ended) {
      record.endReason = ended;
      change.endInnings = { innings: record.innings, reason: ended };
    } else if (record.endReason !== null && record.endReason !== 'admin' && !ended) {
      record.endReason = null;
      change.reopenInnings = { innings: record.innings };
    }
  }
  if (status !== 'abandoned') status = statusOf(innings);

  return {
    ok: true,
    state: { ...state, innings, balls, status },
    change: {
      ...change,
      release: plan.release,
      lock: plan.lock,
      resolve: plan.resolve,
      void: plan.void,
      pending: plan.pending,
      status,
    },
  };
}

/** The status the innings give a match that isn't abandoned */
export function statusOf(innings: Innings[]): MatchStatus {
  const last = innings[innings.length - 1];
  if (!last) return 'setup';
  if (!last.endReason) return 'live';
  return last.innings === 1 ? 'innings_break' : 'completed';
}

interface QuestionPlan {
  endedBy: Map<InningsNumber, Exclude<EndReason, 'admin'> | null>;
  release: ReleaseSlot[];
  lock: string[];
  resolve: Array<{ id: string; option: number }>;
  void: string[];
  pending: string[];
}

/** Where every question should be, given the balls; and which overs need questions now. */
export function planQuestions(state: MatchState): QuestionPlan {
  const { config } = state;
  const plan: QuestionPlan = { endedBy: new Map(), release: [], lock: [], resolve: [], void: [], pending: [] };
  const abandoned = state.status === 'abandoned';
  const scores = new Map<InningsNumber, InningsScore>();
  for (const record of state.innings) {
    const balls = state.balls.filter((ball) => ball.innings === record.innings);
    const score = scoreInnings(balls, config.oversPerInnings, targetFor(record.innings, state.balls, config.oversPerInnings));
    scores.set(record.innings, score);
    plan.endedBy.set(record.innings, score.endedBy);
  }
  // An innings is over when ended by hand or by its balls (whatever was stored before this change). A
  // question about an innings that never started (only possible by hand) counts as over too.
  const ended = (record: Innings | undefined) =>
    abandoned || !record || record.endReason === 'admin' || scores.get(record.innings)!.endedBy !== null;

  for (const question of state.questions) {
    const record = state.innings.find((i) => i.innings === question.innings);
    const overs = scores.get(question.innings)?.overs ?? [];
    const over = overs[question.over - 1];
    const before = overs[question.over - 2];
    const inningsOver = ended(record);

    const shouldClose = inningsOver || over !== undefined || (question.over === 1 ? false : (before?.legalBalls ?? 0) >= BALLS_PER_OVER - 1);
    if (!question.closed && shouldClose) plan.lock.push(question.id);

    const option = over?.complete ? resolveMarket(question.market, question.params, over) : null;
    if (option !== null) {
      if (!(question.hasResult && question.correctOption === option && question.status === 'active')) {
        plan.resolve.push({ id: question.id, option });
      }
    } else if (inningsOver || over?.complete) {
      // Never complete, or a market this over can't settle
      if (question.status !== 'paused' || question.hasResult) plan.void.push(question.id);
    } else if (question.hasResult || question.status === 'paused') {
      plan.pending.push(question.id);
    }
  }

  const live = state.innings[state.innings.length - 1];
  if (!abandoned && live && !ended(live)) {
    const overs = scores.get(live.innings)!.overs;
    const has = (over: number) => state.questions.some((q) => q.innings === live.innings && q.over === over);
    for (let over = 1; over <= config.oversPerInnings; over++) {
      if (has(over) || overs[over - 1]) continue;
      if (over === 1) {
        plan.release.push({ innings: live.innings, over, closesInSeconds: config.firstWindowSeconds });
      } else {
        const before = overs[over - 2];
        if (before && before.legalBalls < BALLS_PER_OVER - 1) {
          plan.release.push({ innings: live.innings, over, closesInSeconds: config.lockFallbackSeconds });
        }
      }
    }
  }
  return plan;
}
