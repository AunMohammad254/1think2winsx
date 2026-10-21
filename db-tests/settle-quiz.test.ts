/**
 * settle_quiz: the one-step settlement behind the admin Settle screen (POST /api/admin/quiz-settlement),
 * plus the admin-only bumper prize category. Run for real against the schema baseline and migration 06.
 */
import { createHash } from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anon,
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

const SEED = 'seed-0123456789abcdef';
type Reward = { rank: number; points?: number; prizeId?: string };

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
});

/** A quiz with `questions` questions, the answer key saved (option 1 correct), and the given players' answers. */
async function quizWithResults(correctPerPlayer: number[], questions = 4) {
  const quizId = await createQuiz(pool);
  const questionIds = await createQuestions(pool, quizId, questions);
  const players: Array<{ id: string; email: string }> = [];
  for (const correct of correctPerPlayer) {
    const user = await createUser(pool);
    players.push(user);
    const answers = questionIds.map((questionId, i) => ({ questionId, selectedOption: i < correct ? 1 : 0 }));
    const r = await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers });
    expect(r.success).toBe(true);
  }
  for (const id of questionIds) {
    await queryAs(pool, serviceRole, `SELECT evaluate_question($1, 1)`, [id]);
  }
  return { quizId, questionIds, players };
}

async function settle(quizId: string, rewards: Reward[], opts: { tieRule?: string; seed?: string; dryRun?: boolean } = {}) {
  const rows = await queryAs(pool, serviceRole, `SELECT settle_quiz($1, $2::jsonb, $3, $4, 'admin@example.test', $5) AS r`, [
    quizId, JSON.stringify(rewards), opts.tieRule ?? 'random', opts.seed ?? SEED, opts.dryRun ?? false,
  ]);
  return rows[0].r;
}

const points = async (userId: string) => (await pool.query(`SELECT points FROM "User" WHERE id = $1`, [userId])).rows[0].points;
const stock = async (prizeId: string) => (await pool.query(`SELECT stock FROM "Prize" WHERE id = $1`, [prizeId])).rows[0].stock;
const winners = async (quizId: string) =>
  (await pool.query(`SELECT * FROM "QuizWinner" WHERE "quizId" = $1 ORDER BY rank`, [quizId])).rows;
const settlement = async (quizId: string) =>
  (await pool.query(`SELECT * FROM "QuizSettlement" WHERE "quizId" = $1`, [quizId])).rows[0];

describe('settling', () => {
  it('ranks players by score and pays 1st-3rd in points or prizes, once', async () => {
    const { quizId, players } = await quizWithResults([2, 4, 3, 1]);
    const watch = await createPrize(pool, { stock: 2 });

    const r = await settle(quizId, [
      { rank: 1, prizeId: watch },
      { rank: 2, points: 500 },
      { rank: 3, points: 100 },
    ]);

    expect(r).toMatchObject({ success: true, participants: 4, questions: 4, tieRule: 'random', unfilled: [] });
    expect(r.winners.map((w: { userId: string }) => w.userId)).toEqual([players[1].id, players[2].id, players[0].id]);
    expect(r.winners[0]).toMatchObject({ rank: 1, score: 100, prizeId: watch, prizeName: 'Smartwatch', points: null, selectionMethod: 'ranked' });
    expect(r.winners[1]).toMatchObject({ rank: 2, score: 75, points: 500, prizeId: null });

    expect(await stock(watch)).toBe(1);
    expect(await points(players[1].id)).toBe(0);
    expect(await points(players[2].id)).toBe(500);
    expect(await points(players[0].id)).toBe(100);
    expect(await points(players[3].id)).toBe(0);

    const rows = await winners(quizId);
    expect(rows.map((w) => [w.rank, w.userId, w.prizeId, w.pointsAwarded, w.selectedBy, w.seed])).toEqual([
      [1, players[1].id, watch, 0, 'admin@example.test', SEED],
      [2, players[2].id, null, 500, 'admin@example.test', SEED],
      [3, players[0].id, null, 100, 'admin@example.test', SEED],
    ]);
    const attempt = await pool.query(`SELECT points FROM "QuizAttempt" WHERE "quizId" = $1 AND "userId" = $2`, [quizId, players[2].id]);
    expect(attempt.rows[0].points).toBe(500);

    expect(await settlement(quizId)).toMatchObject({ settledBy: 'admin@example.test', tieRule: 'random', seed: SEED, participantCount: 4 });

    // Never twice
    expect(await settle(quizId, [{ rank: 1, points: 10 }])).toEqual({
      success: false, code: 'already_settled', error: 'This quiz has already been settled',
    });
    expect(await points(players[2].id)).toBe(500);
  });

  it('previews exactly what settling would do, and changes nothing', async () => {
    const { quizId, players } = await quizWithResults([3, 3, 1]);
    const prize = await createPrize(pool, { stock: 1 });
    const rewards = [{ rank: 1, prizeId: prize }, { rank: 2, points: 50 }];

    const preview = await settle(quizId, rewards, { dryRun: true });
    expect(preview.preview).toBe(true);
    expect(await settlement(quizId)).toBeUndefined();
    expect(await winners(quizId)).toEqual([]);
    expect(await stock(prize)).toBe(1);
    for (const p of players) expect(await points(p.id)).toBe(0);

    const real = await settle(quizId, rewards);
    expect(real.winners).toEqual(preview.winners);
  });

  it('rolls everything back when a prize runs out partway', async () => {
    const { quizId, players } = await quizWithResults([4, 3]);
    const lastOne = await createPrize(pool, { name: 'Phone', stock: 0 });

    const r = await settle(quizId, [{ rank: 1, points: 300 }, { rank: 2, prizeId: lastOne }]);
    expect(r).toEqual({ success: false, code: 'out_of_stock', error: 'Phone is out of stock' });
    expect(await points(players[0].id)).toBe(0);
    expect(await winners(quizId)).toEqual([]);
    expect(await settlement(quizId)).toBeUndefined();
  });

  it('leaves places empty when fewer players scored, and never rewards a score of 0', async () => {
    const { quizId, players } = await quizWithResults([2, 0]);
    const r = await settle(quizId, [{ rank: 1, points: 100 }, { rank: 2, points: 50 }, { rank: 3, points: 10 }]);
    expect(r.winners.map((w: { userId: string }) => w.userId)).toEqual([players[0].id]);
    expect(r.unfilled).toEqual([2, 3]);
    expect(await points(players[1].id)).toBe(0);
  });

  it('settles with no rewards at all, which still closes the quiz', async () => {
    const { quizId } = await quizWithResults([1]);
    expect(await settle(quizId, [])).toMatchObject({ success: true, winners: [], unfilled: [] });
    expect(await settlement(quizId)).toBeDefined();
  });

  it('pays points first on a connection that has never settled before', async () => {
    // PL/pgSQL plans each statement once per connection, so the tests above (on `pool`) can hide a
    // failure that only a new connection shows. A new pool is a new connection.
    const { quizId, players } = await quizWithResults([4, 3]);
    const prize = await createPrize(pool, { stock: 1 });
    const rewards = JSON.stringify([{ rank: 1, points: 300 }, { rank: 2, prizeId: prize }]);
    const fresh = createPool();
    try {
      const call = (dryRun: boolean) => queryAs(fresh, serviceRole,
        `SELECT settle_quiz($1, $2::jsonb, 'random', $3, 'admin', $4) AS r`, [quizId, rewards, SEED, dryRun]);
      const preview = (await call(true))[0].r;
      expect(preview.winners).toMatchObject([
        { rank: 1, userId: players[0].id, points: 300, prizeName: null, prizeCategory: null },
        { rank: 2, userId: players[1].id, points: null, prizeName: 'Smartwatch', prizeCategory: 'electronics' },
      ]);
      expect((await call(false))[0].r.winners).toEqual(preview.winners);
    } finally {
      await fresh.end();
    }
    expect(await points(players[0].id)).toBe(300);
    expect(await stock(prize)).toBe(0);
  });
});

describe('ties', () => {
  it('earliest submission wins a tie, and the winner is marked as a tie-break', async () => {
    const { quizId, players } = await quizWithResults([3, 3, 3]);
    // Make player 2 the earliest submitter regardless of insert timing
    await pool.query(`UPDATE "QuizAttempt" SET "createdAt" = now() - interval '1 hour' WHERE "quizId" = $1 AND "userId" = $2`, [quizId, players[2].id]);

    const r = await settle(quizId, [{ rank: 1, points: 10 }], { tieRule: 'earliest' });
    expect(r.winners[0]).toMatchObject({ userId: players[2].id, tiedWith: 2, selectionMethod: 'ranked_earliest_tiebreak' });
  });

  it('a random draw is fixed by its seed, so anyone can re-check it', async () => {
    const { quizId, players } = await quizWithResults([2, 2, 2]);
    const preview = await settle(quizId, [{ rank: 1, points: 10 }, { rank: 2, points: 5 }], { dryRun: true });

    const md5 = (s: string) => createHash('md5').update(s).digest('hex');
    const expected = players.map((p) => p.id).sort((a, b) => md5(`${SEED}:${a}`).localeCompare(md5(`${SEED}:${b}`)));
    expect(preview.winners.map((w: { userId: string }) => w.userId)).toEqual(expected.slice(0, 2));
    expect(preview.winners[0].selectionMethod).toBe('ranked_random_tiebreak');

    const again = await settle(quizId, [{ rank: 1, points: 10 }, { rank: 2, points: 5 }], { dryRun: true });
    expect(again.winners).toEqual(preview.winners);
  });
});

describe('refusals', () => {
  it('needs the result for every question first', async () => {
    const quizId = await createQuiz(pool);
    await createQuestions(pool, quizId, 2);
    expect(await settle(quizId, [])).toEqual({
      success: false, code: 'result_missing', error: 'Save the result for every question before settling',
    });
  });

  it('rejects bad input without changing anything', async () => {
    const { quizId, players } = await quizWithResults([2]);
    const prize = await createPrize(pool);
    const cases: Array<[unknown, string]> = [
      [[{ rank: 1, points: 10 }, { rank: 1, points: 5 }], 'Each place (1st, 2nd, 3rd) can have one reward'],
      [[{ rank: 4, points: 10 }], 'Each place (1st, 2nd, 3rd) can have one reward'],
      [[{ rank: 1, points: 10, prizeId: prize }], 'Each reward is either points (1 to 100,000) or one prize'],
      [[{ rank: 1 }], 'Each reward is either points (1 to 100,000) or one prize'],
      [[{ rank: 1, points: 0 }], 'Each reward is either points (1 to 100,000) or one prize'],
      [[{ rank: 1, points: 1 }, { rank: 2, points: 1 }, { rank: 3, points: 1 }, { rank: 3, points: 1 }], 'Rewards must be a list of up to three places'],
    ];
    for (const [rewards, error] of cases) {
      const rows = await queryAs(pool, serviceRole, `SELECT settle_quiz($1, $2::jsonb, 'random', $3, 'admin') AS r`, [quizId, JSON.stringify(rewards), SEED]);
      expect(rows[0].r).toEqual({ success: false, code: 'invalid', error });
    }
    expect(await settle(quizId, [], { tieRule: 'coin-toss' })).toMatchObject({ code: 'invalid', error: 'Unknown tie rule' });
    expect(await settle(quizId, [], { seed: 'short' })).toMatchObject({ code: 'invalid' });
    expect(await settle('no-such-quiz', [])).toMatchObject({ code: 'not_found' });
    const inactive = await createPrize(pool, { isActive: false });
    expect(await settle(quizId, [{ rank: 1, prizeId: inactive }])).toMatchObject({ code: 'invalid', error: 'A chosen prize is no longer available' });
    expect(await points(players[0].id)).toBe(0);
    expect(await settlement(quizId)).toBeUndefined();
  });

  it('only the server can settle', async () => {
    const { quizId, players } = await quizWithResults([1]);
    for (const caller of [anon, player(players[0].id)]) {
      const err = await errorAs(pool, caller, `SELECT settle_quiz($1, '[]'::jsonb, 'random', $2, 'me')`, [quizId, SEED]);
      expect(err.code).toBe('42501');
    }
    const err = await errorAs(pool, player(players[0].id), `SELECT * FROM "QuizSettlement"`);
    expect(err.code).toBe('42501');
  });
});

describe('bumper prizes are admin-only', () => {
  it('players and visitors cannot see them, and cannot redeem them with points', async () => {
    const user = await createUser(pool);
    await pool.query(`UPDATE "User" SET points = 10000 WHERE id = $1`, [user.id]);
    const secret = await createPrize(pool, { name: 'Mystery bike', category: 'bumper' });
    const normal = await createPrize(pool, { name: 'Earbuds' });

    for (const caller of [anon, player(user.id)]) {
      const rows = await queryAs(pool, caller, `SELECT id FROM "Prize"`);
      expect(rows.map((r: { id: string }) => r.id)).toEqual([normal]);
    }
    const rows = await queryAs(pool, serviceRole, `SELECT id FROM "Prize" ORDER BY name`);
    expect(rows).toHaveLength(2);

    const redeem = await queryAs(pool, player(user.id), `SELECT redeem_prize($1, $2) AS r`, [user.id, secret]);
    expect(redeem[0].r).toEqual({ success: false, error: 'Prize not found or not available' });
    expect(await points(user.id)).toBe(10000);
    expect(await stock(secret)).toBe(2);
  });

  it('can still be won in a quiz', async () => {
    const { quizId, players } = await quizWithResults([2]);
    const secret = await createPrize(pool, { name: 'Mystery bike', category: 'bumper', stock: 1 });
    const r = await settle(quizId, [{ rank: 1, prizeId: secret }]);
    expect(r.winners[0]).toMatchObject({ userId: players[0].id, prizeName: 'Mystery bike', prizeCategory: 'bumper' });
    expect(await stock(secret)).toBe(0);
  });
});

describe('quizzes rewarded the old way', () => {
  it('a legacy lucky-draw winner is first place, and up to three winners per quiz are allowed now', async () => {
    const { quizId, players } = await quizWithResults([2, 1, 1]);
    const prize = await createPrize(pool);
    await pool.query(
      `INSERT INTO "QuizWinner" ("quizId", "prizeId", "userId", score, "selectionMethod", seed, rank) VALUES ($1, $2, $3, 50, 'random_draw', 'x', 1)`,
      [quizId, prize, players[0].id],
    );
    // A second place for another player is fine; the same place or player twice is not
    await pool.query(
      `INSERT INTO "QuizWinner" ("quizId", "userId", score, "selectionMethod", seed, rank, "pointsAwarded") VALUES ($1, $2, 25, 'ranked', 'x', 2, 10)`,
      [quizId, players[1].id],
    );
    await expect(pool.query(
      `INSERT INTO "QuizWinner" ("quizId", "userId", score, "selectionMethod", seed, rank, "pointsAwarded") VALUES ($1, $2, 25, 'ranked', 'x', 2, 10)`,
      [quizId, players[2].id],
    )).rejects.toMatchObject({ code: '23505' });
    // A winner needs a reward
    await expect(pool.query(
      `INSERT INTO "QuizWinner" ("quizId", "userId", score, "selectionMethod", seed, rank) VALUES ($1, $2, 25, 'ranked', 'x', 3)`,
      [quizId, players[2].id],
    )).rejects.toMatchObject({ code: '23514' });
  });
});
