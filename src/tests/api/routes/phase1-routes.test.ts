// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Shared fakes ──────────────────────────────────────────────────────────────
const rpc = vi.fn();
const fromSpy = vi.fn();
const healthCheck = vi.fn();

vi.mock('@/lib/supabase/db', () => ({
  getAdminDb: () => ({ rpc, from: fromSpy }),
  userDb: {},
  quizDb: {},
}));
vi.mock('@/lib/transaction-manager', () => ({ TransactionManager: { healthCheck: (...a: unknown[]) => healthCheck(...a) } }));

const streamResult = {
  data: { success: true, isActive: true, embedHtml: '<iframe src="https://www.youtube.com/embed/x"></iframe>', title: 'Live' },
  error: null,
};

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CRON_SECRET;
});

// ── /api/streaming/active ─────────────────────────────────────────────────────
describe('GET /api/streaming/active', () => {
  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
    fromSpy.mockReset();
  });

  it('answers N concurrent cache misses with ONE rpc call (single-flight)', async () => {
    rpc.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(streamResult), 30)));
    const { GET } = await import('@/app/api/streaming/active/route');
    const responses = await Promise.all(Array.from({ length: 300 }, () => GET()));
    expect(rpc).toHaveBeenCalledTimes(1);
    for (const r of responses) expect((await r.json()).hasActiveStream).toBe(true);
  });

  it('serves from cache within the TTL', async () => {
    rpc.mockResolvedValue(streamResult);
    const { GET } = await import('@/app/api/streaming/active/route');
    await GET();
    await GET();
    await GET();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('is cacheable by shared caches (identical for every viewer)', async () => {
    rpc.mockResolvedValue(streamResult);
    const { GET } = await import('@/app/api/streaming/active/route');
    const cc = (await GET()).headers.get('cache-control') || '';
    expect(cc).toContain('public');
    expect(cc).toContain('s-maxage=5');
    expect(cc).not.toContain('no-store');
  });

  it('keeps showing a live stream through a database blip (stale-while-revalidate)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    rpc.mockResolvedValueOnce(streamResult);
    const { GET } = await import('@/app/api/streaming/active/route');
    expect((await (await GET()).json()).hasActiveStream).toBe(true);

    vi.setSystemTime(Date.now() + 10_000); // TTL expired
    rpc.mockResolvedValue({ data: null, error: new Error('db down') });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await (await GET()).json()).hasActiveStream).toBe(true); // stale value, no flicker
    spy.mockRestore();
  });

  it('reports no stream when nothing was ever cached and the database is down', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('db down') });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('@/app/api/streaming/active/route');
    expect((await (await GET()).json()).hasActiveStream).toBe(false);
    spy.mockRestore();
  });

  it('reports no stream when the admin has it switched off', async () => {
    rpc.mockResolvedValue({ data: { success: true, isActive: false }, error: null });
    const { GET } = await import('@/app/api/streaming/active/route');
    expect((await (await GET()).json()).hasActiveStream).toBe(false);
  });
});

// ── /api/health ───────────────────────────────────────────────────────────────
describe('GET /api/health', () => {
  const req = (query = '', headers: Record<string, string> = {}) =>
    new NextRequest(`http://app.test/api/health${query}`, { headers });

  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
    fromSpy.mockReset();
    healthCheck.mockReset();
  });

  it('is a database-free liveness probe by default and exposes nothing sensitive', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', timestamp: expect.any(String) });
    expect(fromSpy).not.toHaveBeenCalled();
    expect(healthCheck).not.toHaveBeenCalled();
  });

  it('refuses stats and deep checks without the secret', async () => {
    process.env.CRON_SECRET = 's3cret';
    const { GET } = await import('@/app/api/health/route');
    expect((await GET(req('?stats=1'))).status).toBe(401);
    expect((await GET(req('?deep=1'))).status).toBe(401);
    expect((await GET(req('?stats=1', { authorization: 'Bearer wrong' }))).status).toBe(401);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('refuses everything privileged when CRON_SECRET is not configured', async () => {
    const { GET } = await import('@/app/api/health/route');
    expect((await GET(req('?stats=1', { authorization: 'Bearer undefined' }))).status).toBe(401);
  });

  it('returns process stats (event-loop lag, in-flight, memory) with the secret, still without touching the DB', async () => {
    process.env.CRON_SECRET = 's3cret';
    const { GET } = await import('@/app/api/health/route');
    const res = await GET(req('?stats=1', { authorization: 'Bearer s3cret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.load).toMatchObject({
      inflight: expect.any(Number),
      eventLoopLagP99Ms: expect.any(Number),
      rssMb: expect.any(Number),
      heapUsedMb: expect.any(Number),
    });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('?stats=1 also reports which IP headers the server received (to choose TRUSTED_* settings)', async () => {
    process.env.CRON_SECRET = 's3cret';
    const { GET } = await import('@/app/api/health/route');
    const res = await GET(req('?stats=1', { authorization: 'Bearer s3cret', 'x-forwarded-for': '9.9.9.9, 203.0.113.9' }));
    const body = await res.json();
    expect(body.client.received['x-forwarded-for']).toBe('9.9.9.9, 203.0.113.9');
    expect(body.client.resolvedIp).toBe('9.9.9.9'); // legacy leftmost behaviour while nothing is configured
    expect(body.client.settings).toEqual({ TRUSTED_PROXY_HOPS: null, TRUSTED_IP_HEADER: null });
    // the secret itself must never be echoed back
    expect(JSON.stringify(body)).not.toContain('s3cret');
  });

  it('runs the database checks only for ?deep=1 with the secret', async () => {
    process.env.CRON_SECRET = 's3cret';
    healthCheck.mockResolvedValue({ status: 'healthy', details: {} });
    fromSpy.mockReturnValue({ select: () => ({ limit: async () => ({ error: null }) }) });
    const { GET } = await import('@/app/api/health/route');
    const res = await GET(req('?deep=1', { authorization: 'Bearer s3cret' }));
    expect(res.status).toBe(200);
    expect(fromSpy).toHaveBeenCalledTimes(1); // one cheap read; the old count(*) over User is gone
    const body = await res.json();
    expect(body.components.database.status).toBe('healthy');
    // config is reported as set/unset, never echoed
    expect(JSON.stringify(body.components.authentication)).not.toMatch(/https?:\/\//);
  });
});
