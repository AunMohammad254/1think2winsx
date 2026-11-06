/**
 * Migration 06-20261106150000: every scoring action of the Laws. "BallEvent".extra's new kinds (no-ball byes and
 * leg byes, penalty runs, a dismissal with no delivery), "wicketKind" and boundary, and apply_match_change saving
 * them on a new ball and a corrected one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createPool, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = fs.readFileSync(path.join(__dirname, 'schema', '06-20261106150000_match_scoring_actions.sql'), 'utf8');
const ADMIN = 'admin@example.test';

beforeEach(async () => {
  await resetData(pool);
});

const asServer = async (sql: string, params: unknown[] = []) => (await queryAs(pool, serviceRole, sql, params))[0];
const version = async (id: string) => (await pool.query(`SELECT version FROM "LiveMatch" WHERE id = $1`, [id])).rows[0].version as number;
const apply = async (matchId: string, change: object) =>
  (await asServer(`SELECT apply_match_change($1, $2, $3::jsonb) AS r`, [matchId, await version(matchId), JSON.stringify({ admin: ADMIN, ...change })])).r;
const balls = async (matchId: string) => (await pool.query(
  `SELECT id, seq, runs, extra, "extraRuns", wicket, "wicketKind", boundary, "undoneAt" IS NOT NULL AS undone FROM "BallEvent" WHERE "matchId" = $1 ORDER BY seq, "createdAt"`,
  [matchId],
)).rows;

async function liveMatch() {
  const { r } = await asServer(`SELECT create_live_match('Lahore Qalandars', 'Karachi Kings', 20, 2, $1) AS r`, [ADMIN]);
  const { matchId } = r as { matchId: string };
  expect(await apply(matchId, { startInnings: { innings: 1, battingTeam: 'Lahore Qalandars' }, status: 'live' })).toMatchObject({ success: true });
  return matchId;
}

const ball = (seq: number, over: Record<string, unknown>) =>
  ({ id: `b${seq}`, innings: 1, seq, runs: 0, extra: 'none', extraRuns: 0, wicket: false, ...over });

it('saves every kind of entry, with how the batter was out and whether it was a boundary', async () => {
  const m = await liveMatch();
  const entries = [
    ball(1, { runs: 4, boundary: true }),
    ball(2, { runs: 4, boundary: false }),
    ball(3, { runs: 2, extra: 'no_ball_bye', extraRuns: 1 }),
    ball(4, { runs: 1, extra: 'no_ball_leg_bye', extraRuns: 1 }),
    ball(5, { extra: 'penalty', extraRuns: 5 }),
    ball(6, { wicket: true, wicketKind: 'caught' }),
    ball(7, { runs: 1, wicket: true, wicketKind: 'run_out' }),
    ball(8, { extra: 'no_delivery', wicket: true, wicketKind: 'retired_out' }),
    ball(9, { extra: 'wide', extraRuns: 1, wicket: true, wicketKind: 'stumped' }),
  ];
  for (const entry of entries) expect(await apply(m, { ball: entry })).toMatchObject({ success: true });
  expect((await balls(m)).map((b) => [b.seq, b.extra, b.runs, b.extraRuns, b.wicket, b.wicketKind, b.boundary])).toEqual([
    [1, 'none', 4, 0, false, null, true],
    [2, 'none', 4, 0, false, null, false],
    [3, 'no_ball_bye', 2, 1, false, null, null],
    [4, 'no_ball_leg_bye', 1, 1, false, null, null],
    [5, 'penalty', 0, 5, false, null, null],
    [6, 'none', 0, 0, true, 'caught', null],
    [7, 'none', 1, 0, true, 'run_out', null],
    [8, 'no_delivery', 0, 0, true, 'retired_out', null],
    [9, 'wide', 0, 1, true, 'stumped', null],
  ]);
});

it('keeps the shape it took before: no kind, no boundary', async () => {
  const m = await liveMatch();
  expect(await apply(m, { ball: { id: 'old', innings: 1, seq: 1, runs: 6, extra: 'none', extraRuns: 0, wicket: true } })).toMatchObject({ success: true });
  expect((await balls(m))[0]).toMatchObject({ wicket: true, wicketKind: null, boundary: null });
});

it('saves the kind and boundary of a corrected ball', async () => {
  const m = await liveMatch();
  await apply(m, { ball: ball(1, { runs: 4, boundary: true }) });
  expect(await apply(m, { replaceBall: { ...ball(1, { id: 'b1x', runs: 0, wicket: true, wicketKind: 'bowled' }), replaces: 'b1' } })).toMatchObject({ success: true });
  expect((await balls(m)).map((b) => [b.id, b.undone, b.wicketKind, b.boundary])).toEqual([['b1', true, null, true], ['b1x', false, 'bowled', null]]);
});

it('refuses what no scorecard can hold, applying nothing', async () => {
  const m = await liveMatch();
  for (const bad of [
    ball(1, { extra: 'free_hit' }),
    ball(1, { wicketKind: 'handled_ball', wicket: true }),
    // A dismissal is a wicket, a boundary a four or a six
    ball(1, { wicketKind: 'caught' }),
    ball(1, { runs: 3, boundary: true }),
  ]) {
    expect(await apply(m, { ball: bad, closeAll: true })).toMatchObject({ success: false, code: 'invalid' });
  }
  expect(await balls(m)).toEqual([]);
  expect(await version(m)).toBe(1);
});

it('stops a second run of the migration', async () => {
  const guard = MIGRATION.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)![0];
  await expect(pool.query(guard)).rejects.toThrow(/apply_match_change is not the version this migration was written against/);
});
