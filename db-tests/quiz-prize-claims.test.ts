/**
 * Migration 06-20261024190000: a winner's delivery claim for a prize won in a quiz (claim_quiz_prize),
 * handled on the admin Claims screen like any other claim (get_admin_claims shows the quiz).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  answersFor,
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

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
});

const asServer = async (sql: string, params: unknown[] = []) => (await queryAs(pool, serviceRole, sql, params))[0];
const DETAILS = { name: 'Ali Raza', phone: '+92 300 1234567', address: 'House 12, Street 4, Lahore' };

/** Settles a one-question quiz its one player got right, with `reward` for 1st place; returns the win. */
async function wonQuiz(reward: { prizeId?: string; points?: number }) {
  const quizId = await createQuiz(pool);
  const [questionId] = await createQuestions(pool, quizId, 1);
  const user = await createUser(pool);
  await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers: answersFor([questionId]) });
  await asServer(`SELECT evaluate_question($1, 1)`, [questionId]);
  const settled = await asServer(`SELECT settle_quiz($1, $2::jsonb, 'random', 'seed-0123456789abcdef', 'admin@example.test') AS r`, [
    quizId, JSON.stringify([{ rank: 1, ...reward }]),
  ]);
  expect(settled.r.success).toBe(true);
  const { rows: [win] } = await pool.query(`SELECT id FROM "QuizWinner" WHERE "quizId" = $1`, [quizId]);
  return { quizId, user, winnerId: win.id as string };
}

async function claim(winnerId: string, userId: string, details: Partial<typeof DETAILS> = {}) {
  const d = { ...DETAILS, ...details };
  return (await asServer(`SELECT claim_quiz_prize($1, $2, $3, $4, $5) AS r`, [winnerId, userId, d.name, d.phone, d.address])).r;
}
const stock = async (prizeId: string) => (await pool.query(`SELECT stock FROM "Prize" WHERE id = $1`, [prizeId])).rows[0].stock;
const decide = (claimId: string, status: string) =>
  asServer(`SELECT update_claim_status($1, $2, 'Wrong address', 'admin@example.test') AS r`, [claimId, status]);

describe('claim_quiz_prize', () => {
  it('turns the delivery details into a pending claim linked to the win, without taking more stock', async () => {
    const prizeId = await createPrize(pool, { stock: 3 });
    const { user, winnerId } = await wonQuiz({ prizeId });
    expect(await stock(prizeId)).toBe(2); // settlement took one

    const r = await claim(winnerId, user.id, { name: '  Ali Raza  ' });
    expect(r).toEqual({ success: true, claimId: expect.stringMatching(/^pr_/) });
    const { rows: [row] } = await pool.query(`SELECT * FROM "PrizeRedemption" WHERE id = $1`, [r.claimId]);
    expect(row).toMatchObject({
      userId: user.id, prizeId, pointsUsed: 0, status: 'pending',
      fullName: 'Ali Raza', whatsappNumber: '+92 300 1234567', address: 'House 12, Street 4, Lahore', notes: 'Won in quiz: Test quiz',
    });
    const { rows: [win] } = await pool.query(`SELECT "prizeRedemptionId" FROM "QuizWinner" WHERE id = $1`, [winnerId]);
    expect(win.prizeRedemptionId).toBe(r.claimId);
    expect(await stock(prizeId)).toBe(2);
  });

  it('takes one claim per win, even when the form is sent twice at once', async () => {
    const prizeId = await createPrize(pool);
    const { user, winnerId } = await wonQuiz({ prizeId });
    const results = await Promise.all([claim(winnerId, user.id), claim(winnerId, user.id)]);
    expect(results.map((r) => r.success).sort()).toEqual([false, true]);
    expect(results.find((r) => !r.success)).toMatchObject({ code: 'already_claimed' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "PrizeRedemption"`)).rows[0].n).toBe(1);
  });

  it("refuses someone else's win, an unknown one and a place paid in points", async () => {
    const prizeId = await createPrize(pool);
    const { winnerId } = await wonQuiz({ prizeId });
    const stranger = await createUser(pool);
    expect(await claim(winnerId, stranger.id)).toMatchObject({ success: false, code: 'not_found' });
    expect(await claim('nope', stranger.id)).toMatchObject({ success: false, code: 'not_found' });
    const points = await wonQuiz({ points: 500 });
    expect(await claim(points.winnerId, points.user.id)).toMatchObject({ success: false, code: 'invalid' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "PrizeRedemption"`)).rows[0].n).toBe(0);
  });

  it('checks the details like the form does', async () => {
    const prizeId = await createPrize(pool);
    const { user, winnerId } = await wonQuiz({ prizeId });
    for (const bad of [{ name: 'A' }, { name: '' }, { phone: '12345' }, { phone: 'call me maybe' }, { address: 'Lahore' }, { address: 'x'.repeat(501) }]) {
      expect(await claim(winnerId, user.id, bad)).toMatchObject({ success: false, code: 'invalid' });
    }
    expect((await pool.query(`SELECT count(*)::int AS n FROM "PrizeRedemption"`)).rows[0].n).toBe(0);
  });

  it('lets the winner send details again after a rejection, taking the item from stock again', async () => {
    const prizeId = await createPrize(pool, { stock: 1 });
    const { user, winnerId } = await wonQuiz({ prizeId });
    expect(await stock(prizeId)).toBe(0);
    const first = await claim(winnerId, user.id);
    expect((await decide(first.claimId, 'rejected')).r.success).toBe(true);
    expect(await stock(prizeId)).toBe(1); // a rejection returns the item

    const second = await claim(winnerId, user.id, { address: 'Flat 3, Block B, Gulberg, Lahore' });
    expect(second.success).toBe(true);
    expect(await stock(prizeId)).toBe(0);
    expect((await pool.query(`SELECT "prizeRedemptionId" FROM "QuizWinner" WHERE id = $1`, [winnerId])).rows[0].prizeRedemptionId).toBe(second.claimId);
    // An approved claim then goes through the usual steps
    expect((await decide(second.claimId, 'approved')).r.success).toBe(true);
    expect(await claim(winnerId, user.id)).toMatchObject({ code: 'already_claimed' });
  });

  it('refuses a new claim after a rejection when the prize ran out meanwhile', async () => {
    const prizeId = await createPrize(pool, { stock: 1 });
    const { user, winnerId } = await wonQuiz({ prizeId });
    const first = await claim(winnerId, user.id);
    await decide(first.claimId, 'rejected');
    await pool.query(`UPDATE "Prize" SET stock = 0 WHERE id = $1`, [prizeId]);
    expect(await claim(winnerId, user.id)).toMatchObject({ success: false, code: 'out_of_stock' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "PrizeRedemption"`)).rows[0].n).toBe(1);
  });

  it('can only be called by the server', async () => {
    const user = await createUser(pool);
    const error = await errorAs(pool, player(user.id), `SELECT claim_quiz_prize('w', $1, 'Ali', '03001234567', 'Somewhere far away')`, [user.id]);
    expect(error.code).toBe('42501');
  });
});

describe('get_admin_claims', () => {
  it('shows the quiz a claimed prize was won in, and null for one bought with points', async () => {
    const prizeId = await createPrize(pool);
    const { quizId, user, winnerId } = await wonQuiz({ prizeId });
    const { claimId } = await claim(winnerId, user.id);
    const other = await createPrize(pool, { name: 'Pen' });
    await pool.query(
      `INSERT INTO "PrizeRedemption" (id, "userId", "prizeId", "pointsUsed", status, "requestedAt", "updatedAt")
       VALUES ('bought', $1, $2, 100, 'pending', now() - interval '1 day', now())`,
      [user.id, other],
    );
    const { r } = await asServer(`SELECT get_admin_claims('all', 1, 20) AS r`);
    expect(r.claims.map((c: { id: string; quiz: unknown; pointsUsed: number }) => [c.id, c.quiz, c.pointsUsed])).toEqual([
      [claimId, { id: quizId, title: 'Test quiz' }, 0],
      ['bought', null, 100],
    ]);
  });
});
