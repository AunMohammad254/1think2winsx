// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let sb: SupabaseMock;
let adminDb: SupabaseMock;
const detectForUser = vi.fn();
const sendPasswordSetupEmail = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();
const logger = { logUnauthorizedAccess: vi.fn(), logInvalidInput: vi.fn(), logAuthFailure: vi.fn(), logSecurityEvent: vi.fn(), logPerformanceMetric: vi.fn() };
const healthCheck = vi.fn();
const getPerfSummary = vi.fn();
const runScheduledJobs = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => sb.client }));
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));
vi.mock('@/lib/auth-detection-server', () => ({ detectForUser: (...a: unknown[]) => detectForUser(...a) }));
vi.mock('@/lib/password-setup', () => ({ sendPasswordSetupEmail: (...a: unknown[]) => sendPasswordSetupEmail(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { passwordChange: 'passwordChange' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a), securityMonitor: { getPerfSummary: () => getPerfSummary() } }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: logger }));
vi.mock('@/lib/logger', () => ({ default: { log: vi.fn() } }));
vi.mock('@/lib/transaction-manager', () => ({ TransactionManager: { healthCheck: () => healthCheck() } }));
vi.mock('@/lib/scheduled-jobs', () => ({ runScheduledJobs: () => runScheduledJobs() }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const changePw = await import('@/app/api/profile/change-password/route');
const canChange = await import('@/app/api/profile/can-change-password/route');
const authMethod = await import('@/app/api/profile/auth-method/route');
const health = await import('@/app/api/health/route');
const cron = await import('@/app/api/cron/process-scheduled/route');

const user = (over: Record<string, unknown> = {}) => ({ id: 'user-1', email: 'p@example.test', identities: [{ provider: 'email' }, { provider: 'google' }], ...over });

beforeEach(() => {
  sb = createSupabaseMock({ user: user() });
  adminDb = createSupabaseMock();
  for (const fn of [detectForUser, sendPasswordSetupEmail, requireCSRFToken, applyRateLimit, recordSecurityEvent, healthCheck, getPerfSummary, runScheduledJobs, revalidatePath, ...Object.values(logger)]) fn.mockReset();
  detectForUser.mockResolvedValue({ hasPassword: true, currentMethod: 'password' });
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('PUT /api/profile/change-password', () => {
  const body = { currentPassword: 'Old@1234', newPassword: 'New@5678', captchaToken: 'tok' };
  const put = (b: unknown = body) => changePw.PUT(makeRequest('/x', { method: 'PUT', body: b }));
  const signInResults = (...results: Array<{ message: string; code?: string } | null>) => {
    for (const error of results) sb.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error } as never);
  };

  it('verifies the current password with one Turnstile-checked sign-in, then updates it', async () => {
    signInResults(null);
    const res = await put();
    expect(await res.json()).toEqual({ message: 'Password changed successfully' });
    expect((sb.auth.signInWithPassword.mock.calls as unknown[][]).map((c) => c[0])).toEqual([
      { email: 'p@example.test', password: 'Old@1234', options: { captchaToken: 'tok' } },
    ]);
    expect(sb.auth.updateUser).toHaveBeenCalledWith({ password: 'New@5678' });
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'PASSWORD_CHANGE', userId: 'user-1' }));
  });

  it('refuses a wrong current password or an unchanged one', async () => {
    signInResults({ message: 'bad' });
    expect((await (await put()).json()).message).toBe('Current password is incorrect');
    expect(recordSecurityEvent).toHaveBeenCalledWith('INVALID_PASSWORD_ATTEMPT', expect.anything(), 'user-1', expect.anything());
    signInResults(null);
    expect((await (await put({ ...body, newPassword: 'Old@1234' })).json()).message).toBe('New password must be different from current password');
    expect(sb.auth.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(sb.auth.updateUser).not.toHaveBeenCalled();
  });

  it('needs a Turnstile token, and does not count a failed check as a wrong password', async () => {
    const missing = await put({ currentPassword: 'Old@1234', newPassword: 'New@5678' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ message: 'Please complete the security check.' });
    expect((await changePw.PUT(makeRequest('/x', { method: 'PUT', rawBody: 'not json' }))).status).toBe(400);
    expect(sb.auth.signInWithPassword).not.toHaveBeenCalled();

    signInResults({ message: 'captcha protection: request disallowed (timeout-or-duplicate)', code: 'captcha_failed' });
    const failed = await put();
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ message: 'The security check failed or expired. Please try again.' });
    expect(recordSecurityEvent).not.toHaveBeenCalledWith('INVALID_PASSWORD_ATTEMPT', expect.anything(), expect.anything(), expect.anything());
    expect(sb.auth.updateUser).not.toHaveBeenCalled();
  });

  it('relays an update failure', async () => {
    signInResults(null);
    sb.auth.updateUser.mockResolvedValueOnce({ data: {}, error: { message: 'Password is known to be weak' } } as never);
    expect(await (await put()).json()).toEqual({ message: 'Password is known to be weak' });
    signInResults(null);
    sb.auth.updateUser.mockResolvedValueOnce({ data: {}, error: { message: '' } } as never);
    expect((await (await put()).json()).message).toBe('Failed to update password');
  });

  it('emails Google-only accounts a set-password link instead', async () => {
    detectForUser.mockResolvedValue({ hasPassword: false });
    sendPasswordSetupEmail.mockResolvedValue({ ok: true });
    expect(await (await put({ captchaToken: 'tok' })).json()).toMatchObject({ resetEmailSent: true });
    expect(sendPasswordSetupEmail).toHaveBeenCalledWith(sb.client, 'p@example.test', 'tok');
    sendPasswordSetupEmail.mockResolvedValue({ ok: false, captchaFailed: true });
    const failedCheck = await put({ captchaToken: 'used' });
    expect(failedCheck.status).toBe(400);
    expect((await failedCheck.json()).message).toBe('The security check failed or expired. Please try again.');
    sendPasswordSetupEmail.mockResolvedValue({ ok: false });
    expect((await put({ captchaToken: 'tok' })).status).toBe(502);
    sb.setUser(user({ email: undefined }));
    expect((await put({ captchaToken: 'tok' })).status).toBe(502);
  });

  it('validates the new password, guards, and maps failures', async () => {
    expect((await put({ currentPassword: 'x', newPassword: 'weakpass', captchaToken: 'tok' })).status).toBe(400);
    expect(logger.logInvalidInput).toHaveBeenCalled();
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await put()).status).toBe(403);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await put()).status).toBe(429);
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), 'user-1', expect.objectContaining({ rateLimiter: 'passwordChange' }));
    detectForUser.mockRejectedValueOnce(new Error('connection refused'));
    expect((await put()).status).toBe(503);
    detectForUser.mockRejectedValueOnce(new Error('other'));
    expect((await put()).status).toBe(500);
    sb.setUser(null);
    expect((await put()).status).toBe(401);
    expect(logger.logUnauthorizedAccess).toHaveBeenCalled();
  });
});

describe('GET /api/profile/can-change-password and /api/profile/auth-method', () => {
  it('only offers "change password" to a session that signed in with a password', async () => {
    expect(await (await canChange.GET()).json()).toEqual({ canChangePassword: true, hasPassword: true, currentMethod: 'password', authProvider: 'email', authMethod: 'email', oAuthProviders: ['google'] });
    detectForUser.mockResolvedValue({ hasPassword: true, currentMethod: 'oauth' });
    expect((await (await canChange.GET()).json()).canChangePassword).toBe(false);
  });

  it('reports the OAuth provider for password-less accounts', async () => {
    sb.setUser(user({ identities: [{ provider: 'google' }] }));
    detectForUser.mockResolvedValue({ hasPassword: false, currentMethod: 'oauth' });
    expect(await (await canChange.GET()).json()).toMatchObject({ canChangePassword: false, authProvider: 'google', authMethod: 'oauth' });
    sb.setUser(user({ identities: undefined }));
    expect((await (await canChange.GET()).json()).authProvider).toBe('unknown');
  });

  it('requires a session and reports errors', async () => {
    detectForUser.mockRejectedValueOnce(new Error('x'));
    expect((await canChange.GET()).status).toBe(500);
    detectForUser.mockRejectedValueOnce(new Error('x'));
    expect((await authMethod.GET()).status).toBe(500);
    sb.setUser(null);
    expect((await canChange.GET()).status).toBe(401);
    expect((await authMethod.GET()).status).toBe(401);
  });

  it('auth-method returns the detection, never cached', async () => {
    detectForUser.mockResolvedValue({ hasPassword: true, currentMethod: 'magiclink', providers: ['email'] });
    const res = await authMethod.GET();
    expect(await res.json()).toEqual({ hasPassword: true, currentMethod: 'magiclink', providers: ['email'] });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('GET /api/health', () => {
  const get = (qs = '', secret?: string) => health.GET(makeRequest(`/api/health${qs}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-s3cret');
    healthCheck.mockResolvedValue({ status: 'healthy', details: {} });
    getPerfSummary.mockReturnValue({ p95: 10 });
    adminDb.setTable('User', { data: [{ id: 'u' }] });
  });

  it('is a cheap public liveness probe by default', async () => {
    const res = await get();
    expect(await res.json()).toEqual({ status: 'ok', timestamp: expect.any(String) });
    expect(adminDb.calls).toHaveLength(0);
  });

  it('needs the cron secret for stats and the deep report', async () => {
    expect((await get('?stats=1')).status).toBe(401);
    expect((await get('?deep=1', 'wrong')).status).toBe(401);
    const stats = await (await get('?stats=1', 'cron-s3cret')).json();
    expect(stats).toMatchObject({ status: 'ok', nodeVersion: process.version, load: expect.any(Object), client: expect.any(Object) });
  });

  it('deep report: healthy, degraded and unhealthy', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'x');
    vi.stubEnv('NEXTAUTH_SECRET', 'x');
    vi.stubEnv('ADMIN_EMAILS', 'x');
    let res = await get('?deep=1', 'cron-s3cret');
    let body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'healthy', components: { database: { status: 'healthy' }, authentication: { status: 'healthy' } }, performance: { p95: 10 } });

    vi.stubEnv('ADMIN_EMAILS', '');
    healthCheck.mockResolvedValue({ status: 'degraded', details: {} });
    body = await (await get('?deep=1', 'cron-s3cret')).json();
    expect(body.status).toBe('degraded');
    expect(body.components.authentication).toEqual({ status: 'degraded', configuration: { nextAuthUrl: '[SET]', nextAuthSecret: '[SET]', adminEmails: '[NOT SET]' }, missingConfig: ['adminEmails'] });

    healthCheck.mockRejectedValue(new Error('tx down'));
    res = await get('?deep=1', 'cron-s3cret');
    body = await res.json();
    expect(res.status).toBe(503);
    expect(body.components.transactions.details.lastError).toBe('tx down');

    healthCheck.mockRejectedValue({});
    expect((await (await get('?deep=1', 'cron-s3cret')).json()).components.transactions.details.lastError).toBe('Unknown error');
  });

  it('deep report: database read failures and slow reads', async () => {
    adminDb.setTable('User', { error: new Error('db down') });
    let body = await (await get('?deep=1', 'cron-s3cret')).json();
    expect(body.components.database).toMatchObject({ status: 'unhealthy', lastError: 'db down' });
    adminDb.setTable('User', { error: { message: 'plain' } });
    body = await (await get('?deep=1', 'cron-s3cret')).json();
    expect(body.components.database.lastError).toBe('Unknown error');

    adminDb.setTable('User', { data: [] });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValueOnce(now + 2000);
    body = await (await get('?deep=1', 'cron-s3cret')).json();
    expect(body.components.database.status).toBe('degraded');
    clock.mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValueOnce(now + 3500);
    body = await (await get('?deep=1', 'cron-s3cret')).json();
    clock.mockRestore();
    expect(body.components.database.status).toBe('unhealthy');
  });

  it('deep report: the whole report failing answers 503 and is logged', async () => {
    getPerfSummary.mockImplementation(() => { throw new Error('perf broke'); });
    const res = await get('?deep=1', 'cron-s3cret');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'unhealthy', message: 'perf broke' });
    expect(logger.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ action: 'health_check_failure' }) }));
    getPerfSummary.mockImplementation(() => { throw 'odd'; });
    expect((await (await get('?deep=1', 'cron-s3cret')).json()).message).toBe('Unknown error');
  });
});

describe('GET /api/cron/process-scheduled', () => {
  it('revalidates the pages of quizzes that changed', async () => {
    vi.stubEnv('CRON_SECRET', 'c');
    runScheduledJobs.mockResolvedValue({ processedQuizzes: ['q1', 'q2'], processedNotifications: ['n'], processedStaleDeposits: [] });
    const body = await (await cron.GET(makeRequest('/x', { headers: { authorization: 'Bearer c' } }))).json();
    expect(body.message).toBe('Processed 2 quizzes, 1 scheduled notifications, and 0 stale deposits.');
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(['/quizzes', '/admin/quiz', '/quiz/q1', '/quiz/q2']);
  });

  it('answers 500 when the jobs throw', async () => {
    vi.stubEnv('CRON_SECRET', 'c');
    runScheduledJobs.mockRejectedValue(new Error('boom'));
    expect((await cron.GET(makeRequest('/x', { headers: { authorization: 'Bearer c' } }))).status).toBe(500);
  });
});
