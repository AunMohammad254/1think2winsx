// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
let ids = 0;
const logQuizAction = vi.fn();
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => db.client, generateId: () => `id${++ids}` }));
vi.mock('@/lib/admin-action-log', () => ({ logQuizAction: (...a: unknown[]) => logQuizAction(...a) }));

const { loadMatch, matchView, ballLabel, applyMatchEvent, createMatch, listMatches } = await import('@/lib/match-service');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const ROW = {
  id: 'm1', quizId: 'quiz1', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 2, questionsPerOver: 2,
  firstWindowSeconds: 120, lockFallbackSeconds: 150, status: 'live', version: 3, createdAt: '2026-10-29T10:00:00Z',
};
const question = (over: Record<string, unknown> = {}) => ({
  id: 'q1', text: 'Lahore: will over 1 go for 8 or more runs?', options: '["Yes","No"]', matchInnings: 1, matchOver: 1,
  market: 'over_runs_at_least', marketParams: { line: 8 }, status: 'active', hasCorrectAnswer: false, correctOption: null,
  closesAt: '2026-10-29T12:01:00Z', ...over,
});
const ball = (seq: number, over: Record<string, unknown> = {}) =>
  ({ id: `b${seq}`, innings: 1, seq, runs: 1, extra: 'none', extraRuns: 0, wicket: false, ...over });

function setMatch(over: { row?: Record<string, unknown>; quiz?: unknown; innings?: unknown[]; balls?: unknown[]; questions?: unknown[]; settled?: number } = {}) {
  db.setTable('LiveMatch', { data: { ...ROW, ...over.row, Quiz: over.quiz === undefined ? { title: 'Lahore vs Karachi' } : over.quiz } });
  db.setTable('MatchInnings', { data: over.innings ?? [{ innings: 1, battingTeam: 'Lahore', endReason: null }] });
  db.setTable('BallEvent', { data: over.balls ?? [] });
  db.setTable('Question', { data: over.questions ?? [] });
  db.setTable('QuizSettlement', { count: over.settled ?? 0 });
}

beforeEach(() => {
  db = createSupabaseMock();
  ids = 0;
  logQuizAction.mockReset();
});

describe('loadMatch', () => {
  it('reads the match, its innings, balls and questions into the engine state', async () => {
    setMatch({
      balls: [ball(1)],
      questions: [question(), question({ id: 'q2', closesAt: '2026-10-29T11:59:00Z', marketParams: null }), question({ id: 'q3', closesAt: null })],
    });
    const loaded = (await loadMatch('m1', NOW))!;
    expect(loaded.title).toBe('Lahore vs Karachi');
    expect(loaded.settled).toBe(false);
    expect(loaded.state.config).toEqual({ teams: ['Lahore', 'Karachi'], oversPerInnings: 2, questionsPerOver: 2, firstWindowSeconds: 120, lockFallbackSeconds: 150 });
    expect(loaded.state.balls).toEqual([ball(1)]);
    expect(loaded.state.questions.map((q) => [q.id, q.closed, q.params])).toEqual([
      ['q1', false, { line: 8 }], ['q2', true, {}], ['q3', false, { line: 8 }],
    ]);
    // Only the balls not undone, and only this quiz's match questions
    expect(db.callsTo('BallEvent')[0].ops.find((o) => o.op === 'is')?.args).toEqual(['undoneAt', null]);
    expect(eqValue(db.callsTo('Question')[0], 'quizId')).toBe('quiz1');
  });

  it('names a match without a quiz title after its teams, and sees a settlement', async () => {
    setMatch({ quiz: [], settled: 1, innings: null as never, balls: null as never, questions: null as never });
    db.setTable('MatchInnings', { data: null });
    db.setTable('BallEvent', { data: null });
    db.setTable('Question', { data: null });
    const loaded = (await loadMatch('m1'))!;
    expect(loaded).toMatchObject({ title: 'Lahore vs Karachi', settled: true });
    expect(loaded.state).toMatchObject({ innings: [], balls: [], questions: [] });
    db.setTable('LiveMatch', { data: { ...ROW, Quiz: [{ title: 'Final' }] } });
    db.setTable('QuizSettlement', { count: null });
    expect(await loadMatch('m1')).toMatchObject({ title: 'Final', settled: false });
  });

  it('answers null for an unknown match, and throws a failed read', async () => {
    expect(await loadMatch('nope')).toBeNull();
    db.setTable('LiveMatch', { error: { message: 'down' } });
    await expect(loadMatch('m1')).rejects.toEqual({ message: 'down' });
    setMatch();
    db.setTable('BallEvent', { error: { message: 'balls down' } });
    await expect(loadMatch('m1')).rejects.toEqual({ message: 'balls down' });
  });
});

describe('matchView', () => {
  it('scores each innings and labels its balls the way a scorecard does', async () => {
    setMatch({
      innings: [{ innings: 1, battingTeam: 'Lahore', endReason: 'overs' }, { innings: 2, battingTeam: 'Karachi', endReason: null }],
      balls: [
        ...[0, 4, 6, 1, 1, 1].map((runs, i) => ball(i + 1, { runs })),
        ...[1, 1, 1, 1, 1, 1].map((runs, i) => ball(i + 7, { runs })),
        ball(1, { innings: 2, id: 'c1', runs: 0, extra: 'wide', extraRuns: 1 }),
        ball(2, { innings: 2, id: 'c2', runs: 4, extra: 'no_ball', extraRuns: 1 }),
        ball(3, { innings: 2, id: 'c3', runs: 0, wicket: true }),
      ],
    });
    const view = matchView((await loadMatch('m1', NOW))!, NOW);
    expect(view.match).toEqual({ ...ROW, createdAt: undefined, title: 'Lahore vs Karachi' });
    expect(view.innings.map((i) => [i.battingTeam, i.runs, i.wickets, i.oversText, i.target, i.endReason])).toEqual([
      ['Lahore', 19, 0, '2.0', null, 'overs'],
      ['Karachi', 6, 1, '0.1', 20, null],
    ]);
    expect(view.innings[1].overs).toEqual([{
      number: 1, runs: 6, wickets: 1, complete: false,
      // With what the console needs to correct each
      balls: [
        { id: 'c1', label: 'Wd', runs: 0, extra: 'wide', wicket: false },
        { id: 'c2', label: '4Nb', runs: 4, extra: 'no_ball', wicket: false },
        { id: 'c3', label: 'W', runs: 0, extra: 'none', wicket: true },
      ],
    }]);
    expect(view.serverNow).toBe('2026-10-29T12:00:00.000Z');
  });

  it('gives each question its state for the console', async () => {
    setMatch({
      questions: [
        question(),
        question({ id: 'closed', closesAt: '2026-10-29T11:00:00Z' }),
        question({ id: 'settled', hasCorrectAnswer: true, correctOption: 1 }),
        question({ id: 'void', status: 'paused', hasCorrectAnswer: true, correctOption: 0 }),
        question({ id: 'never', closesAt: null }),
        question({ id: 'broken', options: 'not json' }),
        question({ id: 'object', options: '{"a":1}' }),
      ],
    });
    const view = matchView((await loadMatch('m1', NOW))!, NOW);
    expect(view.questions.map((q) => [q.id, q.state, q.correctOption])).toEqual([
      ['q1', 'open', null], ['closed', 'closed', null], ['settled', 'settled', 1], ['void', 'void', null],
      ['never', 'open', null], ['broken', 'open', null], ['object', 'open', null],
    ]);
    expect(view.questions[0].options).toEqual(['Yes', 'No']);
    expect(view.questions[5].options).toEqual([]);
    expect(view.questions[6].options).toEqual([]);
  });

  it('marks the closed questions that may take answers again', async () => {
    setMatch({
      balls: [ball(1), ball(2)],
      questions: [
        // Over 2's, closed early during over 1: its over hasn't started
        question({ id: 'early', matchOver: 2, closesAt: '2026-10-29T11:00:00Z' }),
        // Over 1's: its over has started
        question({ id: 'started', closesAt: '2026-10-29T11:00:00Z' }),
        question({ id: 'open', matchOver: 2 }),
      ],
    });
    const view = matchView((await loadMatch('m1', NOW))!, NOW);
    expect(view.questions.map((q) => [q.id, q.reopenable])).toEqual([['early', true], ['started', false], ['open', false]]);
  });

  it('labels every kind of delivery', () => {
    const label = (over: Record<string, unknown>) => ballLabel({ runs: 0, extra: 'none', wicket: false, ...over } as never);
    expect([
      label({}), label({ runs: 4 }), label({ extra: 'wide' }), label({ extra: 'wide', runs: 1 }), label({ extra: 'no_ball', runs: 6 }),
      label({ extra: 'bye', runs: 1 }), label({ extra: 'leg_bye', runs: 2 }), label({ wicket: true }), label({ wicket: true, runs: 1 }),
      label({ wicket: true, extra: 'wide' }),
    ]).toEqual(['0', '4', 'Wd', '1Wd', '6Nb', '1B', '2Lb', 'W', '1W', 'WdW']);
  });
});

describe('applyMatchEvent', () => {
  it('works out the change, opens the questions it asks for and returns the match as it now is', async () => {
    setMatch({ row: { status: 'setup' }, innings: [] });
    db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
    const result = await applyMatchEvent('m1', 3, { type: 'start_innings', battingTeam: 'Lahore' }, 'boss@example.test');
    expect(result.ok).toBe(true);
    expect(db.rpcCalls).toEqual([{
      fn: 'apply_match_change',
      args: {
        p_match_id: 'm1',
        p_version: 3,
        p_change: {
          startInnings: { innings: 1, battingTeam: 'Lahore' },
          release: [
            { id: 'id1', text: 'Lahore: will over 1 go for 9 or more runs?', options: '["Yes","No"]', market: 'over_runs_at_least', params: { line: 9 }, innings: 1, over: 1, closesInSeconds: 120 },
            { id: 'id2', text: 'Will over 1 have 3 or more dot balls?', options: '["Yes","No"]', market: 'dots_at_least', params: { line: 3 }, innings: 1, over: 1, closesInSeconds: 120 },
          ],
          lock: [], resolve: [], void: [], pending: [], status: 'live', admin: 'boss@example.test',
        },
      },
    }]);
    expect(logQuizAction).toHaveBeenCalledWith({
      quizId: 'quiz1', quizTitle: 'Lahore vs Karachi', action: 'match_innings_started', adminEmail: 'boss@example.test',
      details: { matchId: 'm1', event: { type: 'start_innings', battingTeam: 'Lahore' } },
    });
    // The match is read again after the change
    expect(db.callsTo('LiveMatch')).toHaveLength(2);
  });

  it('sends a correction to the database, and logs it on the quiz', async () => {
    setMatch({ balls: [ball(1), ball(2)] });
    db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
    const event = { type: 'correct_ball' as const, ballId: 'b1', runs: 4, extra: 'none' as const, wicket: false };
    expect((await applyMatchEvent('m1', 3, event, 'boss@example.test')).ok).toBe(true);
    expect((db.rpcCalls[0].args.p_change as { replaceBall: unknown }).replaceBall)
      .toEqual({ id: 'id1', replaces: 'b1', innings: 1, seq: 1, runs: 4, extra: 'none', extraRuns: 0, wicket: false });
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_ball_corrected', details: { matchId: 'm1', event } }));
  });

  it("records a ball with the engine's id and number, and doesn't log it", async () => {
    setMatch({ balls: [ball(1)] });
    db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
    await applyMatchEvent('m1', 3, { type: 'ball', runs: 4, extra: 'none', wicket: false }, 'boss@example.test');
    expect((db.rpcCalls[0].args.p_change as { ball: unknown }).ball).toEqual({ id: 'id1', innings: 1, seq: 2, runs: 4, extra: 'none', extraRuns: 0, wicket: false });
    expect(logQuizAction).not.toHaveBeenCalled();
  });

  it('refuses an unknown, settled or changed match, and an event the engine refuses, saving nothing', async () => {
    expect(await applyMatchEvent('nope', 0, { type: 'undo' }, 'a')).toEqual({ ok: false, status: 404, code: 'not_found', error: 'Match not found' });
    setMatch({ settled: 1 });
    expect(await applyMatchEvent('m1', 3, { type: 'undo' }, 'a')).toMatchObject({ ok: false, status: 409, code: 'settled' });
    setMatch();
    expect(await applyMatchEvent('m1', 2, { type: 'undo' }, 'a')).toMatchObject({ ok: false, status: 409, code: 'stale' });
    expect(await applyMatchEvent('m1', 3, { type: 'undo' }, 'a')).toEqual({ ok: false, status: 400, code: 'invalid', error: 'There is no ball to undo in this innings' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("passes on the database's refusals, and throws its errors", async () => {
    setMatch();
    const close = () => applyMatchEvent('m1', 3, { type: 'close_answers' }, 'a');
    db.setRpc('apply_match_change', { data: { success: false, code: 'stale', error: 'Someone else changed this match first.' } });
    expect(await close()).toEqual({ ok: false, status: 409, code: 'stale', error: 'Someone else changed this match first.' });
    db.setRpc('apply_match_change', { data: { success: false, code: 'not_found', error: 'Match not found' } });
    expect(await close()).toMatchObject({ status: 404 });
    db.setRpc('apply_match_change', { data: { success: false, code: 'invalid', error: 'Invalid match change' } });
    expect(await close()).toMatchObject({ status: 400, code: 'invalid' });
    db.setRpc('apply_match_change', { data: { success: false } });
    expect(await close()).toEqual({ ok: false, status: 400, code: 'error', error: 'The change could not be saved' });
    db.setRpc('apply_match_change', { error: { message: 'down' } });
    await expect(close()).rejects.toEqual({ message: 'down' });
  });
});

describe('createMatch and listMatches', () => {
  it('creates a match and logs it on its quiz', async () => {
    db.setRpc('create_live_match', { data: { success: true, matchId: 'm9', quizId: 'quiz9' } });
    const result = await createMatch({ teamA: ' Lahore ', teamB: 'Karachi', oversPerInnings: 20, questionsPerOver: 2 }, 'boss@example.test');
    expect(result).toEqual({ ok: true, data: { matchId: 'm9', quizId: 'quiz9' } });
    expect(db.rpcCalls[0].args).toEqual({ p_team_a: ' Lahore ', p_team_b: 'Karachi', p_overs: 20, p_questions_per_over: 2, p_admin: 'boss@example.test' });
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ quizId: 'quiz9', quizTitle: 'Lahore vs Karachi', action: 'match_created' }));
  });

  it('passes on a refusal and throws a database error', async () => {
    const make = () => createMatch({ teamA: 'A', teamB: 'B', oversPerInnings: 10, questionsPerOver: 1 }, 'a');
    db.setRpc('create_live_match', { data: { success: false, code: 'invalid', error: 'Each team name needs 2 to 60 characters' } });
    expect(await make()).toEqual({ ok: false, status: 400, code: 'invalid', error: 'Each team name needs 2 to 60 characters' });
    db.setRpc('create_live_match', { data: { success: false } });
    expect(await make()).toEqual({ ok: false, status: 400, code: 'invalid', error: 'The match could not be created' });
    db.setRpc('create_live_match', { error: { message: 'down' } });
    await expect(make()).rejects.toEqual({ message: 'down' });
    expect(logQuizAction).not.toHaveBeenCalled();
  });

  it('lists the newest matches first', async () => {
    db.setTable('LiveMatch', { data: [ROW] });
    expect(await listMatches(5)).toEqual([ROW]);
    expect(db.callsTo('LiveMatch')[0].ops.find((o) => o.op === 'limit')?.args).toEqual([5]);
    db.setTable('LiveMatch', { data: null });
    expect(await listMatches()).toEqual([]);
    db.setTable('LiveMatch', { error: { message: 'down' } });
    await expect(listMatches()).rejects.toEqual({ message: 'down' });
  });
});
