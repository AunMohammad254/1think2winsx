/**
 * Cloudflare as a third email service (migration 06-20261104120000): "EmailLog" takes 'cloudflare',
 * the daily limit follows email_daily_limit_cloudflare while Cloudflare is selected, the settings row,
 * the guard, and that only the service role can reach email_quota_settings().
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, createPool, errorAs, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
const migration = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', name), 'utf8');
const MIGRATION = '20261104120000_email_cloudflare.sql';

// Other files put back older versions of email_quota_settings(): replay the chain up to this one
beforeAll(async () => {
  for (const name of ['20261022140000_email_daily_quota.sql', '20261023120000_email_providers.sql', MIGRATION]) {
    await pool.query(migration(name));
  }
});
afterAll(() => pool.end());
beforeEach(() => resetData(pool));

async function setSetting(key: string, value: string | null) {
  await pool.query(`DELETE FROM "AppSettings" WHERE key = $1`, [key]);
  if (value !== null) await pool.query(`INSERT INTO "AppSettings" (key, value) VALUES ($1, $2)`, [key, value]);
}

const settings = async () => (await queryAs(pool, serviceRole, `SELECT * FROM public.email_quota_settings()`))[0];

describe('EmailLog table', () => {
  it('takes Cloudflare as a service, and still refuses an unknown one', async () => {
    const insert = (provider: string) =>
      `INSERT INTO "EmailLog" (kind, recipient, provider, status) VALUES ('registration', 'a@b.co', '${provider}', 'accepted')`;
    await queryAs(pool, serviceRole, insert('cloudflare'));
    expect((await errorAs(pool, serviceRole, insert('mailgun'))).code).toBe('23514');
  });
});

describe('the daily limit follows the selected service', () => {
  it('uses the Cloudflare limit (default 99) once an admin picks cloudflare', async () => {
    await setSetting('email_provider', ' cloudflare ');
    expect(await settings()).toEqual({ daily_limit: 99, essential_reserve: 20 });
    await setSetting('email_daily_limit_cloudflare', ' 2900 ');
    expect(await settings()).toEqual({ daily_limit: 2900, essential_reserve: 20 });
    await setSetting('email_daily_limit_cloudflare', 'lots');
    expect(await settings()).toEqual({ daily_limit: 99, essential_reserve: 20 });
    await setSetting('email_daily_limit_cloudflare', '10');
    expect(await settings()).toEqual({ daily_limit: 10, essential_reserve: 10 });
  });

  it('keeps the Brevo and SES limits as they were', async () => {
    await setSetting('email_daily_limit_cloudflare', '5');
    expect(await settings()).toEqual({ daily_limit: 299, essential_reserve: 20 });
    await setSetting('email_provider', 'brevo');
    expect(await settings()).toEqual({ daily_limit: 299, essential_reserve: 20 });
    await setSetting('email_provider', 'ses');
    expect(await settings()).toEqual({ daily_limit: 199, essential_reserve: 20 });
    await setSetting('email_daily_limit_ses', '1999');
    expect(await settings()).toEqual({ daily_limit: 1999, essential_reserve: 20 });
  });

  it('reserves against the Cloudflare limit', async () => {
    await setSetting('email_provider', 'cloudflare');
    const rows = await queryAs(pool, serviceRole, `SELECT public.reserve_email_quota('registration') AS r`);
    expect(rows[0].r).toMatchObject({ ok: true, cap: 79 });
    expect((await queryAs(pool, serviceRole, `SELECT public.email_quota_status() AS s`))[0].s).toMatchObject({ limit: 99, cap: 79, used: 1 });
  });

  it('ships the setting row without changing an existing one, and describes the three services', async () => {
    await setSetting('email_provider', 'ses');
    await setSetting('email_daily_limit_cloudflare', '500');
    await pool.query(migration(MIGRATION));
    const { rows } = await pool.query(
      `SELECT key, value, description FROM "AppSettings" WHERE key IN ('email_provider', 'email_daily_limit_cloudflare') ORDER BY key`,
    );
    expect(rows.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'email_daily_limit_cloudflare', value: '500' },
      { key: 'email_provider', value: 'ses' },
    ]);
    expect(rows[1].description).toContain('ses, brevo or cloudflare');

    await pool.query(`DELETE FROM "AppSettings" WHERE key = 'email_daily_limit_cloudflare'`);
    await pool.query(migration(MIGRATION));
    const added = await pool.query(`SELECT value FROM "AppSettings" WHERE key = 'email_daily_limit_cloudflare'`);
    expect(added.rows).toEqual([{ value: '99' }]);
  });
});

describe('access', () => {
  it('can be re-run, and only the service role can read the limit', async () => {
    await pool.query(`GRANT EXECUTE ON FUNCTION public.email_quota_settings() TO anon, authenticated`);
    await pool.query(migration(MIGRATION));
    expect((await errorAs(pool, anon, `SELECT * FROM public.email_quota_settings()`)).code).toBe('42501');
    const { rows } = await pool.query(
      `SELECT r AS role, has_function_privilege(r, 'public.email_quota_settings()', 'EXECUTE') AS settings_fn
         FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r ORDER BY r`,
    );
    expect(rows).toEqual([
      { role: 'anon', settings_fn: false },
      { role: 'authenticated', settings_fn: false },
      { role: 'service_role', settings_fn: true },
    ]);
  });

  it('stops when email_quota_settings() was changed since, instead of overwriting it', async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(`CREATE OR REPLACE FUNCTION public.email_quota_settings(OUT daily_limit integer, OUT essential_reserve integer)
                        LANGUAGE sql STABLE AS $$ SELECT 1000, 10 $$`);
      await expect(db.query(migration(MIGRATION))).rejects.toThrow('is not the version this migration was written against');
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });

  it('is identical to its copy in db-tests/schema', () => {
    const copy = path.join(__dirname, 'schema', '06-20261104120000_email_cloudflare.sql');
    expect(fs.readFileSync(copy, 'utf8')).toBe(migration(MIGRATION));
  });
});
