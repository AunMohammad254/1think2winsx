/**
 * Migration 06-20261031120000: questions reviewed before players see them. "LiveMatch".drafts and
 * "autoSend", "Question"."textRomanUrdu", and apply_match_change's drafts, autoSend and Roman Urdu
 * release items.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createPool, errorAs, player, createUser, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = fs.readFileSync(path.join(__dirname, 'schema', '06-20261031120000_match_question_review.sql'), 'utf8');
const ADMIN = 'admin@example.test';

beforeEach(async () => {
  await resetData(pool);
});

const asServer = async (sql: string, params: unknown[] = []) => (await queryAs(pool, serviceRole, sql, params))[0];
const match = async (id: string) => (await pool.query(`SELECT drafts, "autoSend", version FROM "LiveMatch" WHERE id = $1`, [id])).rows[0];
const apply = async (matchId: string, change: object) =>
  (await asServer(`SELECT apply_match_change($1, $2, $3::jsonb) AS r`, [matchId, (await match(matchId)).version, JSON.stringify({ admin: ADMIN, ...change })])).r;

async function newMatch() {
  const { r } = await asServer(`SELECT create_live_match('Lahore Qalandars', 'Karachi Kings', 20, 2, $1) AS r`, [ADMIN]);
  return r as { matchId: string; quizId: string };
}

const DRAFT = { id: 'd1', innings: 1, over: 1, market: 'wicket_in_over', params: {}, text: 'Will a wicket fall in over 1?', closesAt: '2026-10-31T12:00:00Z' };

it('starts a match with no drafts, reviewing questions before they go out', async () => {
  const m = await newMatch();
  expect(await match(m.matchId)).toEqual({ drafts: [], autoSend: false, version: 0 });
});

it('stores the drafts and the switch as given, and leaves them alone otherwise', async () => {
  const m = await newMatch();
  expect(await apply(m.matchId, { startInnings: { innings: 1, battingTeam: 'Lahore Qalandars' }, drafts: [DRAFT], status: 'live' }))
    .toMatchObject({ success: true });
  expect(await match(m.matchId)).toEqual({ drafts: [DRAFT], autoSend: false, version: 1 });

  await apply(m.matchId, { autoSend: true });
  expect(await match(m.matchId)).toEqual({ drafts: [DRAFT], autoSend: true, version: 2 });
  await apply(m.matchId, { drafts: [], autoSend: false });
  expect(await match(m.matchId)).toEqual({ drafts: [], autoSend: false, version: 3 });
});

it('refuses drafts that are not a list, applying nothing', async () => {
  const m = await newMatch();
  expect(await apply(m.matchId, { drafts: { not: 'a list' }, autoSend: true })).toEqual({ success: false, code: 'invalid', error: "A match's drafts must be a JSON list" });
  expect(await match(m.matchId)).toEqual({ drafts: [], autoSend: false, version: 0 });
});

it('releases questions with their Roman Urdu wording, or none', async () => {
  const m = await newMatch();
  const release = (id: string, textRomanUrdu?: string) => ({
    id, text: 'Will a wicket fall in over 1?', textRomanUrdu, options: JSON.stringify(['Yes', 'No']), market: 'wicket_in_over',
    params: {}, innings: 1, over: 1, closesInSeconds: 120,
  });
  expect(await apply(m.matchId, {
    startInnings: { innings: 1, battingTeam: 'Lahore Qalandars' },
    release: [release('ur', 'Kya over 1 mein koi wicket giray ga?'), release('blank', '  '), release('none')],
  })).toMatchObject({ success: true });
  const { rows } = await pool.query(`SELECT id, "textRomanUrdu" FROM "Question" ORDER BY id`);
  expect(rows).toEqual([
    { id: 'blank', textRomanUrdu: null },
    { id: 'none', textRomanUrdu: null },
    { id: 'ur', textRomanUrdu: 'Kya over 1 mein koi wicket giray ga?' },
  ]);
  // Too long for a question
  expect(await apply(m.matchId, { release: [release('long', 'x'.repeat(301))] })).toMatchObject({ success: false, code: 'invalid' });
});

it('keeps drafts away from players like the rest of the match', async () => {
  await newMatch();
  const user = await createUser(pool);
  expect((await errorAs(pool, player(user.id), `SELECT drafts FROM "LiveMatch"`)).code).toBe('42501');
});

it('stops a second run of the migration', async () => {
  const guard = MIGRATION.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)![0];
  await expect(pool.query(guard)).rejects.toThrow(/apply_match_change is not the version this migration was written against/);
});
