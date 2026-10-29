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
  beforeEach(() => {
    tables.QuizAdminSettings = { data: [], error: null };
    tables.LiveMatch = { data: [], error: null };
  });

  it('marks a quiz full once it has as many players as its entry limit (2,000 when none is saved), never sending the limit', async () => {
    tables.Quiz = { data: [quiz, { ...quiz, id: 'q2' }, { ...quiz, id: 'q3' }], error: null };
    tables.Question = { data: [], error: null };
    tables.QuizAdminSettings = { data: [{ quizId: 'q1', maxEntries: 42 }, { quizId: 'q2', maxEntries: 43 }], error: null };
    rpc.mockResolvedValue({ data: [
      { quiz_id: 'q1', attempt_count: '42' }, { quiz_id: 'q2', attempt_count: 42 }, { quiz_id: 'q3', attempt_count: 1999 },
    ], error: null });

    const { getActiveQuizCatalog } = await import('@/lib/quiz-catalog');
    const byId = Object.fromEntries((await getActiveQuizCatalog()).map((q) => [q.id, q]));
    expect(byId.q1.entriesClosed).toBe(true);
    expect(byId.q2.entriesClosed).toBe(false);
    expect(byId.q3.entriesClosed).toBe(false);
    expect(Object.keys(byId.q1)).not.toContain('maxEntries');
  });

  it('keeps every quiz open (and logs) when the entry limits cannot be read: the database still enforces them', async () => {
    tables.Quiz = { data: [quiz], error: null };
    tables.Question = { data: [], error: null };
    tables.QuizAdminSettings = { data: null, error: new Error('relation "QuizAdminSettings" does not exist') };
    rpc.mockResolvedValue({ data: [{ quiz_id: 'q1', attempt_count: 5000 }], error: null });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { getActiveQuizCatalog } = await import('@/lib/quiz-catalog');
    const [only] = await getActiveQuizCatalog();
    // 5,000 players is over the default 2,000, but this quiz may have a higher limit: it must not look full
    expect(only.entriesClosed).toBe(false);
    expect(spy).toHaveBeenCalledWith('[QuizCatalog] Quiz entry limits failed:', expect.anything());
    spy.mockRestore();
  });

  it('reads the `{ quiz_id, attempt_count }` rows the RPC really returns (it used to always show 0)', async () => {
    tables.Quiz = { data: [quiz, { ...quiz, id: 'q2' }], error: null };
    tables.Question = { data: [], error: null };
    rpc.mockResolvedValue({ data: [{ quiz_id: 'q1', attempt_count: '42' }], error: null });

    const { getActiveQuizCatalog } = await import('@/lib/quiz-catalog');
    const catalog = await getActiveQuizCatalog();
    expect(catalog.find((q) => q.id === 'q1')?.totalAttempts).toBe(42); // bigint arrives as a string
    expect(catalog.find((q) => q.id === 'q2')?.totalAttempts).toBe(0); // quiz with no attempts
  });

  it('offers only questions without a saved result, and treats a quiz whose questions all have one as over', async () => {
    const live = { ...quiz, status: 'active', pushedAt: new Date().toISOString() };
    tables.Quiz = { data: [
      { ...live, id: 'partly' },
      // Settled but never pushed, like "To win Sasung": it was listed forever, offering a closed question
      { ...live, id: 'settled', pushedAt: null },
      { ...live, id: 'pushed-done' },
      { ...live, id: 'empty' },
    ], error: null };
    tables.Question = { data: [
      { id: 'a', quizId: 'partly', text: 'Toss?', options: '["A","B"]', hasCorrectAnswer: true },
      { id: 'b', quizId: 'partly', text: 'Next ball?', options: '["Four","Six"]', hasCorrectAnswer: false },
      { id: 'c', quizId: 'settled', text: 'Winner?', options: '["X","Y"]', hasCorrectAnswer: true },
      { id: 'd', quizId: 'pushed-done', text: 'Wicket?', options: '["Yes","No"]', hasCorrectAnswer: true },
    ], error: null };
    rpc.mockResolvedValue({ data: [], error: null });

    const { getActiveQuizCatalog } = await import('@/lib/quiz-catalog');
    const catalog = await getActiveQuizCatalog();
    const byId = Object.fromEntries(catalog.map((q) => [q.id, q]));

    expect(byId.partly).toMatchObject({ status: 'active', ended: false, closedQuestionCount: 1, questions: [{ id: 'b', text: 'Next ball?', options: ['Four', 'Six'] }] });
    expect(byId.settled).toBeUndefined();
    // Pushed: listed as time-up until its window passes, with nothing to answer
    expect(byId['pushed-done']).toMatchObject({ status: 'paused', ended: true, closedQuestionCount: 1, questions: [] });
    // A quiz that has no questions yet is not "over"
    expect(byId.empty).toMatchObject({ status: 'active', ended: false, closedQuestionCount: 0, questions: [] });
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

// ── quiz catalogue: live matches ──────────────────────────────────────────────
describe('quiz catalogue live matches', () => {
  const quiz = {
    id: 'q1', title: 'Quiz', description: null, duration: 30, timeUpDuration: 60, passingScore: 70,
    status: 'active', accessPrice: 0, quizType: 'predictable', isBumperPrize: false, startsAt: null,
    pushedAt: null, createdAt: 'x', updatedAt: 'x',
  };
  const match = (over: Record<string, unknown> = {}) =>
    ({ id: 'm1', quizId: 'mq1', teamA: 'Lahore', teamB: 'Karachi', status: 'live', updatedAt: new Date().toISOString(), ...over });
  beforeEach(() => {
    tables.QuizAdminSettings = { data: [], error: null };
    tables.Question = { data: [], error: null };
    rpc.mockResolvedValue({ data: [], error: null });
  });

  it('keeps a match quiz out of the quiz list, and lists the matches taken live, finished ones for 2 hours', async () => {
    tables.Quiz = { data: [
      quiz,
      { ...quiz, id: 'mq1', title: 'Lahore vs Karachi' },
      { ...quiz, id: 'mq2', title: 'Old final' },
      { ...quiz, id: 'mq3', title: 'Just ended' },
      // Not live for players: never listed
      { ...quiz, id: 'mq4', title: 'Paused match', status: 'paused' },
    ], error: null };
    tables.LiveMatch = { data: [
      match(),
      match({ id: 'm2', quizId: 'mq2', status: 'completed', updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString() }),
      match({ id: 'm3', quizId: 'mq3', status: 'abandoned', updatedAt: new Date(Date.now() - 3600_000).toISOString() }),
      match({ id: 'm4', quizId: 'mq4' }),
      // A match whose quiz is a draft isn't in the quiz read at all
      match({ id: 'm5', quizId: 'draft' }),
    ], error: null };
    const { getActiveQuizCatalog, getLiveMatches } = await import('@/lib/quiz-catalog');
    expect((await getActiveQuizCatalog()).map((q) => q.id)).toEqual(['q1']);
    expect(await getLiveMatches()).toEqual([
      { id: 'm1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', status: 'live' },
      { id: 'm3', title: 'Just ended', teamA: 'Lahore', teamB: 'Karachi', status: 'abandoned' },
    ]);
  });

  it('lists the matches when there is no ordinary quiz, and fails rather than list a match as a quiz', async () => {
    tables.Quiz = { data: [{ ...quiz, id: 'mq1', title: 'Lahore vs Karachi' }], error: null };
    tables.LiveMatch = { data: [match()], error: null };
    const catalog = await import('@/lib/quiz-catalog');
    expect(await catalog.getActiveQuizCatalog()).toEqual([]);
    expect((await catalog.getLiveMatches()).map((m) => m.id)).toEqual(['m1']);

    vi.resetModules();
    tables.LiveMatch = { data: null, error: new Error('matches down') };
    const fresh = await import('@/lib/quiz-catalog');
    await expect(fresh.getActiveQuizCatalog()).rejects.toThrow('matches down');
    tables.LiveMatch = { data: null, error: null };
    tables.Quiz = { data: null, error: null };
    vi.resetModules();
    expect(await (await import('@/lib/quiz-catalog')).getLiveMatches()).toEqual([]);
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

