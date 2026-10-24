/**
 * submit_quiz_attempt: the RPC behind POST /api/quizzes/[id]/submit, run for real against
 * the schema baseline. The route maps `code` to an HTTP status (payment_required 402,
 * not_found 404, invalid 400, forbidden 403, closed 403).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anon,
  answersFor,
  countRows,
  createDailyPayment,
  createPool,
  createQuestion,
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

let user: { id: string; email: string };
beforeEach(async () => {
  await resetData(pool);
  user = await createUser(pool);
  // Free mode unless a test is about payment
  await setWalletEnabled(pool, false);
});

const submitAs = (userId: string, quizId: string, answers: unknown) =>
  submitQuiz(pool, player(userId), { userId, quizId, answers });

async function attemptRow(userId: string, quizId: string) {
  const { rows } = await pool.query(`SELECT * FROM "QuizAttempt" WHERE "userId" = $1 AND "quizId" = $2`, [userId, quizId]);
  return rows;
}

describe('first submission', () => {
  it('saves one completed QuizAttempt plus one QuestionAttempt per answer, and nothing in "Answer"', async () => {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 3);

    const r = await submitAs(user.id, quizId, [
      { questionId: questionIds[0], selectedOption: 0 },
      { questionId: questionIds[1], selectedOption: 2 },
      { questionId: questionIds[2], selectedOption: 9 },
    ]);

    expect(r).toMatchObject({ success: true, answersSubmitted: 3, isReattempt: false, totalQuestions: 3 });
    expect(r.attemptId).toMatch(/^qa_/);

    const attempts = await attemptRow(user.id, quizId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      id: r.attemptId,
      isCompleted: true,
      isEvaluated: false,
      score: 0,
      points: 0,
      dailyPaymentId: null,
    });
    expect(attempts[0].completedAt).not.toBeNull();

    const { rows: questionAttempts } = await pool.query(
      `SELECT "questionId", "quizId", "selectedOption", "isCorrect" FROM "QuestionAttempt" WHERE "userId" = $1 ORDER BY "selectedOption"`,
      [user.id],
    );
    expect(questionAttempts).toEqual([
      { questionId: questionIds[0], quizId, selectedOption: 0, isCorrect: false },
      { questionId: questionIds[1], quizId, selectedOption: 2, isCorrect: false },
      { questionId: questionIds[2], quizId, selectedOption: 9, isCorrect: false },
    ]);

    // Each answer is written once: the copy in "Answer" was 40-70% of a submit's cost
    expect(await countRows(pool, 'Answer', user.id)).toBe(0);
  });

  it('accepts a subset of the questions and reports the quiz total', async () => {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 4);

    const r = await submitAs(user.id, quizId, answersFor(questionIds.slice(0, 2)));

    expect(r).toMatchObject({ success: true, answersSubmitted: 2, totalQuestions: 4 });
    expect(await countRows(pool, 'QuestionAttempt', user.id)).toBe(2);
  });

  it('accepts a quiz that was never pushed (no answering window)', async () => {
    const quizId = await createQuiz(pool, { pushedSecondsAgo: null });
    const questionIds = await createQuestions(pool, quizId, 1);

    expect(await submitAs(user.id, quizId, answersFor(questionIds))).toMatchObject({ success: true });
  });
});

describe('resubmission and re-attempts', () => {
  it('saves nothing new when the same questions are submitted again', async () => {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 2);
    const first = await submitAs(user.id, quizId, answersFor(questionIds, 1));
    const [before] = await attemptRow(user.id, quizId);

    // Same questions, different picks: predictions are final (ON CONFLICT DO NOTHING)
    const again = await submitAs(user.id, quizId, answersFor(questionIds, 3));

    expect(again).toMatchObject({ success: true, attemptId: first.attemptId, answersSubmitted: 0, isReattempt: true });
    expect(await countRows(pool, 'QuizAttempt', user.id)).toBe(1);
    expect(await countRows(pool, 'QuestionAttempt', user.id)).toBe(2);
    const { rows: picks } = await pool.query(`SELECT DISTINCT "selectedOption" FROM "QuestionAttempt" WHERE "userId" = $1`, [user.id]);
    expect(picks).toEqual([{ selectedOption: 1 }]);
    // Nothing inserted, so the attempt is left exactly as it was
    const [after] = await attemptRow(user.id, quizId);
    expect(after.completedAt).toEqual(before.completedAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('treats questions added after completion as a re-attempt on the same QuizAttempt', async () => {
    const quizId = await createQuiz(pool);
    const [q1, q2] = await createQuestions(pool, quizId, 2);
    const first = await submitAs(user.id, quizId, answersFor([q1, q2]));
    // The admin evaluated the first round, then pushed more questions
    await pool.query(`UPDATE "QuizAttempt" SET "isEvaluated" = true, "completedAt" = now() - interval '5 minutes' WHERE id = $1`, [
      first.attemptId,
    ]);
    const [q3, q4] = await createQuestions(pool, quizId, 2);

    // The client sends the old questions again together with the new ones
    const r = await submitAs(user.id, quizId, answersFor([q1, q2, q3, q4], 2));

    expect(r).toMatchObject({
      success: true,
      attemptId: first.attemptId,
      answersSubmitted: 2,
      isReattempt: true,
      totalQuestions: 4,
    });
    const attempts = await attemptRow(user.id, quizId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].isEvaluated).toBe(false); // back in the evaluation queue
    // "completedAt" is timestamp without time zone, so compare on the database clock
    const { rows: fresh } = await pool.query(
      `SELECT "completedAt" > now()::timestamp - interval '1 minute' AS fresh FROM "QuizAttempt" WHERE id = $1`,
      [first.attemptId],
    );
    expect(fresh).toEqual([{ fresh: true }]);

    const { rows: answers } = await pool.query(
      `SELECT "questionId", "quizId", "selectedOption" FROM "QuestionAttempt" WHERE "userId" = $1`,
      [user.id],
    );
    expect(answers).toHaveLength(4);
    expect(new Set(answers.map((a) => a.quizId))).toEqual(new Set([quizId]));
    // Old predictions kept their original pick
    expect(answers.find((a) => a.questionId === q1)?.selectedOption).toBe(1);
    expect(answers.find((a) => a.questionId === q3)?.selectedOption).toBe(2);
  });

  it('records exactly one attempt when the same player submits twice at once', async () => {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 3);

    const results = await Promise.all([
      submitAs(user.id, quizId, answersFor(questionIds)),
      submitAs(user.id, quizId, answersFor(questionIds)),
    ]);

    expect(results.every((r) => r.success)).toBe(true);
    expect(results.map((r) => r.answersSubmitted).sort()).toEqual([0, 3]);
    expect(await countRows(pool, 'QuizAttempt', user.id)).toBe(1);
    expect(await countRows(pool, 'QuestionAttempt', user.id)).toBe(3);
  });

  it('keeps players separate', async () => {
    const other = await createUser(pool);
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 2);

    await submitAs(user.id, quizId, answersFor(questionIds));
    const r = await submitAs(other.id, quizId, answersFor(questionIds));

    expect(r).toMatchObject({ success: true, answersSubmitted: 2, isReattempt: false });
    expect(await countRows(pool, 'QuizAttempt')).toBe(2);
    expect(await countRows(pool, 'QuestionAttempt')).toBe(4);
  });
});

describe('rejected submissions save nothing', () => {
  async function expectNothingSaved() {
    expect(await countRows(pool, 'QuizAttempt')).toBe(0);
    expect(await countRows(pool, 'QuestionAttempt')).toBe(0);
    expect(await countRows(pool, 'Answer')).toBe(0);
  }

  it("rejects questions that already have a correct answer ('invalid', closed question)", async () => {
    const quizId = await createQuiz(pool);
    const open = await createQuestion(pool, quizId);
    const revealed = await createQuestion(pool, quizId, { hasCorrectAnswer: true, correctOption: 2 });

    const r = await submitAs(user.id, quizId, answersFor([open, revealed]));

    expect(r).toEqual({ success: false, code: 'invalid', error: 'Invalid or closed question IDs in submission' });
    await expectNothingSaved();
  });

  it("rejects a resubmission that includes a question revealed since the first submit ('invalid')", async () => {
    // A client that resends every question after one was evaluated loses the whole payload
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 2);
    await submitAs(user.id, quizId, answersFor(questionIds));
    await pool.query(`UPDATE "Question" SET "hasCorrectAnswer" = true, "correctOption" = 1 WHERE id = $1`, [questionIds[0]]);
    const added = await createQuestion(pool, quizId);

    const r = await submitAs(user.id, quizId, answersFor([...questionIds, added]));

    expect(r).toMatchObject({ success: false, code: 'invalid', error: 'Invalid or closed question IDs in submission' });
    expect(await countRows(pool, 'QuestionAttempt', user.id)).toBe(2);
  });

  it("rejects an answer after pushedAt + duration + 30 s grace ('closed')", async () => {
    const quizId = await createQuiz(pool, { duration: 10, pushedSecondsAgo: 10 * 60 + 31 });
    const questionIds = await createQuestions(pool, quizId, 1);

    const r = await submitAs(user.id, quizId, answersFor(questionIds));

    expect(r).toEqual({ success: false, code: 'closed', error: 'This quiz has ended and no longer accepts answers.' });
    await expectNothingSaved();
  });

  it('accepts an answer inside the 30 s grace period', async () => {
    const quizId = await createQuiz(pool, { duration: 10, pushedSecondsAgo: 10 * 60 + 20 });
    const questionIds = await createQuestions(pool, quizId, 1);

    expect(await submitAs(user.id, quizId, answersFor(questionIds))).toMatchObject({ success: true });
  });

  it("returns 'not_found' for a quiz that does not exist", async () => {
    const r = await submitAs(user.id, 'quiz_missing', [{ questionId: 'q_missing', selectedOption: 0 }]);

    expect(r).toEqual({ success: false, code: 'not_found', error: 'Quiz not found or inactive' });
    await expectNothingSaved();
  });

  it.each(['paused', 'draft', 'scheduled', 'completed'])("returns 'not_found' for a %s quiz", async (status) => {
    const quizId = await createQuiz(pool, { status });
    const questionIds = await createQuestions(pool, quizId, 1);

    expect(await submitAs(user.id, quizId, answersFor(questionIds))).toMatchObject({ success: false, code: 'not_found' });
    await expectNothingSaved();
  });

  it("returns 'forbidden' when the signed-in player submits for someone else", async () => {
    const victim = await createUser(pool);
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 1);

    const r = await submitQuiz(pool, player(user.id), { userId: victim.id, quizId, answers: answersFor(questionIds) });

    expect(r).toEqual({ success: false, code: 'forbidden', error: 'Permission denied' });
    await expectNothingSaved();
  });

  it("returns 'forbidden' for the service role, which has no signed-in user", async () => {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 1);

    const r = await submitQuiz(pool, serviceRole, { userId: user.id, quizId, answers: answersFor(questionIds) });

    expect(r).toMatchObject({ success: false, code: 'forbidden' });
    await expectNothingSaved();
  });

  it('cannot be called by anon at all', async () => {
    const error = await errorAs(
      pool,
      anon,
      `SELECT public.submit_quiz_attempt(p_user_id => $1, p_quiz_id => 'x', p_answers => '[]'::jsonb)`,
      [user.id],
    );
    expect(error.code).toBe('42501'); // insufficient_privilege
  });

  it("returns 'invalid' for duplicate question ids in one payload", async () => {
    const quizId = await createQuiz(pool);
    const [q1, q2] = await createQuestions(pool, quizId, 2);

    const r = await submitAs(user.id, quizId, [
      { questionId: q1, selectedOption: 0 },
      { questionId: q2, selectedOption: 1 },
      { questionId: q1, selectedOption: 3 },
    ]);

    expect(r).toEqual({ success: false, code: 'invalid', error: 'Invalid or closed question IDs in submission' });
    await expectNothingSaved();
  });

  it("returns 'invalid' for a question from another quiz", async () => {
    const quizId = await createQuiz(pool);
    const otherQuizId = await createQuiz(pool);
    const own = await createQuestion(pool, quizId);
    const foreign = await createQuestion(pool, otherQuizId);

    expect(await submitAs(user.id, quizId, answersFor([own, foreign]))).toMatchObject({ success: false, code: 'invalid' });
    await expectNothingSaved();
  });

  it("returns 'invalid' for an inactive question", async () => {
    const quizId = await createQuiz(pool);
    const hidden = await createQuestion(pool, quizId, { status: 'inactive' });

    expect(await submitAs(user.id, quizId, answersFor([hidden]))).toMatchObject({ success: false, code: 'invalid' });
    await expectNothingSaved();
  });

  it.each([-1, 10])("returns 'invalid' for selectedOption %i (outside 0-9)", async (selectedOption) => {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 1);

    expect(await submitAs(user.id, quizId, answersFor(questionIds, selectedOption))).toMatchObject({
      success: false,
      code: 'invalid',
    });
    await expectNothingSaved();
  });

  it.each([
    ['an empty array', []],
    ['an object instead of an array', { questionId: 'q', selectedOption: 0 }],
    ['more than 200 answers', Array.from({ length: 201 }, (_, i) => ({ questionId: `q${i}`, selectedOption: 0 }))],
  ])("returns 'invalid' for %s", async (_label, answers) => {
    const quizId = await createQuiz(pool);

    expect(await submitAs(user.id, quizId, answers)).toEqual({
      success: false,
      code: 'invalid',
      error: 'Invalid answers payload',
    });
    await expectNothingSaved();
  });
});

describe('payment (AppSettings.wallet_enabled)', () => {
  let quizId: string;
  let questionIds: string[];
  beforeEach(async () => {
    quizId = await createQuiz(pool);
    questionIds = await createQuestions(pool, quizId, 2);
  });

  const paymentRequired = {
    success: false,
    code: 'payment_required',
    error: 'No active payment found. Please make a payment to access quizzes.',
  };

  it("returns 'payment_required' when the wallet is on and the player has no payment", async () => {
    await setWalletEnabled(pool, true);

    expect(await submitAs(user.id, quizId, answersFor(questionIds))).toEqual(paymentRequired);
    expect(await countRows(pool, 'QuizAttempt')).toBe(0);
  });

  it('treats a missing wallet_enabled setting as on', async () => {
    await setWalletEnabled(pool, null);

    expect(await submitAs(user.id, quizId, answersFor(questionIds))).toEqual(paymentRequired);
  });

  it.each([
    ['expired', { status: 'completed', expiresInSeconds: -60 }],
    ['pending', { status: 'pending' }],
  ])('does not accept an %s payment', async (_label, payment) => {
    await setWalletEnabled(pool, true);
    await createDailyPayment(pool, user.id, payment);

    expect(await submitAs(user.id, quizId, answersFor(questionIds))).toEqual(paymentRequired);
  });

  it("does not accept another player's payment", async () => {
    await setWalletEnabled(pool, true);
    const payer = await createUser(pool);
    await createDailyPayment(pool, payer.id);

    expect(await submitAs(user.id, quizId, answersFor(questionIds))).toEqual(paymentRequired);
  });

  it('accepts an active payment and links the attempt to the latest-expiring one', async () => {
    await setWalletEnabled(pool, true);
    await createDailyPayment(pool, user.id, { expiresInSeconds: 3600 });
    const latest = await createDailyPayment(pool, user.id, { expiresInSeconds: 7200 });

    const r = await submitAs(user.id, quizId, answersFor(questionIds));

    expect(r).toMatchObject({ success: true, answersSubmitted: 2 });
    const [attempt] = await attemptRow(user.id, quizId);
    expect(attempt.dailyPaymentId).toBe(latest);
  });

  it('does not require a payment when the wallet is off', async () => {
    await setWalletEnabled(pool, false);

    const r = await submitAs(user.id, quizId, answersFor(questionIds));

    expect(r).toMatchObject({ success: true, answersSubmitted: 2 });
    const [attempt] = await attemptRow(user.id, quizId);
    expect(attempt.dailyPaymentId).toBeNull();
  });
});

describe('what the player sees afterwards', () => {
  it('can read back their own attempt and answers through RLS', async () => {
    const quizId = await createQuiz(pool);
    const questionIds = await createQuestions(pool, quizId, 2);
    const r = await submitAs(user.id, quizId, answersFor(questionIds));

    const me = player(user.id);
    expect(await queryAs(pool, me, `SELECT id FROM "QuizAttempt"`)).toEqual([{ id: r.attemptId }]);
    expect(await queryAs(pool, me, `SELECT id FROM "QuestionAttempt"`)).toHaveLength(2);
  });
});
