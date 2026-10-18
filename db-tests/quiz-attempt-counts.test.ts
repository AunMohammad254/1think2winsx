/**
 * get_quiz_attempt_counts_by_quiz: attempt totals for the quiz catalogue and admin stats
 * (src/lib/quiz-catalog.ts, src/app/api/admin/db-stats/route.ts, both via the service role).
 * The app once read `quizId`/`count` instead of `quiz_id`/`attempt_count` and showed 0 everywhere.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anon,
  answersFor,
  as,
  createPool,
  createQuestions,
  createQuiz,
  createUser,
  errorAs,
  player,
  resetData,
  serviceRole,
  setWalletEnabled,
  submitQuiz,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const COUNTS_SQL = `SELECT * FROM public.get_quiz_attempt_counts_by_quiz(quiz_ids => $1::text[])`;

let quizA: string;
let quizB: string;
let quizEmpty: string;

beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
  quizA = await createQuiz(pool);
  quizB = await createQuiz(pool);
  quizEmpty = await createQuiz(pool);
  const questionsA = await createQuestions(pool, quizA, 2);
  const questionsB = await createQuestions(pool, quizB, 1);
  for (let i = 0; i < 3; i++) {
    const { id } = await createUser(pool);
    await submitQuiz(pool, player(id), { userId: id, quizId: quizA, answers: answersFor(questionsA) });
    if (i === 0) await submitQuiz(pool, player(id), { userId: id, quizId: quizB, answers: answersFor(questionsB) });
  }
});

describe('get_quiz_attempt_counts_by_quiz', () => {
  it('returns { quiz_id, attempt_count } rows counting every player', async () => {
    const result = await as(pool, serviceRole, (db) => db.query(COUNTS_SQL, [[quizA, quizB, quizEmpty]]));

    expect(result.fields.map((f) => f.name)).toEqual(['quiz_id', 'attempt_count']);
    // attempt_count is bigint (a string here, a JSON number via PostgREST): the app wraps it in Number()
    const counts = Object.fromEntries(result.rows.map((r) => [r.quiz_id, Number(r.attempt_count)]));
    expect(counts).toEqual({ [quizA]: 3, [quizB]: 1 });
  });

  it('leaves out quizzes with no attempts and quizzes not asked for', async () => {
    const result = await as(pool, serviceRole, (db) => db.query(COUNTS_SQL, [[quizB, quizEmpty]]));

    expect(result.rows.map((r) => r.quiz_id)).toEqual([quizB]);
  });

  it('returns nothing for an empty id list', async () => {
    const result = await as(pool, serviceRole, (db) => db.query(COUNTS_SQL, [[]]));

    expect(result.rows).toEqual([]);
  });

  it('can only be executed by the service role', async () => {
    const someone = await createUser(pool);
    expect((await errorAs(pool, player(someone.id), COUNTS_SQL, [[quizA]])).code).toBe('42501');
    expect((await errorAs(pool, anon, COUNTS_SQL, [[quizA]])).code).toBe('42501');
  });
});
