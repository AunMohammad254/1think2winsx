/**
 * Player reviews (migration 06-20261106180000): the table's limits, one review per player, that a
 * review goes with its player, and that only the service role can reach it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, countRows, createPool, createUser, errorAs, player, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());
beforeEach(() => resetData(pool));

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '20261106180000_player_reviews.sql');

const insert = (userId: string, columns: Record<string, unknown> = {}) => {
  const row = { rating: 5, comment: 'Brilliant quizzes!', displayName: 'Areeba K.', ...columns };
  const names = Object.keys(row);
  return queryAs(
    pool,
    serviceRole,
    `INSERT INTO "Review" ("userId", ${names.map((n) => `"${n}"`).join(', ')}) VALUES ($1, ${names.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
    [userId, ...Object.values(row)],
  );
};
const insertError = (userId: string, columns: Record<string, unknown>) =>
  errorAs(pool, serviceRole, `INSERT INTO "Review" ("userId", rating, comment, "displayName", city, status) VALUES ($1, $2, $3, $4, $5, $6)`, [
    userId,
    columns.rating ?? 5,
    columns.comment ?? 'Brilliant quizzes!',
    columns.displayName ?? 'Areeba K.',
    columns.city ?? null,
    columns.status ?? 'pending',
  ]);

describe('"Review"', () => {
  it('starts pending, with defaults for the id and times', async () => {
    const user = await createUser(pool);
    const [row] = await insert(user.id);
    expect(row).toMatchObject({ userId: user.id, rating: 5, status: 'pending', city: null, moderationNote: null, moderatedBy: null });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('keeps one review per player, which an upsert on "userId" edits', async () => {
    const user = await createUser(pool);
    await insert(user.id);
    expect((await insertError(user.id, {})).code).toBe('23505');
    await queryAs(
      pool,
      serviceRole,
      `INSERT INTO "Review" ("userId", rating, comment, "displayName") VALUES ($1, 3, 'Changed my mind a bit', 'Ali')
       ON CONFLICT ("userId") DO UPDATE SET rating = excluded.rating, comment = excluded.comment`,
      [user.id],
    );
    expect(await countRows(pool, 'Review', user.id)).toBe(1);
    const [row] = await queryAs(pool, serviceRole, `SELECT rating, comment FROM "Review" WHERE "userId" = $1`, [user.id]);
    expect(row).toEqual({ rating: 3, comment: 'Changed my mind a bit' });
  });

  it.each([
    ['a rating of 0', { rating: 0 }],
    ['a rating of 6', { rating: 6 }],
    ['a comment under 10 characters, after trimming', { comment: '   short    ' }],
    ['a comment over 500 characters', { comment: 'x'.repeat(501) }],
    ['a one-letter name', { displayName: ' A ' }],
    ['a name over 40 characters', { displayName: 'x'.repeat(41) }],
    ['a one-letter city', { city: 'K' }],
    ['an unknown status', { status: 'hidden' }],
  ])('refuses %s', async (_name, columns) => {
    const user = await createUser(pool);
    expect((await insertError(user.id, columns)).code).toBe('23514');
  });

  it('refuses a player that does not exist', async () => {
    expect((await insertError('ghost', {})).code).toBe('23503');
  });

  it('follows an id change and goes with its player', async () => {
    const user = await createUser(pool);
    await insert(user.id);
    await pool.query(`UPDATE "User" SET id = 'renamed' WHERE id = $1`, [user.id]);
    expect(await countRows(pool, 'Review', 'renamed')).toBe(1);
    await pool.query(`DELETE FROM "User" WHERE id = 'renamed'`);
    expect(await countRows(pool, 'Review')).toBe(0);
  });

  it.each([false, true])('is out of reach for players and anon (signed in: %s)', async (signedIn) => {
    const user = await createUser(pool);
    await insert(user.id);
    const caller = signedIn ? player(user.id, user.email) : anon;
    for (const sql of [
      `SELECT * FROM "Review"`,
      `INSERT INTO "Review" ("userId", rating, comment, "displayName") VALUES ('${user.id}', 5, 'Brilliant quizzes!', 'Ali')`,
      `UPDATE "Review" SET status = 'approved'`,
      `DELETE FROM "Review"`,
    ]) {
      expect((await errorAs(pool, caller, sql)).code).toBe('42501');
    }
  });

  it('lets the service role read, change and delete reviews', async () => {
    const user = await createUser(pool);
    const [row] = await insert(user.id);
    await queryAs(pool, serviceRole, `UPDATE "Review" SET status = 'approved', "moderatedBy" = 'boss@example.test', "moderatedAt" = now() WHERE id = $1`, [row.id]);
    await queryAs(pool, serviceRole, `DELETE FROM "Review" WHERE id = $1`, [row.id]);
    expect(await countRows(pool, 'Review')).toBe(0);
  });

  it('has row-level security on, with no policies', async () => {
    const { rows } = await pool.query(
      `SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = 'Review') AS policies
         FROM pg_class c WHERE c.oid = 'public."Review"'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, policies: 0 });
  });

  it('can be applied again without harm', async () => {
    const user = await createUser(pool);
    await insert(user.id);
    await pool.query(fs.readFileSync(MIGRATION, 'utf8'));
    expect(await countRows(pool, 'Review')).toBe(1);
  });
});
