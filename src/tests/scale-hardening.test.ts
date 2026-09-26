import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { RateLimiter } from '@/lib/rate-limiter';
import { securityMonitor, recordSecurityEvent } from '@/lib/security-monitoring';
import { validateCSRFToken } from '@/lib/csrf-protection';

vi.mock('@/lib/supabase/db', () => ({}));

const req = (headers: Record<string, string> = {}, method = 'POST') =>
  new NextRequest('http://app.test/api/x', { method, headers: { host: 'app.test', ...headers } });

describe('RateLimiter (in-memory, no DB)', () => {
  it('allows up to maxRequests then blocks, per key', async () => {
    const rl = new RateLimiter({ windowMs: 60_000, maxRequests: 3 }, 'test-a');
    for (let i = 0; i < 3; i++) expect((await rl.checkLimit(req(), 'u1')).success).toBe(true);
    expect((await rl.checkLimit(req(), 'u1')).success).toBe(false);
    expect((await rl.checkLimit(req(), 'u2')).success).toBe(true);
  });

  it('namespaces counters per limiter', async () => {
    const a = new RateLimiter({ windowMs: 60_000, maxRequests: 1 }, 'ns-a');
    const b = new RateLimiter({ windowMs: 60_000, maxRequests: 1 }, 'ns-b');
    expect((await a.checkLimit(req(), 'same')).success).toBe(true);
    expect((await b.checkLimit(req(), 'same')).success).toBe(true);
  });

  it('resets after the window', async () => {
    vi.useFakeTimers();
    const rl = new RateLimiter({ windowMs: 1_000, maxRequests: 1 }, 'test-reset');
    expect((await rl.checkLimit(req(), 'u')).success).toBe(true);
    expect((await rl.checkLimit(req(), 'u')).success).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect((await rl.checkLimit(req(), 'u')).success).toBe(true);
    vi.useRealTimers();
  });
});

describe('SecurityMonitor stays O(1) and bounded', () => {
  it('records 50k events quickly and keeps stats bounded', () => {
    // Build requests up front so the timer measures the monitor, not NextRequest construction
    const reqs = Array.from({ length: 250 }, (_, i) => req({ 'x-forwarded-for': `10.0.${i}.1` }, 'GET'));
    const t = performance.now();
    for (let i = 0; i < 50_000; i++) {
      recordSecurityEvent('QUIZ_ACCESSED', reqs[i % 250], `user-${i % 5000}`);
    }
    expect(performance.now() - t).toBeLessThan(3_000);
    expect(securityMonitor.getSecurityStats().totalEvents).toBeLessThanOrEqual(2_000);
  });

  it('flags brute force by IP', () => {
    for (let i = 0; i < 25; i++) recordSecurityEvent('FAILED_LOGIN', req({ 'x-forwarded-for': '9.9.9.9' }));
    expect(securityMonitor.shouldBlockIP('9.9.9.9')).toBe(true);
    expect(securityMonitor.shouldBlockIP('8.8.8.8')).toBe(false);
  });
});

describe('CSRF validation', () => {
  const token = 'a'.repeat(43);
  const cookie = 'sb-proj-auth-token=x';
  it('rejects cross-origin requests', async () => {
    const r = await validateCSRFToken(req({ 'x-csrf-token': token, origin: 'https://evil.example', cookie }));
    expect(r.isValid).toBe(false);
  });
  it('accepts same-origin requests with token and session', async () => {
    const r = await validateCSRFToken(req({ 'x-csrf-token': token, origin: 'http://app.test', cookie }));
    expect(r.isValid).toBe(true);
  });
  it('rejects missing token', async () => {
    const r = await validateCSRFToken(req({ origin: 'http://app.test', cookie }));
    expect(r.isValid).toBe(false);
  });
});
