// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const adminActionGuard = vi.fn();
const revalidatePath = vi.fn();
const clearQuizListCache = vi.fn();
const quizDb = { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findById: vi.fn() };
const questionDb = { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findByQuizId: vi.fn() };
const createBroadcast = vi.fn();
let nextId = 0;

vi.mock('@/lib/supabase/db', () => ({
  quizDb, questionDb, notificationDb: { createBroadcast: (...a: unknown[]) => createBroadcast(...a) }, getAdminDb: () => adminDb.client,
  generateId: () => `id-${++nextId}`,
}));
vi.mock('@/lib/admin-guard', () => ({ adminActionGuard: (...a: unknown[]) => adminActionGuard(...a) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
// after() runs its callback once the response is sent: here, when a test calls afterResponse()
const afterQueue: Array<() => unknown> = [];
vi.mock('next/server', () => ({ after: (cb: () => unknown) => { afterQueue.push(cb); } }));
const afterResponse = async () => { while (afterQueue.length) await afterQueue.shift()!(); };
vi.mock('@/lib/quiz-cache', () => ({ clearQuizListCache: (...a: unknown[]) => clearQuizListCache(...a) }));

const actions = await import('@/actions/quiz-actions');
const { UPCOMING_NOTICE_TITLE } = await import('@/lib/quiz-scheduler');

const DENIED = { success: false, error: 'Unauthorized: admin session required' };
const question = (over: Record<string, unknown> = {}) => ({ text: 'Who wins?', options: [{ text: 'A', isCorrect: false }, { text: 'B', isCorrect: true }], correctOption: 1, ...over });
const quizInput = (over: Record<string, unknown> = {}) => ({ title: 'Cricket night', duration: 10, passingScore: 60, status: 'draft', questions: [question()], ...over });
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
type SaveQuizArgs = { p_quiz_id: string; p_create: boolean; p_quiz: Record<string, unknown>; p_questions: Record<string, unknown>[]; p_settings: unknown };
const saveCalls = () => adminDb.rpcCalls.filter((c) => c.fn === 'save_quiz');
/** The arguments of the i-th save_quiz call (the quiz, its questions and settings, saved as one). */
const saved = (i = 0) => saveCalls()[i].args as SaveQuizArgs;

beforeEach(() => {
  adminDb = createSupabaseMock({ rpc: { save_quiz: { data: { success: true } } } });
  afterQueue.length = 0;
  nextId = 0;
  for (const fn of [adminActionGuard, revalidatePath, clearQuizListCache, createBroadcast, ...Object.values(quizDb), ...Object.values(questionDb)]) fn.mockReset();
  adminActionGuard.mockResolvedValue(null);
  quizDb.create.mockImplementation(async (d: Record<string, unknown>) => ({ id: 'quiz-1', ...d }));
  quizDb.update.mockImplementation(async (id: string, d: Record<string, unknown>) => ({ id, title: 'Cricket night', ...d }));
  questionDb.findByQuizId.mockResolvedValue([]);
  createBroadcast.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('every admin quiz action', () => {
  it('refuses without an admin session', async () => {
    adminActionGuard.mockResolvedValue(DENIED);
    for (const result of [
      await actions.createQuiz(quizInput() as never), await actions.updateQuiz({ id: 'q', ...quizInput() } as never), await actions.deleteQuiz('q'),
      await actions.publishQuiz('q'), await actions.pauseQuiz('q'), await actions.pushQuizLive('q'), await actions.notifyUpcomingQuiz('q'),
    ]) expect(result).toEqual(DENIED);
    expect(quizDb.create).not.toHaveBeenCalled();
  });
});

describe('createQuiz', () => {
  it('saves the quiz, its questions and its settings in one database call, leaving the questions open', async () => {
    const res = await actions.createQuiz(quizInput({ startsAt: '2026-11-01T18:00:00Z', prizeId: 'p1' }) as never);
    expect(res).toEqual({ success: true, data: { id: 'id-1' }, message: 'Quiz created successfully!' });
    // One transaction: saving the quiz, then each question, then the settings left half-saved quizzes.
    // The answer key comes from the ticked option; save_quiz stores new questions with hasCorrectAnswer
    // false, which would otherwise close them (submit_quiz_attempt refused every answer)
    expect(saved()).toEqual({
      p_quiz_id: 'id-1',
      p_create: true,
      p_quiz: {
        title: 'Cricket night', description: null, duration: 10, timeUpDuration: 60, passingScore: 60, status: 'draft',
        startsAt: '2026-11-01T18:00:00.000Z', prizeId: 'p1', isBumperPrize: false, quizType: 'normal',
      },
      p_questions: [{ id: 'id-2', isNew: true, text: 'Who wins?', status: 'active', correctOption: 1, options: '["A","B"]' }],
      p_settings: { maxEntries: 2000, pointsPool: 0 },
    });
    expect(createBroadcast).not.toHaveBeenCalled();
    expect(clearQuizListCache).toHaveBeenCalled();
  });

  it('never saves the access price (or difficulty) from the form', async () => {
    await actions.createQuiz(quizInput({ accessPrice: 50, difficulty: 'hard' }) as never);
    expect(saved().p_quiz).not.toHaveProperty('accessPrice');
    expect(saved().p_quiz).not.toHaveProperty('difficulty');
  });

  it('saves NO answer key when correctOption is set but no option is ticked', async () => {
    await actions.createQuiz(quizInput({ questions: [question({ options: [{ text: 'A' }, { text: 'B' }], correctOption: 1 })] }) as never);
    expect(saved().p_questions[0]).toMatchObject({ correctOption: null });
  });

  it('stores prediction questions without an answer key', async () => {
    await actions.createQuiz(quizInput({ quizType: 'predictable', questions: [question({ correctOption: null })] }) as never);
    expect(saved().p_questions[0]).toMatchObject({ correctOption: null });
  });

  it('announces an active quiz after the response, surviving a failed broadcast', async () => {
    await actions.createQuiz(quizInput({ status: 'active', isBumperPrize: true }) as never);
    // The admin's click doesn't wait for one notification per user
    expect(createBroadcast).not.toHaveBeenCalled();
    expect(clearQuizListCache).toHaveBeenCalled();
    await afterResponse();
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      title: '🎮 New Quiz Published!', message: expect.stringContaining('"Cricket night"'), link: '/quizzes?openQuiz=id-1',
    }));
    createBroadcast.mockRejectedValueOnce(new Error('push'));
    expect((await actions.createQuiz(quizInput({ status: 'active' }) as never)).success).toBe(true);
    await afterResponse();
    expect(console.error).toHaveBeenCalledWith('Failed to send quiz publication broadcast notification:', expect.any(Error));
  });

  it('validates the input, including a start time for scheduled quizzes', async () => {
    const res = await actions.createQuiz(quizInput({ title: 'x', status: 'scheduled' }) as never);
    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toMatch(/Title must be at least 3 characters.*Pick a valid date and time/);
    expect((await actions.createQuiz(quizInput({ questions: [question({ correctOption: null })] }) as never) as { error: string }).error).toBe('Correct option must be selected for normal quizzes');
    expect(saveCalls()).toHaveLength(0);
  });

  it('saves the entry limit and points pool in the admin-only settings, never on the quiz', async () => {
    await actions.createQuiz(quizInput({ maxEntries: 500, pointsPool: 25_000 }) as never);
    expect(saved().p_settings).toEqual({ maxEntries: 500, pointsPool: 25_000 });
    expect(saved().p_quiz).not.toHaveProperty('maxEntries');
    expect(saved().p_quiz).not.toHaveProperty('pointsPool');
    const bad = await actions.createQuiz(quizInput({ maxEntries: 0, pointsPool: -5 }) as never);
    expect((bad as { error: string }).error).toBe('Entry limit must be at least 1, Points pool must be 0 or more');
  });

  it('relays a refusal without announcing the quiz or refreshing the lists', async () => {
    adminDb.setRpc('save_quiz', { data: { success: false, code: 'invalid', error: 'A quiz needs at least one question' } });
    expect(await actions.createQuiz(quizInput({ status: 'active' }) as never)).toEqual({ success: false, error: 'A quiz needs at least one question', code: 'INVALID' });
    await afterResponse();
    expect(createBroadcast).not.toHaveBeenCalled();
    expect(clearQuizListCache).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('relays database errors', async () => {
    adminDb.setRpc('save_quiz', { error: { message: 'duplicate title' } });
    expect(await actions.createQuiz(quizInput() as never)).toEqual({ success: false, error: 'duplicate title' });
    adminDb.setRpc('save_quiz', { error: {} as never });
    expect(await actions.createQuiz(quizInput() as never)).toEqual({ success: false, error: 'Failed to create quiz. Please try again.' });
  });
});

describe('updateQuiz', () => {
  it('saves the quiz and its questions in one call: kept ones updated, new ones added, left-out ones removed', async () => {
    questionDb.findByQuizId.mockResolvedValue([{ id: 'keep', options: '["A","B"]' }, { id: 'reworded', options: '["A","B"]' }, { id: 'drop', options: '["A","B"]' }]);
    const res = await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ maxEntries: 300, questions: [
      question({ id: 'keep' }),
      question({ id: 'reworded', options: [{ text: 'A', isCorrect: true }, { text: 'B' }, { text: 'C' }], correctOption: 0 }),
      question({ text: 'Who scores most?', options: [{ text: 'C', isCorrect: true }, { text: 'D' }], correctOption: 0 }),
    ] }) } as never);
    expect(res).toEqual({ success: true, message: 'Quiz updated successfully!' });
    // save_quiz deletes "drop" (left out), keeps a saved result's key, and is all or nothing
    expect(saved()).toMatchObject({
      p_quiz_id: 'quiz-1',
      p_create: false,
      p_quiz: { title: 'Cricket night', status: 'draft', quizType: 'normal' },
      p_settings: { maxEntries: 300, pointsPool: 0 },
    });
    expect(saved().p_questions).toEqual([
      // Unchanged options are not sent: the database refuses any options write to an answered question
      { id: 'keep', text: 'Who wins?', status: 'active', correctOption: 1 },
      { id: 'reworded', text: 'Who wins?', status: 'active', correctOption: 0, options: '["A","B","C"]' },
      { id: 'id-1', isNew: true, text: 'Who scores most?', status: 'active', correctOption: 0, options: '["C","D"]' },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/quiz/quiz-1');
    expect(clearQuizListCache).toHaveBeenCalled();
  });

  it('refuses, before saving anything, to remove an answered question or change its options', async () => {
    // Removing the question used to delete every player's answer to it; new options re-mapped them
    questionDb.findByQuizId.mockResolvedValue([{ id: 'keep', text: 'Who wins?', options: '["A","B"]' }, { id: 'drop', text: 'Toss winner?', options: '["A","B"]' }]);
    adminDb.setTable('Answer', (call) => ({ data: eqValue(call, 'questionId') === 'drop' ? [{ id: 'ans-1' }] : [] }));
    const removed = await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ questions: [question({ id: 'keep' })] }) } as never);
    expect(removed).toEqual({
      success: false,
      code: 'QUESTION_ANSWERED',
      error: 'Players have already answered "Toss winner?", so it can\'t be removed and its options can\'t change. You can still edit its wording.',
    });
    const reordered = await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ questions: [
      question({ id: 'keep' }),
      question({ id: 'drop', options: [{ text: 'B', isCorrect: true }, { text: 'A' }] }),
    ] }) } as never);
    expect(reordered.success).toBe(false);
    expect(saveCalls()).toHaveLength(0);

    // New wording is fine, and the unchanged options are not rewritten
    expect((await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ questions: [question({ id: 'keep' }), question({ id: 'drop', text: 'Who won the toss?' })] }) } as never)).success).toBe(true);
    expect(saved().p_questions[1]).toEqual({ id: 'drop', text: 'Who won the toss?', status: 'active', correctOption: 1 });
  });

  it('names how many more answered questions an edit would hit', async () => {
    questionDb.findByQuizId.mockResolvedValue([{ id: 'a', text: 'First?' }, { id: 'b', text: 'Second?' }, { id: 'c', text: 'Third?' }]);
    adminDb.setTable('QuestionAttempt', { data: [{ id: 'qa' }] });
    const res = await actions.updateQuiz({ id: 'quiz-1', ...quizInput() } as never);
    expect(res).toMatchObject({ success: false, error: expect.stringContaining('"First?" (and 2 more)') });
  });

  it('reports an answer that arrived during the edit, and other refusals, leaving the quiz as it was', async () => {
    questionDb.findByQuizId.mockResolvedValue([{ id: 'q1', options: '["A","B"]' }]);
    const edit = () => actions.updateQuiz({ id: 'quiz-1', ...quizInput({ questions: [question({ id: 'q1' })] }) } as never);
    // The database's own guard (protect_answered_question) undid the whole save
    adminDb.setRpc('save_quiz', { data: { success: false, code: 'question_answered', error: 'Question q1 has answers' } });
    expect(await edit()).toEqual({
      success: false,
      code: 'QUESTION_ANSWERED',
      error: "Players answered one of these questions while you were editing, so it can't be removed and its options can't change. Reload the quiz and try again.",
    });
    adminDb.setRpc('save_quiz', { data: { success: false, code: 'stale', error: 'A question of this quiz was removed in the meantime. Reload the quiz and try again.' } });
    expect(await edit()).toEqual({ success: false, code: 'STALE', error: 'A question of this quiz was removed in the meantime. Reload the quiz and try again.' });
    adminDb.setRpc('save_quiz', { data: { success: false } });
    expect(await edit()).toEqual({ success: false, code: 'INVALID', error: 'Failed to save the quiz' });
    expect(clearQuizListCache).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('stores prediction questions without a key and needs an id', async () => {
    questionDb.findByQuizId.mockResolvedValue([{ id: 'q1', options: '["A","B"]' }]);
    await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ quizType: 'predictable', questions: [question({ id: 'q1', correctOption: null })] }) } as never);
    expect(saved(0).p_questions[0]).toMatchObject({ id: 'q1', correctOption: null });
    await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ questions: [question({ id: 'q1', options: [{ text: 'A' }, { text: 'B' }] })] }) } as never);
    expect(saved(1).p_questions[0]).toMatchObject({ id: 'q1', correctOption: null });
    expect(await actions.updateQuiz(quizInput() as never)).toEqual({ success: false, error: 'Quiz ID is required' });
  });

  it('validates and reports failures', async () => {
    expect((await actions.updateQuiz({ id: 'q', ...quizInput({ duration: 0 }) } as never)).success).toBe(false);
    adminDb.setRpc('save_quiz', { error: { message: 'x' } });
    expect(await actions.updateQuiz({ id: 'q', ...quizInput() } as never)).toEqual({ success: false, error: 'Failed to update quiz. Please try again.' });
  });
});

describe('delete, publish, pause and push', () => {
  it('deleteQuiz', async () => {
    expect(await actions.deleteQuiz('q')).toEqual({ success: true, message: 'Quiz deleted successfully!' });
    quizDb.delete.mockRejectedValueOnce(new Error('fk'));
    expect((await actions.deleteQuiz('q')).success).toBe(false);
  });

  it('deleteQuiz refuses a settled quiz, which would erase its winners and payouts', async () => {
    adminDb.setTable('QuizSettlement', { count: 1 });
    expect(await actions.deleteQuiz('q')).toEqual({
      success: false,
      code: 'QUIZ_SETTLED',
      error: 'This quiz has been settled: deleting it would erase who won and what was paid. Pause it instead.',
    });
    // Winners from before settlements existed count too
    adminDb.setTable('QuizSettlement', { count: 0 });
    adminDb.setTable('QuizWinner', { count: 2 });
    expect((await actions.deleteQuiz('q')).success).toBe(false);
    // And a failed check never lets the delete through
    adminDb.setTable('QuizWinner', { error: { message: 'timeout' } });
    expect(await actions.deleteQuiz('q')).toEqual({ success: false, error: 'Failed to delete quiz. Please try again.' });
    expect(quizDb.delete).not.toHaveBeenCalled();
  });

  it('publishQuiz needs questions and announces the quiz', async () => {
    expect(await actions.publishQuiz('q')).toEqual({ success: false, error: 'Cannot publish quiz without questions' });
    questionDb.findByQuizId.mockResolvedValue([{ id: 'x' }]);
    expect((await actions.publishQuiz('q')).success).toBe(true);
    expect(quizDb.update).toHaveBeenCalledWith('q', { status: 'active' });
    await afterResponse();
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('"Cricket night"') }));

    quizDb.update.mockResolvedValueOnce({ id: 'q', title: '' });
    createBroadcast.mockRejectedValueOnce(new Error('push'));
    expect((await actions.publishQuiz('q')).success).toBe(true);
    await afterResponse();
    quizDb.update.mockResolvedValueOnce(null);
    createBroadcast.mockClear();
    await actions.publishQuiz('q');
    await afterResponse();
    expect(createBroadcast).not.toHaveBeenCalled();
    questionDb.findByQuizId.mockRejectedValueOnce(new Error('x'));
    expect((await actions.publishQuiz('q')).success).toBe(false);
  });

  it('pauseQuiz', async () => {
    expect(await actions.pauseQuiz('q')).toEqual({ success: true, message: 'Quiz paused successfully!' });
    expect(quizDb.update).toHaveBeenCalledWith('q', { status: 'paused' });
    quizDb.update.mockRejectedValueOnce(new Error('x'));
    expect((await actions.pauseQuiz('q')).success).toBe(false);
  });

  it('pushQuizLive stamps pushedAt on an active quiz and announces it', async () => {
    quizDb.findById.mockResolvedValue(null);
    expect(await actions.pushQuizLive('q')).toEqual({ success: false, error: 'Quiz not found' });
    quizDb.findById.mockResolvedValue({ id: 'q', status: 'draft' });
    expect(await actions.pushQuizLive('q')).toEqual({ success: false, error: 'Publish the quiz before pushing it live' });
    quizDb.findById.mockResolvedValue({ id: 'q', status: 'active' });
    expect(await actions.pushQuizLive('q')).toEqual({ success: true, message: 'Pushed to live viewers!' });
    expect(quizDb.update.mock.calls[0][1]).toEqual({ pushedAt: expect.any(String) });
    // Players see the push at once: the catalogue is refreshed before the broadcast even starts
    expect(clearQuizListCache).toHaveBeenCalled();
    expect(createBroadcast).not.toHaveBeenCalled();
    await afterResponse();
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ title: '🔴 Live now' }));

    quizDb.update.mockResolvedValueOnce({ id: 'q', title: null });
    createBroadcast.mockRejectedValueOnce(new Error('push'));
    expect((await actions.pushQuizLive('q')).success).toBe(true);
    await afterResponse();
    expect(console.error).toHaveBeenCalledWith('Failed to send quiz push broadcast notification:', expect.any(Error));
    quizDb.update.mockResolvedValueOnce(null);
    expect((await actions.pushQuizLive('q')).success).toBe(true);
    quizDb.findById.mockRejectedValueOnce(new Error('x'));
    expect((await actions.pushQuizLive('q')).success).toBe(false);
  });
});

describe('notifyUpcomingQuiz', () => {
  beforeEach(() => vi.stubEnv('BUSINESS_TIMEZONE', 'Asia/Karachi'));

  it('announces a scheduled quiz once, unless forced', async () => {
    quizDb.findById.mockResolvedValue({ id: 'q', title: 'Final', status: 'scheduled', startsAt: inAnHour() });
    adminDb.setTable('Notification', { data: [] });
    expect(await actions.notifyUpcomingQuiz('q')).toEqual({ success: true, message: 'Users notified about the upcoming quiz. The quiz is still scheduled.' });
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ title: UPCOMING_NOTICE_TITLE, link: '/quizzes?upcoming=q', message: expect.stringMatching(/^"Final" goes live /) }));
    expect(eqValue(adminDb.callsTo('Notification')[0], 'link')).toBe('/quizzes?upcoming=q');
    // Marked as announced after the broadcast (the bell has it when the stream pops it up), and the
    // cached snapshot dropped so the stream shows it within seconds
    const [mark] = adminDb.callsTo('Quiz', 'update');
    expect(eqValue(mark, 'id')).toBe('q');
    expect(createBroadcast.mock.invocationCallOrder[0]).toBeLessThan(clearQuizListCache.mock.invocationCallOrder[0]);
    expect(clearQuizListCache).toHaveBeenCalledTimes(1);

    adminDb.setTable('Notification', { data: [{ id: 'sent' }] });
    expect(await actions.notifyUpcomingQuiz('q')).toEqual({ success: false, error: 'Users were already notified about this quiz.', code: 'ALREADY_NOTIFIED' });
    expect((await actions.notifyUpcomingQuiz('q', true)).success).toBe(true);
    expect(adminDb.callsTo('Notification')).toHaveLength(2);
  });

  it('accepts the legacy "upcoming" status and an unknown title', async () => {
    quizDb.findById.mockResolvedValue({ id: 'q', title: null, status: 'upcoming', startsAt: inAnHour() });
    adminDb.setTable('Notification', { data: null });
    await actions.notifyUpcomingQuiz('q');
    expect(createBroadcast.mock.calls[0][0].message).toMatch(/^"Quiz" goes live/);
  });

  it('refuses quizzes that cannot be announced', async () => {
    quizDb.findById.mockResolvedValue(null);
    expect((await actions.notifyUpcomingQuiz('q') as { error: string }).error).toBe('Quiz not found');
    quizDb.findById.mockResolvedValue({ status: 'active' });
    expect((await actions.notifyUpcomingQuiz('q') as { error: string }).error).toBe('Only scheduled quizzes can be announced as upcoming');
    quizDb.findById.mockResolvedValue({ status: 'scheduled', startsAt: null });
    expect((await actions.notifyUpcomingQuiz('q') as { error: string }).error).toMatch(/Set a schedule date/);
    quizDb.findById.mockResolvedValue({ status: 'scheduled', startsAt: new Date(Date.now() - 1000).toISOString() });
    expect((await actions.notifyUpcomingQuiz('q') as { error: string }).error).toMatch(/due to start already/);
    quizDb.findById.mockRejectedValue(new Error('x'));
    expect((await actions.notifyUpcomingQuiz('q') as { error: string }).error).toBe('Failed to notify users. Please try again.');
  });
});
