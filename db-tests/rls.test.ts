/**
 * Row-level security and table privileges as the browser sees them: supabase-js with the
 * anon key (role anon) or a signed-in session (role authenticated).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  anon,
  answersFor,
  createDailyPayment,
  createNotification,
  createPool,
  createQuestion,
  createQuestions,
  createQuiz,
  createUser,
  errorAs,
  insertOlderAnswers,
  player,
  queryAs,
  resetData,
  setWalletEnabled,
  submitQuiz,
  type Caller,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

let alice: { id: string; email: string };
let bob: { id: string; email: string };
let quizId: string;
let bobNotificationId: string;
let aliceNotificationId: string;

// Read-only checks share one data set; the write tests below only make changes that fail
// or that they undo.
beforeAll(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, true);
  alice = await createUser(pool);
  bob = await createUser(pool);
  quizId = await createQuiz(pool);
  const questionIds = await createQuestions(pool, quizId, 2);
  await createQuestion(pool, quizId, { hasCorrectAnswer: true, correctOption: 3 });
  for (const u of [alice, bob]) {
    await createDailyPayment(pool, u.id);
    const r = await submitQuiz(pool, player(u.id), { userId: u.id, quizId, answers: answersFor(questionIds) });
    expect(r.success).toBe(true);
    // "Answer" is no longer written, but players can still read their older rows there
    await insertOlderAnswers(pool, u.id, quizId);
  }
  aliceNotificationId = await createNotification(pool, alice.id);
  bobNotificationId = await createNotification(pool, bob.id);
});

const OWN_ROW_TABLES = ['QuizAttempt', 'QuestionAttempt', 'Answer', 'DailyPayment', 'Notification'];

/** Rows `caller` can SELECT from `table`, or 'denied' when the role has no SELECT privilege. */
async function visible(caller: Caller, table: string, columns = '*'): Promise<any[] | 'denied'> {
  try {
    return await queryAs(pool, caller, `SELECT ${columns} FROM "${table}"`);
  } catch (error) {
    if (error instanceof pg.DatabaseError && error.code === '42501') return 'denied';
    throw error;
  }
}

describe('a signed-in player reads only their own rows', () => {
  it.each(OWN_ROW_TABLES)('%s', async (table) => {
    const all = await pool.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "userId" = $1`, [alice.id]);
    expect(all.rows[0].n).toBeGreaterThan(0);

    const rows = await visible(player(alice.id), table, '"userId"');

    expect(rows).not.toBe('denied');
    expect(rows).toHaveLength(all.rows[0].n);
    expect(new Set((rows as any[]).map((r) => r.userId))).toEqual(new Set([alice.id]));
  });

  it.each(OWN_ROW_TABLES)("%s: asking for another player's rows returns nothing", async (table) => {
    expect(await queryAs(pool, player(alice.id), `SELECT * FROM "${table}" WHERE "userId" = $1`, [bob.id])).toEqual([]);
  });

  it('can read quizzes and questions but not the answer key (Question.correctOption)', async () => {
    const me = player(alice.id);
    expect(await queryAs(pool, me, `SELECT id FROM "Quiz"`)).toEqual([{ id: quizId }]);
    expect(await queryAs(pool, me, `SELECT id, "hasCorrectAnswer" FROM "Question"`)).toHaveLength(3);
    expect((await errorAs(pool, me, `SELECT "correctOption" FROM "Question"`)).code).toBe('42501');
  });
});

describe('anon (signed out)', () => {
  it('sees no Quiz rows (SELECT is granted, but no policy lets anon through)', async () => {
    expect(await visible(anon, 'Quiz')).toEqual([]);
  });

  it('cannot read Question at all', async () => {
    expect(await visible(anon, 'Question')).toBe('denied');
  });

  it.each(OWN_ROW_TABLES)('sees no %s rows', async (table) => {
    const rows = await visible(anon, table);
    expect(rows === 'denied' || rows.length === 0).toBe(true);
  });
});

describe('players cannot write quiz, attempt or payment tables directly', () => {
  const me = () => player(alice.id);

  it.each([
    ['QuizAttempt', `INSERT INTO "QuizAttempt" (id, "userId", "quizId", "isCompleted", "updatedAt") VALUES ('x', $1, $2, true, now())`],
    ['QuestionAttempt', `INSERT INTO "QuestionAttempt" (id, "userId", "questionId", "quizId", "selectedOption") SELECT 'x', $1, id, $2, 0 FROM "Question" LIMIT 1`],
    ['Answer', `INSERT INTO "Answer" (id, "userId", "questionId", "quizAttemptId", "selectedOption") SELECT 'x', $1, q.id, a.id, 0 FROM "Question" q, "QuizAttempt" a WHERE a."quizId" = $2 LIMIT 1`],
    ['DailyPayment', `INSERT INTO "DailyPayment" (id, "userId", status, "expiresAt", "updatedAt") SELECT 'x', $1, 'completed', now() + interval '1 day', now() WHERE $2::text IS NOT NULL`],
    ['Quiz', `INSERT INTO "Quiz" (id, title, "updatedAt") SELECT 'x', 'mine', now() WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL`],
    ['Question', `INSERT INTO "Question" (id, "quizId", text, options, "updatedAt") SELECT 'x', $2, 't', '[]', now() WHERE $1::text IS NOT NULL`],
  ])('INSERT into %s is denied', async (_table, sql) => {
    expect((await errorAs(pool, me(), sql, [alice.id, quizId])).code).toBe('42501');
  });

  it.each([
    ['QuizAttempt', `UPDATE "QuizAttempt" SET score = 100, points = 100 WHERE "userId" = $1`],
    ['QuestionAttempt', `UPDATE "QuestionAttempt" SET "selectedOption" = 3, "isCorrect" = true WHERE "userId" = $1`],
    ['Answer', `UPDATE "Answer" SET "isCorrect" = true WHERE "userId" = $1`],
    ['DailyPayment', `UPDATE "DailyPayment" SET "expiresAt" = now() + interval '1 year' WHERE "userId" = $1`],
    ['Quiz', `UPDATE "Quiz" SET status = 'active' WHERE $1::text IS NOT NULL`],
    ['Question', `UPDATE "Question" SET "hasCorrectAnswer" = false WHERE $1::text IS NOT NULL`],
    ['User', `UPDATE "User" SET points = 1000000, "walletBalance" = 1000000 WHERE id = $1`],
  ])('UPDATE of %s is denied', async (_table, sql) => {
    expect((await errorAs(pool, me(), sql, [alice.id])).code).toBe('42501');
  });

  it.each(['QuizAttempt', 'QuestionAttempt', 'Answer', 'DailyPayment', 'Quiz', 'Question'])(
    'DELETE from %s is denied',
    async (table) => {
      expect((await errorAs(pool, me(), `DELETE FROM "${table}" WHERE $1::text IS NOT NULL`, [alice.id])).code).toBe('42501');
    },
  );

  it('anon cannot create a DailyPayment either', async () => {
    const sql = `INSERT INTO "DailyPayment" (id, "userId", status, "expiresAt", "updatedAt") VALUES ('x', $1, 'completed', now() + interval '1 day', now())`;
    expect((await errorAs(pool, anon, sql, [alice.id])).code).toBe('42501');
  });
});

describe('Notification writes', () => {
  const insertSql = `INSERT INTO "Notification" (id, "userId", title, message, type) VALUES ('n_forged', $1, 't', 'm', 'general')`;

  it('a player cannot create notifications, even for themselves (admins only)', async () => {
    const error = await errorAs(pool, player(alice.id), insertSql, [alice.id]);
    expect(error.code).toBe('42501');
    expect(error.message).toMatch(/row-level security/);
  });

  it('anon cannot create notifications', async () => {
    expect((await errorAs(pool, anon, insertSql, [alice.id])).code).toBe('42501');
  });

  it("a player cannot update or delete someone else's notification", async () => {
    const me = player(alice.id);
    expect(await queryAs(pool, me, `UPDATE "Notification" SET read = true WHERE id = $1 RETURNING id`, [bobNotificationId])).toEqual([]);
    expect(await queryAs(pool, me, `DELETE FROM "Notification" WHERE id = $1 RETURNING id`, [bobNotificationId])).toEqual([]);

    const { rows } = await pool.query(`SELECT read FROM "Notification" WHERE id = $1`, [bobNotificationId]);
    expect(rows).toEqual([{ read: false }]);
  });

  it('a player can mark their own notification as read', async () => {
    const rows = await queryAs(pool, player(alice.id), `UPDATE "Notification" SET read = true WHERE id = $1 RETURNING read`, [
      aliceNotificationId,
    ]);
    expect(rows).toEqual([{ read: true }]);
    await pool.query(`UPDATE "Notification" SET read = false WHERE id = $1`, [aliceNotificationId]);
  });
});
