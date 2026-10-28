// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));

const { normalizeTrackingId, trackingCheckChar, formatHandoverCode } = await import('@/lib/claim-tracking-shared');
const { handoverCode, checkHandoverCode, recordClaimOrigin, playerTimelines, adminTimeline, withClaimTracking } = await import('@/lib/claim-tracking');
const { claimDecisionNotification } = await import('@/lib/claim-notifications');

const VALID = '1T2W-7K3M-QX97';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

beforeEach(() => {
  adminDb = createSupabaseMock();
  vi.stubEnv('CLAIM_HANDOVER_SECRET', 'test-handover-secret');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('tracking IDs', () => {
  it('reads an ID however it was copied', () => {
    for (const typed of [VALID, '1t2w-7k3m-qx97', '1T2W 7K3M QX97', '7K3MQX97', '7k3m-qx97', '1T2W7K3MQX97']) {
      expect(normalizeTrackingId(typed), typed).toBe(VALID);
    }
    // O for 0, and I or L for 1
    const check = trackingCheckChar('10ABCD1');
    expect(normalizeTrackingId(`lOAB-CDi${check}`)).toBe(`1T2W-10AB-CD1${check}`);
  });

  it('catches every single mistyped character', () => {
    const body = VALID.replace(/^1T2W-/, '').replace('-', '');
    for (let i = 0; i < body.length; i++) {
      for (const c of ALPHABET) {
        if (c === body[i]) continue;
        const typo = body.slice(0, i) + c + body.slice(i + 1);
        expect(normalizeTrackingId(typo), typo).toBeNull();
      }
    }
  });

  it('refuses text of the wrong length or with letters outside the alphabet', () => {
    for (const typed of ['', '1T2W', '7K3MQX9', '7K3MQX977', '1T2W-7K3M-QX9U', 'hello world!']) {
      expect(normalizeTrackingId(typed), typed).toBeNull();
    }
    expect(trackingCheckChar('ABCU')).toBeNull();
  });
});

describe('handover codes', () => {
  it('are 6 digits, the same each time, and change with the claim, the version and the secret', () => {
    const code = handoverCode('pr_1', 1)!;
    expect(code).toMatch(/^\d{6}$/);
    expect(handoverCode('pr_1', 1)).toBe(code);
    expect(new Set([code, handoverCode('pr_1', 2), handoverCode('pr_2', 1)]).size).toBe(3);
    vi.stubEnv('CLAIM_HANDOVER_SECRET', 'another-secret');
    expect(handoverCode('pr_1', 1)).not.toBe(code);
    expect(formatHandoverCode('482913')).toBe('482 913');
  });

  it('come from the service key when there is no secret of their own, and not at all without either', () => {
    vi.stubEnv('CLAIM_HANDOVER_SECRET', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    const fromServiceKey = handoverCode('pr_1', 1);
    expect(fromServiceKey).toMatch(/^\d{6}$/);
    // Derived from the key, not the key itself used as the secret
    vi.stubEnv('CLAIM_HANDOVER_SECRET', 'service-key');
    expect(handoverCode('pr_1', 1)).not.toBe(fromServiceKey);
    vi.stubEnv('CLAIM_HANDOVER_SECRET', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(handoverCode('pr_1', 1)).toBeNull();
    expect(checkHandoverCode('pr_1', 1, '123456')).toBe(false);
  });

  it('are checked with or without the space, and only for the current version', () => {
    const code = handoverCode('pr_1', 2)!;
    expect(checkHandoverCode('pr_1', 2, code)).toBe(true);
    expect(checkHandoverCode('pr_1', 2, ` ${code.slice(0, 3)} ${code.slice(3)} `)).toBe(true);
    expect(checkHandoverCode('pr_1', 1, code)).toBe(false);
    expect(checkHandoverCode('pr_1', 2, code.slice(0, 5))).toBe(false);
    expect(checkHandoverCode('pr_1', 2, 'abcdef')).toBe(false);
  });
});

describe('recordClaimOrigin', () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it("records the claim's IP and browser", async () => {
    adminDb.setRpc('record_claim_origin', { data: true });
    await recordClaimOrigin('pr_1', 'u1', headers({ 'x-forwarded-for': '39.40.1.2', 'user-agent': 'Phone' }));
    expect(adminDb.rpcCalls).toEqual([{ fn: 'record_claim_origin', args: { p_claim_id: 'pr_1', p_user_id: 'u1', p_ip: '39.40.1.2', p_user_agent: 'Phone' } }]);
  });

  it('only logs a failure: the claim is already saved', async () => {
    adminDb.setRpc('record_claim_origin', { error: { message: 'down' } });
    await expect(recordClaimOrigin('pr_1', 'u1', headers({}))).resolves.toBeUndefined();
    expect(adminDb.rpcCalls[0].args).toMatchObject({ p_ip: 'unknown', p_user_agent: '' });
    expect(console.error).toHaveBeenCalledWith('[claims] Could not record where a claim came from:', { message: 'down' });
  });
});

describe('timelines', () => {
  const rows = [
    { claimId: 'a', event: 'submitted', note: null, createdAt: '2026-10-01' },
    { claimId: 'a', event: 'approved', note: 'Internal: checked CNIC', createdAt: '2026-10-02' },
    { claimId: 'b', event: 'rejected', note: 'Address incomplete', createdAt: '2026-10-03' },
    { claimId: 'b', event: 'something_new', note: null, createdAt: '2026-10-04' },
    { claimId: 'gone', event: 'submitted', note: null, createdAt: '2026-10-05' },
  ];

  it("gives each claim its winner's view: no notes except a rejection's, no unknown steps", async () => {
    adminDb.setTable('PrizeClaimEvent', { data: rows });
    const timelines = await playerTimelines(['a', 'b', 'c']);
    expect(Object.fromEntries(timelines)).toEqual({
      a: [{ event: 'submitted', at: '2026-10-01' }, { event: 'approved', at: '2026-10-02' }],
      b: [{ event: 'rejected', at: '2026-10-03', note: 'Address incomplete' }],
      c: [],
    });
  });

  it('asks nothing for no claims, and gives empty timelines when there are no rows or the read fails', async () => {
    expect((await playerTimelines([])).size).toBe(0);
    expect(adminDb.callsTo('PrizeClaimEvent')).toHaveLength(0);
    adminDb.setTable('PrizeClaimEvent', { data: null });
    expect(Object.fromEntries(await playerTimelines(['a']))).toEqual({ a: [] });
    adminDb.setTable('PrizeClaimEvent', { error: { message: 'missing table' } });
    expect(Object.fromEntries(await playerTimelines(['a']))).toEqual({ a: [] });
  });

  it('adds the code only to an approved claim', async () => {
    adminDb.setTable('PrizeClaimEvent', { data: [] });
    const tracked = await withClaimTracking([
      { id: 'a', status: 'approved', handoverVersion: 2 },
      { id: 'b', status: 'approved' },
      { id: 'c', status: 'fulfilled', handoverVersion: 1 },
    ]);
    expect(tracked.map((c) => c.handoverCode)).toEqual([handoverCode('a', 2), handoverCode('b', 1), null]);
    expect(tracked.every((c) => Array.isArray(c.timeline))).toBe(true);
  });

  it("gives admins the whole timeline, and fails loudly when it can't", async () => {
    adminDb.setTable('PrizeClaimEvent', { data: [{ id: 'e1', event: 'submitted', actor: 'player', note: null, details: { origin: { ip: '1.1.1.1' } }, createdAt: '2026-10-01' }] });
    expect(await adminTimeline('a')).toHaveLength(1);
    adminDb.setTable('PrizeClaimEvent', { data: null });
    expect(await adminTimeline('a')).toEqual([]);
    adminDb.setTable('PrizeClaimEvent', { error: { message: 'down' } });
    await expect(adminTimeline('a')).rejects.toEqual({ message: 'down' });
  });
});

describe('claim notifications', () => {
  it('quote the tracking ID, point to the code without giving it, and announce a new code', () => {
    const approved = claimDecisionNotification({ status: 'approved', prizeName: 'Watch', pointsUsed: 0, trackingId: VALID })!;
    expect(approved.message).toBe(`Your claim ${VALID} for Watch was approved. We'll contact you about delivery. Your handover code is on your profile: give it only to the person handing you the prize.`);
    expect(approved.message).not.toMatch(/\d{6}/);
    expect(claimDecisionNotification({ status: 'code_reset', prizeName: 'Watch', pointsUsed: 0, trackingId: VALID, note: 'ignored' })).toEqual({
      type: 'prize_claim',
      link: '/profile',
      title: '🔑 New handover code',
      message: `Your claim ${VALID} for Watch has a new handover code, on your profile. The old one no longer works.`,
    });
    expect(claimDecisionNotification({ status: 'fulfilled', prizeName: 'Watch', pointsUsed: 0 })!.message).toBe('Your claim for Watch is marked as delivered.');
  });
});
