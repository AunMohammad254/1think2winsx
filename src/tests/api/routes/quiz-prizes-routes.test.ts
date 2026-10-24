// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { makeRequest, routeParams, authOk } from '@/tests/helpers/supabase-mock';

const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const recordSecurityEvent = vi.fn();
const listQuizPrizes = vi.fn();
const claimQuizPrize = vi.fn();

vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { general: 'general', prizeRedemption: 'prizeRedemption' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: (...a: unknown[]) => recordSecurityEvent(...a) }));
vi.mock('@/lib/quiz-prizes', () => ({
  listQuizPrizes: (...a: unknown[]) => listQuizPrizes(...a),
  claimQuizPrize: (...a: unknown[]) => claimQuizPrize(...a),
}));

const listRoute = await import('@/app/api/quiz-prizes/route');
const claimRoute = await import('@/app/api/quiz-prizes/[id]/claim/route');

const DETAILS = { fullName: 'Ali Raza', whatsappNumber: '+92 300 1234567', address: 'House 12, Street 4, Lahore' };

beforeEach(() => {
  for (const fn of [requireAuth, requireCSRFToken, applyRateLimit, recordSecurityEvent, listQuizPrizes, claimQuizPrize]) fn.mockReset();
  requireAuth.mockResolvedValue(authOk());
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/quiz-prizes', () => {
  const get = () => listRoute.GET(makeRequest('/api/quiz-prizes'));

  it("returns the signed-in player's prizes", async () => {
    listQuizPrizes.mockResolvedValue([{ winnerId: 'w1' }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prizes: [{ winnerId: 'w1' }] });
    expect(listQuizPrizes).toHaveBeenCalledWith('user-1');
    expect(applyRateLimit).toHaveBeenCalledWith('general', expect.anything(), 'user-1', '/api/quiz-prizes');
  });

  it('passes the auth and rate-limit answers through, and reports a failure', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await get()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await get()).status).toBe(429);
    listQuizPrizes.mockRejectedValue(new Error('down'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load your prizes' });
  });
});

describe('POST /api/quiz-prizes/[id]/claim', () => {
  const post = (body: unknown = DETAILS, raw?: string) =>
    claimRoute.POST(makeRequest('/api/quiz-prizes/w1/claim', raw === undefined ? { body } : { method: 'POST', rawBody: raw }), routeParams({ id: 'w1' }));

  it('saves the trimmed details for the signed-in player', async () => {
    claimQuizPrize.mockResolvedValue({ ok: true, claimId: 'pr_1' });
    const res = await post({ ...DETAILS, fullName: '  Ali Raza ' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ claimId: 'pr_1', message: 'Thanks! We have your delivery details and will be in touch on WhatsApp.' });
    expect(claimQuizPrize).toHaveBeenCalledWith('w1', 'user-1', DETAILS);
  });

  it('relays a refusal with its status and code', async () => {
    claimQuizPrize.mockResolvedValue({ ok: false, status: 409, code: 'already_claimed', error: 'Already with us' });
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Already with us', code: 'already_claimed' });
  });

  it('checks the details before calling the database', async () => {
    for (const bad of [{ fullName: 'A' }, { whatsappNumber: '123' }, { address: 'Lahore' }, { address: undefined }]) {
      const res = await post({ ...DETAILS, ...bad });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toEqual(expect.any(String));
    }
    expect((await post(undefined, '{not json')).status).toBe(400);
    expect(claimQuizPrize).not.toHaveBeenCalled();
  });

  it('passes CSRF, auth and rate-limit answers through, logging a rate limit', async () => {
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post()).status).toBe(403);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await post()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await post()).status).toBe(429);
    expect(recordSecurityEvent).toHaveBeenCalledWith('RATE_LIMIT_EXCEEDED', expect.anything(), 'user-1', { endpoint: '/api/quiz-prizes/[id]/claim', rateLimiter: 'prizeRedemption' });
    expect(applyRateLimit).toHaveBeenCalledWith('prizeRedemption', expect.anything(), 'user-1', '/api/quiz-prizes/[id]/claim');
  });

  it('reports a database failure', async () => {
    claimQuizPrize.mockRejectedValue(new Error('down'));
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Could not save your delivery details. Please try again.' });
  });
});
