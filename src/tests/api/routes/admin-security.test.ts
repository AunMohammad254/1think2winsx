// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const auth = vi.fn();
const validateAdminSession = vi.fn();
const applyRateLimit = vi.fn();
const logSecurityEvent = vi.fn();
const getFraudAlerts = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));
vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: (...a: unknown[]) => validateAdminSession(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { admin: { maxRequests: 100, windowMs: 60_000 } }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: { logSecurityEvent: (...a: unknown[]) => logSecurityEvent(...a) } }));
vi.mock('@/actions/security-actions', () => ({ getFraudAlerts: (...a: unknown[]) => getFraudAlerts(...a) }));

const stats = await import('@/app/api/admin/security/stats/route');
const events = await import('@/app/api/admin/security/events/route');
const fraud = await import('@/app/api/admin/security/fraud-alerts/route');

beforeEach(() => {
  adminDb = createSupabaseMock();
  for (const fn of [auth, validateAdminSession, applyRateLimit, logSecurityEvent, getFraudAlerts]) fn.mockReset();
  applyRateLimit.mockResolvedValue(null);
  auth.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  validateAdminSession.mockResolvedValue({ valid: false });
  getFraudAlerts.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const routes = [
  ['stats', (qs = '') => stats.GET(makeRequest(`/api/admin/security/stats${qs}`)), '/api/admin/security/stats'],
  ['events', (qs = '') => events.GET(makeRequest(`/api/admin/security/events${qs}`)), '/api/admin/security/events'],
  ['fraud-alerts', (qs = '') => fraud.GET(makeRequest(`/api/admin/security/fraud-alerts${qs}`)), '/api/admin/security/fraud-alerts'],
] as const;

describe.each(routes)('GET %s: shared guards', (_name, get, endpoint) => {
  it('lets in a Supabase admin or an admin-panel session', async () => {
    expect((await get()).status).toBe(200);
    auth.mockResolvedValue(null);
    validateAdminSession.mockResolvedValue({ valid: true });
    expect((await get()).status).toBe(200);
  });

  it('refuses everyone else and logs who tried', async () => {
    auth.mockResolvedValue({ user: { id: 'player-9', isAdmin: false } });
    expect((await get()).status).toBe(401);
    expect(logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'UNAUTHORIZED_ACCESS', userId: 'player-9', endpoint, details: expect.objectContaining({ userRole: 'user' }) }));
    auth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'anonymous' }));
  });

  it('returns the rate-limit response and logs it', async () => {
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await get()).status).toBe(429);
    expect(logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'RATE_LIMIT_EXCEEDED', details: { rateLimiter: 'admin', limit: 100, window: 60_000 } }));
  });

  it('answers 500 and logs the error, with its stack when there is one', async () => {
    auth.mockRejectedValueOnce(new Error('auth down'));
    expect((await get()).status).toBe(500);
    expect(logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'SUSPICIOUS_ACTIVITY', details: expect.objectContaining({ error: 'auth down', stack: expect.any(String) }) }));
    auth.mockRejectedValueOnce('odd');
    await get();
    expect(logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ details: { error: 'Unknown error' } }));
    const stackless = new Error('no stack');
    stackless.stack = undefined;
    auth.mockRejectedValueOnce(stackless);
    await get();
    expect(logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ details: { error: 'no stack' } }));
  });
});

describe('GET /api/admin/security/stats', () => {
  it('summarises events by type, severity and endpoint', async () => {
    adminDb.setTable('SecurityEvent', {
      data: [
        { type: 'RATE_LIMIT_EXCEEDED', severity: 'MEDIUM', endpoint: '/a' },
        { type: 'RATE_LIMIT_EXCEEDED', severity: 'MEDIUM', endpoint: '/a' },
        { type: 'AUTHENTICATION_FAILURE', severity: 'HIGH', endpoint: '/b' },
        { type: 'SUSPICIOUS_ACTIVITY' },
      ],
    });
    const body = await (await stats.GET(makeRequest('/api/admin/security/stats?timeframe=7d'))).json();
    expect(body).toMatchObject({
      totalEvents: 4,
      eventsByType: { RATE_LIMIT_EXCEEDED: 2, AUTHENTICATION_FAILURE: 1, SUSPICIOUS_ACTIVITY: 1 },
      eventsBySeverity: { MEDIUM: 2, HIGH: 1 },
      topEndpoints: [{ endpoint: '/a', count: 2 }, { endpoint: '/b', count: 1 }],
      rateLimitViolations: 2,
      authenticationFailures: 1,
      suspiciousActivities: 1,
      timeframe: '7d',
    });
    expect(body.recentEvents).toHaveLength(4);
  });

  it.each([['1h', 1], ['24h', 24], ['7d', 168], ['30d', 720], ['bogus', 24]])('looks back the right window for %s', async (timeframe, hours) => {
    adminDb.setTable('SecurityEvent', { data: null });
    await stats.GET(makeRequest(`/api/admin/security/stats?timeframe=${timeframe}`));
    const since = adminDb.callsTo('SecurityEvent')[0].ops.find((o) => o.op === 'gte')!.args[1] as string;
    expect((Date.now() - new Date(since).getTime()) / 3_600_000).toBeCloseTo(hours, 1);
  });

  it('answers 500 when the query fails', async () => {
    adminDb.setTable('SecurityEvent', { error: new Error('db') });
    expect((await stats.GET(makeRequest('/api/admin/security/stats'))).status).toBe(500);
  });
});

describe('GET /api/admin/security/events', () => {
  it('pages through events with an optional severity filter', async () => {
    adminDb.setTable('SecurityEvent', { data: [{ id: 'e1' }], count: 120 });
    const body = await (await events.GET(makeRequest('/api/admin/security/events?severity=HIGH&limit=20&offset=40&timeframe=1h'))).json();
    expect(body).toMatchObject({ events: [{ id: 'e1' }], pagination: { total: 120, limit: 20, offset: 40, hasMore: true }, filters: { timeframe: '1h', severity: 'HIGH' } });
    const q = adminDb.callsTo('SecurityEvent')[0];
    expect(q.ops.find((o) => o.op === 'range')?.args).toEqual([40, 59]);
    expect(eqValue(q, 'severity')).toBe('HIGH');
  });

  it.each(['24h', '7d', '30d', 'bogus'])('accepts timeframe %s and defaults to every severity', async (timeframe) => {
    adminDb.setTable('SecurityEvent', { data: null, count: null });
    const body = await (await events.GET(makeRequest(`/api/admin/security/events?timeframe=${timeframe}`))).json();
    expect(body).toMatchObject({ events: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false }, filters: { severity: 'ALL' } });
    expect(eqValue(adminDb.callsTo('SecurityEvent')[0], 'severity')).toBeUndefined();
  });

  it('answers 500 when the query fails', async () => {
    adminDb.setTable('SecurityEvent', { error: new Error('db') });
    expect((await events.GET(makeRequest('/api/admin/security/events'))).status).toBe(500);
  });
});

describe('GET /api/admin/security/fraud-alerts', () => {
  it('returns the alerts', async () => {
    getFraudAlerts.mockResolvedValue([{ id: 'fast-1' }]);
    expect(await (await fraud.GET(makeRequest('/api/admin/security/fraud-alerts'))).json()).toEqual({ alerts: [{ id: 'fast-1' }] });
  });

  it('answers 500 for a Supabase admin without an admin-panel session, because getFraudAlerts redirects', async () => {
    // getFraudAlerts() calls requireAdminSession(), whose redirect() throws inside this route handler
    getFraudAlerts.mockRejectedValue(new Error('NEXT_REDIRECT'));
    expect((await fraud.GET(makeRequest('/api/admin/security/fraud-alerts'))).status).toBe(500);
  });
});
