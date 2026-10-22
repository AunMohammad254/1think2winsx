/**
 * Daily email limit (migration 06-20261022140000): reserve_email_quota's caps by kind, the rolling
 * 24-hour window and retry time, concurrent reservations, release_email_quota, email_quota_status,
 * and that only the service role can reach any of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, countRows, createPool, errorAs, player, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());
beforeEach(() => resetData(pool));

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '20261022140000_email_daily_quota.sql');

type Reservation = { ok: boolean; id?: number; used: number; cap: number; remaining: number; retryAt?: string | null };

/** Calls the function the way reserveEmails() does (service role, named args). */
async function reserve(kind: string, emails = 1): Promise<Reservation> {
  const rows = await queryAs(pool, serviceRole, `SELECT public.reserve_email_quota(p_kind => $1, p_emails => $2) AS r`, [kind, emails]);
  return rows[0].r;
}

async function release(id: number, keep?: number): Promise<void> {
  await queryAs(
    pool,
    serviceRole,
    keep === undefined
      ? `SELECT public.release_email_quota(p_id => $1)`
      : `SELECT public.release_email_quota(p_id => $1, p_keep => $2)`,
    keep === undefined ? [id] : [id, keep],
  );
}

async function status() {
  return (await queryAs(pool, serviceRole, `SELECT public.email_quota_status() AS r`))[0].r;
}

/**
 * Emails already counted, sent `minutesAgo` minutes before the database clock (as the superuser).
 * Whole milliseconds, so the time compares exactly with the JavaScript Date it comes back as.
 */
async function sentEarlier(emails: number, minutesAgo: number, kind = 'registration'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO "EmailSend" (kind, emails, "sentAt")
     VALUES ($1, $2, date_trunc('milliseconds', now() - make_interval(mins => $3::int))) RETURNING "sentAt"`,
    [kind, emails, minutesAgo],
  );
  return rows[0].sentAt.toISOString();
}

async function setSetting(key: string, value: string | null) {
  await pool.query(`DELETE FROM "AppSettings" WHERE key = $1`, [key]);
  if (value !== null) await pool.query(`INSERT INTO "AppSettings" (key, value) VALUES ($1, $2)`, [key, value]);
}

const plus24h = (instant: string) => new Date(Date.parse(instant) + 24 * 3600_000).toISOString();
const iso = (value: string | null | undefined) => new Date(value!).toISOString();

describe('reserve_email_quota', () => {
  it('counts an email that fits and says what is left', async () => {
    const r = await reserve('registration');
    expect(r).toMatchObject({ ok: true, used: 1, cap: 279, remaining: 278 });
    expect(typeof r.id).toBe('number');
    expect(await countRows(pool, 'EmailSend')).toBe(1);
  });

  it('stops registrations, newsletter sign-ups and newsletters at 279, keeping 20 for the rest', async () => {
    await sentEarlier(279, 60);
    for (const kind of ['registration', 'newsletter_signup', 'newsletter']) {
      expect(await reserve(kind)).toMatchObject({ ok: false, used: 279, cap: 279, remaining: 0 });
    }
    for (const kind of ['password', 'account', 'support']) {
      expect(await reserve(kind)).toMatchObject({ ok: true, cap: 299 });
    }
    await sentEarlier(17, 30, 'password');
    expect(await reserve('password')).toMatchObject({ ok: false, used: 299, cap: 299, remaining: 0 });
  });

  it('takes a newsletter whole or not at all', async () => {
    await sentEarlier(200, 60);
    expect(await reserve('newsletter', 80)).toMatchObject({ ok: false, used: 200, remaining: 79 });
    expect(await reserve('newsletter', 79)).toMatchObject({ ok: true, used: 279, remaining: 0 });
  });

  it('counts only the last 24 hours, and prunes rows older than 3 days', async () => {
    await sentEarlier(279, 24 * 60 + 1); // just outside the window
    await sentEarlier(5, 4 * 24 * 60);
    expect(await reserve('registration')).toMatchObject({ ok: true, used: 1 });
    const { rows } = await pool.query(`SELECT emails FROM "EmailSend" ORDER BY "sentAt"`);
    expect(rows.map((r) => r.emails)).toEqual([279, 1]);
  });

  it('gives the moment enough of the oldest emails leave the window', async () => {
    const oldest = await sentEarlier(100, 23 * 60);
    const middle = await sentEarlier(100, 10 * 60);
    await sentEarlier(79, 60);
    // one more registration needs 1 email to leave: the oldest batch
    expect(iso((await reserve('registration')).retryAt)).toBe(plus24h(oldest));
    // a newsletter of 150 needs 150 to leave: both older batches
    const r = await reserve('newsletter', 150);
    expect(r).toMatchObject({ ok: false, used: 279, remaining: 0 });
    expect(iso(r.retryAt)).toBe(plus24h(middle));
  });

  it('gives no retry time for a request bigger than the cap', async () => {
    expect(await reserve('newsletter', 280)).toEqual({ ok: false, used: 0, cap: 279, remaining: 279, retryAt: null });
    expect(await countRows(pool, 'EmailSend')).toBe(0);
  });

  it('lets exactly the cap through when many requests arrive together', async () => {
    await setSetting('email_daily_limit', '40');
    await sentEarlier(1, 5); // 1 used, so 19 of the 20 registration places are left
    const results = await Promise.all(Array.from({ length: 30 }, () => reserve('registration')));
    expect(results.filter((r) => r.ok)).toHaveLength(19);
    expect(await status()).toMatchObject({ used: 20, cap: 20, capRemaining: 0 });
  });

  it('reads the limit and reserve from AppSettings, with safe fallbacks', async () => {
    await setSetting('email_daily_limit', '5000');
    await setSetting('email_essential_reserve', '100');
    expect(await reserve('registration')).toMatchObject({ cap: 4900 });
    expect(await reserve('support')).toMatchObject({ cap: 5000 });

    await setSetting('email_daily_limit', 'lots');
    await setSetting('email_essential_reserve', '-3');
    expect(await reserve('registration')).toMatchObject({ cap: 279 });

    // a reserve bigger than the limit closes registrations, not the essential emails
    await setSetting('email_daily_limit', '10');
    await setSetting('email_essential_reserve', '50');
    expect(await reserve('registration')).toMatchObject({ ok: false, cap: 0, retryAt: null });
    expect(await reserve('password')).toMatchObject({ ok: true, cap: 10 });
  });

  it('ships the default settings rows', async () => {
    await pool.query(fs.readFileSync(MIGRATION, 'utf8'));
    const { rows } = await pool.query(`SELECT key, value FROM "AppSettings" WHERE key LIKE 'email_%' ORDER BY key`);
    expect(rows).toEqual([
      { key: 'email_daily_limit', value: '299' },
      { key: 'email_essential_reserve', value: '20' },
    ]);
  });

  it.each([
    ['an unknown kind', `'marketing'`, '1'],
    ['a null kind', 'NULL', '1'],
    ['zero emails', `'newsletter'`, '0'],
    ['null emails', `'newsletter'`, 'NULL'],
  ])('refuses %s', async (_label, kind, emails) => {
    const error = await errorAs(pool, serviceRole, `SELECT public.reserve_email_quota(${kind}, ${emails})`);
    expect(error.code).toBe('22023');
  });
});

describe('release_email_quota', () => {
  it('removes a reservation, or keeps part of it, but never raises it', async () => {
    const a = await reserve('registration');
    const b = await reserve('newsletter', 50);
    await release(a.id!);
    await release(b.id!, 30);
    expect(await status()).toMatchObject({ used: 30 });
    await release(b.id!, 45);
    expect(await status()).toMatchObject({ used: 30 });
    await release(b.id!, 0);
    expect(await countRows(pool, 'EmailSend')).toBe(0);
    await release(12345); // an unknown id is a no-op
  });
});

describe('email_quota_status', () => {
  it('reports an empty window', async () => {
    expect(await status()).toEqual({ used: 0, limit: 299, reserve: 20, cap: 279, remaining: 299, capRemaining: 279, nextFreeAt: null });
  });

  it('reports what is used and when the oldest counted email leaves the window', async () => {
    await sentEarlier(3, 25 * 60);
    const oldest = await sentEarlier(250, 120);
    await sentEarlier(40, 10, 'password');
    const s = await status();
    expect(s).toMatchObject({ used: 290, limit: 299, cap: 279, remaining: 9, capRemaining: 0 });
    expect(iso(s.nextFreeAt)).toBe(plus24h(oldest));
  });
});

describe('access', () => {
  it.each([
    ['anon', false],
    ['a signed-in player', true],
  ])('gives %s no access at all', async (_label, signedIn) => {
    const caller = signedIn ? player(randomUUID()) : anon;
    for (const sql of [
      `SELECT * FROM "EmailSend"`,
      `INSERT INTO "EmailSend" (kind, emails) VALUES ('support', 1)`,
      `DELETE FROM "EmailSend"`,
      `SELECT public.reserve_email_quota('registration')`,
      `SELECT public.release_email_quota(1)`,
      `SELECT public.email_quota_status()`,
      `SELECT public.email_quota_settings()`,
    ]) {
      expect((await errorAs(pool, caller, sql)).code).toBe('42501');
    }
  });

  it('has row-level security on, with no policies', async () => {
    const { rows } = await pool.query(
      `SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = 'EmailSend') AS policies
         FROM pg_class c WHERE c.oid = 'public."EmailSend"'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, policies: 0 });
  });

  it('can be re-run, and takes away grants that default privileges would give anon and authenticated', async () => {
    await pool.query(`GRANT ALL ON public."EmailSend" TO anon, authenticated`);
    await pool.query(`GRANT EXECUTE ON FUNCTION public.reserve_email_quota(text, integer) TO anon, authenticated`);
    await pool.query(fs.readFileSync(MIGRATION, 'utf8'));
    const { rows } = await pool.query(
      `SELECT r AS role,
              has_table_privilege(r, 'public."EmailSend"', 'SELECT,INSERT,UPDATE,DELETE') AS any_table,
              has_function_privilege(r, 'public.reserve_email_quota(text, integer)', 'EXECUTE') AS reserve_fn,
              has_function_privilege(r, 'public.release_email_quota(bigint, integer)', 'EXECUTE') AS release_fn,
              has_function_privilege(r, 'public.email_quota_status()', 'EXECUTE') AS status_fn
         FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r ORDER BY r`,
    );
    expect(rows).toEqual([
      { role: 'anon', any_table: false, reserve_fn: false, release_fn: false, status_fn: false },
      { role: 'authenticated', any_table: false, reserve_fn: false, release_fn: false, status_fn: false },
      { role: 'service_role', any_table: true, reserve_fn: true, release_fn: true, status_fn: true },
    ]);
  });

  it('is identical to its copy in db-tests/schema', () => {
    const copy = path.join(__dirname, 'schema', '06-20261022140000_email_daily_quota.sql');
    expect(fs.readFileSync(copy, 'utf8')).toBe(fs.readFileSync(MIGRATION, 'utf8'));
  });
});
