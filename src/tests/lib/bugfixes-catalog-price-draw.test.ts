// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

/** Chainable, awaitable PostgREST-like query: every builder method returns itself, `await` yields `result`. */
function query(result: unknown) {
  const q: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return () => q;
    },
  });
  return q;
}

// ── shared fakes ──────────────────────────────────────────────────────────────
const tables: Record<string, unknown> = {};
const rpc = vi.fn();
const findMany = vi.fn();
const winnerCreate = vi.fn();
const notifCreate = vi.fn();

vi.mock('@/lib/supabase/db', async () => {
  const shared = await vi.importActual<typeof import('@/lib/supabase/db-modules/shared')>('@/lib/supabase/db-modules/shared');
  return {
    getAdminDb: () => ({ from: (t: string) => query(tables[t]), rpc }),
    mapWithConcurrency: shared.mapWithConcurrency,
    notificationDb: { create: (...a: unknown[]) => notifCreate(...a) },
    userDb: {},
    quizDb: { findMany: (...a: unknown[]) => findMany(...a) },
  };
});
vi.mock('@/lib/quiz-scheduler', () => ({
  activateDueQuizzes: async () => ({ activated: [], nextDueAt: null }),
  broadcastQuizLive: async () => {},
}));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: async () => ({ valid: true, email: 'admin@test.dev' }) }));
vi.mock('@/lib/supabase/db-modules/winner.db', () => ({
  quizWinnerDb: {
    existsForQuiz: async () => false,
    findByQuizId: async () => null,
    create: (...a: unknown[]) => winnerCreate(...a),
    markNotificationSent: async () => {},
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  for (const k of Object.keys(tables)) delete tables[k];
  rpc.mockReset();
  findMany.mockReset();
  winnerCreate.mockReset();
  notifCreate.mockReset();
});

// ── quiz catalogue: attempt counts ────────────────────────────────────────────
describe('quiz catalogue attempt counts', () => {
  const quiz = {
    id: 'q1', title: 'Quiz', description: null, duration: 30, timeUpDuration: 60, passingScore: 70,
    status: 'upcoming', accessPrice: 2, quizType: 'normal', isBumperPrize: false, startsAt: null,
    pushedAt: null, createdAt: 'x', updatedAt: 'x',
  };

  it('reads the `{ quiz_id, attempt_count }` rows the RPC really returns (it used to always show 0)', async () => {
    tables.Quiz = { data: [quiz, { ...quiz, id: 'q2' }], error: null };
    tables.Question = { data: [], error: null };
    rpc.mockResolvedValue({ data: [{ quiz_id: 'q1', attempt_count: '42' }], error: null });

    const { getActiveQuizCatalog } = await import('@/lib/quiz-catalog');
    const catalog = await getActiveQuizCatalog();
    expect(catalog.find((q) => q.id === 'q1')?.totalAttempts).toBe(42); // bigint arrives as a string
    expect(catalog.find((q) => q.id === 'q2')?.totalAttempts).toBe(0); // quiz with no attempts
  });

  it('still serves the catalogue (and logs) when only the count query fails', async () => {
    tables.Quiz = { data: [quiz], error: null };
    tables.Question = { data: [], error: null };
    rpc.mockResolvedValue({ data: null, error: new Error('rpc down') });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { getActiveQuizCatalog } = await import('@/lib/quiz-catalog');
    const catalog = await getActiveQuizCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0].totalAttempts).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── wallet: displayed price must equal the charged price ──────────────────────
describe('getQuizAccessPrice', () => {
  it('asks for the OLDEST active quiz, the one pay_quiz_access charges', async () => {
    findMany.mockResolvedValue([{ accessPrice: 5 }]);
    const { getQuizAccessPrice } = await import('@/lib/wallet/service');
    const res = await getQuizAccessPrice();
    expect(res).toEqual({ success: true, price: 5 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', orderBy: 'createdAt', orderDir: 'asc', limit: 1 }));
  });

  it('falls back to 2 when there is no active quiz', async () => {
    findMany.mockResolvedValue([]);
    const { getQuizAccessPrice } = await import('@/lib/wallet/service');
    expect(await getQuizAccessPrice()).toEqual({ success: true, price: 2 });
  });
});

// ── lucky draw: consolation points ────────────────────────────────────────────
describe('POST /api/admin/lucky-winner/[quizId]/draw consolation points', () => {
  const attempts = [
    { id: 'a1', userId: 'u1', score: 100, completedAt: '2026-01-01T00:00:01Z', user: { id: 'u1', name: 'A', email: 'a@x', phone: null } },
    { id: 'a2', userId: 'u2', score: 100, completedAt: '2026-01-01T00:00:02Z', user: { id: 'u2', name: 'B', email: 'b@x', phone: null } },
    { id: 'a3', userId: 'u3', score: 100, completedAt: '2026-01-01T00:00:03Z', user: { id: 'u3', name: 'C', email: 'c@x', phone: null } },
    { id: 'a4', userId: 'u4', score: 50, completedAt: '2026-01-01T00:00:04Z', user: { id: 'u4', name: 'D', email: 'd@x', phone: null } },
  ];

  async function draw(body: unknown) {
    tables.Quiz = { data: { id: 'q1', title: 'T', prizeId: 'p1', isBumperPrize: false, status: 'active' }, error: null };
    tables.QuizAttempt = { data: attempts, error: null };
    winnerCreate.mockImplementation(async (d: any) => ({ id: 'w1', ...d }));
    const { POST } = await import('@/app/api/admin/lucky-winner/[quizId]/draw/route');
    const req = new NextRequest('http://localhost/api/admin/lucky-winner/q1/draw', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ quizId: 'q1' }) });
    return { res, json: await res.json() };
  }

  it('awards each tied loser through the real `increment_user_points` function', async () => {
    rpc.mockResolvedValue({ data: 10, error: null });
    const { res, json } = await draw({ numberOfWinners: 1, consolationPoints: 10 });
    expect(res.status).toBe(200);

    // 3 tied at 100, 1 winner -> 2 losers; the 50-point attempt is not a candidate
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('increment_user_points'); // not the non-existent `increment_users_points`
      expect(call[1]).toMatchObject({ p_delta: 10 });
    }
    const awardedIds = rpc.mock.calls.map((c) => c[1].p_user_id).sort();
    expect(awardedIds).toHaveLength(2);
    expect(awardedIds).not.toContain(json.winners[0].userId);
    expect(json.consolation).toEqual({ points: 10, losersAwarded: 2 });
  });

  it('reports only the awards that really succeeded', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: 10, error: null }).mockResolvedValueOnce({ data: null, error: new Error('nope') });
    const { json } = await draw({ numberOfWinners: 1, consolationPoints: 10 });
    expect(json.consolation.losersAwarded).toBe(1);
    spy.mockRestore();
  });

  it('does not touch points when there are no consolation points', async () => {
    const { json } = await draw({ numberOfWinners: 1, consolationPoints: 0 });
    expect(rpc).not.toHaveBeenCalled();
    expect(json.consolation.losersAwarded).toBe(0);
  });
});
