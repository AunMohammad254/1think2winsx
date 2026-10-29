/**
 * Migration 06-20261030120000: scorer corrections. apply_match_change's resumeInnings, removeInnings,
 * replaceBall and reopen, and restoring an abandoned match through its status.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, createUser, player, queryAs, resetData, serviceRole, setWalletEnabled, submitQuiz } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = fs.readFileSync(path.join(__dirname, 'schema', '06-20261030120000_match_corrections.sql'), 'utf8');
const ADMIN = 'admin@example.test';

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, true);
});

const asServer = async (sql: string, params: unknown[] = []) => (await queryAs(pool, serviceRole, sql, params))[0];
const version = async (matchId: string) => (await pool.query(`SELECT version FROM "LiveMatch" WHERE id = $1`, [matchId])).rows[0].version;
const apply = async (matchId: string, change: object) =>
  (await asServer(`SELECT apply_match_change($1, $2, $3::jsonb) AS r`, [matchId, await version(matchId), JSON.stringify({ admin: ADMIN, ...change })])).r;
const question = async (id: string) => (await pool.query(`SELECT * FROM "Question" WHERE id = $1`, [id])).rows[0];
const innings = async (matchId: string) =>
  (await pool.query(`SELECT innings, "battingTeam", "endReason" FROM "MatchInnings" WHERE "matchId" = $1 ORDER BY innings`, [matchId])).rows;

const release = (id: string, inn: number, over: number, closesInSeconds = 120) => ({
  id, text: `Will over ${over} go for 8 or more runs?`, options: JSON.stringify(['Yes', 'No']), market: 'over_runs_at_least',
  params: { line: 8 }, innings: inn, over, closesInSeconds,
});
const ball = (seq: number, extra: Partial<{ id: string; innings: number; runs: number; extra: string; extraRuns: number; wicket: boolean }> = {}) =>
  ({ id: `b${seq}-${Math.random().toString(36).slice(2)}`, innings: 1, seq, runs: 1, extra: 'none', extraRuns: 0, wicket: false, ...extra });

/** A live match: innings 1 started, over 1's question out, the quiz active so players can answer */
async function liveMatch(firstQuestion = 'q1') {
  const { r } = await asServer(`SELECT create_live_match('Lahore Qalandars', 'Karachi Kings', 20, 2, $1) AS r`, [ADMIN]);
  await pool.query(`UPDATE "Quiz" SET status = 'active', "pushedAt" = now() WHERE id = $1`, [r.quizId]);
  expect(await apply(r.matchId, { startInnings: { innings: 1, battingTeam: 'Lahore Qalandars' }, release: [release(firstQuestion, 1, 1)], status: 'live' }))
    .toMatchObject({ success: true });
  return r as { matchId: string; quizId: string };
}

describe('replaceBall', () => {
  it('keeps the old ball, marked undone and pointing at its replacement, which takes its number', async () => {
    const m = await liveMatch();
    const first = ball(1, { runs: 1 });
    const second = ball(2, { runs: 2 });
    await apply(m.matchId, { ball: first });
    await apply(m.matchId, { ball: second });

    const fixed = ball(1, { id: 'fixed', runs: 4 });
    expect(await apply(m.matchId, { replaceBall: { replaces: first.id, ...fixed } })).toMatchObject({ success: true });

    const { rows } = await pool.query(`SELECT id, seq, runs, "undoneAt" IS NOT NULL AS undone, "undoneBy", "replacedBy" FROM "BallEvent" ORDER BY seq, undone`);
    expect(rows).toEqual([
      { id: 'fixed', seq: 1, runs: 4, undone: false, undoneBy: null, replacedBy: null },
      { id: first.id, seq: 1, runs: 1, undone: true, undoneBy: ADMIN, replacedBy: 'fixed' },
      { id: second.id, seq: 2, runs: 2, undone: false, undoneBy: null, replacedBy: null },
    ]);
  });

  it('refuses a ball that is gone or a number that does not match, applying nothing', async () => {
    const m = await liveMatch();
    const first = ball(1);
    await apply(m.matchId, { ball: first });
    const before = await version(m.matchId);

    expect(await apply(m.matchId, { replaceBall: { replaces: 'nope', ...ball(1) } })).toMatchObject({ success: false, code: 'invalid' });
    expect(await apply(m.matchId, { replaceBall: { replaces: first.id, ...ball(2) } })).toMatchObject({ success: false, code: 'invalid' });
    expect(await version(m.matchId)).toBe(before);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "BallEvent"`)).rows[0].n).toBe(1);
  });
});

describe('resumeInnings', () => {
  it('lets an innings ended by hand play on, and only such an innings', async () => {
    const m = await liveMatch();
    await apply(m.matchId, { endInnings: { innings: 1, reason: 'admin' }, status: 'innings_break' });
    expect(await innings(m.matchId)).toEqual([{ innings: 1, battingTeam: 'Lahore Qalandars', endReason: 'admin' }]);

    expect(await apply(m.matchId, { resumeInnings: { innings: 1 }, status: 'live' })).toMatchObject({ success: true });
    expect(await innings(m.matchId)).toEqual([{ innings: 1, battingTeam: 'Lahore Qalandars', endReason: null }]);
    expect((await pool.query(`SELECT status FROM "LiveMatch" WHERE id = $1`, [m.matchId])).rows[0].status).toBe('live');

    // Not ended by hand (still being played, or ended by its balls): nothing to resume
    expect(await apply(m.matchId, { resumeInnings: { innings: 1 } })).toMatchObject({ success: false, code: 'invalid' });
    await apply(m.matchId, { endInnings: { innings: 1, reason: 'all_out' } });
    expect(await apply(m.matchId, { resumeInnings: { innings: 1 } })).toMatchObject({ success: false, code: 'invalid' });
  });
});

describe('removeInnings', () => {
  it('removes an innings without balls with its questions, keeping answered ones voided and out of the match', async () => {
    const m = await liveMatch();
    await apply(m.matchId, { endInnings: { innings: 1, reason: 'admin' } });
    await apply(m.matchId, {
      startInnings: { innings: 2, battingTeam: 'Lahore Qalandars' },
      release: [release('answered', 2, 1), { ...release('unanswered', 2, 1), market: 'wicket_in_over', params: {} }],
    });
    const user = await createUser(pool);
    expect(await submitQuiz(pool, player(user.id), { userId: user.id, quizId: m.quizId, answers: [{ questionId: 'answered', selectedOption: 0 }] }))
      .toMatchObject({ success: true });
    await pool.query(`UPDATE "QuestionAttempt" SET "isCorrect" = true WHERE "questionId" = 'answered'`);
    // An undone ball is history the innings takes with it
    const undone = ball(1, { innings: 2 });
    await apply(m.matchId, { ball: undone });
    await apply(m.matchId, { undoBall: undone.id });

    expect(await apply(m.matchId, { removeInnings: { innings: 2 }, status: 'innings_break' })).toMatchObject({ success: true });
    expect(await innings(m.matchId)).toEqual([{ innings: 1, battingTeam: 'Lahore Qalandars', endReason: 'admin' }]);
    expect(await question('unanswered')).toBeUndefined();
    expect(await question('q1')).toMatchObject({ matchInnings: 1 });
    const kept = await question('answered');
    expect(kept).toMatchObject({ status: 'paused', hasCorrectAnswer: false, matchInnings: null, matchOver: null, market: null, marketParams: null });
    expect(new Date(kept.closesAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await pool.query(`SELECT "isCorrect" FROM "QuestionAttempt" WHERE "questionId" = 'answered'`)).rows).toEqual([{ isCorrect: false }]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "BallEvent" WHERE innings = 2`)).rows[0].n).toBe(0);

    // The right team can go in now
    expect(await apply(m.matchId, { startInnings: { innings: 2, battingTeam: 'Karachi Kings' } })).toMatchObject({ success: true });
  });

  it('refuses an innings with balls, or one that does not exist, applying nothing', async () => {
    const m = await liveMatch();
    await apply(m.matchId, { ball: ball(1) });
    const before = await version(m.matchId);
    expect(await apply(m.matchId, { removeInnings: { innings: 1 } })).toMatchObject({ success: false, code: 'invalid' });
    expect(await apply(m.matchId, { removeInnings: { innings: 2 } })).toMatchObject({ success: false, code: 'invalid' });
    expect(await version(m.matchId)).toBe(before);
    expect(await question('q1')).toBeDefined();
  });
});

describe('reopen', () => {
  it('lets closed questions take answers again until the given time, but never one with its result', async () => {
    const m = await liveMatch();
    await apply(m.matchId, { release: [release('q2', 1, 2)] });
    await apply(m.matchId, { closeAll: true });
    expect(new Date((await question('q1')).closesAt).getTime()).toBeLessThanOrEqual(Date.now());
    await apply(m.matchId, { resolve: [{ id: 'q2', option: 0 }] });

    expect(await apply(m.matchId, { reopen: [{ id: 'q1', closesInSeconds: 90 }, { id: 'q2', closesInSeconds: 90 }] })).toMatchObject({ success: true });
    const left = (new Date((await question('q1')).closesAt).getTime() - Date.now()) / 1000;
    expect(left).toBeGreaterThan(80);
    expect(left).toBeLessThanOrEqual(91);
    expect(new Date((await question('q2')).closesAt).getTime()).toBeLessThanOrEqual(Date.now());

    const user = await createUser(pool);
    expect(await submitQuiz(pool, player(user.id), { userId: user.id, quizId: m.quizId, answers: [{ questionId: 'q1', selectedOption: 1 }] })).toMatchObject({ success: true });
  });

  it("touches only the match's own questions", async () => {
    const m = await liveMatch();
    const other = await liveMatch('other-q1');
    await apply(other.matchId, { release: [release('elsewhere', 1, 2)], closeAll: true });
    await apply(m.matchId, { reopen: [{ id: 'elsewhere', closesInSeconds: 90 }] });
    expect(new Date((await question('elsewhere')).closesAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

it('puts an abandoned match back through its status', async () => {
  const m = await liveMatch();
  await apply(m.matchId, { closeAll: true, void: ['q1'], status: 'abandoned' });
  expect(await apply(m.matchId, { pending: ['q1'], reopen: [{ id: 'q1', closesInSeconds: 60 }], status: 'live' })).toMatchObject({ success: true });
  expect((await pool.query(`SELECT status FROM "LiveMatch" WHERE id = $1`, [m.matchId])).rows[0].status).toBe('live');
  expect(await question('q1')).toMatchObject({ status: 'active', hasCorrectAnswer: false });
});

it('stops a second run of the migration', async () => {
  const guard = MIGRATION.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)![0];
  await expect(pool.query(guard)).rejects.toThrow(/apply_match_change is not the version this migration was written against/);
});
