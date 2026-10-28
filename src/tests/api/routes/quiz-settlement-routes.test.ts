// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { makeRequest } from '@/tests/helpers/supabase-mock';

const guard = vi.fn();
const list = vi.fn();
const detail = vi.fn();
const save = vi.fn();
const run = vi.fn();
const notify = vi.fn();
const resend = vi.fn();
const logQuizAction = vi.fn();

vi.mock('@/lib/admin-api-guard', () => ({ adminApiGuard: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/quiz-settlement', async () => ({
  // The real one: what the browser gets must not list every pool recipient
  settleResultForBrowser: (await vi.importActual<typeof import('@/lib/quiz-settlement')>('@/lib/quiz-settlement')).settleResultForBrowser,
  listSettlementQuizzes: (...a: unknown[]) => list(...a),
  getSettlementDetail: (...a: unknown[]) => detail(...a),
  saveQuizResult: (...a: unknown[]) => save(...a),
  runSettlement: (...a: unknown[]) => run(...a),
  notifySettlement: (...a: unknown[]) => notify(...a),
  resendSettlementNotices: (...a: unknown[]) => resend(...a),
}));
vi.mock('@/lib/logger', () => ({ default: { log: vi.fn() } }));
vi.mock('@/lib/admin-action-log', () => ({ logQuizAction: (...a: unknown[]) => logQuizAction(...a) }));

const main = await import('@/app/api/admin/quiz-settlement/route');
const preview = await import('@/app/api/admin/quiz-settlement/preview/route');
const result = await import('@/app/api/admin/quiz-settlement/result/route');
const notices = await import('@/app/api/admin/quiz-settlement/notify/route');
const { rewardsSchema, settleErrorStatus } = await import('@/app/api/admin/quiz-settlement/schema');

const ADMIN = { id: 'admin-user', email: 'admin@1think2win.com' };
const SEED = 'f'.repeat(32);
const POOL = { percent: 10, paid: 100, recipients: 2 };
const ok = { success: true, quizId: 'q1', quizTitle: 'Agli ball', winners: [{ rank: 1 }], seed: SEED, pool: { ...POOL, recipientIds: ['u1', 'u2'] } };
const okInBrowser = { ...ok, pool: POOL };

beforeEach(() => {
  for (const fn of [guard, list, detail, save, run, notify, resend, logQuizAction]) fn.mockReset();
  guard.mockResolvedValue(ADMIN);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const post = (route: { POST: (r: never) => Promise<Response> }, url: string, body?: unknown, rawBody?: string) =>
  route.POST(makeRequest(url, rawBody !== undefined ? { method: 'POST', rawBody } : { body }) as never);

describe('GET /api/admin/quiz-settlement', () => {
  it('lists every quiz with its stage, read-only for the guard', async () => {
    list.mockResolvedValue({ quizzes: [{ id: 'q1' }], prizes: [] });
    const res = await main.GET(makeRequest('/api/admin/quiz-settlement'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ quizzes: [{ id: 'q1' }], prizes: [] });
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/quiz-settlement', { write: false });
  });

  it('gives one quiz, or 404', async () => {
    detail.mockResolvedValueOnce({ quiz: { id: 'q1' } }).mockResolvedValueOnce(null);
    expect(await (await main.GET(makeRequest('/api/admin/quiz-settlement?quizId=q1'))).json()).toEqual({ quiz: { id: 'q1' } });
    expect(detail).toHaveBeenCalledWith('q1', expect.any(Number));
    expect((await main.GET(makeRequest('/api/admin/quiz-settlement?quizId=nope'))).status).toBe(404);
  });

  it('answers 500 when loading fails, and the guard response when refused', async () => {
    list.mockRejectedValue(new Error('down'));
    expect((await main.GET(makeRequest('/api/admin/quiz-settlement'))).status).toBe(500);
    guard.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await main.GET(makeRequest('/api/admin/quiz-settlement'))).status).toBe(401);
  });
});

describe('POST /api/admin/quiz-settlement (settle)', () => {
  const body = { quizId: 'q1', rewards: [{ rank: 1, points: 500 }, { rank: 2, prizeId: 'p1' }], tieRule: 'random', seed: SEED };

  it('settles as the signed-in admin, then notifies', async () => {
    run.mockResolvedValue(ok);
    notify.mockResolvedValue(true);
    const res = await post(main, '/api/admin/quiz-settlement', body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: okInBrowser, notified: true });
    expect(run).toHaveBeenCalledWith({ ...body, poolPercent: 0, poolEach: 0, settledBy: 'admin@1think2win.com', dryRun: false });
    expect(notify).toHaveBeenCalledWith(ok);
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/quiz-settlement', { write: true });
    // The quiz's History tab: who settled it, and whom it paid
    expect(logQuizAction).toHaveBeenCalledWith({
      quizId: 'q1', quizTitle: 'Agli ball', action: 'quiz_settled', adminEmail: 'admin@1think2win.com',
      details: {
        winners: [{ rank: 1, userId: undefined, points: undefined, prizeId: undefined }], unfilled: undefined,
        pool: { percent: 0, each: 0, paid: 100, recipients: 2 },
      },
    });
  });

  it('passes the points each through, and records them', async () => {
    run.mockResolvedValue(ok);
    notify.mockResolvedValue(true);
    await post(main, '/api/admin/quiz-settlement', { ...body, poolPercent: 20, poolEach: 1 });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ poolPercent: 20, poolEach: 1 }));
    expect(logQuizAction).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ pool: { percent: 20, each: 1, paid: 100, recipients: 2 } }),
    }));
  });

  it('passes a share of the points pool through, and copes with a database that has no pool yet', async () => {
    run.mockResolvedValue(ok);
    notify.mockResolvedValue(true);
    await post(main, '/api/admin/quiz-settlement', { ...body, poolPercent: 12.5 });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ poolPercent: 12.5 }));
    // settle_quiz from before the migration returns no pool
    const { pool: _pool, ...noPool } = ok;
    run.mockResolvedValue(noPool);
    const res = await post(main, '/api/admin/quiz-settlement', body);
    expect(await res.json()).toEqual({ result: noPool, notified: true });
    expect(logQuizAction).toHaveBeenLastCalledWith(expect.objectContaining({
      details: expect.objectContaining({ pool: { percent: 0, each: 0, paid: 0, recipients: 0 } }),
    }));
  });

  it('maps a refusal from the database to its status', async () => {
    const cases: Array<[string, number]> = [['already_settled', 409], ['not_found', 404], ['out_of_stock', 409], ['result_missing', 409], ['invalid', 400]];
    for (const [code, status] of cases) {
      run.mockResolvedValueOnce({ success: false, code, error: `because ${code}` });
      const res = await post(main, '/api/admin/quiz-settlement', body);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: `because ${code}`, code });
    }
    expect(notify).not.toHaveBeenCalled();
  });

  it('rejects bad input before touching the database', async () => {
    for (const bad of [
      { ...body, seed: 'short' },
      { ...body, tieRule: 'coin' },
      { ...body, rewards: [{ rank: 1, points: 5 }, { rank: 1, points: 6 }] },
      { ...body, rewards: [{ rank: 4, points: 5 }] },
      { ...body, rewards: [{ rank: 1, points: 5, prizeId: 'p' }] },
      { ...body, poolPercent: -1 },
      { ...body, poolPercent: 100.5 },
      { ...body, poolPercent: 12.555 },
      { ...body, poolPercent: '10' },
      { ...body, poolPercent: 10, poolEach: -1 },
      { ...body, poolPercent: 10, poolEach: 1.5 },
      { ...body, poolPercent: 10, poolEach: '1' },
      { ...body, poolPercent: 10, poolEach: 10_000_001 },
    ]) {
      expect((await post(main, '/api/admin/quiz-settlement', bad)).status).toBe(400);
    }
    const garbled = await post(main, '/api/admin/quiz-settlement', undefined, '{not json');
    expect(garbled.status).toBe(400);
    expect(await garbled.json()).toEqual({ error: 'Invalid input: expected object, received null' });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 500 when settling throws, and the guard response when refused', async () => {
    run.mockRejectedValue(new Error('boom'));
    expect((await post(main, '/api/admin/quiz-settlement', body)).status).toBe(500);
    guard.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await post(main, '/api/admin/quiz-settlement', body)).status).toBe(403);
  });
});

describe('POST /api/admin/quiz-settlement/preview', () => {
  const body = { quizId: 'q1', rewards: [{ rank: 1, points: 500 }], tieRule: 'earliest' };

  it('runs a dry settlement with a fresh seed, or the one given', async () => {
    run.mockResolvedValue({ ...ok, preview: true });
    const res = await post(preview, '/api/admin/quiz-settlement/preview', body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { ...okInBrowser, preview: true } });
    expect(run.mock.calls[0][0]).toMatchObject({ ...body, settledBy: 'admin@1think2win.com', dryRun: true });
    expect(run.mock.calls[0][0].seed).toMatch(/^[0-9a-f]{32}$/);

    await post(preview, '/api/admin/quiz-settlement/preview', { ...body, seed: SEED });
    expect(run.mock.calls[1][0].seed).toBe(SEED);
    expect(run.mock.calls[1][0]).toMatchObject({ poolPercent: 0, poolEach: 0 });

    await post(preview, '/api/admin/quiz-settlement/preview', { ...body, poolPercent: 10, poolEach: 5 });
    expect(run.mock.calls[2][0]).toMatchObject({ poolPercent: 10, poolEach: 5 });
  });

  it('maps refusals and bad input, and answers 500 on errors', async () => {
    run.mockResolvedValueOnce({ success: false, code: 'result_missing', error: 'Save the result first' });
    expect((await post(preview, '/api/admin/quiz-settlement/preview', body)).status).toBe(409);
    const bad = await post(preview, '/api/admin/quiz-settlement/preview', { ...body, rewards: 'all' });
    expect(bad.status).toBe(400);
    expect((await post(preview, '/api/admin/quiz-settlement/preview', undefined, 'x')).status).toBe(400);
    run.mockRejectedValueOnce(new Error('boom'));
    expect((await post(preview, '/api/admin/quiz-settlement/preview', body)).status).toBe(500);
    guard.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await post(preview, '/api/admin/quiz-settlement/preview', body)).status).toBe(401);
  });
});

describe('POST /api/admin/quiz-settlement/result', () => {
  it('saves the result, ending an open quiz only when asked', async () => {
    save.mockResolvedValue({ ok: true });
    const res = await post(result, '/api/admin/quiz-settlement/result', { quizId: 'q1', answers: { a: 1 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(save).toHaveBeenLastCalledWith('q1', { a: 1 }, false, expect.any(Number));
    await post(result, '/api/admin/quiz-settlement/result', { quizId: 'q1', answers: { a: 1 }, endNow: true });
    expect(save).toHaveBeenLastCalledWith('q1', { a: 1 }, true, expect.any(Number));
    expect(logQuizAction.mock.calls.map((c) => c[0])).toEqual([
      { quizId: 'q1', action: 'result_saved', adminEmail: 'admin@1think2win.com', details: { answers: { a: 1 }, endedNow: false } },
      { quizId: 'q1', action: 'result_saved', adminEmail: 'admin@1think2win.com', details: { answers: { a: 1 }, endedNow: true } },
    ]);
  });

  it('passes on a refusal, rejects bad input, and answers 500 on errors', async () => {
    save.mockResolvedValueOnce({ ok: false, status: 409, code: 'still_open', error: 'Players can still answer.' });
    const refused = await post(result, '/api/admin/quiz-settlement/result', { quizId: 'q1', answers: { a: 1 } });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'Players can still answer.', code: 'still_open' });
    expect((await post(result, '/api/admin/quiz-settlement/result', { quizId: 'q1', answers: { a: 12 } })).status).toBe(400);
    expect((await post(result, '/api/admin/quiz-settlement/result', undefined, '')).status).toBe(400);
    save.mockRejectedValueOnce(new Error('boom'));
    expect((await post(result, '/api/admin/quiz-settlement/result', { quizId: 'q1', answers: {} })).status).toBe(500);
    guard.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await post(result, '/api/admin/quiz-settlement/result', { quizId: 'q1', answers: {} })).status).toBe(403);
  });
});

describe('POST /api/admin/quiz-settlement/notify', () => {
  it('sends the notices again and says whether that worked, for a writing admin', async () => {
    resend.mockResolvedValueOnce({ ok: true, notified: true }).mockResolvedValueOnce({ ok: true, notified: false });
    const res = await post(notices, '/api/admin/quiz-settlement/notify', { quizId: 'q1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notified: true });
    expect(resend).toHaveBeenCalledWith('q1');
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/quiz-settlement/notify', { write: true });
    expect(await (await post(notices, '/api/admin/quiz-settlement/notify', { quizId: 'q1' })).json()).toEqual({ notified: false });
    expect(logQuizAction).toHaveBeenCalledWith({ quizId: 'q1', action: 'notices_resent', adminEmail: 'admin@1think2win.com', details: { notified: true } });
  });

  it('passes on a refusal, rejects bad input, and answers 500 on errors', async () => {
    resend.mockResolvedValueOnce({ ok: false, status: 409, code: 'not_settled', error: 'This quiz has not been settled yet' });
    const refused = await post(notices, '/api/admin/quiz-settlement/notify', { quizId: 'q1' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'This quiz has not been settled yet', code: 'not_settled' });
    expect((await post(notices, '/api/admin/quiz-settlement/notify', { quizId: '' })).status).toBe(400);
    expect((await post(notices, '/api/admin/quiz-settlement/notify', undefined, '')).status).toBe(400);
    resend.mockRejectedValueOnce(new Error('boom'));
    expect((await post(notices, '/api/admin/quiz-settlement/notify', { quizId: 'q1' })).status).toBe(500);
    expect(console.error).toHaveBeenCalledWith('[quiz-settlement] Sending the notices again failed:', expect.any(Error));
    guard.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await post(notices, '/api/admin/quiz-settlement/notify', { quizId: 'q1' })).status).toBe(403);
  });
});

describe('schema', () => {
  it('maps codes to statuses, anything unknown to 400', () => {
    expect(settleErrorStatus('not_found')).toBe(404);
    expect(settleErrorStatus('match_unfinished')).toBe(409);
    expect(settleErrorStatus('mystery')).toBe(400);
  });

  it('allows up to three places, one reward each', () => {
    expect(rewardsSchema.safeParse([{ rank: 1, points: 1 }, { rank: 2, points: 1 }, { rank: 3, prizeId: 'p' }]).success).toBe(true);
    const dup = rewardsSchema.safeParse([{ rank: 2, points: 1 }, { rank: 2, prizeId: 'p' }]);
    expect(dup.success).toBe(false);
    expect(dup.error!.issues[0].message).toBe('Each place (1st, 2nd, 3rd) can have one reward');
  });
});
