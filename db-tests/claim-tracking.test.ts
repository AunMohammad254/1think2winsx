/**
 * Migration 06-20261028120000: tracking IDs on every claim, the claim timeline, risk flags, the
 * handover code's version and failed tries, decide_claim's rules, and lookup by tracking ID.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizeTrackingId, trackingCheckChar } from '../src/lib/claim-tracking-shared';
import {
  answersFor,
  createPool,
  createPrize,
  createQuestions,
  createQuiz,
  createUser,
  errorAs,
  player,
  queryAs,
  resetData,
  serviceRole,
  setWalletEnabled,
  submitQuiz,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const MIGRATION = fs.readFileSync(path.join(__dirname, 'schema', '06-20261028120000_claim_tracking.sql'), 'utf8');
const ADMIN = 'admin@example.test';

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
});

const asServer = async (sql: string, params: unknown[] = []) => (await queryAs(pool, serviceRole, sql, params))[0];

/** A player whose account is `ageDays` old (the risk flags count accounts under 7 days as new) */
async function oldUser(overrides: { email?: string; phone?: string; ageDays?: number } = {}) {
  const user = await createUser(pool, { email: overrides.email });
  await pool.query(`UPDATE "User" SET "createdAt" = now() - make_interval(days => $2), phone = $3 WHERE id = $1`, [
    user.id, overrides.ageDays ?? 60, overrides.phone ?? null,
  ]);
  return user;
}

/** A pending claim, inserted the way redeem_prize and claim_quiz_prize do (the triggers do the rest) */
async function makeClaim(userId: string, overrides: { phone?: string | null; address?: string | null; trackingId?: string } = {}) {
  const prizeId = await createPrize(pool);
  const id = `pr_${Math.random().toString(36).slice(2)}`;
  await pool.query(
    `INSERT INTO "PrizeRedemption" (id, "userId", "prizeId", "pointsUsed", status, "fullName", "whatsappNumber", address, "trackingId", "updatedAt")
     VALUES ($1, $2, $3, 100, 'pending', 'Ali Raza', $4, $5, $6, now())`,
    [id, userId, prizeId,
      overrides.phone === undefined ? '03001234567' : overrides.phone,
      overrides.address === undefined ? `House ${id}, Street 4, Lahore` : overrides.address,
      overrides.trackingId ?? null],
  );
  return id;
}

const claimRow = async (id: string) => (await pool.query(`SELECT * FROM "PrizeRedemption" WHERE id = $1`, [id])).rows[0];
const events = async (id: string) =>
  (await pool.query(`SELECT event, actor, note, details FROM "PrizeClaimEvent" WHERE "claimId" = $1 ORDER BY "createdAt", id`, [id])).rows;
const risk = async (id: string) => (await pool.query(`SELECT private_hardened.claim_risk($1) AS r`, [id])).rows[0].r;
const decide = async (id: string, status: string, details: object = {}, notes: string | null = null) =>
  (await asServer(`SELECT decide_claim($1, $2, $3, $4, $5::jsonb) AS r`, [id, status, notes, ADMIN, JSON.stringify(details)])).r;
const origin = async (id: string, userId: string, ip: string) =>
  (await asServer(`SELECT record_claim_origin($1, $2, $3, 'Mozilla/5.0 test') AS r`, [id, userId, ip])).r;

describe('tracking IDs', () => {
  it('gives every claim its own ID, which the app reads back as valid', async () => {
    const user = await oldUser();
    const ids = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const { trackingId } = await claimRow(await makeClaim(user.id));
      expect(trackingId).toMatch(/^1T2W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(normalizeTrackingId(trackingId)).toBe(trackingId);
      ids.add(trackingId);
    }
    expect(ids.size).toBe(40);
  });

  it('works out the same check character as the app', async () => {
    for (const body of ['0000000', 'ZZZZZZZ', '7K3MQX9', 'ABCDEFG', '1234567']) {
      const { rows: [row] } = await pool.query(`SELECT private_hardened.claim_tracking_check_char($1) AS c`, [body]);
      expect(row.c).toBe(trackingCheckChar(body));
    }
    const { rows: [bad] } = await pool.query(`SELECT private_hardened.claim_tracking_check_char('ABCDEFU') AS c`);
    expect(bad.c).toBeNull();
  });

  it('ignores an ID sent with the insert, and never lets one change', async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id, { trackingId: '1T2W-0000-0000' });
    const { trackingId } = await claimRow(id);
    expect(trackingId).not.toBe('1T2W-0000-0000');
    await expect(pool.query(`UPDATE "PrizeRedemption" SET "trackingId" = '1T2W-0000-0000' WHERE id = $1`, [id]))
      .rejects.toThrow(/tracking ID never changes/);
  });

  it('is given to claims made by claim_quiz_prize too', async () => {
    const prizeId = await createPrize(pool, { stock: 3 });
    const quizId = await createQuiz(pool);
    const [questionId] = await createQuestions(pool, quizId, 1);
    const user = await oldUser();
    await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers: answersFor([questionId]) });
    await asServer(`SELECT evaluate_question($1, 1)`, [questionId]);
    await asServer(`SELECT settle_quiz($1, $2::jsonb, 'random', 'seed-0123456789abcdef', $3)`, [quizId, JSON.stringify([{ rank: 1, prizeId }]), ADMIN]);
    const { rows: [win] } = await pool.query(`SELECT id FROM "QuizWinner" WHERE "quizId" = $1`, [quizId]);
    const { r } = await asServer(`SELECT claim_quiz_prize($1, $2, 'Ali Raza', '03001234567', 'House 12, Street 4, Lahore') AS r`, [win.id, user.id]);
    expect(normalizeTrackingId((await claimRow(r.claimId)).trackingId)).not.toBeNull();
    expect(await events(r.claimId)).toEqual([expect.objectContaining({ event: 'submitted', actor: 'player' })]);
  });
});

describe('the timeline', () => {
  it('records each status change with who made it and their note', async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id);
    expect((await decide(id, 'approved', {}, 'Calling you tomorrow')).success).toBe(true);
    expect((await decide(id, 'fulfilled', { handover: 'override', reason: 'Winner confirmed on a video call' })).success).toBe(true);
    // Sent again for delivery, through the admin's Reissue
    await asServer(`SELECT reissue_claim($1, 'redelivery', 'Courier lost it', $2)`, [id, ADMIN]);

    const timeline = await events(id);
    expect(timeline.map((e) => [e.event, e.actor])).toEqual([
      ['submitted', 'player'], ['approved', ADMIN], ['delivered', ADMIN], ['reopened', ADMIN],
    ]);
    expect(timeline[1].note).toBe('Calling you tomorrow');
    expect(timeline[1].details.risk).toMatchObject({ level: 'low' });
    expect(timeline[2].details).toMatchObject({ handover: 'override', reason: 'Winner confirmed on a video call' });
    expect(timeline[3].note).toBe('[REISSUED FOR REDELIVERY] Courier lost it');
  });

  it('keeps the decision details to the one status change', async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id);
    await decide(id, 'approved', { overrideReason: 'not needed here' });
    await asServer(`SELECT update_claim_status($1, 'fulfilled', NULL, $2)`, [id, ADMIN]);
    const timeline = await events(id);
    expect(timeline[2]).toMatchObject({ event: 'delivered', details: {} });
  });

  it('can only be read by the server', async () => {
    const user = await oldUser();
    await makeClaim(user.id);
    const error = await errorAs(pool, player(user.id), `SELECT * FROM "PrizeClaimEvent"`);
    expect(error.code).toBe('42501');
    expect((await queryAs(pool, serviceRole, `SELECT count(*)::int AS n FROM "PrizeClaimEvent"`))[0].n).toBe(1);
  });
});

describe('record_claim_origin', () => {
  it("stores the claim's IP and browser once, and only for the claim's own player", async () => {
    const user = await oldUser();
    const stranger = await oldUser();
    const id = await makeClaim(user.id);
    expect(await origin(id, stranger.id, '1.2.3.4')).toBe(false);
    expect(await origin(id, user.id, '5.6.7.8')).toBe(true);
    expect(await origin(id, user.id, '9.9.9.9')).toBe(false);
    expect((await events(id))[0].details).toEqual({ origin: { ip: '5.6.7.8', userAgent: 'Mozilla/5.0 test' } });
  });

  it("doesn't store an unknown IP", async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id);
    await origin(id, user.id, 'unknown');
    expect((await events(id))[0].details).toEqual({ origin: { userAgent: 'Mozilla/5.0 test' } });
  });
});

describe('claim_risk', () => {
  it('finds nothing on an ordinary claim', async () => {
    const user = await oldUser({ phone: '03001234567' });
    expect(await risk(await makeClaim(user.id))).toEqual({ score: 0, level: 'low', flags: [] });
    expect(await risk('nope')).toBeNull();
  });

  it("flags a WhatsApp number on another account's claim or profile, however it was typed", async () => {
    const first = await oldUser({ email: 'first@example.test' });
    await makeClaim(first.id, { phone: '+92 300 1234567' });
    await oldUser({ email: 'second@example.test', phone: '0300-1234567' });
    const me = await oldUser();
    const r = await risk(await makeClaim(me.id, { phone: '03001234567' }));
    expect(r.flags).toEqual([{ code: 'shared_phone', weight: 40, count: 2, accounts: ['first@example.test', 'second@example.test'] }]);
    expect(r.level).toBe('medium');
  });

  it('flags the same address without minding case, spaces or punctuation', async () => {
    const other = await oldUser({ email: 'other@example.test' });
    await makeClaim(other.id, { phone: '03111111111', address: 'House 12, St. 4, Gulberg, Lahore' });
    const me = await oldUser();
    const r = await risk(await makeClaim(me.id, { phone: '03222222222', address: 'house 12 st 4 gulberg lahore' }));
    expect(r.flags).toEqual([{ code: 'shared_address', weight: 30, count: 1, accounts: ['other@example.test'] }]);
  });

  it("flags a claim sent from another claimant's IP", async () => {
    const other = await oldUser({ email: 'other@example.test' });
    await origin(await makeClaim(other.id, { phone: '03111111111' }), other.id, '39.40.1.2');
    const me = await oldUser();
    const mine = await makeClaim(me.id, { phone: '03222222222' });
    await origin(mine, me.id, '39.40.1.2');
    expect((await risk(mine)).flags).toEqual([{ code: 'shared_ip', weight: 15, count: 1, accounts: ['other@example.test'] }]);
  });

  it('flags a new account, many claims and a number that is not the profile phone', async () => {
    const me = await oldUser({ ageDays: 2, phone: '03009999999' });
    for (let i = 0; i < 3; i++) await makeClaim(me.id, { phone: '03009999999' });
    const r = await risk(await makeClaim(me.id, { phone: '03001234567' }));
    expect(r.flags.map((f: { code: string }) => f.code)).toEqual(['new_account', 'many_claims', 'phone_not_on_profile']);
    expect(r).toMatchObject({ score: 30, level: 'medium' });
  });

  it('calls a shared number on a new account high risk', async () => {
    const other = await oldUser();
    await makeClaim(other.id, { phone: '03001234567' });
    const me = await oldUser({ ageDays: 1 });
    expect(await risk(await makeClaim(me.id, { phone: '03001234567' }))).toMatchObject({ score: 55, level: 'high' });
  });
});

describe('decide_claim', () => {
  async function highRiskClaim() {
    const other = await oldUser();
    await makeClaim(other.id, { phone: '03001234567', address: 'House 1, Street 1, Karachi' });
    const me = await oldUser();
    return makeClaim(me.id, { phone: '03001234567', address: 'House 1, Street 1, Karachi' });
  }

  it('wants a written reason to approve a high-risk claim, and keeps it with the risk', async () => {
    const id = await highRiskClaim();
    const refused = await decide(id, 'approved');
    expect(refused).toMatchObject({ success: false, code: 'risk_override_required', risk: { level: 'high', score: 70 } });
    expect(await decide(id, 'approved', { overrideReason: 'short' })).toMatchObject({ code: 'risk_override_required' });
    expect((await claimRow(id)).status).toBe('pending');

    expect(await decide(id, 'approved', { overrideReason: 'Brothers in one house, checked their CNICs' })).toMatchObject({ success: true, status: 'approved' });
    const approved = (await events(id))[1];
    expect(approved.details).toMatchObject({ overrideReason: 'Brothers in one house, checked their CNICs', risk: { level: 'high' } });
  });

  it('rejects a high-risk claim without a reason', async () => {
    const id = await highRiskClaim();
    expect(await decide(id, 'rejected')).toMatchObject({ success: true, status: 'rejected' });
  });

  it('marks a claim delivered only with the current handover code or a written reason', async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id);
    await decide(id, 'approved');
    expect(await decide(id, 'fulfilled')).toMatchObject({ success: false, code: 'handover_required' });
    expect(await decide(id, 'fulfilled', { handover: 'override', reason: 'too short' })).toMatchObject({ code: 'handover_required' });
    expect(await decide(id, 'fulfilled', { handover: 'code', handoverVersion: 2 })).toMatchObject({ code: 'code_changed' });
    expect(await decide(id, 'fulfilled', { handover: 'code', handoverVersion: 1 })).toMatchObject({ success: true, status: 'fulfilled' });
    expect((await events(id)).at(-1)).toMatchObject({ event: 'delivered', details: { handover: 'code', handoverVersion: 1 } });
  });

  it('refuses the code once five wrong ones were entered', async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id);
    await decide(id, 'approved');
    await pool.query(`UPDATE "PrizeRedemption" SET "handoverFailures" = 5 WHERE id = $1`, [id]);
    expect(await decide(id, 'fulfilled', { handover: 'code', handoverVersion: 1 })).toMatchObject({ code: 'code_locked' });
    expect(await decide(id, 'fulfilled', { handover: 'override', reason: 'Winner lost access, verified by call' })).toMatchObject({ success: true });
  });

  it("passes on update_claim_status's own refusals", async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id);
    expect(await decide(id, 'fulfilled', { handover: 'override', reason: 'Delivered by hand at the office' })).toMatchObject({ success: false, code: 'invalid_status' });
    expect(await decide('nope', 'approved')).toMatchObject({ success: false, code: 'not_found' });
    expect(await decide(id, 'approved', [] as unknown as object)).toMatchObject({ success: false, code: 'invalid' });
  });
});

describe('handover code state', () => {
  it('counts wrong codes on an approved claim, and locks at five', async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id);
    const fail = async () => (await asServer(`SELECT record_handover_failure($1, $2) AS r`, [id, ADMIN])).r;
    expect(await fail()).toMatchObject({ success: false, code: 'invalid_status' });
    await decide(id, 'approved');
    for (let i = 1; i <= 4; i++) expect(await fail()).toEqual({ success: true, failures: i, locked: false });
    expect(await fail()).toEqual({ success: true, failures: 5, locked: true });
    expect((await events(id)).filter((e) => e.event === 'handover_failed')).toHaveLength(5);
  });

  it('gives a new code on a reset, or when the claim is sent again for delivery', async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id);
    await decide(id, 'approved');
    await pool.query(`UPDATE "PrizeRedemption" SET "handoverFailures" = 3 WHERE id = $1`, [id]);
    expect((await asServer(`SELECT reset_handover_code($1, $2) AS r`, [id, ADMIN])).r).toEqual({ success: true, handoverVersion: 2 });
    expect(await claimRow(id)).toMatchObject({ handoverVersion: 2, handoverFailures: 0 });

    await decide(id, 'fulfilled', { handover: 'code', handoverVersion: 2 });
    expect((await asServer(`SELECT reset_handover_code($1, $2) AS r`, [id, ADMIN])).r).toMatchObject({ success: false, code: 'invalid_status' });
    await asServer(`SELECT reissue_claim($1, 'redelivery', 'Damaged', $2)`, [id, ADMIN]);
    expect(await claimRow(id)).toMatchObject({ status: 'pending', handoverVersion: 3, handoverFailures: 0 });
  });
});

describe('get_admin_claims', () => {
  it('shows the tracking ID, risk and handover state, and finds a claim by its tracking ID', async () => {
    const user = await oldUser({ email: 'me@example.test' });
    const pending = await makeClaim(user.id);
    const approved = await makeClaim(user.id, { phone: '03007654321' });
    await decide(approved, 'approved');
    const { trackingId } = await claimRow(approved);

    const { r: page } = await asServer(`SELECT get_admin_claims('pending', 1, 20) AS r`);
    expect(page.claims).toHaveLength(1);
    expect(page.claims[0]).toMatchObject({
      id: pending, trackingId: (await claimRow(pending)).trackingId,
      risk: { level: 'low' }, handover: { version: 1, failures: 0 },
    });

    // The tracking ID wins over the status filter
    const { r: found } = await asServer(`SELECT get_admin_claims('pending', 1, 20, $1) AS r`, [trackingId]);
    expect(found.claims.map((c: { id: string }) => c.id)).toEqual([approved]);
    expect(found.pagination.total).toBe(1);
    const { r: none } = await asServer(`SELECT get_admin_claims('all', 1, 20, '1T2W-0000-0000') AS r`);
    expect(none.claims).toEqual([]);
  });

  it('still answers the three-argument call the older code makes, and only for the server', async () => {
    const user = await oldUser();
    await makeClaim(user.id);
    const { r } = await asServer(`SELECT get_admin_claims(p_status => 'all', p_page => 1, p_limit => 20) AS r`);
    expect(r.claims).toHaveLength(1);
    const error = await errorAs(pool, player(user.id), `SELECT get_admin_claims('all', 1, 20)`);
    expect(error.code).toBe('42501');
  });
});

describe('privileges', () => {
  // The phone and address indexes call private_hardened functions on every write, as the writing role
  it('lets the server still write players and claims, which the risk indexes cover', async () => {
    const user = await oldUser();
    const prizeId = await createPrize(pool);
    await queryAs(pool, serviceRole, `UPDATE "User" SET phone = '0300-7654321' WHERE id = $1`, [user.id]);
    await queryAs(pool, serviceRole,
      `INSERT INTO "PrizeRedemption" (id, "userId", "prizeId", "pointsUsed", status, "whatsappNumber", address, "updatedAt")
       VALUES ('by-server', $1, $2, 0, 'pending', '03007654321', 'House 9, Street 9, Multan', now())`, [user.id, prizeId]);
    await queryAs(pool, serviceRole, `UPDATE "PrizeRedemption" SET address = 'House 10, Street 9, Multan' WHERE id = 'by-server'`);
    expect((await claimRow('by-server')).trackingId).toMatch(/^1T2W-/);
  });


  it('lets players read their own tracking ID, and call none of the new functions', async () => {
    const user = await oldUser();
    const id = await makeClaim(user.id);
    const [mine] = await queryAs(pool, player(user.id), `SELECT "trackingId" FROM "PrizeRedemption" WHERE id = $1`, [id]);
    expect(mine.trackingId).toMatch(/^1T2W-/);
    for (const sql of [
      `SELECT decide_claim('x', 'approved')`,
      `SELECT record_claim_origin('x', 'y', '1.1.1.1', 'ua')`,
      `SELECT record_handover_failure('x', 'a')`,
      `SELECT reset_handover_code('x', 'a')`,
      `SELECT private_hardened.claim_risk('x')`,
    ]) {
      expect((await errorAs(pool, player(user.id), sql)).code).toBe('42501');
    }
  });
});

it('pins the search_path of the pure helper functions (migration 06-20261028130000)', async () => {
  const { rows } = await pool.query(
    `SELECT proname, proconfig FROM pg_proc
      WHERE pronamespace = 'private_hardened'::regnamespace
        AND proname IN ('claim_tracking_check_char', 'normalize_pk_phone', 'claim_address_key')
      ORDER BY proname`,
  );
  expect(rows).toEqual([
    { proname: 'claim_address_key', proconfig: ['search_path=""'] },
    { proname: 'claim_tracking_check_char', proconfig: ['search_path=""'] },
    { proname: 'normalize_pk_phone', proconfig: ['search_path=""'] },
  ]);
  // Same results as before, built-ins found without a search_path
  const { rows: [r] } = await pool.query(
    `SELECT private_hardened.normalize_pk_phone('0300-1234567') AS phone, private_hardened.claim_address_key('House 12, St. 4') AS address,
            private_hardened.claim_tracking_check_char('7K3MQX9') AS check_char`,
  );
  expect(r).toEqual({ phone: '923001234567', address: 'house12st4', check_char: trackingCheckChar('7K3MQX9') });
});

it('stops a second run of the migration', async () => {
  const guard = MIGRATION.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)![0];
  await expect(pool.query(guard)).rejects.toThrow(/get_admin_claims\(text,integer,integer\) is not the version this migration was written against/);
});
