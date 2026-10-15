// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const logRateLimitExceeded = vi.fn();
vi.mock('@/lib/security-logger', () => ({ securityLogger: { logRateLimitExceeded: (...a: unknown[]) => logRateLimitExceeded(...a) } }));

let rl: typeof import('@/lib/rate-limiter');
let n = 0;
const uniqueUser = () => `user-${Date.now()}-${++n}`;
const req = (ip = '1.2.3.4') => new NextRequest('http://localhost/api/x', { headers: { 'x-forwarded-for': ip } });

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubEnv('KV_REST_API_URL', '');
  vi.stubEnv('KV_REST_API_TOKEN', '');
  rl = await import('@/lib/rate-limiter');
  logRateLimitExceeded.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('in-memory limiter', () => {
  it('allows up to the limit in a window, then refuses and logs', async () => {
    const limiter = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 3 }, 'test');
    const user = uniqueUser();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.checkLimit(req(), user, '/api/x'));
    expect(results.map((r) => [r.success, r.remaining])).toEqual([[true, 2], [true, 1], [true, 0], [false, 0]]);
    expect(results[3]).toMatchObject({ limit: 3, error: 'Rate limit exceeded' });
    expect(logRateLimitExceeded).toHaveBeenCalledWith(user, '/api/x', expect.anything());
    expect(limiter.maxRequests).toBe(3);
    expect(limiter.windowMs).toBe(60_000);
  });

  it('does not log without an endpoint, and starts a new window after it expires', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const limiter = new rl.RateLimiter({ windowMs: 1000, maxRequests: 1 });
    const user = uniqueUser();
    await limiter.checkLimit(req(), user);
    expect((await limiter.checkLimit(req(), user)).success).toBe(false);
    expect(logRateLimitExceeded).not.toHaveBeenCalled();
    clock.mockReturnValue(now + 1001);
    expect((await limiter.checkLimit(req(), user)).success).toBe(true);
  });

  it('keys by user id when given, otherwise by client IP, and namespaces by limiter', async () => {
    const a = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 1 }, 'a-' + uniqueUser());
    const b = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 1 }, 'b-' + uniqueUser());
    expect((await a.checkLimit(req('9.9.9.1'))).success).toBe(true);
    expect((await a.checkLimit(req('9.9.9.1'))).success).toBe(false);
    expect((await a.checkLimit(req('9.9.9.2'))).success).toBe(true);
    expect((await b.checkLimit(req('9.9.9.1'))).success).toBe(true);
  });

  it('uses a custom key generator and fails open if it throws', async () => {
    const limiter = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 5, keyGenerator: () => { throw new Error('bad key'); } });
    expect(await limiter.checkLimit(req())).toMatchObject({ success: true, remaining: 4 });
    expect(console.error).toHaveBeenCalledWith('Rate limiter error:', expect.any(Error));
  });

  it('evicts expired windows once the store is full', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const limiter = new rl.RateLimiter({ windowMs: 5, maxRequests: 1 }, 'evict');
    const r = req();
    for (let i = 0; i < 100_000; i++) await limiter.checkLimit(r, `k${i}`);
    clock.mockReturnValue(now + 10);
    // the 100,001st key triggers eviction of every expired window
    expect((await limiter.checkLimit(r, 'fresh')).success).toBe(true);
    // an evicted key starts again from zero
    expect((await limiter.checkLimit(r, 'k0')).success).toBe(true);
  }, 30_000);

  it('drops the oldest live window when the store overflows', async () => {
    const limiter = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 1 }, 'overflow');
    const r = req();
    for (let i = 0; i <= 100_000; i++) await limiter.checkLimit(r, `live${i}`);
    // live0 was evicted to make room, so it is allowed again; live1 is still counted
    expect((await limiter.checkLimit(r, 'live0')).success).toBe(true);
    expect((await limiter.checkLimit(r, 'live2')).success).toBe(false);
  }, 30_000);
});

describe('Upstash Redis limiter', () => {
  const fetchMock = vi.fn();
  beforeEach(async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  const redisReply = (count: number, ttl: number) => new Response(JSON.stringify([{ result: 'OK' }, { result: count }, { result: ttl }]));

  it('counts in one pipeline call (SET NX, INCR, PTTL) with the bearer token', async () => {
    fetchMock.mockResolvedValue(redisReply(2, 30_000));
    const limiter = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 5 }, 'redis');
    const res = await limiter.checkLimit(req(), 'u1');
    expect(res).toMatchObject({ success: true, remaining: 3 });
    expect(res.resetTime - Date.now()).toBeGreaterThan(29_000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://redis.example/pipeline');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(JSON.parse(init.body)).toEqual([
      ['SET', 'rl:redis:u1', '0', 'PX', '60000', 'NX'],
      ['INCR', 'rl:redis:u1'],
      ['PTTL', 'rl:redis:u1'],
    ]);
  });

  it('refuses over the limit and treats a missing TTL as a full window', async () => {
    fetchMock.mockResolvedValue(redisReply(6, -1));
    const limiter = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const res = await limiter.checkLimit(req(), 'u1');
    expect(res.success).toBe(false);
    expect(res.resetTime - Date.now()).toBeGreaterThan(59_000);
    fetchMock.mockResolvedValue(redisReply(1, -2));
    expect((await limiter.checkLimit(req(), 'u1')).success).toBe(true);
    fetchMock.mockResolvedValue(redisReply(1, 0));
    expect((await limiter.checkLimit(req(), 'u1')).resetTime - Date.now()).toBeGreaterThan(59_000);
  });

  it('reads the Vercel KV variable names too', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv');
    fetchMock.mockResolvedValue(redisReply(1, 1000));
    await new rl.RateLimiter({ windowMs: 1000, maxRequests: 1 }).checkLimit(req(), 'u');
    expect(fetchMock.mock.calls[0][0]).toBe('https://kv.example/pipeline');
  });

  it('falls back to the in-process counter when Redis is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const limiter = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 1 }, 'fallback');
    const user = uniqueUser();
    expect((await limiter.checkLimit(req(), user)).success).toBe(true);
    expect((await limiter.checkLimit(req(), user)).success).toBe(false);
  });

  it('aborts a Redis call that takes longer than 1.5 s', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
    const pending = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 1 }, 'slow').checkLimit(req(), uniqueUser());
    await vi.advanceTimersByTimeAsync(1500);
    expect((await pending).success).toBe(true);
    vi.useRealTimers();
  });

  it('FAILS OPEN when Redis answers with an error body (e.g. a bad token): every request counts as 1', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'WRONGPASS invalid password' }), { status: 401 }));
    const limiter = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 1 }, 'wrongpass');
    const user = uniqueUser();
    for (let i = 0; i < 5; i++) expect((await limiter.checkLimit(req(), user)).success).toBe(true);
  });
});

describe('applyRateLimit and the preset limiters', () => {
  it('returns null under the limit and a 429 with retry headers over it', async () => {
    const limiter = new rl.RateLimiter({ windowMs: 60_000, maxRequests: 1 }, 'apply');
    const user = uniqueUser();
    expect(await rl.applyRateLimit(limiter, req(), user, '/api/x')).toBeNull();
    const res = (await rl.applyRateLimit(limiter, req(), user, '/api/x'))!;
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Rate limit exceeded', message: 'Too many requests. Please try again later.' });
    expect(body.retryAfter).toBeGreaterThan(55);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(55);
  });

  it.each([
    ['auth', 10, 15 * 60_000],
    ['profile', 30, 3_600_000],
    ['admin', 1000, 3_600_000],
    ['fileUpload', 20, 3_600_000],
    ['general', 60, 60_000],
    ['shareCard', 240, 60_000],
    ['prizeRedemption', 5, 3_600_000],
    ['quiz', 10, 5 * 60_000],
    ['passwordChange', 5, 15 * 60_000],
    ['deposit', 5, 3_600_000],
    ['emailReminder', 2, 3_600_000],
    ['newsletter', 5, 3_600_000],
  ] as const)('%s allows %i requests per %i ms', (name, max, windowMs) => {
    expect(rl.rateLimiters[name].maxRequests).toBe(max);
    expect(rl.rateLimiters[name].windowMs).toBe(windowMs);
  });
});
