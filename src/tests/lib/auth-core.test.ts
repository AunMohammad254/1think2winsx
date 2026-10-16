// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let sb: SupabaseMock;
let adminDb: SupabaseMock;
const cookieJar = new Map<string, string>();
const cookieStore = {
  get: vi.fn((name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined)),
  getAll: vi.fn(() => [...cookieJar].map(([name, value]) => ({ name, value }))),
  set: vi.fn((name: string, value: string) => void cookieJar.set(name, value)),
  delete: vi.fn((name: string) => void cookieJar.delete(name)),
};
let ssrOptions: { cookies: { getAll: () => unknown; setAll: (c: { name: string; value: string; options?: unknown }[]) => void } } | undefined;
const logger = { logAuthFailure: vi.fn(), logUnauthorizedAccess: vi.fn(), logSecurityEvent: vi.fn() };
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });

vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: typeof ssrOptions) => {
    ssrOptions = options;
    return sb.client;
  },
}));
vi.mock('@/lib/security-logger', () => ({ securityLogger: logger }));
vi.mock('@/lib/supabase/db-modules/shared', () => ({ getAdminDb: () => adminDb.client, generateId: () => 'gen-id' }));
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [])) }));

const am = await import('@/lib/auth-middleware');
const authLib = await import('@/lib/auth');
const adminSession = await import('@/lib/admin-session');
const guard = await import('@/lib/admin-guard');
const { adminSessionDb, securityEventDb } = await import('@/lib/supabase/db-modules/admin.db');

const player = { id: 'user-1', email: 'Player@Example.test', user_metadata: { name: 'Ali', avatar_url: 'https://img/a.png' } };

beforeEach(() => {
  sb = createSupabaseMock({ user: player });
  adminDb = createSupabaseMock();
  cookieJar.clear();
  ssrOptions = undefined;
  for (const fn of [...Object.values(cookieStore), ...Object.values(logger), redirect]) fn.mockClear();
  vi.stubEnv('ADMIN_EMAILS', ' boss@example.test , other@example.test');
  vi.stubEnv('ADMIN_PASSWORD', 'correct horse');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('auth-middleware', () => {
  it('getVerifiedUser maps the JWT claims, or returns null', async () => {
    expect(await am.getVerifiedUser()).toEqual({ id: 'user-1', email: 'Player@Example.test', user_metadata: player.user_metadata });
    sb.setUser({ id: 'u2' });
    expect((await am.getVerifiedUser())!.user_metadata).toEqual({});
    sb.auth.getClaims.mockResolvedValueOnce({ data: { claims: { sub: 'u2' } }, error: null } as never);
    expect((await am.getVerifiedUser())!.user_metadata).toEqual({});
    sb.setUser(null);
    expect(await am.getVerifiedUser()).toBeNull();
  });

  it('wires the Supabase client to the request cookies', async () => {
    cookieJar.set('sb-auth', 'tok');
    await am.getVerifiedUser();
    expect(ssrOptions!.cookies.getAll()).toEqual([{ name: 'sb-auth', value: 'tok' }]);
    ssrOptions!.cookies.setAll([{ name: 'sb-auth', value: 'new' }]);
    expect(cookieJar.get('sb-auth')).toBe('new');
    cookieStore.set.mockImplementationOnce(() => { throw new Error('read-only in a Server Component'); });
    expect(() => ssrOptions!.cookies.setAll([{ name: 'x', value: 'y' }])).not.toThrow();
  });

  it('requireAuth returns the session and a display user', async () => {
    const res = await am.requireAuth();
    expect(res).toMatchObject({ session: { user: { id: 'user-1' } }, user: { id: 'user-1', name: 'Ali', image: 'https://img/a.png' } });
    sb.setUser({ id: 'u3', email: 'x@y.z', user_metadata: { full_name: 'Full Name' } });
    expect(((await am.requireAuth()) as { user: { name: string } }).user.name).toBe('Full Name');
    sb.setUser({ id: 'u4', email: 'plain@y.z' });
    expect(((await am.requireAuth()) as { user: { name: string } }).user.name).toBe('plain');
  });

  it('requireAuth answers 401 SESSION_EXPIRED without a session, with debug info only in development', async () => {
    sb.setUser(null);
    let res = (await am.requireAuth({ context: 'ctx' })) as NextResponse;
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(logger.logAuthFailure).toHaveBeenCalledWith(undefined, 'ctx', expect.stringContaining('No session'));

    vi.stubEnv('NODE_ENV', 'development');
    res = (await am.requireAuth()) as NextResponse;
    expect((await res.json()).debug).toMatchObject({ nodeEnv: 'development' });
  });

  it('requireAuth retries a missing session before giving up', async () => {
    vi.useFakeTimers();
    sb.auth.getClaims.mockResolvedValueOnce({ data: null, error: { message: 'missing' } } as never);
    const res = await am.requireAuth({ maxRetries: 2 });
    expect(res).toMatchObject({ user: { id: 'user-1' } });
    vi.useRealTimers();
  });

  it('requireAuth answers 500 when verification keeps throwing, after backing off', async () => {
    vi.useFakeTimers();
    sb.auth.getClaims.mockRejectedValue(new Error('auth api down'));
    const pending = am.requireAuth({ maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(100);
    const res = (await pending) as NextResponse;
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('AUTH_SERVICE_ERROR');
    vi.useRealTimers();
  });

  it('requireAuth throws if asked for zero attempts', async () => {
    await expect(am.requireAuth({ maxRetries: 0 })).rejects.toThrow('Authentication failed after all retries');
  });

  it('adminOnly accepts listed emails case-insensitively and forbids others', async () => {
    sb.setUser({ id: 'a1', email: 'BOSS@example.test' });
    expect(await am.requireAuth({ adminOnly: true })).toMatchObject({ user: { id: 'a1' } });
    // cached on the second call
    expect(await am.requireAuth({ adminOnly: true })).toMatchObject({ user: { id: 'a1' } });

    sb.setUser({ id: 'u9', email: 'nobody@example.test' });
    const res = (await am.requireAuth({ adminOnly: true, context: 'admin_thing' })) as NextResponse;
    expect(res.status).toBe(403);
    expect(logger.logUnauthorizedAccess).toHaveBeenCalledWith('u9', 'admin_thing');

    sb.setUser({ id: 'u10' });
    expect(((await am.requireAuth({ adminOnly: true })) as NextResponse).status).toBe(403);

    // nobody is an admin when ADMIN_EMAILS is unset
    vi.stubEnv('ADMIN_EMAILS', undefined);
    sb.setUser({ id: 'u11', email: 'unset@example.test' });
    expect(((await am.requireAuth({ adminOnly: true })) as NextResponse).status).toBe(403);
  });

  it('adminOnly falls back to the admin-panel session cookie', async () => {
    sb.setUser(null);
    cookieJar.set('admin-session', 'tok');
    adminDb.setTable('AdminSession', { data: { email: 'boss@example.test' } });
    expect(await am.requireAuth({ adminOnly: true })).toMatchObject({ user: { id: 'admin-user', email: 'boss@example.test', name: 'Admin' } });

    adminDb.setTable('AdminSession', { data: null });
    expect(((await am.requireAuth({ adminOnly: true })) as NextResponse).status).toBe(401);

    // an admin-panel login for an email no longer in ADMIN_EMAILS is still refused
    adminDb.setTable('AdminSession', { data: { email: 'ex-admin@example.test' } });
    expect(((await am.requireAuth({ adminOnly: true, context: 'gone' })) as NextResponse).status).toBe(403);
    expect(logger.logUnauthorizedAccess).toHaveBeenCalledWith('admin-user', 'gone');
  });

  it('adminOnly does not let a non-admin player session shadow the admin-panel login', async () => {
    sb.setUser({ id: 'p1', email: 'shadow@example.test' });
    cookieJar.set('admin-session', 'tok');
    adminDb.setTable('AdminSession', { data: { email: 'boss@example.test' } });
    expect(await am.requireAuth({ adminOnly: true })).toMatchObject({ user: { id: 'admin-user', email: 'boss@example.test', name: 'Admin' } });

    // the player's own email is not cached as admin
    cookieJar.delete('admin-session');
    expect(((await am.requireAuth({ adminOnly: true })) as NextResponse).status).toBe(403);
    expect(await am.isCurrentUserAdmin()).toBe(false);

    // a player without an email falls back too
    sb.setUser({ id: 'p2' });
    cookieJar.set('admin-session', 'tok');
    expect(await am.requireAuth({ adminOnly: true })).toMatchObject({ user: { id: 'admin-user' } });
  });

  it('adminOnly keeps the player identity when the admin-panel login does not grant admin', async () => {
    sb.setUser({ id: 'p3', email: 'shadow2@example.test' });
    cookieJar.set('admin-session', 'tok');
    adminDb.setTable('AdminSession', { data: { email: 'ex-admin2@example.test' } });
    const res = (await am.requireAuth({ adminOnly: true, context: 'both_refused' })) as NextResponse;
    expect(res.status).toBe(403);
    expect(logger.logUnauthorizedAccess).toHaveBeenCalledWith('p3', 'both_refused');
  });

  it('adminOnly does not consult the admin-panel login for an admin player, nor without adminOnly', async () => {
    cookieJar.set('admin-session', 'tok');
    adminDb.setTable('AdminSession', { data: { email: 'other@example.test' } });
    sb.setUser({ id: 'a2', email: 'boss@example.test' });
    expect(await am.requireAuth({ adminOnly: true })).toMatchObject({ user: { id: 'a2' } });
    sb.setUser({ id: 'p4', email: 'shadow3@example.test' });
    expect(await am.requireAuth()).toMatchObject({ user: { id: 'p4' } });
    expect(adminDb.callsTo('AdminSession')).toHaveLength(0);
  });

  it('isCurrentUserAdmin checks the email list, the cache, and the admin cookie', async () => {
    sb.setUser({ id: 'x', email: 'other@example.test' });
    expect(await am.isCurrentUserAdmin()).toBe(true);
    expect(await am.isCurrentUserAdmin()).toBe(true); // cached
    sb.setUser({ id: 'y', email: 'fresh@example.test' });
    expect(await am.isCurrentUserAdmin()).toBe(false);
    sb.setUser({ id: 'z' });
    expect(await am.isCurrentUserAdmin()).toBe(false);

    sb.setUser(null);
    expect(await am.isCurrentUserAdmin()).toBe(false);
    cookieJar.set('admin-session', 'tok');
    adminDb.setTable('AdminSession', { data: { email: 'boss@example.test' } });
    expect(await am.isCurrentUserAdmin()).toBe(true);

    // a non-admin player session does not shadow the admin cookie
    sb.setUser({ id: 'y', email: 'fresh@example.test' });
    expect(await am.isCurrentUserAdmin()).toBe(true);
    adminDb.setTable('AdminSession', { data: null });
    expect(await am.isCurrentUserAdmin()).toBe(false);
  });

  it('expires cached admin decisions after five minutes', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    sb.setUser({ id: 'c', email: 'cache-me@example.test' });
    expect(await am.isCurrentUserAdmin()).toBe(false);
    vi.stubEnv('ADMIN_EMAILS', 'cache-me@example.test');
    expect(await am.isCurrentUserAdmin()).toBe(false); // still cached
    clock.mockReturnValue(now + 5 * 60_000 + 1);
    expect(await am.requireAuth({ adminOnly: true })).toMatchObject({ user: { id: 'c' } });
    clock.mockRestore();
  });

  it('getCurrentUser returns a display user or null', async () => {
    expect(await am.getCurrentUser()).toEqual({ id: 'user-1', email: 'Player@Example.test', name: 'Ali', image: 'https://img/a.png' });
    sb.setUser({ id: 'u', email: 'e@x.y', user_metadata: { full_name: 'F' } });
    expect((await am.getCurrentUser())!.name).toBe('F');
    sb.setUser({ id: 'u', email: 'e@x.y' });
    expect((await am.getCurrentUser())!.name).toBe('e');
    sb.setUser(null);
    expect(await am.getCurrentUser()).toBeNull();
  });
});

describe('lib/auth', () => {
  it('auth() builds a session with the admin flag', async () => {
    const session = await authLib.auth();
    expect(session).toMatchObject({ user: { id: 'user-1', email: 'Player@Example.test', name: 'Ali', image: 'https://img/a.png', isAdmin: false } });
    sb.setUser({ id: 'b', email: 'Boss@Example.test', user_metadata: { full_name: 'Boss' } });
    expect(await authLib.auth()).toMatchObject({ user: { isAdmin: true, name: 'Boss' } });
    sb.setUser({ id: 'c' });
    expect(await authLib.auth()).toMatchObject({ user: { isAdmin: false, name: undefined } });
  });

  it('auth() returns null without a session or on errors', async () => {
    sb.setUser(null);
    expect(await authLib.auth()).toBeNull();
    sb.auth.getClaims.mockRejectedValueOnce(new Error('x'));
    expect(await authLib.auth()).toBeNull();
  });

  it('wires cookies like the other server clients', async () => {
    await authLib.auth();
    ssrOptions!.cookies.setAll([{ name: 'a', value: 'b' }]);
    expect(cookieJar.get('a')).toBe('b');
    expect(ssrOptions!.cookies.getAll()).toEqual([{ name: 'a', value: 'b' }]);
    cookieStore.set.mockImplementationOnce(() => { throw new Error('ro'); });
    expect(() => ssrOptions!.cookies.setAll([{ name: 'c', value: 'd' }])).not.toThrow();
  });

  it('helper wrappers', async () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    expect(await authLib.getCurrentUser()).toMatchObject({ id: 'user-1' });
    expect(await authLib.isAuthenticated()).toBe(true);
    expect(await authLib.isAdmin()).toBe(false);
    sb.setUser(null);
    expect(await authLib.getCurrentUser()).toBeNull();
    expect(await authLib.isAuthenticated()).toBe(false);
    expect(await authLib.isAdmin()).toBe(false);
  });
});

describe('admin-session', () => {
  it('verifyAdminCredentials needs a listed email and the shared password', () => {
    expect(adminSession.verifyAdminCredentials(' BOSS@example.test ', 'correct horse')).toBe(true);
    expect(adminSession.verifyAdminCredentials('boss@example.test', 'wrong')).toBe(false);
    expect(adminSession.verifyAdminCredentials('stranger@example.test', 'correct horse')).toBe(false);
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect(adminSession.verifyAdminCredentials('boss@example.test', '')).toBe(false);
    vi.unstubAllEnvs();
    delete process.env.ADMIN_EMAILS;
    process.env.ADMIN_PASSWORD = 'p';
    expect(adminSession.verifyAdminCredentials('boss@example.test', 'p')).toBe(false);
    delete process.env.ADMIN_PASSWORD;
  });

  it('createAdminSession stores a random token and sets an httpOnly cookie', async () => {
    adminDb.setTable('AdminSession', { data: {} });
    const token = await adminSession.createAdminSession('Boss@Example.test');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(argOf(adminDb.callsTo('AdminSession', 'insert')[0], 'insert')).toMatchObject({ id: 'gen-id', token, email: 'boss@example.test' });
    expect(cookieStore.set).toHaveBeenCalledWith('admin-session', token, expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 86400, secure: false }));
    expect(adminDb.callsTo('AdminSession', 'delete')).toHaveLength(1); // expired sessions cleaned up
    expect(await adminSession.createAdminSession('b@x.y')).not.toBe(token);
  });

  it('createAdminSession survives a failed cleanup and sets a secure cookie in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    adminDb.setTable('AdminSession', (call) => (call.ops.some((o) => o.op === 'delete') ? { error: { message: 'x' } } : { data: {} }));
    await adminSession.createAdminSession('boss@example.test');
    await new Promise((r) => setTimeout(r, 0));
    expect(cookieStore.set).toHaveBeenCalledWith('admin-session', expect.any(String), expect.objectContaining({ secure: true }));
    expect(console.error).toHaveBeenCalledWith('Error cleaning expired admin sessions:', expect.anything());
  });

  it('validateAdminSession checks the cookie token against unexpired sessions', async () => {
    expect(await adminSession.validateAdminSession()).toEqual({ valid: false });
    cookieJar.set('admin-session', 'tok');
    adminDb.setTable('AdminSession', { data: { email: 'boss@example.test' } });
    expect(await adminSession.validateAdminSession()).toEqual({ valid: true, email: 'boss@example.test' });
    const lookup = adminDb.callsTo('AdminSession')[0];
    expect(eqValue(lookup, 'token')).toBe('tok');
    expect(lookup.ops.find((o) => o.op === 'gt')?.args[0]).toBe('expiresAt');
    adminDb.setTable('AdminSession', { data: null });
    expect(await adminSession.validateAdminSession()).toEqual({ valid: false });
    adminDb.setTable('AdminSession', { error: { code: '500' } });
    expect(await adminSession.validateAdminSession()).toEqual({ valid: false });
  });

  it('clearAdminSession deletes the row and the cookie, tolerating failures', async () => {
    await adminSession.clearAdminSession();
    expect(cookieStore.delete).toHaveBeenCalledWith('admin-session');
    expect(adminDb.calls).toHaveLength(0);

    cookieJar.set('admin-session', 'tok');
    adminDb.setTable('AdminSession', { error: { message: 'gone' } });
    await adminSession.clearAdminSession();
    expect(eqValue(adminDb.callsTo('AdminSession', 'delete')[0], 'token')).toBe('tok');
    expect(cookieJar.has('admin-session')).toBe(false);

    cookieStore.delete.mockImplementationOnce(() => { throw new Error('ro'); });
    await expect(adminSession.clearAdminSession()).resolves.toBeUndefined();
  });

  it('requireAdminSession returns the email or redirects to the admin login', async () => {
    cookieJar.set('admin-session', 'tok');
    adminDb.setTable('AdminSession', { data: { email: 'boss@example.test' } });
    expect(await adminSession.requireAdminSession()).toBe('boss@example.test');
    adminDb.setTable('AdminSession', { data: null });
    await expect(adminSession.requireAdminSession()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/login');
    redirect.mockImplementationOnce(() => undefined as never);
    await expect(adminSession.requireAdminSession()).rejects.toThrow('Redirect to admin login');
    expect(adminSession.getAdminSessionCookieName()).toBe('admin-session');
  });
});

describe('admin-guard', () => {
  it('assertAdmin returns the email or throws AdminAuthError', async () => {
    cookieJar.set('admin-session', 'tok');
    adminDb.setTable('AdminSession', { data: { email: 'boss@example.test' } });
    expect(await guard.assertAdmin()).toBe('boss@example.test');
    expect(await guard.adminActionGuard()).toBeNull();

    adminDb.setTable('AdminSession', { data: { email: '' } });
    const err = await guard.assertAdmin().catch((e) => e);
    expect(err).toBeInstanceOf(guard.AdminAuthError);
    expect(err.name).toBe('AdminAuthError');
    expect(await guard.adminActionGuard()).toEqual({ success: false, error: 'Unauthorized: admin session required' });
  });
});

describe('admin.db', () => {
  it('session rows: create, delete, rethrow errors', async () => {
    adminDb.setTable('AdminSession', { data: { id: 'gen-id' } });
    expect(await adminSessionDb.create({ token: 't', email: 'e', expiresAt: 'x' } as never)).toEqual({ id: 'gen-id' });
    await adminSessionDb.delete('t');
    await adminSessionDb.deleteExpired();
    adminDb.setTable('AdminSession', { error: { message: 'x' } });
    await expect(adminSessionDb.create({} as never)).rejects.toBeTruthy();
    await expect(adminSessionDb.delete('t')).rejects.toBeTruthy();
    await expect(adminSessionDb.deleteExpired()).rejects.toBeTruthy();
    adminDb.setTable('AdminSession', { data: null, error: { code: 'PGRST116' } });
    expect(await adminSessionDb.findByToken('t')).toBeNull();
  });

  it('security events: create, recent, count by type', async () => {
    adminDb.setTable('SecurityEvent', { data: { id: 'gen-id' } });
    expect(await securityEventDb.create({ type: 'X' } as never)).toEqual({ id: 'gen-id' });
    adminDb.setTable('SecurityEvent', { data: null });
    expect(await securityEventDb.findRecent()).toEqual([]);
    expect(argOf(adminDb.callsTo('SecurityEvent')[1], 'limit')).toBe(100);
    adminDb.setTable('SecurityEvent', { count: 7 });
    expect(await securityEventDb.countByType('LOGIN', new Date(0))).toBe(7);
    adminDb.setTable('SecurityEvent', { count: null });
    expect(await securityEventDb.countByType('LOGIN', new Date(0))).toBe(0);
    adminDb.setTable('SecurityEvent', { error: { message: 'x' } });
    await expect(securityEventDb.create({} as never)).rejects.toBeTruthy();
    await expect(securityEventDb.findRecent(5)).rejects.toBeTruthy();
    await expect(securityEventDb.countByType('X', new Date())).rejects.toBeTruthy();
  });
});
