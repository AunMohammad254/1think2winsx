// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, routeParams } from '@/tests/helpers/supabase-mock';

const getPublicMatch = vi.fn();
vi.mock('@/lib/match-feed', () => ({ getPublicMatch: (...a: unknown[]) => getPublicMatch(...a) }));

const feedRoute = await import('@/app/api/live/matches/[id]/route');

beforeEach(() => {
  getPublicMatch.mockReset();
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
  });

  it('answers a 404 kept 10 s at the edge for a match players can\'t see, and an uncached 503 when it fails', async () => {
    getPublicMatch.mockResolvedValue(null);
    let res = await get('hidden');
    expect(res.status).toBe(404);
    // Screens left open on it, or a link shared before Go live, mustn't reach Hostinger on every poll
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=10');
    getPublicMatch.mockRejectedValue(new Error('db down'));
    res = await get();
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Retry-After')).toBe('3');
    expect(console.error).toHaveBeenCalled();
  });
});
