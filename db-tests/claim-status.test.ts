/**
 * Admin claim decisions: update_claim_status (PUT /api/admin/claims) approves, rejects (refund and
 * restock) or marks a claim delivered in one locked transaction, and only along the steps the admin
 * screen offers. Run for real against the schema baseline and migration 06-20261021180000.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, as, createPool, createPrize, createUser, errorAs, player, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());
beforeEach(() => resetData(pool));

const points = async (userId: string) => (await pool.query(`SELECT points FROM "User" WHERE id = $1`, [userId])).rows[0].points;
const stock = async (prizeId: string) => (await pool.query(`SELECT stock FROM "Prize" WHERE id = $1`, [prizeId])).rows[0].stock;
const claim = async (claimId: string) =>
  (await pool.query(`SELECT status, notes, "processedAt", "processedBy" FROM "PrizeRedemption" WHERE id = $1`, [claimId])).rows[0];

/** A player who redeemed a prize (now 900 points, prize stock 2), with the claim set to `status`. */
async function claimWith(status = 'pending') {
  const user = await createUser(pool);
  await pool.query(`UPDATE "User" SET points = 1000 WHERE id = $1`, [user.id]);
  const prizeId = await createPrize(pool, { stock: 3 });
  const rows = await queryAs(pool, player(user.id), `SELECT redeem_prize($1, $2, 'Ali Khan', '03001234567', 'House 1, Lahore') AS r`, [user.id, prizeId]);
  const claimId = rows[0].r.redemption_id as string;
  if (status !== 'pending') {
    await pool.query(`UPDATE "PrizeRedemption" SET status = $2, notes = 'earlier note' WHERE id = $1`, [claimId, status]);
  }
  return { userId: user.id, prizeId, claimId };
}

async function decide(claimId: string, status: string, notes: string | null = null) {
  const rows = await queryAs(pool, serviceRole, `SELECT update_claim_status($1, $2, $3, 'admin@example.test') AS r`, [claimId, status, notes]);
  return rows[0].r;
}

describe('update_claim_status', () => {
  it('approves a pending claim with the admin note, keeping the points and stock spent', async () => {
    const { userId, prizeId, claimId } = await claimWith();

    expect(await decide(claimId, 'approved', 'Ships on Monday')).toEqual({
      success: true, status: 'approved', previousStatus: 'pending', pointsRefunded: 0,
    });
    expect(await claim(claimId)).toMatchObject({ status: 'approved', notes: 'Ships on Monday', processedBy: 'admin@example.test' });
    expect((await claim(claimId)).processedAt).not.toBeNull();
    expect(await points(userId)).toBe(900);
    expect(await stock(prizeId)).toBe(2);
  });

  it('rejects a pending claim: refunds the points, restocks the prize, and the player may claim it again', async () => {
    const { userId, prizeId, claimId } = await claimWith();

    expect(await decide(claimId, 'rejected', 'Address incomplete')).toEqual({
      success: true, status: 'rejected', previousStatus: 'pending', pointsRefunded: 100,
    });
    expect(await claim(claimId)).toMatchObject({ status: 'rejected', notes: 'Address incomplete' });
    expect(await points(userId)).toBe(1000);
    expect(await stock(prizeId)).toBe(3);
    const again = await queryAs(pool, player(userId), `SELECT redeem_prize($1, $2) AS r`, [userId, prizeId]);
    expect(again[0].r).toMatchObject({ success: true });
  });

  it('marks an approved claim delivered, and keeps the earlier note when no new one is given', async () => {
    const { userId, claimId } = await claimWith('approved');

    expect(await decide(claimId, 'fulfilled', '   ')).toMatchObject({ success: true, status: 'fulfilled', previousStatus: 'approved' });
    expect(await claim(claimId)).toMatchObject({ status: 'fulfilled', notes: 'earlier note' });
    expect(await points(userId)).toBe(900);
  });

  it('refuses every other step and changes nothing', async () => {
    const refused: Array<[string, string]> = [
      ['pending', 'pending'], ['pending', 'fulfilled'],
      ['approved', 'approved'], ['approved', 'rejected'], ['approved', 'pending'],
      ['rejected', 'pending'], ['rejected', 'approved'], ['rejected', 'rejected'],
      ['fulfilled', 'approved'], ['fulfilled', 'rejected'], ['fulfilled', 'pending'],
    ];
    for (const [from, to] of refused) {
      const { userId, prizeId, claimId } = await claimWith(from);
      expect(await decide(claimId, to, 'should not be saved')).toEqual({
        success: false, code: 'invalid_status', error: `This claim is ${from}, so it can't be marked ${to}`,
      });
      expect(await claim(claimId)).toMatchObject({ status: from, processedBy: null });
      expect(await points(userId)).toBe(900);
      expect(await stock(prizeId)).toBe(2);
    }

    const { claimId } = await claimWith();
    expect(await decide(claimId, 'shipped')).toEqual({ success: false, code: 'invalid', error: 'Unknown claim status' });
    expect(await decide('no-such-claim', 'approved')).toEqual({ success: false, code: 'not_found', error: 'Claim not found' });
  });

  it('refunds once when two admins reject the same claim at the same time', async () => {
    const { userId, prizeId, claimId } = await claimWith();
    let second!: Promise<unknown>;
    await as(pool, serviceRole, async (db) => {
      const first = await db.query(`SELECT update_claim_status($1, 'rejected') AS r`, [claimId]);
      expect(first.rows[0].r).toMatchObject({ success: true, pointsRefunded: 100 });
      // Starts on another connection while this transaction hasn't committed yet
      second = decide(claimId, 'rejected');
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(await second).toMatchObject({ success: false, code: 'invalid_status' });
    expect(await points(userId)).toBe(1000);
    expect(await stock(prizeId)).toBe(3);
  });

  it('has a single overload, so a call naming only the first three arguments reaches it (PostgREST answered 300)', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'update_claim_status'`,
    );
    expect(rows[0].n).toBe(1);

    const { claimId } = await claimWith();
    const r = await queryAs(pool, serviceRole,
      `SELECT update_claim_status(p_claim_id => $1, p_status => 'approved', p_notes => NULL) AS r`, [claimId]);
    expect(r[0].r).toMatchObject({ success: true, status: 'approved' });
    expect(await claim(claimId)).toMatchObject({ status: 'approved', processedBy: null });
  });

  it('only the server can decide a claim', async () => {
    const { userId, claimId } = await claimWith();
    for (const caller of [anon, player(userId)]) {
      const err = await errorAs(pool, caller, `SELECT update_claim_status($1, 'approved')`, [claimId]);
      expect(err.code).toBe('42501');
    }
    expect(await claim(claimId)).toMatchObject({ status: 'pending' });
  });
});
