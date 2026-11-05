import { describe, it, expect } from 'vitest';
import { groupBy } from '@/lib/group-by';

describe('groupBy', () => {
  it('files items by key in one pass, keeping their order within each key', () => {
    const rows = [
      { quizId: 'q1', id: 'a' },
      { quizId: 'q2', id: 'b' },
      { quizId: 'q1', id: 'c' },
    ];
    const groups = groupBy(rows, (row) => row.quizId);
    expect([...groups.keys()]).toEqual(['q1', 'q2']);
    expect(groups.get('q1')!.map((row) => row.id)).toEqual(['a', 'c']);
    expect(groups.get('q2')!.map((row) => row.id)).toEqual(['b']);
  });

  it('returns an empty map for no items', () => {
    expect(groupBy([], (row: { id: string }) => row.id).size).toBe(0);
  });
});
