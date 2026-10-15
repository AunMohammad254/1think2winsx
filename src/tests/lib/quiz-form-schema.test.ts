import { describe, it, expect } from 'vitest';
import {
  QuizFormSchema, CreateQuizInputSchema, validateQuizForm, validateQuizSubmission, defaultQuiz, defaultQuestion, defaultOption,
} from '@/lib/schemas/QuizFormSchema';

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

describe('QuizFormSchema correct options', () => {
  it('needs a correct option on every question of a normal quiz', () => {
    for (const correctOption of [null, undefined, -1]) {
      const result = validateQuizForm({ ...base, questions: [{ ...base.questions[0], correctOption }] });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.errors[0]).toMatchObject({ path: ['questions', 0, 'correctOption'], message: 'Correct option must be selected for normal quizzes' });
    }
  });

  it('lets a predictable quiz leave the answer open', () => {
    const result = validateQuizForm({ ...base, quizType: 'predictable', questions: [{ ...base.questions[0], correctOption: null }] });
    expect(result.success).toBe(true);
  });

  it('fills in defaults on a valid form', () => {
    const result = validateQuizForm(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ timeUpDuration: 60, accessPrice: 2, difficulty: 'medium', status: 'draft', isBumperPrize: false });
  });

  it('applies the same rules when creating, ignoring any id', () => {
    const parsed = CreateQuizInputSchema.safeParse({ ...base, id: 'q1' });
    expect(parsed.success && 'id' in parsed.data).toBe(false);
    expect(CreateQuizInputSchema.safeParse({ ...base, questions: [{ ...base.questions[0], correctOption: null }] }).success).toBe(false);
  });
});

describe('validateQuizSubmission', () => {
  it('accepts answers and rejects empty or negative ones', () => {
    expect(validateQuizSubmission({ quizId: 'q1', answers: [{ questionId: 'a', selectedOption: 0 }] })).toEqual({ success: true, data: { quizId: 'q1', answers: [{ questionId: 'a', selectedOption: 0 }] } });
    const empty = validateQuizSubmission({ quizId: 'q1', answers: [] });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.errors[0].message).toBe('At least 1 answer required');
    expect(validateQuizSubmission({ quizId: 'q1', answers: [{ questionId: 'a', selectedOption: -1 }] }).success).toBe(false);
  });
});

describe('form defaults', () => {
  it('start a new quiz as a draft with one blank four-option question', () => {
    expect(defaultOption).toEqual({ text: '', isCorrect: false });
    expect(defaultQuestion.options).toHaveLength(4);
    expect(defaultQuiz).toMatchObject({ status: 'draft', duration: 30, passingScore: 70, questions: [defaultQuestion] });
    // a blank form is not submittable until the admin fills it in
    expect(validateQuizForm(defaultQuiz).success).toBe(false);
  });
});
