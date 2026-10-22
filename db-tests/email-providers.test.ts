/**
 * Email services (migration 06-20261023120000): the "EmailLog" table and its pruning, service
 * notices through record_email_event, email_log_totals, the daily limit of the selected service in
 * email_quota_settings, and that only the service role can reach any of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, countRows, createPool, errorAs, player, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '20261023120000_email_providers.sql');

// email-quota.test.ts re-runs the older daily-limit migration, which puts back the older
// email_quota_settings(); this file needs the one from this migration
beforeAll(() => pool.query(fs.readFileSync(MIGRATION, 'utf8')));
afterAll(() => pool.end());
beforeEach(() => resetData(pool));

type LogRow = { provider?: string; status?: string; messageId?: string | null; kind?: string; minutesAgo?: number };

/** A log row, as the superuser; returns its id. */
async function logged({ provider = 'ses', status = 'accepted', messageId = null, kind = 'registration', minutesAgo = 0 }: LogRow = {}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO "EmailLog" (kind, recipient, subject, provider, status, "providerMessageId", "sentAt")
     VALUES ($1, 'fan@example.test', 'Confirm your account', $2, $3, $4, now() - make_interval(mins => $5::int)) RETURNING id`,
    [kind, provider, status, messageId, minutesAgo],
  );
  return Number(rows[0].id);
}

const statusOf = async (id: number) => (await pool.query(`SELECT status, error FROM "EmailLog" WHERE id = $1`, [id])).rows[0];

async function event(provider: string, messageId: string, status: string, error: string | null = null): Promise<number> {
  const rows = await queryAs(pool, serviceRole, `SELECT public.record_email_event($1, $2, $3, $4) AS n`, [provider, messageId, status, error]);
  return rows[0].n;
}

async function setSetting(key: string, value: string | null) {
  await pool.query(`DELETE FROM "AppSettings" WHERE key = $1`, [key]);
  if (value !== null) await pool.query(`INSERT INTO "AppSettings" (key, value) VALUES ($1, $2)`, [key, value]);
}

const settings = async () => (await queryAs(pool, serviceRole, `SELECT * FROM public.email_quota_settings()`))[0];

describe('EmailLog table', () => {
  it('takes a row from the service role, with defaults for the time and subject', async () => {
    const rows = await queryAs(
      pool,
      serviceRole,
      `INSERT INTO "EmailLog" (kind, recipient, provider, status) VALUES ('support', 'a@b.co', 'brevo', 'accepted') RETURNING subject, "sentAt"`,
    );
    expect(rows[0].subject).toBe('');
    expect(Date.parse(rows[0].sentAt)).toBeGreaterThan(0);
  });

  it.each([
    ['an unknown kind', `'marketing'`, `'ses'`, `'accepted'`],
    ['an unknown service', `'support'`, `'mailgun'`, `'accepted'`],
    ['an unknown result', `'support'`, `'ses'`, `'opened'`],
  ])('rejects %s', async (_label, kind, provider, status) => {
    const error = await errorAs(pool, serviceRole, `INSERT INTO "EmailLog" (kind, recipient, provider, status) VALUES (${kind}, 'a@b.co', ${provider}, ${status})`);
    expect(error.code).toBe('23514');
  });

  it('prunes rows older than 90 days when new ones are written', async () => {
    await logged({ minutesAgo: 91 * 24 * 60 });
    await logged({ minutesAgo: 89 * 24 * 60 });
    expect(await countRows(pool, 'EmailLog')).toBe(1);
  });
});

describe('record_email_event', () => {
  it('moves an email from accepted to delivered, then to bounced', async () => {
    const id = await logged({ messageId: 'm-1' });
    expect(await event('ses', 'm-1', 'delivered')).toBe(1);
    expect(await statusOf(id)).toEqual({ status: 'delivered', error: null });
    expect(await event('ses', 'm-1', 'bounced', 'Mailbox does not exist')).toBe(1);
    expect(await statusOf(id)).toEqual({ status: 'bounced', error: 'Mailbox does not exist' });
  });

  it('never takes a result back: a late delivered notice leaves a bounce alone', async () => {
    const id = await logged({ messageId: 'm-2', status: 'bounced' });
    expect(await event('ses', 'm-2', 'delivered')).toBe(0);
    expect(await event('ses', 'm-2', 'complained')).toBe(0);
    expect((await statusOf(id)).status).toBe('bounced');

    const complained = await logged({ messageId: 'm-3', status: 'delivered' });
    expect(await event('ses', 'm-3', 'complained')).toBe(1);
    expect((await statusOf(complained)).status).toBe('complained');
  });

  it('matches by service and message id only, and never touches a failed email', async () => {
    const brevo = await logged({ provider: 'brevo', messageId: 'same-id' });
    expect(await event('ses', 'same-id', 'delivered')).toBe(0);
    expect((await statusOf(brevo)).status).toBe('accepted');
    expect(await event('brevo', 'no-such-id', 'delivered')).toBe(0);

    const failed = await logged({ messageId: 'm-4', status: 'failed' });
    expect(await event('ses', 'm-4', 'bounced')).toBe(0);
    expect((await statusOf(failed)).status).toBe('failed');
  });

  it('keeps the error to 1,000 characters and refuses an unknown result', async () => {
    const id = await logged({ messageId: 'm-5' });
    await event('ses', 'm-5', 'bounced', 'x'.repeat(1500));
    expect((await statusOf(id)).error).toHaveLength(1000);
    for (const status of ['accepted', 'failed', 'opened']) {
      expect((await errorAs(pool, serviceRole, `SELECT public.record_email_event('ses', 'm-5', '${status}')`)).code).toBe('22023');
    }
    expect((await errorAs(pool, serviceRole, `SELECT public.record_email_event('ses', 'm-5', NULL)`)).code).toBe('22023');
  });
});

describe('email_log_totals', () => {
  it('counts by service and result for the last 24 hours and 30 days', async () => {
    await logged({ provider: 'ses', status: 'accepted' });
    await logged({ provider: 'ses', status: 'accepted', minutesAgo: 60 });
    await logged({ provider: 'ses', status: 'failed', minutesAgo: 2 * 24 * 60 });
    await logged({ provider: 'brevo', status: 'bounced', minutesAgo: 40 * 24 * 60 });
    const rows = await queryAs(pool, serviceRole, `SELECT public.email_log_totals() AS t`);
    expect(rows[0].t).toEqual([
      { provider: 'ses', period: '24h', status: 'accepted', count: 2 },
      { provider: 'ses', period: '30d', status: 'accepted', count: 2 },
      { provider: 'ses', period: '30d', status: 'failed', count: 1 },
    ]);
  });

  it('is an empty list with no emails', async () => {
    expect((await queryAs(pool, serviceRole, `SELECT public.email_log_totals() AS t`))[0].t).toEqual([]);
  });
});

describe('the daily limit follows the selected service', () => {
  it('uses the Brevo limit (299) by default and for brevo', async () => {
    expect(await settings()).toEqual({ daily_limit: 299, essential_reserve: 20 });
    await setSetting('email_provider', 'brevo');
    await setSetting('email_daily_limit_ses', '5000');
    expect(await settings()).toEqual({ daily_limit: 299, essential_reserve: 20 });
  });

  it('uses the SES limit (default 199) once an admin picks ses', async () => {
    await setSetting('email_provider', ' ses ');
    expect(await settings()).toEqual({ daily_limit: 199, essential_reserve: 20 });
    await setSetting('email_daily_limit_ses', '45000');
    await setSetting('email_essential_reserve', '200');
    expect(await settings()).toEqual({ daily_limit: 45000, essential_reserve: 200 });
    await setSetting('email_daily_limit_ses', 'lots');
    expect(await settings()).toEqual({ daily_limit: 199, essential_reserve: 199 });
  });

  it('reserves against the selected limit', async () => {
    await setSetting('email_provider', 'ses');
    const rows = await queryAs(pool, serviceRole, `SELECT public.reserve_email_quota('registration') AS r`);
    expect(rows[0].r).toMatchObject({ ok: true, cap: 179 });
    expect((await queryAs(pool, serviceRole, `SELECT public.email_quota_status() AS s`))[0].s).toMatchObject({ limit: 199, cap: 179, used: 1 });
  });

  it('ships the settings rows without changing existing ones', async () => {
    await setSetting('email_provider', 'ses');
    await pool.query(fs.readFileSync(MIGRATION, 'utf8'));
    const { rows } = await pool.query(`SELECT key, value FROM "AppSettings" WHERE key IN ('email_provider', 'email_daily_limit_ses') ORDER BY key`);
    expect(rows).toEqual([
      { key: 'email_daily_limit_ses', value: '199' },
      { key: 'email_provider', value: 'ses' },
    ]);
  });
});

describe('access', () => {
  it.each([
    ['anon', false],
    ['a signed-in player', true],
  ])('gives %s no access at all', async (_label, signedIn) => {
    await logged({ messageId: 'm-9' });
    const caller = signedIn ? player(randomUUID()) : anon;
    for (const sql of [
      `SELECT * FROM "EmailLog"`,
      `INSERT INTO "EmailLog" (kind, recipient, provider, status) VALUES ('support', 'a@b.co', 'ses', 'accepted')`,
      `UPDATE "EmailLog" SET status = 'delivered'`,
      `SELECT public.record_email_event('ses', 'm-9', 'delivered')`,
      `SELECT public.email_log_totals()`,
    ]) {
      expect((await errorAs(pool, caller, sql)).code).toBe('42501');
    }
  });

  it('has row-level security on, with no policies', async () => {
    const { rows } = await pool.query(
      `SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = 'EmailLog') AS policies
         FROM pg_class c WHERE c.oid = 'public."EmailLog"'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, policies: 0 });
  });

  it('can be re-run, and takes away grants that default privileges would give anon and authenticated', async () => {
    await pool.query(`GRANT ALL ON public."EmailLog" TO anon, authenticated`);
    await pool.query(`GRANT EXECUTE ON FUNCTION public.record_email_event(text, text, text, text) TO anon, authenticated`);
    await pool.query(fs.readFileSync(MIGRATION, 'utf8'));
    const { rows } = await pool.query(
      `SELECT r AS role,
              has_table_privilege(r, 'public."EmailLog"', 'SELECT,INSERT,UPDATE,DELETE') AS any_table,
              has_function_privilege(r, 'public.record_email_event(text, text, text, text)', 'EXECUTE') AS event_fn,
              has_function_privilege(r, 'public.email_log_totals()', 'EXECUTE') AS totals_fn,
              has_function_privilege(r, 'public.email_quota_settings()', 'EXECUTE') AS settings_fn
         FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r ORDER BY r`,
    );
    expect(rows).toEqual([
      { role: 'anon', any_table: false, event_fn: false, totals_fn: false, settings_fn: false },
      { role: 'authenticated', any_table: false, event_fn: false, totals_fn: false, settings_fn: false },
      { role: 'service_role', any_table: true, event_fn: true, totals_fn: true, settings_fn: true },
    ]);
  });

  it('stops when email_quota_settings() was changed since, instead of overwriting it', async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(`CREATE OR REPLACE FUNCTION public.email_quota_settings(OUT daily_limit integer, OUT essential_reserve integer)
                        LANGUAGE sql STABLE AS $$ SELECT 1000, 10 $$`);
      await expect(db.query(fs.readFileSync(MIGRATION, 'utf8'))).rejects.toThrow('is not the version this migration was written against');
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });

  it('is identical to its copy in db-tests/schema', () => {
    const copy = path.join(__dirname, 'schema', '06-20261023120000_email_providers.sql');
    expect(fs.readFileSync(copy, 'utf8')).toBe(fs.readFileSync(MIGRATION, 'utf8'));
  });
});
