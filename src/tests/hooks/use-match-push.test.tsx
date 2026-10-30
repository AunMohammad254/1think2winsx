import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import type { LiveMatchCard } from '@/lib/quiz-catalog';

type Poll = { task: () => Promise<boolean>; opts: Record<string, unknown> };
const h = vi.hoisted(() => ({ poll: null as Poll | null, fetch: vi.fn() }));
vi.mock('@/hooks/useJitteredPolling', () => ({ useJitteredPolling: (task: () => Promise<boolean>, opts: Record<string, unknown>) => { h.poll = { task, opts }; } }));

import { useMatchPush } from '@/hooks/useMatchPush';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const live = (over: Partial<LiveMatchCard> = {}): LiveMatchCard => ({ id: 'm1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', status: 'live', ...over });
const question = (over: Record<string, unknown> = {}) => ({
  id: 'r', innings: 1, over: 7, text: 'Will over 7 go for 8 or more runs?', textRomanUrdu: 'Kya over 7 mein 8 ya zyada runs banenge?',
  options: ['Yes', 'No'], state: 'open', closesAt: new Date(NOW + 90_000).toISOString(), correctOption: null, ...over,
});
const feed = (over: Record<string, unknown> = {}, match: Record<string, unknown> = {}) => ({
  match: { id: 'm1', quizId: 'mq1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 20, status: 'live', settled: false, entriesClosed: false, ...match },
  innings: [{ innings: 1, battingTeam: 'Lahore', endReason: null, runs: 48, wickets: 2, oversText: '6.0', target: null, overs: [] }],
  questions: [question(), question({ id: 'w', text: 'Will a wicket fall in over 7?', textRomanUrdu: null })],
  // The server's clock 2 s ahead of the device's
  serverNow: new Date(NOW + 2_000).toISOString(),
  ...over,
});

/** The feed (with an Age header) and the player's answers, as the server would give them */
function serve(body: unknown | (() => Response), answers: unknown | Response = { answers: [] }) {
  h.fetch.mockImplementation(async (url: string) => {
    if (url === '/api/quizzes/mq1/answers') return answers instanceof Response ? answers : jsonResponse(answers);
    if (typeof body === 'function') return (body as () => Response)();
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', age: '1' } });
  });
}
const pushRef = () => ({ current: { match: vi.fn(), setEntriesClosed: vi.fn(), notify: vi.fn(), announce: vi.fn(), open: vi.fn() } });

beforeEach(() => {
  h.poll = null;
  h.fetch.mockReset();
  vi.stubGlobal('fetch', (...a: unknown[]) => h.fetch(...a));
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useMatchPush', () => {
  it('follows no feed while no match is being played', () => {
    const push = pushRef();
    const { rerender } = renderHook(({ matches }) => useMatchPush(matches, push), { initialProps: { matches: [] as LiveMatchCard[] } });
    expect(h.poll!.opts).toMatchObject({ intervalMs: 3_000, enabled: false });
    rerender({ matches: [live({ status: 'completed' }), live({ id: 'm2', status: 'abandoned' })] });
    expect(h.poll!.opts.enabled).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("pops the over taking answers up at once, on the device's clock, with the score and both languages", async () => {
    serve(feed());
    const push = pushRef();
    renderHook(() => useMatchPush([live({ id: 'old', status: 'completed' }), live()], push));
    await waitFor(() => expect(push.current.match).toHaveBeenCalledTimes(1));
    expect(h.fetch).toHaveBeenCalledWith('/api/live/matches/m1', { credentials: 'omit' });
    expect(h.fetch).toHaveBeenCalledWith('/api/quizzes/mq1/answers');
    expect(push.current.setEntriesClosed).toHaveBeenCalledWith('mq1', false);
    // The server is 2 s ahead and the copy 1 s old: it closes 87 s from now on this device
    expect(push.current.match).toHaveBeenCalledWith({
      key: 'm1:1.7', quizId: 'mq1', matchTitle: 'Lahore vs Karachi', over: 7, score: 'Lahore 48/2 (6.0 overs)',
      closesAtMs: NOW + 87_000, windowMs: 87_000,
      questions: [
        { id: 'r', text: 'Will over 7 go for 8 or more runs?', textRomanUrdu: 'Kya over 7 mein 8 ya zyada runs banenge?', options: ['Yes', 'No'] },
        { id: 'w', text: 'Will a wicket fall in over 7?', textRomanUrdu: null, options: ['Yes', 'No'] },
      ],
    });
    expect(h.poll!.opts).toMatchObject({ intervalMs: 3_000, jitterMs: 1_000, maxBackoffMs: 30_000, enabled: true });

    // Checked again: the same over (the pop-up only updates its score), answers not read again, the ring's
    // start kept from the first sight
    vi.mocked(Date.now).mockReturnValue(NOW + 3_000);
    serve(feed({ serverNow: new Date(NOW + 5_000).toISOString() }));
    await act(async () => { expect(await h.poll!.task()).toBe(true); });
    expect(push.current.match).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'm1:1.7', closesAtMs: NOW + 87_000, windowMs: 87_000 }));
    expect(h.fetch.mock.calls.filter(([url]) => url === '/api/quizzes/mq1/answers')).toHaveLength(1);
  });

  it("leaves out what the player already answered, and says a full match is closed to a newcomer only", async () => {
    serve(feed(), { answers: [{ questionId: 'r', selectedOption: 0 }] });
    const push = pushRef();
    renderHook(() => useMatchPush([live()], push));
    await waitFor(() => expect(push.current.match).toHaveBeenCalled());
    expect(push.current.match.mock.calls[0][0].questions.map((q: { id: string }) => q.id)).toEqual(['w']);

    // All answered: nothing pops up. Full, but they joined: still open to them
    serve(feed({}, { entriesClosed: true }), { answers: [{ questionId: 'r', selectedOption: 0 }, { questionId: 'w', selectedOption: 1 }] });
    const again = pushRef();
    renderHook(() => useMatchPush([live()], again));
    await waitFor(() => expect(again.current.setEntriesClosed).toHaveBeenCalledWith('mq1', false));
    expect(again.current.match).not.toHaveBeenCalled();

    serve(feed({}, { entriesClosed: true }));
    const newcomer = pushRef();
    renderHook(() => useMatchPush([live()], newcomer));
    await waitFor(() => expect(newcomer.current.setEntriesClosed).toHaveBeenCalledWith('mq1', true));
  });

  it('pops nothing up between overs, or for a match hidden meanwhile', async () => {
    serve(feed({ questions: [question({ state: 'closed' })] }));
    const push = pushRef();
    renderHook(() => useMatchPush([live()], push));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith('/api/quizzes/mq1/answers'));
    serve(() => jsonResponse({ error: 'Match not found' }, 404));
    await act(async () => { expect(await h.poll!.task()).toBe(true); });
    expect(push.current.match).not.toHaveBeenCalled();
  });

  it('backs off when the feed or the answers fail, and reads the answers again on the next check', async () => {
    serve(() => jsonResponse({ error: 'busy' }, 503));
    const push = pushRef();
    renderHook(() => useMatchPush([live()], push));
    await act(async () => { expect(await h.poll!.task()).toBe(false); });
    serve(() => { throw new Error('offline'); });
    await act(async () => { expect(await h.poll!.task()).toBe(false); });

    serve(feed(), jsonResponse({ error: 'down' }, 500));
    await act(async () => { expect(await h.poll!.task()).toBe(false); });
    expect(push.current.match).not.toHaveBeenCalled();
    serve(feed());
    await act(async () => { expect(await h.poll!.task()).toBe(true); });
    expect(push.current.match).toHaveBeenCalled();
  });

  it('waits for the pop-up to be there', async () => {
    serve(feed());
    const push = { current: null };
    renderHook(() => useMatchPush([live()], push));
    await act(async () => { expect(await h.poll!.task()).toBe(true); });
  });
});
