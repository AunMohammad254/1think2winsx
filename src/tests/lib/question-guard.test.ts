// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));

const { answeredQuestionError, answeredQuestionIds, sameOptions } = await import('@/lib/question-guard');

beforeEach(() => {
  adminDb = createSupabaseMock();
});

describe('sameOptions', () => {
  it('compares the stored JSON by value, spacing aside', () => {
    expect(sameOptions('["A","B"]', ['A', 'B'])).toBe(true);
    expect(sameOptions('[ "A", "B" ]', ['A', 'B'])).toBe(true);
    expect(sameOptions(['A', 'B'], ['A', 'B'])).toBe(true);
  });

  it('sees a reorder, a rename, an added or removed option, and unreadable data as a change', () => {
    expect(sameOptions('["A","B"]', ['B', 'A'])).toBe(false);
    expect(sameOptions('["A","B"]', ['A', 'C'])).toBe(false);
    expect(sameOptions('["A","B"]', ['A', 'B', 'C'])).toBe(false);
    expect(sameOptions('["A","B"]', ['A'])).toBe(false);
    expect(sameOptions('not json', ['A'])).toBe(false);
    expect(sameOptions(undefined, ['A'])).toBe(false);
    expect(sameOptions('{"A":1}', ['A'])).toBe(false);
  });
});

describe('answeredQuestionIds', () => {
  it('finds questions with an answer', async () => {
    adminDb.setTable('QuestionAttempt', (call) => ({ data: ({ q1: [{ id: 'qa' }], q2: [] } as Record<string, unknown[]>)[eqValue(call, 'questionId') as string] ?? null }));
    expect(await answeredQuestionIds(['q1', 'q2', 'q3'])).toEqual(new Set(['q1']));
    // Answers are read from one table now: "Answer" is no longer written
    expect(adminDb.callsTo('Answer')).toHaveLength(0);
  });

  it('asks nothing for no questions, and at most 20 questions at a time', async () => {
    expect(await answeredQuestionIds([])).toEqual(new Set());
    expect(adminDb.calls).toHaveLength(0);
    const ids = Array.from({ length: 45 }, (_, i) => `q${i}`);
    expect((await answeredQuestionIds(ids)).size).toBe(0);
    expect(adminDb.callsTo('QuestionAttempt')).toHaveLength(45);
  });

  it('throws when a lookup fails, so an edit is never let through unchecked', async () => {
    adminDb.setTable('QuestionAttempt', { error: { message: 'timeout' } });
    await expect(answeredQuestionIds(['q1'])).rejects.toEqual({ message: 'timeout' });
  });
});

describe('answeredQuestionError', () => {
  it('names the question, and how many more there are', () => {
    expect(answeredQuestionError('Toss?')).toBe('Players have already answered "Toss?", so it can\'t be removed and its options can\'t change. You can still edit its wording.');
    expect(answeredQuestionError('Toss?', 2)).toContain('"Toss?" (and 2 more)');
  });
});
