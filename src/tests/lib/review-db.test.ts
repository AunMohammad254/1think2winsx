// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
vi.mock('@/lib/supabase/db-modules/shared', () => ({ getAdminDb: () => adminDb.client }));

const { reviewDb } = await import('@/lib/supabase/db-modules/review.db');

const ops = (i = 0) => adminDb.callsTo('Review')[i].ops;
const failure = { message: 'db down' };
const values = { rating: 5, comment: 'Brilliant quizzes!', displayName: 'Areeba K.', city: null };

beforeEach(() => {
  adminDb = createSupabaseMock();
});

describe('reviewDb', () => {
  it("finds the player's own review, or none", async () => {
    adminDb.setTable('Review', { data: { id: 'r1' } });
    expect(await reviewDb.findByUser('u1')).toEqual({ id: 'r1' });
    expect(eqValue(adminDb.callsTo('Review')[0], 'userId')).toBe('u1');
    adminDb.setTable('Review', { data: null });
    expect(await reviewDb.findByUser('u2')).toBeNull();
  });

  it('writes the one review per player and always sends it back to pending', async () => {
    adminDb.setTable('Review', { data: { id: 'r1', status: 'pending' } });
    expect(await reviewDb.upsertForUser('u1', values)).toEqual({ id: 'r1', status: 'pending' });
    const call = adminDb.callsTo('Review', 'upsert')[0];
    expect(call.ops.find((o) => o.op === 'upsert')!.args).toEqual([
      { userId: 'u1', ...values, status: 'pending', moderationNote: null, moderatedAt: null, moderatedBy: null, updatedAt: expect.any(String) },
      { onConflict: 'userId' },
    ]);
  });

  it('lists approved reviews newest first, without user ids', async () => {
    adminDb.setTable('Review', { data: [{ id: 'r1' }] });
    expect(await reviewDb.listApproved(12)).toEqual([{ id: 'r1' }]);
    expect(ops()).toEqual([
      { op: 'select', args: ['id, rating, comment, displayName, city, createdAt'] },
      { op: 'eq', args: ['status', 'approved'] },
      { op: 'order', args: ['createdAt', { ascending: false }] },
      { op: 'limit', args: [12] },
    ]);
    adminDb.setTable('Review', { data: null });
    expect(await reviewDb.listApproved(12)).toEqual([]);
  });

  it('averages the approved ratings to one decimal', async () => {
    adminDb.setTable('Review', { data: [{ rating: 5 }, { rating: 4 }, { rating: 4 }], count: 3 });
    expect(await reviewDb.approvedSummary()).toEqual({ count: 3, average: 4.3 });
    expect(eqValue(adminDb.callsTo('Review')[0], 'status')).toBe('approved');

    adminDb.setTable('Review', { data: [{ rating: 5 }], count: null });
    expect(await reviewDb.approvedSummary()).toEqual({ count: 1, average: 5 });
    adminDb.setTable('Review', { data: null, count: 0 });
    expect(await reviewDb.approvedSummary()).toEqual({ count: 0, average: 0 });
  });

  it('pages through reviews with the player attached, optionally by status', async () => {
    adminDb.setTable('Review', { data: [{ id: 'r1' }], count: 41 });
    expect(await reviewDb.list({ status: 'pending', page: 3, limit: 20 })).toEqual({ reviews: [{ id: 'r1' }], total: 41 });
    expect(ops()).toEqual([
      { op: 'select', args: ['*, user:User(name, email)', { count: 'exact' }] },
      { op: 'eq', args: ['status', 'pending'] },
      { op: 'order', args: ['createdAt', { ascending: false }] },
      { op: 'range', args: [40, 59] },
    ]);
    adminDb.setTable('Review', { data: null, count: null });
    expect(await reviewDb.list({ page: 1, limit: 20 })).toEqual({ reviews: [], total: 0 });
    expect(ops(1).filter((o) => o.op === 'eq')).toEqual([]);
  });

  it('counts reviews per status', async () => {
    adminDb.setTable('Review', (call) => ({ count: eqValue(call, 'status') === 'pending' ? 2 : null }));
    expect(await reviewDb.countByStatus()).toEqual({ pending: 2, approved: 0, rejected: 0 });
  });

  it('finds one review, records a decision with who and when, and deletes', async () => {
    adminDb.setTable('Review', { data: { id: 'r1', status: 'approved' } });
    expect(await reviewDb.findById('r1')).toEqual({ id: 'r1', status: 'approved' });
    expect(await reviewDb.moderate('r1', { status: 'approved', moderationNote: null, moderatedBy: 'boss@example.test' })).toEqual({ id: 'r1', status: 'approved' });
    const update = adminDb.callsTo('Review', 'update')[0];
    expect(argOf(update, 'update')).toEqual({ status: 'approved', moderationNote: null, moderatedBy: 'boss@example.test', moderatedAt: expect.any(String), updatedAt: expect.any(String) });
    expect(eqValue(update, 'id')).toBe('r1');

    adminDb.setTable('Review', { data: null });
    await reviewDb.remove('r1');
    expect(eqValue(adminDb.callsTo('Review', 'delete')[0], 'id')).toBe('r1');
  });

  it.each([
    ['findByUser', () => reviewDb.findByUser('u1')],
    ['upsertForUser', () => reviewDb.upsertForUser('u1', values)],
    ['listApproved', () => reviewDb.listApproved(12)],
    ['approvedSummary', () => reviewDb.approvedSummary()],
    ['list', () => reviewDb.list({ page: 1, limit: 20 })],
    ['countByStatus', () => reviewDb.countByStatus()],
    ['findById', () => reviewDb.findById('r1')],
    ['moderate', () => reviewDb.moderate('r1', { status: 'rejected', moderationNote: 'x', moderatedBy: 'a' })],
    ['remove', () => reviewDb.remove('r1')],
  ])('%s throws database errors', async (_name, call) => {
    adminDb.setTable('Review', { error: failure });
    await expect(call()).rejects.toEqual(failure);
  });
});
