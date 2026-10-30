import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import type { LiveMatchCard } from '@/lib/quiz-catalog';

type Poll = { task: () => Promise<boolean>; opts: Record<string, unknown> };
const h = vi.hoisted(() => ({ poll: null as Poll | null, fetch: vi.fn(), store: new Map<string, string>() }));
vi.mock('@/hooks/useJitteredPolling', () => ({ useJitteredPolling: (task: () => Promise<boolean>, opts: Record<string, unknown>) => { h.poll = { task, opts }; } }));

import { useMatchPush } from '@/hooks/useMatchPush';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const live = (over: Partial<LiveMatchCard> = {}): LiveMatchCard => ({ id: 'm1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', status: 'live', ...over });
const question = (over: Record<string, unknown> = {}) => ({
  id: 'r', innings: 1, over: 7, text: 'Will over 7 go for 8 or more runs?', textRomanUrdu: 'Kya over 7 mein 8 ya zyada runs banenge?',
  options: ['Yes', 'No'], optionsRomanUrdu: ['Haan', 'Nahi'], state: 'open', closesAt: new Date(NOW + 90_000).toISOString(), correctOption: null, ...over,
});
const OVER_7 = [question(), question({ id: 'w', text: 'Will a wicket fall in over 7?', textRomanUrdu: null })];
const feed = (over: Record<string, unknown> = {}) => ({
  match: { id: 'm1', quizId: 'mq1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 20, status: 'live', settled: false, entriesClosed: false },
  innings: [{ innings: 1, battingTeam: 'Lahore', endReason: null, runs: 48, wickets: 2, oversText: '6.0', target: null, overs: [] }],
  questions: OVER_7,
  // The server's clock 2 s ahead of the device's
  serverNow: new Date(NOW + 2_000).toISOString(),
  ...over,
});

/** The feed, as a Cloudflare copy 1 s old */
function serve(body: unknown | (() => Response)) {
  h.fetch.mockImplementation(async () => (typeof body === 'function'
    ? (body as () => Response)()
    : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', age: '1' } })));
}
const pushRef = () => ({ current: { match: vi.fn(), setEntriesClosed: vi.fn(), notify: vi.fn(), announce: vi.fn(), open: vi.fn() } });
const lastPush = (push: ReturnType<typeof pushRef>) => push.current.match.mock.calls.at(-1)![0];
const check = async () => {
  let ok = false;
  await act(async () => { ok = await h.poll!.task(); });
  return ok;
};

beforeEach(() => {
  h.poll = null;
  h.fetch.mockReset();
  h.store.clear();
  vi.stubGlobal('fetch', (...a: unknown[]) => h.fetch(...a));
  vi.stubGlobal('localStorage', { getItem: (k: string) => h.store.get(k) ?? null, setItem: (k: string, v: string) => void h.store.set(k, v) });
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useMatchPush', () => {
  it('follows no feed while no match is being played', () => {
    const push = pushRef();
    const { rerender } = renderHook(({ matches }) => useMatchPush(matches, push, 'u1'), { initialProps: { matches: [] as LiveMatchCard[] } });
    expect(h.poll!.opts).toMatchObject({ intervalMs: 3_000, enabled: false });
    rerender({ matches: [live({ status: 'completed' }), live({ id: 'm2', status: 'abandoned' })] });
    expect(h.poll!.opts.enabled).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("pops the over taking answers up at once, on the device's clock, keyed by its questions, asking the server nothing personal", async () => {
    serve(feed());
    const push = pushRef();
    renderHook(() => useMatchPush([live({ id: 'old', status: 'completed' }), live()], push, 'u1'));
    await waitFor(() => expect(push.current.match).toHaveBeenCalledTimes(1));
    // Only the shared, cached feed
    expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/live/matches/m1']);
    expect(h.fetch).toHaveBeenCalledWith('/api/live/matches/m1', { credentials: 'omit' });
    expect(push.current.setEntriesClosed).not.toHaveBeenCalled();
    // The server is 2 s ahead and the copy 1 s old: it closes 87 s from now on this device
    expect(lastPush(push)).toEqual({
      key: 'm1:r+w', quizId: 'mq1', matchTitle: 'Lahore vs Karachi', over: 7, score: 'Lahore 48/2 (6.0 overs)',
      closesAtMs: NOW + 87_000, windowMs: 87_000,
      questions: [
        { id: 'r', text: 'Will over 7 go for 8 or more runs?', textRomanUrdu: 'Kya over 7 mein 8 ya zyada runs banenge?', options: ['Yes', 'No'], optionsRomanUrdu: ['Haan', 'Nahi'] },
        { id: 'w', text: 'Will a wicket fall in over 7?', textRomanUrdu: null, options: ['Yes', 'No'], optionsRomanUrdu: ['Haan', 'Nahi'] },
      ],
    });
    expect(h.poll!.opts).toMatchObject({ intervalMs: 3_000, jitterMs: 1_000, maxBackoffMs: 30_000, enabled: true });

    // Checked again: the same over with the new score, its ring's start kept from the first sight
    vi.mocked(Date.now).mockReturnValue(NOW + 3_000);
    serve(feed({ serverNow: new Date(NOW + 5_000).toISOString(), innings: [{ ...feed().innings[0], runs: 52, oversText: '6.1' }] }));
    expect(await check()).toBe(true);
    expect(lastPush(push)).toMatchObject({ key: 'm1:r+w', closesAtMs: NOW + 87_000, windowMs: 87_000, score: 'Lahore 52/2 (6.1 overs)' });
  });

  it('follows the over shown when the scorer reopens it, closes it early, voids or removes it', async () => {
    serve(feed());
    const push = pushRef();
    renderHook(() => useMatchPush([live()], push, 'u1'));
    await waitFor(() => expect(push.current.match).toHaveBeenCalled());

    // Reopened to a later time
    serve(feed({ questions: OVER_7.map((q) => ({ ...q, closesAt: new Date(NOW + 150_000).toISOString() })) }));
    await check();
    expect(lastPush(push)).toMatchObject({ key: 'm1:r+w', closesAtMs: NOW + 147_000 });

    // Closed early: now, on this device (never later than it was)
    vi.mocked(Date.now).mockReturnValue(NOW + 10_000);
    serve(feed({ questions: OVER_7.map((q) => ({ ...q, state: 'closed', closesAt: new Date(NOW + 5_000).toISOString() })) }));
    await check();
    expect(lastPush(push)).toMatchObject({ key: 'm1:r+w', closesAtMs: NOW + 10_000 });
    vi.mocked(Date.now).mockReturnValue(NOW + 20_000);
    await check();
    expect(lastPush(push).closesAtMs).toBe(NOW + 10_000);

    // Voided, or gone with a removed innings: closed too
    serve(feed({ questions: OVER_7.map((q) => ({ ...q, state: 'void' })) }));
    await check();
    expect(lastPush(push).closesAtMs).toBe(NOW + 10_000);
    serve(feed({ questions: [] }));
    await check();
    expect(lastPush(push).closesAtMs).toBe(NOW + 10_000);
  });

  it('pops up the same over again once its innings is played anew: new questions, a new key', async () => {
    serve(feed());
    const push = pushRef();
    renderHook(() => useMatchPush([live()], push, 'u1'));
    await waitFor(() => expect(push.current.match).toHaveBeenCalled());
    serve(feed({ questions: [question({ id: 'r2', over: 7 })] }));
    await check();
    expect(lastPush(push)).toMatchObject({ key: 'm1:r2', over: 7 });
  });

  it("leaves out what this player locked in on this device, and doesn't pop an over up with no time left to answer", async () => {
    const push = pushRef();
    serve(feed());
    const { result } = renderHook(() => useMatchPush([live()], push, 'u1'));
    await waitFor(() => expect(push.current.match).toHaveBeenCalled());
    act(() => result.current('mq1', ['r']));
    act(() => result.current('mq1', ['x']));
    expect(JSON.parse(h.store.get('t2w:match-answered:u1:mq1')!)).toEqual(['r', 'x']);

    // A reload: only the question not locked in pops up
    const again = pushRef();
    renderHook(() => useMatchPush([live()], again, 'u1'));
    await waitFor(() => expect(again.current.match).toHaveBeenCalled());
    expect(lastPush(again).questions.map((q: { id: string }) => q.id)).toEqual(['w']);

    // Everything locked in: nothing pops up. Another player on this device: theirs to answer
    act(() => result.current('mq1', ['w']));
    const done = pushRef();
    renderHook(() => useMatchPush([live()], done, 'u1'));
    const other = pushRef();
    renderHook(() => useMatchPush([live()], other, null));
    await waitFor(() => expect(other.current.match).toHaveBeenCalled());
    expect(done.current.match).not.toHaveBeenCalled();

    // 30 s left or less, less the clock difference: too late to pop up
    const late = pushRef();
    serve(feed({ questions: OVER_7.map((q) => ({ ...q, closesAt: new Date(NOW + 32_000).toISOString() })) }));
    renderHook(() => useMatchPush([live()], late, 'u2'));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(5));
    expect(late.current.match).not.toHaveBeenCalled();
  });

  it('pops nothing up between overs, or for a match hidden meanwhile', async () => {
    serve(feed({ questions: [question({ state: 'closed' })] }));
    const push = pushRef();
    renderHook(() => useMatchPush([live()], push, 'u1'));
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    serve(() => jsonResponse({ error: 'Match not found' }, 404));
    expect(await check()).toBe(true);
    expect(push.current.match).not.toHaveBeenCalled();
  });

  it('backs off when the feed fails, and waits for the pop-up to be there', async () => {
    serve(() => jsonResponse({ error: 'busy' }, 503));
    const push = { current: null };
    renderHook(() => useMatchPush([live()], push, 'u1'));
    expect(await check()).toBe(false);
    serve(() => { throw new Error('offline'); });
    expect(await check()).toBe(false);
    serve(feed());
    expect(await check()).toBe(true);
  });
});
