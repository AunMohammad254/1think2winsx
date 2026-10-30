/**
 * Migration 06-20261101120000: a free-entry quiz (a live match) never sets the day pass price.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createPool, createQuiz, createUser, player, queryAs, resetData } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = fs.readFileSync(path.join(__dirname, 'schema', '06-20261101120000_free_entry_day_pass_price.sql'), 'utf8');

beforeEach(async () => {
  await resetData(pool);
});

/** An active quiz at `price`, created `minutesAgo` minutes ago */
async function quiz(price: number, minutesAgo: number, freeEntry = false) {
  const id = await createQuiz(pool);
  await pool.query(`UPDATE "Quiz" SET "accessPrice" = $2, "freeEntry" = $3, "createdAt" = now() - make_interval(mins => $4) WHERE id = $1`,
    [id, price, freeEntry, minutesAgo]);
  return id;
}

async function pay(quizId: string | null = null) {
  const user = await createUser(pool);
  await pool.query(`UPDATE "User" SET "walletBalance" = 100 WHERE id = $1`, [user.id]);
  const [{ r }] = await queryAs(pool, player(user.id), `SELECT pay_quiz_access($1) AS r`, [quizId]);
  return r as { success: boolean; amount: number };
}

it("charges the oldest paid quiz's price, not that of an older live match", async () => {
  const match = await quiz(3, 300, true);
  await quiz(5, 60);
  await quiz(7, 10);
  expect(await pay()).toMatchObject({ success: true, amount: 5 });
  // Asked to pay for the match itself: still the day pass's price
  expect(await pay(match)).toMatchObject({ success: true, amount: 5 });
});

it('charges the quiz it is given, and the default price when only a match is active', async () => {
  await quiz(3, 300, true);
  const paid = await quiz(9, 5);
  expect(await pay(paid)).toMatchObject({ amount: 9 });
  await pool.query(`UPDATE "Quiz" SET status = 'paused' WHERE id = $1`, [paid]);
  expect(await pay()).toMatchObject({ success: true, amount: 2 });
});

it('stops a second run of the migration', async () => {
  const guard = MIGRATION.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)![0];
  await expect(pool.query(guard)).rejects.toThrow(/pay_quiz_access is not the version this migration was written against/);
});
