// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  applyEvent,
  planQuestions,
  reopenable,
  stillSendable,
  pushDue,
  ballsBefore,
  PUSH_BALLS,
  resolveMarket,
  deliveryProblem,
  isOffBall,
  DISMISSALS_FOR,
  EXTRAS,
  WICKET_KINDS,
  PENALTY_RUNS,
  scoreInnings,
  splitOvers,
  statusOf,
  targetFor,
  currentInnings,
  MARKET_NAMES,
  type Ball,
  type MatchChange,
  type MatchConfig,
  type MatchEvent,
  type MatchQuestion,
  type MatchState,
} from '@/lib/match-engine';

const CONFIG: MatchConfig = { teams: ['Lahore', 'Karachi'], oversPerInnings: 2, questionsPerOver: 2, firstWindowSeconds: 120, lockFallbackSeconds: 150 };
const EMPTY: MatchState = { config: CONFIG, status: 'setup', innings: [], balls: [], questions: [] };

const ball = (seq: number, over: Partial<Ball> = {}): Ball =>
  ({ id: `x${seq}`, innings: 1, seq, runs: 1, extra: 'none', extraRuns: 0, wicket: false, ...over });
const dot: MatchEvent = { type: 'ball', runs: 0, extra: 'none', wicket: false };
const runs = (n: number): MatchEvent => ({ type: 'ball', runs: n, extra: 'none', wicket: false });
const wide: MatchEvent = { type: 'ball', runs: 0, extra: 'wide', wicket: false };
const wicket: MatchEvent = { type: 'ball', runs: 0, extra: 'none', wicket: true };

/**
 * Plays events the way the server and apply_match_change do: each change is "stored" (questions opened
 * for the release slots, closed, settled, voided) before the next event is worked out.
 */
function play(events: MatchEvent[], from: MatchState = EMPTY, config: MatchConfig = CONFIG) {
  let state: MatchState = { ...from, config };
  let id = 0;
  const changes: MatchChange[] = [];
  for (const event of events) {
    const outcome = applyEvent(state, event, () => `b${++id}`);
    if (!outcome.ok) throw new Error(outcome.error);
    changes.push(outcome.change);
    state = store(outcome.state, outcome.change);
  }
  return { state, changes, last: changes[changes.length - 1] };
}

function store(state: MatchState, change: MatchChange): MatchState {
  const questions: MatchQuestion[] = state.questions
    // A removed innings' questions are deleted, or detached from the match when answered: gone either way
    .filter((q) => q.innings !== change.removeInnings?.innings)
    .map((q) => ({ ...q }));
  for (const slot of change.release) {
    for (let k = 0; k < state.config.questionsPerOver; k++) {
      questions.push({
        id: `q${slot.innings}.${slot.over}.${k}`, innings: slot.innings, over: slot.over,
        market: k === 0 ? 'over_runs_at_least' : 'wicket_in_over', params: k === 0 ? { line: 6 } : {},
        status: 'active', hasResult: false, correctOption: null, closed: false,
      });
    }
  }
  for (const q of questions) {
    if (change.closeAll || change.lock.includes(q.id)) q.closed = true;
    if (change.reopen?.some((r) => r.id === q.id)) q.closed = false;
    const resolved = change.resolve.find((r) => r.id === q.id);
    if (resolved) Object.assign(q, { hasResult: true, correctOption: resolved.option, status: 'active' });
    if (change.void.includes(q.id)) Object.assign(q, { hasResult: false, correctOption: null, status: 'paused' });
    if (change.pending.includes(q.id)) Object.assign(q, { hasResult: false, correctOption: null, status: 'active' });
  }
  return { ...state, questions };
}

const q = (state: MatchState, id: string) => state.questions.find((question) => question.id === id)!;
const six = (event: MatchEvent): MatchEvent[] => Array.from({ length: 6 }, () => event);
const startLahore: MatchEvent = { type: 'start_innings', battingTeam: 'Lahore' };

describe('overs and scores', () => {
  it('ends an over at its 6th legal ball, wides and no-balls coming on top', () => {
    const balls = [ball(1), ball(2, { extra: 'wide', runs: 0, extraRuns: 1 }), ball(3), ball(4), ball(5, { extra: 'no_ball', runs: 4, extraRuns: 1 }), ball(6), ball(7), ball(8, { wicket: true, runs: 0 }), ball(9)];
    const overs = splitOvers(balls);
    expect(overs.map((o) => [o.number, o.balls.length, o.legalBalls, o.runs, o.wickets, o.complete])).toEqual([
      [1, 8, 6, 11, 1, true],
      [2, 1, 1, 1, 0, false],
    ]);
    expect(scoreInnings(balls, 20, null)).toMatchObject({ runs: 12, wickets: 1, legalBalls: 7, oversText: '1.1', endedBy: null });
    expect(splitOvers([])).toEqual([]);
  });

  it('knows when the balls end an innings: target reached, all out, overs done', () => {
    const allOut = Array.from({ length: 10 }, (_, i) => ball(i + 1, { wicket: true, runs: 0 }));
    expect(scoreInnings(allOut, 20, null).endedBy).toBe('all_out');
    const twoOvers = Array.from({ length: 12 }, (_, i) => ball(i + 1));
    expect(scoreInnings(twoOvers, 2, null)).toMatchObject({ endedBy: 'overs', oversText: '2.0' });
    expect(scoreInnings(twoOvers, 2, 12)).toMatchObject({ endedBy: 'target', runs: 12 });
    expect(scoreInnings(twoOvers.slice(0, 5), 2, 12).endedBy).toBeNull();
  });

  it("sets innings 2's target from innings 1's runs", () => {
    const balls = [ball(1, { runs: 4 }), ball(2, { runs: 6 }), ball(1, { innings: 2, id: 'y1' })];
    expect(targetFor(1, balls, 20)).toBeNull();
    expect(targetFor(2, balls, 20)).toBe(11);
  });

  it('gives the status the innings make', () => {
    expect(statusOf([])).toBe('setup');
    expect(statusOf([{ innings: 1, battingTeam: 'A', endReason: null }])).toBe('live');
    expect(statusOf([{ innings: 1, battingTeam: 'A', endReason: 'overs' }])).toBe('innings_break');
    expect(statusOf([{ innings: 1, battingTeam: 'A', endReason: 'all_out' }, { innings: 2, battingTeam: 'B', endReason: 'target' }])).toBe('completed');
    expect(currentInnings(EMPTY)).toBeNull();
  });
});

describe('markets', () => {
  const overOf = (balls: Ball[]) => splitOvers(balls)[0];
  const quiet = overOf([ball(1, { runs: 0 }), ball(2, { runs: 0 }), ball(3, { runs: 0 }), ball(4), ball(5, { runs: 2, extra: 'leg_bye' }), ball(6, { runs: 4, extra: 'bye' })]);
  const lively = overOf([ball(1, { runs: 6 }), ball(2, { wicket: true, runs: 0 }), ball(3, { extra: 'wide', runs: 0, extraRuns: 1 }), ball(4, { runs: 4, extra: 'no_ball', extraRuns: 1 }), ball(5), ball(6), ball(7), ball(8)]);

  it('counts only boundaries hit by a batter, and only wickets to a ball of the over', () => {
    const overOfBalls = (balls: Ball[]) => splitOvers(balls)[0];
    // An all-run four, a six of overthrows, boundary byes and a no-ball's boundary byes: no four or six hit
    expect(resolveMarket('boundary_in_over', {}, overOfBalls([
      ball(1, { runs: 4, boundary: false }), ball(2, { runs: 6, boundary: false }), ball(3, { runs: 4, extra: 'bye', boundary: true }),
      ball(4, { runs: 4, extra: 'no_ball_bye', extraRuns: 1, boundary: true }),
    ]))).toBe(1);
    expect(resolveMarket('boundary_in_over', {}, overOfBalls([ball(1, { runs: 4, boundary: true })]))).toBe(0);
    // A retirement isn't a wicket falling; a run out is
    expect(resolveMarket('wicket_in_over', {}, overOfBalls([ball(1), ball(2, { extra: 'no_delivery', wicket: true, wicketKind: 'retired_out' })]))).toBe(1);
    expect(resolveMarket('wicket_in_over', {}, overOfBalls([ball(1, { wicket: true, wicketKind: 'run_out' })]))).toBe(0);
    // Penalty runs count in the over's runs; a no-ball's byes aren't a dot ball
    const withPenalty = overOfBalls([ball(1, { runs: 0 }), ball(2, { runs: 0, extra: 'penalty', extraRuns: 5 }), ball(3, { runs: 2, extra: 'no_ball_leg_bye', extraRuns: 1 })]);
    expect(withPenalty).toMatchObject({ runs: 8, legalBalls: 1 });
    expect(resolveMarket('dots_at_least', { line: 2 }, withPenalty)).toBe(1);
  });

  it('settles each market from the over (0 = Yes, 1 = No)', () => {
    expect(resolveMarket('over_runs_at_least', { line: 7 }, quiet)).toBe(0); // 7 runs, 4 of them byes
    expect(resolveMarket('over_runs_at_least', { line: 8 }, quiet)).toBe(1);
    // Byes and leg byes are no boundary; a no-ball hit for four is
    expect(resolveMarket('boundary_in_over', {}, quiet)).toBe(1);
    expect(resolveMarket('boundary_in_over', {}, lively)).toBe(0);
    expect(resolveMarket('boundary_in_over', {}, overOf([ball(1, { runs: 4, extra: 'no_ball', extraRuns: 1 })]))).toBe(0);
    expect(resolveMarket('wicket_in_over', {}, lively)).toBe(0);
    expect(resolveMarket('wicket_in_over', {}, quiet)).toBe(1);
    // Dots: legal balls with no run of any kind, so the wide is no dot
    expect(resolveMarket('dots_at_least', { line: 3 }, quiet)).toBe(0);
    expect(resolveMarket('dots_at_least', { line: 2 }, lively)).toBe(1);
  });

  it("can't settle an unknown market or a line that isn't a number", () => {
    expect(resolveMarket('wides_in_over', {}, quiet)).toBeNull();
    expect(resolveMarket('over_runs_at_least', { line: 'eight' }, quiet)).toBeNull();
    expect(resolveMarket('dots_at_least', { line: Number.NaN }, quiet)).toBeNull();
    expect(MARKET_NAMES).toEqual(['over_runs_at_least', 'boundary_in_over', 'wicket_in_over', 'dots_at_least']);
  });
});

describe('every scoring action of the Laws', () => {
  const d = (over: Record<string, unknown>) => ({ runs: 0, extra: 'none' as const, wicket: false, ...over }) as Parameters<typeof deliveryProblem>[0];
  let fixes = 0;
  const fix = (state: MatchState, event: MatchEvent) => {
    const outcome = applyEvent(state, event, () => `k${++fixes}`);
    if (!outcome.ok) throw new Error(outcome.error);
    return { state: store(outcome.state, outcome.change), last: outcome.change };
  };
  const refuse = (state: MatchState, event: MatchEvent) => applyEvent(state, event, () => 'x');

  it('knows every kind of entry and dismissal', () => {
    expect(EXTRAS).toEqual(['none', 'wide', 'no_ball', 'no_ball_bye', 'no_ball_leg_bye', 'bye', 'leg_bye', 'penalty', 'no_delivery']);
    expect(WICKET_KINDS).toHaveLength(10);
    expect(PENALTY_RUNS).toBe(5);
    expect(['penalty', 'no_delivery', 'none', 'wide'].map((extra) => isOffBall({ extra: extra as never }))).toEqual([true, true, false, false]);
  });

  it('allows what the Laws allow: boundaries, overthrows, every dismissal off a fair ball, penalty runs and retirements', () => {
    for (const ok of [
      d({ runs: 4, boundary: true }), d({ runs: 6, boundary: true }), d({ runs: 4, boundary: false }), d({ runs: 6, boundary: false }), d({ runs: 7 }),
      d({ runs: 4, extra: 'no_ball', boundary: true }), d({ runs: 6, extra: 'no_ball', boundary: true }),
      d({ runs: 4, extra: 'bye', boundary: true }), d({ runs: 4, extra: 'wide', boundary: true }), d({ runs: 2, extra: 'no_ball_leg_bye' }),
      ...['bowled', 'caught', 'lbw', 'stumped', 'hit_wicket', 'hit_twice'].map((wicketKind) => d({ wicket: true, wicketKind })),
      d({ runs: 2, wicket: true, wicketKind: 'run_out' }), d({ runs: 1, wicket: true, wicketKind: 'obstructing' }),
      d({ extra: 'wide', wicket: true, wicketKind: 'stumped' }), d({ runs: 1, extra: 'wide', wicket: true, wicketKind: 'run_out' }),
      d({ runs: 1, extra: 'no_ball', wicket: true, wicketKind: 'run_out' }), d({ extra: 'no_ball', wicket: true, wicketKind: 'hit_twice' }),
      d({ extra: 'penalty' }), d({ extra: 'no_delivery', wicket: true, wicketKind: 'retired_out' }), d({ extra: 'no_delivery', wicket: true, wicketKind: 'timed_out' }),
      // A wicket recorded the old way, with no kind
      d({ runs: 1, wicket: true }),
    ]) {
      expect(deliveryProblem(ok), JSON.stringify(ok)).toBeNull();
    }
  });

  it("refuses what the Laws don't allow, saying why", () => {
    expect(deliveryProblem(d({ extra: 'free_hit' }))).toBe('Unknown kind of delivery');
    expect(deliveryProblem(d({ runs: 8 }))).toBe('Runs must be a whole number from 0 to 7');
    expect(deliveryProblem(d({ runs: 1.5 }))).toBe('Runs must be a whole number from 0 to 7');
    expect(deliveryProblem(d({ wicket: true, wicketKind: 'handled_ball' }))).toBe('Unknown kind of dismissal');
    expect(deliveryProblem(d({ wicketKind: 'caught' }))).toBe('A dismissal is a wicket');
    expect(deliveryProblem(d({ extra: 'penalty', runs: 1 }))).toBe('Penalty runs are 5 to the batting side, with nothing else');
    expect(deliveryProblem(d({ extra: 'penalty', wicket: true }))).toMatch(/Penalty runs/);
    expect(deliveryProblem(d({ extra: 'penalty', boundary: true }))).toMatch(/Penalty runs/);
    expect(deliveryProblem(d({ extra: 'no_delivery', wicket: true }))).toBe('Retired out or timed out is a wicket with no ball and no runs');
    expect(deliveryProblem(d({ extra: 'no_delivery', runs: 1, wicket: true, wicketKind: 'retired_out' }))).toMatch(/Retired out/);
    expect(deliveryProblem(d({ extra: 'no_delivery', boundary: true, wicket: true, wicketKind: 'retired_out' }))).toMatch(/Retired out/);
    // Off a no-ball: never bowled, caught, LBW or stumped
    expect(deliveryProblem(d({ extra: 'no_ball', wicket: true, wicketKind: 'caught' }))).toBe("A batter can't be out caught off a no-ball");
    expect(deliveryProblem(d({ extra: 'wide', wicket: true, wicketKind: 'lbw' }))).toBe("A batter can't be out LBW off a wide");
    expect(deliveryProblem(d({ extra: 'bye', wicket: true, wicketKind: 'stumped' }))).toBe("A batter can't be out stumped off byes");
    expect(deliveryProblem(d({ wicket: true, wicketKind: 'retired_out' }))).toBe("A batter can't be out retired out off a fair ball");
    expect(deliveryProblem(d({ runs: 2, wicket: true, wicketKind: 'caught' }))).toBe('No runs count when a batter is out caught');
    expect(deliveryProblem(d({ runs: 4, wicket: true, boundary: true }))).toBe("A boundary can't also be a wicket");
    expect(deliveryProblem(d({ runs: 5, boundary: true }))).toBe('A boundary is a four or a six');
    expect(deliveryProblem(d({ runs: 6, extra: 'leg_bye', boundary: true }))).toBe('Only a hit goes for six');
    expect(DISMISSALS_FOR.penalty).toEqual([]);
  });

  it("scores the new entries: penalty runs and retirements aren't balls of the over, and join the over being bowled or just finished", () => {
    const state = play([startLahore, ...six(dot), { type: 'ball', runs: 0, extra: 'penalty', wicket: false }]).state;
    const [first, ...rest] = splitOvers(state.balls);
    expect(rest).toEqual([]);
    expect(first).toMatchObject({ number: 1, legalBalls: 6, runs: 5, complete: true });
    expect(state.balls.at(-1)).toEqual({ id: 'b7', innings: 1, seq: 7, runs: 0, extra: 'penalty', extraRuns: 5, wicket: false });
    // A retirement during over 2, then a no-ball with byes and a ball: over 2 has one legal ball
    const more = play([
      { type: 'ball', runs: 1, extra: 'none', wicket: false },
      { type: 'ball', runs: 0, extra: 'no_delivery', wicket: true, wicketKind: 'retired_out' },
      { type: 'ball', runs: 2, extra: 'no_ball_bye', wicket: false },
    ], state).state;
    const over2 = splitOvers(more.balls)[1];
    expect(over2).toMatchObject({ legalBalls: 1, runs: 1 + 3, wickets: 1 });
    expect(more.balls.at(-2)).toMatchObject({ extra: 'no_delivery', wicketKind: 'retired_out', extraRuns: 0 });
    expect(more.balls.at(-1)).toMatchObject({ extra: 'no_ball_bye', runs: 2, extraRuns: 1 });
    expect(scoreInnings(more.balls, 2, null)).toMatchObject({ runs: 5 + 1 + 3, wickets: 1, legalBalls: 7, oversText: '1.1' });
  });

  it('records the kind and the boundary when given, and refuses penalty runs or a retirement before the first ball', () => {
    const { last } = play([startLahore, { type: 'ball', runs: 4, extra: 'none', wicket: false, boundary: true }, { type: 'ball', runs: 0, extra: 'none', wicket: true, wicketKind: 'bowled' }]);
    expect(last.ball).toEqual({ id: 'b2', innings: 1, seq: 2, runs: 0, extra: 'none', extraRuns: 0, wicket: true, wicketKind: 'bowled' });
    const start = play([startLahore]).state;
    expect(refuse(start, { type: 'ball', runs: 0, extra: 'penalty', wicket: false })).toEqual({ ok: false, error: 'Record penalty runs or a retirement once the innings has had a ball' });
    expect(refuse(start, { type: 'ball', runs: 0, extra: 'no_ball', wicket: true, wicketKind: 'lbw' })).toEqual({ ok: false, error: "A batter can't be out LBW off a no-ball" });
    // A correction can't turn the first ball into one either
    const after = play([dot], start).state;
    expect(refuse(after, { type: 'correct_ball', ballId: 'b1', runs: 0, extra: 'penalty', wicket: false })).toEqual({ ok: false, error: 'The first entry of an innings is a ball' });
    expect(refuse(after, { type: 'correct_ball', ballId: 'b1', runs: 0, extra: 'none', wicket: true, wicketKind: 'lbw', boundary: true }))
      .toEqual({ ok: false, error: "A boundary can't also be a wicket" });
  });

  it('corrects the kind or the boundary alone, and knows when nothing changed', () => {
    let { state } = play([startLahore, { type: 'ball', runs: 4, extra: 'none', wicket: false }, { type: 'ball', runs: 0, extra: 'none', wicket: true }]);
    // A 4 from before boundaries were kept is told it was run
    ({ state } = fix(state, { type: 'correct_ball', ballId: 'b1', runs: 4, extra: 'none', wicket: false, boundary: false }));
    expect(state.balls[0]).toMatchObject({ runs: 4, boundary: false });
    expect(refuse(state, { type: 'correct_ball', ballId: state.balls[0].id, runs: 4, extra: 'none', wicket: false, boundary: false }))
      .toEqual({ ok: false, error: 'That ball already says so' });
    // A wicket with no kind is given one
    ({ state } = fix(state, { type: 'correct_ball', ballId: 'b2', runs: 0, extra: 'none', wicket: true, wicketKind: 'caught' }));
    expect(state.balls[1]).toMatchObject({ wicket: true, wicketKind: 'caught' });
  });
});

describe('an innings, ball by ball', () => {
  it("prepares the quizzes about over 1 (the first window) and over 2 (out during over 1) when the innings starts", () => {
    const { state, last } = play([startLahore]);
    expect(last).toMatchObject({
      startInnings: { innings: 1, battingTeam: 'Lahore' }, status: 'live',
      release: [{ innings: 1, over: 1, closesInSeconds: 120 }, { innings: 1, over: 2, closesInSeconds: 150 }],
    });
    expect(state.questions.map((x) => x.id)).toEqual(['q1.1.0', 'q1.1.1', 'q1.2.0', 'q1.2.1']);
  });

  it("closes over 1's questions at its first delivery, and prepares over 3's quiz when over 1 ends", () => {
    const three = { ...CONFIG, oversPerInnings: 3 };
    let { state, last } = play([startLahore, wide], EMPTY, three);
    expect(last.ball).toEqual({ id: 'b1', innings: 1, seq: 1, runs: 0, extra: 'wide', extraRuns: 1, wicket: false });
    expect(last.release).toEqual([]);
    expect(last.lock).toEqual(['q1.1.0', 'q1.1.1']);
    expect(q(state, 'q1.2.0').closed).toBe(false);
    ({ state, last } = play([dot, dot, dot, dot, dot], state, three));
    expect(last.release).toEqual([]);
    ({ state, last } = play([dot], state, three));
    expect(last.release).toEqual([{ innings: 1, over: 3, closesInSeconds: 150 }]);
    // The last over has no over after it to prepare
    ({ state, last } = play(six(dot), state, three));
    expect(last.release).toEqual([]);
  });

  it("closes over 2's questions after over 1's 5th legal ball, and settles over 1's at its 6th", () => {
    let { state, last } = play([startLahore, dot, wide, dot, dot, dot]);
    expect(last.lock).toEqual([]);
    ({ state, last } = play([dot], state));
    expect(last.lock).toEqual(['q1.2.0', 'q1.2.1']);
    expect(last.resolve).toEqual([]);
    ({ state, last } = play([runs(6)], state));
    // 7 runs (a six and a wide) against a line of 6; no wicket
    expect(last.resolve).toEqual([{ id: 'q1.1.0', option: 0 }, { id: 'q1.1.1', option: 1 }]);
    expect(last.release).toEqual([]);
    expect(q(state, 'q1.1.0')).toMatchObject({ hasResult: true, correctOption: 0 });
  });

  it('ends the innings when its overs are done, voiding nothing and opening nothing more', () => {
    const { state, last } = play([startLahore, ...six(dot), ...six(runs(1))]);
    expect(last).toMatchObject({ endInnings: { innings: 1, reason: 'overs' }, status: 'innings_break', release: [], void: [] });
    expect(last.resolve).toEqual([{ id: 'q1.2.0', option: 0 }, { id: 'q1.2.1', option: 1 }]);
    expect(state.innings[0].endReason).toBe('overs');
  });

  it('voids the questions of overs an innings never finishes', () => {
    const tenWickets = Array.from({ length: 10 }, () => wicket);
    const { state, last } = play([startLahore, ...tenWickets], EMPTY, { ...CONFIG, oversPerInnings: 3 });
    expect(last).toMatchObject({ endInnings: { innings: 1, reason: 'all_out' }, status: 'innings_break' });
    // Over 2 (4 legal balls of 6) and over 3's questions are void; over 1's were settled
    expect(last.void.sort()).toEqual(['q1.2.0', 'q1.2.1', 'q1.3.0', 'q1.3.1']);
    expect(state.questions.filter((x) => x.status === 'paused').map((x) => x.id)).toEqual(['q1.2.0', 'q1.2.1', 'q1.3.0', 'q1.3.1']);
    expect(q(state, 'q1.1.1')).toMatchObject({ hasResult: true, correctOption: 0 });
  });

  it('plays the chase and finishes the match when the target is reached', () => {
    let { state, last } = play([startLahore, ...six(runs(1)), ...six(dot)]);
    expect(state.status).toBe('innings_break');
    ({ state, last } = play([{ type: 'start_innings', battingTeam: 'Karachi' }], state));
    expect(last).toMatchObject({ startInnings: { innings: 2, battingTeam: 'Karachi' }, release: [{ innings: 2, over: 1 }, { innings: 2, over: 2 }], status: 'live' });
    ({ state, last } = play([runs(6), dot], state));
    expect(last.status).toBe('live');
    ({ state, last } = play([runs(1)], state));
    // 7 runs needed: reached mid-over 1, so over 1 and over 2 of the chase are void
    expect(last).toMatchObject({ endInnings: { innings: 2, reason: 'target' }, status: 'completed' });
    expect(last.void.sort()).toEqual(['q2.1.0', 'q2.1.1', 'q2.2.0', 'q2.2.1']);
    expect(last.lock.sort()).toEqual(['q2.2.0', 'q2.2.1']);
  });
});

describe('undo', () => {
  it('takes back what the last ball settled, and lets the over be scored again', () => {
    let { state, last } = play([startLahore, ...six(dot)]);
    expect(last.resolve).toHaveLength(2);
    ({ state, last } = play([{ type: 'undo' }], state));
    expect(last.undoBall).toBe('b6');
    expect(last.pending.sort()).toEqual(['q1.1.0', 'q1.1.1']);
    expect(q(state, 'q1.1.0')).toMatchObject({ hasResult: false, status: 'active' });
    // Closed questions stay closed
    expect(q(state, 'q1.2.0').closed).toBe(true);
    ({ state, last } = play([runs(6)], state));
    expect(last.resolve).toEqual([{ id: 'q1.1.0', option: 0 }, { id: 'q1.1.1', option: 1 }]);
    expect(last.ball!.seq).toBe(6);
  });

  it('reopens an innings the last ball ended, bringing back what it voided', () => {
    const tenWickets = Array.from({ length: 10 }, () => wicket);
    let { state, last } = play([startLahore, ...tenWickets], EMPTY, { ...CONFIG, oversPerInnings: 3 });
    ({ state, last } = play([{ type: 'undo' }], state, { ...CONFIG, oversPerInnings: 3 }));
    expect(last).toMatchObject({ reopenInnings: { innings: 1 }, status: 'live' });
    expect(last.pending.sort()).toEqual(['q1.2.0', 'q1.2.1', 'q1.3.0', 'q1.3.1']);
    expect(state.innings[0].endReason).toBeNull();
  });

  it('can take back the ball that finished the match', () => {
    let { state } = play([startLahore, ...six(runs(1)), ...six(dot), { type: 'start_innings', battingTeam: 'Karachi' }, runs(7)]);
    expect(state.status).toBe('completed');
    expect(applyEvent(state, dot, () => 'x')).toEqual({
      ok: false, error: 'This match has finished: only its balls can be corrected, or an innings ended by hand resumed',
    });
    ({ state } = play([{ type: 'undo' }], state));
    expect(state.status).toBe('live');
  });

  it('refuses when there is nothing to take back, or the innings was ended by hand', () => {
    expect(applyEvent(EMPTY, { type: 'undo' }, () => 'x')).toEqual({ ok: false, error: 'There is nothing to undo' });
    const { state } = play([startLahore]);
    expect(applyEvent(state, { type: 'undo' }, () => 'x')).toEqual({ ok: false, error: 'There is no ball to undo in this innings' });
    const ended = play([dot, { type: 'end_innings' }], state).state;
    expect(applyEvent(ended, { type: 'undo' }, () => 'x')).toMatchObject({ ok: false, error: expect.stringMatching(/ended by hand/) });
  });
});

describe('admin events', () => {
  it('ends an innings by hand: its open overs are closed and voided, and it stays ended', () => {
    const { state, last } = play([startLahore, dot, dot, { type: 'end_innings' }]);
    expect(last).toMatchObject({ endInnings: { innings: 1, reason: 'admin' }, status: 'innings_break' });
    expect(last.lock.sort()).toEqual(['q1.2.0', 'q1.2.1']);
    expect(last.void.sort()).toEqual(['q1.1.0', 'q1.1.1', 'q1.2.0', 'q1.2.1']);
    expect(state.innings[0].endReason).toBe('admin');
  });

  it('closes every open question at once', () => {
    const { state, last } = play([startLahore, { type: 'close_answers' }]);
    expect(last.closeAll).toBe(true);
    expect(state.questions.every((x) => x.closed)).toBe(true);
  });

  it('abandons a match: settled overs keep their results, everything else is void, nothing more is recorded', () => {
    const { state, last } = play([startLahore, ...six(dot), dot, { type: 'abandon' }]);
    expect(last).toMatchObject({ status: 'abandoned', closeAll: true });
    expect(last.void.sort()).toEqual(['q1.2.0', 'q1.2.1']);
    expect(q(state, 'q1.1.0').hasResult).toBe(true);
    expect(applyEvent(state, dot, () => 'x')).toEqual({ ok: false, error: 'This match was abandoned: restore it first to record anything more' });
  });

  it('refuses events that make no sense where the match is', () => {
    const refuse = (state: MatchState, event: MatchEvent) => applyEvent(state, event, () => 'x');
    expect(refuse(EMPTY, dot)).toEqual({ ok: false, error: 'Start an innings before recording balls' });
    expect(refuse(EMPTY, { type: 'end_innings' })).toEqual({ ok: false, error: 'No innings is being played' });
    expect(refuse(EMPTY, { type: 'start_innings', battingTeam: 'Quetta' })).toEqual({ ok: false, error: 'Choose one of the two teams to bat' });
    const live = play([startLahore]).state;
    expect(refuse(live, startLahore)).toEqual({ ok: false, error: 'The innings being played has to end first' });
    expect(refuse(live, { type: 'ball', runs: 8, extra: 'none', wicket: false })).toMatchObject({ ok: false, error: expect.stringMatching(/0 to 7/) });
    expect(refuse(live, { type: 'ball', runs: 1.5, extra: 'none', wicket: false })).toMatchObject({ ok: false });
    expect(refuse(live, { type: 'ball', runs: 1, extra: 'beamer' as never, wicket: false })).toEqual({ ok: false, error: 'Unknown kind of delivery' });
    const breakTime = play([{ type: 'end_innings' }], live).state;
    expect(refuse(breakTime, dot)).toMatchObject({ ok: false, error: expect.stringMatching(/innings is over/) });
    expect(refuse(breakTime, startLahore)).toEqual({ ok: false, error: 'Lahore batted in the first innings' });
    const done = play([{ type: 'start_innings', battingTeam: 'Karachi' }, { type: 'end_innings' }], breakTime).state;
    expect(done.status).toBe('completed');
    expect(refuse({ ...done, status: 'innings_break' }, { type: 'start_innings', battingTeam: 'Lahore' })).toEqual({ ok: false, error: 'Both innings have been played' });
  });
});

describe('planQuestions edge cases', () => {
  it("voids a market an over can't settle, and a question about an innings that never started", () => {
    const { state } = play([startLahore]);
    const odd: MatchQuestion[] = [
      { ...q(state, 'q1.1.0'), id: 'odd', market: 'wides_in_over' },
      { ...q(state, 'q1.1.0'), id: 'stray', innings: 2, over: 1 },
    ];
    const withBalls: MatchState = { ...state, questions: odd, balls: Array.from({ length: 6 }, (_, i) => ball(i + 1, { id: `z${i}` })) };
    const plan = planQuestions(withBalls);
    expect(plan.void.sort()).toEqual(['odd', 'stray']);
    expect(plan.lock.sort()).toEqual(['odd', 'stray']);
    // Already void: nothing to change
    const voided = planQuestions({ ...withBalls, questions: odd.map((x) => ({ ...x, status: 'paused' as const, closed: true })) });
    expect(voided.void).toEqual([]);
  });

  it("closes a later over's questions once its own first delivery is in, whatever came before", () => {
    const { state } = play([startLahore]);
    const later: MatchQuestion = { ...q(state, 'q1.1.0'), id: 'later', over: 2 };
    // Over 1 undone after over 2's questions were out: nothing before it, so nothing closes them
    expect(planQuestions({ ...state, questions: [later] }).lock).toEqual([]);
  });
});

describe('corrections', () => {
  // Like play, but new balls get ids no earlier play() handed out (play numbers from b1 each time)
  let fixes = 0;
  const fix = (state: MatchState, event: MatchEvent) => {
    const outcome = applyEvent(state, event, () => `c${++fixes}`);
    if (!outcome.ok) throw new Error(outcome.error);
    return { state: store(outcome.state, outcome.change), last: outcome.change };
  };
  const refuse = (state: MatchState, event: MatchEvent) => applyEvent(state, event, () => 'x');

  it('corrects any ball: it keeps its number, and the results follow the corrected balls', () => {
    let { state } = play([startLahore, ...six(dot), runs(1)]);
    expect(q(state, 'q1.1.0')).toMatchObject({ hasResult: true, correctOption: 1 });
    // Ball 2 of over 1 was really a six: over 1 went for 6, so "6 or more" is Yes now
    const { state: fixed, last } = fix(state, { type: 'correct_ball', ballId: 'b2', runs: 6, extra: 'none', wicket: false });
    expect(last.replaceBall).toEqual({
      id: expect.stringMatching(/^c\d+$/), replaces: 'b2', innings: 1, seq: 2, runs: 6, extra: 'none', extraRuns: 0, wicket: false,
    });
    expect(last.resolve).toEqual([{ id: 'q1.1.0', option: 0 }]);
    expect(fixed.balls.map((b) => b.runs)).toEqual([0, 6, 0, 0, 0, 0, 1]);
    // Then a wide after all: over 1 is one legal ball short, so the next ball (a single) completes it, for 2 runs
    ({ state } = fix(fixed, { type: 'correct_ball', ballId: last.replaceBall!.id, runs: 0, extra: 'wide', wicket: false }));
    expect(state.balls[1]).toMatchObject({ extra: 'wide', extraRuns: 1, seq: 2 });
    expect(q(state, 'q1.1.0')).toMatchObject({ hasResult: true, correctOption: 1 });
  });

  it('refuses a ball that is gone, an impossible one, or no change at all', () => {
    const { state } = play([startLahore, dot]);
    expect(refuse(state, { type: 'correct_ball', ballId: 'nope', runs: 1, extra: 'none', wicket: false }))
      .toEqual({ ok: false, error: 'That ball was undone or changed meanwhile' });
    expect(refuse(state, { type: 'correct_ball', ballId: 'b1', runs: 1, extra: 'beamer' as never, wicket: false }))
      .toEqual({ ok: false, error: 'Unknown kind of delivery' });
    expect(refuse(state, { type: 'correct_ball', ballId: 'b1', runs: 9, extra: 'none', wicket: false }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/0 to 7/) });
    expect(refuse(state, { type: 'correct_ball', ballId: 'b1', runs: 0, extra: 'none', wicket: false }))
      .toEqual({ ok: false, error: 'That ball already says so' });
  });

  it("won't bring back to life an innings its balls ended once the next one has started", () => {
    const { state } = play([startLahore, ...six(dot), ...six(dot), { type: 'start_innings', battingTeam: 'Karachi' }, dot]);
    // A legal ball of innings 1 made a wide: innings 1 would be one ball short
    expect(refuse(state, { type: 'correct_ball', ballId: 'b2', runs: 0, extra: 'wide', wicket: false }))
      .toEqual({ ok: false, error: "With that ball innings 1 wouldn't be over, but innings 2 has started" });
    // Its runs can change: the target moves with them
    const { state: fixed } = fix(state, { type: 'correct_ball', ballId: 'b2', runs: 4, extra: 'none', wicket: false });
    expect(targetFor(2, fixed.balls, CONFIG.oversPerInnings)).toBe(5);
  });

  it('can still correct a finished match, which may then go on', () => {
    let { state } = play([startLahore, ...six(runs(1)), ...six(dot), { type: 'start_innings', battingTeam: 'Karachi' }, runs(7)]);
    expect(state.status).toBe('completed');
    // The winning hit was really a single: Karachi still need 6
    ({ state } = fix(state, { type: 'correct_ball', ballId: state.balls[state.balls.length - 1].id, runs: 1, extra: 'none', wicket: false }));
    expect(state).toMatchObject({ status: 'live', innings: [{ endReason: 'overs' }, { endReason: null }] });
  });

  it('resumes an innings ended by hand: its voided overs come back, its closed questions stay closed', () => {
    let { state } = play([startLahore, dot, dot, { type: 'end_innings' }]);
    const { state: resumed, last } = fix(state, { type: 'resume_innings' });
    expect(last).toMatchObject({ resumeInnings: { innings: 1 }, status: 'live' });
    expect(last.pending.sort()).toEqual(['q1.1.0', 'q1.1.1', 'q1.2.0', 'q1.2.1']);
    expect(resumed.innings[0].endReason).toBeNull();
    expect(q(resumed, 'q1.2.0').closed).toBe(true);
    // And a finished match whose second innings was ended by hand
    ({ state } = play([{ type: 'end_innings' }, { type: 'start_innings', battingTeam: 'Karachi' }, dot, { type: 'end_innings' }], resumed));
    expect(state.status).toBe('completed');
    expect(fix(state, { type: 'resume_innings' }).state.status).toBe('live');
  });

  it("resumes only an innings ended by hand, and not one its balls already end", () => {
    expect(refuse(EMPTY, { type: 'resume_innings' })).toEqual({ ok: false, error: 'Only an innings ended by hand can be resumed' });
    const live = play([startLahore]).state;
    expect(refuse(live, { type: 'resume_innings' })).toEqual({ ok: false, error: 'Only an innings ended by hand can be resumed' });
    const complete = Array.from({ length: 12 }, (_, i) => ball(i + 1, { id: `f${i}`, runs: 0 }));
    const ended: MatchState = { ...EMPTY, status: 'innings_break', innings: [{ innings: 1, battingTeam: 'Lahore', endReason: 'admin' }], balls: complete };
    expect(refuse(ended, { type: 'resume_innings' })).toEqual({ ok: false, error: 'Its balls already end this innings: undo or correct one instead' });
  });

  it('removes an innings without balls, with its questions, so the right team can go in', () => {
    let { state } = play([startLahore, ...six(dot), ...six(dot), { type: 'start_innings', battingTeam: 'Karachi' }]);
    const { state: removed, last } = fix(state, { type: 'remove_innings' });
    expect(last).toMatchObject({ removeInnings: { innings: 2 }, status: 'innings_break', release: [] });
    expect(removed.innings.map((i) => i.innings)).toEqual([1]);
    expect(removed.questions.some((x) => x.innings === 2)).toBe(false);
    // The first innings too, while it has no balls: back to the toss
    ({ state } = play([startLahore, { type: 'remove_innings' }]));
    expect(state).toMatchObject({ status: 'setup', innings: [], questions: [] });
  });

  it("refuses to remove an innings that has balls, or one that isn't there", () => {
    expect(refuse(EMPTY, { type: 'remove_innings' })).toEqual({ ok: false, error: 'There is no innings to remove' });
    expect(refuse(play([startLahore, dot]).state, { type: 'remove_innings' })).toEqual({ ok: false, error: "An innings with balls recorded can't be removed" });
  });

  it("reopens answers closed early, until the window their over would have had, and only while it hasn't started", () => {
    let { state } = play([startLahore, { type: 'close_answers' }]);
    let last: MatchChange;
    ({ state, last } = fix(state, { type: 'reopen_answers' }));
    expect(last.reopen).toEqual([
      { id: 'q1.1.0', closesInSeconds: 120 }, { id: 'q1.1.1', closesInSeconds: 120 },
      { id: 'q1.2.0', closesInSeconds: 150 }, { id: 'q1.2.1', closesInSeconds: 150 },
    ]);
    expect(q(state, 'q1.1.0').closed).toBe(false);

    // Over 2's questions, closed during over 1's 2nd ball: back with the fallback window
    ({ state } = play([dot, dot, { type: 'close_answers' }], state));
    expect(reopenable(state).map((x) => x.id)).toEqual(['q1.2.0', 'q1.2.1']);
    ({ last } = fix(state, { type: 'reopen_answers' }));
    expect(last.reopen).toEqual([{ id: 'q1.2.0', closesInSeconds: 150 }, { id: 'q1.2.1', closesInSeconds: 150 }]);

    // Over 1 has had its 5th legal ball: over 2's questions stay closed
    ({ state } = play([dot, dot, dot], state));
    expect(reopenable(state)).toEqual([]);
    expect(refuse(state, { type: 'reopen_answers' })).toEqual({
      ok: false, error: 'No question can take answers again: its over has started, or the innings is over',
    });
  });

  it('reopens nothing in an innings that is over, or in an abandoned match', () => {
    const { state } = play([startLahore, dot, { type: 'end_innings' }]);
    expect(reopenable(state)).toEqual([]);
    expect(reopenable({ ...state, status: 'abandoned' })).toEqual([]);
    expect(reopenable(EMPTY)).toEqual([]);
  });

  it('restores an abandoned match: results stand, unfinished overs come back, answers stay closed until reopened', () => {
    let { state } = play([startLahore, ...six(dot), dot, { type: 'abandon' }]);
    let last: MatchChange;
    ({ state, last } = fix(state, { type: 'restore' }));
    expect(last).toMatchObject({ status: 'live' });
    expect(last.pending.sort()).toEqual(['q1.2.0', 'q1.2.1']);
    expect(q(state, 'q1.1.0').hasResult).toBe(true);
    expect(q(state, 'q1.2.0')).toMatchObject({ status: 'active', closed: true });
    // Over 2 has started, so its questions can't take answers again; the balls carry on
    expect(play([dot], state).state.balls).toHaveLength(8);
  });

  it('restores only an abandoned match', () => {
    expect(refuse(play([startLahore]).state, { type: 'restore' })).toEqual({ ok: false, error: 'Only an abandoned match can be restored' });
  });
});

describe('quizzes waiting to go out (drafts)', () => {
  it("prepares nothing for an over whose quiz waits or was skipped", () => {
    const waiting = applyEvent({ ...EMPTY, draftSlots: [{ innings: 1, over: 1 }] }, startLahore, () => 'x');
    expect(waiting.ok && waiting.change.release).toEqual([{ innings: 1, over: 2, closesInSeconds: 150 }]);
    const three = { ...CONFIG, oversPerInnings: 3 };
    const { state } = play([startLahore, ...six(dot).slice(1)], EMPTY, three);
    const live: MatchState = { ...state, draftSlots: [{ innings: 1, over: 3 }] };
    const ball = applyEvent(live, dot, () => 'x');
    expect(ball.ok && ball.change.release).toEqual([]);
    // Without the slot, over 3's quiz would be prepared now
    const without = applyEvent({ ...live, draftSlots: undefined }, dot, () => 'x');
    expect(without.ok && without.change.release).toEqual([{ innings: 1, over: 3, closesInSeconds: 150 }]);
  });

  it("drops a removed innings' slots, so a fresh innings gets fresh questions", () => {
    const { state } = play([startLahore, ...six(dot), ...six(dot), { type: 'start_innings', battingTeam: 'Karachi' }]);
    const outcome = applyEvent({ ...state, draftSlots: [{ innings: 1, over: 1 }, { innings: 2, over: 1 }] }, { type: 'remove_innings' }, () => 'x');
    expect(outcome.ok && outcome.state.draftSlots).toEqual([{ innings: 1, over: 1 }]);
  });

  it('can send a quiz while its innings is played, its over not started and the balls not closing it, however long ago it was prepared', () => {
    const live = play([startLahore, dot, dot]).state;
    const slot = { innings: 1 as const, over: 2 };
    expect(stillSendable(live, slot)).toBe(true);
    expect(stillSendable(play([dot, dot], live).state, slot)).toBe(true);
    // Over 1 has had its 5th legal ball
    expect(stillSendable(play([dot, dot, dot], live).state, slot)).toBe(false);
    // Its own over has started
    expect(stillSendable(live, { innings: 1, over: 1 })).toBe(false);
    // Another innings, an innings over, an abandoned match, no innings at all
    expect(stillSendable(live, { innings: 2, over: 2 })).toBe(false);
    expect(stillSendable(play([{ type: 'end_innings' }], live).state, slot)).toBe(false);
    expect(stillSendable({ ...live, status: 'abandoned' }, slot)).toBe(false);
    expect(stillSendable(EMPTY, slot)).toBe(false);
  });

  it('pushes a quiz set to a ball once the over before it reaches that ball; over 1\'s at once', () => {
    expect(PUSH_BALLS).toEqual([1, 2, 3, 4]);
    const start = play([startLahore]).state;
    const over2 = { innings: 1 as const, over: 2 };
    expect(pushDue(start, { innings: 1, over: 1 }, 1)).toBe(true);
    // Over 1 hasn't started: nothing due
    expect(PUSH_BALLS.map((n) => pushDue(start, over2, n))).toEqual([false, false, false, false]);
    // A wide starts the over: ball 1 is due, ball 2 needs two legal balls
    const afterWide = play([wide], start).state;
    expect(PUSH_BALLS.map((n) => pushDue(afterWide, over2, n))).toEqual([true, false, false, false]);
    const afterTwo = play([dot, dot], afterWide).state;
    expect(PUSH_BALLS.map((n) => pushDue(afterTwo, over2, n))).toEqual([true, true, false, false]);
    const afterFour = play([dot, dot], afterTwo).state;
    expect(PUSH_BALLS.map((n) => pushDue(afterFour, over2, n))).toEqual([true, true, true, true]);
    // The 5th legal ball closes it: never due again
    expect(pushDue(play([dot], afterFour).state, over2, 1)).toBe(false);
  });

  it('counts the legal balls of the over a quiz goes out in', () => {
    const start = play([startLahore]).state;
    expect(ballsBefore(start, { innings: 1, over: 1 })).toBeNull();
    expect(ballsBefore(start, { innings: 1, over: 2 })).toBe(0);
    expect(ballsBefore(play([wide, dot, dot], start).state, { innings: 1, over: 2 })).toBe(2);
    // Not the innings being played
    expect(ballsBefore(start, { innings: 2, over: 2 })).toBe(0);
  });
});
