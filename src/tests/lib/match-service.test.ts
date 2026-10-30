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
  setPublished, setMaxEntries, announceMatch, MATCH_LINK,
} = await import('@/lib/match-service');

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

/** A draft as "LiveMatch".drafts stores it: over 1's runs question, 100 s before it would close */
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'd1', innings: 1, over: 1, market: 'over_runs_at_least', params: { line: 9 }, options: ['Yes', 'No'],
  text: 'Lahore: will over 1 go for 9 or more runs?', textRomanUrdu: 'Lahore: kya over 1 mein 9 ya us se zyada runs banenge?',
  plainText: 'Lahore: will over 1 go for 9 or more runs?', plainTextRomanUrdu: 'Lahore: kya over 1 mein 9 ya us se zyada runs banenge?',
  ai: false, closesAt: new Date(NOW + 100_000).toISOString(), ...over,
});
const wicketDraft = draft({
  id: 'd2', market: 'wicket_in_over', params: {}, text: 'Will a wicket fall in over 1?', textRomanUrdu: 'Kya over 1 mein koi wicket giray ga?',
  plainText: 'Will a wicket fall in over 1?', plainTextRomanUrdu: 'Kya over 1 mein koi wicket giray ga?',
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
    expect(view.match).toEqual({ ...ROW, createdAt: undefined, title: 'Lahore vs Karachi', published: false });
    // Not asked for
    expect(view.players).toBeNull();
    // How much of Gemini's limits this server used, for the console
    const { wordingUsage } = await import('@/lib/match-wording');
    expect(view.wording).toEqual(wordingUsage(process.env, NOW));
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
  it('writes the questions an over needs as drafts for review, worded by Gemini where it can', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    aiWording.mockResolvedValue([{ text: 'Lahore start: will over 1 go for 9 or more?', textRomanUrdu: 'Lahore ka aaghaz: over 1 mein 9 ya zyada?' }, null]);
    setMatch({ row: { status: 'setup' }, innings: [] });
    db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
    const result = await applyMatchEvent('m1', 3, { type: 'start_innings', battingTeam: 'Lahore' }, 'boss@example.test');
    expect(result.ok).toBe(true);
    const closesAt = new Date(NOW + 120_000).toISOString();
    expect(db.rpcCalls).toEqual([{
      fn: 'apply_match_change',
      args: {
        p_match_id: 'm1',
        p_version: 3,
        p_change: {
          startInnings: { innings: 1, battingTeam: 'Lahore' },
          // Nothing goes out: players see nothing until an admin sends
          release: [],
          drafts: [
            {
              id: 'id1', innings: 1, over: 1, market: 'over_runs_at_least', params: { line: 9 }, options: ['Yes', 'No'],
              text: 'Lahore start: will over 1 go for 9 or more?', textRomanUrdu: 'Lahore ka aaghaz: over 1 mein 9 ya zyada?',
              plainText: 'Lahore: will over 1 go for 9 or more runs?', plainTextRomanUrdu: 'Lahore: kya over 1 mein 9 ya us se zyada runs banenge?',
              ai: true, closesAt,
            },
            {
              id: 'id2', innings: 1, over: 1, market: 'dots_at_least', params: { line: 3 }, options: ['Yes', 'No'],
              text: 'Will over 1 have 3 or more dot balls?', textRomanUrdu: 'Kya over 1 mein 3 ya zyada dot balls hongi?',
              plainText: 'Will over 1 have 3 or more dot balls?', plainTextRomanUrdu: 'Kya over 1 mein 3 ya zyada dot balls hongi?',
              ai: false, closesAt,
            },
          ],
          lock: [], resolve: [], void: [], pending: [], status: 'live', admin: 'boss@example.test',
        },
      },
    }]);
    // Gemini got the match as it stands
    expect(aiWording).toHaveBeenCalledWith(
      { teams: ['Lahore', 'Karachi'], battingTeam: 'Lahore', innings: 1, over: 1, runs: 0, wickets: 0, oversText: '0.0', target: null },
      expect.arrayContaining([expect.objectContaining({ market: 'over_runs_at_least' })]),
    );
    expect(logQuizAction).toHaveBeenCalledWith({
      quizId: 'quiz1', quizTitle: 'Lahore vs Karachi', action: 'match_innings_started', adminEmail: 'boss@example.test',
      details: { matchId: 'm1', event: { type: 'start_innings', battingTeam: 'Lahore' } },
    });
    // The match is read again after the change
    expect(db.callsTo('LiveMatch')).toHaveLength(2);
  });

  it('sends the questions straight out, Roman Urdu with them, when the match sends automatically', async () => {
    setMatch({ row: { status: 'setup', autoSend: true }, innings: [] });
    db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
    await applyMatchEvent('m1', 3, { type: 'start_innings', battingTeam: 'Lahore' }, 'boss@example.test');
    const change = db.rpcCalls[0].args.p_change as Record<string, unknown>;
    expect(change.drafts).toBeUndefined();
    expect(change.release).toEqual([
      {
        id: 'id1', text: 'Lahore: will over 1 go for 9 or more runs?', textRomanUrdu: 'Lahore: kya over 1 mein 9 ya us se zyada runs banenge?',
        options: '["Yes","No"]', market: 'over_runs_at_least', params: { line: 9 }, innings: 1, over: 1, closesInSeconds: 120,
      },
      {
        id: 'id2', text: 'Will over 1 have 3 or more dot balls?', textRomanUrdu: 'Kya over 1 mein 3 ya zyada dot balls hongi?',
        options: '["Yes","No"]', market: 'dots_at_least', params: { line: 3 }, innings: 1, over: 1, closesInSeconds: 120,
      },
    ]);
  });

  it("takes a removed innings' drafts with it, and leaves the drafts alone when nothing changes them", async () => {
    setMatch({
      row: { status: 'live', drafts: [draft({ id: 'keep', skipped: true }), draft({ id: 'gone', innings: 2 })] },
      innings: [{ innings: 1, battingTeam: 'Lahore', endReason: 'admin' }, { innings: 2, battingTeam: 'Lahore', endReason: null }],
    });
    db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
    await applyMatchEvent('m1', 3, { type: 'remove_innings' }, 'a');
    expect((db.rpcCalls[0].args.p_change as { drafts: Array<{ id: string }> }).drafts.map((d) => d.id)).toEqual(['keep']);

    // Over 2's questions are already waiting, so this ball opens nothing new
    setMatch({ row: { drafts: [draft({ over: 2 })] }, balls: [ball(1)] });
    await applyMatchEvent('m1', 3, { type: 'close_answers' }, 'a');
    expect((db.rpcCalls[1].args.p_change as Record<string, unknown>).drafts).toBeUndefined();
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

describe('reviewing questions', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
  });
  const change = (i = 0) => db.rpcCalls[i].args.p_change as Record<string, unknown>;

  it("sends drafts as the admin worded them, with a new line, for the rest of their over's window", async () => {
    setMatch({ row: { drafts: [draft(), wicketDraft] } });
    const result = await sendDrafts('m1', [
      { id: 'd1', text: ' Will Lahore get 10 or more in over 1? ', textRomanUrdu: 'Kya Lahore over 1 mein 10 ya zyada banayega?', line: 10 },
      { id: 'd2', text: wicketDraft.text, textRomanUrdu: wicketDraft.textRomanUrdu },
    ], 'boss@example.test');
    expect(result.ok).toBe(true);
    expect(db.rpcCalls[0].args.p_version).toBe(3);
    expect(change()).toEqual({
      release: [
        {
          id: 'd1', text: 'Will Lahore get 10 or more in over 1?', textRomanUrdu: 'Kya Lahore over 1 mein 10 ya zyada banayega?',
          options: '["Yes","No"]', market: 'over_runs_at_least', params: { line: 10 }, innings: 1, over: 1, closesInSeconds: 100,
        },
        {
          id: 'd2', text: wicketDraft.text, textRomanUrdu: wicketDraft.textRomanUrdu,
          options: '["Yes","No"]', market: 'wicket_in_over', params: {}, innings: 1, over: 1, closesInSeconds: 100,
        },
      ],
      drafts: [],
      admin: 'boss@example.test',
    });
    expect(logQuizAction).toHaveBeenCalledWith({
      quizId: 'quiz1', quizTitle: 'Lahore vs Karachi', action: 'match_questions_sent', adminEmail: 'boss@example.test',
      details: { matchId: 'm1', questions: ['d1', 'd2'], edited: ['d1'] },
    });
  });

  it("refuses a draft that is gone, too late, or worded so it wouldn't settle right, sending nothing", async () => {
    setMatch({ row: { drafts: [draft(), draft({ id: 'skipped', skipped: true }), draft({ id: 'late', closesAt: new Date(NOW + 5_000).toISOString() })] } });
    const send = (over: Record<string, unknown>) => sendDrafts('m1', [{ id: 'd1', text: draft().text, textRomanUrdu: draft().textRomanUrdu, ...over }], 'a');
    expect(await send({ id: 'nope' })).toEqual({ ok: false, status: 409, code: 'gone', error: 'That question was already sent or skipped' });
    expect(await send({ id: 'skipped' })).toMatchObject({ status: 409, code: 'gone' });
    expect(await send({ id: 'late' })).toEqual({
      ok: false, status: 409, code: 'too_late', error: "Too late: over 1 is about to start, so its questions can't go out any more",
    });
    expect(await send({ text: 'Will over 1 go for 12 or more runs?' })).toEqual({
      ok: false, status: 400, code: 'wording', error: 'The English wording must keep the line (9): change the line with its number box',
    });
    setMatch({ row: { drafts: [wicketDraft] } });
    expect(await sendDrafts('m1', [{ id: 'd2', text: wicketDraft.text, textRomanUrdu: wicketDraft.textRomanUrdu, line: 4 }], 'a'))
      .toEqual({ ok: false, status: 400, code: 'invalid', error: 'This question has no line to change' });
    // Over 1 has started
    setMatch({ row: { drafts: [draft()] }, balls: [ball(1)] });
    expect(await send({})).toMatchObject({ status: 409, code: 'too_late' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('works the review out again when a ball beat it to the match, three times at most', async () => {
    setMatch({ row: { drafts: [draft()] } });
    let calls = 0;
    db.setRpc('apply_match_change', () => (++calls === 1 ? { data: { success: false, code: 'stale' } } : { data: { success: true, version: 5 } }));
    expect((await skipDrafts('m1', ['d1'], 'a')).ok).toBe(true);
    expect(db.rpcCalls).toHaveLength(2);

    db.setRpc('apply_match_change', { data: { success: false, code: 'stale' } });
    expect(await skipDrafts('m1', ['d1'], 'a')).toEqual({ ok: false, status: 409, code: 'stale', error: 'The match kept changing while this was saved: try again' });
    expect(db.rpcCalls).toHaveLength(5);
  });

  it("passes on the database's other refusals, an unknown or settled match", async () => {
    setMatch({ row: { drafts: [draft()] } });
    db.setRpc('apply_match_change', { data: { success: false, code: 'invalid', error: "A match's drafts must be a JSON list" } });
    expect(await skipDrafts('m1', ['d1'], 'a')).toEqual({ ok: false, status: 400, code: 'invalid', error: "A match's drafts must be a JSON list" });
    db.setTable('LiveMatch', { data: null });
    expect(await setAutoSend('nope', true, 'a')).toEqual({ ok: false, status: 404, code: 'not_found', error: 'Match not found' });
    setMatch({ settled: 1 });
    expect(await setAutoSend('m1', true, 'a')).toMatchObject({ ok: false, status: 409, code: 'settled' });
  });

  it('skips drafts: their over gets no questions, and they stay so it never gets new ones', async () => {
    setMatch({ row: { drafts: [draft(), wicketDraft] } });
    expect((await skipDrafts('m1', ['d2'], 'boss@example.test')).ok).toBe(true);
    expect(change()).toEqual({ drafts: [draft(), { ...wicketDraft, skipped: true }], admin: 'boss@example.test' });
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_questions_skipped', details: { matchId: 'm1', questions: ['d2'] } }));
    setMatch({ row: { drafts: [{ ...wicketDraft, skipped: true }] } });
    expect(await skipDrafts('m1', ['d2'], 'a')).toMatchObject({ status: 409, code: 'gone' });
  });

  it('switches automatic sending, and logs it', async () => {
    setMatch();
    expect((await setAutoSend('m1', true, 'boss@example.test')).ok).toBe(true);
    expect(change()).toEqual({ autoSend: true, admin: 'boss@example.test' });
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'match_auto_send_changed', details: { matchId: 'm1', autoSend: true } }));
  });

  it('shows each draft as waiting, too late or skipped, with its line', async () => {
    setMatch({
      row: { autoSend: false, drafts: [draft(), { ...wicketDraft, skipped: true }, draft({ id: 'late', closesAt: new Date(NOW + 5_000).toISOString() })] },
      questions: [question({ textRomanUrdu: 'Roman' })],
    });
    const view = matchView((await loadMatch('m1', NOW))!, NOW);
    expect(view.match.autoSend).toBe(false);
    expect(view.drafts.map((d) => [d.id, d.state, d.line])).toEqual([['d1', 'waiting', 9], ['d2', 'skipped', null], ['late', 'too_late', 9]]);
    expect(view.drafts[1]).not.toHaveProperty('skipped');
    expect(view.questions[0].textRomanUrdu).toBe('Roman');
    // The engine knows these overs have their questions
    expect((await loadMatch('m1', NOW))!.state.draftSlots).toEqual([{ innings: 1, over: 1 }, { innings: 1, over: 1 }, { innings: 1, over: 1 }]);
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
