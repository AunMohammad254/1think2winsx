// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
let ids = 0;
const logQuizAction = vi.fn();
const createBroadcast = vi.fn();
vi.mock('@/lib/supabase/db', () => ({
  getAdminDb: () => db.client,
  generateId: () => `id${++ids}`,
  notificationDb: { createBroadcast: (...a: unknown[]) => createBroadcast(...a) },
}));
vi.mock('@/lib/admin-action-log', () => ({ logQuizAction: (...a: unknown[]) => logQuizAction(...a) }));
// Gemini is never called: each test says what it would word (the check, wordingProblem, is the real one)
const aiWording = vi.fn();
vi.mock('@/lib/match-wording', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/match-wording')>()),
  aiWording: (...a: unknown[]) => aiWording(...a),
}));

const {
  loadMatch, matchView, ballLabel, applyMatchEvent, createMatch, listMatches, sendDrafts, skipDrafts, setAutoSend,
  setPublished, setMaxEntries, announceMatch, MATCH_LINK, queueQuiz, unqueueQuiz, setLanguage, setAiLevel, wordDrafts,
} = await import('@/lib/match-service');
const { overCandidates } = await import('@/lib/match-questions');
const { matchSituation } = await import('@/lib/match-situation');

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
  createBroadcast.mockReset();
  aiWording.mockReset().mockImplementation(async (_ctx: unknown, questions: unknown[]) => questions.map(() => null));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Over 2's quiz as "LiveMatch".drafts stores it (prepared at the start, out during over 1): its runs and
 * wicket questions ticked, dot balls not
 */
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'd1', innings: 1, over: 2, market: 'over_runs_at_least', params: { line: 9 }, options: ['Yes', 'No'],
  text: 'Lahore: will over 2 go for 9 or more runs?', textRomanUrdu: 'Lahore: kya over 2 mein 9 ya us se zyada runs banenge?',
  body: { en: 'Lahore: will over 2 go for 9 or more runs?', ur: 'Lahore: kya over 2 mein 9 ya us se zyada runs banenge?' }, lead: null,
  rank: 0, selected: true, aiAsked: false, preparedAt: new Date(NOW - 60_000).toISOString(), window: 150, ...over,
});
const wicketDraft = draft({
  id: 'd2', market: 'wicket_in_over', params: {}, text: 'Will a wicket fall in over 2?', textRomanUrdu: 'Kya over 2 mein koi wicket giray ga?',
  body: { en: 'will a wicket fall in over 2?', ur: 'kya over 2 mein koi wicket giray ga?' }, rank: 1,
});
const dotsDraft = draft({
  id: 'd3', market: 'dots_at_least', params: { line: 3 }, text: 'Will over 2 have 3 or more dot balls?', textRomanUrdu: 'Kya over 2 mein 3 ya zyada dot balls hongi?',
  body: { en: 'will over 2 have 3 or more dot balls?', ur: 'kya over 2 mein 3 ya zyada dot balls hongi?' }, rank: 2, selected: false,
});
const QUIZ = [draft(), wicketDraft, dotsDraft];
const OUT = { options: '["Yes","No"]', innings: 1, over: 2, closesInSeconds: 150 };

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
    // Rows from before the language and AI level read as both and full
    expect(view.match).toEqual({ ...ROW, createdAt: undefined, language: 'both', aiLevel: 'full', title: 'Lahore vs Karachi', published: false });
    // Not asked for
    expect(view.players).toBeNull();
    // How much of Gemini's limits this server used, for the console
    const { wordingUsage, wordingPlan } = await import('@/lib/match-wording');
    expect(view.wording).toEqual({ ...wordingUsage(process.env, NOW), plan: wordingPlan('full', wordingUsage(process.env, NOW)) });
    expect(view.quizzes).toEqual([]);
    expect(db.callsTo('QuizAdminSettings')).toHaveLength(0);
    expect(db.callsTo('QuizEntryCount')).toHaveLength(0);
    expect(view.innings.map((i) => [i.battingTeam, i.runs, i.wickets, i.oversText, i.target, i.endReason])).toEqual([
      ['Lahore', 19, 0, '2.0', null, 'overs'],
      ['Karachi', 6, 1, '0.1', 20, null],
    ]);
    expect(view.innings[1].overs).toEqual([{
      number: 1, runs: 6, wickets: 1, complete: false,
      // With what the console needs to correct each
      balls: [
        { id: 'c1', label: 'Wd', runs: 0, extra: 'wide', wicket: false, wicketKind: null, boundary: null },
        { id: 'c2', label: '4Nb', runs: 4, extra: 'no_ball', wicket: false, wicketKind: null, boundary: null },
        { id: 'c3', label: 'W', runs: 0, extra: 'none', wicket: true, wicketKind: null, boundary: null },
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
    // Every scoring action
    expect([
      label({ runs: 4, boundary: true }), label({ runs: 4, boundary: false }), label({ runs: 6, boundary: false }), label({ runs: 5 }),
      label({ extra: 'no_ball_bye', runs: 2 }), label({ extra: 'no_ball_leg_bye', runs: 1 }), label({ extra: 'penalty' }),
      label({ wicket: true, wicketKind: 'caught' }), label({ wicket: true, wicketKind: 'run_out', runs: 1 }), label({ wicket: true, wicketKind: 'run_out' }),
      label({ extra: 'wide', wicket: true, wicketKind: 'stumped' }), label({ extra: 'no_delivery', wicket: true, wicketKind: 'retired_out' }),
      label({ extra: 'no_delivery', wicket: true, wicketKind: 'timed_out' }),
    ]).toEqual(['4', '4r', '6r', '5', '2NbB', '1NbLb', '5P', 'W', '1RO', 'RO', 'WdW', 'Ret', 'TO']);
  });

  it('reads how each batter was out and which balls were boundaries, for the console to correct', async () => {
    setMatch({ balls: [ball(1, { runs: 4, boundary: true }), ball(2, { runs: 0, wicket: true, wicketKind: 'lbw', boundary: null })] });
    const view = matchView((await loadMatch('m1', NOW))!, NOW);
    expect(view.innings[0].overs[0].balls.map((b) => [b.label, b.wicketKind, b.boundary])).toEqual([['4', null, true], ['W', 'lbw', null]]);
    expect(db.callsTo('BallEvent')[0].ops.find((o) => o.op === 'select')?.args[0]).toBe('id, innings, seq, runs, extra, extraRuns, wicket, wicketKind, boundary');
  });
});

describe('applyMatchEvent', () => {
  const ok = () => db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
  const saved = (i = 0) => db.rpcCalls.filter((c) => c.fn === 'apply_match_change')[i].args.p_change as Record<string, unknown> & { drafts: Array<Record<string, unknown>>; release: Array<Record<string, unknown>> };
  const start = { type: 'start_innings' as const, battingTeam: 'Lahore' };
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => vi.unstubAllEnvs());

  it("prepares the quizzes the engine asks for: every market, best first and ticked, waiting for the admin", async () => {
    setMatch({ row: { status: 'setup' }, innings: [] });
    ok();
    const result = await applyMatchEvent('m1', 3, start, 'boss@example.test');
    expect(result.ok).toBe(true);
    expect(db.rpcCalls[0].args).toMatchObject({ p_match_id: 'm1', p_version: 3 });
    const change = saved();
    // Nothing goes out: players see nothing until the admin sends
    expect(change).toMatchObject({ startInnings: { innings: 1, battingTeam: 'Lahore' }, release: [], status: 'live', admin: 'boss@example.test' });
    expect(change.drafts[0]).toEqual({
      id: 'id1', innings: 1, over: 1, market: 'over_runs_at_least', params: { line: 9 }, options: ['Yes', 'No'],
      text: 'Lahore: will over 1 go for 9 or more runs?', textRomanUrdu: 'Lahore: kya over 1 mein 9 ya us se zyada runs banenge?',
      body: { en: 'Lahore: will over 1 go for 9 or more runs?', ur: 'Lahore: kya over 1 mein 9 ya us se zyada runs banenge?' }, lead: null,
      rank: 0, selected: true, aiAsked: false, preparedAt: new Date(NOW).toISOString(), window: 120,
    });
    // Over 1's quiz and over 2's (out during over 1), the best two of each ticked; over 2 asks something new
    expect(change.drafts.map((d) => [d.over, d.market, d.selected, d.window])).toEqual([
      [1, 'over_runs_at_least', true, 120], [1, 'boundary_in_over', true, 120], [1, 'dots_at_least', false, 120], [1, 'wicket_in_over', false, 120],
      [2, 'over_runs_at_least', true, 150], [2, 'dots_at_least', true, 150], [2, 'wicket_in_over', false, 150], [2, 'boundary_in_over', false, 150],
    ]);
    // No Gemini key: nothing to word
    expect(result.ok && result.background).toBeUndefined();
    expect(logQuizAction).toHaveBeenCalledWith({
      quizId: 'quiz1', quizTitle: 'Lahore vs Karachi', action: 'match_innings_started', adminEmail: 'boss@example.test',
      details: { matchId: 'm1', event: start },
    });
    // The match is read again after the change
    expect(db.callsTo('LiveMatch')).toHaveLength(2);
  });

  it("in Auto, sends over 1's best questions at once (skipping the rest of its quiz) and sets over 2's for ball 1", async () => {
    setMatch({ row: { status: 'setup', autoSend: true }, innings: [] });
    ok();
    await applyMatchEvent('m1', 3, start, 'boss@example.test');
    const change = saved();
    expect(change.release).toEqual([
      { id: 'id1', text: 'Lahore: will over 1 go for 9 or more runs?', textRomanUrdu: 'Lahore: kya over 1 mein 9 ya us se zyada runs banenge?', market: 'over_runs_at_least', params: { line: 9 }, options: '["Yes","No"]', innings: 1, over: 1, closesInSeconds: 120 },
      { id: 'id2', text: 'Will there be a four or a six in over 1?', textRomanUrdu: 'Kya over 1 mein chauka ya chhakka lagega?', market: 'boundary_in_over', params: {}, options: '["Yes","No"]', innings: 1, over: 1, closesInSeconds: 120 },
    ]);
    expect(change.drafts.map((d) => [d.id, d.over, d.skipped ?? false, d.pushOn ?? null, d.pushBy ?? null])).toEqual([
      ['id3', 1, true, 1, 'auto'], ['id4', 1, true, 1, 'auto'],
      ['id5', 2, false, 1, 'auto'], ['id6', 2, false, 1, 'auto'], ['id7', 2, false, 1, 'auto'], ['id8', 2, false, 1, 'auto'],
    ]);
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'match_questions_sent', details: { matchId: 'm1', over: 1, ball: 1, by: 'auto', questions: ['id1', 'id2'] },
    }));
  });

  it("sends a quiz set to a ball when the scorer records that ball: the admin's wording, else Gemini's, else the built-in one", async () => {
    const queued = [
      // Set before pushBy was kept: the admin's
      draft({ pushOn: 2, edit: { text: 'Lahore: 10 or more in over 2?', textRomanUrdu: 'Over 2 mein 10 ya zyada?', line: 10 } }),
      { ...wicketDraft, pushOn: 2, pushBy: 'admin' },
      { ...dotsDraft, pushOn: 2, pushBy: 'admin' },
      draft({ id: 'plain', market: 'boundary_in_over', params: {}, text: 'Will there be a four or a six in over 2?', textRomanUrdu: 'Kya over 2 mein chauka ya chhakka lagega?', pushOn: 2, pushBy: 'admin' }),
    ];
    const wordings = { d2: { text: 'A wicket in over 2?', textRomanUrdu: 'Over 2 mein wicket?' }, plain: { failed: true } };
    setMatch({ row: { drafts: queued, wordings }, balls: [ball(1)] });
    ok();
    // Over 1 has one legal ball: nothing is due before the second
    await applyMatchEvent('m1', 3, { type: 'close_answers' }, 'a');
    expect(saved(0).release).toEqual([]);
    await applyMatchEvent('m1', 3, { type: 'ball', runs: 0, extra: 'none', wicket: false }, 'a');
    expect(saved(1).release).toEqual([
      { id: 'd1', text: 'Lahore: 10 or more in over 2?', textRomanUrdu: 'Over 2 mein 10 ya zyada?', market: 'over_runs_at_least', params: { line: 10 }, ...OUT },
      { id: 'd2', text: 'A wicket in over 2?', textRomanUrdu: 'Over 2 mein wicket?', market: 'wicket_in_over', params: {}, ...OUT },
      { id: 'plain', text: 'Will there be a four or a six in over 2?', textRomanUrdu: 'Kya over 2 mein chauka ya chhakka lagega?', market: 'boundary_in_over', params: {}, ...OUT },
    ]);
    // The unticked question is skipped: one quiz an over
    expect(saved(1).drafts).toEqual([{ ...dotsDraft, pushOn: 2, pushBy: 'admin', skipped: true }]);
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'match_questions_sent', details: { matchId: 'm1', over: 2, ball: 2, by: 'admin', questions: ['d1', 'd2', 'plain'] },
    }));
  });

  it('has Gemini word the new quizzes after the response, as much as the AI level allows', async () => {
    vi.stubEnv('MATCH_GEMINI_API_KEY', 'k');
    setMatch({ row: { status: 'setup', aiLevel: 'half' }, innings: [] });
    ok();
    const result = await applyMatchEvent('m1', 3, start, 'a');
    // Half: odd overs only
    expect(saved().drafts.map((d) => [d.over, d.aiAsked])).toEqual([[1, true], [1, true], [1, true], [1, true], [2, false], [2, false], [2, false], [2, false]]);
    expect(result.ok && typeof result.background).toBe('function');
    // After the response: the match as saved, worded
    setMatch({ row: { drafts: saved().drafts } });
    db.setRpc('update_match_extras', { data: { success: true } });
    aiWording.mockResolvedValue([{ text: 'Over 1 for 9 or more runs, Lahore?', textRomanUrdu: 'Lahore, over 1 mein 9 ya zyada?' }, null, null, null]);
    await (result as { background: () => Promise<void> }).background();
    expect(aiWording).toHaveBeenCalledTimes(1);
    expect(aiWording.mock.calls[0][0]).toMatchObject({ teams: ['Lahore', 'Karachi'], over: 1, situation: { battingTeam: 'Lahore', afterOvers: 0, runs: 0 } });
    expect(db.rpcCalls.at(-1)).toEqual({
      fn: 'update_match_extras',
      args: {
        p_match_id: 'm1',
        p_change: { wordings: {
          id1: { text: 'Over 1 for 9 or more runs, Lahore?', textRomanUrdu: 'Lahore, over 1 mein 9 ya zyada?' },
          id2: { failed: true }, id3: { failed: true }, id4: { failed: true },
        } },
      },
    });
  });

  it('rebuilds a waiting quiz from the corrected score, keeping its ticks and ball; Gemini words it again only once', async () => {
    vi.stubEnv('MATCH_GEMINI_API_KEY', 'k');
    // Over 1 bowled (six singles), over 3's quiz prepared from it, set to go out on ball 3 of over 2
    const row = { oversPerInnings: 20 };
    const balls = [1, 2, 3, 4, 5, 6].map((n) => ball(n));
    const situation = matchSituation({ balls: balls as never, innings: 1, battingTeam: 'Lahore', oversPerInnings: 20, target: null, afterOvers: 1 });
    const fresh = overCandidates(situation, 3).map((q, rank) => draft({
      id: `o3-${rank}`, over: 3, market: q.market, params: q.params, text: q.text, textRomanUrdu: q.textRomanUrdu, body: q.body, lead: q.lead,
      rank, selected: q.market === 'wicket_in_over', pushOn: 3, pushBy: 'admin',
    }));
    setMatch({ row: { ...row, drafts: fresh }, balls });
    ok();
    // A ball of over 2 changes nothing about it
    await applyMatchEvent('m1', 3, { type: 'ball', runs: 4, extra: 'none', wicket: false }, 'a');
    expect(saved(0).drafts).toBeUndefined();
    // The first ball was a four, not a single: Lahore 9/0 after 1 overs
    await applyMatchEvent('m1', 3, { type: 'correct_ball', ballId: 'b1', runs: 4, extra: 'none', wicket: false }, 'a');
    const rebuilt = saved(1).drafts;
    expect(rebuilt.map((d) => [d.market, d.selected, d.pushOn, d.pushBy, d.rebuilt, d.aiAsked])).toEqual(
      overCandidates({ ...situation, runs: 9 }, 3).map((q) => [q.market, q.market === 'wicket_in_over', 3, 'admin', 1, true]),
    );
    expect(rebuilt[0]).toMatchObject({ id: expect.stringMatching(/^id/), text: expect.stringContaining('Lahore 9/0 after 1 overs') });
    // Corrected again: rebuilt, but Gemini isn't asked a second time
    setMatch({ row: { ...row, drafts: rebuilt }, balls });
    await applyMatchEvent('m1', 3, { type: 'correct_ball', ballId: 'b2', runs: 6, extra: 'none', wicket: false }, 'a');
    expect(saved(2).drafts.map((d) => [d.rebuilt, d.aiAsked])).toEqual(rebuilt.map(() => [2, false]));
    // A quiz not set to a ball stays that way
    setMatch({ row: { ...row, drafts: fresh.map((d) => ({ ...d, pushOn: undefined, pushBy: undefined })) }, balls });
    await applyMatchEvent('m1', 3, { type: 'correct_ball', ballId: 'b3', runs: 4, extra: 'none', wicket: false }, 'a');
    expect(saved(3).drafts.every((d) => !('pushOn' in d) && !('pushBy' in d))).toBe(true);
  });

  it("asks over 3 something other than what over 2's quiz sent", async () => {
    // Over 1's 5th ball bowled; over 2's quiz went out with runs and boundary questions
    setMatch({
      row: { oversPerInnings: 20 }, balls: [1, 2, 3, 4, 5].map((n) => ball(n)),
      questions: [question({ id: 's1', matchOver: 2 }), question({ id: 's2', matchOver: 2, market: 'boundary_in_over', marketParams: {} })],
    });
    ok();
    await applyMatchEvent('m1', 3, { type: 'ball', runs: 1, extra: 'none', wicket: false }, 'a');
    // The powerplay favours boundaries, but over 2 asked one: dot balls instead
    expect(saved().drafts.map((d) => [d.over, d.market, d.selected])).toEqual([
      [3, 'over_runs_at_least', true], [3, 'dots_at_least', true], [3, 'boundary_in_over', false], [3, 'wicket_in_over', false],
    ]);
  });

  it("takes a removed innings' drafts with it, and leaves the drafts alone when nothing changes them", async () => {
    setMatch({
      row: { status: 'live', drafts: [draft({ id: 'keep', skipped: true }), draft({ id: 'gone', innings: 2 })] },
      innings: [{ innings: 1, battingTeam: 'Lahore', endReason: 'admin' }, { innings: 2, battingTeam: 'Lahore', endReason: null }],
    });
    ok();
    await applyMatchEvent('m1', 3, { type: 'remove_innings' }, 'a');
    expect(saved(0).drafts.map((d) => d.id)).toEqual(['keep']);

    // Over 2's quiz is already waiting, and its facts haven't changed
    setMatch({ row: { drafts: QUIZ }, balls: [ball(1)] });
    await applyMatchEvent('m1', 3, { type: 'close_answers' }, 'a');
    expect(saved(1).drafts).toBeUndefined();
  });

  it('sends a correction to the database, and logs it on the quiz', async () => {
    setMatch({ balls: [ball(1), ball(2)] });
    ok();
    const event = { type: 'correct_ball' as const, ballId: 'b1', runs: 4, extra: 'none' as const, wicket: false };
    expect((await applyMatchEvent('m1', 3, event, 'boss@example.test')).ok).toBe(true);
    expect(saved().replaceBall).toEqual({ id: 'id1', replaces: 'b1', innings: 1, seq: 1, runs: 4, extra: 'none', extraRuns: 0, wicket: false });
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_ball_corrected', details: { matchId: 'm1', event } }));
  });

  it("records a ball with the engine's id and number, and doesn't log it", async () => {
    setMatch({ balls: [ball(1)], row: { drafts: QUIZ } });
    ok();
    await applyMatchEvent('m1', 3, { type: 'ball', runs: 4, extra: 'none', wicket: false }, 'boss@example.test');
    expect(saved().ball).toEqual({ id: 'id1', innings: 1, seq: 2, runs: 4, extra: 'none', extraRuns: 0, wicket: false });
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
    setMatch({ row: { drafts: QUIZ } });
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

describe('wordDrafts', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    db.setRpc('update_match_extras', { data: { success: true } });
  });
  const saves = () => db.rpcCalls.filter((c) => c.fn === 'update_match_extras');

  it("words each quiz with the match situation it was built from, and keeps only what's still waiting", async () => {
    setMatch({ row: { drafts: [...QUIZ, draft({ id: 'skipped', skipped: true })] } });
    aiWording.mockResolvedValue([null, { text: 'A wicket in over 2?', textRomanUrdu: 'Over 2 mein wicket?' }]);
    await wordDrafts('m1', ['d1', 'd2', 'skipped', 'gone']);
    expect(aiWording).toHaveBeenCalledTimes(1);
    const [ctx, questions] = aiWording.mock.calls[0];
    expect(ctx).toMatchObject({ teams: ['Lahore', 'Karachi'], over: 2, situation: { afterOvers: 0 } });
    expect(questions).toEqual([
      { market: 'over_runs_at_least', params: { line: 9 }, options: ['Yes', 'No'], text: draft().text, textRomanUrdu: draft().textRomanUrdu, body: draft().body, lead: null, score: 0 },
      expect.objectContaining({ market: 'wicket_in_over' }),
    ]);
    expect(saves()[0].args).toEqual({ p_match_id: 'm1', p_change: { wordings: { d1: { failed: true }, d2: { text: 'A wicket in over 2?', textRomanUrdu: 'Over 2 mein wicket?' } } } });
  });

  it('words nothing for a match gone, a quiz too late or gone, and never throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.setTable('LiveMatch', { data: null });
    await wordDrafts('nope', ['d1']);
    // Over 1 has had its 5th legal ball: over 2's quiz can't go out any more
    setMatch({ row: { drafts: QUIZ }, balls: [1, 2, 3, 4, 5].map((n) => ball(n)) });
    await wordDrafts('m1', ['d1']);
    setMatch({ row: { drafts: QUIZ } });
    await wordDrafts('m1', ['gone']);
    expect(aiWording).not.toHaveBeenCalled();
    expect(saves()).toEqual([]);

    db.setRpc('update_match_extras', { data: { success: false, error: 'Match not found' } });
    await wordDrafts('m1', ['d1']);
    expect(error).toHaveBeenCalledWith("[matches] Saving Gemini's wording was refused:", 'Match not found');
    db.setRpc('update_match_extras', { error: { message: 'down' } });
    await wordDrafts('m1', ['d1']);
    expect(error).toHaveBeenCalledWith('[matches] Wording a quiz failed:', { message: 'down' });
  });
});

describe('quizzes: send now, set a ball, skip', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
  });
  const change = (i = 0) => db.rpcCalls[i].args.p_change as Record<string, unknown>;
  const as = (d: { id: string; text: string; textRomanUrdu: string }, over: Record<string, unknown> = {}) => ({ id: d.id, text: d.text, textRomanUrdu: d.textRomanUrdu, ...over });

  it('sends a quiz now, as the admin worded it with a new line; the rest of the quiz is skipped', async () => {
    setMatch({ row: { drafts: QUIZ, wordings: { d2: { text: 'A wicket in over 2?', textRomanUrdu: 'Over 2 mein wicket?' } } } });
    const result = await sendDrafts('m1', [
      { id: 'd1', text: ' Will Lahore get 10 or more in over 2? ', textRomanUrdu: 'Kya Lahore over 2 mein 10 ya zyada banayega?', line: 10 },
      { id: 'd2', text: 'A wicket in over 2?', textRomanUrdu: 'Over 2 mein wicket?' },
    ], 'boss@example.test');
    expect(result.ok).toBe(true);
    expect(db.rpcCalls[0].args.p_version).toBe(3);
    expect(change()).toEqual({
      release: [
        { id: 'd1', text: 'Will Lahore get 10 or more in over 2?', textRomanUrdu: 'Kya Lahore over 2 mein 10 ya zyada banayega?', market: 'over_runs_at_least', params: { line: 10 }, ...OUT },
        { id: 'd2', text: 'A wicket in over 2?', textRomanUrdu: 'Over 2 mein wicket?', market: 'wicket_in_over', params: {}, ...OUT },
      ],
      drafts: [{ ...dotsDraft, skipped: true }],
      admin: 'boss@example.test',
    });
    // Gemini's wording sent as it was isn't an edit
    expect(logQuizAction).toHaveBeenCalledWith({
      quizId: 'quiz1', quizTitle: 'Lahore vs Karachi', action: 'match_questions_sent', adminEmail: 'boss@example.test',
      details: { matchId: 'm1', questions: ['d1', 'd2'], edited: ['d1'] },
    });
  });

  it("refuses a question gone, from another over, too late, or worded so it wouldn't settle right, sending nothing", async () => {
    setMatch({ row: { drafts: [...QUIZ, draft({ id: 'skipped', skipped: true }), draft({ id: 'o3', over: 3, text: 'Lahore: will over 3 go for 9 or more runs?', textRomanUrdu: 'Lahore: over 3 mein 9 ya zyada?' })] } });
    const send = (over: Record<string, unknown>) => sendDrafts('m1', [as(draft(), over)], 'a');
    expect(await send({ id: 'nope' })).toEqual({ ok: false, status: 409, code: 'gone', error: 'That question was already sent or skipped' });
    expect(await send({ id: 'skipped' })).toMatchObject({ status: 409, code: 'gone' });
    expect(await sendDrafts('m1', [as(draft()), as(draft(), { id: 'o3', text: 'Lahore: will over 3 go for 9 or more runs?', textRomanUrdu: 'Lahore: over 3 mein 9 ya zyada?' })], 'a'))
      .toEqual({ ok: false, status: 400, code: 'invalid', error: "A quiz's questions must all be about the same over" });
    expect(await send({ text: 'Will over 2 go for 12 or more runs?' })).toEqual({
      ok: false, status: 400, code: 'wording', error: 'The English wording must keep the line (9): change the line with its number box',
    });
    expect(await sendDrafts('m1', [as(wicketDraft, { line: 4 })], 'a')).toEqual({ ok: false, status: 400, code: 'invalid', error: 'This question has no line to change' });
    // Over 1 has had its 5th legal ball
    setMatch({ row: { drafts: QUIZ }, balls: [1, 2, 3, 4, 5].map((n) => ball(n)) });
    expect(await send({})).toEqual({ ok: false, status: 409, code: 'too_late', error: "Too late: over 2 is about to start, so its quiz can't go out any more" });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('sets a quiz to go out on a ball with the questions and wording the admin chose, or sends it now if that ball is reached', async () => {
    const other = draft({ id: 'o3', over: 3 });
    setMatch({ row: { drafts: [...QUIZ, other] } });
    expect((await queueQuiz('m1', 3, [as(draft(), { text: 'Lahore: 10 or more in over 2?', textRomanUrdu: 'Over 2 mein 10 ya zyada?', line: 10 }), as(dotsDraft, { line: 3 })], 'boss@example.test')).ok).toBe(true);
    expect(change()).toEqual({
      release: [],
      drafts: [
        { ...draft(), pushOn: 3, pushBy: 'admin', selected: true, edit: { text: 'Lahore: 10 or more in over 2?', textRomanUrdu: 'Over 2 mein 10 ya zyada?', line: 10 } },
        { ...wicketDraft, pushOn: 3, pushBy: 'admin', selected: false },
        { ...dotsDraft, pushOn: 3, pushBy: 'admin', selected: true, edit: { text: dotsDraft.text, textRomanUrdu: dotsDraft.textRomanUrdu } },
        // Another over's quiz is left as it is
        other,
      ],
      admin: 'boss@example.test',
    });
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_quiz_queued', details: { matchId: 'm1', over: 2, ball: 3, questions: ['d1', 'd3'] } }));

    // Set again, from a quiz that was set before: the old wording goes; over 1 is on its 3rd ball, so it goes now
    setMatch({ row: { drafts: (change().drafts as unknown[]).slice(0, 3) }, balls: [1, 2, 3].map((n) => ball(n)) });
    await queueQuiz('m1', 2, [as(wicketDraft)], 'a');
    expect(change(1)).toMatchObject({
      release: [{ id: 'd2', text: wicketDraft.text, market: 'wicket_in_over', ...OUT }],
      drafts: [expect.objectContaining({ id: 'd1', skipped: true, selected: false }), expect.objectContaining({ id: 'd3', skipped: true })],
    });
    expect((change(1).drafts as Array<Record<string, unknown>>)[0]).not.toHaveProperty('edit');
    expect(logQuizAction).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'match_questions_sent', details: { matchId: 'm1', over: 2, ball: 2, questions: ['d2'] } }));

    expect(await queueQuiz('m1', 5, [as(draft())], 'a')).toEqual({ ok: false, status: 400, code: 'invalid', error: 'Pick ball 1, 2, 3 or 4' });
    expect(await queueQuiz('m1', 1, [as(draft(), { id: 'nope' })], 'a')).toMatchObject({ code: 'gone' });
  });

  it('takes a quiz off its ball, and says when it is not on one', async () => {
    const other = draft({ id: 'o3', over: 3, pushOn: 1, pushBy: 'admin' });
    setMatch({ row: { drafts: [...QUIZ.map((d) => ({ ...d, pushOn: 2, pushBy: 'admin' })), other] } });
    expect((await unqueueQuiz('m1', { innings: 1, over: 2 }, 'boss@example.test')).ok).toBe(true);
    expect(change()).toEqual({ drafts: [...QUIZ, other], admin: 'boss@example.test' });
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_quiz_unqueued', details: { matchId: 'm1', over: 2 } }));
    setMatch({ row: { drafts: [...QUIZ, draft({ id: 'other', over: 3, pushOn: 1 })] } });
    expect(await unqueueQuiz('m1', { innings: 1, over: 2 }, 'a')).toEqual({ ok: false, status: 409, code: 'gone', error: "Over 2's quiz isn't set to go out on a ball any more" });
  });

  it('works the change out again when a ball beat it to the match, three times at most', async () => {
    setMatch({ row: { drafts: QUIZ } });
    let calls = 0;
    db.setRpc('apply_match_change', () => (++calls === 1 ? { data: { success: false, code: 'stale' } } : { data: { success: true, version: 5 } }));
    expect((await skipDrafts('m1', ['d1'], 'a')).ok).toBe(true);
    expect(db.rpcCalls).toHaveLength(2);

    db.setRpc('apply_match_change', { data: { success: false, code: 'stale' } });
    expect(await skipDrafts('m1', ['d1'], 'a')).toEqual({ ok: false, status: 409, code: 'stale', error: 'The match kept changing while this was saved: try again' });
    expect(db.rpcCalls).toHaveLength(5);
  });

  it("passes on the database's other refusals, an unknown or settled match", async () => {
    setMatch({ row: { drafts: QUIZ } });
    db.setRpc('apply_match_change', { data: { success: false, code: 'invalid', error: "A match's drafts must be a JSON list" } });
    expect(await skipDrafts('m1', ['d1'], 'a')).toEqual({ ok: false, status: 400, code: 'invalid', error: "A match's drafts must be a JSON list" });
    db.setTable('LiveMatch', { data: null });
    expect(await setAutoSend('nope', true, 'a')).toEqual({ ok: false, status: 404, code: 'not_found', error: 'Match not found' });
    setMatch({ settled: 1 });
    expect(await setAutoSend('m1', true, 'a')).toMatchObject({ ok: false, status: 409, code: 'settled' });
  });

  it('skips a quiz: its over gets no questions, and its drafts stay so it never gets new ones', async () => {
    setMatch({ row: { drafts: QUIZ } });
    expect((await skipDrafts('m1', ['d1', 'd2', 'd3'], 'boss@example.test')).ok).toBe(true);
    expect(change()).toEqual({ drafts: QUIZ.map((d) => ({ ...d, skipped: true })), admin: 'boss@example.test' });
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_questions_skipped', details: { matchId: 'm1', questions: ['d1', 'd2', 'd3'] } }));
    setMatch({ row: { drafts: [{ ...wicketDraft, skipped: true }] } });
    expect(await skipDrafts('m1', ['d2'], 'a')).toMatchObject({ status: 409, code: 'gone' });
  });

  it("switches to Auto: waiting quizzes go out on ball 1 with their best questions (now, once it is bowled); Manual takes Auto's off again", async () => {
    const mine = draft({ id: 'mine', over: 3, pushOn: 4, pushBy: 'admin' });
    setMatch({ row: { drafts: [draft({ selected: false }), wicketDraft, dotsDraft, mine, draft({ id: 'old', skipped: true })] } });
    expect((await setAutoSend('m1', true, 'boss@example.test')).ok).toBe(true);
    expect(change()).toEqual({
      autoSend: true, release: [], admin: 'boss@example.test',
      drafts: [
        { ...draft(), pushOn: 1, pushBy: 'auto', selected: true },
        { ...wicketDraft, pushOn: 1, pushBy: 'auto', selected: true },
        { ...dotsDraft, pushOn: 1, pushBy: 'auto', selected: false },
        mine, draft({ id: 'old', skipped: true }),
      ],
    });
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_auto_send_changed', details: { matchId: 'm1', autoSend: true } }));

    // Over 1 is being bowled: over 2's quiz goes now
    setMatch({ row: { drafts: QUIZ }, balls: [ball(1)] });
    await setAutoSend('m1', true, 'a');
    expect(change(1)).toMatchObject({ release: [{ id: 'd1' }, { id: 'd2' }], drafts: [{ id: 'd3', skipped: true }] });

    setMatch({ row: { autoSend: true, drafts: (change(0).drafts as unknown[]) } });
    await setAutoSend('m1', false, 'a');
    expect(change(2)).toEqual({ autoSend: false, release: [], admin: 'a', drafts: [draft(), wicketDraft, { ...dotsDraft, selected: false }, mine, draft({ id: 'old', skipped: true })] });
  });

  it('sets the language and the AI level without changing the version, logged with the old and new', async () => {
    setMatch();
    db.setRpc('update_match_extras', { data: { success: true } });
    expect((await setLanguage('m1', 'ur', 'boss@example.test')).ok).toBe(true);
    expect((await setAiLevel('m1', 'half', 'boss@example.test')).ok).toBe(true);
    expect(db.rpcCalls).toEqual([
      { fn: 'update_match_extras', args: { p_match_id: 'm1', p_change: { language: 'ur' } } },
      { fn: 'update_match_extras', args: { p_match_id: 'm1', p_change: { aiLevel: 'half' } } },
    ]);
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_language_changed', details: { matchId: 'm1', from: 'both', to: 'ur' } }));
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_ai_level_changed', details: { matchId: 'm1', from: 'full', to: 'half' } }));

    db.setRpc('update_match_extras', { data: { success: false, code: 'invalid', error: 'The language must be both, en or ur' } });
    expect(await setLanguage('m1', 'fr' as never, 'a')).toEqual({ ok: false, status: 400, code: 'invalid', error: 'The language must be both, en or ur' });
    db.setRpc('update_match_extras', { error: { message: 'down' } });
    await expect(setAiLevel('m1', 'off', 'a')).rejects.toEqual({ message: 'down' });
    db.setTable('LiveMatch', { data: null });
    expect(await setLanguage('nope', 'en', 'a')).toMatchObject({ ok: false, status: 404 });
    setMatch({ settled: 1 });
    expect(await setAiLevel('m1', 'off', 'a')).toMatchObject({ ok: false, status: 409, code: 'settled' });
  });
});

describe('matchView: quizzes', () => {
  it('shows each waiting quiz: when it goes out, its questions in the wording that would go, and how they were worded', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    setMatch({
      row: {
        language: 'ur', aiLevel: 'half',
        drafts: [
          ...QUIZ.map((d) => ({ ...d, aiAsked: true, pushOn: 3 })),
          draft({ id: 'o3', over: 3, aiAsked: true, preparedAt: new Date(NOW - 5_000).toISOString(), rebuilt: 1, edit: { text: 'Edited over 3?', textRomanUrdu: 'Over 3?', line: 11 } }),
          draft({ id: 'o3b', over: 3, aiAsked: true, preparedAt: new Date(NOW - 5_000).toISOString() }),
          draft({ id: 'old', over: 1, skipped: true }),
        ],
        wordings: { d2: { text: 'A wicket in over 2?', textRomanUrdu: 'Over 2 mein wicket?' }, d1: { failed: true }, d3: { failed: true } },
      },
      balls: [ball(1), ball(2, { extra: 'wide', extraRuns: 1, runs: 0 })],
    });
    const view = matchView((await loadMatch('m1', NOW))!, NOW);
    expect(view.match).toMatchObject({ language: 'ur', aiLevel: 'half' });
    expect(view.wording.plan).toMatchObject({ chosen: 'half' });
    expect(view.lapsed).toEqual([]);
    expect(view.quizzes).toHaveLength(2);
    expect(view.quizzes[0]).toEqual({
      innings: 1, over: 2, during: 1, ballsBowled: 1, started: true, pushOn: 3, pushBy: 'admin', wording: 'ai', rebuilt: false,
      questions: [
        { id: 'd1', market: 'over_runs_at_least', options: ['Yes', 'No'], line: 9, text: draft().text, textRomanUrdu: draft().textRomanUrdu, source: 'built_in',
          builtIn: { text: draft().text, textRomanUrdu: draft().textRomanUrdu, line: 9 }, best: true, selected: true },
        { id: 'd2', market: 'wicket_in_over', options: ['Yes', 'No'], line: null, text: 'A wicket in over 2?', textRomanUrdu: 'Over 2 mein wicket?', source: 'ai',
          builtIn: { text: wicketDraft.text, textRomanUrdu: wicketDraft.textRomanUrdu, line: null }, best: true, selected: true },
        expect.objectContaining({ id: 'd3', source: 'built_in', best: false, selected: false }),
      ],
    });
    // Over 3's: Gemini still working on one of them, the admin's wording on the other
    expect(view.quizzes[1]).toMatchObject({ over: 3, during: 2, ballsBowled: 0, started: false, pushOn: null, pushBy: null, wording: 'pending', rebuilt: true });
    expect(view.quizzes[1].questions[0]).toMatchObject({ text: 'Edited over 3?', textRomanUrdu: 'Over 3?', line: 11, source: 'edit' });

    // Twenty seconds on, Gemini has given up; over 1 has had 5 legal balls, so over 2's quiz is too late
    setMatch({ row: { drafts: [draft({ aiAsked: true, preparedAt: new Date(NOW - 20_000).toISOString() }), draft({ id: 'first', over: 1 })] }, balls: [1, 2, 3, 4, 5].map((n) => ball(n)) });
    const later = matchView((await loadMatch('m1', NOW))!, NOW);
    expect(later.quizzes).toEqual([]);
    expect(later.lapsed).toEqual([{ innings: 1, over: 2 }, { innings: 1, over: 1 }]);
    setMatch({ row: { drafts: [draft({ aiAsked: true, preparedAt: new Date(NOW - 20_000).toISOString() })] } });
    expect(matchView((await loadMatch('m1', NOW))!, NOW).quizzes[0]).toMatchObject({ wording: 'built_in', during: 1, ballsBowled: 0, started: false });
    // Over 1's quiz goes out before the first ball
    setMatch({ row: { drafts: [draft({ over: 1, text: 'Lahore: will over 1 go for 9 or more runs?' })] } });
    expect(matchView((await loadMatch('m1', NOW))!, NOW).quizzes[0]).toMatchObject({ over: 1, during: null, ballsBowled: null, started: false });
    // The engine knows these overs have their quizzes
    expect((await loadMatch('m1', NOW))!.state.draftSlots).toEqual([{ innings: 1, over: 1 }]);
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

describe('who can play: Go live and the player limit', () => {
  const draftQuiz = { title: 'Lahore vs Karachi', status: 'draft' };
  const liveQuiz = { title: 'Lahore vs Karachi', status: 'active' };

  it('reads whether players can see the match, and how many have joined out of how many may', async () => {
    setMatch({ quiz: liveQuiz });
    db.setTable('QuizAdminSettings', { data: { maxEntries: 500 } });
    db.setTable('QuizEntryCount', { data: { entries: 12 } });
    const loaded = (await loadMatch('m1', NOW, true))!;
    expect(loaded).toMatchObject({ published: true, players: { entries: 12, maxEntries: 500 } });
    expect(matchView(loaded, NOW).players).toEqual({ entries: 12, maxEntries: 500 });
    expect(eqValue(db.callsTo('QuizAdminSettings')[0], 'quizId')).toBe('quiz1');
    expect(eqValue(db.callsTo('QuizEntryCount')[0], 'quizId')).toBe('quiz1');
    // Nothing saved yet: nobody joined, 2,000 may
    db.setTable('QuizAdminSettings', { data: null });
    db.setTable('QuizEntryCount', { data: null });
    expect((await loadMatch('m1', NOW, true))!.players).toEqual({ entries: 0, maxEntries: 2000 });
    db.setTable('QuizEntryCount', { error: { message: 'count down' } });
    await expect(loadMatch('m1', NOW, true)).rejects.toEqual({ message: 'count down' });
  });

  it('takes the match live: its quiz goes from draft to active, logged, without a pushedAt', async () => {
    setMatch({ quiz: draftQuiz });
    db.setTable('LiveMatch', [
      { data: { ...ROW, Quiz: draftQuiz } },
      { data: { ...ROW, Quiz: liveQuiz } },
    ]);
    db.setTable('Quiz', { data: [{ id: 'quiz1' }] });
    db.setTable('AdminActionLog', { data: [] });
    const result = await setPublished('m1', true, 'boss@example.test');
    // Its first Go live: players are told
    expect(result).toMatchObject({ ok: true, data: { changed: true, announce: true, view: { match: { published: true }, players: { maxEntries: 2000 } } } });
    const earlier = db.callsTo('AdminActionLog')[0];
    expect(eqValue(earlier, 'quizId')).toBe('quiz1');
    expect(eqValue(earlier, 'action')).toBe('match_published');
    const update = db.callsTo('Quiz')[0];
    expect(update.ops.find((o) => o.op === 'update')?.args[0]).toEqual({ status: 'active', updatedAt: expect.any(String) });
    expect(eqValue(update, 'id')).toBe('quiz1');
    // Only from a draft: a quiz changed meanwhile isn't touched
    expect(eqValue(update, 'status')).toBe('draft');
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ quizId: 'quiz1', action: 'match_published', adminEmail: 'boss@example.test', details: { matchId: 'm1' } }));
  });

  it('takes it live again without telling anyone a second time', async () => {
    setMatch({ quiz: draftQuiz });
    db.setTable('Quiz', { data: [{ id: 'quiz1' }] });
    db.setTable('AdminActionLog', { data: [{ id: 'log1' }] });
    expect(await setPublished('m1', true, 'a')).toMatchObject({ ok: true, data: { changed: true, announce: false } });
    // Unreadable history: told as if new
    db.setTable('AdminActionLog', { data: null });
    expect(await setPublished('m1', true, 'a')).toMatchObject({ ok: true, data: { announce: true } });
  });

  it('hides it again, and changes nothing when it already is that way', async () => {
    setMatch({ quiz: liveQuiz });
    db.setTable('Quiz', { data: [{ id: 'quiz1' }] });
    expect(await setPublished('m1', true, 'a')).toMatchObject({ ok: true, data: { changed: false, announce: false } });
    expect(db.callsTo('Quiz')).toHaveLength(0);
    expect(await setPublished('m1', false, 'a')).toMatchObject({ ok: true, data: { changed: true, announce: false } });
    expect(db.callsTo('AdminActionLog')).toHaveLength(0);
    const update = db.callsTo('Quiz')[0];
    expect(update.ops.find((o) => o.op === 'update')?.args[0]).toMatchObject({ status: 'draft' });
    expect(eqValue(update, 'status')).toBe('active');
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_hidden' }));
  });

  it('refuses for an unknown, settled or abandoned match, or one changed meanwhile, and throws a failed update', async () => {
    expect(await setPublished('nope', true, 'a')).toMatchObject({ ok: false, status: 404 });
    setMatch({ quiz: draftQuiz, settled: 1 });
    expect(await setPublished('m1', true, 'a')).toMatchObject({ ok: false, status: 409, code: 'settled' });
    setMatch({ quiz: draftQuiz, row: { status: 'abandoned' } });
    expect(await setPublished('m1', true, 'a')).toEqual({ ok: false, status: 409, code: 'abandoned', error: 'Restore the match before taking it live' });
    // Hiding an abandoned match is fine
    setMatch({ quiz: liveQuiz, row: { status: 'abandoned' } });
    db.setTable('Quiz', { data: [] });
    expect(await setPublished('m1', false, 'a')).toMatchObject({ ok: false, status: 409, code: 'stale' });
    db.setTable('Quiz', { data: null });
    expect(await setPublished('m1', false, 'a')).toMatchObject({ ok: false, code: 'stale' });
    db.setTable('Quiz', { error: { message: 'down' } });
    await expect(setPublished('m1', false, 'a')).rejects.toEqual({ message: 'down' });
    expect(logQuizAction).not.toHaveBeenCalled();
  });

  it('sets how many players may join, logged with the old and new limit', async () => {
    setMatch();
    db.setTable('QuizAdminSettings', { data: { maxEntries: 2000 } });
    expect(await setMaxEntries('m1', 5000, 'boss@example.test')).toMatchObject({ ok: true, data: { players: { maxEntries: 2000 } } });
    const upsert = db.callsTo('QuizAdminSettings').find((c) => c.ops.some((o) => o.op === 'upsert'))!;
    expect(upsert.ops.find((o) => o.op === 'upsert')?.args).toEqual([{ quizId: 'quiz1', maxEntries: 5000, updatedAt: expect.any(String) }, { onConflict: 'quizId' }]);
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_entry_limit_changed', details: { matchId: 'm1', from: 2000, to: 5000 } }));

    db.setTable('LiveMatch', { data: null });
    expect(await setMaxEntries('nope', 1, 'a')).toMatchObject({ ok: false, status: 404 });
    setMatch({ settled: 1 });
    expect(await setMaxEntries('m1', 1, 'a')).toMatchObject({ ok: false, code: 'settled' });
    setMatch();
    db.setTable('QuizAdminSettings', (call) => (call.ops.some((o) => o.op === 'upsert') ? { error: { message: 'down' } } : { data: null }));
    await expect(setMaxEntries('m1', 1, 'a')).rejects.toEqual({ message: 'down' });
  });

  it('tells every player, with a link to the quiz page where its overs pop up on the stream', async () => {
    expect(MATCH_LINK).toBe('/quizzes');
    await announceMatch('Lahore vs Karachi');
    expect(createBroadcast).toHaveBeenCalledWith({
      title: '🔴 Live match', message: 'Lahore vs Karachi: predict what happens in every over, right on the live stream. Free to play!',
      type: 'quiz_deadline', link: '/quizzes',
    });
    // No search through the notifications: setPublished decides whether to tell
    expect(db.callsTo('Notification')).toHaveLength(0);
  });
});
