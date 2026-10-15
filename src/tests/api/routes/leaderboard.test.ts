// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const applyRateLimit = vi.fn();
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { general: 'general' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));

let GET: typeof import('@/app/api/leaderboard/route').GET;
const rows = [{ id: 'u1', userName: 'Ali', profilePicture: null, totalScore: 300, quizzesTaken: 4, averageScore: 75 }, { id: 'u2', userName: null, totalScore: 10 }];
const get = (qs = '') => GET(makeRequest(`/api/leaderboard${qs}`));

beforeEach(async () => {
  vi.resetModules();
  ({ GET } = await import('@/app/api/leaderboard/route')); // fresh cache per test
  adminDb = createSupabaseMock({ rpc: { get_leaderboard: { data: rows } } });
  applyRateLimit.mockReset().mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/leaderboard', () => {
  it('returns the ranked players with public cache headers', async () => {
    const res = await get('?limit=5&timeframe=weekly');
    const body = await res.json();
    expect(adminDb.rpcCalls[0]).toEqual({ fn: 'get_leaderboard', args: { p_timeframe: 'weekly', p_limit: 5, p_quiz_id: null } });
    expect(body.users[0]).toMatchObject({ id: 'u1', username: 'Ali', totalScore: 300, quizCount: 4, averageScore: 75 });
    expect(body.users[1].username).toBe('');
    expect(body).toMatchObject({ total: 2, timeframe: 'weekly', leaderboard: rows });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30, s-maxage=60, stale-while-revalidate=300');
  });

  it('serves repeat requests from the one-minute cache', async () => {
    await get();
    await get();
    expect(adminDb.rpcCalls).toHaveLength(1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    await get();
    expect(adminDb.rpcCalls).toHaveLength(2);
    clock.mockRestore();
  });

  it('shares one database call between concurrent cache misses', async () => {
    await Promise.all([get(), get(), get()]);
    expect(adminDb.rpcCalls).toHaveLength(1);
  });

  it('rate-limits quiz-scoped boards per IP and sheds them when too many are in flight', async () => {
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await get('?quizId=quiz-1')).status).toBe(429);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    adminDb.client.rpc.mockImplementation((_fn: string, args: Record<string, unknown> = {}) => ({
      then: (ok: (v: unknown) => unknown) => gate.then(() => ok({ data: [{ id: args.p_quiz_id }], error: null })),
    }) as never);
    const slow = Array.from({ length: 6 }, (_, i) => get(`?quizId=quiz-${i}`));
    await new Promise((r) => setTimeout(r, 0));
    const shed = await get('?quizId=quiz-99');
    expect(shed.status).toBe(503);
    expect(shed.headers.get('Retry-After')).toBe('3');
    release();
    expect((await Promise.all(slow)).every((r) => r.status === 200)).toBe(true);
    // the global board is never shed
    expect((await get()).status).toBe(200);
  });

  it('validates the query', async () => {
    for (const qs of ['?limit=0', '?limit=101', '?timeframe=daily', '?quizId=bad%20id']) expect((await get(qs)).status).toBe(400);
  });

  it('answers 500 when the RPC fails or the handler throws', async () => {
    adminDb.setRpc('get_leaderboard', { error: { message: 'x' } });
    expect((await get()).status).toBe(500);
    adminDb.client.rpc.mockImplementation(() => { throw new Error('boom'); });
    expect((await get('?limit=3')).status).toBe(500);
  });

  it('handles an empty board and keeps the cache bounded', async () => {
    adminDb.setRpc('get_leaderboard', { data: null });
    expect(await (await get()).json()).toMatchObject({ users: [], leaderboard: [], total: 0 });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let i = 1; i <= 100; i++) await get(`?limit=${i}`);
    for (const tf of ['weekly', 'monthly']) for (let i = 1; i <= 60; i++) await get(`?limit=${i}&timeframe=${tf}`);
    clock.mockReturnValue(now + 61_000);
    await get('?limit=7&timeframe=monthly');
    clock.mockRestore();
    expect(adminDb.rpcCalls.length).toBeGreaterThan(200);
  });
});
