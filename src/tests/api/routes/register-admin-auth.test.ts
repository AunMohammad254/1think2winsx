// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { makeRequest } from '@/tests/helpers/supabase-mock';

const userDb = { findByEmail: vi.fn(), create: vi.fn() };
const applyRateLimit = vi.fn();
const requireCSRFToken = vi.fn();
const recordSecurityEvent = vi.fn();
const logger = { logInvalidInput: vi.fn(), logSuspiciousActivity: vi.fn(), logAuthFailure: vi.fn() };
const adminSession = { verifyAdminCredentials: vi.fn(), createAdminSession: vi.fn(), clearAdminSession: vi.fn(), validateAdminSession: vi.fn() };

vi.mock('@/lib/supabase/db', () => ({ userDb }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { auth: 'auth' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: logger }));
vi.mock('@/lib/admin-session', () => adminSession);

const register = await import('@/app/api/register/route');
const adminAuth = await import('@/app/api/admin/auth/route');

const good = { name: '  Ali Khan ', email: 'Ali@Example.test', password: 'Str0ng!pass' };

beforeEach(() => {
  for (const fn of [...Object.values(userDb), applyRateLimit, requireCSRFToken, recordSecurityEvent, ...Object.values(logger), ...Object.values(adminSession)]) fn.mockReset();
  applyRateLimit.mockResolvedValue(null);
  requireCSRFToken.mockResolvedValue(null);
  userDb.findByEmail.mockResolvedValue(null);
  userDb.create.mockImplementation(async (data: Record<string, unknown>) => ({ id: 'new', ...data }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/register (legacy, unused by the app)', () => {
  const post = (body: unknown) => register.POST(makeRequest('/api/register', { body }));

  it('creates a User row with a bcrypt hash, a normalised email and a trimmed name', async () => {
    const res = await post({ ...good, phone: '03123456789', dateOfBirth: '2000-05-05' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ message: 'User registered successfully', user: { id: 'new', name: 'Ali Khan', email: 'ali@example.test' }, redirectTo: '/quizzes' });
    const stored = userDb.create.mock.calls[0][0];
    expect(stored).toMatchObject({ name: 'Ali Khan', email: 'ali@example.test', phone: '03123456789', dateOfBirth: '2000-05-05T00:00:00.000Z', authProvider: 'email' });
    expect(stored.password).toMatch(/^\$2[aby]\$12\$/);
    expect(userDb.findByEmail).toHaveBeenCalledWith('ali@example.test');
  });

  it('omits optional fields that were not sent', async () => {
    await post(good);
    expect(Object.keys(userDb.create.mock.calls[0][0]).sort()).toEqual(['authProvider', 'email', 'name', 'password']);
  });

  it.each([
    ['a short name', { name: 'A' }],
    ['digits in the name', { name: 'Ali 2' }],
    ['a bad email', { email: 'nope' }],
    ['a weak password', { password: 'password' }],
    ['a foreign phone number', { phone: '+15551234567' }],
    ['an age under 13', { dateOfBirth: `${new Date().getFullYear() - 5}-01-01` }],
    ['an age over 100', { dateOfBirth: '1900-01-01' }],
  ])('rejects %s', async (_label, over) => {
    const res = await post({ ...good, ...over });
    expect(res.status).toBe(400);
    expect(logger.logInvalidInput).toHaveBeenCalled();
    expect(userDb.create).not.toHaveBeenCalled();
  });

  it('reveals that an email is already registered (409) - the enumeration registerAction avoids', async () => {
    userDb.findByEmail.mockResolvedValue({ id: 'existing' });
    const res = await post(good);
    expect(res.status).toBe(409);
    expect(recordSecurityEvent).toHaveBeenCalledWith('DUPLICATE_REGISTRATION_ATTEMPT', expect.anything(), undefined, { email: 'ali@example.test', endpoint: '/api/register' });
  });

  it('maps database failures', async () => {
    userDb.create.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));
    expect((await post(good)).status).toBe(409);
    expect(logger.logSuspiciousActivity).toHaveBeenCalled();
    userDb.create.mockRejectedValueOnce(new Error('connection refused'));
    expect((await post(good)).status).toBe(503);
    userDb.create.mockRejectedValueOnce(new Error('other'));
    expect((await post(good)).status).toBe(500);
    userDb.create.mockRejectedValueOnce('not an error');
    expect((await post(good)).status).toBe(500);
  });

  it('applies the auth rate limit before CSRF', async () => {
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await post(good)).status).toBe(429);
    expect(requireCSRFToken).not.toHaveBeenCalled();
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), undefined, { endpoint: '/api/register', rateLimiter: 'auth' });
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post(good)).status).toBe(403);
  });
});

describe('/api/admin/auth', () => {
  const login = (body: unknown) => adminAuth.POST(makeRequest('/api/admin/auth', { body }));

  it('creates an admin session for valid credentials', async () => {
    adminSession.verifyAdminCredentials.mockReturnValue(true);
    const res = await login({ email: 'boss@example.test', password: 'pw' });
    expect(await res.json()).toEqual({ success: true, message: 'Admin login successful' });
    expect(adminSession.createAdminSession).toHaveBeenCalledWith('boss@example.test');
  });

  it('gives the same answer for a wrong email or a wrong password, and logs it', async () => {
    adminSession.verifyAdminCredentials.mockReturnValue(false);
    const res = await login({ email: 'x@example.test', password: 'pw' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid email or password' });
    expect(logger.logAuthFailure).toHaveBeenCalledWith(undefined, '/api/admin/auth', 'Failed admin login attempt for email: x@example.test');
    expect(adminSession.createAdminSession).not.toHaveBeenCalled();
  });

  it('requires both fields and is rate limited', async () => {
    expect((await login({ email: 'a@b.c' })).status).toBe(400);
    expect((await login({ password: 'p' })).status).toBe(400);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await login({ email: 'a', password: 'b' })).status).toBe(429);
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), undefined, { endpoint: '/api/admin/auth', rateLimiter: 'auth' });
  });

  it('answers 500 when the session cannot be created', async () => {
    adminSession.verifyAdminCredentials.mockReturnValue(true);
    adminSession.createAdminSession.mockRejectedValueOnce(new Error('db'));
    expect((await login({ email: 'a', password: 'b' })).status).toBe(500);
  });

  it('logs out behind a CSRF check', async () => {
    const logout = () => adminAuth.DELETE(makeRequest('/api/admin/auth', { method: 'DELETE' }));
    expect(await (await logout()).json()).toEqual({ success: true, message: 'Admin logged out successfully' });
    expect(adminSession.clearAdminSession).toHaveBeenCalled();
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await logout()).status).toBe(403);
    adminSession.clearAdminSession.mockRejectedValueOnce(new Error('x'));
    expect((await logout()).status).toBe(500);
  });

  it('reports the session status', async () => {
    adminSession.validateAdminSession.mockResolvedValueOnce({ valid: true, email: 'boss@example.test' });
    expect(await (await adminAuth.GET()).json()).toEqual({ success: true, authenticated: true, email: 'boss@example.test' });
    adminSession.validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect(await (await adminAuth.GET()).json()).toEqual({ success: true, authenticated: false, email: null });
    adminSession.validateAdminSession.mockRejectedValueOnce(new Error('x'));
    expect((await adminAuth.GET()).status).toBe(500);
  });
});
