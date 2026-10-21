/**
 * Functions that were dropped because they were broken and nothing called them.
 * validate_quiz_submission_time read QuizAttempt."startedAt", a column that doesn't exist, so every
 * call failed. submit_quiz_attempt enforces the answering window itself (submit-quiz-attempt.test.ts).
 * Dropped by schema/06-20261018120000_fix_stock_and_submission_time.sql.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createPool, createUser, errorAs, player } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const REMOVED = ['validate_quiz_submission_time'];

describe('removed functions', () => {
  it.each(REMOVED)('%s has no overload left in public', async (name) => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = $1`,
      [name],
    );
    expect(rows[0].n).toBe(0);
  });

  it('validate_quiz_submission_time is gone for signed-in players, who could call it before', async () => {
    const someone = await createUser(pool);

    const error = await errorAs(
      pool,
      player(someone.id),
      `SELECT * FROM public.validate_quiz_submission_time(p_quiz_id => $1, p_attempt_id => $2)`,
      ['quiz_x', 'attempt_x'],
    );
    expect(error.code).toBe('42883'); // undefined_function
  });
});
