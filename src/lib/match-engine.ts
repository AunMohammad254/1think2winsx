/**
 * Match mode's rules (migration 20261029120000_match_mode): how balls make overs and innings, when each
 * over's questions open, close and settle, and what one console event changes. Pure: the server loads
 * the match (src/lib/match-service.ts), applyEvent works out the change, and apply_match_change stores
 * it in one transaction.
 *
 * The balls are the source of truth and the questions follow from them, so an undone or corrected ball
 * takes back whatever it caused: a result, a void, the end of an innings. The console can also put right
 * an innings ended by hand, the wrong team sent in, answers closed too early and an abandoned match (see
 * applyEvent). Only opening questions can't be taken back (players may have answered), and a question
 * whose over has started never takes answers again.
 *
 * Questions shown during over N are about over N+1 (an over's "quiz"):
 *   - the quiz is prepared when over N-1 ends (over 1's and over 2's when the innings starts), so the admin
 *     can pick its questions, and the ball of over N it goes out on, before over N starts,
 *   - it goes out on that ball (pushDue: Auto picks ball 1), or whenever the admin sends it, until over N's
 *     5th legal ball (stillSendable); over 1's quiz goes out before the first ball,
 *   - its questions close after over N's 5th legal ball, at over N+1's first delivery, at a fallback time
 *     after they went out, or when the innings ends, whichever comes first,
 *   - and are settled from over N+1's balls once it is complete, or voided if it never is.
 */

/**
 * What a scorecard entry is (Laws 21-23, 41): a fair delivery (none: runs off the bat; bye; leg_bye), a wide,
 * a no-ball with its runs off the bat (no_ball) or as byes / leg byes, 5 penalty runs to the batting side
 * (penalty), or a dismissal with no ball at all (no_delivery: retired out, timed out). The last two aren't
 * balls of the over.
 */
export type Extra = 'none' | 'wide' | 'no_ball' | 'no_ball_bye' | 'no_ball_leg_bye' | 'bye' | 'leg_bye' | 'penalty' | 'no_delivery';
/** How a batter is out (Laws 25.4, 32-40; handled the ball is part of obstructing since 2017) */
export type WicketKind = 'bowled' | 'caught' | 'lbw' | 'stumped' | 'hit_wicket' | 'run_out' | 'obstructing' | 'hit_twice' | 'retired_out' | 'timed_out';
export type InningsNumber = 1 | 2;
export type MatchStatus = 'setup' | 'live' | 'innings_break' | 'completed' | 'abandoned';
export type EndReason = 'overs' | 'all_out' | 'target' | 'admin';

export const EXTRAS: readonly Extra[] = ['none', 'wide', 'no_ball', 'no_ball_bye', 'no_ball_leg_bye', 'bye', 'leg_bye', 'penalty', 'no_delivery'];
export const WICKET_KINDS: readonly WicketKind[] = ['bowled', 'caught', 'lbw', 'stumped', 'hit_wicket', 'run_out', 'obstructing', 'hit_twice', 'retired_out', 'timed_out'];
export const BALLS_PER_OVER = 6;
export const MAX_WICKETS = 10;
/** Most runs one delivery can add (3 run and 4 overthrows, say): anything above is a typing mistake */
export const MAX_RUNS_PER_BALL = 7;
/** Penalty runs awarded to the batting side (Law 41) */
export const PENALTY_RUNS = 5;

export interface Ball {
  id: string;
  innings: InningsNumber;
  /** Order within the innings, from 1 */
  seq: number;
  /** Off the bat, or byes / leg byes, or runs taken off a wide; 0 for penalty runs and no_delivery */
  runs: number;
  extra: Extra;
  /** The 1 run of a wide or no-ball, or the 5 penalty runs */
  extraRuns: number;
  wicket: boolean;
  /** How the batter was out; absent for a wicket recorded before kinds were kept */
  wicketKind?: WicketKind | null;
  /** The ball reached the boundary (a four or a six); absent before it was kept: 4 or 6 off the bat then */
  boundary?: boolean | null;
}

/** What the scorer records for one entry: the Ball without its place */
export type Delivery = Pick<Ball, 'runs' | 'extra' | 'wicket' | 'wicketKind' | 'boundary'>;

/** Not a ball of the over: penalty runs, or a dismissal with no delivery */
export const isOffBall = (ball: Pick<Ball, 'extra'>) => ball.extra === 'penalty' || ball.extra === 'no_delivery';

/** Dismissals after which no run counts: the ball is dead at once */
export const NO_RUN_DISMISSALS: readonly WicketKind[] = ['bowled', 'caught', 'lbw', 'stumped', 'hit_wicket', 'hit_twice'];

/**
 * The dismissals each kind of entry allows. Off a no-ball only run out, obstructing the field and hit the
 * ball twice (Law 21.18); off a wide, also stumped and hit wicket (Law 22.7); off byes and leg byes, run out
 * and obstructing; retired out and timed out need no delivery.
 */
export const DISMISSALS_FOR: Record<Extra, readonly WicketKind[]> = {
  none: ['bowled', 'caught', 'lbw', 'stumped', 'hit_wicket', 'run_out', 'obstructing', 'hit_twice'],
  bye: ['run_out', 'obstructing'],
  leg_bye: ['run_out', 'obstructing'],
  wide: ['stumped', 'hit_wicket', 'run_out', 'obstructing'],
  no_ball: ['run_out', 'obstructing', 'hit_twice'],
  no_ball_bye: ['run_out', 'obstructing'],
  no_ball_leg_bye: ['run_out', 'obstructing'],
  penalty: [],
  no_delivery: ['retired_out', 'timed_out'],
};

const DISMISSAL_NAMES: Record<WicketKind, string> = {
  bowled: 'bowled', caught: 'caught', lbw: 'LBW', stumped: 'stumped', hit_wicket: 'hit wicket', run_out: 'run out',
  obstructing: 'obstructing the field', hit_twice: 'hit the ball twice', retired_out: 'retired out', timed_out: 'timed out',
};
const EXTRA_NAMES: Record<Extra, string> = {
  none: 'a fair ball', wide: 'a wide', no_ball: 'a no-ball', no_ball_bye: 'a no-ball', no_ball_leg_bye: 'a no-ball',
  bye: 'byes', leg_bye: 'leg byes', penalty: 'penalty runs', no_delivery: 'no ball',
};

/** Why an entry can't be recorded as it is, or null when it can (the Laws of Cricket, as they score) */
export function deliveryProblem(d: Delivery): string | null {
  if (!EXTRAS.includes(d.extra)) return 'Unknown kind of delivery';
  if (!Number.isInteger(d.runs) || d.runs < 0 || d.runs > MAX_RUNS_PER_BALL) return `Runs must be a whole number from 0 to ${MAX_RUNS_PER_BALL}`;
  const kind = d.wicketKind ?? null;
  if (kind !== null && !WICKET_KINDS.includes(kind)) return 'Unknown kind of dismissal';
  if (kind !== null && !d.wicket) return 'A dismissal is a wicket';
  if (d.extra === 'penalty' && (d.runs > 0 || d.wicket || d.boundary)) return `Penalty runs are ${PENALTY_RUNS} to the batting side, with nothing else`;
  if (d.extra === 'no_delivery' && (kind === null || d.runs > 0 || d.boundary)) return 'Retired out or timed out is a wicket with no ball and no runs';
  if (kind !== null && !DISMISSALS_FOR[d.extra].includes(kind)) return `A batter can't be out ${DISMISSAL_NAMES[kind]} off ${EXTRA_NAMES[d.extra]}`;
  if (kind !== null && NO_RUN_DISMISSALS.includes(kind) && d.runs > 0) return `No runs count when a batter is out ${DISMISSAL_NAMES[kind]}`;
  if (d.boundary) {
    if (d.wicket) return "A boundary can't also be a wicket";
    if (d.runs !== 4 && d.runs !== 6) return 'A boundary is a four or a six';
    if (d.runs === 6 && !offTheBat(d)) return 'Only a hit goes for six';
  }
  return null;
}

/** The 1 run of a wide or no-ball, or the penalty runs */
const extraRunsOf = (extra: Extra) => (extra === 'penalty' ? PENALTY_RUNS : extra === 'wide' || extra.startsWith('no_ball') ? 1 : 0);

/** A ball as the scorer recorded it, numbered; kind and boundary only when given */
function newBall(id: string, innings: InningsNumber, seq: number, d: Delivery): Ball {
  return {
    id, innings, seq, runs: d.runs, extra: d.extra, extraRuns: extraRunsOf(d.extra), wicket: d.wicket === true,
    ...(d.wicketKind ? { wicketKind: d.wicketKind } : {}),
    ...(typeof d.boundary === 'boolean' ? { boundary: d.boundary } : {}),
  };
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
  /**
   * Overs whose questions wait for an admin's review (or were skipped) instead of being out: they have
   * their questions, so none are released for them again
   */
  draftSlots?: Array<{ innings: InningsNumber; over: number }>;
}

/**
 * The live-stream pop-up's countdown ends this long before a match question closes: the server has no grace
 * period for them, so the answers it locks in at that deadline (spread over most of this) still arrive in
 * time. src/components/quiz/LiveQuizPush.tsx.
 */
export const MATCH_POPUP_MARGIN_SECONDS = 30;

/** The balls of an over a quiz can be set to go out on: 1 to 4 (the 5th closes it) */
export const PUSH_BALLS = [1, 2, 3, 4] as const;

/** The live innings' overs, when `slot` is about it and it is being played; else null */
function liveOvers(state: MatchState, slot: { innings: InningsNumber }): Over[] | null {
  const live = state.innings[state.innings.length - 1];
  if (state.status === 'abandoned' || !live || live.endReason || live.innings !== slot.innings) return null;
  return splitOvers(state.balls.filter((ball) => ball.innings === live.innings));
}

/**
 * Whether the quiz about `slot` can still go out: its innings is being played, its over hasn't started, and
 * the balls wouldn't close it yet (the over before has fewer than 5 legal balls). Its questions close a
 * fallback time after they go out, so how long ago it was prepared doesn't matter.
 */
export function stillSendable(state: MatchState, slot: { innings: InningsNumber; over: number }): boolean {
  const overs = liveOvers(state, slot);
  return overs !== null && !overs[slot.over - 1] && (overs[slot.over - 2]?.legalBalls ?? 0) < BALLS_PER_OVER - 1;
}

/**
 * Whether the quiz about `slot`, set to go out on `ball` of the over before it, is due: that over has
 * started (ball 1: its first delivery, a wide included) and has `ball` legal balls (2 to 4: 9.2, 9.3, 9.4).
 * Over 1's quiz is due at once: it goes out before the first ball.
 */
export function pushDue(state: MatchState, slot: { innings: InningsNumber; over: number }, ball: number): boolean {
  if (!stillSendable(state, slot)) return false;
  if (slot.over === 1) return true;
  const before = liveOvers(state, slot)![slot.over - 2];
  return before !== undefined && (ball <= 1 || before.legalBalls >= ball);
}

/** The legal balls bowled so far in the over a quiz about `over` goes out in (0 before it starts), or null for over 1 */
export function ballsBefore(state: MatchState, slot: { innings: InningsNumber; over: number }): number | null {
  if (slot.over === 1) return null;
  return liveOvers(state, slot)?.[slot.over - 2]?.legalBalls ?? 0;
}

/** Counts as one of the over's six: a fair ball, byes or leg byes */
export const isLegal = (ball: Pick<Ball, 'extra'>) => ball.extra === 'none' || ball.extra === 'bye' || ball.extra === 'leg_bye';
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

/**
 * An innings' balls, in order, split into overs: an over ends with its 6th legal ball. Penalty runs and a
 * dismissal with no delivery belong to the over being bowled, or the one just finished: they never start one.
 */
export function splitOvers(balls: Ball[]): Over[] {
  const overs: Over[] = [];
  for (const ball of balls) {
    let over = overs[overs.length - 1];
    if (!over || (over.complete && !isOffBall(ball))) {
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

const offTheBat = (ball: Pick<Ball, 'extra'>) => ball.extra === 'none' || ball.extra === 'no_ball';
const lineOf = (params: Record<string, unknown>): number | null =>
  typeof params.line === 'number' && Number.isFinite(params.line) ? params.line : null;

const MARKETS: Record<string, (over: Over, params: Record<string, unknown>) => boolean | null> = {
  over_runs_at_least: (over, params) => {
    const line = lineOf(params);
    return line === null ? null : over.runs >= line;
  },
  // A four or a six hit by a batter: not boundary byes, all-run fours or overthrows
  boundary_in_over: (over) => over.balls.some((ball) => offTheBat(ball) && (ball.boundary ?? (ball.runs === 4 || ball.runs === 6))),
  // Out to a ball of the over: retired out and timed out aren't a wicket falling
  wicket_in_over: (over) => over.balls.some((ball) => ball.wicket && ball.extra !== 'no_delivery'),
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
  | ({ type: 'ball' } & Delivery)
  | { type: 'undo' }
  | { type: 'end_innings' }
  | { type: 'close_answers' }
  | { type: 'abandon' }
  // Corrections
  | ({ type: 'correct_ball'; ballId: string } & Delivery)
  | { type: 'resume_innings' }
  | { type: 'remove_innings' }
  | { type: 'reopen_answers' }
  | { type: 'restore' };

/** Over `over` of innings `innings` needs its quiz prepared now; once out, its questions close after `closesInSeconds` at the latest */
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
  /** An innings ended by hand plays on */
  resumeInnings?: { innings: InningsNumber };
  /** An innings without balls goes, with its questions */
  removeInnings?: { innings: InningsNumber };
  ball?: Ball;
  undoBall?: string;
  /** A corrected ball: the new one takes the old one's number */
  replaceBall?: Ball & { replaces: string };
  release: ReleaseSlot[];
  lock: string[];
  closeAll?: true;
  /** Questions closed early that take answers again, until then */
  reopen?: Array<{ id: string; closesInSeconds: number }>;
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

const AFTER_THE_END: ReadonlyArray<MatchEvent['type']> = ['undo', 'correct_ball', 'resume_innings'];

/**
 * What `event` changes, or why it can't happen. `newId` names a new ball. The returned state is the match
 * after the change, as the next load will see it.
 */
export function applyEvent(state: MatchState, event: MatchEvent, newId: () => string): EventOutcome {
  if (state.status === 'abandoned' && event.type !== 'restore') {
    return fail('This match was abandoned: restore it first to record anything more');
  }
  // A finished match can still have its balls put right (a wrongly recorded winning run, say), or an
  // innings ended by hand played on
  if (state.status === 'completed' && !AFTER_THE_END.includes(event.type)) {
    return fail('This match has finished: only its balls can be corrected, or an innings ended by hand resumed');
  }
  const innings = state.innings.map((i) => ({ ...i }));
  let balls = state.balls;
  let questions = state.questions;
  let draftSlots = state.draftSlots;
  const change: Partial<MatchChange> = {};
  let status: MatchStatus = state.status;
  const current = innings[innings.length - 1];
  const endedBy = (record: Innings, withBalls: Ball[]) => scoreInnings(
    withBalls.filter((ball) => ball.innings === record.innings), state.config.oversPerInnings,
    targetFor(record.innings, withBalls, state.config.oversPerInnings),
  ).endedBy;

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
      const problem = deliveryProblem(event);
      if (problem) return fail(problem);
      const seq = balls.filter((ball) => ball.innings === current.innings).length + 1;
      if (seq === 1 && isOffBall(event)) return fail('Record penalty runs or a retirement once the innings has had a ball');
      const ball = newBall(newId(), current.innings, seq, event);
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
    case 'correct_ball': {
      const old = balls.find((ball) => ball.id === event.ballId);
      if (!old) return fail('That ball was undone or changed meanwhile');
      const problem = deliveryProblem(event);
      if (problem) return fail(problem);
      if (old.seq === 1 && isOffBall(event)) return fail('The first entry of an innings is a ball');
      const ball = newBall(newId(), old.innings, old.seq, event);
      const same = ball.runs === old.runs && ball.extra === old.extra && ball.wicket === old.wicket
        && (ball.wicketKind ?? null) === (old.wicketKind ?? null) && (ball.boundary ?? null) === (old.boundary ?? null);
      if (same) return fail('That ball already says so');
      const corrected = balls.map((b) => (b.id === old.id ? ball : b));
      // An innings its balls ended can't come back to life under the one played after it
      const record = innings.find((i) => i.innings === old.innings)!;
      if (record !== current && record.endReason !== 'admin' && endedBy(record, corrected) === null) {
        return fail(`With that ball innings ${record.innings} wouldn't be over, but innings ${current.innings} has started`);
      }
      balls = corrected;
      change.replaceBall = { ...ball, replaces: old.id };
      break;
    }
    case 'resume_innings': {
      if (!current || current.endReason !== 'admin') return fail('Only an innings ended by hand can be resumed');
      if (endedBy(current, balls) !== null) return fail('Its balls already end this innings: undo or correct one instead');
      current.endReason = null;
      change.resumeInnings = { innings: current.innings };
      break;
    }
    case 'remove_innings': {
      if (!current) return fail('There is no innings to remove');
      if (balls.some((ball) => ball.innings === current.innings)) return fail("An innings with balls recorded can't be removed");
      innings.pop();
      // Answered ones stay in the database, voided and no longer part of the match
      questions = questions.filter((q) => q.innings !== current.innings);
      draftSlots = draftSlots?.filter((slot) => slot.innings !== current.innings);
      change.removeInnings = { innings: current.innings };
      break;
    }
    case 'reopen_answers': {
      const reopen = reopenable(state);
      if (reopen.length === 0) return fail('No question can take answers again: its over has started, or the innings is over');
      const windows = new Map(reopen.map((q) => [q.id, q.over === 1 ? state.config.firstWindowSeconds : state.config.lockFallbackSeconds]));
      questions = questions.map((q) => (windows.has(q.id) ? { ...q, closed: false } : q));
      change.reopen = [...windows].map(([id, closesInSeconds]) => ({ id, closesInSeconds }));
      break;
    }
    case 'restore':
      if (state.status !== 'abandoned') return fail('Only an abandoned match can be restored');
      status = statusOf(innings);
      break;
  }

  const plan = planQuestions({ ...state, innings, balls, status, questions, draftSlots });
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
    state: { ...state, innings, balls, status, questions, draftSlots },
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

/**
 * Closed questions that may take answers again: unsettled, not void, about the innings being played,
 * their over not started and the balls not closing them yet (the over before has fewer than 5 legal
 * balls). Answering after a ball of their over would let players see part of the answer.
 */
export function reopenable(state: MatchState): MatchQuestion[] {
  const live = state.innings[state.innings.length - 1];
  if (state.status === 'abandoned' || !live || live.endReason) return [];
  const overs = splitOvers(state.balls.filter((ball) => ball.innings === live.innings));
  return state.questions.filter((q) => q.innings === live.innings && q.closed && q.status === 'active' && !q.hasResult
    && !overs[q.over - 1] && (overs[q.over - 2]?.legalBalls ?? 0) < BALLS_PER_OVER - 1);
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
    const has = (over: number) => state.questions.some((q) => q.innings === live.innings && q.over === over)
      || (state.draftSlots ?? []).some((slot) => slot.innings === live.innings && slot.over === over);
    // Prepared one over ahead: the quiz about over M once over M-2 is complete (overs 1 and 2 at the start),
    // while it can still go out (over M hasn't started, over M-1 has fewer than 5 legal balls)
    for (let over = 1; over <= config.oversPerInnings; over++) {
      if (has(over) || overs[over - 1]) continue;
      const ready = over <= 2 || overs[over - 3]?.complete === true;
      if (ready && (overs[over - 2]?.legalBalls ?? 0) < BALLS_PER_OVER - 1) {
        plan.release.push({ innings: live.innings, over, closesInSeconds: over === 1 ? config.firstWindowSeconds : config.lockFallbackSeconds });
      }
    }
  }
  return plan;
}
