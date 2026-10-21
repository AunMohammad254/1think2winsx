// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { makeRequest, authOk } from '@/tests/helpers/supabase-mock';

const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { admin: 'admin-limiter' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));

const { adminApiGuard } = await import('@/lib/admin-api-guard');

beforeEach(() => {
  for (const fn of [requireAuth, requireCSRFToken, applyRateLimit]) fn.mockReset();
  requireCSRFToken.mockResolvedValue(null);
  requireAuth.mockResolvedValue(authOk('admin-user', 'admin@1think2win.com'));
  applyRateLimit.mockResolvedValue(null);
});

describe('adminApiGuard', () => {
  const req = () => makeRequest('/api/admin/x', { method: 'POST', body: {} });

  it('lets an admin through, rate-limited per admin', async () => {
    expect(await adminApiGuard(req(), '/api/admin/x', { write: true })).toEqual({ id: 'admin-user', email: 'admin@1think2win.com' });
    expect(requireAuth).toHaveBeenCalledWith({ adminOnly: true });
    expect(applyRateLimit).toHaveBeenCalledWith('admin-limiter', expect.anything(), 'admin-user', '/api/admin/x');
  });

  it('checks CSRF on writes only', async () => {
    await adminApiGuard(req(), '/api/admin/x', { write: false });
    expect(requireCSRFToken).not.toHaveBeenCalled();
    const refused = NextResponse.json({}, { status: 403 });
    requireCSRFToken.mockResolvedValue(refused);
    expect(await adminApiGuard(req(), '/api/admin/x', { write: true })).toBe(refused);
    expect(requireAuth).toHaveBeenCalledTimes(1);
  });

  it('returns the refusal of a missing admin or a rate limit', async () => {
    const unauth = NextResponse.json({}, { status: 401 });
    requireAuth.mockResolvedValueOnce(unauth);
    expect(await adminApiGuard(req(), '/api/admin/x', { write: false })).toBe(unauth);
    const limited = new Response(null, { status: 429 });
    applyRateLimit.mockResolvedValueOnce(limited);
    expect(await adminApiGuard(req(), '/api/admin/x', { write: false })).toBe(limited);
  });

  it('falls back to the id when the session has no email', async () => {
    requireAuth.mockResolvedValue({ session: { user: { id: 'admin-user' } } });
    expect(await adminApiGuard(req(), '/api/admin/x', { write: false })).toEqual({ id: 'admin-user', email: 'admin-user' });
  });
});
