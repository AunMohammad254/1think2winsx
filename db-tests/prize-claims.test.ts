/**
 * Prize claims: redeem_prize allows one claim per player per prize, and reissue_claim (the admin's
 * "Reissue" in PUT /api/admin/claims) moves points and stock in one locked transaction.
 * Run for real against the schema baseline and migration 06-20261019181000.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anon,
  as,
  createPool,
  createPrize,
  createQuiz,
  createUser,
  errorAs,
  player,
  queryAs,
  resetData,
  serviceRole,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());
beforeEach(() => resetData(pool));

const ALREADY = {
  success: false,
  code: 'already_claimed',
  error: 'You have already claimed this prize. Each prize can only be claimed once per account.',
};

async function playerWithPoints(points = 1000) {
  const user = await createUser(pool);
  await pool.query(`UPDATE "User" SET points = $2 WHERE id = $1`, [user.id, points]);
  return user;
}

async function redeem(userId: string, prizeId: string) {
  const rows = await queryAs(pool, player(userId), `SELECT redeem_prize($1, $2, 'Ali Khan', '03001234567', 'House 1, Lahore') AS r`, [userId, prizeId]);
  return rows[0].r;
}

const points = async (userId: string) => (await pool.query(`SELECT points FROM "User" WHERE id = $1`, [userId])).rows[0].points;
const stock = async (prizeId: string) => (await pool.query(`SELECT stock FROM "Prize" WHERE id = $1`, [prizeId])).rows[0].stock;
const claims = async (userId: string) =>
  (await pool.query(`SELECT id, "prizeId", status, notes, "processedAt", "processedBy" FROM "PrizeRedemption" WHERE "userId" = $1`, [userId])).rows;

describe('one claim per player per prize', () => {
  it('refuses a second claim of the same prize, and allows it again once a claim is rejected', async () => {
    const user = await playerWithPoints();
    const watch = await createPrize(pool, { stock: 5 });
    const earbuds = await createPrize(pool, { name: 'Earbuds', stock: 5 });

    expect(await redeem(user.id, watch)).toMatchObject({ success: true });
    expect(await redeem(user.id, watch)).toEqual(ALREADY);
    expect(await points(user.id)).toBe(900);
    expect(await stock(watch)).toBe(4);

    // Once per prize, not once per account
    expect(await redeem(user.id, earbuds)).toMatchObject({ success: true });

    // Approved and delivered claims count too; a rejected (refunded) one does not
    for (const status of ['approved', 'fulfilled']) {
      await pool.query(`UPDATE "PrizeRedemption" SET status = $2 WHERE "userId" = $1 AND "prizeId" = $3`, [user.id, status, watch]);
      expect(await redeem(user.id, watch)).toEqual(ALREADY);
    }
    await pool.query(`UPDATE "PrizeRedemption" SET status = 'rejected' WHERE "userId" = $1 AND "prizeId" = $2`, [user.id, watch]);
    expect(await redeem(user.id, watch)).toMatchObject({ success: true });
  });

  it('counts a prize won in a quiz, settled or from the old draws', async () => {
    const user = await playerWithPoints();
    const quizId = await createQuiz(pool);
    const settled = await createPrize(pool);
    const legacy = await createPrize(pool, { name: 'Earbuds' });
    await pool.query(
      `INSERT INTO "QuizWinner" ("quizId", "prizeId", "userId", score, "selectionMethod", seed, rank) VALUES ($1, $2, $3, 100, 'ranked', 'x', 1)`,
      [quizId, settled, user.id],
    );
    await pool.query(
      `INSERT INTO "Winning" (id, "userId", "quizId", "prizeId", "updatedAt") VALUES ('w1', $1, $2, $3, now())`,
      [user.id, quizId, legacy],
    );
    expect(await redeem(user.id, settled)).toEqual(ALREADY);
    expect(await redeem(user.id, legacy)).toEqual(ALREADY);
    expect(await points(user.id)).toBe(1000);
  });

  it('makes a claim sent while another is still running wait for it, then refuses it', async () => {
    const user = await playerWithPoints();
    const watch = await createPrize(pool, { stock: 5 });
    let second!: Promise<unknown>;
    await as(pool, player(user.id), async (db) => {
      const first = await db.query(`SELECT redeem_prize($1, $2) AS r`, [user.id, watch]);
      expect(first.rows[0].r.success).toBe(true);
      // Starts on another connection while this transaction hasn't committed yet
      second = redeem(user.id, watch);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(await second).toEqual(ALREADY);
    expect(await points(user.id)).toBe(900);
    expect(await claims(user.id)).toHaveLength(1);
  });

  it("doesn't tell a player what someone else has claimed", async () => {
    const owner = await playerWithPoints();
    const other = await createUser(pool);
    const watch = await createPrize(pool);
    await redeem(owner.id, watch);
    const ask = async (caller: ReturnType<typeof player>) =>
      (await queryAs(pool, caller, `SELECT private_hardened.prize_claimed_by($1, $2) AS r`, [owner.id, watch]))[0].r;
    expect(await ask(player(owner.id))).toBe(true);
    expect(await ask(player(other.id))).toBe(false);
  });
});

describe('reissuing a claim', () => {
  /** A player who redeemed a prize (now 900 points, prize stock 2), with the claim set to `status`. */
  async function claimWith(status: string) {
    const user = await playerWithPoints();
    const prizeId = await createPrize(pool, { stock: 3 });
    const { redemption_id: claimId } = await redeem(user.id, prizeId);
    await pool.query(`UPDATE "PrizeRedemption" SET status = $2, "processedAt" = now() WHERE id = $1`, [claimId, status]);
    return { userId: user.id, prizeId, claimId: claimId as string };
  }

  async function reissue(claimId: string, mode: string, notes: string | null = null) {
    const rows = await queryAs(pool, serviceRole, `SELECT reissue_claim($1, $2, $3, 'admin@example.test') AS r`, [claimId, mode, notes]);
    return rows[0].r;
  }

  it('sends a delivered prize again: the claim goes back to pending and the player stays charged', async () => {
    const { userId, prizeId, claimId } = await claimWith('fulfilled');
    expect(await reissue(claimId, 'redelivery', 'Courier lost the parcel')).toEqual({
      success: true, status: 'pending', previousStatus: 'fulfilled', pointsRefunded: 0,
    });
    expect(await claims(userId)).toMatchObject([{
      status: 'pending', notes: '[REISSUED FOR REDELIVERY] Courier lost the parcel', processedAt: null, processedBy: 'admin@example.test',
    }]);
    expect(await points(userId)).toBe(900);
    expect(await stock(prizeId)).toBe(2);
  });

  it('cancels instead: refunds the points, restocks the prize and lets the player claim it again', async () => {
    const { userId, prizeId, claimId } = await claimWith('approved');
    expect(await reissue(claimId, 'reclaim')).toEqual({
      success: true, status: 'rejected', previousStatus: 'approved', pointsRefunded: 100,
    });
    expect(await claims(userId)).toMatchObject([{ status: 'rejected', notes: '[REISSUED - PLAYER MAY RE-CLAIM] Previous status: approved' }]);
    expect(await points(userId)).toBe(1000);
    expect(await stock(prizeId)).toBe(3);
    expect(await redeem(userId, prizeId)).toMatchObject({ success: true });
  });

  it('refuses pending and rejected claims, so a refunded claim is never shipped or refunded again', async () => {
    for (const status of ['pending', 'rejected']) {
      const { userId, prizeId, claimId } = await claimWith(status);
      for (const mode of ['redelivery', 'reclaim']) {
        expect(await reissue(claimId, mode)).toMatchObject({ success: false, code: 'invalid_status' });
      }
      expect(await claims(userId)).toMatchObject([{ status }]);
      expect(await points(userId)).toBe(900);
      expect(await stock(prizeId)).toBe(2);
    }
    const { claimId } = await claimWith('fulfilled');
    expect(await reissue(claimId, 'refund')).toMatchObject({ success: false, code: 'invalid' });
    expect(await reissue('no-such-claim', 'reclaim')).toMatchObject({ success: false, code: 'not_found' });
  });

  it('only the server can reissue', async () => {
    const { userId, claimId } = await claimWith('fulfilled');
    for (const caller of [anon, player(userId)]) {
      const err = await errorAs(pool, caller, `SELECT reissue_claim($1, 'reclaim')`, [claimId]);
      expect(err.code).toBe('42501');
    }
    expect(await points(userId)).toBe(900);
  });
});
