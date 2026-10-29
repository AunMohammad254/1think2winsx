// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, routeParams, authOk, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
const getPublicMatch = vi.fn();
const requireAuth = vi.fn();
const applyRateLimit = vi.fn();
vi.mock('@/lib/match-feed', () => ({ getPublicMatch: (...a: unknown[]) => getPublicMatch(...a) }));
vi.mock('@/lib/supabase/db', () => ({ getDb: async () => db.client }));
vi.mock('@/lib/auth-middleware', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { general: 'general' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));

const feedRoute = await import('@/app/api/live/matches/[id]/route');
const answersRoute = await import('@/app/api/quizzes/[id]/answers/route');

beforeEach(() => {
  db = createSupabaseMock();
  getPublicMatch.mockReset();
  requireAuth.mockReset().mockResolvedValue(authOk('user-1'));
  applyRateLimit.mockReset().mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/live/matches/[id]', () => {
  const get = (id = 'm1') => feedRoute.GET(makeRequest(`/api/live/matches/${id}`), routeParams({ id }));

  it("serves the match to anyone, cacheable for 3 s at the edge, with this response's clock", async () => {
    getPublicMatch.mockResolvedValue({ match: { id: 'm1', title: 'Lahore vs Karachi' }, innings: [], questions: [], serverNow: '2026-10-29T12:00:00.000Z' });
    const before = Date.now();
    const res = await get();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=3, stale-while-revalidate=3');
    expect(getPublicMatch).toHaveBeenCalledWith('m1');
    expect(body.match).toEqual({ id: 'm1', title: 'Lahore vs Karachi' });
    // Not the copy's clock: the process keeps a copy for a moment
    expect(Date.parse(body.serverNow)).toBeGreaterThanOrEqual(before);
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it('answers an uncached 404 for a match players can\'t see, and an uncached 503 when it fails', async () => {
    getPublicMatch.mockResolvedValue(null);
    let res = await get('hidden');
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    getPublicMatch.mockRejectedValue(new Error('db down'));
    res = await get();
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Retry-After')).toBe('3');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('GET /api/quizzes/[id]/answers', () => {
  const get = () => answersRoute.GET(makeRequest('/api/quizzes/quiz1/answers'), routeParams({ id: 'quiz1' }));

  it("gives a signed-in player their own answers to the quiz, never cached", async () => {
    db.setTable('QuestionAttempt', { data: [{ questionId: 'q1', selectedOption: 0 }] });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ answers: [{ questionId: 'q1', selectedOption: 0 }] });
    const read = db.callsTo('QuestionAttempt')[0];
    expect(eqValue(read, 'userId')).toBe('user-1');
    expect(eqValue(read, 'quizId')).toBe('quiz1');
    expect(applyRateLimit).toHaveBeenCalledWith('general', expect.anything(), 'user-1', '/api/quizzes/[id]/answers');
    db.setTable('QuestionAttempt', { data: null });
    expect(await (await get()).json()).toEqual({ answers: [] });
  });

  it('passes on sign-in and rate limit refusals, and answers 500 when the read fails', async () => {
    requireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Sign in' }, { status: 401 }));
    expect((await get()).status).toBe(401);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({ error: 'Slow down' }, { status: 429 }));
    expect((await get()).status).toBe(429);
    db.setTable('QuestionAttempt', { error: { message: 'down' } });
    expect((await get()).status).toBe(500);
  });
});
