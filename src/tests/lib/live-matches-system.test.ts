// @vitest-environment node
/**
 * System tests of the live match quiz system, from the scorer's ball to what players see:
 * 1. Each over's quiz is prepared an over ahead and goes out on the ball the admin picks (or Auto's
 *    ball 1): first over, middle overs and the last over of a T20 or T10, extras included.
 * 2. Gemini's mistakes never reach players: every wording is checked, bad ones fall back to the built-in
 *    wording, and in Manual nothing goes out before the admin sends or sets a ball.
 * 3. The scoreboard is the quiz's context: the lead-in and lines follow the score (a six, a wicket, a
 *    chase), Gemini gets the same facts, neighbouring overs ask different things, and every question is a
 *    prediction about an over not yet bowled, stating only numbers from the scoreboard.
 * 4. Manual scoreboard updates: every kind of delivery, corrections and undo re-settle questions; innings
 *    and match controls.
 * 5. Quick actions: change the line without touching the lead-in, queue for a ball, take it off, skip,
 *    switch to Auto; and what players' devices remember.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '@/tests/helpers/supabase-mock';
import {
  applyEvent,
  pushDue,
  reopenable,
  scoreInnings,
  stillSendable,
  targetFor,
  type Extra,
  type InningsNumber,
  type MatchConfig,
  type MatchEvent,
  type MatchQuestion,
  type MatchState,
} from '@/lib/match-engine';
import { overCandidates, romanUrduOption, runsLine, YES_NO } from '@/lib/match-questions';
import { matchSituation, situationNumbers } from '@/lib/match-situation';
import { aiWording, aiWordingProblem, MAX_QUESTION_LENGTH, wordingProblem, __resetWordingUsageForTests } from '@/lib/match-wording';
import { changeLine } from '@/components/admin/matches/QuizCard';
import { openOver, readAnswered, rememberAnswered, scoreLine } from '@/lib/match-play';

let db: SupabaseMock;
let generatedIds = 0;
const logQuizAction = vi.fn();

vi.mock('@/lib/supabase/db', () => ({
  getAdminDb: () => db.client,
  generateId: () => `gen_${++generatedIds}`,
  notificationDb: { createBroadcast: vi.fn() },
}));
vi.mock('@/lib/admin-action-log', () => ({ logQuizAction: (...args: unknown[]) => logQuizAction(...args) }));

const { applyMatchEvent, loadMatch, matchView, queueQuiz, sendDrafts, setAutoSend, skipDrafts, unqueueQuiz } = await import('@/lib/match-service');
const { buildPublicMatch } = await import('@/lib/match-feed');

const NOW = Date.parse('2026-10-30T15:00:00Z');

const T20: MatchConfig = { teams: ['Lahore Qalandars', 'Karachi Kings'], oversPerInnings: 20, questionsPerOver: 2, firstWindowSeconds: 120, lockFallbackSeconds: 150 };
const T10: MatchConfig = { teams: ['Islamabad United', 'Peshawar Zalmi'], oversPerInnings: 10, questionsPerOver: 3, firstWindowSeconds: 120, lockFallbackSeconds: 150 };

const delivery = (runs: number, extra: Extra = 'none', wicket = false): MatchEvent => ({ type: 'ball', runs, extra, wicket });
const dot = delivery(0);

/**
 * The engine and the server's quiz rules together, in memory: each prepared quiz waits (Manual) or is set
 * for ball 1 (Auto); `queue` sets one for a ball, `push` sends one now. A quiz's questions are the best of
 * the over's candidates, built from the situation as match-service.ts builds them.
 */
function simulator(config: MatchConfig = T20, auto = false) {
  let state: MatchState = { config, status: 'setup', innings: [], balls: [], questions: [], draftSlots: [] };
  let seq = 0;
  const queued = new Map<string, number>();
  const key = (innings: number, over: number) => `${innings}.${over}`;

  const questionsFor = (innings: InningsNumber, over: number) => {
    const record = state.innings.find((i) => i.innings === innings)!;
    const situation = matchSituation({
      balls: state.balls.filter((b) => b.innings === innings), innings, battingTeam: record.battingTeam,
      oversPerInnings: config.oversPerInnings, target: targetFor(innings, state.balls, config.oversPerInnings), afterOvers: over - 2,
    });
    const recent = state.questions.filter((q) => q.innings === innings && q.over === over - 1).map((q) => q.market);
    return overCandidates(situation, over, recent).slice(0, config.questionsPerOver);
  };

  const push = (innings: InningsNumber, over: number) => {
    if (!(state.draftSlots ?? []).some((s) => s.innings === innings && s.over === over)) return { ok: false as const, error: 'No quiz waiting for this over' };
    if (!stillSendable(state, { innings, over })) return { ok: false as const, error: `Too late to push over ${over}` };
    const pushed: MatchQuestion[] = questionsFor(innings, over).map((q, i) => ({
      id: `q_${innings}_${over}_${i + 1}`, innings, over, market: q.market, params: q.params,
      status: 'active', hasResult: false, correctOption: null, closed: false,
    }));
    queued.delete(key(innings, over));
    state = { ...state, questions: [...state.questions, ...pushed], draftSlots: (state.draftSlots ?? []).filter((s) => !(s.innings === innings && s.over === over)) };
    return { ok: true as const, pushed };
  };

  const pushDueQuizzes = () => {
    for (const [slotKey, ball] of [...queued]) {
      const [innings, over] = slotKey.split('.').map(Number) as [InningsNumber, number];
      if (pushDue(state, { innings, over }, ball)) push(innings, over);
    }
  };

  const step = (event: MatchEvent) => {
    const outcome = applyEvent(state, event, () => `ball_${++seq}`);
    if (!outcome.ok) return outcome;
    const { change } = outcome;
    const questions = outcome.state.questions.map((q) => ({ ...q }));
    for (const q of questions) {
      if (change.closeAll || change.lock.includes(q.id)) q.closed = true;
      if (change.reopen?.some((r) => r.id === q.id)) q.closed = false;
      const resolved = change.resolve.find((r) => r.id === q.id);
      if (resolved) Object.assign(q, { hasResult: true, correctOption: resolved.option, status: 'active' });
      if (change.void.includes(q.id)) Object.assign(q, { hasResult: false, correctOption: null, status: 'paused' });
      if (change.pending.includes(q.id)) Object.assign(q, { hasResult: false, correctOption: null, status: 'active' });
    }
    const draftSlots = [...(outcome.state.draftSlots ?? []), ...change.release.map((s) => ({ innings: s.innings, over: s.over }))];
    state = { ...outcome.state, questions, draftSlots };
    if (auto) for (const slot of change.release) queued.set(key(slot.innings, slot.over), 1);
    pushDueQuizzes();
    return { ok: true as const, change, state };
  };

  return {
    get state() {
      return state;
    },
    step,
    push,
    queue: (innings: InningsNumber, over: number, ball: number) => {
      queued.set(key(innings, over), ball);
      pushDueQuizzes();
    },
    waiting: () => (state.draftSlots ?? []).map((s) => s.over),
    questionsOf: (over: number) => state.questions.filter((q) => q.over === over),
  };
}

const play = (sim: ReturnType<typeof simulator>, events: MatchEvent[]) => events.forEach((e) => sim.step(e));
const overOf = (n: number) => Array.from({ length: n }, () => dot);

beforeEach(() => {
  db = createSupabaseMock();
  generatedIds = 0;
  logQuizAction.mockReset();
  __resetWordingUsageForTests();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('1. Each quiz is prepared an over ahead and goes out on the ball the admin picks', () => {
  it("prepares over 1's and over 2's quizzes at the start: over 1's goes out before ball 1 and closes on it", () => {
    const sim = simulator();
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    expect(sim.waiting()).toEqual([1, 2]);
    expect(sim.push(1, 1).ok).toBe(true);
    expect(sim.questionsOf(1).every((q) => !q.closed)).toBe(true);
    sim.step(delivery(6));
    expect(sim.questionsOf(1).every((q) => q.closed)).toBe(true);
    // Too late now for over 1's quiz: its over has started
    expect(sim.push(1, 1)).toEqual({ ok: false, error: 'No quiz waiting for this over' });
  });

  it("sends a quiz set for ball 3 on the over's 3rd legal ball, a wide not counting, and closes it after the 5th", () => {
    const sim = simulator();
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    sim.push(1, 1);
    sim.queue(1, 2, 3);
    play(sim, [dot, delivery(0, 'wide'), dot]);
    expect(sim.questionsOf(2)).toEqual([]);
    sim.step(dot);
    expect(sim.questionsOf(2).map((q) => q.closed)).toEqual([false, false]);
    play(sim, [dot, dot]);
    expect(sim.questionsOf(2).every((q) => q.closed)).toBe(true);
    // Over 1 ended: over 3's quiz is ready for over 2
    sim.step(dot);
    expect(sim.waiting()).toEqual([3]);
  });

  it('blocks a quiz once the over before has had its 5th legal ball, or its own over has started', () => {
    const sim = simulator();
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    sim.push(1, 1);
    play(sim, overOf(5));
    expect(sim.push(1, 2)).toEqual({ ok: false, error: 'Too late to push over 2' });
    // Set for ball 4 after the 5th: never goes
    sim.queue(1, 2, 4);
    expect(sim.questionsOf(2)).toEqual([]);
    expect(stillSendable(sim.state, { innings: 1, over: 1 })).toBe(false);
  });

  it.each([['T20', T20], ['T10', T10]] as const)('%s: prepares the last over\'s quiz after the over before the one before it, and nothing past the last over', (_name, config) => {
    const sim = simulator(config, true);
    sim.step({ type: 'start_innings', battingTeam: config.teams[0] });
    const last = config.oversPerInnings;
    for (let over = 1; over <= last - 2; over++) play(sim, overOf(6));
    expect(sim.waiting()).toEqual([last]);
    // Auto: out on the first ball of the over before it
    sim.step(dot);
    expect(sim.questionsOf(last)).toHaveLength(config.questionsPerOver);
    play(sim, [...overOf(5), ...overOf(6)]);
    expect(sim.state.status).toBe('innings_break');
    expect(sim.state.questions.some((q) => q.over > last)).toBe(false);
    expect(sim.questionsOf(last).every((q) => q.hasResult)).toBe(true);
  });
});

describe('2. Gemini mistakes never reach players, and nothing goes out in Manual before the admin says so', () => {
  it.each([
    ['empty English wording', { text: '   ', textRomanUrdu: 'Kya over 5 mein 11 ya zyada runs banenge?' }, 'The English wording is empty'],
    ['empty Roman Urdu wording', { text: 'Will over 5 go for 11 or more runs?', textRomanUrdu: '' }, 'The Roman Urdu wording is empty'],
    ['too long', { text: `Over 5 for 11 runs? ${'a'.repeat(MAX_QUESTION_LENGTH)}`, textRomanUrdu: 'Kya over 5 mein 11 runs?' }, `The English wording is longer than ${MAX_QUESTION_LENGTH} characters`],
    ['the wrong over', { text: 'Will over 15 go for 11 or more runs?', textRomanUrdu: 'Kya over 5 mein 11 ya zyada runs banenge?' }, 'The English wording must say which over it is about (5)'],
    ['no over in Roman Urdu', { text: 'Will over 5 go for 11 or more runs?', textRomanUrdu: 'Kya is over mein 11 ya zyada runs banenge?' }, 'The Roman Urdu wording must say which over it is about (5)'],
    ['a changed line', { text: 'Will over 5 go for 12 or more runs?', textRomanUrdu: 'Kya over 5 mein 11 ya zyada runs banenge?' }, 'The English wording must keep the line (11): change the line with its number box'],
    ['a link', { text: 'Will over 5 go for 11 or more? Check https://stats.example.com', textRomanUrdu: 'Kya over 5 mein 11 runs?' }, "The English wording can't contain a link"],
    ['betting words', { text: 'What are the odds over 5 goes for 11 or more runs?', textRomanUrdu: 'Kya over 5 mein 11 runs?' }, "The English wording can't talk about betting"],
    ['betting slang in Roman Urdu', { text: 'Will over 5 go for 11 or more runs?', textRomanUrdu: 'Over 5 mein 11 runs? Jua mat lagao?' }, "The Roman Urdu wording can't talk about betting"],
  ])('refuses %s', (_case, wording, error) => {
    expect(wordingProblem(wording, 5, { line: 11 })).toBe(error);
  });

  it('keeps the good wordings of a batch and falls back to the built-in one for each bad one: wrong over, betting, a made-up number', async () => {
    const situation = matchSituation({
      balls: [6, 0, 1, 4, 1, 0, 1, 1, 2, 4, 6, 1, 0, 1, 1, 4, 1, 1, 1, 1].map((runs, i) => ({ id: `b${i}`, innings: 1 as const, seq: i + 1, runs, extra: 'none' as const, extraRuns: 0, wicket: i === 2 || i === 9 })),
      innings: 1, battingTeam: 'Lahore Qalandars', oversPerInnings: 20, target: null, afterOvers: 3,
    });
    const questions = overCandidates(situation, 5);
    const line = questions[0].params.line;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { en: `Lahore Qalandars ${situation.runs}/${situation.wickets} after 3 overs: will over 5 go for ${line} or more runs?`, ur: `3 overs ke baad Lahore ${situation.runs}/${situation.wickets}: kya over 5 mein ${line} ya zyada runs?` },
      { en: 'Will over 6 have a four or a six?', ur: 'Kya over 6 mein chauka lagega?' },
      { en: 'Wager time: will over 5 have 3 or more dot balls?', ur: 'Kya over 5 mein 3 dot balls hongi?' },
      { en: 'Needing 200, will a wicket fall in over 5?', ur: 'Kya over 5 mein wicket giray ga?' },
    ]) }] } }] }), { status: 200 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await aiWording({ teams: ['Lahore Qalandars', 'Karachi Kings'], situation, over: 5 }, questions, { MATCH_GEMINI_API_KEY: 'k', MATCH_GEMINI_RPM: '100' }, fetcher as never, NOW);
    expect(results[0]).toEqual({
      text: `Lahore Qalandars ${situation.runs}/${situation.wickets} after 3 overs: will over 5 go for ${line} or more runs?`,
      textRomanUrdu: `3 overs ke baad Lahore ${situation.runs}/${situation.wickets}: kya over 5 mein ${line} ya zyada runs?`,
    });
    expect(results.slice(1)).toEqual([null, null, null]);
  });

  it('in Manual, holds the quizzes out of the player feed, refuses a bad edit, and sends only what the admin sends', async () => {
    vi.stubEnv('MATCH_GEMINI_API_KEY', '');
    const row = {
      id: 'm1', quizId: 'quiz1', teamA: 'Lahore Qalandars', teamB: 'Karachi Kings', oversPerInnings: 20, questionsPerOver: 2,
      firstWindowSeconds: 120, lockFallbackSeconds: 150, status: 'setup', autoSend: false, version: 1, createdAt: '2026-10-30T14:00:00Z',
      Quiz: { title: 'Lahore Qalandars vs Karachi Kings', status: 'active' }, drafts: [],
    };
    db.setTable('LiveMatch', { data: row });
    db.setTable('MatchInnings', { data: [] });
    db.setTable('BallEvent', { data: [] });
    db.setTable('Question', { data: [] });
    db.setTable('QuizSettlement', { count: 0 });
    db.setTable('QuizAdminSettings', { data: { maxEntries: 2000 } });
    db.setTable('QuizEntryCount', { data: { entries: 0 } });
    db.setRpc('apply_match_change', { data: { success: true, version: 2 } });

    expect((await applyMatchEvent('m1', 1, { type: 'start_innings', battingTeam: 'Lahore Qalandars' }, 'admin@example.test')).ok).toBe(true);
    const saved = db.rpcCalls[0].args.p_change as { release: unknown[]; drafts: Array<{ id: string; over: number; text: string; textRomanUrdu: string }> };
    expect(saved.release).toEqual([]);
    expect(saved.drafts.map((d) => d.over)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);

    db.setTable('LiveMatch', { data: { ...row, status: 'live', version: 2, drafts: saved.drafts } });
    db.setTable('MatchInnings', { data: [{ innings: 1, battingTeam: 'Lahore Qalandars', endReason: null }] });
    const feed = (await buildPublicMatch('m1', NOW))!;
    expect(feed.questions).toEqual([]);
    expect(JSON.stringify(feed)).not.toContain(saved.drafts[0].text);

    const first = saved.drafts[0];
    expect(await sendDrafts('m1', [{ id: first.id, text: 'Will Lahore score 12 or more runs in this over?', textRomanUrdu: first.textRomanUrdu }], 'a'))
      .toEqual({ ok: false, status: 400, code: 'wording', error: 'The English wording must say which over it is about (1)' });
    expect(db.rpcCalls).toHaveLength(1);

    expect((await sendDrafts('m1', [{ id: first.id, text: 'Lahore openers ready: will over 1 go for 10 or more runs?', textRomanUrdu: 'Lahore tayyar: kya over 1 mein 10 ya zyada runs banenge?', line: 10 }], 'a')).ok).toBe(true);
    const sent = db.rpcCalls[1].args.p_change as { release: Array<Record<string, unknown>>; drafts: Array<{ over: number; skipped?: boolean }> };
    expect(sent.release).toEqual([expect.objectContaining({ id: first.id, over: 1, params: { line: 10 }, closesInSeconds: 120 })]);
    // The rest of over 1's quiz is skipped; over 2's still waits
    expect(sent.drafts.filter((d) => d.over === 1).every((d) => d.skipped)).toBe(true);
    expect(sent.drafts.filter((d) => d.over === 2).some((d) => d.skipped)).toBe(false);
  });
});

describe('3. The scoreboard is the context: lead-in, lines, Gemini, variety, nothing to look up', () => {
  it('states the score after a six and a wicket, and moves the runs line with the scoring', () => {
    const sim = simulator();
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    play(sim, [delivery(6), delivery(0, 'none', true), delivery(4), delivery(1), delivery(6), delivery(4)]);
    play(sim, [delivery(4), delivery(6), delivery(1), delivery(1), delivery(4), delivery(6)]);
    // After 2 overs: 21 and 22 runs, 1 wicket
    const situation = matchSituation({ balls: sim.state.balls, innings: 1, battingTeam: 'Lahore Qalandars', oversPerInnings: 20, target: null, afterOvers: 2 });
    expect(situation).toMatchObject({ runs: 43, wickets: 1, lastOver: { number: 2, runs: 22, wickets: 0 } });
    const [runs] = overCandidates(situation, 4);
    expect(runs.text).toBe('Lahore Qalandars 43/1 after 2 overs: will over 4 go for 14 or more runs?');
    expect(runsLine(situation)).toBe(14);
    // A quiet start keeps the line low
    expect(runsLine({ ...situation, runRate: 3, recentRate: 4 })).toBe(5);
  });

  it('gives Gemini the same facts the lead-in states, and refuses any other number it writes', async () => {
    const situation = matchSituation({
      balls: Array.from({ length: 96 }, (_, i) => ({ id: `b${i}`, innings: 2 as const, seq: i + 1, runs: i % 4 === 0 ? 4 : 1, extra: 'none' as const, extraRuns: 0, wicket: i % 20 === 0 })),
      innings: 2, battingTeam: 'Karachi Kings', oversPerInnings: 20, target: 190, afterOvers: 16,
    });
    const [runs] = overCandidates(situation, 18);
    expect(runs.lead!.en).toBe(`After 16 overs, Karachi Kings need ${situation.chase!.needed} runs from 24 balls`);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[]' }] } }] })));
    await aiWording({ teams: ['Lahore Qalandars', 'Karachi Kings'], situation, over: 18 }, [runs], { MATCH_GEMINI_API_KEY: 'k' }, fetcher as never, NOW);
    const sent = JSON.parse(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).contents[0].parts[0].text);
    expect(sent.match).toMatchObject({ innings: 2, chase: { target: 190, runsNeeded: situation.chase!.needed, ballsLeft: 24 }, stage: 'last overs' });
    expect(sent.questions[0].leadIn).toBe(runs.lead!.en);
    const numbers = situationNumbers(situation, 18, runs.params.line, T20.teams);
    expect(aiWordingProblem({ text: 'Karachi need 30 more: will over 18 go big?', textRomanUrdu: 'Over 18?' }, numbers)).toMatch(/states 30/);
  });

  it("never asks the same thing twice in an over, nor the same second question two overs running", () => {
    const sim = simulator(T20, true);
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    for (let over = 1; over <= 12; over++) play(sim, [delivery(1), delivery(4), dot, delivery(1), dot, delivery(2)]);
    for (let over = 1; over <= 12; over++) {
      const markets = sim.questionsOf(over).map((q) => q.market);
      expect(new Set(markets).size).toBe(markets.length);
      expect(markets[0]).toBe('over_runs_at_least');
      if (over > 1) expect(markets[1]).not.toBe(sim.questionsOf(over - 1)[1].market);
    }
  });

  it('makes every question a Yes / No prediction about an over not yet bowled, stating only scoreboard numbers', () => {
    for (const config of [T20, T10]) {
      for (let over = 1; over <= config.oversPerInnings; over++) {
        const situation = matchSituation({
          balls: Array.from({ length: 6 * Math.max(0, over - 2) }, (_, i) => ({ id: `b${i}`, innings: 1 as const, seq: i + 1, runs: i % 3, extra: 'none' as const, extraRuns: 0, wicket: i % 13 === 0 })),
          innings: 1, battingTeam: config.teams[0], oversPerInnings: config.oversPerInnings, target: null, afterOvers: over - 2,
        });
        for (const q of overCandidates(situation, over)) {
          expect(q.options).toEqual(YES_NO);
          expect(q.text).toMatch(new RegExp(`over ${over}\\b`));
          expect(situation.afterOvers).toBeLessThan(over);
          expect(aiWordingProblem({ text: q.text, textRomanUrdu: q.textRomanUrdu }, situationNumbers(situation, over, q.params.line ?? null, config.teams))).toBeNull();
        }
      }
    }
    expect(YES_NO.map(romanUrduOption)).toEqual(['Haan', 'Nahi']);
  });
});

describe('4. Manual scoreboard updates and the correction lifecycle', () => {
  it('scores every kind of delivery, and corrections re-settle the over', () => {
    const sim = simulator(T20, true);
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    play(sim, [delivery(6), delivery(0, 'none', true), delivery(0, 'wide'), delivery(4, 'no_ball'), delivery(2, 'leg_bye'), delivery(1, 'bye'), dot, dot]);
    const score = scoreInnings(sim.state.balls, 20, null);
    expect(score).toMatchObject({ runs: 15, wickets: 1, legalBalls: 6, oversText: '1.0' });
    // Over 1's quiz (Auto, at the start): runs (line 8) and a boundary: both Yes
    const [runs, boundary] = sim.questionsOf(1);
    expect([runs.market, runs.params, boundary.market]).toEqual(['over_runs_at_least', { line: 8 }, 'boundary_in_over']);
    expect([runs.correctOption, boundary.correctOption]).toEqual([0, 0]);

    // The six was a dot, and the no-ball a legal single: 5 runs, no boundary
    sim.step({ type: 'correct_ball', ballId: 'ball_1', runs: 0, extra: 'none', wicket: false });
    sim.step({ type: 'correct_ball', ballId: 'ball_4', runs: 1, extra: 'none', wicket: false });
    expect(sim.questionsOf(1).map((q) => q.correctOption)).toEqual([1, 1]);
    // With the no-ball now legal, over 1 ended a ball sooner: the last dot is over 2's first ball. Undoing it
    // leaves over 1 settled; undoing over 1's last ball takes its results back
    sim.step({ type: 'undo' });
    expect(sim.questionsOf(1).every((q) => q.hasResult)).toBe(true);
    sim.step({ type: 'undo' });
    expect(sim.questionsOf(1).every((q) => !q.hasResult)).toBe(true);
  });

  it('ends, resumes and removes innings; closes and reopens answers; abandons and restores the match', () => {
    const sim = simulator(T20, true);
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    // Auto: over 1's quiz is out; over 2's waits for ball 1
    sim.step({ type: 'close_answers' });
    expect(sim.questionsOf(1).every((q) => q.closed)).toBe(true);
    expect(reopenable(sim.state)).toHaveLength(2);
    sim.step({ type: 'reopen_answers' });
    expect(sim.questionsOf(1).every((q) => !q.closed)).toBe(true);

    sim.step({ type: 'remove_innings' });
    expect(sim.state).toMatchObject({ status: 'setup', innings: [], questions: [] });

    sim.step({ type: 'start_innings', battingTeam: 'Karachi Kings' });
    sim.step(delivery(4));
    sim.step({ type: 'end_innings' });
    expect(sim.state.status).toBe('innings_break');
    expect(sim.state.questions.every((q) => q.status === 'paused')).toBe(true);
    sim.step({ type: 'resume_innings' });
    expect(sim.state.questions.every((q) => q.status === 'active')).toBe(true);
    sim.step({ type: 'abandon' });
    expect(sim.state.status).toBe('abandoned');
    sim.step({ type: 'restore' });
    expect(sim.state.status).toBe('live');
  });
});

describe('5. Quick actions, and what players remember', () => {
  const ROW = {
    id: 'm1', quizId: 'quiz1', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 20, questionsPerOver: 2,
    firstWindowSeconds: 120, lockFallbackSeconds: 150, status: 'live', autoSend: false, version: 3, createdAt: '2026-10-30T14:00:00Z',
    Quiz: { title: 'Lahore vs Karachi', status: 'active' },
  };
  const prepared = () => overCandidates(matchSituation({ balls: [], innings: 1, battingTeam: 'Lahore', oversPerInnings: 20, target: null, afterOvers: 0 }), 2)
    .map((q, rank) => ({
      id: `d${rank}`, innings: 1, over: 2, market: q.market, params: q.params, options: q.options, text: q.text, textRomanUrdu: q.textRomanUrdu,
      body: q.body, lead: q.lead, rank, selected: rank < 2, aiAsked: false, preparedAt: new Date(NOW).toISOString(), window: 150,
    }));
  const serve = (drafts: unknown[], balls: unknown[] = []) => {
    db.setTable('LiveMatch', { data: { ...ROW, drafts } });
    db.setTable('MatchInnings', { data: [{ innings: 1, battingTeam: 'Lahore', endReason: null }] });
    db.setTable('BallEvent', { data: balls });
    db.setTable('Question', { data: [] });
    db.setTable('QuizSettlement', { count: 0 });
    db.setRpc('apply_match_change', { data: { success: true, version: 4 } });
  };
  const lastChange = () => db.rpcCalls.at(-1)!.args.p_change as { release: Array<{ id: string }>; drafts: Array<Record<string, unknown>> };

  it("changes a line without touching the lead-in's numbers", () => {
    expect(changeLine('Lahore 87/2 after 9 overs: will over 11 go for 9 or more runs?', 9, 11)).toBe('Lahore 87/2 after 9 overs: will over 11 go for 11 or more runs?');
  });

  it('queues a quiz for a ball, which goes out when the scorer records it; takes another off; skips one', async () => {
    const drafts = prepared();
    serve(drafts);
    await queueQuiz('m1', 2, [{ id: 'd0', text: drafts[0].text, textRomanUrdu: drafts[0].textRomanUrdu, line: drafts[0].params.line }], 'a');
    const queued = lastChange().drafts;
    expect(queued.map((d) => [d.id, d.pushOn, d.selected])).toEqual([['d0', 2, true], ['d1', 2, false], ['d2', 2, false], ['d3', 2, false]]);

    // Over 1: the first legal ball does nothing, the second sends it
    serve(queued, [{ id: 'b1', innings: 1, seq: 1, runs: 1, extra: 'none', extraRuns: 0, wicket: false }]);
    await applyMatchEvent('m1', 3, delivery(0), 'a');
    expect(lastChange().release.map((r) => r.id)).toEqual(['d0']);
    expect(logQuizAction).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'match_questions_sent', details: expect.objectContaining({ over: 2, ball: 2, by: 'admin' }) }));

    serve(queued);
    await unqueueQuiz('m1', { innings: 1, over: 2 }, 'a');
    expect(lastChange().drafts.every((d) => d.pushOn === undefined)).toBe(true);
    serve(drafts);
    await skipDrafts('m1', drafts.map((d) => d.id), 'a');
    expect(lastChange().drafts.every((d) => d.skipped)).toBe(true);
    const loaded = (await loadMatch('m1', NOW))!;
    expect(matchView(loaded, NOW).quizzes).toHaveLength(1);
  });

  it("switching to Auto mid-over sends the waiting quiz now, if its ball 1 has passed", async () => {
    serve(prepared(), [{ id: 'b1', innings: 1, seq: 1, runs: 4, extra: 'none', extraRuns: 0, wicket: false }]);
    expect((await setAutoSend('m1', true, 'a')).ok).toBe(true);
    expect(lastChange().release.map((r) => r.id)).toEqual(['d0', 'd1']);
  });

  it("remembers on the device the overs a player answered, so they never pop up again", () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const feed = [{
      id: 'q1', innings: 1 as const, over: 2, text: 'Will over 2 go for 8 or more runs?', textRomanUrdu: null, options: ['Yes', 'No'],
      optionsRomanUrdu: [null, null], state: 'open' as const, closesAt: new Date(NOW + 90_000).toISOString(), correctOption: null,
    }];
    expect(openOver(feed, NOW)).toMatchObject({ innings: 1, over: 2 });
    expect(scoreLine({
      match: { title: 'Lahore vs Karachi' } as never,
      innings: [{ innings: 1, battingTeam: 'Lahore', endReason: null, runs: 6, wickets: 1, oversText: '0.2', target: null, overs: [] }],
    })).toBe('Lahore 6/1 (0.2 overs)');
    rememberAnswered('user_1', 'quiz1', new Set(['q1']));
    expect(readAnswered('user_1', 'quiz1').has('q1')).toBe(true);
  });
});

