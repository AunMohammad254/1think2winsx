import { describe, it, expect } from 'vitest';
import { QuizFormSchema } from '@/lib/schemas/QuizFormSchema';

const base = {
  title: 'Friday sports quiz',
  duration: 10,
  passingScore: 50,
  quizType: 'normal' as const,
  questions: [
    {
      text: 'Who won the 1992 Cricket World Cup?',
      options: [
        { text: 'Pakistan', isCorrect: true },
        { text: 'England', isCorrect: false },
      ],
      correctOption: 0,
      status: 'active' as const,
    },
  ],
};

describe('QuizFormSchema startsAt', () => {
  it.each(['scheduled', 'upcoming'] as const)('requires a date when status is %s', (status) => {
    const result = QuizFormSchema.safeParse({ ...base, status, startsAt: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'startsAt')).toBe(true);
    }
  });

  it('rejects an unparseable date', () => {
    expect(QuizFormSchema.safeParse({ ...base, status: 'scheduled', startsAt: 'not-a-date' }).success).toBe(false);
  });

  it('accepts a scheduled quiz with a valid date', () => {
    expect(QuizFormSchema.safeParse({ ...base, status: 'scheduled', startsAt: '2026-12-01T18:30' }).success).toBe(true);
  });

  it('does not require a date for draft/active quizzes', () => {
    expect(QuizFormSchema.safeParse({ ...base, status: 'draft', startsAt: null }).success).toBe(true);
    expect(QuizFormSchema.safeParse({ ...base, status: 'active' }).success).toBe(true);
  });
});
