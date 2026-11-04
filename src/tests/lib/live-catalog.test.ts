// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computePushStatus, liveModePolling, mergeLiveQuizzes, type LiveQuiz, type PushStatus } from '@/lib/live-catalog';

const live = (id: string, over: Partial<LiveQuiz> = {}): LiveQuiz => ({
  id, title: `Quiz ${id}`, description: '', duration: 10, passingScore: 70, status: 'active', questionCount: 5,
  totalAttempts: 0, entriesClosed: false, pushedAt: '2026-10-16T10:00:00.000Z', startsAt: null, announcedAt: null, createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z', prizeName: null, isBumperPrize: false, accessPrice: 0, freeEntry: false, ...over,
});
type Item = ReturnType<typeof live> & {
  hasAccess: boolean; isCompleted?: boolean; hasNewQuestions?: boolean; newQuestionsCount?: number; score?: number;
  pushStatus?: PushStatus;
};
const item = (id: string, over: Partial<Item> = {}): Item => ({ ...live(id), hasAccess: true, isCompleted: false, ...over });

describe('computePushStatus', () => {
  it('matches the badges the personal list shows', () => {
    expect(computePushStatus('upcoming', null, false)).toBe('upcoming');
    expect(computePushStatus('active', null, false)).toBeNull();
    expect(computePushStatus('active', '2026-10-16', true)).toBe('answered');
    expect(computePushStatus('paused', '2026-10-16', false)).toBe('time-up');
    expect(computePushStatus('active', '2026-10-16', false)).toBe('unanswered');
  });
});

describe('mergeLiveQuizzes', () => {
  it('takes public fields and order from the snapshot, and keeps what the player did', () => {
    const before = [item('a', { status: 'upcoming', pushedAt: null, pushStatus: 'upcoming' }), item('b', { isCompleted: true, score: 80 }), item('gone')];
    const { list, needsPersonalFetch } = mergeLiveQuizzes(before, [live('b', { totalAttempts: 7 }), live('a', { title: 'Now live' }), live('new')], false);

    expect(list.map((q) => q.id)).toEqual(['b', 'a', 'new']);
    expect(list[0]).toMatchObject({ isCompleted: true, score: 80, totalAttempts: 7, pushStatus: 'answered', hasAccess: true });
    expect(list[1]).toMatchObject({ title: 'Now live', status: 'active', pushStatus: 'unanswered', isCompleted: false });
    // A quiz the player has never seen cannot have been attempted
    expect(list[2]).toMatchObject({ hasAccess: false, isCompleted: false, hasNewQuestions: false, newQuestionsCount: 0, pushStatus: 'unanswered' });
    expect(needsPersonalFetch).toBe(false);
  });

  it('asks for the personal list only when questions change on a quiz this player completed', () => {
    const before = [item('done', { isCompleted: true }), item('open')];
    expect(mergeLiveQuizzes(before, [live('done', { questionCount: 6 }), live('open')], true).needsPersonalFetch).toBe(true);
    expect(mergeLiveQuizzes(before, [live('done'), live('open', { questionCount: 6 })], true).needsPersonalFetch).toBe(false);
  });

  it('in live mode, moves the "new questions" badge by the change in questions instead of asking for the personal list', () => {
    const before = [item('done', { isCompleted: true, score: 3 }), item('more', { isCompleted: true, hasNewQuestions: true, newQuestionsCount: 2 }), item('open')];
    const { list, needsPersonalFetch } = mergeLiveQuizzes(before, [
      live('done', { questionCount: 7 }), // two questions added
      live('more', { questionCount: 2 }), // three closed (their results saved): fewer to answer, never below none
      live('open', { questionCount: 9 }), // not completed: no badge to move
    ], true, true);
    expect(needsPersonalFetch).toBe(false);
    expect(list[0]).toMatchObject({ isCompleted: true, score: 3, hasNewQuestions: true, newQuestionsCount: 2, questionCount: 7, pushStatus: 'answered' });
    expect(list[1]).toMatchObject({ hasNewQuestions: false, newQuestionsCount: 0, questionCount: 2 });
    expect(list[2]).toMatchObject({ isCompleted: false, questionCount: 9 });
    expect(list[2]).not.toHaveProperty('newQuestionsCount');
  });
});

describe('liveModePolling', () => {
  it("runs a live mode poll every personalPollS ±10%, in useJitteredPolling's terms", () => {
    // 27 min + 0-6 min: 27-33 min
    expect(liveModePolling({ personalPollS: 1800 })).toEqual({ intervalMs: 1_620_000, jitterMs: 360_000 });
  });
});
