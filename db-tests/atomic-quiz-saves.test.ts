/**
 * Migration 06-20261024150000: save_quiz (a quiz with its questions and settings) and save_quiz_result
 * (every question's result plus the scores) each run in one transaction, so a failure part-way leaves
 * nothing half-saved.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  answersFor,
  createPool,
  createQuestions,
  createQuiz,
  createUser,
  errorAs,
  player,
  queryAs,
  resetData,
  serviceRole,
  setWalletEnabled,
  submitQuiz,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
});

const QUIZ = {
  title: 'Cricket night', description: 'Who wins?', duration: 10, timeUpDuration: 30, passingScore: 60,
  status: 'draft', startsAt: '2026-11-01T13:00:00.000Z', prizeId: null, isBumperPrize: false, quizType: 'predictable',
};
const SETTINGS = { maxEntries: 500, pointsPool: 1000 };
type Q = { id: string; isNew?: boolean; text: string; status?: string; correctOption?: number | null; options?: string };
const q = (over: Q) => ({ status: 'active', correctOption: null, ...over });

async function saveQuiz(quizId: string, create: boolean, questions: unknown[], quiz: Record<string, unknown> = QUIZ, settings: unknown = SETTINGS) {
  const rows = await queryAs(pool, serviceRole, `SELECT public.save_quiz($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) AS r`, [
    quizId, create, JSON.stringify(quiz), JSON.stringify(questions), JSON.stringify(settings),
  ]);
  return rows[0].r;
}
const questionsOf = async (quizId: string) =>
  (await pool.query(`SELECT id, text, options, "correctOption", "hasCorrectAnswer", status FROM "Question" WHERE "quizId" = $1 ORDER BY "createdAt", id`, [quizId])).rows;

describe('save_quiz', () => {
  it('creates a quiz with its questions in order, and its settings', async () => {
    const r = await saveQuiz('quiz_new', true, [
      q({ id: 'qa', isNew: true, text: 'First?', options: '["A","B"]', correctOption: 1 }),
      q({ id: 'qb', isNew: true, text: 'Second?', options: '["C","D"]', status: 'paused' }),
      q({ id: 'qc', isNew: true, text: 'Third?', options: '["E","F"]' }),
    ]);
    expect(r).toEqual({ success: true, quizId: 'quiz_new' });
    const { rows: [quiz] } = await pool.query(`SELECT title, status, "quizType", "timeUpDuration", "startsAt" FROM "Quiz" WHERE id = 'quiz_new'`);
    expect(quiz).toMatchObject({ title: 'Cricket night', status: 'draft', quizType: 'predictable', timeUpDuration: 30 });
    expect(new Date(quiz.startsAt).toISOString()).toBe('2026-11-01T13:00:00.000Z');
    expect(await questionsOf('quiz_new')).toEqual([
      { id: 'qa', text: 'First?', options: '["A","B"]', correctOption: 1, hasCorrectAnswer: false, status: 'active' },
      { id: 'qb', text: 'Second?', options: '["C","D"]', correctOption: null, hasCorrectAnswer: false, status: 'paused' },
      { id: 'qc', text: 'Third?', options: '["E","F"]', correctOption: null, hasCorrectAnswer: false, status: 'active' },
    ]);
    const { rows: [settings] } = await pool.query(`SELECT "maxEntries", "pointsPool" FROM "QuizAdminSettings" WHERE "quizId" = 'quiz_new'`);
    expect(settings).toEqual({ maxEntries: 500, pointsPool: 1000 });
  });

  it('edits a quiz: updates, adds and removes questions, keeps unchanged options and a saved result', async () => {
    const quizId = await createQuiz(pool);
    const [keep, done, drop] = await createQuestions(pool, quizId, 3);
    await pool.query(`UPDATE "Question" SET "hasCorrectAnswer" = true, "correctOption" = 2 WHERE id = $1`, [done]);

    const r = await saveQuiz(quizId, false, [
      q({ id: keep, text: 'Who wins the toss?', correctOption: 3 }),            // options unchanged: not sent
      q({ id: done, text: 'Done?', correctOption: 0, options: '["A","B","C","D"]' }),
      q({ id: 'q_added', isNew: true, text: 'New?', options: '["X","Y"]' }),
    ], { ...QUIZ, title: 'Renamed', status: 'active' });

    expect(r).toEqual({ success: true, quizId });
    expect((await pool.query(`SELECT title, status FROM "Quiz" WHERE id = $1`, [quizId])).rows[0]).toEqual({ title: 'Renamed', status: 'active' });
    const rows = await questionsOf(quizId);
    expect(rows.map((x) => x.id)).toEqual([keep, done, 'q_added']);
    expect(rows.find((x) => x.id === drop)).toBeUndefined();
    expect(rows[0]).toMatchObject({ text: 'Who wins the toss?', options: '["A","B","C","D"]', correctOption: 3 });
    // A saved result is kept: its key doesn't change and the question stays closed
    expect(rows[1]).toMatchObject({ text: 'Done?', correctOption: 2, hasCorrectAnswer: true });
    expect(rows[2]).toMatchObject({ options: '["X","Y"]', hasCorrectAnswer: false });
  });

  it('undoes the whole edit when it would remove a question players answered', async () => {
    const quizId = await createQuiz(pool);
    const [answered, other] = await createQuestions(pool, quizId, 2);
    const user = await createUser(pool);
    expect((await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers: answersFor([answered]) })).success).toBe(true);

    const r = await saveQuiz(quizId, false, [q({ id: other, text: 'Renamed other?' }), q({ id: 'q_new', isNew: true, text: 'New?', options: '["A","B"]' })],
      { ...QUIZ, title: 'Should not stick' });

    expect(r).toMatchObject({ success: false, code: 'question_answered' });
    expect((await pool.query(`SELECT title FROM "Quiz" WHERE id = $1`, [quizId])).rows[0].title).toBe('Test quiz');
    const rows = await questionsOf(quizId);
    expect(rows.map((x) => x.id).sort()).toEqual([answered, other].sort());
    expect(rows.find((x) => x.id === other)!.text).toBe('Who wins?');
    expect((await pool.query(`SELECT count(*)::int AS n FROM "QuizAdminSettings"`)).rows[0].n).toBe(0);
  });

  it('undoes the whole edit when it would change the options of an answered question', async () => {
    const quizId = await createQuiz(pool);
    const [answered] = await createQuestions(pool, quizId, 1);
    const user = await createUser(pool);
    await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers: answersFor([answered]) });
    const r = await saveQuiz(quizId, false, [q({ id: answered, text: 'Reworded?', options: '["B","A","C","D"]' })]);
    expect(r).toMatchObject({ success: false, code: 'question_answered' });
    expect((await questionsOf(quizId))[0]).toMatchObject({ text: 'Who wins?', options: '["A","B","C","D"]' });
  });

  it('refuses a question id the quiz no longer has, undoing everything', async () => {
    const quizId = await createQuiz(pool);
    const [only] = await createQuestions(pool, quizId, 1);
    const r = await saveQuiz(quizId, false, [q({ id: only, text: 'Changed?' }), q({ id: 'q_gone', text: 'Gone?' })]);
    expect(r).toEqual({ success: false, code: 'stale', error: 'A question of this quiz was removed in the meantime. Reload the quiz and try again.' });
    expect((await questionsOf(quizId))[0].text).toBe('Who wins?');
  });

  it('refuses a missing quiz, a quiz without questions, and a database check that fails', async () => {
    expect(await saveQuiz('quiz_missing', false, [q({ id: 'x', text: 'X?' })])).toEqual({ success: false, code: 'not_found', error: 'Quiz not found' });
    expect(await saveQuiz('quiz_x', true, [])).toMatchObject({ success: false, code: 'invalid' });
    // A settings value outside its check aborts the call outright, and nothing is left behind
    const error = await errorAs(pool, serviceRole, `SELECT public.save_quiz($1, true, $2::jsonb, $3::jsonb, $4::jsonb)`, [
      'quiz_bad', JSON.stringify(QUIZ), JSON.stringify([q({ id: 'qz', isNew: true, text: 'Z?', options: '["A","B"]' })]), JSON.stringify({ maxEntries: 0, pointsPool: 0 }),
    ]);
    expect(error.code).toBe('23514'); // check_violation
    expect((await pool.query(`SELECT count(*)::int AS n FROM "Quiz" WHERE id = 'quiz_bad'`)).rows[0].n).toBe(0);
  });

  it('can only be called by the service role', async () => {
    const user = await createUser(pool);
    const error = await errorAs(pool, player(user.id), `SELECT public.save_quiz('q', true, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)`);
    expect(error.code).toBe('42501'); // insufficient_privilege
  });
});

describe('save_quiz_result', () => {
  async function saveResult(quizId: string, answers: Record<string, number>) {
    const rows = await queryAs(pool, serviceRole, `SELECT public.save_quiz_result($1, $2::jsonb) AS r`, [quizId, JSON.stringify(answers)]);
    return rows[0].r;
  }

  it('saves every result and scores the players in one go', async () => {
    const quizId = await createQuiz(pool);
    const [a, b] = await createQuestions(pool, quizId, 2);
    const user = await createUser(pool);
    await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers: answersFor([a, b], 1) });

    expect(await saveResult(quizId, { [a]: 1, [b]: 0 })).toEqual({ success: true });
    const rows = await questionsOf(quizId);
    expect(rows.every((x) => x.hasCorrectAnswer)).toBe(true);
    const { rows: [attempt] } = await pool.query(`SELECT score, "isEvaluated" FROM "QuizAttempt" WHERE "quizId" = $1`, [quizId]);
    expect(attempt).toEqual({ score: 50, isEvaluated: true });
  });

  it('saves nothing unless every active question of the quiz, and only those, has a result', async () => {
    const quizId = await createQuiz(pool);
    const [a, b] = await createQuestions(pool, quizId, 2);
    const otherQuiz = await createQuiz(pool);
    const [foreign] = await createQuestions(pool, otherQuiz, 1);
    for (const answers of [{ [a]: 1 }, { [a]: 1, [b]: 0, [foreign]: 0 }, { [a]: 1, [foreign]: 0 }]) {
      expect(await saveResult(quizId, answers)).toMatchObject({ success: false, code: 'invalid' });
    }
    expect(await saveResult('quiz_empty', {})).toMatchObject({ success: false, code: 'invalid' });
    // Not an object of results at all
    const rows = await queryAs(pool, serviceRole, `SELECT public.save_quiz_result($1, '[1]'::jsonb) AS r`, [quizId]);
    expect(rows[0].r).toMatchObject({ success: false, code: 'invalid' });
    expect((await questionsOf(quizId)).some((x) => x.hasCorrectAnswer)).toBe(false);
  });

  it('can only be called by the service role', async () => {
    const user = await createUser(pool);
    const error = await errorAs(pool, player(user.id), `SELECT public.save_quiz_result('q', '{}'::jsonb)`);
    expect(error.code).toBe('42501');
  });
});
