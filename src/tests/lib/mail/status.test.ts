// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, argOf, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => db.client }));
const status = await import('@/lib/mail/status');

const json = (body: unknown, statusCode = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: statusCode, headers: { 'content-type': 'application/json', ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
/** Answers Cost Explorer by its X-Amz-Target, everything else by URL. */
let ce: Record<string, () => Response>;
let other: (url: string) => Response;

beforeEach(() => {
  db = createSupabaseMock();
  status.clearStatusCaches();
  ce = {
    GetCostAndUsage: () => json({ ResultsByTime: [{ Total: { UnblendedCost: { Amount: '1.2345', Unit: 'USD' } }, Estimated: true }] }),
    GetCostForecast: () => json({ Total: { Amount: '3.50', Unit: 'USD' } }),
  };
  other = () => json({});
  fetchMock = vi.fn(async (input: Request | string) => {
    if (input instanceof Request && input.url.startsWith('https://ce.')) {
      return ce[input.headers.get('x-amz-target')!.split('.')[1]]();
    }
    return other(input instanceof Request ? input.url : input);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('AWS_SES_ACCESS_KEY_ID', 'AKID');
  vi.stubEnv('AWS_SES_SECRET_ACCESS_KEY', 'secret');
  vi.stubEnv('AWS_SES_REGION', '');
  vi.stubEnv('BREVO_API_KEY', 'brevo-key');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('getSesAccount', () => {
  it('reads the quota and account state from SES in Sydney, cached for 5 minutes', async () => {
    other = () => json({ SendQuota: { Max24HourSend: 200, MaxSendRate: 1, SentLast24Hours: 3 }, ProductionAccessEnabled: false, SendingEnabled: true, EnforcementStatus: 'HEALTHY' });
    const expected = { ok: true, data: { max24HourSend: 200, maxSendRate: 1, sentLast24Hours: 3, productionAccess: false, sendingEnabled: true, enforcementStatus: 'HEALTHY' } };
    expect(await status.getSesAccount(1_000)).toEqual(expected);
    expect((fetchMock.mock.calls[0][0] as Request).url).toBe('https://email.ap-southeast-2.amazonaws.com/v2/email/account');
    expect(await status.getSesAccount(1_000 + 4 * 60_000)).toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    other = () => json({});
    expect(await status.getSesAccount(1_000 + 5 * 60_000)).toEqual({
      ok: true, data: { max24HourSend: 0, maxSendRate: 0, sentLast24Hours: 0, productionAccess: false, sendingEnabled: true, enforcementStatus: null },
    });
  });

  it('reports AWS errors and an unreachable AWS, and is null without a key', async () => {
    other = () => json({ message: 'Not allowed' }, 403, { 'x-amzn-ErrorType': 'AccessDeniedException' });
    expect(await status.getSesAccount()).toEqual({ ok: false, error: 'AccessDeniedException: Not allowed' });
    status.clearStatusCaches();
    other = () => json({}, 500);
    expect(await status.getSesAccount()).toEqual({ ok: false, error: 'HTTP 500' });
    status.clearStatusCaches();
    fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    expect(await status.getSesAccount()).toEqual({ ok: false, error: 'AWS SES could not be reached: ENOTFOUND' });
    vi.stubEnv('AWS_SES_ACCESS_KEY_ID', '');
    expect(await status.getSesAccount()).toBeNull();
  });
});

describe('getBrevoPlans', () => {
  it("lists Brevo's plans and credits, cached for an hour", async () => {
    other = () => json({ email: 'owner@x.test', plan: [{ type: 'free', credits: 300, creditsType: 'sendLimit' }, { type: 'sms', endDate: '2026-12-01' }] });
    const expected = { ok: true, data: [
      { type: 'free', credits: 300, creditsType: 'sendLimit', endDate: null },
      { type: 'sms', credits: null, creditsType: null, endDate: '2026-12-01' },
    ] };
    expect(await status.getBrevoPlans(0)).toEqual(expected);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/account');
    expect(init.headers['api-key']).toBe('brevo-key');
    expect(await status.getBrevoPlans(59 * 60_000)).toEqual(expected);
    other = () => json({ plan: 'odd' });
    expect(await status.getBrevoPlans(60 * 60_000)).toEqual({ ok: true, data: [] });
    status.clearStatusCaches();
    other = () => json({ plan: [{}] });
    expect(await status.getBrevoPlans()).toEqual({ ok: true, data: [{ type: 'unknown', credits: null, creditsType: null, endDate: null }] });
  });

  it('reports Brevo errors, and is null without a key', async () => {
    other = () => json({ message: 'Key not found' }, 401);
    expect(await status.getBrevoPlans()).toEqual({ ok: false, error: 'Brevo answered 401: Key not found' });
    status.clearStatusCaches();
    other = () => new Response('oops', { status: 500 });
    expect(await status.getBrevoPlans()).toEqual({ ok: false, error: 'Brevo answered 500: no reason given' });
    status.clearStatusCaches();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await status.getBrevoPlans()).toEqual({ ok: false, error: 'Brevo could not be reached: timeout' });
    vi.stubEnv('BREVO_API_KEY', '');
    expect(await status.getBrevoPlans()).toBeNull();
  });
});

describe('costPeriod', () => {
  it('gives the month start, today and next month in UTC', () => {
    expect(status.costPeriod(new Date('2026-10-22T20:00:00Z'))).toEqual({ monthStart: '2026-10-01', today: '2026-10-22', nextMonth: '2026-11-01' });
    expect(status.costPeriod(new Date('2026-12-31T23:59:00Z'))).toEqual({ monthStart: '2026-12-01', today: '2026-12-31', nextMonth: '2027-01-01' });
  });
});

describe('getAwsCost', () => {
  const now = new Date('2026-10-22T10:00:00Z');
  const cached = (fetchedAt: string, extra: Record<string, unknown> = {}) =>
    db.setTable('AppSettings', (call) => (call.ops.some((o) => o.op === 'select')
      ? { data: { value: JSON.stringify({ monthToDate: { amount: 1, unit: 'USD', estimated: true }, forecastRest: null, fetchedAt, ...extra }) } }
      : { data: null }));
  const targets = () => fetchMock.mock.calls.map(([r]) => (r as Request).headers.get('x-amz-target'));

  it('looks up the month so far and the forecast, then saves them for a day', async () => {
    const view = await status.getAwsCost({ now });
    expect(view).toEqual({
      configured: true,
      error: null,
      cost: { monthToDate: { amount: 1.2345, unit: 'USD', estimated: true }, forecastRest: { amount: 3.5, unit: 'USD' }, fetchedAt: now.toISOString() },
      refreshAvailableAt: '2026-10-22T11:00:00.000Z',
    });
    expect(targets()).toEqual(['AWSInsightsIndexService.GetCostAndUsage', 'AWSInsightsIndexService.GetCostForecast']);
    const usage = JSON.parse(await (fetchMock.mock.calls[0][0] as Request).clone().text());
    expect(usage).toEqual({ TimePeriod: { Start: '2026-10-01', End: '2026-10-22' }, Granularity: 'MONTHLY', Metrics: ['UnblendedCost'] });
    const forecast = JSON.parse(await (fetchMock.mock.calls[1][0] as Request).clone().text());
    expect(forecast).toEqual({ TimePeriod: { Start: '2026-10-22', End: '2026-11-01' }, Metric: 'UNBLENDED_COST', Granularity: 'MONTHLY' });
    const saved = argOf(db.callsTo('AppSettings', 'upsert')[0], 'upsert') as { key: string; value: string };
    expect(saved.key).toBe('aws_cost_cache');
    expect(JSON.parse(saved.value).fetchedAt).toBe(now.toISOString());
  });

  it('uses the saved result for a day, and a refresh only after an hour', async () => {
    cached('2026-10-22T09:30:00Z');
    expect(await status.getAwsCost({ now })).toMatchObject({ cost: { fetchedAt: '2026-10-22T09:30:00Z' }, refreshAvailableAt: '2026-10-22T10:30:00.000Z' });
    expect(await status.getAwsCost({ now, refresh: true })).toMatchObject({ cost: { fetchedAt: '2026-10-22T09:30:00Z' } });
    expect(fetchMock).not.toHaveBeenCalled();

    cached('2026-10-22T05:00:00Z');
    expect(await status.getAwsCost({ now })).toMatchObject({ cost: { fetchedAt: '2026-10-22T05:00:00Z' }, refreshAvailableAt: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await status.getAwsCost({ now, refresh: true })).cost!.fetchedAt).toBe(now.toISOString());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('looks up again once the saved result is a day old, or unreadable', async () => {
    cached('2026-10-21T09:00:00Z');
    await status.getAwsCost({ now });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    db.setTable('AppSettings', { data: { value: 'not json' } });
    await status.getAwsCost({ now });
    db.setTable('AppSettings', { data: { value: '{"no":"date"}' } });
    await status.getAwsCost({ now });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('counts nothing on the 1st, and shows no forecast before AWS has one', async () => {
    ce.GetCostForecast = () => json({ message: 'Insufficient amount of historical data' }, 400, { 'x-amzn-ErrorType': 'DataUnavailableException' });
    const view = await status.getAwsCost({ now: new Date('2026-11-01T03:00:00Z') });
    expect(view.cost).toEqual({ monthToDate: { amount: 0, unit: 'USD', estimated: true }, forecastRest: null, fetchedAt: '2026-11-01T03:00:00.000Z' });
    expect(targets()).toEqual(['AWSInsightsIndexService.GetCostForecast']);
  });

  it('reads empty answers as zero', async () => {
    ce.GetCostAndUsage = () => json({ ResultsByTime: [{ Estimated: false }] });
    ce.GetCostForecast = () => json({});
    expect((await status.getAwsCost({ now })).cost).toMatchObject({ monthToDate: { amount: 0, unit: 'USD', estimated: false }, forecastRest: { amount: 0, unit: 'USD' } });
    status.clearStatusCaches();
    ce.GetCostAndUsage = () => json({});
    expect((await status.getAwsCost({ now })).cost!.monthToDate).toEqual({ amount: 0, unit: 'USD', estimated: true });
  });

  it("reports an error, and doesn't pay to repeat it for an hour unless asked", async () => {
    ce.GetCostAndUsage = () => json({ message: 'User is not authorized' }, 400, { 'x-amzn-ErrorType': 'AccessDeniedException' });
    const failed = await status.getAwsCost({ now });
    expect(failed).toEqual({ configured: true, cost: null, error: 'AWS billing could not be read: AccessDeniedException: User is not authorized', refreshAvailableAt: null });
    expect(await status.getAwsCost({ now: new Date(now.getTime() + 30 * 60_000) })).toEqual({ ...failed, cost: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await status.getAwsCost({ now, refresh: true });
    await status.getAwsCost({ now: new Date(now.getTime() + 61 * 60_000) });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    ce.GetCostAndUsage = () => json({ ResultsByTime: [] });
    ce.GetCostForecast = () => json({ message: 'bad' }, 400, { 'x-amzn-ErrorType': 'ValidationException' });
    status.clearStatusCaches();
    expect((await status.getAwsCost({ now })).error).toBe('AWS billing could not be read: ValidationException: bad');
    status.clearStatusCaches();
    ce.GetCostForecast = () => json({}, 500);
    expect((await status.getAwsCost({ now })).error).toBe('AWS billing could not be read: HTTP 500');
  });

  it('reports a cache that cannot be read or saved, and a network failure', async () => {
    db.setTable('AppSettings', { error: { message: 'db down' } });
    expect((await status.getAwsCost({ now })).error).toBe('AWS billing could not be read: db down');
    status.clearStatusCaches();
    db.setTable('AppSettings', (call) => (call.ops.some((o) => o.op === 'upsert') ? { error: { message: 'read only' } } : { data: null }));
    expect((await status.getAwsCost({ now })).error).toBe('AWS billing could not be read: read only');
    status.clearStatusCaches();
    db.setTable('AppSettings', { data: null });
    fetchMock.mockRejectedValueOnce('socket closed');
    expect((await status.getAwsCost({ now })).error).toBe('AWS billing could not be read: socket closed');
  });

  it('is not configured without an access key', async () => {
    vi.stubEnv('AWS_SES_SECRET_ACCESS_KEY', '');
    expect(await status.getAwsCost()).toEqual({ configured: false, cost: null, error: null, refreshAvailableAt: null });
  });
});
