/**
 * Migration 06-20261029120000: match mode. create_live_match, apply_match_change (version check, balls,
 * innings, new questions, closing, results, void and back), submit_quiz_attempt's free entry and
 * per-question close times, and no settling of an unfinished match.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDailyPayment,
  createPool,
  createPrize,
  createQuestions,
  createQuiz,
  createUser,
  errorAs,
  player,
  queryAs,
  resetData,
  serviceRole,
  setWalletEnabled,
  submitQuiz,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = fs.readFileSync(path.join(__dirname, 'schema', '06-20261029120000_match_mode.sql'), 'utf8');
const ADMIN = 'admin@example.test';

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, true);
});

const asServer = async (sql: string, params: unknown[] = []) => (await queryAs(pool, serviceRole, sql, params))[0];

async function newMatch(overs = 20) {
  const { r } = await asServer(`SELECT create_live_match('Lahore Qalandars', 'Karachi Kings', $1, 2, $2) AS r`, [overs, ADMIN]);
  expect(r.success).toBe(true);
  return r as { matchId: string; quizId: string };
}

const version = async (matchId: string) => (await pool.query(`SELECT version FROM "LiveMatch" WHERE id = $1`, [matchId])).rows[0].version;
const apply = async (matchId: string, change: object, at?: number) =>
  (await asServer(`SELECT apply_match_change($1, $2, $3::jsonb) AS r`, [matchId, at ?? await version(matchId), JSON.stringify({ admin: ADMIN, ...change })])).r;
const question = async (id: string) => (await pool.query(`SELECT * FROM "Question" WHERE id = $1`, [id])).rows[0];

const release = (id: string, over: number, closesInSeconds = 120) => ({
  id, text: `Will over ${over} go for 8 or more runs?`, options: JSON.stringify(['Yes', 'No']), market: 'over_runs_at_least',
  params: { line: 8 }, innings: 1, over, closesInSeconds,
});

/** A match with innings 1 started and over 1's two questions out; the quiz is live so players can answer */
async function liveMatch() {
  const m = await newMatch();
  await pool.query(`UPDATE "Quiz" SET status = 'active', "pushedAt" = now() WHERE id = $1`, [m.quizId]);
  const r = await apply(m.matchId, {
    startInnings: { innings: 1, battingTeam: 'Lahore Qalandars' },
    release: [release('q1', 1), { ...release('q2', 1), market: 'wicket_in_over', params: {} }],
    status: 'live',
  });
  expect(r).toEqual({ success: true, version: 1 });
  return m;
}

const ball = (seq: number, extra: Partial<{ runs: number; extra: string; extraRuns: number; wicket: boolean }> = {}) =>
  ({ id: `b${seq}-${Math.random().toString(36).slice(2)}`, innings: 1, seq, runs: 1, extra: 'none', extraRuns: 0, wicket: false, ...extra });

describe('create_live_match', () => {
  it('makes a draft prediction quiz with free entry, and its match', async () => {
    const m = await newMatch(10);
    const { rows: [quiz] } = await pool.query(`SELECT title, status, "quizType", "freeEntry", duration FROM "Quiz" WHERE id = $1`, [m.quizId]);
    expect(quiz).toEqual({ title: 'Lahore Qalandars vs Karachi Kings', status: 'draft', quizType: 'predictable', freeEntry: true, duration: 120 });
    const { rows: [match] } = await pool.query(`SELECT * FROM "LiveMatch" WHERE id = $1`, [m.matchId]);
    expect(match).toMatchObject({
      quizId: m.quizId, teamA: 'Lahore Qalandars', teamB: 'Karachi Kings', oversPerInnings: 10, questionsPerOver: 2,
      firstWindowSeconds: 120, lockFallbackSeconds: 150, status: 'setup', version: 0, createdBy: ADMIN,
    });
  });

  it('checks the teams, the overs and who made it', async () => {
    const make = async (a: string, b: string, overs: number, perOver: number, admin = ADMIN) =>
      (await asServer(`SELECT create_live_match($1, $2, $3, $4, $5) AS r`, [a, b, overs, perOver, admin])).r;
    for (const bad of [
      await make('L', 'Karachi Kings', 20, 2),
      await make('Lahore', ' lahore ', 20, 2),
      await make('Lahore', 'Karachi', 0, 2),
      await make('Lahore', 'Karachi', 20, 4),
      await make('Lahore', 'Karachi', 20, 2, ' '),
    ]) {
      expect(bad).toMatchObject({ success: false, code: 'invalid' });
    }
    expect((await pool.query(`SELECT count(*)::int AS n FROM "LiveMatch"`)).rows[0].n).toBe(0);
  });
});

describe('apply_match_change', () => {
  it('starts an innings and opens questions that close on their own', async () => {
    const m = await liveMatch();
    const q1 = await question('q1');
    expect(q1).toMatchObject({
      quizId: m.quizId, text: 'Will over 1 go for 8 or more runs?', options: '["Yes","No"]', status: 'active',
      hasCorrectAnswer: false, matchInnings: 1, matchOver: 1, market: 'over_runs_at_least', marketParams: { line: 8 },
    });
    const secondsLeft = (new Date(q1.closesAt).getTime() - Date.now()) / 1000;
    expect(secondsLeft).toBeGreaterThan(100);
    expect(secondsLeft).toBeLessThanOrEqual(121);
    const { rows: [innings] } = await pool.query(`SELECT * FROM "MatchInnings" WHERE "matchId" = $1`, [m.matchId]);
    expect(innings).toMatchObject({ innings: 1, battingTeam: 'Lahore Qalandars', endedAt: null, endReason: null });
    expect((await pool.query(`SELECT status FROM "LiveMatch" WHERE id = $1`, [m.matchId])).rows[0].status).toBe('live');
  });

  it('refuses a change made against an older version, applying nothing', async () => {
    const m = await liveMatch();
    const stale = await apply(m.matchId, { ball: ball(1) }, 0);
    expect(stale).toMatchObject({ success: false, code: 'stale', version: 1 });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "BallEvent"`)).rows[0].n).toBe(0);
    expect(await apply('nope', {}, 0)).toMatchObject({ success: false, code: 'not_found' });
    expect(await asServer(`SELECT apply_match_change($1, 1, '[]'::jsonb) AS r`, [m.matchId])).toEqual({ r: expect.objectContaining({ code: 'invalid' }) });
  });

  it('records balls and undoes the last one, which frees its number', async () => {
    const m = await liveMatch();
    const first = ball(1, { runs: 4 });
    await apply(m.matchId, { ball: first });
    await apply(m.matchId, { ball: ball(2, { extra: 'wide', runs: 0, extraRuns: 1 }) });
    const { rows } = await pool.query(`SELECT seq, runs, extra, "extraRuns", wicket, "createdBy" FROM "BallEvent" ORDER BY seq`);
    expect(rows).toEqual([
      { seq: 1, runs: 4, extra: 'none', extraRuns: 0, wicket: false, createdBy: ADMIN },
      { seq: 2, runs: 0, extra: 'wide', extraRuns: 1, wicket: false, createdBy: ADMIN },
    ]);

    const { rows: [last] } = await pool.query(`SELECT id FROM "BallEvent" WHERE seq = 2`);
    expect(await apply(m.matchId, { undoBall: last.id })).toMatchObject({ success: true });
    expect(await apply(m.matchId, { undoBall: last.id })).toMatchObject({ success: false, code: 'invalid' });
    expect(await apply(m.matchId, { ball: ball(2, { wicket: true, runs: 0 }) })).toMatchObject({ success: true });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "BallEvent" WHERE "undoneAt" IS NULL`)).rows[0].n).toBe(2);
  });

  it('applies all of a change or none of it', async () => {
    const m = await liveMatch();
    const before = await version(m.matchId);
    // A good ball and a bad question: neither is kept
    const r = await apply(m.matchId, { ball: ball(1), release: [{ ...release('q3', 2), market: 'Not A Market' }] });
    expect(r).toMatchObject({ success: false, code: 'invalid' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "BallEvent"`)).rows[0].n).toBe(0);
    expect(await question('q3')).toBeUndefined();
    expect(await version(m.matchId)).toBe(before);
    // A ball for an innings that hasn't started, a duplicate number, a bad extra
    expect(await apply(m.matchId, { ball: { ...ball(1), innings: 2 } })).toMatchObject({ code: 'invalid' });
    await apply(m.matchId, { ball: ball(1) });
    expect(await apply(m.matchId, { ball: ball(1) })).toMatchObject({ code: 'invalid' });
    expect(await apply(m.matchId, { ball: ball(2, { extra: 'beamer' }) })).toMatchObject({ code: 'invalid' });
    // Options must be the JSON text of a list
    for (const options of ['"Yes"', 'not json', null]) {
      expect(await apply(m.matchId, { release: [{ ...release('q4', 2), options }] })).toMatchObject({ code: 'invalid' });
    }
    expect(await question('q4')).toBeUndefined();
  });

  it('closes questions, settles them, voids them and takes either back, with the answers following', async () => {
    const m = await liveMatch();
    const user = await createUser(pool);
    await submitQuiz(pool, player(user.id), { userId: user.id, quizId: m.quizId, answers: [{ questionId: 'q1', selectedOption: 0 }, { questionId: 'q2', selectedOption: 1 }] });
    const isCorrect = async (questionId: string) =>
      (await pool.query(`SELECT "isCorrect" FROM "QuestionAttempt" WHERE "questionId" = $1`, [questionId])).rows[0].isCorrect;

    await apply(m.matchId, { lock: ['q1'] });
    expect(new Date((await question('q1')).closesAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date((await question('q2')).closesAt).getTime()).toBeGreaterThan(Date.now());

    await apply(m.matchId, { resolve: [{ id: 'q1', option: 0 }, { id: 'q2', option: 0 }] });
    expect(await question('q1')).toMatchObject({ hasCorrectAnswer: true, correctOption: 0, status: 'active' });
    expect([await isCorrect('q1'), await isCorrect('q2')]).toEqual([true, false]);

    // An undone ball takes a result back, or turns it into a void, and back again
    await apply(m.matchId, { void: ['q1'], pending: ['q2'] });
    expect(await question('q1')).toMatchObject({ status: 'paused', hasCorrectAnswer: false, correctOption: null });
    expect(await question('q2')).toMatchObject({ status: 'active', hasCorrectAnswer: false, correctOption: null });
    expect([await isCorrect('q1'), await isCorrect('q2')]).toEqual([false, false]);
    await apply(m.matchId, { pending: ['q1'] });
    expect(await question('q1')).toMatchObject({ status: 'active', hasCorrectAnswer: false });
  });

  it('closes every open question of the match at once, and touches no other quiz', async () => {
    const m = await liveMatch();
    const otherQuiz = await createQuiz(pool);
    const [other] = await createQuestions(pool, otherQuiz, 1);
    await apply(m.matchId, { closeAll: true, resolve: [{ id: other, option: 1 }], void: [other], lock: [other] });
    for (const id of ['q1', 'q2']) expect(new Date((await question(id)).closesAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(await question(other)).toMatchObject({ hasCorrectAnswer: false, status: 'active', closesAt: null });
  });

  it('ends an innings, and reopens only one the balls ended', async () => {
    const m = await liveMatch();
    await apply(m.matchId, { endInnings: { innings: 1, reason: 'all_out' }, status: 'innings_break' });
    let row = (await pool.query(`SELECT "endedAt", "endReason" FROM "MatchInnings" WHERE "matchId" = $1`, [m.matchId])).rows[0];
    expect(row.endReason).toBe('all_out');
    await apply(m.matchId, { reopenInnings: { innings: 1 }, status: 'live' });
    row = (await pool.query(`SELECT "endedAt", "endReason" FROM "MatchInnings" WHERE "matchId" = $1`, [m.matchId])).rows[0];
    expect(row).toEqual({ endedAt: null, endReason: null });

    await apply(m.matchId, { endInnings: { innings: 1, reason: 'admin' } });
    await apply(m.matchId, { reopenInnings: { innings: 1 } });
    expect((await pool.query(`SELECT "endReason" FROM "MatchInnings" WHERE "matchId" = $1`, [m.matchId])).rows[0].endReason).toBe('admin');
    expect(await apply(m.matchId, { endInnings: { innings: 1, reason: 'rain' } })).toMatchObject({ success: true });
    expect(await apply(m.matchId, { status: 'paused' })).toMatchObject({ code: 'invalid' });
  });
});

describe('submit_quiz_attempt', () => {
  it('needs no day pass for a free-entry quiz, while other quizzes still do', async () => {
    const m = await liveMatch();
    const user = await createUser(pool);
    const r = await submitQuiz(pool, player(user.id), { userId: user.id, quizId: m.quizId, answers: [{ questionId: 'q1', selectedOption: 1 }] });
    expect(r).toMatchObject({ success: true, answersSubmitted: 1 });

    const paidQuiz = await createQuiz(pool);
    const [question1] = await createQuestions(pool, paidQuiz, 1);
    expect(await submitQuiz(pool, player(user.id), { userId: user.id, quizId: paidQuiz, answers: [{ questionId: question1, selectedOption: 1 }] }))
      .toMatchObject({ success: false, code: 'payment_required' });
    await createDailyPayment(pool, user.id);
    expect(await submitQuiz(pool, player(user.id), { userId: user.id, quizId: paidQuiz, answers: [{ questionId: question1, selectedOption: 1 }] }))
      .toMatchObject({ success: true });
  });

  it("refuses an answer once a question's close time has passed", async () => {
    const m = await liveMatch();
    const user = await createUser(pool);
    await apply(m.matchId, { lock: ['q1'] });
    expect(await submitQuiz(pool, player(user.id), { userId: user.id, quizId: m.quizId, answers: [{ questionId: 'q1', selectedOption: 1 }] }))
      .toMatchObject({ success: false, code: 'invalid' });
    expect(await submitQuiz(pool, player(user.id), { userId: user.id, quizId: m.quizId, answers: [{ questionId: 'q2', selectedOption: 1 }] }))
      .toMatchObject({ success: true });
  });

  it("has no quiz-wide window for a match, but keeps it for other quizzes", async () => {
    const m = await liveMatch();
    const user = await createUser(pool);
    await createDailyPayment(pool, user.id);
    // Pushed 5 hours ago with a 2-hour duration: a normal quiz would be over
    await pool.query(`UPDATE "Quiz" SET "pushedAt" = now() - interval '5 hours', duration = 120 WHERE id = $1`, [m.quizId]);
    expect(await submitQuiz(pool, player(user.id), { userId: user.id, quizId: m.quizId, answers: [{ questionId: 'q1', selectedOption: 0 }] }))
      .toMatchObject({ success: true });
    const oldQuiz = await createQuiz(pool, { duration: 120, pushedSecondsAgo: 5 * 3600 });
    const [q] = await createQuestions(pool, oldQuiz, 1);
    expect(await submitQuiz(pool, player(user.id), { userId: user.id, quizId: oldQuiz, answers: [{ questionId: q, selectedOption: 0 }] }))
      .toMatchObject({ success: false, code: 'closed' });
  });
});

describe('settling a match', () => {
  it('waits until the match has finished or been abandoned, in a preview too', async () => {
    const m = await liveMatch();
    const prizeId = await createPrize(pool);
    await apply(m.matchId, { resolve: [{ id: 'q1', option: 0 }, { id: 'q2', option: 1 }] });
    const user = await createUser(pool);
    await pool.query(
      `INSERT INTO "QuizAttempt" (id, "userId", "quizId", "isCompleted", "updatedAt") VALUES ('qa_1', $1, $2, true, now())`, [user.id, m.quizId],
    );
    const settle = async (dryRun: boolean) => (await asServer(
      `SELECT settle_quiz($1, $2::jsonb, 'random', 'seed-0123456789abcdef', $3, $4) AS r`,
      [m.quizId, JSON.stringify([{ rank: 1, prizeId }]), ADMIN, dryRun],
    )).r;

    for (const dryRun of [true, false]) {
      expect(await settle(dryRun)).toMatchObject({ success: false, code: 'match_unfinished', error: expect.stringMatching(/still being played/) });
    }
    await apply(m.matchId, { status: 'completed' });
    expect(await settle(false)).toMatchObject({ success: true });
  });

  it('leaves quizzes that are not matches alone', async () => {
    const quizId = await createQuiz(pool);
    const [q] = await createQuestions(pool, quizId, 1);
    await asServer(`SELECT evaluate_question($1, 1)`, [q]);
    const r = (await asServer(`SELECT settle_quiz($1, '[{"rank":1,"points":10}]'::jsonb, 'random', 'seed-0123456789abcdef', $2) AS r`, [quizId, ADMIN])).r;
    expect(r).toMatchObject({ success: true });
  });
});

describe('privileges', () => {
  it('keeps matches, innings and balls away from players, and the functions for the server', async () => {
    const m = await liveMatch();
    const user = await createUser(pool);
    for (const table of ['LiveMatch', 'MatchInnings', 'BallEvent']) {
      expect((await errorAs(pool, player(user.id), `SELECT * FROM "${table}"`)).code).toBe('42501');
    }
    expect((await errorAs(pool, player(user.id), `SELECT create_live_match('Aaa', 'Bbb', 20, 2, 'me')`)).code).toBe('42501');
    expect((await errorAs(pool, player(user.id), `SELECT apply_match_change($1, 1, '{}'::jsonb)`, [m.matchId])).code).toBe('42501');
    expect((await queryAs(pool, serviceRole, `SELECT count(*)::int AS n FROM "LiveMatch"`))[0].n).toBe(1);
  });
});

it('stops a second run of the migration', async () => {
  const guard = MIGRATION.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)![0];
  await expect(pool.query(guard)).rejects.toThrow(/submit_quiz_attempt is not the version this migration was written against/);
});
