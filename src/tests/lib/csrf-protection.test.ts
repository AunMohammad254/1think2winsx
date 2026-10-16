// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import * as csrf from '@/lib/csrf-protection';

const TOKEN = 'a'.repeat(32);
function req(method: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://site.example.test/api/thing', { method, headers: { host: 'site.example.test', ...headers } });
}

let logs: Record<'error' | 'warn' | 'info' | 'log', ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  logs = {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('validateCSRFToken', () => {
  it('accepts a well-formed token from the same origin', async () => {
    expect(await csrf.validateCSRFToken(req('POST', { 'x-csrf-token': TOKEN, origin: 'https://site.example.test' }))).toEqual({ isValid: true });
    expect(logs.info).toHaveBeenCalledWith('[SECURITY][TEST]', expect.objectContaining({ type: 'csrf_validation_success', severity: 'info' }));
  });

  it('uses x-forwarded-host behind a proxy and reads the csrf-token header too', async () => {
    const r = req('POST', { 'csrf-token': TOKEN, origin: 'https://public.example.test', 'x-forwarded-host': 'public.example.test' });
    expect(await csrf.validateCSRFToken(r)).toEqual({ isValid: true });
  });

  it('only checks the token SHAPE: any 32+ character URL-safe string passes (it is never compared to an issued token)', async () => {
    const forged = crypto.randomBytes(24).toString('base64url');
    expect(await csrf.validateCSRFToken(req('POST', { 'x-csrf-token': forged }))).toEqual({ isValid: true });
  });

  it('blocks cross-origin and malformed origins', async () => {
    expect(await csrf.validateCSRFToken(req('POST', { 'x-csrf-token': TOKEN, origin: 'https://evil.example' }))).toEqual({ isValid: false, error: 'Cross-origin request blocked' });
    expect((await csrf.validateCSRFToken(req('POST', { 'x-csrf-token': TOKEN, origin: 'not a url' }))).isValid).toBe(false);
    const noHost = new NextRequest('http://site.example.test/x', { method: 'POST', headers: { origin: 'https://site.example.test', 'x-csrf-token': TOKEN } });
    noHost.headers.delete('host');
    expect((await csrf.validateCSRFToken(noHost)).error).toBe('Cross-origin request blocked');
  });

  it('rejects a missing, short or badly-formed token', async () => {
    expect(await csrf.validateCSRFToken(req('POST'))).toEqual({ isValid: false, error: 'CSRF token missing from request headers' });
    expect(await csrf.validateCSRFToken(req('POST', { 'x-csrf-token': 'short' }))).toEqual({ isValid: false, error: 'Invalid CSRF token format' });
    expect(await csrf.validateCSRFToken(req('POST', { 'x-csrf-token': `${TOKEN}!` }))).toEqual({ isValid: false, error: 'CSRF token does not match expected pattern' });
    expect(logs.error).toHaveBeenCalledWith('[SECURITY][TEST]', expect.objectContaining({ type: 'csrf_token_missing', severity: 'error' }));
  });

  it('logs the client IP and user agent but never raw headers', async () => {
    await csrf.validateCSRFToken(req('POST', { 'x-real-ip': '9.9.9.9', 'user-agent': 'UA', cookie: 'sb=secret' }));
    const entry = logs.error.mock.calls[0][1] as Record<string, unknown>;
    expect(entry).toMatchObject({ ip: '9.9.9.9', userAgent: 'UA', details: { method: 'POST' } });
    expect(JSON.stringify(entry)).not.toContain('secret');
  });

  it('fails closed when header access throws', async () => {
    const broken = req('POST', { 'x-csrf-token': TOKEN });
    const get = broken.headers.get.bind(broken.headers);
    let calls = 0;
    vi.spyOn(broken.headers, 'get').mockImplementation((name: string) => {
      if (name === 'origin' && ++calls === 1) throw new Error('header boom');
      return get(name);
    });
    expect(await csrf.validateCSRFToken(broken)).toEqual({ isValid: false, error: 'CSRF validation failed due to server error' });
    vi.spyOn(broken.headers, 'get').mockImplementation((name: string) => {
      if (name === 'origin') throw 'not an error';
      return get(name);
    });
    expect((await csrf.validateCSRFToken(broken)).isValid).toBe(false);
  });

  it('stays quiet about successes in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await csrf.validateCSRFToken(req('POST', { 'x-csrf-token': TOKEN }));
    expect(logs.info).not.toHaveBeenCalled();
    await csrf.validateCSRFToken(req('POST'));
    expect(logs.error).toHaveBeenCalledWith('[SECURITY][PRODUCTION]', expect.anything());
    vi.stubEnv('NODE_ENV', '');
    await csrf.validateCSRFToken(req('POST'));
    expect(logs.error).toHaveBeenLastCalledWith('[SECURITY][DEVELOPMENT]', expect.anything());
  });
});

describe('requireCSRFToken', () => {
  it('ignores safe methods', async () => {
    expect(await csrf.requireCSRFToken(req('GET'))).toBeNull();
  });

  it('passes valid mutations and answers 403 with security headers otherwise', async () => {
    expect(await csrf.requireCSRFToken(req('DELETE', { 'x-csrf-token': TOKEN }))).toBeNull();
    const res = (await csrf.requireCSRFToken(req('PATCH')))!;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'CSRF validation failed', message: 'CSRF token missing from request headers' });
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

describe('requireCSRFTokenForPages (legacy pages-router wrapper)', () => {
  const makeRes = () => {
    const json = vi.fn();
    return { res: { status: vi.fn(() => ({ json })), setHeader: vi.fn() }, json };
  };

  it('requires a token for mutations and sets security headers', async () => {
    const handler = vi.fn();
    const wrapped = csrf.requireCSRFTokenForPages(handler);

    const missing = makeRes();
    await wrapped({ method: 'POST', headers: {} }, missing.res);
    expect(missing.res.status).toHaveBeenCalledWith(403);
    expect(missing.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'CSRF token required' }));

    const bad = makeRes();
    await wrapped({ method: 'POST', headers: { 'x-csrf-token': 'short' } }, bad.res);
    expect(bad.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid CSRF token format' }));

    const pattern = makeRes();
    await wrapped({ method: 'PUT', headers: { 'csrf-token': `${TOKEN}$` } }, pattern.res);
    expect(pattern.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'CSRF token does not match expected pattern' }));

    const ok = makeRes();
    await wrapped({ method: 'DELETE', headers: { 'x-csrf-token': TOKEN, 'x-forwarded-for': '1.1.1.1' } }, ok.res);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ok.res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');

    const get = makeRes();
    await wrapped({ headers: {} }, get.res);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('accepts the token from the body only for the presence check (the validator reads headers)', async () => {
    const handler = vi.fn();
    const { res, json } = makeRes();
    await csrf.requireCSRFTokenForPages(handler)({ method: 'POST', headers: { 'x-real-ip': '2.2.2.2' }, body: { csrfToken: TOKEN } }, res);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'CSRF token missing from request headers' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('reads the IP from the socket when there are no proxy headers, and reports validator failures', async () => {
    const spy = vi.spyOn(csrf.SecurityLogger.prototype, 'logSecurityEvent');
    const { res } = makeRes();
    const request = { method: 'POST', headers: { 'X-CSRF-Token': TOKEN }, connection: { remoteAddress: '3.3.3.3' } } as never;
    await csrf.requireCSRFTokenForPages(vi.fn())(request, res);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ ip: '3.3.3.3' }));

    // the validator's success log throws, so it lands in its catch and reports a server error
    spy.mockImplementationOnce(() => { throw new Error('boom'); }).mockImplementationOnce(() => {});
    const failing = makeRes();
    await csrf.requireCSRFTokenForPages(vi.fn())({ method: 'POST', headers: { 'x-csrf-token': TOKEN }, ip: '4.4.4.4' } as never, failing.res);
    expect(failing.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'CSRF validation failed due to server error' }));
    spy.mockImplementationOnce(() => { throw 'odd'; }).mockImplementationOnce(() => {});
    const odd = makeRes();
    await csrf.requireCSRFTokenForPages(vi.fn())({ method: 'POST', headers: { 'x-csrf-token': TOKEN } }, odd.res);
    expect(odd.res.status).toHaveBeenCalledWith(403);
  });
});

describe('token generation and environment headers', () => {
  it('generates 43-character base64url tokens that pass validation', async () => {
    const token = csrf.generateCSRFToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrf.generateCSRFToken()).not.toBe(token);
    expect(await csrf.validateCSRFToken(req('POST', { 'x-csrf-token': token }))).toEqual({ isValid: true });
  });

  it('throws when the random source fails or produces an unusable token', () => {
    const spy = vi.spyOn(crypto, 'randomBytes');
    spy.mockImplementationOnce(() => Buffer.alloc(4) as never);
    expect(() => csrf.generateCSRFToken()).toThrow('Failed to generate CSRF token');
    spy.mockImplementationOnce(() => { throw 'no entropy'; });
    expect(() => csrf.generateCSRFToken()).toThrow('Failed to generate CSRF token');
    spy.mockRestore();
  });

  it('picks environment headers, defaulting to development', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => void (headers[k] = v) };
    vi.stubEnv('NODE_ENV', 'production');
    csrf.applyEnvironmentSecurityHeaders(res);
    expect(headers).toMatchObject({ 'X-Environment': 'production', 'X-Frame-Options': 'DENY' });
    vi.stubEnv('NODE_ENV', 'staging');
    expect(csrf.getEnvironmentConfig()).toBe(csrf.EnvironmentConfig.development);
    vi.stubEnv('NODE_ENV', '');
    expect(csrf.getEnvironmentConfig()).toBe(csrf.EnvironmentConfig.development);
  });

  it('routes warnings and unknown event types to the right console level', () => {
    const logger = csrf.SecurityLogger.getInstance();
    expect(csrf.SecurityLogger.getInstance()).toBe(logger);
    logger.logSecurityEvent({ type: csrf.SecurityEventType.VERCEL_COMPATIBILITY_BYPASS, environment: 'test', timestamp: 't' });
    expect(logs.warn).toHaveBeenCalled();
    logger.logSecurityEvent({ type: csrf.SecurityEventType.CSRF_TOKEN_GENERATED, environment: 'test', timestamp: 't' });
    expect(logs.info).toHaveBeenCalledWith('[SECURITY][TEST]', expect.objectContaining({ severity: 'info' }));
  });
});

describe('GET /api/csrf-token', () => {
  it('issues a token valid for an hour', async () => {
    const { GET } = await import('@/app/api/csrf-token/route');
    const body = await (await GET(req('GET'))).json();
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.expiresAt - Date.now()).toBeGreaterThan(59 * 60_000);
  });

  it('answers 500 if generation fails', async () => {
    const { GET } = await import('@/app/api/csrf-token/route');
    const spy = vi.spyOn(crypto, 'randomBytes').mockImplementationOnce(() => { throw new Error('x'); });
    expect((await GET(req('GET'))).status).toBe(500);
    spy.mockRestore();
  });
});

describe('environment label', () => {
  it('logs as "development" when NODE_ENV is empty', async () => {
    vi.stubEnv('NODE_ENV', '');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    csrf.generateCSRFToken();
    expect(info).toHaveBeenCalledWith('[SECURITY][DEVELOPMENT]', expect.anything());
    const json = vi.fn();
    await csrf.requireCSRFTokenForPages(vi.fn())({ method: 'POST', headers: { 'x-csrf-token': 'short' } }, { status: vi.fn(() => ({ json })), setHeader: vi.fn() });
    expect(error).toHaveBeenCalledWith('[SECURITY][DEVELOPMENT]', expect.anything());
    vi.unstubAllEnvs();
  });
});
