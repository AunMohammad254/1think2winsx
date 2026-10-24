// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { argOf, createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));

const { adminName, logQuizAction, listQuizActions } = await import('@/lib/admin-action-log');
const { QUIZ_ACTION_LABELS } = await import('@/lib/admin-action-labels');

beforeEach(() => {
  adminDb = createSupabaseMock();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('logQuizAction', () => {
  it('adds one row naming the quiz, the action and the admin', async () => {
    await logQuizAction({ quizId: 'q1', quizTitle: 'Final', action: 'quiz_paused', adminEmail: 'boss@example.test', details: { from: 'active' } });
    await logQuizAction({ quizId: 'q2', action: 'quiz_deleted', adminEmail: 'boss@example.test' });
    expect(adminDb.callsTo('AdminActionLog', 'insert').map((c) => argOf(c, 'insert'))).toEqual([
      { quizId: 'q1', quizTitle: 'Final', action: 'quiz_paused', adminEmail: 'boss@example.test', details: { from: 'active' } },
      { quizId: 'q2', quizTitle: null, action: 'quiz_deleted', adminEmail: 'boss@example.test', details: {} },
    ]);
  });

  it('never fails the admin action: a refused or thrown write is only logged', async () => {
    adminDb.setTable('AdminActionLog', { error: { message: 'relation "AdminActionLog" does not exist' } });
    await expect(logQuizAction({ quizId: 'q1', action: 'quiz_published', adminEmail: 'a@b.c' })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[admin-action-log] Could not record quiz_published on quiz q1:', { message: 'relation "AdminActionLog" does not exist' });
    adminDb.client.from.mockImplementationOnce(() => { throw new Error('no client'); });
    await expect(logQuizAction({ quizId: 'q1', action: 'quiz_published', adminEmail: 'a@b.c' })).resolves.toBeUndefined();
  });
});

describe('listQuizActions', () => {
  it("reads one quiz's actions, newest first", async () => {
    const row = { id: 'l1', quizId: 'q1', quizTitle: 'Final', action: 'quiz_settled', adminEmail: 'a@b.c', details: {}, createdAt: '2026-10-24T10:00:00Z' };
    adminDb.setTable('AdminActionLog', { data: [row] });
    expect(await listQuizActions('q1')).toEqual([row]);
    const call = adminDb.callsTo('AdminActionLog')[0];
    expect(eqValue(call, 'quizId')).toBe('q1');
    expect(call.ops.find((o) => o.op === 'order')?.args).toEqual(['createdAt', { ascending: false }]);
    expect(argOf(call, 'limit')).toBe(200);
  });

  it('copes with no rows, and throws a failed read', async () => {
    adminDb.setTable('AdminActionLog', { data: null });
    expect(await listQuizActions('q1', 5)).toEqual([]);
    adminDb.setTable('AdminActionLog', { error: { message: 'down' } });
    await expect(listQuizActions('q1')).rejects.toEqual({ message: 'down' });
  });
});

it('records an admin by email, or by user id when the session has no email', () => {
  expect(adminName({ id: 'u1', email: 'boss@example.test' })).toBe('boss@example.test');
  expect(adminName({ id: 'u1', email: null })).toBe('u1');
  expect(adminName({ id: 'u1' })).toBe('u1');
});

it('names every action for the History tab', () => {
  for (const label of Object.values(QUIZ_ACTION_LABELS)) expect(label).toMatch(/^[A-Z]/);
});
