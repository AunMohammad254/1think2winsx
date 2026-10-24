/**
 * Migration 06-20261024210000: the admin action log. The server can add and read rows, never change or
 * delete them; players can't reach it at all; a row outlives its quiz.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, createQuiz, createUser, errorAs, player, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

beforeEach(async () => {
  await resetData(pool);
});

const add = (quizId: string, action = 'quiz_paused') =>
  queryAs(pool, serviceRole, `INSERT INTO "AdminActionLog" ("quizId", "quizTitle", action, "adminEmail", details)
    VALUES ($1, 'Final', $2, 'boss@example.test', '{"from":"active"}') RETURNING id`, [quizId, action]);

describe('AdminActionLog', () => {
  it('takes and returns rows for the server, with an id and a time', async () => {
    const quizId = await createQuiz(pool);
    const [{ id }] = await add(quizId);
    const rows = await queryAs(pool, serviceRole, `SELECT * FROM "AdminActionLog" WHERE "quizId" = $1`, [quizId]);
    expect(rows).toEqual([{
      id, quizId, quizTitle: 'Final', action: 'quiz_paused', adminEmail: 'boss@example.test', details: { from: 'active' }, createdAt: expect.any(Date),
    }]);
  });

  it('is append-only for the server', async () => {
    const quizId = await createQuiz(pool);
    await add(quizId);
    expect((await errorAs(pool, serviceRole, `UPDATE "AdminActionLog" SET "adminEmail" = 'someone@else.test'`)).code).toBe('42501');
    expect((await errorAs(pool, serviceRole, `DELETE FROM "AdminActionLog"`)).code).toBe('42501');
  });

  it('keeps the record of a deleted quiz', async () => {
    const quizId = await createQuiz(pool);
    await add(quizId, 'quiz_deleted');
    await pool.query(`DELETE FROM "Quiz" WHERE id = $1`, [quizId]);
    expect((await pool.query(`SELECT action FROM "AdminActionLog" WHERE "quizId" = $1`, [quizId])).rows).toEqual([{ action: 'quiz_deleted' }]);
  });

  it('only takes action names the app uses', async () => {
    const quizId = await createQuiz(pool);
    expect((await errorAs(pool, serviceRole, `INSERT INTO "AdminActionLog" ("quizId", action, "adminEmail") VALUES ($1, 'DROP TABLE', 'a@b.c')`, [quizId])).code).toBe('23514');
  });

  it('is out of reach for players', async () => {
    const user = await createUser(pool);
    expect((await errorAs(pool, player(user.id), `SELECT * FROM "AdminActionLog"`)).code).toBe('42501');
    expect((await errorAs(pool, player(user.id), `INSERT INTO "AdminActionLog" (action, "adminEmail") VALUES ('quiz_paused', 'me')`)).code).toBe('42501');
  });
});
