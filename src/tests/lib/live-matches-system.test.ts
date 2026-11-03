// @vitest-environment node
/**
 * Comprehensive unit & system-level testing for the Live Matches automated live quiz system:
 * 1. Pushing questions in any ball (first over, middle overs, last over in T10/T20, with extras).
 * 2. AI / Gemini mistake detection, fallback, and mandatory Admin Review gate before user push.
 * 3. Scoreboard context training Gemini (e.g. Ball 1 = 6, another ball = wicket), non-repeating
 *    questions across the match, and non-searchable future-prediction enforcement.
 * 4. Manual scoreboard updates and full correction lifecycle (ball edits, undo, innings, answers).
 * 5. Quick actions for customizing, reverting, deleting/skipping, and reviewing quiz questions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '@/tests/helpers/supabase-mock';
import {
  applyEvent,
  BALLS_PER_OVER,
  MARKET_NAMES,
  MIN_ANSWER_SECONDS,
  planQuestions,
  reopenable,
  resolveMarket,
  scoreInnings,
  splitOvers,
  stillSendable,
  targetFor,
  type Ball,
  type Extra,
  type MatchChange,
  type MatchConfig,
  type MatchEvent,
  type MatchQuestion,
  type MatchState,
} from '@/lib/match-engine';
import { overQuestions, romanUrduOption, runsLine, YES_NO } from '@/lib/match-questions';
import {
  aiWording,
  MAX_QUESTION_LENGTH,
  wordingProblem,
  __resetWordingUsageForTests,
  type WordingContext,
} from '@/lib/match-wording';
import { changeLine } from '@/components/admin/matches/QuestionReview';
import { openOver, readAnswered, rememberAnswered, scoreLine } from '@/lib/match-play';

let db: SupabaseMock;
let generatedIds = 0;
const logQuizAction = vi.fn();
const createBroadcast = vi.fn();

vi.mock('@/lib/supabase/db', () => ({
  getAdminDb: () => db.client,
  generateId: () => `gen_${++generatedIds}`,
  notificationDb: { createBroadcast: (...args: unknown[]) => createBroadcast(...args) },
}));
vi.mock('@/lib/admin-action-log', () => ({
  logQuizAction: (...args: unknown[]) => logQuizAction(...args),
}));

const {
  applyMatchEvent,
  ballLabel,
  loadMatch,
  matchView,
  sendDrafts,
  setAutoSend,
  setMaxEntries,
  setPublished,
  skipDrafts,
} = await import('@/lib/match-service');
const { buildPublicMatch } = await import('@/lib/match-feed');

const NOW = Date.parse('2026-10-30T15:00:00Z');

const T20_CONFIG: MatchConfig = {
  teams: ['Lahore Qalandars', 'Karachi Kings'],
  oversPerInnings: 20,
  questionsPerOver: 2,
  firstWindowSeconds: 120,
  lockFallbackSeconds: 150,
};

const T10_CONFIG: MatchConfig = {
  teams: ['Islamabad United', 'Peshawar Zalmi'],
  oversPerInnings: 10,
  questionsPerOver: 3,
  firstWindowSeconds: 120,
  lockFallbackSeconds: 150,
};

const emptyState = (config: MatchConfig = T20_CONFIG): MatchState => ({
  config,
  status: 'setup',
  innings: [],
  balls: [],
  questions: [],
  draftSlots: [],
});

const delivery = (runs: number, extra: Extra = 'none', wicket = false): MatchEvent => ({
  type: 'ball',
  runs,
  extra,
  wicket,
});

/**
 * Helper that simulates the match engine + admin review queue (`draftSlots`) or auto-release.
 * When `reviewFirst` is true (default), released slots become drafts waiting for admin review
 * until `pushOver(over)` is called, matching `MatchConsole` + `match-service.ts`.
 */
function createMatchSimulator(config: MatchConfig = T20_CONFIG, reviewFirst = true) {
  let state = emptyState(config);
  let ballSeq = 0;
  const changes: MatchChange[] = [];

  const step = (event: MatchEvent) => {
    const outcome = applyEvent(state, event, () => `ball_${++ballSeq}`);
    if (!outcome.ok) return outcome;
    const { change } = outcome;
    changes.push(change);

    let questions: MatchQuestion[] = outcome.state.questions
      .filter((q) => q.innings !== change.removeInnings?.innings)
      .map((q) => ({ ...q }));
    let draftSlots = [...(outcome.state.draftSlots ?? [])].filter(
      (s) => s.innings !== change.removeInnings?.innings,
    );

    for (const slot of change.release) {
      if (reviewFirst) {
        draftSlots.push({ innings: slot.innings, over: slot.over });
      } else {
        const liveInnings = outcome.state.innings.find((i) => i.innings === slot.innings)!;
        const score = scoreInnings(
          outcome.state.balls.filter((b) => b.innings === slot.innings),
          config.oversPerInnings,
          targetFor(slot.innings, outcome.state.balls, config.oversPerInnings),
        );
        const generated = overQuestions(
          {
            innings: slot.innings,
            over: slot.over,
            oversPerInnings: config.oversPerInnings,
            battingTeam: liveInnings.battingTeam,
            runs: score.runs,
            legalBalls: score.legalBalls,
          },
          config.questionsPerOver,
        );
        generated.forEach((q, idx) => {
          questions.push({
            id: `q_${slot.innings}_${slot.over}_${idx + 1}`,
            innings: slot.innings,
            over: slot.over,
            market: q.market,
            params: q.params,
            status: 'active',
            hasResult: false,
            correctOption: null,
            closed: false,
          });
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

    state = { ...outcome.state, questions, draftSlots };
    return { ok: true as const, change, state };
  };

  /** Simulates the admin reviewing and pushing `over`'s draft questions to users at the current ball */
  const pushOver = (innings: 1 | 2, over: number, closesAtMs = NOW + 120_000, nowMs = NOW) => {
    const hasDraft = (state.draftSlots ?? []).some((s) => s.innings === innings && s.over === over);
    if (!hasDraft) return { ok: false as const, error: 'No draft waiting for this over' };
    if (!stillSendable(state, { innings, over }, closesAtMs, nowMs)) {
      return { ok: false as const, error: `Too late to push over ${over}` };
    }
    const liveInnings = state.innings.find((i) => i.innings === innings)!;
    const score = scoreInnings(
      state.balls.filter((b) => b.innings === innings),
      config.oversPerInnings,
      targetFor(innings, state.balls, config.oversPerInnings),
    );
    const generated = overQuestions(
      {
        innings,
        over,
        oversPerInnings: config.oversPerInnings,
        battingTeam: liveInnings.battingTeam,
        runs: score.runs,
        legalBalls: score.legalBalls,
      },
      config.questionsPerOver,
    );
    const pushed: MatchQuestion[] = generated.map((q, idx) => ({
      id: `q_${innings}_${over}_${idx + 1}`,
      innings,
      over,
      market: q.market,
      params: q.params,
      status: 'active',
      hasResult: false,
      correctOption: null,
      closed: false,
    }));
    state = {
      ...state,
      questions: [...state.questions, ...pushed],
      draftSlots: (state.draftSlots ?? []).filter((s) => !(s.innings === innings && s.over === over)),
    };
    return { ok: true as const, pushed, state };
  };

  return {
    get state() {
      return state;
    },
    step,
    pushOver,
  };
}

beforeEach(() => {
  db = createSupabaseMock();
  generatedIds = 0;
  logQuizAction.mockReset();
  createBroadcast.mockReset();
  __resetWordingUsageForTests();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('1. Pushing quizzes in any ball: first over, middle overs, and last over', () => {
  it('allows the admin to review and push Over 1 (first over) before ball 1, then locks Over 1 on ball 1', () => {
    const sim = createMatchSimulator(T20_CONFIG, true);
    const start = sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    expect(start.ok).toBe(true);
    // Over 1 is in drafts, not yet pushed to users
    expect(sim.state.questions).toHaveLength(0);
    expect(sim.state.draftSlots).toEqual([{ innings: 1, over: 1 }]);

    // Admin reviews and pushes Over 1 before the first ball
    const pushed = sim.pushOver(1, 1);
    expect(pushed.ok).toBe(true);
    expect(sim.state.questions.map((q) => [q.over, q.market, q.closed])).toEqual([
      [1, 'over_runs_at_least', false],
      [1, 'dots_at_least', false],
    ]);

    // First ball is a 6: Over 1's questions immediately lock, and Over 2's questions enter drafts
    const firstBall = sim.step(delivery(6));
    expect(firstBall.ok && firstBall.change.lock).toEqual(['q_1_1_1', 'q_1_1_2']);
    expect(sim.state.questions.every((q) => q.closed)).toBe(true);
    expect(sim.state.draftSlots).toEqual([{ innings: 1, over: 2 }]);
  });

  it.each([1, 2, 3, 4])(
    'allows the admin to push the next over quiz on legal ball %i of the current over (including after wides/no-balls)',
    (ballNumberToPushAt) => {
      const sim = createMatchSimulator(T20_CONFIG, true);
      sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
      sim.pushOver(1, 1);

      // Bowl legal balls up to `ballNumberToPushAt`, mixing in a wide and a no-ball
      for (let b = 1; b <= ballNumberToPushAt; b++) {
        if (b === 2) sim.step(delivery(0, 'wide', false));
        if (b === 3) sim.step(delivery(4, 'no_ball', false));
        sim.step(delivery(b === 1 ? 6 : 0, 'none', b === 2));
      }

      // At legal ball 1, 2, 3, or 4 (even with 2 extras bowled), Over 2 is still sendable!
      expect(stillSendable(sim.state, { innings: 1, over: 2 }, NOW + 90_000, NOW)).toBe(true);
      const pushResult = sim.pushOver(1, 2);
      expect(pushResult.ok).toBe(true);
      expect(sim.state.questions.filter((q) => q.over === 2 && !q.closed)).toHaveLength(2);

      // Finish the remaining balls of Over 1: at legal ball 5 Over 2 locks; at legal ball 6 Over 1 settles
      for (let b = ballNumberToPushAt + 1; b <= BALLS_PER_OVER; b++) {
        const res = sim.step(delivery(1));
        if (b === BALLS_PER_OVER - 1) {
          expect(res.ok && res.change.lock).toEqual(['q_1_2_1', 'q_1_2_2']);
        }
        if (b === BALLS_PER_OVER) {
          expect(res.ok && res.change.resolve.map((r) => r.id)).toEqual(['q_1_1_1', 'q_1_1_2']);
        }
      }
    },
  );

  it('blocks pushing once the 5th legal ball is bowled or the over has started', () => {
    const sim = createMatchSimulator(T20_CONFIG, true);
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    // Bowl 5 legal balls in Over 1 without pushing Over 2
    for (let b = 1; b <= 5; b++) sim.step(delivery(1));

    // Even before ball 5, if fewer than MIN_ANSWER_SECONDS remain before the lock deadline, pushing is blocked
    const earlySim = createMatchSimulator(T20_CONFIG, true);
    earlySim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    expect(
      stillSendable(earlySim.state, { innings: 1, over: 1 }, NOW + (MIN_ANSWER_SECONDS - 1) * 1000, NOW),
    ).toBe(false);
    expect(
      stillSendable(earlySim.state, { innings: 1, over: 1 }, NOW + MIN_ANSWER_SECONDS * 1000, NOW),
    ).toBe(true);

    // Over 1 is neither sendable (already started) nor is Over 2 sendable (5th legal ball bowled)
    expect(stillSendable(sim.state, { innings: 1, over: 1 }, NOW + 90_000, NOW)).toBe(false);
    expect(stillSendable(sim.state, { innings: 1, over: 2 }, NOW + 90_000, NOW)).toBe(false);
    expect(sim.pushOver(1, 1)).toEqual({ ok: false, error: 'Too late to push over 1' });
    expect(sim.pushOver(1, 2)).toEqual({ ok: false, error: 'Too late to push over 2' });
  });

  it('pushes and settles the last over (Over 20 in T20 and Over 10 in T10), opening nothing past the final over', () => {
    for (const config of [T20_CONFIG, T10_CONFIG]) {
      const lastOver = config.oversPerInnings;
      const sim = createMatchSimulator(config, true);
      sim.step({ type: 'start_innings', battingTeam: config.teams[0] });
      sim.pushOver(1, 1);

      // Play through to the penultimate over (Over 19 in T20, Over 9 in T10)
      for (let over = 1; over <= lastOver - 2; over++) {
        for (let b = 1; b <= BALLS_PER_OVER; b++) sim.step(delivery(1));
      }

      // Now in Over (lastOver - 1): bowl ball 1 (a 6) and ball 2 (a wicket)
      const ball1 = sim.step(delivery(6));
      expect(ball1.ok && ball1.change.release).toEqual([
        { innings: 1, over: lastOver, closesInSeconds: config.lockFallbackSeconds },
      ]);
      sim.step(delivery(0, 'none', true));

      // Admin pushes the last over's questions on ball 2 of the penultimate over
      const pushedLast = sim.pushOver(1, lastOver);
      expect(pushedLast.ok).toBe(true);
      expect(pushedLast.ok && pushedLast.pushed).toHaveLength(config.questionsPerOver);
      expect(pushedLast.ok && pushedLast.pushed.every((q) => q.over === lastOver)).toBe(true);

      // Complete the penultimate over (balls 3..6): ball 5 locks the last over's questions
      sim.step(delivery(0));
      sim.step(delivery(0));
      const ball5 = sim.step(delivery(0));
      expect(ball5.ok && ball5.change.lock).toEqual(
        Array.from({ length: config.questionsPerOver }, (_, i) => `q_1_${lastOver}_${i + 1}`),
      );
      sim.step(delivery(0));

      // Bowl the last over (Over 20 or Over 10): 6 fours = 24 runs -> settles the last over and ends the innings!
      for (let b = 1; b <= BALLS_PER_OVER; b++) {
        const res = sim.step(delivery(4));
        // No Over (lastOver + 1) is ever opened
        expect(res.ok && res.change.release).toEqual([]);
        if (b === BALLS_PER_OVER) {
          expect(res.ok && res.change.endInnings).toEqual({ innings: 1, reason: 'overs' });
          expect(res.ok && res.change.status).toBe('innings_break');
          expect(res.ok && res.change.resolve).toHaveLength(config.questionsPerOver);
        }
      }
      const settledLastOver = sim.state.questions.filter((q) => q.over === lastOver);
      expect(settledLastOver.every((q) => q.hasResult && q.correctOption !== null)).toBe(true);
    }
  });
});

describe('2. AI / Gemini mistake protection & mandatory Admin Review gate before pushing to users', () => {
  const CTX: WordingContext = {
    teams: ['Lahore Qalandars', 'Karachi Kings'],
    battingTeam: 'Lahore Qalandars',
    innings: 1,
    over: 5,
    runs: 38,
    wickets: 2,
    oversText: '3.2',
    target: null,
  };
  const QUESTIONS = overQuestions(
    { innings: 1, over: 5, oversPerInnings: 20, battingTeam: 'Lahore Qalandars', runs: 38, legalBalls: 20 },
    3,
  );
  const ENV = { MATCH_GEMINI_API_KEY: 'test-gemini-key', MATCH_GEMINI_RPM: '100' };

  it.each([
    [
      'empty English wording',
      { text: '   ', textRomanUrdu: 'Kya over 5 mein 11 ya zyada runs banenge?' },
      5,
      { line: 11 },
      'The English wording is empty',
    ],
    [
      'empty Roman Urdu wording',
      { text: 'Will over 5 go for 11 or more runs?', textRomanUrdu: '' },
      5,
      { line: 11 },
      'The Roman Urdu wording is empty',
    ],
    [
      'wording exceeding MAX_QUESTION_LENGTH (160 chars)',
      { text: `Over 5 for 11 runs? ${'a'.repeat(MAX_QUESTION_LENGTH)}`, textRomanUrdu: 'Kya over 5 mein 11 runs?' },
      5,
      { line: 11 },
      `The English wording is longer than ${MAX_QUESTION_LENGTH} characters`,
    ],
    [
      'wrong over number hallucinated by AI (over 15 instead of over 5)',
      { text: 'Will over 15 go for 11 or more runs?', textRomanUrdu: 'Kya over 5 mein 11 ya zyada runs banenge?' },
      5,
      { line: 11 },
      'The English wording must say which over it is about (5)',
    ],
    [
      'missing over number in Roman Urdu',
      { text: 'Will over 5 go for 11 or more runs?', textRomanUrdu: 'Kya is over mein 11 ya zyada runs banenge?' },
      5,
      { line: 11 },
      'The Roman Urdu wording must say which over it is about (5)',
    ],
    [
      'altered target line number (AI changed 11 runs to 12 runs)',
      { text: 'Will over 5 go for 12 or more runs?', textRomanUrdu: 'Kya over 5 mein 11 ya zyada runs banenge?' },
      5,
      { line: 11 },
      'The English wording must keep the line (11): change the line with its number box',
    ],
    [
      'embedded URL / link in wording',
      { text: 'Will over 5 go for 11 or more? Check https://stats.example.com', textRomanUrdu: 'Kya over 5 mein 11 runs?' },
      5,
      { line: 11 },
      "The English wording can't contain a link",
    ],
    [
      'betting / gambling terminology in English (bet, odds, stake, wager, gamble)',
      { text: 'What are the odds over 5 goes for 11 or more runs?', textRomanUrdu: 'Kya over 5 mein 11 runs?' },
      5,
      { line: 11 },
      "The English wording can't talk about betting",
    ],
    [
      'betting / gambling slang in Roman Urdu (jua, satta)',
      { text: 'Will over 5 go for 11 or more runs?', textRomanUrdu: 'Over 5 mein 11 runs? Jua mat lagao?' },
      5,
      { line: 11 },
      "The Roman Urdu wording can't talk about betting",
    ],
  ])('rejects poorly written or invalid quiz wording: %s', (_caseName, wording, over, params, expectedError) => {
    expect(wordingProblem(wording, over, params)).toBe(expectedError);
  });

  it('catches individual AI mistakes in a batch: keeps valid Gemini wordings and falls back to built-in templates for bad ones', async () => {
    // Question 0 (over_runs_at_least, line 11): valid Gemini wording
    // Question 1 (wicket_in_over): AI hallucinated wrong over (over 6 instead of over 5) -> rejected!
    // Question 2 (boundary_in_over): AI included a betting word ("wager") -> rejected!
    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      {
                        en: 'Lahore are 38/2: will over 5 go for 11 or more runs?',
                        ur: 'Lahore 38/2: kya over 5 mein 11 ya zyada runs banenge?',
                      },
                      {
                        en: 'Will a wicket fall in over 6?',
                        ur: 'Kya over 6 mein wicket giray ga?',
                      },
                      {
                        en: 'Wager time: will over 5 have a four or a six?',
                        ur: 'Kya over 5 mein chauka ya chhakka lagega?',
                      },
                    ]),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const results = await aiWording(CTX, QUESTIONS, ENV, mockFetch as never, NOW);
    expect(results).toEqual([
      {
        text: 'Lahore are 38/2: will over 5 go for 11 or more runs?',
        textRomanUrdu: 'Lahore 38/2: kya over 5 mein 11 ya zyada runs banenge?',
      },
      null,
      null,
    ]);
  });

  it('holds generated questions in admin review (drafts), hides them from users, blocks bad admin edits, and only pushes after review', async () => {
    vi.stubEnv('MATCH_GEMINI_API_KEY', '');
    const matchRow = {
      id: 'm1',
      quizId: 'quiz1',
      teamA: 'Lahore Qalandars',
      teamB: 'Karachi Kings',
      oversPerInnings: 20,
      questionsPerOver: 2,
      firstWindowSeconds: 120,
      lockFallbackSeconds: 150,
      status: 'setup',
      autoSend: false,
      version: 1,
      createdAt: '2026-10-30T14:00:00Z',
      Quiz: { title: 'Lahore Qalandars vs Karachi Kings', status: 'active' },
      drafts: [],
    };

    db.setTable('LiveMatch', { data: matchRow });
    db.setTable('MatchInnings', { data: [] });
    db.setTable('BallEvent', { data: [] });
    db.setTable('Question', { data: [] });
    db.setTable('QuizSettlement', { count: 0 });
    db.setTable('QuizAdminSettings', { data: { maxEntries: 2000 } });
    db.setTable('QuizEntryCount', { data: { entries: 0 } });
    db.setRpc('apply_match_change', { data: { success: true, version: 2 } });

    // Step 1: Admin starts innings -> questions are generated as drafts, NOT released
    const startRes = await applyMatchEvent(
      'm1',
      1,
      { type: 'start_innings', battingTeam: 'Lahore Qalandars' },
      'admin@example.test',
    );
    expect(startRes.ok).toBe(true);
    const savedChange = db.rpcCalls[0].args.p_change as { release: unknown[]; drafts: Array<Record<string, unknown>> };
    expect(savedChange.release).toEqual([]);
    expect(savedChange.drafts).toHaveLength(2);

    // Step 2: Simulate DB state with drafts waiting for review; verify public player feed sees NO questions
    db.setTable('LiveMatch', {
      data: { ...matchRow, status: 'live', version: 2, drafts: savedChange.drafts },
    });
    db.setTable('MatchInnings', {
      data: [{ innings: 1, battingTeam: 'Lahore Qalandars', endReason: null }],
    });
    const loadedForAdmin = await loadMatch('m1');
    expect(loadedForAdmin?.drafts).toHaveLength(2);
    expect(loadedForAdmin?.state.questions).toHaveLength(0);

    const publicBeforeReview = await buildPublicMatch('m1', NOW);
    expect(publicBeforeReview).not.toBeNull();
    expect(publicBeforeReview!.questions).toEqual([]);
    expect(JSON.stringify(publicBeforeReview)).not.toContain('drafts');

    // Step 3: Admin tries to push a poorly written edit (missing over number / mismatched line) -> blocked!
    const badEditRes = await sendDrafts(
      'm1',
      [
        {
          id: String(savedChange.drafts[0].id),
          text: 'Will Lahore score 12 or more runs in this over?',
          textRomanUrdu: 'Kya over 1 mein 8 ya zyada runs banenge?',
        },
      ],
      'admin@example.test',
    );
    expect(badEditRes).toEqual({
      ok: false,
      status: 400,
      code: 'wording',
      error: 'The English wording must say which over it is about (1)',
    });
    // RPC was NOT called for the bad edit
    expect(db.rpcCalls).toHaveLength(1);

    // Step 4: Admin reviews, customizes wording properly, and approves push -> released to players!
    db.setRpc('apply_match_change', { data: { success: true, version: 3 } });
    const goodSendRes = await sendDrafts(
      'm1',
      [
        {
          id: String(savedChange.drafts[0].id),
          text: 'Lahore openers ready: will over 1 go for 10 or more runs?',
          textRomanUrdu: 'Lahore tayyar: kya over 1 mein 10 ya zyada runs banenge?',
          line: 10,
        },
      ],
      'admin@example.test',
    );
    expect(goodSendRes.ok).toBe(true);
    const releaseCall = db.rpcCalls[1].args.p_change as { release: Array<Record<string, unknown>>; drafts: unknown[] };
    expect(releaseCall.release).toEqual([
      expect.objectContaining({
        id: savedChange.drafts[0].id,
        over: 1,
        market: 'over_runs_at_least',
        params: { line: 10 },
        text: 'Lahore openers ready: will over 1 go for 10 or more runs?',
        textRomanUrdu: 'Lahore tayyar: kya over 1 mein 10 ya zyada runs banenge?',
      }),
    ]);
    // Only the second draft remains waiting
    expect(releaseCall.drafts).toHaveLength(1);
  });
});

describe('3. Scoreboard context training Gemini (Ball 1 = 6, another ball = wicket), no repeats, and non-searchable questions', () => {
  it('feeds live scoreboard context (Ball 1 = 6, Ball 2 = wicket) to Gemini and scales runs lines from the scoreboard', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      {
                        en: 'After a six and a wicket in over 1, will over 2 go for 8 or more runs?',
                        ur: 'Chhakke aur wicket ke baad, kya over 2 mein 8 ya zyada runs banenge?',
                      },
                      {
                        en: 'Another breakthrough coming: will a wicket fall in over 2?',
                        ur: 'Kya over 2 mein aik aur wicket giray ga?',
                      },
                    ]),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('MATCH_GEMINI_API_KEY', 'live-key');

    // Scoreboard has Ball 1 = 6 runs and Ball 2 = Wicket (score: 6/1 in 0.2 overs)
    const balls: Ball[] = [
      { id: 'b1', innings: 1, seq: 1, runs: 6, extra: 'none', extraRuns: 0, wicket: false },
      { id: 'b2', innings: 1, seq: 2, runs: 0, extra: 'none', extraRuns: 0, wicket: true },
    ];
    const score = scoreInnings(balls, 20, null);
    expect(score).toMatchObject({ runs: 6, wickets: 1, legalBalls: 2, oversText: '0.2' });
    expect(score.overs[0].balls.map(ballLabel)).toEqual(['6', 'W']);

    const questions = overQuestions(
      {
        innings: 1,
        over: 2,
        oversPerInnings: 20,
        battingTeam: 'Lahore Qalandars',
        runs: score.runs,
        legalBalls: score.legalBalls,
      },
      2,
    );
    const worded = await aiWording(
      {
        teams: ['Lahore Qalandars', 'Karachi Kings'],
        battingTeam: 'Lahore Qalandars',
        innings: 1,
        over: 2,
        runs: score.runs,
        wickets: score.wickets,
        oversText: score.oversText,
        target: null,
      },
      questions,
    );

    expect(worded).toEqual([
      {
        text: 'After a six and a wicket in over 1, will over 2 go for 8 or more runs?',
        textRomanUrdu: 'Chhakke aur wicket ke baad, kya over 2 mein 8 ya zyada runs banenge?',
      },
      {
        text: 'Another breakthrough coming: will a wicket fall in over 2?',
        textRomanUrdu: 'Kya over 2 mein aik aur wicket giray ga?',
      },
    ]);

    // Verify the exact scoreboard payload sent to Gemini
    const sentPayload = JSON.parse(
      JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).contents[0].parts[0].text,
    );
    expect(sentPayload.match).toEqual({
      teams: ['Lahore Qalandars', 'Karachi Kings'],
      battingTeam: 'Lahore Qalandars',
      innings: 1,
      score: '6/1',
      overs: '0.2',
      target: null,
    });

    // Verify runsLine adapts as the scoreboard evolves:
    // - After 2 high-scoring overs (30 runs off 12 balls = 15 RPO) -> capped at 14
    expect(runsLine({ runs: 30, legalBalls: 12, oversPerInnings: 20 })).toBe(14);
    // - After wicket-maiden pressure (9 runs off 18 balls = 3 RPO) -> floored at 5
    expect(runsLine({ runs: 9, legalBalls: 18, oversPerInnings: 20 })).toBe(5);
    // - Moderate scoreboard (22 runs off 12 balls = 11 RPO) -> 11
    expect(runsLine({ runs: 22, legalBalls: 12, oversPerInnings: 20 })).toBe(11);
  });

  it('guarantees no quiz question is ever repeated within an over, across consecutive overs, or across balls', () => {
    const seenTextsInnings1 = new Set<string>();
    const seenRomanUrduInnings1 = new Set<string>();
    let previousSecondaryMarket = '';

    for (let over = 1; over <= 20; over++) {
      const qs = overQuestions(
        {
          innings: 1,
          over,
          oversPerInnings: 20,
          battingTeam: 'Lahore Qalandars',
          runs: over * 8,
          legalBalls: (over - 1) * 6,
        },
        3,
      );
      // 1. Within an over: all 3 markets are unique
      const markets = qs.map((q) => q.market);
      expect(new Set(markets).size).toBe(3);

      // 2. Across consecutive overs: the secondary market (qs[1]) always rotates
      expect(qs[1].market).not.toBe(previousSecondaryMarket);
      previousSecondaryMarket = qs[1].market;

      // 3. Across the entire innings: no English or Roman Urdu question text is ever repeated
      for (const q of qs) {
        expect(seenTextsInnings1.has(q.text)).toBe(false);
        expect(seenRomanUrduInnings1.has(q.textRomanUrdu)).toBe(false);
        seenTextsInnings1.add(q.text);
        seenRomanUrduInnings1.add(q.textRomanUrdu);
      }
    }
    expect(seenTextsInnings1.size).toBe(60);

    // 4. Across balls of the same over: once Over 2 is drafted or released on Ball 1, Balls 2..6 never re-release Over 2
    const sim = createMatchSimulator(T20_CONFIG, true);
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });
    const b1 = sim.step(delivery(6));
    expect(b1.ok && b1.change.release).toEqual([{ innings: 1, over: 2, closesInSeconds: 150 }]);
    for (let b = 2; b <= 6; b++) {
      const nextBall = sim.step(delivery(1));
      expect(nextBall.ok && nextBall.change.release).toEqual([]);
    }
  });

  it('ensures every question is a non-searchable future-over prediction that locks before its over begins', () => {
    for (let over = 1; over <= 20; over++) {
      const qs = overQuestions(
        {
          innings: 1,
          over,
          oversPerInnings: 20,
          battingTeam: 'Lahore Qalandars',
          runs: (over - 1) * 8,
          legalBalls: (over - 1) * 6,
        },
        3,
      );
      for (const q of qs) {
        // Only future-over settlement markets (never trivia or historical facts)
        expect(MARKET_NAMES).toContain(q.market);
        // Binary Yes/No prediction options
        expect(q.options).toEqual(YES_NO);
        expect(q.options.map(romanUrduOption)).toEqual(['Haan', 'Nahi']);
        // Explicitly anchored to the unbowled future over number
        expect(q.text).toMatch(new RegExp(`\\bover ${over}\\b`, 'i'));
        expect(q.textRomanUrdu).toMatch(new RegExp(`\\bover ${over}\\b`, 'i'));
        // Ends with a question mark
        expect(q.text.endsWith('?')).toBe(true);
        expect(q.textRomanUrdu.endsWith('?')).toBe(true);
        // Passes wordingProblem validation
        expect(wordingProblem(q, over, q.params)).toBeNull();
      }
    }
  });
});

describe('4. Scoreboard manual updating system & full correction lifecycle', () => {
  it('updates the scoreboard manually across all delivery types and recalculates scores and settlements when any ball is corrected or undone', () => {
    const sim = createMatchSimulator(T20_CONFIG, false);
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });

    // Over 1: Ball 1 = 6, Ball 2 = Wicket, Ball 3 = Wide, Ball 4 = No-ball + 4, Ball 5 = 2 Leg-byes, Ball 6 = 1 Bye, Ball 7 = 0, Ball 8 = 0
    sim.step(delivery(6, 'none', false)); // 1.1: 6
    sim.step(delivery(0, 'none', true)); // 1.2: W
    sim.step(delivery(0, 'wide', false)); // wide (+1)
    sim.step(delivery(4, 'no_ball', false)); // no-ball (+5)
    sim.step(delivery(2, 'leg_bye', false)); // 1.3: 2Lb
    sim.step(delivery(1, 'bye', false)); // 1.4: 1B
    sim.step(delivery(0, 'none', false)); // 1.5: 0 (locks Over 2 questions)
    const over1End = sim.step(delivery(0, 'none', false)); // 1.6: 0 (settles Over 1 questions)

    const scoreAfterOver1 = scoreInnings(sim.state.balls, 20, null);
    // Total runs: 6 + 0 + 1 (wide) + 5 (4+nb) + 2 + 1 + 0 + 0 = 15 runs, 1 wicket, 6 legal balls (1.0 overs)
    expect(scoreAfterOver1).toMatchObject({ runs: 15, wickets: 1, legalBalls: 6, oversText: '1.0' });
    expect(scoreAfterOver1.overs[0].balls.map(ballLabel)).toEqual(['6', 'W', 'Wd', '4Nb', '2Lb', '1B', '0', '0']);

    // Over 1's questions:
    // - q_1_1_1: over_runs_at_least (line 8) -> 15 >= 8 -> Yes (0)
    // - q_1_1_2: dots_at_least (line 3) -> legal balls with 0 total runs: Ball 2 (W, 0), Ball 7 (0), Ball 8 (0) = 3 dots -> Yes (0)
    expect(over1End.ok && over1End.change.resolve).toEqual([
      { id: 'q_1_1_1', option: 0 },
      { id: 'q_1_1_2', option: 0 },
    ]);

    // Manual correction on scoreboard: Ball 1 (`ball_1`, which was 6) was actually 0, and Ball 4 (`ball_4`, which was 4Nb) was a plain 1!
    const fix1 = sim.step({ type: 'correct_ball', ballId: 'ball_1', runs: 0, extra: 'none', wicket: false });
    expect(fix1.ok).toBe(true);
    const fix2 = sim.step({ type: 'correct_ball', ballId: 'ball_4', runs: 1, extra: 'none', wicket: false });
    expect(fix2.ok).toBe(true);

    // Since ball_4 changed from no_ball to legal ball, Over 1 now had 7 legal balls, so its 6th legal ball was ball_7
    // And Over 1's runs are now: 0 + 0 + 1(Wd) + 1 + 2(Lb) + 1(B) + 0 = 5 runs (< 8!)
    // So q_1_1_1 (over_runs_at_least 8) automatically flips from Yes (0) to No (1)!
    const q1 = sim.state.questions.find((q) => q.id === 'q_1_1_1')!;
    expect(q1).toMatchObject({ hasResult: true, correctOption: 1 });
  });

  it('supports manual innings controls (end, resume, remove) and match controls (close/reopen answers, abandon/restore)', () => {
    const sim = createMatchSimulator(T20_CONFIG, false);
    sim.step({ type: 'start_innings', battingTeam: 'Lahore Qalandars' });

    // Close answers early -> Reopen answers while Over 1 hasn't started
    sim.step({ type: 'close_answers' });
    expect(sim.state.questions.every((q) => q.closed)).toBe(true);
    expect(reopenable(sim.state)).toHaveLength(2);
    sim.step({ type: 'reopen_answers' });
    expect(sim.state.questions.every((q) => !q.closed)).toBe(true);

    // Remove innings 1 before any ball is bowled (wrong team sent in) and start with Karachi Kings
    sim.step({ type: 'remove_innings' });
    expect(sim.state.status).toBe('setup');
    expect(sim.state.innings).toHaveLength(0);
    expect(sim.state.questions).toHaveLength(0);

    sim.step({ type: 'start_innings', battingTeam: 'Karachi Kings' });
    sim.step(delivery(4));
    sim.step({ type: 'end_innings' });
    expect(sim.state.status).toBe('innings_break');
    expect(sim.state.questions.every((q) => q.status === 'paused')).toBe(true);

    // Resume manually ended innings -> questions return to active
    sim.step({ type: 'resume_innings' });
    expect(sim.state.status).toBe('live');
    expect(sim.state.questions.every((q) => q.status === 'active')).toBe(true);

    // Abandon match -> Restore match
    sim.step({ type: 'abandon' });
    expect(sim.state.status).toBe('abandoned');
    expect(sim.state.questions.every((q) => q.status === 'paused')).toBe(true);
    sim.step({ type: 'restore' });
    expect(sim.state.status).toBe('live');
    expect(sim.state.questions.every((q) => q.status === 'active')).toBe(true);
  });
});

describe('5. Quick actions: customizing, deleting/skipping, reverting, and reviewing questions', () => {
  it('customizes question text and line (preserving over numbers), settles against the customized line, skips questions, and reverts to built-in wording', async () => {
    // 1. Test `changeLine` quick customization when over number == old line number (Over 8, line 8 -> 12)
    const enOriginal = 'Lahore Qalandars: will over 8 go for 8 or more runs?';
    const urOriginal = 'Lahore Qalandars: kya over 8 mein 8 ya us se zyada runs banenge?';
    const enCustomized = changeLine(enOriginal, 8, 12);
    const urCustomized = changeLine(urOriginal, 8, 12);
    expect(enCustomized).toBe('Lahore Qalandars: will over 8 go for 12 or more runs?');
    expect(urCustomized).toBe('Lahore Qalandars: kya over 8 mein 12 ya us se zyada runs banenge?');
    expect(wordingProblem({ text: enCustomized, textRomanUrdu: urCustomized }, 8, { line: 12 })).toBeNull();

    // 2. Verify that when an admin customizes the line from 8 to 12, an over with 10 runs settles as No (1) instead of Yes (0)
    const tenRunOver = splitOvers([
      { id: '1', innings: 1, seq: 1, runs: 4, extra: 'none', extraRuns: 0, wicket: false },
      { id: '2', innings: 1, seq: 2, runs: 4, extra: 'none', extraRuns: 0, wicket: false },
      { id: '3', innings: 1, seq: 3, runs: 2, extra: 'none', extraRuns: 0, wicket: false },
      { id: '4', innings: 1, seq: 4, runs: 0, extra: 'none', extraRuns: 0, wicket: false },
      { id: '5', innings: 1, seq: 5, runs: 0, extra: 'none', extraRuns: 0, wicket: false },
      { id: '6', innings: 1, seq: 6, runs: 0, extra: 'none', extraRuns: 0, wicket: false },
    ])[0];
    expect(resolveMarket('over_runs_at_least', { line: 8 }, tenRunOver)).toBe(0); // Yes at default line 8
    expect(resolveMarket('over_runs_at_least', { line: 12 }, tenRunOver)).toBe(1); // No at customized line 12

    // 3. Test skipping/deleting a draft question via `skipDrafts`: it never reaches players and blocks regeneration
    const draft1 = {
      id: 'd_runs',
      innings: 1 as const,
      over: 8,
      market: 'over_runs_at_least',
      params: { line: 8 },
      options: ['Yes', 'No'],
      text: 'Gemini wording: will over 8 go for 8 or more runs?',
      textRomanUrdu: 'Gemini: kya over 8 mein 8 ya zyada runs banenge?',
      plainText: enOriginal,
      plainTextRomanUrdu: urOriginal,
      ai: true,
      closesAt: new Date(NOW + 100_000).toISOString(),
    };
    const draft2 = {
      id: 'd_wicket',
      innings: 1 as const,
      over: 8,
      market: 'wicket_in_over',
      params: {},
      options: ['Yes', 'No'],
      text: 'Will a wicket fall in over 8?',
      textRomanUrdu: 'Kya over 8 mein koi wicket giray ga?',
      plainText: 'Will a wicket fall in over 8?',
      plainTextRomanUrdu: 'Kya over 8 mein koi wicket giray ga?',
      ai: false,
      closesAt: new Date(NOW + 100_000).toISOString(),
    };

    const row = {
      id: 'm1',
      quizId: 'quiz1',
      teamA: 'Lahore Qalandars',
      teamB: 'Karachi Kings',
      oversPerInnings: 20,
      questionsPerOver: 2,
      firstWindowSeconds: 120,
      lockFallbackSeconds: 150,
      status: 'live',
      autoSend: false,
      version: 5,
      createdAt: '2026-10-30T14:00:00Z',
      Quiz: { title: 'Lahore Qalandars vs Karachi Kings', status: 'active' },
      drafts: [draft1, draft2],
    };

    db.setTable('LiveMatch', { data: row });
    db.setTable('MatchInnings', { data: [{ innings: 1, battingTeam: 'Lahore Qalandars', endReason: null }] });
    db.setTable('BallEvent', { data: [] });
    db.setTable('Question', { data: [] });
    db.setTable('QuizSettlement', { count: 0 });
    db.setRpc('apply_match_change', { data: { success: true, version: 6 } });

    // Admin skips draft2 (deletes it from the over's push)
    const skipRes = await skipDrafts('m1', ['d_wicket'], 'admin@example.test');
    expect(skipRes.ok).toBe(true);
    expect(db.rpcCalls[0].args.p_change).toEqual({
      drafts: [draft1, { ...draft2, skipped: true }],
      admin: 'admin@example.test',
    });

    // Admin reverts draft1 to built-in wording (`plainText` / `plainTextRomanUrdu`) or customizes its line to 12 and sends it
    const sendRes = await sendDrafts(
      'm1',
      [{ id: 'd_runs', text: enCustomized, textRomanUrdu: urCustomized, line: 12 }],
      'admin@example.test',
    );
    expect(sendRes.ok).toBe(true);
    expect(db.rpcCalls[1].args.p_change).toEqual({
      release: [
        {
          id: 'd_runs',
          text: enCustomized,
          textRomanUrdu: urCustomized,
          options: '["Yes","No"]',
          market: 'over_runs_at_least',
          params: { line: 12 },
          innings: 1,
          over: 8,
          closesInSeconds: 100,
        },
      ],
      drafts: [draft2],
      admin: 'admin@example.test',
    });

    // Quick actions for match visibility, autoSend toggle, and player cap
    db.setTable('Quiz', { data: [{ id: 'quiz1' }] });
    db.setTable('QuizAdminSettings', { data: { maxEntries: 2000 } });
    db.setTable('QuizEntryCount', { data: { entries: 25 } });
    expect((await setAutoSend('m1', true, 'admin@example.test')).ok).toBe(true);
    expect((await setMaxEntries('m1', 5000, 'admin@example.test')).ok).toBe(true);
    expect((await setPublished('m1', false, 'admin@example.test')).ok).toBe(true);
  });

  it('tracks player-side state: openOver, scoreLine, and localStorage deduplication so answered overs never repeat', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });

    const feedQuestions = [
      {
        id: 'q_over1_runs',
        innings: 1 as const,
        over: 1,
        text: 'Lahore Qalandars: will over 1 go for 8 or more runs?',
        textRomanUrdu: 'Lahore Qalandars: kya over 1 mein 8 ya us se zyada runs banenge?',
        options: ['Yes', 'No'],
        optionsRomanUrdu: ['Haan', 'Nahi'],
        state: 'open' as const,
        closesAt: new Date(NOW + 90_000).toISOString(),
        correctOption: null,
      },
    ];

    expect(openOver(feedQuestions, NOW)).toMatchObject({ innings: 1, over: 1 });
    expect(
      scoreLine({
        match: { title: 'Lahore vs Karachi' } as never,
        innings: [
          {
            innings: 1,
            battingTeam: 'Lahore',
            endReason: null,
            runs: 6,
            wickets: 1,
            oversText: '0.2',
            target: null,
            overs: [],
          },
        ],
      }),
    ).toBe('Lahore 6/1 (0.2 overs)');

    rememberAnswered('user_1', 'quiz1', new Set(['q_over1_runs']));
    expect(readAnswered('user_1', 'quiz1').has('q_over1_runs')).toBe(true);
    expect(
      matchView(
        {
          row: {
            id: 'm1',
            quizId: 'quiz1',
            teamA: 'Lahore',
            teamB: 'Karachi',
            oversPerInnings: 20,
            questionsPerOver: 2,
            firstWindowSeconds: 120,
            lockFallbackSeconds: 150,
            status: 'live',
            autoSend: false,
            version: 1,
            createdAt: '2026-10-30T14:00:00Z',
          },
          title: 'Lahore vs Karachi',
          published: true,
          players: { entries: 1, maxEntries: 2000 },
          settled: false,
          questions: [],
          drafts: [],
          state: emptyState(),
        },
        NOW,
      ).match.published,
    ).toBe(true);
    expect(planQuestions(emptyState()).release).toEqual([]);
  });
});
