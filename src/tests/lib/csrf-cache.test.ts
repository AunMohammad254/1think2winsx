// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tokenResponse = (token: string, expiresAt: number) =>
  new Response(JSON.stringify({ csrfToken: token, expiresAt }), { status: 200 });

let csrf: typeof import('@/lib/csrf');

beforeEach(async () => {
  vi.resetModules(); // fresh module-level cache per test
  csrf = await import('@/lib/csrf');
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('client CSRF token cache', () => {
  it('fetches once and reuses the token for every later mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse('tok-1', Date.now() + 3_600_000));
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < 20; i++) expect(await csrf.getCSRFToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse('tok-1', Date.now() + 3_600_000));
    vi.stubGlobal('fetch', fetchMock);
    const tokens = await Promise.all(Array.from({ length: 10 }, () => csrf.getCSRFToken()));
    expect(new Set(tokens)).toEqual(new Set(['tok-1']));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes shortly before the token expires', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse('tok-1', Date.now() + 3_600_000))
      .mockResolvedValueOnce(tokenResponse('tok-2', Date.now() + 7_200_000));
    vi.stubGlobal('fetch', fetchMock);
    expect(await csrf.getCSRFToken()).toBe('tok-1');
    vi.setSystemTime(Date.now() + 3_600_000 - 60_000); // inside the 5 min safety margin
    expect(await csrf.getCSRFToken()).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null (and does not cache) when the endpoint fails, then recovers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(tokenResponse('tok-ok', Date.now() + 3_600_000));
    vi.stubGlobal('fetch', fetchMock);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await csrf.getCSRFToken()).toBeNull();
    expect(await csrf.getCSRFToken()).toBe('tok-ok');
    spy.mockRestore();
  });

  it('getCSRFHeaders returns the header shape callers spread into fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse('tok-h', Date.now() + 3_600_000)));
    expect(await csrf.getCSRFHeaders()).toEqual({ 'x-csrf-token': 'tok-h' });
  });
});
