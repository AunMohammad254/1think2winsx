/**
 * Migration 06-20261113120000: "send to all" as a resumable job (src/lib/supabase/db-modules/notification.db.ts).
 * One "Broadcast" row holds the job; players' notices go in by cursor, so a re-run or a second caller never
 * gives anyone two; a lease keeps one caller per broadcast; the same broadcast within 15 minutes is refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, createPool, createUser, errorAs, player, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = fs.readFileSync(path.join(__dirname, 'schema', '06-20261113120000_broadcast_jobs.sql'), 'utf8');

beforeEach(async () => {
  await resetData(pool);
});

const rpc = async (sql: string, params: unknown[] = []) => (await queryAs(pool, serviceRole, `SELECT ${sql} AS r`, params))[0].r;
const create = (title = 'Live now', message = 'Go', type = 'quiz_live', link: string | null = '/quizzes?openQuiz=q') =>
  rpc('broadcast_create($1, $2, $3, $4)', [title, message, type, link]);
const insertUsers = (id: string, limit: number) => rpc('broadcast_insert_users($1, $2)', [id, limit]);
const claim = () => rpc('broadcast_claim(300)');
const row = async (id: string) => (await pool.query(`SELECT * FROM "Broadcast" WHERE id = $1`, [id])).rows[0];
const players = async (n: number) => Promise.all(Array.from({ length: n }, () => createUser(pool)));
const noticesPerPlayer = async () =>
  (await pool.query(`SELECT "userId", count(*)::int AS n FROM "Notification" GROUP BY "userId"`)).rows.map((r) => r.n);

describe('broadcast_create', () => {
  it('makes one job, and returns that one for the same broadcast within 15 minutes', async () => {
    const first = await create();
    expect(first).toMatchObject({ success: true, duplicate: false });
    expect(await create()).toEqual({ success: true, id: first.id, duplicate: true });
    // Anything different is a different broadcast
    expect((await create('Live now', 'Go now')).duplicate).toBe(false);
    expect((await create('Live now', 'Go', 'quiz_live', null)).duplicate).toBe(false);
    // 15 minutes on, the same words are a new broadcast
    await pool.query(`UPDATE "Broadcast" SET "createdAt" = now() - interval '16 minutes'`);
    expect((await create()).duplicate).toBe(false);
    expect(await row(first.id)).toMatchObject({ status: 'inserting', title: 'Live now', link: '/quizzes?openQuiz=q', inserted: 0, pushed: 0 });
  });

  it('makes one job when two requests arrive at once', async () => {
    const both = await Promise.all([create(), create()]);
    expect(both.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect(both[0].id).toBe(both[1].id);
  });

  it('refuses an empty title, message or type, and stores an empty link as none', async () => {
    for (const [t, m, k] of [[' ', 'm', 'x'], ['t', '', 'x'], ['t', 'm', null]]) {
      expect(await create(t as string, m as string, k as string)).toMatchObject({ success: false, code: 'invalid' });
    }
    const made = await create('t', 'm', 'x', '');
    expect((await row(made.id)).link).toBeNull();
  });
});

describe('broadcast_insert_users', () => {
  it('gives every player one notice, a chunk at a time, then moves on to pushing', async () => {
    await players(7);
    const { id } = await create();
    expect(await insertUsers(id, 3)).toEqual({ success: true, inserted: 3, done: false });
    expect(await insertUsers(id, 3)).toEqual({ success: true, inserted: 3, done: false });
    expect(await insertUsers(id, 3)).toEqual({ success: true, inserted: 1, done: true });
    expect(await row(id)).toMatchObject({ status: 'pushing', inserted: 7 });
    expect(await noticesPerPlayer()).toEqual([1, 1, 1, 1, 1, 1, 1]);
    // Run again, after a restart: nothing more
    expect(await insertUsers(id, 3)).toEqual({ success: true, inserted: 0, done: true });
    expect(await noticesPerPlayer()).toHaveLength(7);

    const notice = (await pool.query(`SELECT * FROM "Notification" LIMIT 1`)).rows[0];
    expect(notice).toMatchObject({ title: 'Live now', message: 'Go', type: 'quiz_live', link: '/quizzes?openQuiz=q', read: false });
  });

  it('a player who signs up while it runs gets the notice too, when their id is after the cursor', async () => {
    await players(4);
    const { id } = await create();
    await insertUsers(id, 2);
    await pool.query(`INSERT INTO "User" (id, email, "updatedAt") VALUES ('zzzz-late', 'late@example.test', now())`);
    await insertUsers(id, 10);
    expect(await noticesPerPlayer()).toHaveLength(5);
  });

  it('two callers at once never give anyone two notices', async () => {
    await players(9);
    const { id } = await create();
    await Promise.all([insertUsers(id, 4), insertUsers(id, 4), insertUsers(id, 4)]);
    expect((await noticesPerPlayer()).sort()).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect((await row(id)).inserted).toBe(9);
  });

  it('ends at once with no players, and answers not_found for an unknown job', async () => {
    const { id } = await create();
    expect(await insertUsers(id, 100)).toEqual({ success: true, inserted: 0, done: true });
    expect(await insertUsers('nope', 100)).toEqual({ success: false, code: 'not_found' });
  });
});

describe('broadcast_claim, broadcast_wave_done and broadcast_release', () => {
  it('leases a due job to one caller, records its waves for that caller only, and finishes', async () => {
    const { id } = await create();
    const first = await claim();
    expect(first).toMatchObject({ id, status: 'inserting', title: 'Live now', type: 'quiz_live', pushCursor: null });
    expect(first.token).toEqual(expect.any(String));
    // Held: nobody else gets it
    expect(await claim()).toBeNull();

    await insertUsers(id, 10);
    const wave = (token: string, cursor: string | null, sent: number, last: boolean, gap = 60) =>
      rpc('broadcast_wave_done($1, $2, $3, $4, $5, $6)', [id, token, cursor, sent, last, gap]);
    expect(await wave('not-the-token', 's9', 5, true)).toEqual({ success: false });
    expect(await row(id)).toMatchObject({ pushed: 0, status: 'pushing' });

    expect(await wave(first.token, 's2', 3, false, 60)).toEqual({ success: true });
    const after = await row(id);
    expect(after).toMatchObject({ pushCursor: 's2', pushed: 3, waves: 1, status: 'pushing', leaseToken: null, leaseUntil: null });
    // The next wave is due in a minute, not now
    expect(await claim()).toBeNull();
    await pool.query(`UPDATE "Broadcast" SET "nextWaveAt" = now() - interval '1 second'`);
    const second = await claim();
    expect(second).toMatchObject({ id, status: 'pushing', pushCursor: 's2' });
    expect(await wave(second.token, null, 0, true)).toEqual({ success: true });
    expect(await row(id)).toMatchObject({ status: 'done', pushCursor: 's2', waves: 2 });
    expect((await row(id)).doneAt).not.toBeNull();
    expect(await claim()).toBeNull();
  });

  it('gives a job back early, and to the next caller once a lease runs out', async () => {
    const { id } = await create();
    const first = await claim();
    expect(await rpc('broadcast_release($1, $2)', [id, 'other'])).toEqual({ success: false });
    expect(await rpc('broadcast_release($1, $2)', [id, first.token])).toEqual({ success: true });
    const second = await claim();
    expect(second.id).toBe(id);
    await pool.query(`UPDATE "Broadcast" SET "leaseUntil" = now() - interval '1 second'`);
    const third = await claim();
    expect(third.id).toBe(id);
    expect(third.token).not.toBe(second.token);
    expect((await row(id)).attempts).toBe(3);
  });

  it('leaves jobs older than 6 hours alone, and hands out the oldest first', async () => {
    const old = await create('a', 'm', 'x');
    const newer = await create('b', 'm', 'x');
    await pool.query(`UPDATE "Broadcast" SET "createdAt" = now() - interval '7 hours' WHERE id = $1`, [old.id]);
    expect((await claim()).id).toBe(newer.id);
    expect(await claim()).toBeNull();
  });
});

describe('privileges', () => {
  it('only the service role can call the functions or read the table', async () => {
    const user = await createUser(pool);
    for (const caller of [anon, player(user.id)]) {
      expect((await errorAs(pool, caller, `SELECT broadcast_create('t', 'm', 'x', null)`)).code).toBe('42501');
      expect((await errorAs(pool, caller, `SELECT broadcast_claim(300)`)).code).toBe('42501');
      expect((await errorAs(pool, caller, `SELECT * FROM "Broadcast"`)).code).toBe('42501');
    }
    expect(await queryAs(pool, serviceRole, `SELECT count(*)::int AS n FROM "Broadcast"`)).toEqual([{ n: 0 }]);
    // The service role reads the table but changes it only through the functions
    expect((await errorAs(pool, serviceRole, `INSERT INTO "Broadcast" ("dedupeKey", title, message, type) VALUES ('k', 't', 'm', 'x')`)).code).toBe('42501');
  });

  it('can run again', async () => {
    const { id } = await create();
    await pool.query(MIGRATION);
    expect(await row(id)).toMatchObject({ status: 'inserting' });
    expect((await create()).duplicate).toBe(true);
  });
});
