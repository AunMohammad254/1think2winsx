import type { FieldErrors } from 'react-hook-form';
import type { QuestionFormData, QuizFormData } from '@/lib/schemas/QuizFormSchema';

/** Validation errors of one question (`errors.questions[i]`). */
export type QuestionErrors = NonNullable<FieldErrors<QuizFormData>['questions']>[number];

/**
 * The question's current values. Can be undefined for a render while the field array
 * and the watched values catch up with each other.
 */
export type WatchedQuestion = QuestionFormData | undefined;

/** Callbacks the builder hands to every question card. */
export interface QuestionHandlers {
    onToggle: (index: number) => void;
    onMove: (index: number, direction: 'up' | 'down') => void;
    onRemove: (index: number) => void;
    onSetCorrect: (questionIndex: number, optionIndex: number) => void;
    onAddOption: (questionIndex: number) => void;
    onRemoveOption: (questionIndex: number, optionIndex: number) => void;
}
