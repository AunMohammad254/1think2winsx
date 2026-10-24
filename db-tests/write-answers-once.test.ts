/**
 * Migration 06-20261024170000: each answer is written once (to "QuestionAttempt"), scores come from
 * the answer key, settlement ranks by correct answers (exact above 100 questions), and the entry
 * limit reads a counter kept by triggers instead of counting every attempt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPool,
  createQuestions,
  createQuiz,
  createUser,
  player,
  queryAs,
  resetData,
  serviceRole,
  setWalletEnabled,
  submitQuiz,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const SEED = 'seed-0123456789abcdef';

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
});

/** One player per entry of `picks`: picks[i][j] is player i's option for question j (undefined: not answered). */
async function playQuiz(questionCount: number, picks: Array<Array<number | undefined>>) {
  const quizId = await createQuiz(pool);
  const questionIds = await createQuestions(pool, quizId, questionCount);
  const players: string[] = [];
  for (const row of picks) {
    const user = await createUser(pool);
    players.push(user.id);
    const answers = row.flatMap((selectedOption, j) => (selectedOption === undefined ? [] : [{ questionId: questionIds[j], selectedOption }]));
    expect((await submitQuiz(pool, player(user.id), { userId: user.id, quizId, answers })).success).toBe(true);
  }
  return { quizId, questionIds, players };
}

const saveResult = async (quizId: string, answers: Record<string, number>) =>
  (await queryAs(pool, serviceRole, `SELECT public.save_quiz_result($1, $2::jsonb) AS r`, [quizId, JSON.stringify(answers)]))[0].r;
const attemptOf = async (userId: string, quizId: string) =>
  (await pool.query(`SELECT score, "correctAnswers", "isEvaluated" FROM "QuizAttempt" WHERE "userId" = $1 AND "quizId" = $2`, [userId, quizId])).rows[0];
const entries = async (quizId: string) =>
  (await pool.query(`SELECT entries FROM "QuizEntryCount" WHERE "quizId" = $1`, [quizId])).rows[0]?.entries;

describe('scoring from the answer key', () => {
  it('stamps every answer and scores every player in one save, counting correct answers', async () => {
    const { quizId, questionIds: [a, b, c, d], players: [ace, half, none] } = await playQuiz(4, [
      [1, 1, 1, 1],
      [1, 0, 1, undefined], // one question skipped
      [0, 0, 0, 0],
    ]);
    expect(await saveResult(quizId, { [a]: 1, [b]: 1, [c]: 0, [d]: 1 })).toEqual({ success: true });

    expect(await attemptOf(ace, quizId)).toEqual({ score: 75, correctAnswers: 3, isEvaluated: true });
    expect(await attemptOf(half, quizId)).toEqual({ score: 25, correctAnswers: 1, isEvaluated: true });
    expect(await attemptOf(none, quizId)).toEqual({ score: 25, correctAnswers: 1, isEvaluated: true });
    const { rows } = await pool.query(
      `SELECT "userId", "questionId", "isCorrect" FROM "QuestionAttempt" WHERE "quizId" = $1 AND "userId" = $2 ORDER BY "attemptedAt", "questionId"`,
      [quizId, half],
    );
    expect(Object.fromEntries(rows.map((r) => [r.questionId, r.isCorrect]))).toEqual({ [a]: true, [b]: false, [c]: false });
  });

  it('counts only active questions, as the total does: a paused question no longer lifts a score above 100', async () => {
    const { quizId, questionIds: [a, b], players: [p] } = await playQuiz(2, [[1, 1]]);
    await queryAs(pool, serviceRole, `SELECT evaluate_question($1, 1)`, [b]);
    await pool.query(`UPDATE "Question" SET status = 'paused' WHERE id = $1`, [b]);
    await queryAs(pool, serviceRole, `SELECT evaluate_question($1, 1)`, [a]);
    await queryAs(pool, serviceRole, `SELECT finalize_quiz_scores($1)`, [quizId]);
    expect(await attemptOf(p, quizId)).toEqual({ score: 100, correctAnswers: 1, isEvaluated: true });
  });

  it('evaluate_question stamps "QuestionAttempt" and leaves older "Answer" rows alone', async () => {
    const { questionIds: [q], players: [p] } = await playQuiz(1, [[2]]);
    const [r] = await queryAs(pool, serviceRole, `SELECT evaluate_question($1, 2) AS r`, [q]);
    expect(r.r).toEqual({ success: true, questionAttemptsUpdated: 1 });
    expect((await pool.query(`SELECT "isCorrect" FROM "QuestionAttempt" WHERE "userId" = $1`, [p])).rows).toEqual([{ isCorrect: true }]);
  });

  it('counts leaderboard correct answers from "QuestionAttempt"', async () => {
    const { quizId, questionIds: [a, b] } = await playQuiz(2, [[1, 1]]);
    await saveResult(quizId, { [a]: 1, [b]: 0 });
    // compute_leaderboard is internal (get_leaderboard calls it), so as the superuser
    const { rows } = await pool.query(`SELECT "correctAnswers", "totalScore" FROM compute_leaderboard('allTime', 10, NULL)`);
    expect(rows).toEqual([{ correctAnswers: 1, totalScore: 50 }]);
  });
});

describe('ranking above 100 questions', () => {
  async function settle(quizId: string) {
    const rows = await queryAs(pool, serviceRole, `SELECT settle_quiz($1, $2::jsonb, 'random', $3, 'admin@example.test') AS r`, [
      quizId, JSON.stringify([{ rank: 1, points: 300 }, { rank: 2, points: 200 }]), SEED,
    ]);
    return rows[0].r;
  }
  const keyAllOnes = (questionIds: string[]) => Object.fromEntries(questionIds.map((id) => [id, 1]));

  it('ranks 2 correct above 1 correct in a 150-question quiz, though both score 1', async () => {
    const { quizId, questionIds, players: [one, two] } = await playQuiz(150, [[1], [1, 1]]);
    await saveResult(quizId, keyAllOnes(questionIds));
    expect(await attemptOf(one, quizId)).toMatchObject({ score: 1, correctAnswers: 1 });
    expect(await attemptOf(two, quizId)).toMatchObject({ score: 1, correctAnswers: 2 });

    const r = await settle(quizId);
    expect(r.winners.map((w: { userId: string; selectionMethod: string; correctAnswers: number }) => [w.userId, w.selectionMethod, w.correctAnswers]))
      .toEqual([[two, 'ranked', 2], [one, 'ranked', 1]]);
  });

  it('gives a place to 1 correct answer of 201, which rounds to a score of 0', async () => {
    const { quizId, questionIds, players: [p] } = await playQuiz(201, [[1]]);
    await saveResult(quizId, keyAllOnes(questionIds));
    expect(await attemptOf(p, quizId)).toMatchObject({ score: 0, correctAnswers: 1 });
    const r = await settle(quizId);
    expect(r.winners).toHaveLength(1);
    expect(r.winners[0]).toMatchObject({ rank: 1, userId: p, score: 0, correctAnswers: 1 });
    expect(r.unfilled).toEqual([2]);
  });
});

describe('entry counter', () => {
  it('follows every insert and delete of attempts, whoever makes them', async () => {
    const quizId = await createQuiz(pool);
    expect(await entries(quizId)).toBeUndefined();
    const users = [await createUser(pool), await createUser(pool), await createUser(pool)];
    await pool.query(
      `INSERT INTO "QuizAttempt" (id, "userId", "quizId", "isCompleted", "updatedAt") SELECT 'qa_' || u, u, $1, true, now() FROM unnest($2::text[]) u`,
      [quizId, users.map((u) => u.id)],
    );
    expect(await entries(quizId)).toBe(3);
    await pool.query(`DELETE FROM "QuizAttempt" WHERE "userId" = $1`, [users[0].id]);
    expect(await entries(quizId)).toBe(2);
    await pool.query(`DELETE FROM "User" WHERE id = $1`, [users[1].id]); // cascades to the attempt
    expect(await entries(quizId)).toBe(1);
    await pool.query(`DELETE FROM "Quiz" WHERE id = $1`, [quizId]);
    expect(await entries(quizId)).toBeUndefined();
  });

  it('frees a place when an attempt is removed', async () => {
    const quizId = await createQuiz(pool);
    const [q] = await createQuestions(pool, quizId, 1);
    await pool.query(`INSERT INTO "QuizAdminSettings" ("quizId", "maxEntries") VALUES ($1, 1)`, [quizId]);
    const [first, second] = [await createUser(pool), await createUser(pool)];
    const answers = [{ questionId: q, selectedOption: 0 }];
    expect((await submitQuiz(pool, player(first.id), { userId: first.id, quizId, answers })).success).toBe(true);
    expect(await submitQuiz(pool, player(second.id), { userId: second.id, quizId, answers })).toMatchObject({ code: 'entries_closed' });
    await pool.query(`DELETE FROM "QuizAttempt" WHERE "userId" = $1`, [first.id]);
    expect((await submitQuiz(pool, player(second.id), { userId: second.id, quizId, answers })).success).toBe(true);
    expect(await entries(quizId)).toBe(1);
  });

  it('is only for the server', async () => {
    const user = await createUser(pool);
    await expect(queryAs(pool, player(user.id), `SELECT * FROM "QuizEntryCount"`)).rejects.toMatchObject({ code: '42501' });
  });
});
