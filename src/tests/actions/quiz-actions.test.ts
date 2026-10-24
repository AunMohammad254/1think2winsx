// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { argOf, createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const adminActionGuard = vi.fn();
const revalidatePath = vi.fn();
const clearQuizListCache = vi.fn();
const quizDb = { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findById: vi.fn() };
const questionDb = { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findByQuizId: vi.fn() };
const createBroadcast = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ quizDb, questionDb, notificationDb: { createBroadcast: (...a: unknown[]) => createBroadcast(...a) }, getAdminDb: () => adminDb.client }));
vi.mock('@/lib/admin-guard', () => ({ adminActionGuard: (...a: unknown[]) => adminActionGuard(...a) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/lib/quiz-cache', () => ({ clearQuizListCache: (...a: unknown[]) => clearQuizListCache(...a) }));

const actions = await import('@/actions/quiz-actions');
const { UPCOMING_NOTICE_TITLE } = await import('@/lib/quiz-scheduler');

const DENIED = { success: false, error: 'Unauthorized: admin session required' };
const question = (over: Record<string, unknown> = {}) => ({ text: 'Who wins?', options: [{ text: 'A', isCorrect: false }, { text: 'B', isCorrect: true }], correctOption: 1, ...over });
const quizInput = (over: Record<string, unknown> = {}) => ({ title: 'Cricket night', duration: 10, passingScore: 60, status: 'draft', questions: [question()], ...over });
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

beforeEach(() => {
  adminDb = createSupabaseMock();
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
  it('saves the quiz and questions, taking the answer key from the ticked option and leaving them open', async () => {
    const res = await actions.createQuiz(quizInput({ startsAt: '2026-11-01T18:00:00Z', prizeId: 'p1' }) as never);
    expect(res).toEqual({ success: true, data: { id: 'quiz-1' }, message: 'Quiz created successfully!' });
    expect(quizDb.create).toHaveBeenCalledWith({
      title: 'Cricket night', description: null, duration: 10, timeUpDuration: 60, passingScore: 60, status: 'draft',
      startsAt: '2026-11-01T18:00:00.000Z', prizeId: 'p1', isBumperPrize: false, quizType: 'normal',
    });
    // hasCorrectAnswer would close the question: submit_quiz_attempt refused every answer to a normal quiz
    expect(questionDb.create).toHaveBeenCalledWith({ quizId: 'quiz-1', text: 'Who wins?', options: '["A","B"]', correctOption: 1, hasCorrectAnswer: false, status: 'active' });
    expect(createBroadcast).not.toHaveBeenCalled();
    expect(clearQuizListCache).toHaveBeenCalled();
  });

  it('never saves the access price (or difficulty) from the form', async () => {
    await actions.createQuiz(quizInput({ accessPrice: 50, difficulty: 'hard' }) as never);
    const saved = quizDb.create.mock.calls[0][0];
    expect(saved).not.toHaveProperty('accessPrice');
    expect(saved).not.toHaveProperty('difficulty');
  });

  it('saves NO answer key when correctOption is set but no option is ticked', async () => {
    await actions.createQuiz(quizInput({ questions: [question({ options: [{ text: 'A' }, { text: 'B' }], correctOption: 1 })] }) as never);
    expect(questionDb.create).toHaveBeenCalledWith(expect.objectContaining({ correctOption: null, hasCorrectAnswer: false }));
  });

  it('stores prediction questions without an answer key', async () => {
    await actions.createQuiz(quizInput({ quizType: 'predictable', questions: [question({ correctOption: null })] }) as never);
    expect(questionDb.create).toHaveBeenCalledWith(expect.objectContaining({ correctOption: null, hasCorrectAnswer: false }));
  });

  it('announces an active quiz, surviving a failed broadcast', async () => {
    await actions.createQuiz(quizInput({ status: 'active', isBumperPrize: true }) as never);
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ title: '🎮 New Quiz Published!', link: '/quizzes?openQuiz=quiz-1' }));
    quizDb.create.mockResolvedValueOnce({ id: 'quiz-2', title: null });
    createBroadcast.mockRejectedValueOnce(new Error('push'));
    expect((await actions.createQuiz(quizInput({ status: 'active' }) as never)).success).toBe(true);
    expect(createBroadcast).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('"Challenge"') }));
  });

  it('validates the input, including a start time for scheduled quizzes', async () => {
    const res = await actions.createQuiz(quizInput({ title: 'x', status: 'scheduled' }) as never);
    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toMatch(/Title must be at least 3 characters.*Pick a valid date and time/);
    expect((await actions.createQuiz(quizInput({ questions: [question({ correctOption: null })] }) as never) as { error: string }).error).toBe('Correct option must be selected for normal quizzes');
  });

  it('saves the entry limit and points pool in the admin-only settings, never on the quiz', async () => {
    await actions.createQuiz(quizInput() as never);
    expect(argOf(adminDb.callsTo('QuizAdminSettings', 'upsert')[0], 'upsert')).toMatchObject({ quizId: 'quiz-1', maxEntries: 2000, pointsPool: 0 });
    await actions.createQuiz(quizInput({ maxEntries: 500, pointsPool: 25_000 }) as never);
    expect(argOf(adminDb.callsTo('QuizAdminSettings', 'upsert')[1], 'upsert')).toMatchObject({ maxEntries: 500, pointsPool: 25_000 });
    expect(quizDb.create.mock.calls[1][0]).not.toHaveProperty('maxEntries');
    expect(quizDb.create.mock.calls[1][0]).not.toHaveProperty('pointsPool');
    const bad = await actions.createQuiz(quizInput({ maxEntries: 0, pointsPool: -5 }) as never);
    expect((bad as { error: string }).error).toBe('Entry limit must be at least 1, Points pool must be 0 or more');
  });

  it('reports a quiz saved without its settings as a warning to retry, not a failure', async () => {
    adminDb.setTable('QuizAdminSettings', { error: { message: 'relation "QuizAdminSettings" does not exist' } });
    expect(await actions.createQuiz(quizInput() as never)).toEqual({
      success: true, data: { id: 'quiz-1' },
      message: 'Quiz created, but its entry limit and points pool were not saved. Edit the quiz and save again.',
    });
    expect(await actions.updateQuiz({ id: 'quiz-1', ...quizInput() } as never)).toEqual({
      success: true, message: 'Quiz updated, but its entry limit and points pool were not saved. Edit the quiz and save again.',
    });
  });

  it('relays database errors', async () => {
    quizDb.create.mockRejectedValueOnce(new Error('duplicate title'));
    expect(await actions.createQuiz(quizInput() as never)).toEqual({ success: false, error: 'duplicate title' });
    quizDb.create.mockRejectedValueOnce({});
    expect(await actions.createQuiz(quizInput() as never)).toEqual({ success: false, error: 'Failed to create quiz. Please try again.' });
  });
});

describe('updateQuiz', () => {
  it('updates the quiz, deletes dropped questions, updates kept ones and adds new ones', async () => {
    questionDb.findByQuizId.mockResolvedValue([{ id: 'keep' }, { id: 'drop' }]);
    const res = await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ questions: [question({ id: 'keep' }), question({ options: [{ text: 'C', isCorrect: true }, { text: 'D' }], correctOption: 0 })] }) } as never);
    expect(res).toEqual({ success: true, message: 'Quiz updated successfully!' });
    expect(questionDb.delete).toHaveBeenCalledWith('drop');
    expect(questionDb.update).toHaveBeenCalledWith('keep', expect.objectContaining({ correctOption: 1, hasCorrectAnswer: false }));
    expect(questionDb.create).toHaveBeenCalledWith(expect.objectContaining({ quizId: 'quiz-1', options: '["C","D"]', correctOption: 0, hasCorrectAnswer: false }));
    expect(revalidatePath).toHaveBeenCalledWith('/quiz/quiz-1');
  });

  it("keeps a question's saved result: editing the quiz used to erase it and reopen the question", async () => {
    questionDb.findByQuizId.mockResolvedValue([{ id: 'done', hasCorrectAnswer: true }, { id: 'open', hasCorrectAnswer: false }]);
    await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ quizType: 'predictable', questions: [
      question({ id: 'done', text: 'Toss winner?', correctOption: null }),
      question({ id: 'open', correctOption: null }),
    ] }) } as never);
    expect(questionDb.update).toHaveBeenCalledWith('done', { text: 'Toss winner?', options: '["A","B"]', status: 'active' });
    expect(questionDb.update).toHaveBeenCalledWith('open', expect.objectContaining({ correctOption: null, hasCorrectAnswer: false }));
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
    for (const fn of [quizDb.update, questionDb.update, questionDb.delete, questionDb.create]) expect(fn).not.toHaveBeenCalled();

    // New wording is fine, and the unchanged options are not rewritten
    expect((await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ questions: [question({ id: 'keep' }), question({ id: 'drop', text: 'Who won the toss?' })] }) } as never)).success).toBe(true);
    expect(questionDb.update).toHaveBeenCalledWith('drop', expect.not.objectContaining({ options: expect.anything() }));
    expect(questionDb.update).toHaveBeenCalledWith('drop', expect.objectContaining({ text: 'Who won the toss?' }));
  });

  it('names how many more answered questions an edit would hit', async () => {
    questionDb.findByQuizId.mockResolvedValue([{ id: 'a', text: 'First?' }, { id: 'b', text: 'Second?' }, { id: 'c', text: 'Third?' }]);
    adminDb.setTable('QuestionAttempt', { data: [{ id: 'qa' }] });
    const res = await actions.updateQuiz({ id: 'quiz-1', ...quizInput() } as never);
    expect(res).toMatchObject({ success: false, error: expect.stringContaining('"First?" (and 2 more)') });
  });

  it('stores prediction questions without a key and needs an id', async () => {
    questionDb.findByQuizId.mockResolvedValue([{ id: 'q1' }]);
    await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ quizType: 'predictable', questions: [question({ id: 'q1', correctOption: null })] }) } as never);
    expect(questionDb.update).toHaveBeenCalledWith('q1', expect.objectContaining({ correctOption: null, hasCorrectAnswer: false }));
    await actions.updateQuiz({ id: 'quiz-1', ...quizInput({ questions: [question({ id: 'q1', options: [{ text: 'A' }, { text: 'B' }] })] }) } as never);
    expect(questionDb.update).toHaveBeenLastCalledWith('q1', expect.objectContaining({ correctOption: null }));
    expect(await actions.updateQuiz(quizInput() as never)).toEqual({ success: false, error: 'Quiz ID is required' });
  });

  it('validates and reports failures', async () => {
    expect((await actions.updateQuiz({ id: 'q', ...quizInput({ duration: 0 }) } as never)).success).toBe(false);
    quizDb.update.mockRejectedValueOnce(new Error('x'));
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
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('"Cricket night"') }));

    quizDb.update.mockResolvedValueOnce({ id: 'q', title: '' });
    createBroadcast.mockRejectedValueOnce(new Error('push'));
    expect((await actions.publishQuiz('q')).success).toBe(true);
    quizDb.update.mockResolvedValueOnce(null);
    createBroadcast.mockClear();
    await actions.publishQuiz('q');
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
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ title: '🔴 Live now' }));

    quizDb.update.mockResolvedValueOnce({ id: 'q', title: null });
    createBroadcast.mockRejectedValueOnce(new Error('push'));
    expect((await actions.pushQuizLive('q')).success).toBe(true);
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
