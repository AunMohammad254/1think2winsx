/**
 * Migration 06-20261112120000: apply_match_change, save_quiz_result and settle_quiz carry their own
 * statement_timeout, above the 8 s the service role gets by default. PostgREST applies a function's
 * timeout to the call's transaction; it doesn't run here, so these tests check what it reads: the
 * functions' settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { createPool } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = fs.readFileSync(path.join(__dirname, 'schema', '06-20261112120000_scoring_time_limit.sql'), 'utf8');

const FUNCTIONS = ['apply_match_change', 'save_quiz_result', 'settle_quiz'];
/** What the server waits for a service-role call (SUPABASE_ADMIN_FETCH_TIMEOUT_MS in src/lib/supabase/timeout-fetch.ts) */
const APP_WAIT_MS = 30_000;

type Row = { name: string; settings: string[] | null; definer: boolean; body: string };

async function functions(): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `SELECT proname AS name, proconfig AS settings, prosecdef AS definer, md5(prosrc) AS body
       FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1) ORDER BY proname`,
    [FUNCTIONS]);
  return rows;
}

it('gives each of the three its own limit, next to its search_path', async () => {
  const rows = await functions();
  // One version of each: no older overload left behind without the limit
  expect(rows.map((r) => r.name)).toEqual(FUNCTIONS);
  for (const row of rows) {
    expect(row.settings, row.name).toEqual(expect.arrayContaining(['search_path=public', 'statement_timeout=25s']));
    expect(row.settings, row.name).toHaveLength(2);
    expect(row.definer, row.name).toBe(true);
  }
});

it('keeps the limit under what the server waits, so the database answers first', async () => {
  for (const row of await functions()) {
    const setting = row.settings!.find((s) => s.startsWith('statement_timeout='))!;
    const { rows: [{ ms }] } = await pool.query<{ ms: number }>(
      `SELECT (extract(epoch FROM $1::interval) * 1000)::int AS ms`, [setting.split('=')[1]]);
    expect(ms, row.name).toBeGreaterThan(8_000);
    expect(ms, row.name).toBeLessThan(APP_WAIT_MS);
  }
});

it('leaves every other function without a limit of its own', async () => {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT proname AS name FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'statement_timeout=%')
      ORDER BY proname`);
  expect(rows.map((r) => r.name)).toEqual(FUNCTIONS);
});

it('can run again: it changes no body and no setting', async () => {
  const before = await functions();
  await pool.query(MIGRATION);
  expect(await functions()).toEqual(before);
});
