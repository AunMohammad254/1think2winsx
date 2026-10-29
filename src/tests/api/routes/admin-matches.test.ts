// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, routeParams } from '@/tests/helpers/supabase-mock';

const guard = vi.fn();
const service = {
  listMatches: vi.fn(), createMatch: vi.fn(), loadMatch: vi.fn(), matchView: vi.fn(), applyMatchEvent: vi.fn(),
  sendDrafts: vi.fn(), skipDrafts: vi.fn(), setAutoSend: vi.fn(), setPublished: vi.fn(), setMaxEntries: vi.fn(), announceMatch: vi.fn(),
};
// Work the route leaves for after its response, run by the test
const afterResponse: Array<() => unknown> = [];
const invalidateQuizCatalog = vi.fn();
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => afterResponse.push(task),
}));
vi.mock('@/lib/quiz-catalog', () => ({ invalidateQuizCatalog: () => invalidateQuizCatalog() }));
vi.mock('@/lib/admin-api-guard', () => ({ adminApiGuard: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/match-service', () => ({
  listMatches: (...a: unknown[]) => service.listMatches(...a),
  createMatch: (...a: unknown[]) => service.createMatch(...a),
  loadMatch: (...a: unknown[]) => service.loadMatch(...a),
  matchView: (...a: unknown[]) => service.matchView(...a),
  applyMatchEvent: (...a: unknown[]) => service.applyMatchEvent(...a),
  sendDrafts: (...a: unknown[]) => service.sendDrafts(...a),
  skipDrafts: (...a: unknown[]) => service.skipDrafts(...a),
  setAutoSend: (...a: unknown[]) => service.setAutoSend(...a),
  setPublished: (...a: unknown[]) => service.setPublished(...a),
  setMaxEntries: (...a: unknown[]) => service.setMaxEntries(...a),
  announceMatch: (...a: unknown[]) => service.announceMatch(...a),
}));

const list = await import('@/app/api/admin/matches/route');
const one = await import('@/app/api/admin/matches/[id]/route');
const events = await import('@/app/api/admin/matches/[id]/events/route');
const review = await import('@/app/api/admin/matches/[id]/questions/route');

beforeEach(() => {
  guard.mockReset().mockResolvedValue({ id: 'admin-1', email: 'boss@example.test' });
  for (const fn of Object.values(service)) fn.mockReset();
  afterResponse.length = 0;
  invalidateQuizCatalog.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/admin/matches', () => {
  const get = () => list.GET(makeRequest('/api/admin/matches'));

  it('lists the matches to a reading admin', async () => {
    service.listMatches.mockResolvedValue([{ id: 'm1' }]);
    const res = await get();
    expect(await res.json()).toEqual({ matches: [{ id: 'm1' }] });
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/matches', { write: false });
  });

  it('passes the guard through and answers 500 when listing fails', async () => {
    guard.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await get()).status).toBe(403);
    service.listMatches.mockRejectedValue(new Error('down'));
    expect((await get()).status).toBe(500);
  });
});

describe('POST /api/admin/matches', () => {
  const post = (body: unknown) => list.POST(makeRequest('/api/admin/matches', { method: 'POST', body }));
  const valid = { teamA: ' Lahore Qalandars ', teamB: 'Karachi Kings', oversPerInnings: 20 };

  it('creates a match for a writing admin, two questions an over unless told otherwise', async () => {
    service.createMatch.mockResolvedValue({ ok: true, data: { matchId: 'm1', quizId: 'quiz1' } });
    const res = await post(valid);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ matchId: 'm1', quizId: 'quiz1' });
    expect(service.createMatch).toHaveBeenCalledWith({ teamA: 'Lahore Qalandars', teamB: 'Karachi Kings', oversPerInnings: 20, questionsPerOver: 2 }, 'boss@example.test');
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/matches', { write: true });
  });

  it('checks the form, passes on refusals and reports failures', async () => {
    for (const body of [{ ...valid, oversPerInnings: 15 }, { ...valid, teamA: 'L' }, { ...valid, questionsPerOver: 4 }, null]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // A body that isn't JSON at all
    expect((await list.POST(new NextRequest('http://localhost/api/admin/matches', { method: 'POST', body: '{' }))).status).toBe(400);
    expect(service.createMatch).not.toHaveBeenCalled();
    service.createMatch.mockResolvedValue({ ok: false, status: 400, code: 'invalid', error: 'The two teams need different names' });
    const refused = await post(valid);
    expect(await refused.json()).toEqual({ error: 'The two teams need different names', code: 'invalid' });
    service.createMatch.mockRejectedValue(new Error('down'));
    expect((await post(valid)).status).toBe(500);
    guard.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post(valid)).status).toBe(403);
  });
});

describe('GET /api/admin/matches/[id]', () => {
  const get = () => one.GET(makeRequest('/api/admin/matches/m1'), routeParams({ id: 'm1' }));

  it("returns the console's view of the match", async () => {
    service.loadMatch.mockResolvedValue({ row: {} });
    service.matchView.mockReturnValue({ match: { id: 'm1' } });
    const res = await get();
    expect(await res.json()).toEqual({ match: { id: 'm1' } });
    // With the player counts the Players box shows
    expect(service.loadMatch).toHaveBeenCalledWith('m1', expect.any(Number), true);
  });

  it('answers 404 for an unknown match, 500 when loading fails, and passes the guard through', async () => {
    service.loadMatch.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    service.loadMatch.mockRejectedValue(new Error('down'));
    expect((await get()).status).toBe(500);
    guard.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await get()).status).toBe(401);
  });
});

describe('POST /api/admin/matches/[id]/events', () => {
  const post = (body: unknown) => events.POST(makeRequest('/api/admin/matches/m1/events', { method: 'POST', body }), routeParams({ id: 'm1' }));

  it('applies an event against the version the console saw, and returns the match as it now is', async () => {
    service.applyMatchEvent.mockResolvedValue({ ok: true, data: { match: { version: 4 } } });
    const res = await post({ version: 3, event: { type: 'ball', runs: 4, extra: 'none', wicket: false } });
    expect(await res.json()).toEqual({ match: { version: 4 } });
    expect(service.applyMatchEvent).toHaveBeenCalledWith('m1', 3, { type: 'ball', runs: 4, extra: 'none', wicket: false }, 'boss@example.test');
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/matches/[id]/events', { write: true });
    for (const event of [
      { type: 'start_innings', battingTeam: 'Lahore' }, { type: 'undo' }, { type: 'end_innings' }, { type: 'close_answers' }, { type: 'abandon' },
      { type: 'correct_ball', ballId: 'b1', runs: 2, extra: 'leg_bye', wicket: false }, { type: 'resume_innings' }, { type: 'remove_innings' },
      { type: 'reopen_answers' }, { type: 'restore' },
    ]) {
      expect((await post({ version: 3, event })).status).toBe(200);
    }
  });

  it('refuses a malformed event, passes on refusals and reports failures', async () => {
    for (const body of [
      { version: 3, event: { type: 'ball', runs: 8, extra: 'none', wicket: false } },
      { version: 3, event: { type: 'ball', runs: 1, extra: 'beamer', wicket: false } },
      { version: -1, event: { type: 'undo' } },
      { version: 3, event: { type: 'declare' } },
      { version: 3, event: { type: 'correct_ball', runs: 2, extra: 'none', wicket: false } },
      { version: 3, event: { type: 'correct_ball', ballId: '', runs: 2, extra: 'none', wicket: false } },
      null,
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    const notJson = new NextRequest('http://localhost/api/admin/matches/m1/events', { method: 'POST', body: '{' });
    expect((await events.POST(notJson, routeParams({ id: 'm1' }))).status).toBe(400);
    expect(service.applyMatchEvent).not.toHaveBeenCalled();
    service.applyMatchEvent.mockResolvedValue({ ok: false, status: 409, code: 'stale', error: 'Someone else changed this match first.' });
    const stale = await post({ version: 3, event: { type: 'undo' } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'Someone else changed this match first.', code: 'stale' });
    service.applyMatchEvent.mockRejectedValue(new Error('down'));
    expect((await post({ version: 3, event: { type: 'undo' } })).status).toBe(500);
    guard.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post({ version: 3, event: { type: 'undo' } })).status).toBe(403);
  });
});

describe('PATCH /api/admin/matches/[id]', () => {
  const patch = (body: unknown) => one.PATCH(makeRequest('/api/admin/matches/m1', { method: 'PATCH', body }), routeParams({ id: 'm1' }));

  it('switches automatic sending for a writing admin', async () => {
    service.setAutoSend.mockResolvedValue({ ok: true, data: { match: { autoSend: true } } });
    const res = await patch({ autoSend: true });
    expect(await res.json()).toEqual({ match: { autoSend: true } });
    expect(service.setAutoSend).toHaveBeenCalledWith('m1', true, 'boss@example.test');
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/matches/[id]', { write: true });
  });

  it('refuses anything else, passes on refusals and reports failures', async () => {
    for (const body of [{ autoSend: 'yes' }, {}, null]) expect((await patch(body)).status).toBe(400);
    const notJson = new NextRequest('http://localhost/api/admin/matches/m1', { method: 'PATCH', body: '{' });
    expect((await one.PATCH(notJson, routeParams({ id: 'm1' }))).status).toBe(400);
    expect(service.setAutoSend).not.toHaveBeenCalled();
    service.setAutoSend.mockResolvedValue({ ok: false, status: 409, code: 'settled', error: 'Settled' });
    expect(await (await patch({ autoSend: false })).json()).toEqual({ error: 'Settled', code: 'settled' });
    service.setAutoSend.mockRejectedValue(new Error('down'));
    expect((await patch({ autoSend: false })).status).toBe(500);
    guard.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await patch({ autoSend: false })).status).toBe(403);
    // One setting at a time
    expect((await patch({ autoSend: true, published: true })).status).toBe(400);
  });

  const liveView = { match: { id: 'm1', title: 'Lahore vs Karachi', published: true } };

  it('takes the match live, shows it on the quiz list at once, and tells every player after the response', async () => {
    service.setPublished.mockResolvedValue({ ok: true, data: { view: liveView, changed: true, announce: true } });
    service.announceMatch.mockResolvedValue(undefined);
    const res = await patch({ published: true });
    expect(await res.json()).toEqual(liveView);
    expect(service.setPublished).toHaveBeenCalledWith('m1', true, 'boss@example.test');
    expect(invalidateQuizCatalog).toHaveBeenCalled();
    expect(service.announceMatch).not.toHaveBeenCalled();
    expect(afterResponse).toHaveLength(1);
    await afterResponse[0]();
    expect(service.announceMatch).toHaveBeenCalledWith('m1', 'Lahore vs Karachi');

    // A failed broadcast is only logged
    service.announceMatch.mockRejectedValue(new Error('push down'));
    await patch({ published: true });
    await afterResponse[1]();
    expect(console.error).toHaveBeenCalledWith('[matches] Announcing the match failed:', expect.any(Error));
  });

  it('hides it, or takes it live again, without telling anyone, and does nothing more when nothing changed or it was refused', async () => {
    service.setPublished.mockResolvedValue({ ok: true, data: { view: liveView, changed: true, announce: false } });
    await patch({ published: false });
    await patch({ published: true });
    expect(invalidateQuizCatalog).toHaveBeenCalledTimes(2);
    expect(afterResponse).toHaveLength(0);

    service.setPublished.mockResolvedValue({ ok: true, data: { view: liveView, changed: false, announce: false } });
    expect((await patch({ published: true })).status).toBe(200);
    expect(invalidateQuizCatalog).toHaveBeenCalledTimes(2);
    expect(afterResponse).toHaveLength(0);

    service.setPublished.mockResolvedValue({ ok: false, status: 409, code: 'abandoned', error: 'Restore the match before taking it live' });
    const res = await patch({ published: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Restore the match before taking it live', code: 'abandoned' });
  });

  it('sets how many players can join, within the limits a quiz has', async () => {
    service.setMaxEntries.mockResolvedValue({ ok: true, data: { players: { entries: 0, maxEntries: 5000 } } });
    expect(await (await patch({ maxEntries: 5000 })).json()).toEqual({ players: { entries: 0, maxEntries: 5000 } });
    expect(service.setMaxEntries).toHaveBeenCalledWith('m1', 5000, 'boss@example.test');
    for (const maxEntries of [0, 100_001, 1.5, '5000']) expect((await patch({ maxEntries })).status).toBe(400);
    expect(service.setMaxEntries).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/matches/[id]/questions', () => {
  const post = (body: unknown) => review.POST(makeRequest('/api/admin/matches/m1/questions', { method: 'POST', body }), routeParams({ id: 'm1' }));
  const question = { id: 'd1', text: 'Will over 3 go for 9 or more runs?', textRomanUrdu: 'Kya over 3 mein 9 ya zyada runs banenge?' };

  it('sends reviewed questions as worded, with a new line when given', async () => {
    service.sendDrafts.mockResolvedValue({ ok: true, data: { drafts: [] } });
    const res = await post({ action: 'send', questions: [{ ...question, line: 10 }, { ...question, id: 'd2' }] });
    expect(await res.json()).toEqual({ drafts: [] });
    expect(service.sendDrafts).toHaveBeenCalledWith('m1', [{ ...question, line: 10 }, { ...question, id: 'd2' }], 'boss@example.test');
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/matches/[id]/questions', { write: true });
  });

  it('skips questions', async () => {
    service.skipDrafts.mockResolvedValue({ ok: true, data: { drafts: [] } });
    expect((await post({ action: 'skip', ids: ['d1', 'd2'] })).status).toBe(200);
    expect(service.skipDrafts).toHaveBeenCalledWith('m1', ['d1', 'd2'], 'boss@example.test');
  });

  it('refuses a malformed review, passes on refusals and reports failures', async () => {
    for (const body of [
      { action: 'send', questions: [] },
      { action: 'send', questions: [{ ...question, text: ' ' }] },
      { action: 'send', questions: [{ ...question, textRomanUrdu: 'x'.repeat(161) }] },
      { action: 'send', questions: [{ ...question, line: 0 }] },
      { action: 'skip', ids: [] },
      { action: 'publish' },
      null,
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    const notJson = new NextRequest('http://localhost/api/admin/matches/m1/questions', { method: 'POST', body: '{' });
    expect((await review.POST(notJson, routeParams({ id: 'm1' }))).status).toBe(400);
    expect(service.sendDrafts).not.toHaveBeenCalled();
    service.skipDrafts.mockResolvedValueOnce({ ok: false, status: 409, code: 'gone', error: 'Gone' });
    expect((await post({ action: 'skip', ids: ['d1'] })).status).toBe(409);
    service.sendDrafts.mockResolvedValue({ ok: false, status: 400, code: 'wording', error: 'The English wording must keep the line (9)' });
    const res = await post({ action: 'send', questions: [question] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The English wording must keep the line (9)', code: 'wording' });
    service.skipDrafts.mockRejectedValue(new Error('down'));
    expect((await post({ action: 'skip', ids: ['d1'] })).status).toBe(500);
    guard.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post({ action: 'skip', ids: ['d1'] })).status).toBe(403);
  });
});
