/**
 * decrement_prize_stock: atomically takes one prize off the shelf for prizeDb.decrementStock
 * (src/lib/supabase/db-modules/prize.db.ts, via the service role). The baseline version updated
 * Prize."stockQuantity", but the column is "stock", so every call failed with 42703.
 * Fixed by schema/06-20261018120000_fix_stock_and_submission_time.sql.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { anon, createPool, createPrize, createUser, errorAs, player, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

// Named argument, as supabase-js .rpc('decrement_prize_stock', { p_prize_id }) sends it
const DECREMENT_SQL = `SELECT public.decrement_prize_stock(p_prize_id => $1) AS stock`;

const decrement = async (prizeId: string) =>
  (await queryAs<{ stock: number }>(pool, serviceRole, DECREMENT_SQL, [prizeId]))[0].stock;

const prizeRow = async (prizeId: string) =>
  (await pool.query(`SELECT stock, "updatedAt" FROM "Prize" WHERE id = $1`, [prizeId])).rows[0];

beforeEach(() => resetData(pool));

describe('decrement_prize_stock', () => {
  it('takes one off the stock and returns what is left', async () => {
    const prizeId = await createPrize(pool, { stock: 2 });

    expect(await decrement(prizeId)).toBe(1);
    expect(await decrement(prizeId)).toBe(0);
    expect((await prizeRow(prizeId)).stock).toBe(0);
  });

  it('bumps updatedAt', async () => {
    const prizeId = await createPrize(pool);
    await pool.query(`UPDATE "Prize" SET "updatedAt" = now() - interval '1 day' WHERE id = $1`, [prizeId]);
    const before = (await prizeRow(prizeId)).updatedAt as Date;

    await decrement(prizeId);

    expect(((await prizeRow(prizeId)).updatedAt as Date).getTime()).toBeGreaterThan(before.getTime());
  });

  it('raises P0001 when the prize is out of stock and leaves the stock at 0', async () => {
    const prizeId = await createPrize(pool, { stock: 0 });

    // prizeDb.decrementStock turns P0001 into 'Prize out of stock'
    expect((await errorAs(pool, serviceRole, DECREMENT_SQL, [prizeId])).code).toBe('P0001');
    expect((await prizeRow(prizeId)).stock).toBe(0);
  });

  it('raises P0001 for a prize that does not exist', async () => {
    expect((await errorAs(pool, serviceRole, DECREMENT_SQL, ['prize_missing'])).code).toBe('P0001');
  });

  it('never oversells when calls race', async () => {
    const prizeId = await createPrize(pool, { stock: 2 });

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => decrement(prizeId)));

    const left = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const codes = results.flatMap((r) => (r.status === 'rejected' ? [(r.reason as pg.DatabaseError).code] : []));
    expect(left.sort((a, b) => a - b)).toEqual([0, 1]);
    expect(codes).toEqual(['P0001', 'P0001', 'P0001']);
    expect((await prizeRow(prizeId)).stock).toBe(0);
  });

  it('can only be executed by the service role', async () => {
    const prizeId = await createPrize(pool, { stock: 5 });
    const someone = await createUser(pool);

    expect((await errorAs(pool, player(someone.id), DECREMENT_SQL, [prizeId])).code).toBe('42501');
    expect((await errorAs(pool, anon, DECREMENT_SQL, [prizeId])).code).toBe('42501');
    expect((await prizeRow(prizeId)).stock).toBe(5);
  });
});
