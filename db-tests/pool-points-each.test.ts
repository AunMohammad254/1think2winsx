/**
 * The points pool paid as a fixed number of points for each player (migration
 * 06-20261027120000_pool_points_each.sql): the earliest scorers get p_pool_each points each, and the
 * pool caps how many of them are paid.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPool,
  createQuestions,
  createQuiz,
  createUser,
  player,
  queryAs,
  resetData,
  serviceRole,
  setWalletEnabled,
  submitQuiz,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = fs.readFileSync(path.join(__dirname, 'schema', '06-20261027120000_pool_points_each.sql'), 'utf8');
const SEED = 'seed-0123456789abcdef';

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
});

/** Players answer 4 questions with `correct[i]` right (option 1), one second apart, then the answer key is saved. */
async function quizWithResults(correct: number[], pointsPool: number) {
  const quizId = await createQuiz(pool);
  const questionIds = await createQuestions(pool, quizId, 4);
  await pool.query(`INSERT INTO "QuizAdminSettings" ("quizId", "maxEntries", "pointsPool") VALUES ($1, 100, $2)`, [quizId, pointsPool]);
  const players: string[] = [];
  for (const c of correct) {
    const user = await createUser(pool);
    players.push(user.id);
    const answers = questionIds.map((questionId, i) => ({ questionId, selectedOption: i < c ? 1 : 0 }));
    expect((await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers })).success).toBe(true);
    // Distinct submission times, so "first come" is well defined
    await pool.query(`UPDATE "QuizAttempt" SET "createdAt" = "createdAt" + make_interval(secs => $2::int) WHERE "userId" = $1`, [user.id, players.length]);
  }
  for (const id of questionIds) await queryAs(pool, serviceRole, `SELECT evaluate_question($1, 1)`, [id]);
  return { quizId, players };
}

async function settle(quizId: string, opts: { rewards?: unknown[]; percent: number; each: number; dryRun?: boolean }) {
  const rows = await queryAs(pool, serviceRole,
    `SELECT settle_quiz($1, $2::jsonb, 'random', $3, 'admin@example.test', $4, $5, $6) AS r`,
    [quizId, JSON.stringify(opts.rewards ?? []), SEED, opts.dryRun ?? false, opts.percent, opts.each]);
  return rows[0].r;
}

const shares = async (quizId: string): Promise<Record<string, number>> => Object.fromEntries((await pool.query<{ userId: string; points: number }>(
  `SELECT "userId", points FROM "QuizPoolShare" WHERE "quizId" = $1`, [quizId])).rows.map((r) => [r.userId, r.points]));
const userPoints = async (userId: string) => (await pool.query(`SELECT points FROM "User" WHERE id = $1`, [userId])).rows[0].points;
const settlement = async (quizId: string) =>
  (await pool.query(`SELECT "poolPercent"::float AS pct, "poolPoints", "poolEach" FROM "QuizSettlement" WHERE "quizId" = $1`, [quizId])).rows[0];

describe('pool paid as points each', () => {
  it('gives the same points to each of the earliest scorers filling the places', async () => {
    // Ten entrants, 20 %: two places, filled by the 2nd and 3rd (the 1st scored 0)
    const { quizId, players } = await quizWithResults([0, 2, 4, 1, 3, 3, 1, 2, 1, 4], 100);
    const r = await settle(quizId, { percent: 20, each: 5 });
    expect(r.pool).toMatchObject({ percent: 20, each: 5, poolSize: 100, target: 10, places: 2, paid: 10, eligible: 9, recipients: 2, min: 5, max: 5 });
    expect(await shares(quizId)).toEqual({ [players[1]]: 5, [players[2]]: 5 });
    expect(await userPoints(players[1])).toBe(5);
    expect(await userPoints(players[3])).toBe(0);
    expect(await settlement(quizId)).toEqual({ pct: 20, poolPoints: 10, poolEach: 5 });
  });

  it('pays only as many places as the pool covers', async () => {
    // Ten entrants, 100 %: ten places, but a 7-point pool at 2 points each covers three
    const { quizId, players } = await quizWithResults([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 7);
    const r = await settle(quizId, { percent: 100, each: 2 });
    expect(r.pool).toMatchObject({ places: 3, target: 6, paid: 6, recipients: 3 });
    expect(Object.keys(await shares(quizId)).sort()).toEqual(players.slice(0, 3).sort());
    // 1 point each, as for a 100-point quiz: the whole pool when it covers every place
    const b = await quizWithResults([1, 1, 1], 100);
    expect((await settle(b.quizId, { percent: 100, each: 1 })).pool).toMatchObject({ places: 3, target: 3, paid: 3 });
  });

  it('pays the points each on top of the 1st-3rd place rewards, and previews the same', async () => {
    const { quizId, players } = await quizWithResults([4, 1, 2], 50);
    const opts = { rewards: [{ rank: 1, points: 100 }], percent: 100, each: 10 };
    const preview = await settle(quizId, { ...opts, dryRun: true });
    expect(await shares(quizId)).toEqual({});
    const real = await settle(quizId, opts);
    expect(real.pool).toEqual(preview.pool);
    expect(await userPoints(players[0])).toBe(110);
    expect(real.pool).toMatchObject({ paid: 30, recipients: 3 });
  });

  it('refuses points each without a percentage, above the pool, or below 0', async () => {
    const { quizId } = await quizWithResults([2], 10);
    expect(await settle(quizId, { percent: 0, each: 1 })).toEqual({
      success: false, code: 'invalid', error: 'Choose which players get the points each' });
    expect(await settle(quizId, { percent: 10, each: 11 })).toEqual({
      success: false, code: 'invalid', error: "The points each player gets can't be more than the whole pool (10)" });
    expect(await settle(quizId, { percent: 10, each: -1 })).toMatchObject({ success: false, code: 'invalid' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "QuizSettlement"`)).rows[0].n).toBe(0);
  });

  it('keeps the random split for the older calls, through the only settle_quiz there is', async () => {
    const { quizId } = await quizWithResults([3, 2], 1000);
    const { rows } = await pool.query(`SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
                                       JOIN pg_namespace n ON n.oid = p.pronamespace
                                       WHERE n.nspname = 'public' AND p.proname = 'settle_quiz'`);
    expect(rows).toHaveLength(1);
    // The live build's call: seven arguments
    const r = (await queryAs(pool, serviceRole, `SELECT settle_quiz($1, '[]'::jsonb, 'random', $2, 'admin', false, 100) AS r`,
      [quizId, SEED]))[0].r;
    expect(r.pool).toMatchObject({ each: 0, paid: 1000, recipients: 2 });
    expect((await settlement(quizId)).poolEach).toBe(0);
  });

  it('stops a second run of the migration', async () => {
    const guard = MIGRATION.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)![0];
    await expect(pool.query(guard)).rejects.toThrow(/settle_quiz\(7 arguments\) is not the version this migration was written against/);
  });
});
