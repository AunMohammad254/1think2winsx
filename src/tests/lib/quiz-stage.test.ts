import { describe, it, expect } from 'vitest';
import { answeringClosesAt, quizStage, STAGE_LABELS, type QuizStageInput } from '@/lib/quiz-stage';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const quiz = (over: Partial<QuizStageInput> = {}): QuizStageInput => ({
  status: 'active', pushedAt: minutesAgo(5), duration: 10, settledAt: null, totalQuestions: 2, questionsWithResult: 0, ...over,
});

describe('answeringClosesAt', () => {
  it('is pushedAt + duration + the 30 s grace the database allows', () => {
    expect(answeringClosesAt('2026-10-19T12:00:00Z', 10)).toBe(Date.parse('2026-10-19T12:10:30Z'));
  });

  it('is null without a window', () => {
    expect(answeringClosesAt(null, 10)).toBeNull();
    expect(answeringClosesAt('2026-10-19T12:00:00Z', null)).toBeNull();
    expect(answeringClosesAt('2026-10-19T12:00:00Z', 0)).toBeNull();
    expect(answeringClosesAt('not a date', 10)).toBeNull();
  });
});

describe('quizStage', () => {
  it('is settled once settled, whatever else is true', () => {
    expect(quizStage(quiz({ settledAt: '2026-10-19T11:00:00Z', status: 'upcoming' }), NOW)).toBe('settled');
  });

  it('is upcoming before a quiz goes live', () => {
    for (const status of ['upcoming', 'scheduled', 'draft']) expect(quizStage(quiz({ status }), NOW)).toBe('upcoming');
  });

  it('is ready to settle once every question has its result, even inside the window', () => {
    expect(quizStage(quiz({ questionsWithResult: 2 }), NOW)).toBe('ready_to_settle');
    // A quiz without questions is never ready
    expect(quizStage(quiz({ totalQuestions: 0, questionsWithResult: 0, pushedAt: minutesAgo(60) }), NOW)).toBe('awaiting_result');
  });

  it('is open inside the answering window and awaiting the result after it', () => {
    expect(quizStage(quiz({ pushedAt: minutesAgo(10) }), NOW)).toBe('open'); // still in the 30 s grace
    expect(quizStage(quiz({ pushedAt: minutesAgo(11), questionsWithResult: 1 }), NOW)).toBe('awaiting_result');
  });

  it('without a window: open while active, awaiting the result otherwise', () => {
    expect(quizStage(quiz({ pushedAt: null }), NOW)).toBe('open');
    expect(quizStage(quiz({ pushedAt: null, status: 'paused' }), NOW)).toBe('awaiting_result');
  });

  it('has a label for every stage', () => {
    expect(Object.keys(STAGE_LABELS)).toEqual(['upcoming', 'open', 'awaiting_result', 'ready_to_settle', 'settled']);
  });
});
