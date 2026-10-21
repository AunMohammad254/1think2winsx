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

