// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseQuizSignal, applyQuizSignal, type QuizSignal } from '@/lib/quiz-signal';

const sig = (over: Partial<QuizSignal> = {}): QuizSignal => ({ op: 'UPDATE', id: 'q1', title: 'T', status: 'active', pushedAt: null, ...over });

interface Item { id: string; title: string; status: string; pushedAt?: string | null; isCompleted?: boolean }
const list = (): Item[] => [
  { id: 'q1', title: 'Old title', status: 'upcoming', pushedAt: null, isCompleted: true },
  { id: 'q2', title: 'Other', status: 'active', pushedAt: '2026-01-01T00:00:00Z' },
];

describe('parseQuizSignal', () => {
  it('reads the payload the database trigger sends', () => {
    expect(parseQuizSignal({ type: 'broadcast', event: 'quiz_changed', payload: { op: 'UPDATE', id: 'q1', title: 'T', status: 'active', pushedAt: '2026-10-09T10:00:00Z', at: 123 } }))
      .toEqual({ op: 'UPDATE', id: 'q1', title: 'T', status: 'active', pushedAt: '2026-10-09T10:00:00Z' });
  });

  it('also accepts the bare payload', () => {
    expect(parseQuizSignal({ op: 'INSERT', id: 'q9', title: 'N', status: 'upcoming', pushedAt: null })?.op).toBe('INSERT');
  });

  it('never throws on garbage, and returns null instead', () => {
    for (const bad of [null, undefined, 'x', 42, [], {}, { payload: null }, { payload: { op: 'DROP', id: 'x' } }, { payload: { op: 'UPDATE' } }, { payload: { op: 'UPDATE', id: '' } }]) {
      expect(parseQuizSignal(bad)).toBeNull();
    }
  });

  it('coerces missing optional fields to safe defaults', () => {
    expect(parseQuizSignal({ payload: { op: 'DELETE', id: 'q1' } })).toEqual({ op: 'DELETE', id: 'q1', title: '', status: '', pushedAt: null });
  });
});

describe('applyQuizSignal', () => {
  it('a quiz going live patches the existing card in place, with NO refetch (no stampede)', () => {
    const r = applyQuizSignal(list(), sig({ status: 'active', pushedAt: '2026-10-09T10:00:00Z', title: 'New title' }));
    expect(r.needsFetch).toBe(false);
    expect(r.list[0]).toMatchObject({ id: 'q1', title: 'New title', status: 'active', pushedAt: '2026-10-09T10:00:00Z' });
    expect(r.list[0].isCompleted).toBe(true); // the player's own fields are untouched
    expect(r.list[1]).toEqual(list()[1]); // other quizzes untouched
  });

  it('does not mutate the list it was given', () => {
    const before = list();
    applyQuizSignal(before, sig({ status: 'active' }));
    expect(before).toEqual(list());
  });

  it('keeps the old title when the signal has none', () => {
    const r = applyQuizSignal(list(), sig({ title: '' }));
    expect(r.list[0].title).toBe('Old title');
  });

  it('a quiz the player does not have yet needs a (delayed) fetch, and the list is unchanged', () => {
    const l = list();
    const r = applyQuizSignal(l, sig({ op: 'INSERT', id: 'new-quiz', status: 'upcoming' }));
    expect(r.needsFetch).toBe(true);
    expect(r.list).toBe(l);
  });

  it('DELETE removes the quiz', () => {
    const r = applyQuizSignal(list(), sig({ op: 'DELETE', id: 'q2' }));
    expect(r.needsFetch).toBe(false);
    expect(r.list.map((q) => q.id)).toEqual(['q1']);
  });

  it('DELETE of an unknown quiz is a no-op (same list reference)', () => {
    const l = list();
    const r = applyQuizSignal(l, sig({ op: 'DELETE', id: 'nope' }));
    expect(r.list).toBe(l);
    expect(r.needsFetch).toBe(false);
  });

  it('a quiz moved to a status players never see (draft, completed) disappears from the list', () => {
    expect(applyQuizSignal(list(), sig({ status: 'draft' })).list.map((q) => q.id)).toEqual(['q2']);
    expect(applyQuizSignal(list(), sig({ status: 'completed' })).list.map((q) => q.id)).toEqual(['q2']);
  });

  it('paused stays listed (the catalogue shows paused quizzes)', () => {
    expect(applyQuizSignal(list(), sig({ status: 'paused' })).list[0].status).toBe('paused');
  });

  it('an update with an unknown/empty status does not wipe the existing status', () => {
    expect(applyQuizSignal(list(), sig({ status: '' })).list[0].status).toBe('upcoming');
  });
});
