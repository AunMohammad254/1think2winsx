// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, routeParams } from '@/tests/helpers/supabase-mock';

const guard = vi.fn();
const service = { listMatches: vi.fn(), createMatch: vi.fn(), loadMatch: vi.fn(), matchView: vi.fn(), applyMatchEvent: vi.fn() };
vi.mock('@/lib/admin-api-guard', () => ({ adminApiGuard: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/match-service', () => ({
  listMatches: (...a: unknown[]) => service.listMatches(...a),
  createMatch: (...a: unknown[]) => service.createMatch(...a),
  loadMatch: (...a: unknown[]) => service.loadMatch(...a),
  matchView: (...a: unknown[]) => service.matchView(...a),
  applyMatchEvent: (...a: unknown[]) => service.applyMatchEvent(...a),
}));

const list = await import('@/app/api/admin/matches/route');
const one = await import('@/app/api/admin/matches/[id]/route');
const events = await import('@/app/api/admin/matches/[id]/events/route');

beforeEach(() => {
  guard.mockReset().mockResolvedValue({ id: 'admin-1', email: 'boss@example.test' });
  for (const fn of Object.values(service)) fn.mockReset();
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
    expect(service.loadMatch).toHaveBeenCalledWith('m1');
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
