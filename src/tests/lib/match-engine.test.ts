// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  applyEvent,
  planQuestions,
  reopenable,
  stillSendable,
  MIN_ANSWER_SECONDS,
  resolveMarket,
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

describe('an innings, ball by ball', () => {
  it("opens over 1's questions when the innings starts, closing after the first window", () => {
    const { state, last } = play([startLahore]);
    expect(last).toMatchObject({ startInnings: { innings: 1, battingTeam: 'Lahore' }, release: [{ innings: 1, over: 1, closesInSeconds: 120 }], status: 'live' });
    expect(state.questions.map((x) => x.id)).toEqual(['q1.1.0', 'q1.1.1']);
  });

  it("opens over 2's questions at over 1's first delivery, and closes over 1's then", () => {
    const { state, last } = play([startLahore, wide]);
    expect(last.ball).toEqual({ id: 'b1', innings: 1, seq: 1, runs: 0, extra: 'wide', extraRuns: 1, wicket: false });
    expect(last.release).toEqual([{ innings: 1, over: 2, closesInSeconds: 150 }]);
    expect(last.lock).toEqual(['q1.1.0', 'q1.1.1']);
    expect(q(state, 'q1.2.0').closed).toBe(false);
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
    expect(last).toMatchObject({ startInnings: { innings: 2, battingTeam: 'Karachi' }, release: [{ innings: 2, over: 1 }], status: 'live' });
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
    expect(last.reopen).toEqual([{ id: 'q1.1.0', closesInSeconds: 120 }, { id: 'q1.1.1', closesInSeconds: 120 }]);
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

describe('reviewed questions (drafts)', () => {
  const NOW = 1_000_000;

  it("opens nothing for an over whose questions wait for review or were skipped", () => {
    const waiting = applyEvent({ ...EMPTY, draftSlots: [{ innings: 1, over: 1 }] }, startLahore, () => 'x');
    expect(waiting.ok && waiting.change.release).toEqual([]);
    const live: MatchState = { ...play([startLahore]).state, draftSlots: [{ innings: 1, over: 2 }] };
    const ball = applyEvent(live, dot, () => 'x');
    expect(ball.ok && ball.change.release).toEqual([]);
    // Without the slot, over 2's questions would open now
    const without = applyEvent({ ...live, draftSlots: undefined }, dot, () => 'x');
    expect(without.ok && without.change.release).toEqual([{ innings: 1, over: 2, closesInSeconds: 150 }]);
  });

  it("drops a removed innings' slots, so a fresh innings gets fresh questions", () => {
    const { state } = play([startLahore, ...six(dot), ...six(dot), { type: 'start_innings', battingTeam: 'Karachi' }]);
    const outcome = applyEvent({ ...state, draftSlots: [{ innings: 1, over: 1 }, { innings: 2, over: 1 }] }, { type: 'remove_innings' }, () => 'x');
    expect(outcome.ok && outcome.state.draftSlots).toEqual([{ innings: 1, over: 1 }]);
  });

  it('can send a question while its innings is played, its over not started, the balls not closing it and time left', () => {
    const live = play([startLahore, dot, dot]).state;
    const slot = { innings: 1 as const, over: 2 };
    expect(stillSendable(live, slot, NOW + 60_000, NOW)).toBe(true);
    // Less than MIN_ANSWER_SECONDS left
    expect(stillSendable(live, slot, NOW + (MIN_ANSWER_SECONDS - 1) * 1000, NOW)).toBe(false);
    // Over 1 has had its 5th legal ball
    expect(stillSendable(play([dot, dot, dot], live).state, slot, NOW + 60_000, NOW)).toBe(false);
    // Its own over has started
    expect(stillSendable(live, { innings: 1, over: 1 }, NOW + 60_000, NOW)).toBe(false);
    // Another innings, an innings over, an abandoned match, no innings at all
    expect(stillSendable(live, { innings: 2, over: 2 }, NOW + 60_000, NOW)).toBe(false);
    expect(stillSendable(play([{ type: 'end_innings' }], live).state, slot, NOW + 60_000, NOW)).toBe(false);
    expect(stillSendable({ ...live, status: 'abandoned' }, slot, NOW + 60_000, NOW)).toBe(false);
    expect(stillSendable(EMPTY, slot, NOW + 60_000, NOW)).toBe(false);
  });
});
