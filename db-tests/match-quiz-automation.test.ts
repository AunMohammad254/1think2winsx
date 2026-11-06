/**
 * Migration 06-20261106120000: Auto / Manual quizzes. "LiveMatch".language, "aiLevel" and wordings, and
 * update_match_extras, which saves them without changing the match's version.
 */
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createPool, createUser, errorAs, player, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const ADMIN = 'admin@example.test';

beforeEach(async () => {
  await resetData(pool);
});

const asServer = async (sql: string, params: unknown[] = []) => (await queryAs(pool, serviceRole, sql, params))[0];
const match = async (id: string) =>
  (await pool.query(`SELECT language, "aiLevel", wordings, version FROM "LiveMatch" WHERE id = $1`, [id])).rows[0];
const extras = async (matchId: string, change: unknown) =>
  (await asServer(`SELECT update_match_extras($1, $2::jsonb) AS r`, [matchId, JSON.stringify(change)])).r;
const apply = async (matchId: string, change: object) =>
  (await asServer(`SELECT apply_match_change($1, $2, $3::jsonb) AS r`, [matchId, (await match(matchId)).version, JSON.stringify({ admin: ADMIN, ...change })])).r;

async function newMatch() {
  const { r } = await asServer(`SELECT create_live_match('Lahore Qalandars', 'Karachi Kings', 20, 2, $1) AS r`, [ADMIN]);
  return r as { matchId: string; quizId: string };
}

const draft = (id: string) => ({ id, innings: 1, over: 2, market: 'wicket_in_over', params: {}, text: 'Will a wicket fall in over 2?' });
const WORDED = { text: 'Lahore 9/0 after 1 overs: a wicket in over 2?', textRomanUrdu: 'Kya over 2 mein wicket giray ga?' };

it('starts a match in both languages, with Gemini on and nothing worded', async () => {
  const m = await newMatch();
  expect(await match(m.matchId)).toEqual({ language: 'both', aiLevel: 'full', wordings: {}, version: 0 });
});

it('saves the language and the AI level without changing the version, so a scorer is never refused for it', async () => {
  const m = await newMatch();
  expect(await extras(m.matchId, { language: 'ur' })).toEqual({ success: true });
  expect(await extras(m.matchId, { aiLevel: 'half' })).toEqual({ success: true });
  expect(await match(m.matchId)).toEqual({ language: 'ur', aiLevel: 'half', wordings: {}, version: 0 });
  // A change made against version 0 still goes through
  expect(await apply(m.matchId, { startInnings: { innings: 1, battingTeam: 'Lahore Qalandars' }, status: 'live' })).toMatchObject({ success: true });
  expect(await extras(m.matchId, { language: 'en', aiLevel: 'off' })).toEqual({ success: true });
  expect(await match(m.matchId)).toMatchObject({ language: 'en', aiLevel: 'off', version: 1 });
});

it('merges wordings, and keeps only those of drafts the match still has', async () => {
  const m = await newMatch();
  await apply(m.matchId, { drafts: [draft('d1'), draft('d2')] });
  expect(await extras(m.matchId, { wordings: { d1: WORDED, gone: WORDED } })).toEqual({ success: true });
  expect((await match(m.matchId)).wordings).toEqual({ d1: WORDED });
  expect(await extras(m.matchId, { wordings: { d2: { failed: true } } })).toEqual({ success: true });
  expect((await match(m.matchId)).wordings).toEqual({ d1: WORDED, d2: { failed: true } });

  // d1 was sent: it leaves the drafts, and its wording goes at the next save
  await apply(m.matchId, { drafts: [draft('d2')] });
  expect(await extras(m.matchId, { wordings: {} })).toEqual({ success: true });
  expect(await match(m.matchId)).toMatchObject({ wordings: { d2: { failed: true } }, version: 2 });
  // Without wordings in the change, they stay as they are
  expect(await extras(m.matchId, { language: 'ur' })).toEqual({ success: true });
  expect((await match(m.matchId)).wordings).toEqual({ d2: { failed: true } });
});

it('refuses a bad change, saving nothing', async () => {
  const m = await newMatch();
  expect(await extras(m.matchId, ['not', 'an object'])).toEqual({ success: false, code: 'invalid', error: 'A match change must be a JSON object' });
  expect(await extras(m.matchId, { language: 'fr', aiLevel: 'half' })).toEqual({ success: false, code: 'invalid', error: 'The language must be both, en or ur' });
  expect(await extras(m.matchId, { language: null })).toMatchObject({ success: false, code: 'invalid' });
  expect(await extras(m.matchId, { aiLevel: 'max' })).toEqual({ success: false, code: 'invalid', error: 'The AI level must be full, half or off' });
  expect(await extras(m.matchId, { wordings: ['x'] })).toEqual({ success: false, code: 'invalid', error: 'Wordings must be a JSON object' });
  expect(await match(m.matchId)).toEqual({ language: 'both', aiLevel: 'full', wordings: {}, version: 0 });
  expect(await extras('nope', { language: 'en' })).toEqual({ success: false, code: 'not_found', error: 'Match not found' });
});

it('keeps the columns valid, and the function for the server only', async () => {
  const m = await newMatch();
  await expect(pool.query(`UPDATE "LiveMatch" SET language = 'fr' WHERE id = $1`, [m.matchId])).rejects.toMatchObject({ code: '23514' });
  await expect(pool.query(`UPDATE "LiveMatch" SET "aiLevel" = 'max' WHERE id = $1`, [m.matchId])).rejects.toMatchObject({ code: '23514' });
  await expect(pool.query(`UPDATE "LiveMatch" SET wordings = '[]' WHERE id = $1`, [m.matchId])).rejects.toMatchObject({ code: '23514' });
  const user = await createUser(pool);
  expect((await errorAs(pool, player(user.id), `SELECT update_match_extras($1, '{}'::jsonb)`, [m.matchId])).code).toBe('42501');
  expect((await errorAs(pool, player(user.id), `SELECT wordings FROM "LiveMatch"`)).code).toBe('42501');
});
