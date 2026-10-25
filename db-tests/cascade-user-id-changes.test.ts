/**
 * Migration 06-20261025120000: every foreign key to "User"(id) cascades an id change, so a player who
 * signs up again takes over their old "User" row. Before, the on_auth_user_created trigger's id change
 * failed on the old row's notifications, the sign-up went through with no "User" row, and every
 * "Lock in answer" failed with "Failed to submit quiz" (QuizAttempt_userId_fkey).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  answersFor,
  countRows,
  createNotification,
  createPool,
  createQuestions,
  createQuiz,
  player,
  resetData,
  setWalletEnabled,
  submitQuiz,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = path.join(__dirname, 'schema', '06-20261025120000_cascade_user_id_changes.sql');

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
});

/** Production's trigger on auth.users (the baseline has no triggers), only while `fn` runs. */
async function withSignupTrigger(fn: () => Promise<void>): Promise<void> {
  await pool.query(
    `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`,
  );
  try {
    await fn();
  } finally {
    await pool.query(`DROP TRIGGER on_auth_user_created ON auth.users`);
  }
}

/** A "User" row whose auth account was deleted, with two notifications. */
async function leftoverUser(email: string): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO "User" (id, email, "updatedAt") VALUES ($1, $2, now())`, [id, email]);
  await createNotification(pool, id);
  await createNotification(pool, id);
  return id;
}

const signUp = (id: string, email: string, name?: string) =>
  pool.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id, email, JSON.stringify(name ? { full_name: name } : {}),
  ]);

async function userIdsByEmail(email: string): Promise<string[]> {
  const { rows } = await pool.query(`SELECT id FROM "User" WHERE email = $1`, [email]);
  return rows.map((r) => r.id);
}

async function locksIn(userId: string): Promise<boolean> {
  const quizId = await createQuiz(pool);
  const questions = await createQuestions(pool, quizId, 2);
  const r = await submitQuiz(pool, player(userId), { userId, quizId, answers: answersFor(questions) });
  return r.success;
}

describe('foreign keys to "User"(id)', () => {
  it('all cascade an id change', async () => {
    const { rows } = await pool.query(
      `SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint
        WHERE contype = 'f' AND confrelid = 'public."User"'::regclass AND confupdtype <> 'c'`,
    );
    expect(rows).toEqual([]);
  });
});

describe('signing up again', () => {
  it('takes over the old "User" row and its notifications, and the player can lock in answers', async () => {
    const email = 'returning@example.test';
    const oldId = await leftoverUser(email);
    const newId = randomUUID();

    await withSignupTrigger(async () => {
      await signUp(newId, email);
    });

    expect(await userIdsByEmail(email)).toEqual([newId]);
    expect(await countRows(pool, 'Notification', newId)).toBe(2);
    expect(await countRows(pool, 'Notification', oldId)).toBe(0);
    expect(await locksIn(newId)).toBe(true);
  });
});

describe('repairing accounts already left without a "User" row', () => {
  it('gives the old row to the account with its email, and a new row to one with no row at all', async () => {
    const email = 'returning@example.test';
    await leftoverUser(email);
    const returning = randomUUID();
    const unmatched = randomUUID();
    await signUp(returning, email); // no trigger: as production was left
    await signUp(unmatched, 'new@example.test', 'Ayesha Khan');

    await pool.query(fs.readFileSync(MIGRATION, 'utf8'));

    expect(await userIdsByEmail(email)).toEqual([returning]);
    expect(await countRows(pool, 'Notification', returning)).toBe(2);
    const { rows } = await pool.query(`SELECT email, name FROM "User" WHERE id = $1`, [unmatched]);
    expect(rows).toEqual([{ email: 'new@example.test', name: 'Ayesha Khan' }]);
    expect(await locksIn(returning)).toBe(true);
    expect(await locksIn(unmatched)).toBe(true);
  });

  it("leaves a row that still belongs to a live account alone", async () => {
    const email = 'shared@example.test';
    const owner = randomUUID();
    await signUp(owner, email);
    await pool.query(`INSERT INTO "User" (id, email, "updatedAt") VALUES ($1, $2, now())`, [owner, email]);
    const other = randomUUID();
    await signUp(other, email);

    await pool.query(fs.readFileSync(MIGRATION, 'utf8'));

    expect(await userIdsByEmail(email)).toEqual([owner]);
  });
});
