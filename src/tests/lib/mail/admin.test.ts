// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
const h = vi.hoisted(() => ({
  selectedProvider: vi.fn(),
  activeProvider: vi.fn(),
  invalidateProviderCache: vi.fn(),
  getEmailQuotaStatus: vi.fn(),
  getSesAccount: vi.fn(),
  getBrevoPlans: vi.fn(),
  getAwsCost: vi.fn(),
}));
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => db.client }));
vi.mock('@/lib/mail/mailer', () => ({ selectedProvider: h.selectedProvider, activeProvider: h.activeProvider, invalidateProviderCache: h.invalidateProviderCache }));
vi.mock('@/lib/email-quota', () => ({ getEmailQuotaStatus: h.getEmailQuotaStatus }));
vi.mock('@/lib/mail/status', () => ({ getSesAccount: h.getSesAccount, getBrevoPlans: h.getBrevoPlans, getAwsCost: h.getAwsCost }));

const admin = await import('@/lib/mail/admin');

const quota = { used: 5, limit: 299, reserve: 20, cap: 279, remaining: 294, capRemaining: 274, nextFreeAt: null };
const awsCost = { configured: true, cost: null, error: null, refreshAvailableAt: null };

beforeEach(() => {
  db = createSupabaseMock({ rpc: { email_log_totals: { data: [{ provider: 'ses', period: '24h', status: 'accepted', count: 3 }] } } });
  db.setTable('AppSettings', { data: [{ key: 'email_daily_limit', value: '299' }, { key: 'email_daily_limit_ses', value: ' 45000 ' }, { key: 'email_essential_reserve', value: 'twenty' }] });
  db.setTable('EmailLog', { data: [{ error: 'AWS paused sending', sentAt: '2026-10-22T09:50:00Z' }], count: 4 });
  h.selectedProvider.mockResolvedValue('ses');
  h.activeProvider.mockResolvedValue('ses');
  h.getEmailQuotaStatus.mockResolvedValue(quota);
  h.getSesAccount.mockResolvedValue(null);
  h.getBrevoPlans.mockResolvedValue({ ok: true, data: [] });
  h.getAwsCost.mockResolvedValue(awsCost);
  h.invalidateProviderCache.mockReset();
  vi.stubEnv('AWS_SES_ACCESS_KEY_ID', 'AKID');
  vi.stubEnv('AWS_SES_SECRET_ACCESS_KEY', 'secret');
  vi.stubEnv('AWS_SES_REGION', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('getEmailServicesOverview', () => {
  it('gathers the service, limits, counts, recent failures and billing', async () => {
    const now = new Date('2026-10-22T10:00:00Z');
    expect(await admin.getEmailServicesOverview(now)).toEqual({
      logReady: true,
      selected: 'ses',
      active: 'ses',
      sesConfigured: true,
      sesRegion: 'ap-southeast-2',
      limits: { brevo: 299, ses: 45000, reserve: 20 },
      quota,
      totals: [{ provider: 'ses', period: '24h', status: 'accepted', count: 3 }],
      recentFailures: { count: 4, lastError: 'AWS paused sending', lastAt: '2026-10-22T09:50:00Z' },
      ses: null,
      brevo: { ok: true, data: [] },
      awsCost,
    });
    const failures = db.callsTo('EmailLog', 'select')[0];
    expect(eqValue(failures, 'provider')).toBe('ses');
    expect(eqValue(failures, 'status')).toBe('failed');
    expect(failures.ops.find((o) => o.op === 'gte')!.args).toEqual(['sentAt', '2026-10-22T09:00:00.000Z']);
    expect(h.getAwsCost).toHaveBeenCalledWith({ now });
  });

  it('uses defaults for missing settings and copes with an empty log and no quota', async () => {
    db.setTable('AppSettings', { data: null });
    db.setTable('EmailLog', { data: null, count: null });
    db.setRpc('email_log_totals', { data: null });
    h.getEmailQuotaStatus.mockRejectedValue(new Error('no function'));
    const overview = await admin.getEmailServicesOverview();
    expect(overview).toMatchObject({ limits: { brevo: 299, ses: 199, reserve: 20 }, quota: null, totals: [], recentFailures: { count: 0, lastError: null, lastAt: null } });
  });

  it('works without the log before its database change is applied', async () => {
    db.setRpc('email_log_totals', { error: { code: 'PGRST202', message: 'Could not find the function' } });
    db.setTable('EmailLog', { error: { code: 'PGRST205', message: 'Could not find the table' } });
    expect(await admin.getEmailServicesOverview()).toMatchObject({
      logReady: false, selected: 'ses', limits: { ses: 45000 }, totals: [], recentFailures: { count: 0, lastError: null, lastAt: null },
    });
    // either half missing is enough
    db.setRpc('email_log_totals', { data: [] });
    db.setTable('EmailLog', { error: { code: '42P01', message: 'relation does not exist' } });
    expect((await admin.getEmailServicesOverview()).logReady).toBe(false);
    db.setTable('EmailLog', { data: [], count: 0 });
    db.setRpc('email_log_totals', { error: { code: '42883', message: 'function does not exist' } });
    expect((await admin.getEmailServicesOverview()).logReady).toBe(false);
  });

  it('fails when the settings, counts or log cannot be read', async () => {
    db.setTable('AppSettings', { error: { message: 'down' } });
    await expect(admin.getEmailServicesOverview()).rejects.toEqual({ message: 'down' });
    db.setTable('AppSettings', { data: [] });
    db.setRpc('email_log_totals', { error: { message: 'no rpc' } });
    await expect(admin.getEmailServicesOverview()).rejects.toEqual({ message: 'no rpc' });
    db.setRpc('email_log_totals', { data: [] });
    db.setTable('EmailLog', { error: { message: 'no table' } });
    await expect(admin.getEmailServicesOverview()).rejects.toEqual({ message: 'no table' });
  });
});

describe('updateEmailServices', () => {
  it('saves the service and the SES limit with who changed them, and applies the switch at once', async () => {
    await admin.updateEmailServices({ provider: 'ses', sesDailyLimit: 45000 }, 'boss@example.test');
    const rows = argOf(db.callsTo('AppSettings', 'upsert')[0], 'upsert') as Record<string, string>[];
    expect(rows.map(({ key, value, updatedBy }) => ({ key, value, updatedBy }))).toEqual([
      { key: 'email_provider', value: 'ses', updatedBy: 'boss@example.test' },
      { key: 'email_daily_limit_ses', value: '45000', updatedBy: 'boss@example.test' },
    ]);
    expect(Date.parse(rows[0].updatedAt)).toBeGreaterThan(0);
    expect(h.invalidateProviderCache).toHaveBeenCalled();
  });

  it('refuses SES without an access key, and does nothing with nothing to change', async () => {
    vi.stubEnv('AWS_SES_ACCESS_KEY_ID', '');
    await expect(admin.updateEmailServices({ provider: 'ses' }, 'a@b.co')).rejects.toBeInstanceOf(admin.EmailServicesError);
    await admin.updateEmailServices({ provider: 'brevo' }, 'a@b.co');
    await admin.updateEmailServices({}, 'a@b.co');
    expect(db.callsTo('AppSettings', 'upsert')).toHaveLength(1);
  });

  it('reports a save that fails', async () => {
    db.setTable('AppSettings', { error: { message: 'read only' } });
    await expect(admin.updateEmailServices({ sesDailyLimit: 5 }, 'a@b.co')).rejects.toEqual({ message: 'read only' });
    expect(h.invalidateProviderCache).not.toHaveBeenCalled();
  });
});

describe('listEmailLog', () => {
  it('pages newest first, with filters and a cleaned-up search', async () => {
    db.setTable('EmailLog', { data: [{ id: 1 }], count: 51 });
    expect(await admin.listEmailLog({ page: 2, q: ' fan,(x)*%\\ ', provider: 'ses', status: 'bounced', kind: 'newsletter' })).toEqual({ entries: [{ id: 1 }], total: 51, ready: true });
    const call = db.callsTo('EmailLog', 'select')[0];
    expect(call.ops.find((o) => o.op === 'range')!.args).toEqual([50, 99]);
    expect(call.ops.find((o) => o.op === 'order')!.args).toEqual(['sentAt', { ascending: false }]);
    expect([eqValue(call, 'provider'), eqValue(call, 'status'), eqValue(call, 'kind')]).toEqual(['ses', 'bounced', 'newsletter']);
    expect(argOf(call, 'or')).toBe('recipient.ilike.*fan  x*,subject.ilike.*fan  x*');
  });

  it('lists everything without filters, and skips a search that is only symbols', async () => {
    db.setTable('EmailLog', { data: null, count: null });
    expect(await admin.listEmailLog({ page: 1, q: '(),' })).toEqual({ entries: [], total: 0, ready: true });
    const call = db.callsTo('EmailLog', 'select')[0];
    expect(call.ops.map((o) => o.op)).toEqual(['select', 'order', 'range']);
  });

  it('reports a log that cannot be read, and is empty before its database change', async () => {
    db.setTable('EmailLog', { error: { message: 'down' } });
    await expect(admin.listEmailLog({ page: 1 })).rejects.toEqual({ message: 'down' });
    db.setTable('EmailLog', { error: { code: 'PGRST205', message: 'Could not find the table' } });
    expect(await admin.listEmailLog({ page: 1 })).toEqual({ entries: [], total: 0, ready: false });
  });

  it('cleans searches to 100 characters', () => {
    expect(admin.cleanSearch('a'.repeat(150))).toHaveLength(100);
  });
});
