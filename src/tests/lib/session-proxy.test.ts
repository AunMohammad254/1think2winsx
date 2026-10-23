// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type SetAll = (c: { name: string; value: string; options?: Record<string, unknown> }[]) => void;
let ssr: { getAll: () => { name: string; value: string }[]; setAll: SetAll } | undefined;
const getClaims = vi.fn();
const createServerClient = vi.fn((_url: string, _key: string, opts: { cookies: typeof ssr }) => {
  ssr = opts.cookies;
  return { auth: { getClaims } };
});
vi.mock('@supabase/ssr', () => ({ createServerClient: (...a: unknown[]) => createServerClient(...(a as [string, string, { cookies: typeof ssr }])) }));

const { updateSession } = await import('@/lib/supabase/middleware');

const nowS = () => Math.floor(Date.now() / 1000);
const sessionCookie = (expiresAt: number | string | undefined, encoded = true) => {
  const json = JSON.stringify({ access_token: 'a', expires_at: expiresAt });
  return encoded ? 'base64-' + Buffer.from(json).toString('base64url') : json;
};
function req(path: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
}
const location = (res: Response) => res.headers.get('location');

beforeEach(() => {
  ssr = undefined;
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: 'user-1' } }, error: null });
  createServerClient.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('updateSession', () => {
  it('skips Supabase entirely for public pages with a fresh (or no) session', async () => {
    expect(location(await updateSession(req('/faq')))).toBeNull();
    expect(location(await updateSession(req('/leaderboard', { 'sb-ref-auth-token': sessionCookie(nowS() + 3600) })))).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('redirects signed-out visitors away from protected pages without calling Supabase', async () => {
    for (const path of ['/profile', '/quiz/abc', '/quizzes']) {
      const res = await updateSession(req(path));
      expect(location(res)).toBe(`http://localhost/login?redirect=${encodeURIComponent(path)}`);
    }
    expect(createServerClient).not.toHaveBeenCalled();
    // '/quizzesX' is not under a protected prefix
    expect(location(await updateSession(req('/quizzesX')))).toBeNull();
  });

  it('lets signed-out visitors open the login and register pages', async () => {
    expect(location(await updateSession(req('/login')))).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('verifies the session for protected pages and lets a signed-in player through', async () => {
    const res = await updateSession(req('/profile', { 'sb-ref-auth-token': sessionCookie(nowS() + 3600) }));
    expect(location(res)).toBeNull();
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(ssr!.getAll()).toEqual([{ name: 'sb-ref-auth-token', value: expect.any(String) }]);
  });

  it('redirects to login when the claims are missing', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await updateSession(req('/quizzes', { 'sb-ref-auth-token': sessionCookie(nowS() + 3600) }));
    expect(location(res)).toBe('http://localhost/login?redirect=%2Fquizzes');
  });

  it('sends signed-in players from /login and /register to /quizzes', async () => {
    const res = await updateSession(req('/register?ref=x', { 'sb-ref-auth-token': sessionCookie(nowS() + 3600) }));
    expect(location(res)).toBe('http://localhost/quizzes');
  });

  it('refreshes an expiring session on public pages and copies refreshed cookies to the response', async () => {
    getClaims.mockImplementation(async () => {
      ssr!.setAll([{ name: 'sb-ref-auth-token', value: 'refreshed', options: { path: '/' } }]);
      return { data: { claims: { sub: 'user-1' } }, error: null };
    });
    const res = await updateSession(req('/faq', { 'sb-ref-auth-token': sessionCookie(nowS() + 30) }));
    expect(getClaims).toHaveBeenCalled();
    expect(res.cookies.get('sb-ref-auth-token')?.value).toBe('refreshed');
  });

  it.each([
    ['a missing expiry', sessionCookie(undefined)],
    ['a non-numeric expiry', sessionCookie('soon')],
    ['an unreadable cookie', 'base64-' + Buffer.from('not-json').toString('base64url')],
    ['a plain JSON cookie that is expiring', sessionCookie(nowS() + 10, false)],
  ])('treats %s as needing a refresh', async (_label, value) => {
    await updateSession(req('/faq', { 'sb-ref-auth-token': value }));
    expect(getClaims).toHaveBeenCalled();
  });

  it('reassembles a session split into numbered chunks', async () => {
    const whole = sessionCookie(nowS() + 3600);
    const cut = Math.floor(whole.length / 2);
    await updateSession(req('/faq', { 'sb-ref-auth-token.1': whole.slice(cut), 'sb-ref-auth-token.0': whole.slice(0, cut) }));
    expect(getClaims).not.toHaveBeenCalled(); // fresh, so public pages still skip Supabase

    await updateSession(req('/faq', { 'sb-ref-auth-token.0': sessionCookie(nowS() + 5).slice(0, 20), 'sb-ref-auth-token.1': sessionCookie(nowS() + 5).slice(20) }));
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it('clears the cookies of a revoked session, but keeps them on transient errors', async () => {
    getClaims.mockResolvedValue({ data: null, error: { name: 'AuthApiError', message: 'revoked' } });
    let res = await updateSession(req('/faq', { 'sb-ref-auth-token': sessionCookie(nowS() - 10), 'sb-other': 'x', theme: 'dark' }));
    const cleared = res.headers.getSetCookie().join(';');
    expect(cleared).toContain('sb-ref-auth-token=;');
    expect(cleared).toContain('sb-other=;');
    expect(cleared).not.toContain('theme=');

    getClaims.mockResolvedValue({ data: null, error: { name: 'AuthRetryableFetchError', message: 'Invalid Refresh Token: Already Used' } });
    res = await updateSession(req('/faq', { 'sb-ref-auth-token': sessionCookie(nowS() - 10) }));
    expect(res.headers.getSetCookie().join(';')).toContain('sb-ref-auth-token=;');

    getClaims.mockResolvedValue({ data: null, error: { name: 'AuthRetryableFetchError', message: 'fetch failed' } });
    res = await updateSession(req('/faq', { 'sb-ref-auth-token': sessionCookie(nowS() - 10) }));
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('logs a thrown verification error and treats the visitor as signed out', async () => {
    getClaims.mockRejectedValue(new Error('network'));
    const res = await updateSession(req('/profile', { 'sb-ref-auth-token': sessionCookie(nowS() + 3600) }));
    expect(location(res)).toBe('http://localhost/login?redirect=%2Fprofile');
    expect(console.error).toHaveBeenCalledWith('[Auth Proxy] Error verifying session:', expect.any(Error));
  });

  it('quietly clears the cookies when verification throws a stale refresh-token error', async () => {
    vi.mocked(console.error).mockClear();
    getClaims.mockRejectedValue(Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { code: 'refresh_token_not_found' }));
    const res = await updateSession(req('/faq', { 'sb-ref-auth-token': sessionCookie(nowS() - 10) }));
    expect(location(res)).toBeNull();
    expect(res.headers.getSetCookie().join(';')).toContain('sb-ref-auth-token=;');
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('proxy', () => {
  let proxyMod: typeof import('@/proxy');
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co');
    proxyMod = await import('@/proxy');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sends admin pages without the admin cookie to the admin login', async () => {
    const res = await proxyMod.proxy(req('/admin/dashboard'));
    expect(location(res)).toBe('http://localhost/admin/login?redirect=%2Fadmin%2Fdashboard');
  });

  it('lets the admin login page and cookie-holders through, with security headers', async () => {
    for (const r of [req('/admin/login'), req('/admin/quiz', { 'admin-session': 'tok' }), req('/faq')]) {
      const res = await proxyMod.proxy(r);
      expect(location(res)).toBeNull();
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toContain('connect-src \'self\' https://ref.supabase.co wss://ref.supabase.co');
      expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    }
  });

  it('returns the session redirect untouched', async () => {
    const res = await proxyMod.proxy(req('/profile'));
    expect(location(res)).toBe('http://localhost/login?redirect=%2Fprofile');
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('adds HSTS in production and allows eval only in development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    let mod = await import('@/proxy');
    let res = await mod.proxy(req('/faq'));
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers.get('Content-Security-Policy')).not.toContain('unsafe-eval');
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com;");

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.resetModules();
    mod = await import('@/proxy');
    res = await mod.proxy(req('/faq'));
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com;");
  });

  it('lets the Turnstile check on the auth forms load its script and iframe', async () => {
    const csp = (await proxyMod.proxy(req('/faq'))).headers.get('Content-Security-Policy')!;
    const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `))!;
    expect(directive('script-src')).toContain('https://challenges.cloudflare.com');
    expect(directive('frame-src')).toContain('https://challenges.cloudflare.com');
  });

  it("lets Cloudflare's Web Analytics beacon, which the zone injects into every page, load and report", async () => {
    const csp = (await proxyMod.proxy(req('/faq'))).headers.get('Content-Security-Policy')!;
    const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `))!;
    expect(directive('script-src')).toContain('https://static.cloudflareinsights.com');
    expect(directive('connect-src')).toContain('https://cloudflareinsights.com');
  });

  it("lets the service worker and Sentry Session Replay's compression worker run, and needs no Sentry host (tunnel)", async () => {
    const csp = (await proxyMod.proxy(req('/faq'))).headers.get('Content-Security-Policy')!;
    const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `))!;
    expect(directive('worker-src')).toBe("worker-src 'self' blob:");
    expect(csp).not.toContain('sentry.io');
  });

  it('never runs for API routes, Next internals or static files', () => {
    const matcher = new RegExp(`^${proxyMod.config.matcher[0]}$`);
    expect(matcher.test('/quizzes')).toBe(true);
    // /monitoring is the Sentry tunnel (src/app/monitoring/route.ts): no session refresh for every error report
    for (const path of ['/api/quizzes', '/monitoring', '/_next/static/chunk.js', '/favicon.ico', '/images/logo.png', '/sw.js', '/model.glb']) {
      expect(matcher.test(path)).toBe(false);
    }
  });
});
