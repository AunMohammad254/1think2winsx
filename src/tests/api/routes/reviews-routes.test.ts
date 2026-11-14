// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { makeRequest, authOk } from '@/tests/helpers/supabase-mock';

const requireAuth = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const getPublicReviews = vi.fn();
const invalidatePublicReviews = vi.fn();
const reviews = { findByUser: vi.fn(), upsertForUser: vi.fn() };

vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { general: 'general', review: 'review' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/review-service', () => ({
  getPublicReviews: () => getPublicReviews(),
  invalidatePublicReviews: () => invalidatePublicReviews(),
}));
vi.mock('@/lib/supabase/db', () => ({ reviewDb: reviews }));

const listRoute = await import('@/app/api/reviews/route');
const mineRoute = await import('@/app/api/reviews/mine/route');

const INPUT = { rating: 5, comment: 'Brilliant quizzes every week!', displayName: 'Areeba K.', city: '' };
const ROW = {
  id: 'r1', userId: 'user-1', rating: 5, comment: INPUT.comment, displayName: 'Areeba K.', city: null, status: 'pending',
  moderationNote: null, moderatedAt: null, moderatedBy: 'boss@example.test', createdAt: '2026-11-06T10:00:00Z', updatedAt: '2026-11-06T10:00:00Z',
};
const OWN = { id: 'r1', rating: 5, comment: INPUT.comment, displayName: 'Areeba K.', city: null, status: 'pending', moderationNote: null, updatedAt: '2026-11-06T10:00:00Z' };

beforeEach(() => {
  for (const fn of [requireAuth, requireCSRFToken, applyRateLimit, getPublicReviews, invalidatePublicReviews, ...Object.values(reviews)]) fn.mockReset();
  requireAuth.mockResolvedValue(authOk());
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/reviews', () => {
  it('returns the approved reviews, cacheable for a minute', async () => {
    const body = { reviews: [{ id: 'r1' }], summary: { count: 1, average: 5 } };
    getPublicReviews.mockResolvedValue(body);
    const res = await listRoute.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    expect(await res.json()).toEqual(body);
  });

  it('reports a failure', async () => {
    getPublicReviews.mockRejectedValue(new Error('down'));
    const res = await listRoute.GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Could not load reviews' });
  });
});

describe('POST /api/reviews', () => {
  const post = (body: unknown = INPUT, raw?: string) =>
    listRoute.POST(makeRequest('/api/reviews', raw === undefined ? { body } : { method: 'POST', rawBody: raw }));

  it("saves the player's review as pending, without who moderated it", async () => {
    reviews.upsertForUser.mockResolvedValue(ROW);
    const res = await post({ ...INPUT, comment: `  ${INPUT.comment} ` });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ review: OWN, message: 'Thanks! Your review will appear once our team has approved it.' });
    expect(reviews.upsertForUser).toHaveBeenCalledWith('user-1', { rating: 5, comment: INPUT.comment, displayName: 'Areeba K.', city: null });
    expect(invalidatePublicReviews).toHaveBeenCalledTimes(1);
    expect(applyRateLimit).toHaveBeenCalledWith('review', expect.anything(), 'user-1', '/api/reviews');
  });

  it('passes the CSRF, auth and rate-limit answers through', async () => {
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post()).status).toBe(403);
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await post()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await post()).status).toBe(429);
    expect(reviews.upsertForUser).not.toHaveBeenCalled();
  });

  it('refuses a broken body and an invalid review', async () => {
    const broken = await post(undefined, '{nope');
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: 'Invalid JSON body' });
    const invalid = await post({ ...INPUT, rating: 0 });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe('Choose a star rating');
    expect(reviews.upsertForUser).not.toHaveBeenCalled();
  });

  it('reports a database failure', async () => {
    reviews.upsertForUser.mockRejectedValue(new Error('down'));
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Could not save your review. Please try again.' });
  });
});

describe('GET /api/reviews/mine', () => {
  const get = () => mineRoute.GET(makeRequest('/api/reviews/mine'));

  it("returns the player's review, or null", async () => {
    reviews.findByUser.mockResolvedValue(ROW);
    expect(await (await get()).json()).toEqual({ review: OWN });
    expect(reviews.findByUser).toHaveBeenCalledWith('user-1');
    reviews.findByUser.mockResolvedValue(null);
    expect(await (await get()).json()).toEqual({ review: null });
  });

  it('passes the auth and rate-limit answers through, and reports a failure', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await get()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await get()).status).toBe(429);
    reviews.findByUser.mockRejectedValue(new Error('down'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Could not load your review' });
  });
});
