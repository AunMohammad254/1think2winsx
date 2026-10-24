// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, eqValue, argOf, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const createNotification = vi.fn();
const createBatchForUsers = vi.fn();
const invalidateQuizCatalog = vi.fn();

vi.mock('@/lib/supabase/db', async () => {
  const shared = await vi.importActual<typeof import('@/lib/supabase/db-modules/shared')>('@/lib/supabase/db-modules/shared');
  return {
    getAdminDb: () => adminDb.client,
    fetchAllByKeyset: shared.fetchAllByKeyset,
    notificationDb: {
      create: (...a: unknown[]) => createNotification(...a),
      createBatchForUsers: (...a: unknown[]) => createBatchForUsers(...a),
    },
  };
});

vi.mock('@/lib/quiz-catalog', () => ({ invalidateQuizCatalog: () => invalidateQuizCatalog() }));

const lib = await import('@/lib/quiz-settlement');

const NOW = Date.parse('2026-10-19T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
// fetchAllByKeyset pages until an empty page: answer the rows, then nothing
const paged = (rows: unknown[]) => [{ data: rows }, { data: [] }];
const quizRow = (over: Record<string, unknown> = {}) => ({
  id: 'q1', title: 'Agli ball', status: 'active', quizType: 'predictable', pushedAt: minutesAgo(60), duration: 10, ...over,
});

beforeEach(() => {
  adminDb = createSupabaseMock();
  createNotification.mockReset().mockResolvedValue({ id: 'n1' });
  invalidateQuizCatalog.mockReset();
  createBatchForUsers.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('parseOptions', () => {
  it('reads arrays and JSON text, and gives up on anything else', () => {
    expect(lib.parseOptions(['A', 2])).toEqual(['A', '2']);
    expect(lib.parseOptions('["Four","Six"]')).toEqual(['Four', 'Six']);
    expect(lib.parseOptions('{"a":1}')).toEqual([]);
    expect(lib.parseOptions('not json')).toEqual([]);
  });
});

describe('listSettlementQuizzes', () => {
  it('gives every quiz its stage and counts, plus the prizes that can be won', async () => {
    adminDb.setTable('Quiz', { data: [
      quizRow({ id: 'settled' }),
      quizRow({ id: 'ready', quizType: null }),
      quizRow({ id: 'open', pushedAt: null }),
      quizRow({ id: 'empty', pushedAt: minutesAgo(1) }),
    ] });
    adminDb.setTable('Prize', { data: [{ id: 'p1', name: 'Bike', category: 'bumper', stock: '3', imageUrl: null }, { id: 'p2', name: 'Watch', category: 'electronics', stock: null, imageUrl: 'w.png' }] });
    adminDb.setTable('Question', paged([
      { id: 'a', quizId: 'settled', hasCorrectAnswer: true },
      { id: 'b', quizId: 'ready', hasCorrectAnswer: true },
      { id: 'c', quizId: 'ready', hasCorrectAnswer: true },
      { id: 'd', quizId: 'open', hasCorrectAnswer: false },
    ]));
    adminDb.setTable('QuizSettlement', { data: [{ quizId: 'settled', settledAt: '2026-10-19T11:00:00Z' }] });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { data: [{ quiz_id: 'settled', attempt_count: '5' }, { quiz_id: 'ready', attempt_count: 'x' }] });

    const { quizzes, prizes } = await lib.listSettlementQuizzes(NOW);

    expect(quizzes.map((q) => [q.id, q.stage, q.totalQuestions, q.questionsWithResult, q.attempts])).toEqual([
      ['settled', 'settled', 1, 1, 5],
      ['ready', 'ready_to_settle', 2, 2, 0],
      ['open', 'open', 1, 0, 0],
      ['empty', 'open', 0, 0, 0],
    ]);
    expect(quizzes[0]).toMatchObject({ settledAt: '2026-10-19T11:00:00Z', quizType: 'predictable', closesAt: '2026-10-19T11:10:30.000Z' });
    expect(quizzes[1].quizType).toBe('normal');
    expect(quizzes[2].closesAt).toBeNull();
    expect(prizes).toEqual([
      { id: 'p1', name: 'Bike', category: 'bumper', stock: 3, imageUrl: null },
      { id: 'p2', name: 'Watch', category: 'electronics', stock: 0, imageUrl: 'w.png' },
    ]);
    // Only active prizes, active questions
    expect(eqValue(adminDb.callsTo('Prize')[0], 'isActive')).toBe(true);
    expect(eqValue(adminDb.callsTo('Question')[0], 'status')).toBe('active');
  });

  it('asks nothing more when there are no quizzes', async () => {
    adminDb.setTable('Quiz', { data: null });
    adminDb.setTable('Prize', { data: null });
    expect(await lib.listSettlementQuizzes(NOW)).toEqual({ quizzes: [], prizes: [] });
    expect(adminDb.callsTo('Question')).toHaveLength(0);
    expect(adminDb.rpcCalls).toHaveLength(0);
    expect(adminDb.callsTo('QuizSettlement')).toHaveLength(0);
  });

  it('reads attempt counts as none when the database returns nothing', async () => {
    adminDb.setTable('Quiz', { data: [quizRow()] });
    adminDb.setTable('Prize', { data: [] });
    adminDb.setTable('Question', { data: [] });
    adminDb.setTable('QuizSettlement', { data: null });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { data: null });
    const { quizzes } = await lib.listSettlementQuizzes(NOW);
    expect(quizzes[0]).toMatchObject({ attempts: 0, settledAt: null, stage: 'awaiting_result' });
  });

  it('fails loudly when a read fails', async () => {
    const boom = { message: 'down' };
    for (const broken of ['Quiz', 'Prize', 'QuizSettlement', 'Question', 'rpc'] as const) {
      adminDb = createSupabaseMock();
      adminDb.setTable('Quiz', { data: [quizRow()] });
      adminDb.setTable('Prize', { data: [] });
      adminDb.setTable('Question', { data: [] });
      adminDb.setTable('QuizSettlement', { data: [] });
      if (broken === 'rpc') adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { error: boom });
      else adminDb.setTable(broken, { error: boom });
      await expect(lib.listSettlementQuizzes(NOW)).rejects.toEqual(boom);
    }
  });
});

describe('getSettlementDetail', () => {
  it('returns null for an unknown quiz', async () => {
    adminDb.setTable('Quiz', { data: null });
    expect(await lib.getSettlementDetail('nope', NOW)).toBeNull();
  });

  it('gives the questions, hiding a correct option that is not saved as the result', async () => {
    adminDb.setTable('Quiz', { data: quizRow() });
    adminDb.setTable('Question', { data: [
      { id: 'a', text: 'Next ball?', options: '["Four","Six"]', correctOption: 1, hasCorrectAnswer: true },
      { id: 'b', text: 'Wicket?', options: ['Yes', 'No'], correctOption: 0, hasCorrectAnswer: false },
    ] });
    adminDb.setTable('QuizSettlement', { data: null });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { data: [{ quiz_id: 'q1', attempt_count: 2 }] });

    const detail = await lib.getSettlementDetail('q1', NOW);
    expect(detail).toMatchObject({
      quiz: { id: 'q1', stage: 'awaiting_result', totalQuestions: 2, questionsWithResult: 1, attempts: 2 },
      questions: [
        { id: 'a', text: 'Next ball?', options: ['Four', 'Six'], correctOption: 1 },
        { id: 'b', text: 'Wicket?', options: ['Yes', 'No'], correctOption: null },
      ],
      settlement: null,
    });
    expect(adminDb.callsTo('QuizWinner')).toHaveLength(0);
  });

  it("pre-fills a normal quiz's result with the answer key typed when it was made, which doesn't close the question", async () => {
    adminDb.setTable('Quiz', { data: quizRow({ quizType: 'normal' }) });
    adminDb.setTable('Question', { data: [
      { id: 'b', text: 'Capital of Pakistan?', options: ['Lahore', 'Islamabad'], correctOption: 1, hasCorrectAnswer: false },
    ] });
    adminDb.setTable('QuizSettlement', { data: null });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { data: [] });

    expect(await lib.getSettlementDetail('q1', NOW)).toMatchObject({
      quiz: { stage: 'awaiting_result', totalQuestions: 1, questionsWithResult: 0 },
      questions: [{ id: 'b', correctOption: 1 }],
    });
  });

  it('includes the winners of a settled quiz', async () => {
    adminDb.setTable('Quiz', { data: quizRow() });
    adminDb.setTable('Question', { data: null });
    adminDb.setTable('QuizSettlement', { data: { settledAt: '2026-10-19T11:00:00Z', settledBy: 'admin@x', tieRule: 'random', seed: 's' } });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { data: [] });
    adminDb.setTable('QuizWinner', { data: [
      { rank: 1, userId: 'u1', score: 100, selectionMethod: 'ranked', pointsAwarded: 0, prizeId: 'p1', User: [{ name: 'Ali', email: 'ali@x' }], Prize: { name: 'Bike', category: 'bumper' } },
      { rank: 2, userId: 'u2', score: 50, selectionMethod: 'ranked_random_tiebreak', pointsAwarded: 500, prizeId: null, User: null, Prize: [] },
    ] });

    const detail = await lib.getSettlementDetail('q1', NOW);
    expect(detail!.quiz.stage).toBe('settled');
    expect(detail!.settlement).toEqual({
      settledAt: '2026-10-19T11:00:00Z', settledBy: 'admin@x', tieRule: 'random', seed: 's',
      winners: [
        { rank: 1, userId: 'u1', name: 'Ali', email: 'ali@x', score: 100, selectionMethod: 'ranked', points: null, prizeId: 'p1', prizeName: 'Bike', prizeCategory: 'bumper' },
        { rank: 2, userId: 'u2', name: null, email: null, score: 50, selectionMethod: 'ranked_random_tiebreak', points: 500, prizeId: null, prizeName: null, prizeCategory: null },
      ],
      pool: { percent: 0, points: 0, recipients: 0 },
    });
    expect(eqValue(adminDb.callsTo('QuizWinner')[0], 'quizId')).toBe('q1');
    // No pool was paid, so nobody's shares are counted
    expect(adminDb.callsTo('QuizPoolShare')).toHaveLength(0);
  });

  it('gives the entry limit, the points pool and the pool a settlement shared', async () => {
    adminDb.setTable('Quiz', { data: quizRow() });
    adminDb.setTable('Question', { data: [] });
    adminDb.setTable('QuizAdminSettings', { data: [{ quizId: 'q1', maxEntries: 3, pointsPool: 50_000 }] });
    adminDb.setTable('QuizSettlement', { data: { settledAt: 't', settledBy: 'a', tieRule: 'random', seed: 's', poolPercent: '12.50', poolPoints: 6250 } });
    adminDb.setTable('QuizPoolShare', { data: null, count: 840 });
    adminDb.setTable('QuizWinner', { data: [] });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { data: [{ quiz_id: 'q1', attempt_count: 3 }] });

    const detail = await lib.getSettlementDetail('q1', NOW);
    expect(detail!.quiz).toMatchObject({ attempts: 3, maxEntries: 3, pointsPool: 50_000 });
    expect(detail!.settlement!.pool).toEqual({ percent: 12.5, points: 6250, recipients: 840 });
  });

  it('counts no pool recipients when the count is missing, and fails loudly when it cannot be read', async () => {
    adminDb.setTable('Quiz', { data: quizRow() });
    adminDb.setTable('Question', { data: [] });
    adminDb.setTable('QuizAdminSettings', { data: [] });
    adminDb.setTable('QuizSettlement', { data: { settledAt: 't', settledBy: 'a', tieRule: 'random', seed: 's', poolPercent: 10, poolPoints: 500 } });
    adminDb.setTable('QuizWinner', { data: [] });
    adminDb.setTable('QuizPoolShare', { data: null, count: null });
    expect((await lib.getSettlementDetail('q1', NOW))!.settlement!.pool).toEqual({ percent: 10, points: 500, recipients: 0 });
    adminDb.setTable('QuizPoolShare', { error: { message: 'denied' } });
    await expect(lib.getSettlementDetail('q1', NOW)).rejects.toEqual({ message: 'denied' });
  });

  it('uses the default limit and no pool before the migration, and fails loudly on any other read error', async () => {
    adminDb.setTable('Quiz', { data: quizRow() });
    adminDb.setTable('Question', { data: [] });
    adminDb.setTable('QuizAdminSettings', { error: { code: '42P01', message: 'relation "QuizAdminSettings" does not exist' } });
    adminDb.setTable('QuizSettlement', { data: null });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { data: [] });
    expect((await lib.getSettlementDetail('q1', NOW))!.quiz).toMatchObject({ maxEntries: 2000, pointsPool: 0 });
    // Showing "no pool" on a read error would let the admin settle, once and for good, without paying it
    adminDb.setTable('QuizAdminSettings', { error: { code: '57014', message: 'statement timeout' } });
    await expect(lib.getSettlementDetail('q1', NOW)).rejects.toEqual({ code: '57014', message: 'statement timeout' });
    adminDb.setTable('Quiz', { data: [quizRow()] });
    adminDb.setTable('Prize', { data: [] });
    adminDb.setTable('QuizSettlement', { data: [] });
    await expect(lib.listSettlementQuizzes(NOW)).rejects.toEqual({ code: '57014', message: 'statement timeout' });
  });

  it('settled with no winners rows yet reads as none', async () => {
    adminDb.setTable('Quiz', { data: quizRow() });
    adminDb.setTable('Question', { data: [] });
    adminDb.setTable('QuizSettlement', { data: { settledAt: 't', settledBy: 'a', tieRule: 'legacy', seed: '' } });
    adminDb.setTable('QuizWinner', { data: null });
    expect((await lib.getSettlementDetail('q1', NOW))!.settlement!.winners).toEqual([]);
  });

  it('fails loudly when a read fails', async () => {
    const boom = { message: 'down' };
    for (const broken of ['Quiz', 'Question', 'QuizSettlement', 'QuizWinner'] as const) {
      adminDb = createSupabaseMock();
      adminDb.setTable('Quiz', { data: quizRow() });
      adminDb.setTable('Question', { data: [] });
      adminDb.setTable('QuizSettlement', { data: { settledAt: 't', settledBy: 'a', tieRule: 'random', seed: 's' } });
      adminDb.setTable(broken, { error: boom });
      await expect(lib.getSettlementDetail('q1', NOW)).rejects.toEqual(boom);
    }
  });
});

describe('saveQuizResult', () => {
  const questions = [
    { id: 'a', text: 'Next ball?', options: '["Four","Six"]', correctOption: null, hasCorrectAnswer: false },
    { id: 'b', text: 'Wicket?', options: '["Yes","No"]', correctOption: null, hasCorrectAnswer: false },
  ];
  const setup = (quiz: Record<string, unknown> = {}, settled = false, qs: unknown[] = questions) => {
    adminDb.setTable('Quiz', { data: quizRow(quiz) });
    adminDb.setTable('Question', { data: qs });
    adminDb.setTable('QuizSettlement', { data: settled ? { settledAt: 't', settledBy: 'a', tieRule: 'random', seed: 's' } : null });
    adminDb.setTable('QuizWinner', { data: [] });
    adminDb.setRpc('evaluate_question', { data: { success: true } });
    adminDb.setRpc('finalize_quiz_scores', { data: { success: true, evaluatedAttempts: 3 } });
  };

  it('saves the correct option of every question, then scores the attempts', async () => {
    setup();
    expect(await lib.saveQuizResult('q1', { a: 1, b: 0 }, false, NOW)).toEqual({ ok: true });
    expect(adminDb.rpcCalls.filter((c) => c.fn !== 'get_quiz_attempt_counts_by_quiz')).toEqual([
      { fn: 'evaluate_question', args: { p_question_id: 'a', p_correct_option: 1 } },
      { fn: 'evaluate_question', args: { p_question_id: 'b', p_correct_option: 0 } },
      { fn: 'finalize_quiz_scores', args: { p_quiz_id: 'q1' } },
    ]);
    // Players stop being offered the now-closed questions at once, not when the catalogue's cache expires
    expect(invalidateQuizCatalog).toHaveBeenCalledTimes(1);
  });

  it('ends an open quiz only when the admin says so', async () => {
    setup({ pushedAt: minutesAgo(1) });
    expect(await lib.saveQuizResult('q1', { a: 1, b: 0 }, false, NOW)).toEqual({
      ok: false, status: 409, code: 'still_open', error: 'Players can still answer. End the quiz to save its result.',
    });
    expect(await lib.saveQuizResult('q1', { a: 1, b: 0 }, true, NOW)).toEqual({ ok: true });
  });

  it('refuses unknown, settled and not-yet-started quizzes', async () => {
    adminDb.setTable('Quiz', { data: null });
    expect(await lib.saveQuizResult('nope', {}, false, NOW)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
    setup({}, true);
    expect(await lib.saveQuizResult('q1', { a: 1, b: 0 }, false, NOW)).toMatchObject({ ok: false, status: 409, code: 'already_settled' });
    setup({ status: 'upcoming' });
    expect(await lib.saveQuizResult('q1', { a: 1, b: 0 }, false, NOW)).toMatchObject({ ok: false, status: 409, code: 'not_started' });
  });

  it('needs a valid option for every question', async () => {
    setup({}, false, []);
    expect(await lib.saveQuizResult('q1', {}, false, NOW)).toMatchObject({ status: 400, error: 'This quiz has no active questions' });
    setup();
    const invalid: Array<Record<string, number>> = [{ a: 1 }, { a: 1, b: 2 }, { a: -1, b: 0 }, { a: 0.5, b: 0 }];
    for (const answers of invalid) {
      const r = await lib.saveQuizResult('q1', answers, false, NOW);
      expect(r).toMatchObject({ ok: false, status: 400, code: 'invalid' });
    }
    expect(await lib.saveQuizResult('q1', { a: 1 }, false, NOW)).toMatchObject({ error: 'Choose the correct option for: Wicket?' });
  });

  it('throws when the database refuses', async () => {
    setup();
    adminDb.setRpc('evaluate_question', { data: { success: false } });
    await expect(lib.saveQuizResult('q1', { a: 1, b: 0 }, false, NOW)).rejects.toThrow('evaluate_question failed for a');
    adminDb.setRpc('evaluate_question', { error: { message: 'rls' } });
    await expect(lib.saveQuizResult('q1', { a: 1, b: 0 }, false, NOW)).rejects.toEqual({ message: 'rls' });
    adminDb.setRpc('evaluate_question', { data: { success: true } });
    adminDb.setRpc('finalize_quiz_scores', { data: null });
    await expect(lib.saveQuizResult('q1', { a: 1, b: 0 }, false, NOW)).rejects.toThrow('finalize_quiz_scores failed');
    adminDb.setRpc('finalize_quiz_scores', { error: { message: 'x' } });
    await expect(lib.saveQuizResult('q1', { a: 1, b: 0 }, false, NOW)).rejects.toEqual({ message: 'x' });
  });
});

describe('runSettlement', () => {
  it('calls settle_quiz with every argument and returns its answer', async () => {
    const answer = { success: true, winners: [] };
    adminDb.setRpc('settle_quiz', { data: answer });
    const r = await lib.runSettlement({ quizId: 'q1', rewards: [{ rank: 1, points: 5 }], tieRule: 'earliest', seed: 's'.repeat(16), settledBy: 'admin@x', dryRun: true, poolPercent: 12.5 });
    expect(r).toEqual(answer);
    expect(adminDb.rpcCalls[0]).toEqual({ fn: 'settle_quiz', args: {
      p_quiz_id: 'q1', p_rewards: [{ rank: 1, points: 5 }], p_tie_rule: 'earliest', p_seed: 's'.repeat(16), p_settled_by: 'admin@x', p_dry_run: true,
      p_pool_percent: 12.5,
    } });
  });

  it('throws a database error', async () => {
    adminDb.setRpc('settle_quiz', { error: { message: 'boom' } });
    await expect(lib.runSettlement({ quizId: 'q1', rewards: [], tieRule: 'random', seed: 'x', settledBy: 'a', dryRun: false, poolPercent: 0 })).rejects.toEqual({ message: 'boom' });
  });
});

describe('notifySettlement', () => {
  const winner = (over: Record<string, unknown>) => ({
    rank: 1, userId: 'u1', name: 'Ali', email: 'a@x', score: 100, tiedWith: 0, selectionMethod: 'ranked',
    points: null, prizeId: null, prizeName: null, prizeCategory: null, ...over,
  });
  const result = (winners: unknown[], recipientIds: string[] = []) => ({
    success: true as const, quizId: 'q1', quizTitle: 'Agli ball', participants: 4, questions: 1, tieRule: 'random' as const,
    seed: 's', winners: winners as never, unfilled: [],
    pool: { percent: recipientIds.length ? 10 : 0, poolSize: 1000, target: 1000, places: recipientIds.length, paid: recipientIds.length ? 1000 : 0,
      eligible: 3, recipients: recipientIds.length, min: 0, max: 0, recipientIds },
  });

  it('gives pool recipients one bonus notice, and leaves them out of the results-in batch', async () => {
    adminDb.setTable('QuizWinner', { data: null });
    adminDb.setTable('QuizAttempt', paged([{ id: 'a1', userId: 'u1' }, { id: 'a2', userId: 'u2' }, { id: 'a3', userId: 'u3' }]));

    expect(await lib.notifySettlement(result([winner({ points: 50 })], ['u1', 'u2']))).toBe(true);

    // The quiz in the link lets a resend tell this bonus notice from another quiz's
    expect(createBatchForUsers).toHaveBeenNthCalledWith(1, ['u1', 'u2'], {
      title: '🎁 Bonus points', message: 'You received bonus points in "Agli ball". See your profile for your points.', type: 'prize_won', link: '/profile?quiz=q1',
    });
    // Right after settling nobody has a notice yet, so nobody is looked up
    expect(adminDb.callsTo('Notification')).toHaveLength(0);
    expect(createBatchForUsers).toHaveBeenNthCalledWith(2, ['u3'], expect.objectContaining({ title: '🏅 Results are in' }));
  });

  it('tells each winner what they won and everyone else that results are in', async () => {
    adminDb.setTable('QuizWinner', { data: null });
    adminDb.setTable('QuizAttempt', paged([{ id: 'a1', userId: 'u1' }, { id: 'a2', userId: 'u2' }, { id: 'a3', userId: 'u3' }, { id: 'a4', userId: 'u3' }]));

    expect(await lib.notifySettlement(result([
      winner({ prizeId: 'p1', prizeName: 'Mystery bike', prizeCategory: 'bumper' }),
      winner({ rank: 2, userId: 'u2', points: 500 }),
    ]))).toBe(true);

    expect(createNotification).toHaveBeenNthCalledWith(1, 'u1', {
      title: '🏆 You placed 1st!', message: 'You won Mystery bike in "Agli ball". Our team will contact you about delivery.', type: 'prize_won', link: '/profile',
    });
    expect(createNotification).toHaveBeenNthCalledWith(2, 'u2', {
      title: '🏆 You placed 2nd!', message: 'You won 500 points in "Agli ball".', type: 'prize_won', link: '/profile',
    });
    // Marked one winner at a time, so a failure part-way leaves only the rest to a resend
    const updates = adminDb.callsTo('QuizWinner', 'update');
    expect(updates.map((u) => [eqValue(u, 'quizId'), eqValue(u, 'userId')])).toEqual([['q1', 'u1'], ['q1', 'u2']]);
    expect(argOf(updates[0], 'update')).toMatchObject({ notificationSent: true });
    expect(createBatchForUsers).toHaveBeenCalledWith(['u3'], {
      title: '🏅 Results are in', message: 'Results for "Agli ball" are in. See how you did.', type: 'general', link: '/quiz/q1/results',
    });
  });

  it('sends no bonus notice for a settlement from a database without the pool yet', async () => {
    adminDb.setTable('QuizAttempt', paged([{ id: 'a1', userId: 'u1' }]));
    const { pool: _pool, ...noPool } = result([]);
    expect(await lib.notifySettlement(noPool as never)).toBe(true);
    expect(createBatchForUsers).toHaveBeenCalledTimes(1);
    expect(createBatchForUsers).toHaveBeenCalledWith(['u1'], expect.objectContaining({ title: '🏅 Results are in' }));
  });

  it('with no winners, only announces the results', async () => {
    adminDb.setTable('QuizAttempt', paged([{ id: 'a1', userId: 'u1' }]));
    expect(await lib.notifySettlement(result([]))).toBe(true);
    expect(createNotification).not.toHaveBeenCalled();
    expect(adminDb.callsTo('QuizWinner')).toHaveLength(0);
    expect(createBatchForUsers).toHaveBeenCalledWith(['u1'], expect.any(Object));
  });

  it('copes with a quiz nobody finished', async () => {
    adminDb.setTable('QuizAttempt', { data: null });
    expect(await lib.notifySettlement(result([]))).toBe(true);
    expect(createBatchForUsers).toHaveBeenCalledWith([], expect.any(Object));
  });

  it('reports failure without throwing: the rewards are already paid', async () => {
    adminDb.setTable('QuizWinner', { error: { message: 'denied' } });
    expect(await lib.notifySettlement(result([winner({ points: 5 })]))).toBe(false);
    createNotification.mockRejectedValueOnce(new Error('push down'));
    expect(await lib.notifySettlement(result([winner({ points: 5 })]))).toBe(false);
    expect(console.error).toHaveBeenCalledWith('[quiz-settlement] Notifying players failed:', expect.anything());
  });
});

describe('resendSettlementNotices', () => {
  /** A settled quiz: u1 (1st, told already), u2 (2nd, not told), pool to u3 and u4, and u5, u6 who only entered. */
  const settled = (over: { settlement?: unknown; winners?: unknown[] } = {}) => {
    adminDb.setTable('Quiz', { data: { id: 'q1', title: 'Agli ball' } });
    adminDb.setTable('QuizSettlement', { data: 'settlement' in over ? over.settlement : { quizId: 'q1' } });
    adminDb.setTable('QuizWinner', (call) => (call.ops.some((o) => o.op === 'update') ? { error: null } : {
      data: over.winners ?? [
        { rank: 1, userId: 'u1', pointsAwarded: 0, notificationSent: true, Prize: [{ name: 'Mystery bike' }] },
        { rank: 2, userId: 'u2', pointsAwarded: 500, notificationSent: false, Prize: null },
      ],
    }));
    adminDb.setTable('QuizPoolShare', paged([{ userId: 'u3' }, { userId: 'u4' }]));
    adminDb.setTable('QuizAttempt', paged(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((u, i) => ({ id: `a${i}`, userId: u }))));
  };
  /** Who already has each notice, answered per lookup from the ids it asked about. */
  const alreadyHave = (byTitle: Record<string, string[]>) => adminDb.setTable('Notification', (call) => {
    const asked = (call.ops.find((o) => o.op === 'in')?.args[1] ?? []) as string[];
    const have = byTitle[eqValue(call, 'title') as string] ?? [];
    return { data: asked.filter((id) => have.includes(id)).map((userId) => ({ userId })) };
  });

  it('sends only the notices players do not have yet', async () => {
    settled();
    alreadyHave({ '🎁 Bonus points': ['u3'], '🏅 Results are in': ['u5'] });

    expect(await lib.resendSettlementNotices('q1')).toEqual({ ok: true, notified: true });

    // u1 was told (notificationSent); u2 was not, and is marked once told
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith('u2', {
      title: '🏆 You placed 2nd!', message: 'You won 500 points in "Agli ball".', type: 'prize_won', link: '/profile',
    });
    expect(eqValue(adminDb.callsTo('QuizWinner', 'update')[0], 'userId')).toBe('u2');
    expect(createBatchForUsers).toHaveBeenNthCalledWith(1, ['u4'], expect.objectContaining({ title: '🎁 Bonus points', link: '/profile?quiz=q1' }));
    expect(createBatchForUsers).toHaveBeenNthCalledWith(2, ['u6'], expect.objectContaining({ title: '🏅 Results are in', link: '/quiz/q1/results' }));
    // Each lookup is filtered to its own notice
    const lookups = adminDb.callsTo('Notification');
    expect(lookups.map((c) => [eqValue(c, 'title'), eqValue(c, 'link')])).toEqual([
      ['🎁 Bonus points', '/profile?quiz=q1'],
      ['🏅 Results are in', '/quiz/q1/results'],
    ]);
  });

  it("names a winner's prize from either shape of the join, and skips the bonus notice when everyone has it", async () => {
    settled({ winners: [
      { rank: 1, userId: 'u1', pointsAwarded: 0, notificationSent: false, Prize: { name: 'Smartwatch' } },
      { rank: 3, userId: 'u2', pointsAwarded: 0, notificationSent: false, Prize: [] },
    ] });
    alreadyHave({ '🎁 Bonus points': ['u3', 'u4'] });
    expect((await lib.resendSettlementNotices('q1')).ok).toBe(true);
    expect(createNotification).toHaveBeenNthCalledWith(1, 'u1', expect.objectContaining({ message: expect.stringContaining('You won Smartwatch') }));
    expect(createNotification).toHaveBeenNthCalledWith(2, 'u2', expect.objectContaining({ title: '🏆 You placed 3rd!' }));
    expect(createBatchForUsers).toHaveBeenCalledTimes(1);
    expect(createBatchForUsers).toHaveBeenCalledWith(['u5', 'u6'], expect.objectContaining({ title: '🏅 Results are in' }));
  });

  it('looks players up 200 at a time', async () => {
    settled({ winners: [] });
    adminDb.setTable('QuizPoolShare', paged([]));
    adminDb.setTable('QuizAttempt', paged(Array.from({ length: 450 }, (_, i) => ({ id: `a${String(i).padStart(3, '0')}`, userId: `p${i}` }))));
    adminDb.setTable('Notification', { data: null });
    expect((await lib.resendSettlementNotices('q1')).ok).toBe(true);
    expect(adminDb.callsTo('Notification').map((c) => (c.ops.find((o) => o.op === 'in')!.args[1] as string[]).length)).toEqual([200, 200, 50]);
    expect((createBatchForUsers.mock.calls[0][0] as string[]).length).toBe(450);
  });

  it('reports a failed lookup as a failed send', async () => {
    settled();
    adminDb.setTable('Notification', { error: { message: 'timeout' } });
    expect(await lib.resendSettlementNotices('q1')).toEqual({ ok: true, notified: false });
  });

  it('refuses a quiz that does not exist or is not settled', async () => {
    adminDb.setTable('Quiz', { data: null });
    expect(await lib.resendSettlementNotices('nope')).toEqual({ ok: false, status: 404, code: 'not_found', error: 'Quiz not found' });
    settled({ settlement: null });
    expect(await lib.resendSettlementNotices('q1')).toEqual({ ok: false, status: 409, code: 'not_settled', error: 'This quiz has not been settled yet' });
    expect(createNotification).not.toHaveBeenCalled();
    expect(createBatchForUsers).not.toHaveBeenCalled();
  });

  it.each(['Quiz', 'QuizSettlement', 'QuizWinner'])('throws when reading %s fails', async (table) => {
    settled({ winners: [] });
    adminDb.setTable(table, { error: { message: `${table} down` } });
    await expect(lib.resendSettlementNotices('q1')).rejects.toEqual({ message: `${table} down` });
  });

  it('copes with no winner rows at all', async () => {
    settled();
    adminDb.setTable('QuizWinner', { data: null });
    adminDb.setTable('Notification', { data: [] });
    expect(await lib.resendSettlementNotices('q1')).toEqual({ ok: true, notified: true });
    expect(createNotification).not.toHaveBeenCalled();
  });
});
