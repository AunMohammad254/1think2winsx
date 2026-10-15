// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { NextResponse } from 'next/server';
import { createSupabaseMock, makeRequest, routeParams, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const applyRateLimit = vi.fn();
const logPerformanceMetric = vi.fn();
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { shareCard: 'shareCard' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: { logPerformanceMetric: (...a: unknown[]) => logPerformanceMetric(...a) } }));
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(public element: ReactNode, public init: { width: number; height: number; headers?: Record<string, string> }) {}
  },
}));

/** Every string rendered anywhere in a JSX tree, joined with single spaces. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

beforeEach(() => {
  adminDb = createSupabaseMock();
  applyRateLimit.mockReset().mockResolvedValue(null);
  logPerformanceMetric.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/streaming/active', () => {
  let GET: typeof import('@/app/api/streaming/active/route').GET;
  beforeEach(async () => {
    vi.resetModules();
    ({ GET } = await import('@/app/api/streaming/active/route')); // fresh cache per test
  });

  it('returns the active stream, cacheable by the CDN', async () => {
    adminDb.setRpc('get_live_stream_config', { data: { success: true, isActive: true, embedHtml: '<iframe src="https://www.youtube.com/embed/x"></iframe>', title: 'Final' } });
    const res = await GET();
    const body = await res.json();
    expect(body.hasActiveStream).toBe(true);
    expect(body.stream).toMatchObject({ id: 'admin-embed', name: 'Final', facebookLiveVideo: { embedHtml: '<iframe src="https://www.youtube.com/embed/x"></iframe>' } });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=5, stale-while-revalidate=30');
  });

  it('builds an iframe from a bare URL WITHOUT escaping it', async () => {
    adminDb.setRpc('get_live_stream_config', { data: { success: true, isActive: true, embedUrl: 'x" onload="alert(1)' } });
    const body = await (await GET()).json();
    expect(body.stream.facebookLiveVideo.embedHtml).toBe('<iframe src="x" onload="alert(1)" allowfullscreen></iframe>');
    expect(body.stream.name).toBe('Livestream');
  });

  it('reports no stream when inactive, unconfigured or empty', async () => {
    for (const data of [{ success: false }, { success: true, isActive: false, embedHtml: '<p/>' }, { success: true, isActive: true }, null]) {
      vi.resetModules();
      ({ GET } = await import('@/app/api/streaming/active/route'));
      adminDb.setRpc('get_live_stream_config', { data });
      expect(await (await GET()).json()).toEqual({ hasActiveStream: false, stream: null });
    }
  });

  it('caches for 5 s, shares one load between callers, and serves stale while refreshing', async () => {
    adminDb.setRpc('get_live_stream_config', { data: { success: true, isActive: true, embedHtml: '<b>v1</b>' } });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await Promise.all([GET(), GET(), GET()]);
    expect(adminDb.rpcCalls).toHaveLength(1);

    adminDb.setRpc('get_live_stream_config', { data: { success: true, isActive: true, embedHtml: '<b>v2</b>' } });
    clock.mockReturnValue(now + 6_000);
    const stale = await (await GET()).json();
    expect(stale.stream.facebookLiveVideo.embedHtml).toBe('<b>v1</b>');
    await new Promise((r) => setTimeout(r, 0));
    const fresh = await (await GET()).json();
    expect(fresh.stream.facebookLiveVideo.embedHtml).toBe('<b>v2</b>');
    clock.mockRestore();
  });

  it('keeps serving the last stream through a database error, then remembers "no stream" briefly', async () => {
    adminDb.setRpc('get_live_stream_config', { data: { success: true, isActive: true, embedHtml: '<b>live</b>' } });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await GET();
    adminDb.setRpc('get_live_stream_config', { error: { message: 'db blip' } });
    clock.mockReturnValue(now + 6_000);
    await GET();
    await new Promise((r) => setTimeout(r, 0));
    expect((await (await GET()).json()).hasActiveStream).toBe(true);

    await new Promise((r) => setTimeout(r, 0)); // let the background refresh settle
    clock.mockReturnValue(now + 120_000);
    expect((await (await GET()).json()).hasActiveStream).toBe(false);
    const calls = adminDb.rpcCalls.length;
    await GET();
    expect(adminDb.rpcCalls).toHaveLength(calls);
    clock.mockRestore();
  });

  it('answers 500 if building the response throws', async () => {
    adminDb.setRpc('get_live_stream_config', { data: null });
    logPerformanceMetric.mockImplementationOnce(() => { throw new Error('logger'); });
    expect((await GET()).status).toBe(500);
  });
});

const shareCard = await import('@/app/api/quizzes/[id]/share-card/route');

describe('GET /api/quizzes/[id]/share-card', () => {
  const { GET } = shareCard;
  const card = async (id: string, qs = '') => {
    const res = (await GET(makeRequest(`/api/quizzes/${id}/share-card${qs}`), routeParams({ id }))) as unknown as { element: ReactNode; init: { width: number; height: number; headers: Record<string, string> } };
    // spaces removed: JSX splits '9 / 10' and '90%' into separate children
    return { res, text: textOf(res.element).replace(/\s+/g, '') };
  };

  it('renders a 1200x630 card from the query string for a placeholder attempt', async () => {
    const { res, text } = await card('temp', '?score=9&total=10&title=Cricket%20Night&name=Ali');
    expect(res.init).toMatchObject({ width: 1200, height: 630 });
    expect(text).toContain('Ali');
    expect(text).toContain('CricketNight');
    expect(text).toContain('9/10');
    expect(text).toContain('90%');
    expect(text).toContain('Excellent');
    expect(adminDb.calls).toHaveLength(0);
  });

  it.each([
    [85, 'Very Good'], [75, 'Good'], [65, 'Average'], [10, 'Needs Practice'],
  ])('labels %i%% as %s', async (pct, label) => {
    const { text } = await card('temp', `?pct=${pct}`);
    expect(text).toContain(label.replace(/\s+/g, ''));
  });

  it('uses safe defaults and clamps hostile input', async () => {
    let { text } = await card('temp');
    expect(text).toContain('SportsFan');
    expect(text).toContain('SportsQuiz');
    expect(text).toContain('8/10');
    ({ text } = await card('temp', `?score=abc&total=-5&pct=999&name=${'x'.repeat(200)}`));
    expect(text).toContain('8/1');
    expect(text).toContain('100%');
    expect(text).toContain('x'.repeat(80));
    expect(text).not.toContain('x'.repeat(81));
  });

  it('loads a real attempt, but treats its percentage score as a count of correct answers', async () => {
    adminDb.setTable('QuizAttempt', { data: { score: 80, userId: 'u1', quizId: 'q1' } });
    adminDb.setTable('Quiz', { data: { title: 'Cricket' } });
    adminDb.setTable('User', { data: { name: null, email: 'ali.k@example.test' } });
    adminDb.setTable('Question', { count: 5 });

    const { text } = await card('attempt-1');

    expect(text).toContain('ali.k');
    expect(text).toContain('Cricket');
    // an 80% attempt on a 5-question quiz renders as "80 / 5" and 100%
    expect(text).toContain('80/5');
    expect(text).toContain('100%');
  });

  it('falls back to the query string when the attempt is missing or the lookup fails', async () => {
    adminDb.setTable('QuizAttempt', { data: null });
    expect((await card('ghost', '?name=Guest')).text).toContain('Guest');
    adminDb.setTable('QuizAttempt', { data: { score: 50, userId: 'u', quizId: 'q' } });
    adminDb.setTable('Question', { count: null });
    expect((await card('a2')).text).toContain('50/10');
    adminDb.client.from.mockImplementation(() => { throw new Error('db down'); });
    expect((await card('a3', '?name=Fallback')).text).toContain('Fallback');
  });

  it('is rate limited per IP and answers 500 if rendering fails', async () => {
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect(((await GET(makeRequest('/x'), routeParams({ id: 'temp' }))) as Response).status).toBe(429);
    const bad = await GET(makeRequest('/x'), { params: Promise.reject(new Error('no params')) } as never);
    expect((bad as Response).status).toBe(500);
  });
});
