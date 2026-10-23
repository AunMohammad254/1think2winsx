/**
 * Migration 06-20261024120000: a question players answered can't be deleted or get new options, and a
 * prize won in a quiz can't be deleted (each used to cascade and silently drop players' answers or the
 * winner record). The app refuses the same changes first; this is the database's own guard.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  answersFor,
  countRows,
  createPool,
  createPrize,
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

/** A quiz with two questions; one player answered the first (option 1), nobody answered the second. */
async function quizWithOneAnswered() {
  const quizId = await createQuiz(pool);
  const [answered, open] = await createQuestions(pool, quizId, 2);
  const user = await createUser(pool);
  const r = await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers: answersFor([answered]) });
  expect(r.success).toBe(true);
  return { quizId, answered, open, user };
}

const asServer = (sql: string, params: unknown[]) => queryAs(pool, serviceRole, sql, params);
const refusal = (sql: string, params: unknown[]) => errorAs(pool, serviceRole, sql, params);

describe('answered questions', () => {
  it('refuses to delete a question players answered, and keeps their answers', async () => {
    const { answered } = await quizWithOneAnswered();
    const error = await refusal(`DELETE FROM "Question" WHERE id = $1`, [answered]);
    expect(error.code).toBe('23001'); // restrict_violation
    expect(error.message).toContain('already answered');
    expect(await countRows(pool, 'Answer')).toBe(1);
    expect(await countRows(pool, 'QuestionAttempt')).toBe(1);
  });

  it("refuses new options for an answered question, but takes new wording, a status change or the same options", async () => {
    const { answered } = await quizWithOneAnswered();
    const error = await refusal(`UPDATE "Question" SET options = '["B","A","C","D"]' WHERE id = $1`, [answered]);
    expect(error.code).toBe('23001');

    await asServer(`UPDATE "Question" SET text = 'Who wins the toss?', status = 'paused' WHERE id = $1`, [answered]);
    await asServer(`UPDATE "Question" SET options = options, text = 'Who wins?' WHERE id = $1`, [answered]);
    const { rows } = await pool.query(`SELECT text, options, status FROM "Question" WHERE id = $1`, [answered]);
    expect(rows[0]).toEqual({ text: 'Who wins?', options: '["A","B","C","D"]', status: 'paused' });
  });

  it('lets a question nobody answered be deleted or get new options', async () => {
    const { open } = await quizWithOneAnswered();
    await asServer(`UPDATE "Question" SET options = '["Yes","No"]' WHERE id = $1`, [open]);
    await asServer(`DELETE FROM "Question" WHERE id = $1`, [open]);
    expect((await pool.query(`SELECT 1 FROM "Question" WHERE id = $1`, [open])).rowCount).toBe(0);
  });

  it('still protects a question whose answers are only in "Answer" (older rows)', async () => {
    const { answered } = await quizWithOneAnswered();
    await pool.query(`DELETE FROM "QuestionAttempt"`);
    expect((await refusal(`DELETE FROM "Question" WHERE id = $1`, [answered])).code).toBe('23001');
  });

  it('still deletes a whole quiz, answers and all', async () => {
    const { quizId } = await quizWithOneAnswered();
    await asServer(`DELETE FROM "Quiz" WHERE id = $1`, [quizId]);
    expect(await countRows(pool, 'Question')).toBe(0);
    expect(await countRows(pool, 'Answer')).toBe(0);
    expect(await countRows(pool, 'QuestionAttempt')).toBe(0);
  });
});

describe('prizes won in a quiz', () => {
  /** Settles a one-question quiz that one player got right, with `prizeId` (or 500 points) for 1st place. */
  async function settledWith(reward: { prizeId?: string; points?: number }) {
    const quizId = await createQuiz(pool);
    const [questionId] = await createQuestions(pool, quizId, 1);
    const user = await createUser(pool);
    await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers: answersFor([questionId]) });
    await asServer(`SELECT evaluate_question($1, 1)`, [questionId]);
    const rows = await asServer(`SELECT settle_quiz($1, $2::jsonb, 'random', 'seed-0123456789abcdef', 'admin@example.test') AS r`, [
      quizId, JSON.stringify([{ rank: 1, ...reward }]),
    ]);
    expect(rows[0].r.success).toBe(true);
    return { quizId, user };
  }

  it('refuses to delete a prize someone won, and keeps the winner record', async () => {
    const prizeId = await createPrize(pool);
    const { user } = await settledWith({ prizeId });
    const error = await refusal(`DELETE FROM "Prize" WHERE id = $1`, [prizeId]);
    expect(error.code).toBe('23503'); // foreign_key_violation
    const { rows } = await pool.query(`SELECT "userId", "prizeId" FROM "QuizWinner"`);
    expect(rows).toEqual([{ userId: user.id, prizeId }]);
  });

  it('deletes a prize nobody won, while points-only winners stay', async () => {
    const prizeId = await createPrize(pool);
    await settledWith({ points: 500 });
    await asServer(`DELETE FROM "Prize" WHERE id = $1`, [prizeId]);
    expect(await countRows(pool, 'Prize')).toBe(0);
    expect(await countRows(pool, 'QuizWinner')).toBe(1);
  });
});
