/**
 * Quiz entry limit (first come, first served) and the points pool shared at settlement
 * (migration 06-20261022120000_quiz_entry_cap_and_points_pool.sql).
 */
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anon,
  createPool,
  createQuestion,
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
  testDbUrl,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const SEED = 'seed-0123456789abcdef';
const CLOSED = { success: false, code: 'entries_closed', error: 'Entries for this quiz have closed.' };

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
});

async function setSettings(quizId: string, settings: { maxEntries?: number; pointsPool?: number }) {
  await pool.query(
    `INSERT INTO "QuizAdminSettings" ("quizId", "maxEntries", "pointsPool") VALUES ($1, $2, $3)
     ON CONFLICT ("quizId") DO UPDATE SET "maxEntries" = EXCLUDED."maxEntries", "pointsPool" = EXCLUDED."pointsPool"`,
    [quizId, settings.maxEntries ?? 2000, settings.pointsPool ?? 0],
  );
}

const answerAll = (questionIds: string[], option = 0) => questionIds.map((questionId) => ({ questionId, selectedOption: option }));
const attemptCount = async (quizId: string) =>
  (await pool.query(`SELECT count(*)::int AS n FROM "QuizAttempt" WHERE "quizId" = $1`, [quizId])).rows[0].n;

describe('entry limit', () => {
  it('admits players until the limit, then turns new ones away with entries_closed', async () => {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 2);
    await setSettings(quizId, { maxEntries: 3 });
    for (let i = 0; i < 3; i++) {
      const user = await createUser(pool);
      expect((await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers: answerAll(questionIds) })).success).toBe(true);
    }
    const late = await createUser(pool);
    expect(await submitQuiz(pool, player(late.id), { userId: late.id, quizId, answers: answerAll(questionIds) })).toEqual(CLOSED);
    expect(await attemptCount(quizId)).toBe(3);
    const lateRows = await pool.query(`SELECT count(*)::int AS n FROM "QuestionAttempt" WHERE "userId" = $1`, [late.id]);
    expect(lateRows.rows[0].n).toBe(0);
  });

  it('still lets a player who got in answer questions added later, once the quiz is full', async () => {
    const quizId = await createQuiz(pool);
    const [first] = await createQuestions(pool, quizId, 1);
    await setSettings(quizId, { maxEntries: 1 });
    const entrant = await createUser(pool);
    await submitQuiz(pool, player(entrant.id), { userId: entrant.id, quizId, answers: answerAll([first]) });
    const added = await createQuestion(pool, quizId);
    const r = await submitQuiz(pool, player(entrant.id), { userId: entrant.id, quizId, answers: answerAll([added]) });
    expect(r).toMatchObject({ success: true, isReattempt: true, answersSubmitted: 1 });
  });

  it('holds in a herd: 20 new players at once against a limit of 10 lets exactly 10 in', async () => {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 3);
    await setSettings(quizId, { maxEntries: 10 });
    const users = await Promise.all(Array.from({ length: 20 }, () => createUser(pool)));
    const herd = new pg.Pool({ connectionString: testDbUrl(), max: 20 });
    try {
      const results = await Promise.all(users.map((u) =>
        submitQuiz(herd, player(u.id), { userId: u.id, quizId, answers: answerAll(questionIds) })));
      expect(results.filter((r) => r.success)).toHaveLength(10);
      expect(results.filter((r) => r.code === 'entries_closed')).toHaveLength(10);
    } finally {
      await herd.end();
    }
    expect(await attemptCount(quizId)).toBe(10);
  });

  it('uses 2,000 for a quiz with no saved settings', async () => {
    const quizId = await createQuiz(pool);
    const { rows } = await pool.query(`SELECT private_hardened.quiz_entry_limit($1) AS n`, [quizId]);
    expect(rows[0].n).toBe(2000);
  });

  it('keeps the limit, the pool and the shares out of players\' reach', async () => {
    const user = await createUser(pool);
    for (const table of ['QuizAdminSettings', 'QuizPoolShare']) {
      for (const caller of [anon, player(user.id)]) {
        const err = await errorAs(pool, caller, `SELECT * FROM "${table}"`);
        expect(err.code).toBe('42501');
      }
    }
    const err = await errorAs(pool, player(user.id), `SELECT private_hardened.quiz_entry_limit('x')`);
    expect(err.code).toBe('42501');
  });
});

describe('settlement with a points pool', () => {
  /** Players answer `questions` questions with `correct[i]` right (option 1), then the answer key is saved. */
  async function quizWithResults(correct: number[], settings: { maxEntries?: number; pointsPool?: number }, questions = 4) {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, questions);
    await setSettings(quizId, { maxEntries: 100, ...settings });
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

  async function settle(quizId: string, opts: { rewards?: unknown[]; percent?: number; seed?: string; dryRun?: boolean } = {}) {
    const rows = await queryAs(pool, serviceRole, `SELECT settle_quiz($1, $2::jsonb, 'random', $3, 'admin@example.test', $4, $5) AS r`,
      [quizId, JSON.stringify(opts.rewards ?? []), opts.seed ?? SEED, opts.dryRun ?? false, opts.percent ?? 0]);
    return rows[0].r;
  }

  const shares = async (quizId: string): Promise<Record<string, number>> => Object.fromEntries((await pool.query<{ userId: string; points: number }>(
    `SELECT "userId", points FROM "QuizPoolShare" WHERE "quizId" = $1`, [quizId])).rows.map((r) => [r.userId, r.points]));
  const userPoints = async (userId: string) => (await pool.query(`SELECT points FROM "User" WHERE id = $1`, [userId])).rows[0].points;
  const attemptPoints = async (quizId: string, userId: string) =>
    (await pool.query(`SELECT points FROM "QuizAttempt" WHERE "quizId" = $1 AND "userId" = $2`, [quizId, userId])).rows[0].points;

  it('shares the chosen percentage exactly, in random amounts, among the entrants who scored', async () => {
    const { quizId, players } = await quizWithResults([4, 3, 2, 1, 0, 2], { pointsPool: 10_000 });
    const r = await settle(quizId, { percent: 12.5 });
    expect(r.success).toBe(true);
    expect(r.pool).toMatchObject({ percent: 12.5, poolSize: 10_000, target: 1250, paid: 1250, eligible: 5, recipients: 5 });
    const paid = await shares(quizId);
    expect(Object.values(paid).reduce((a, b) => a + b, 0)).toBe(1250);
    expect(paid[players[4]]).toBeUndefined(); // scored 0
    expect(new Set(Object.values(paid)).size).toBeGreaterThan(1); // random, not equal
    for (const id of Object.keys(paid)) {
      expect(await userPoints(id)).toBe(paid[id]);
      expect(await attemptPoints(quizId, id)).toBe(paid[id]);
    }
    expect([...r.pool.recipientIds].sort()).toEqual(Object.keys(paid).sort());
    const s = (await pool.query(`SELECT "poolPercent"::float AS pct, "poolPoints" FROM "QuizSettlement" WHERE "quizId" = $1`, [quizId])).rows[0];
    expect(s).toEqual({ pct: 12.5, poolPoints: 1250 });
  });

  it('pays the pool on top of the 1st-3rd place rewards', async () => {
    const { quizId, players } = await quizWithResults([4, 1, 1], { pointsPool: 1000 });
    const r = await settle(quizId, { rewards: [{ rank: 1, points: 100 }], percent: 20 });
    expect(r.winners).toHaveLength(1);
    const share = (await shares(quizId))[players[0]];
    expect(share).toBeGreaterThan(0);
    expect(await userPoints(players[0])).toBe(100 + share);
    expect(await attemptPoints(quizId, players[0])).toBe(100 + share);
    expect(r.pool.paid).toBe(200);
  });

  it('lets only the first maxEntries entrants place or share, by first submission', async () => {
    // Five players got in while the limit was higher; it is 3 when the quiz is settled
    const { quizId, players } = await quizWithResults([1, 0, 1, 4, 4], { pointsPool: 900 });
    await setSettings(quizId, { maxEntries: 3, pointsPool: 900 });
    const r = await settle(quizId, { rewards: [{ rank: 1, points: 50 }, { rank: 2, points: 25 }, { rank: 3, points: 10 }], percent: 100 });
    expect(r.participants).toBe(3);
    expect(r.winners.map((w: { userId: string }) => w.userId).sort()).toEqual([players[0], players[2]].sort());
    expect(r.unfilled).toEqual([3]);
    expect(Object.keys(await shares(quizId)).sort()).toEqual([players[0], players[2]].sort());
    expect(await userPoints(players[3])).toBe(0);
  });

  it('gives the same shares for the same seed, and the preview pays what the settle pays', async () => {
    const { quizId } = await quizWithResults([4, 3, 3, 2, 2, 1, 1, 1], { pointsPool: 5000 });
    const preview = await settle(quizId, { percent: 10, dryRun: true });
    expect(preview.preview).toBe(true);
    expect(await shares(quizId)).toEqual({}); // a dry run writes nothing

    // Settle twice inside transactions that are rolled back: same seed, same amounts
    const settleRolledBack = async (seed: string) => {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query(`SELECT set_config('role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
        await db.query(`SELECT settle_quiz($1, '[]'::jsonb, 'random', $2, 'admin', false, 10)`, [quizId, seed]);
        await db.query('RESET ROLE');
        const { rows } = await db.query(`SELECT "userId", points FROM "QuizPoolShare" WHERE "quizId" = $1 ORDER BY "userId"`, [quizId]);
        return rows;
      } finally {
        await db.query('ROLLBACK');
        db.release();
      }
    };
    const a = await settleRolledBack(SEED);
    expect(await settleRolledBack(SEED)).toEqual(a);
    expect(await settleRolledBack('another-seed-0123456789')).not.toEqual(a);

    const real = await settle(quizId, { percent: 10 });
    const { recipientIds, ...summary } = real.pool;
    const { recipientIds: previewIds, ...previewSummary } = preview.pool;
    expect(summary).toEqual(previewSummary);
    expect(recipientIds).toEqual(previewIds);
    expect(Object.entries(await shares(quizId)).sort()).toEqual(a.map((row) => [row.userId, row.points]));
  });

  it('keeps the total exact when the pool is smaller than the number of scorers', async () => {
    const { quizId } = await quizWithResults([1, 1, 1, 1, 1], { pointsPool: 7 });
    const r = await settle(quizId, { percent: 100 });
    expect(r.pool).toMatchObject({ target: 7, paid: 7, eligible: 5 });
    expect(Object.values(await shares(quizId)).every((p) => p >= 1)).toBe(true);
  });

  it('pays nothing from the pool when nobody scored, and still records the settlement', async () => {
    const { quizId } = await quizWithResults([0, 0], { pointsPool: 1000 });
    const r = await settle(quizId, { percent: 50 });
    expect(r).toMatchObject({ success: true, pool: { target: 500, paid: 0, eligible: 0, recipients: 0 } });
    expect((await pool.query(`SELECT "poolPoints" FROM "QuizSettlement" WHERE "quizId" = $1`, [quizId])).rows[0].poolPoints).toBe(0);
  });

  it('refuses a pool share without a pool, or a percent outside 0-100 or with more than two decimals', async () => {
    const { quizId } = await quizWithResults([2], { pointsPool: 0 });
    expect(await settle(quizId, { percent: 10 })).toEqual({
      success: false, code: 'invalid', error: 'This quiz has no points pool. Set one on the quiz first' });
    await setSettings(quizId, { maxEntries: 100, pointsPool: 1000 });
    for (const percent of [-1, 100.5, 10.125]) {
      expect(await settle(quizId, { percent })).toMatchObject({ success: false, code: 'invalid' });
    }
    expect((await pool.query(`SELECT count(*)::int AS n FROM "QuizSettlement"`)).rows[0].n).toBe(0);
  });

  it('settles without a pool by default, through the only settle_quiz there is', async () => {
    const { quizId } = await quizWithResults([3, 1], { pointsPool: 1000 });
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                       WHERE n.nspname = 'public' AND p.proname = 'settle_quiz'`);
    expect(rows[0].n).toBe(1);
    // The live build's call: six arguments, no pool
    const r = (await queryAs(pool, serviceRole, `SELECT settle_quiz($1, '[{"rank":1,"points":10}]'::jsonb, 'random', $2, 'admin', false) AS r`,
      [quizId, SEED]))[0].r;
    expect(r).toMatchObject({ success: true, pool: { percent: 0, paid: 0 } });
    expect(await shares(quizId)).toEqual({});
  });
});
