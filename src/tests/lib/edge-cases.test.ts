// @vitest-environment node
// Edge cases of small helpers that their main test files don't reach.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ marker: 'server-client' }) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('getClientIp', () => {
  it('skips an X-Forwarded-For header that holds only separators', async () => {
    const { getClientIp } = await import('@/lib/client-ip');
    expect(getClientIp(new Headers({ 'x-forwarded-for': ' , ,', 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });
});

describe('cloudinaryPublicIdFromUrl', () => {
  it('reads the public id when the URL has no version segment', async () => {
    const { cloudinaryPublicIdFromUrl, CLOUDINARY_CLOUD_NAME } = await import('@/lib/cloudinary');
    expect(cloudinaryPublicIdFromUrl(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/prizes/watch.jpg`)).toBe('prizes/watch');
  });
});

describe('schedule time', () => {
  it('keeps fractional seconds and formats Date objects like strings', async () => {
    const { toUtcIso, formatBusinessTime } = await import('@/lib/schedule-time');
    expect(toUtcIso('2026-12-01T16:30:00.5')).toBe('2026-12-01T11:30:00.500Z');
    expect(formatBusinessTime(new Date('2026-12-01T11:30:00Z'))).toBe(formatBusinessTime('2026-12-01T11:30:00Z'));
  });
});

describe('isOAuthOnlyUser', () => {
  it('decides from the primary provider when there are no identities', async () => {
    const { isOAuthOnlyUser } = await import('@/lib/auth-helpers');
    const user = (app_metadata: Record<string, unknown>) => ({ app_metadata }) as unknown as User;
    expect(isOAuthOnlyUser(user({ provider: 'google' }))).toBe(true);
    expect(isOAuthOnlyUser(user({ provider: 'email' }))).toBe(false);
    expect(isOAuthOnlyUser(user({}))).toBe(false);
  });
});

describe('security logger', () => {
  it('is a single shared instance, and copes with null values in event details', async () => {
    const { securityLogger } = await import('@/lib/security-logger');
    const ctor = securityLogger.constructor as unknown as { getInstance(): unknown };
    expect(ctor.getInstance()).toBe(securityLogger);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    securityLogger.logSecurityEvent({ type: 'SYSTEM_ERROR', details: { meta: null, password: 'p' } } as never);
    expect(warn.mock.calls[0][1]).toContain('"meta":null');
    expect(warn.mock.calls[0][1]).toContain('[REDACTED]');
  });
});

describe('security monitor', () => {
  it('forgets alert cooldowns once it tracks more than 50,000 of them', async () => {
    const { securityMonitor } = await import('@/lib/security-monitoring');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
    const violate = (userId: string) => {
      for (let i = 0; i < 3; i++) securityMonitor.recordEvent({ type: 'CSRF_TOKEN_VIOLATION', userId, ip: '1.1.1.1' });
    };
    const alertsFor = (userId: string) =>
      alerts.mock.calls.filter(([msg, details]) => msg === 'SECURITY ALERT: CSRF_ATTACK_DETECTED' && (details as { userId: string }).userId === userId).length;

    violate('u0');
    expect(alertsFor('u0')).toBe(1);
    for (let u = 1; u <= 50_000; u++) violate(`u${u}`);
    // The cooldown map was cleared, so u0 can be alerted about again straight away
    violate('u0');
    expect(alertsFor('u0')).toBe(2);
  }, 30_000); // 150,000 events take ~4 s under coverage, more on a busy machine
});

describe('Supabase fetch timeouts', () => {
  it('reads positive overrides from the environment and ignores the rest', async () => {
    vi.stubEnv('SUPABASE_FETCH_TIMEOUT_MS', '1234');
    vi.stubEnv('SUPABASE_ADMIN_FETCH_TIMEOUT_MS', '-5');
    const t = await import('@/lib/supabase/timeout-fetch');
    expect(t.SUPABASE_FETCH_TIMEOUT_MS).toBe(1234);
    expect(t.SUPABASE_ADMIN_FETCH_TIMEOUT_MS).toBe(30_000);
  });
});

describe('load shedding thresholds', () => {
  it('falls back to the default when a threshold is not a valid number', async () => {
    const shed = await import('@/lib/load-shed');
    shed.__resetLoadShedForTests();
    vi.stubEnv('LOAD_SHED_MAX_LAG_MS', '-1');
    shed.__setLagForTests(2_500);
    expect(shed.isOverloaded()).toBe(true); // the 2,000 ms default applies
    shed.__resetLoadShedForTests();
  });
});

describe('client CSRF token cache', () => {
  it('returns null without a token, and assumes a lifetime when the server omits one', async () => {
    const { getCSRFToken, clearCSRFTokenCache } = await import('@/lib/csrf');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({})))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'tok' })));
    vi.stubGlobal('fetch', fetchMock);
    clearCSRFTokenCache();
    expect(await getCSRFToken()).toBeNull();
    expect(await getCSRFToken()).toBe('tok');
    expect(await getCSRFToken()).toBe('tok'); // cached
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getDb', () => {
  it('hands out the cookie-bound server client', async () => {
    const { getDb } = await import('@/lib/supabase/db-modules/shared');
    expect(await getDb()).toEqual({ marker: 'server-client' });
  });
});
