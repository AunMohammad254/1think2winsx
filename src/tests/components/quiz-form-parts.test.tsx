// The pieces QuizFormBuilder is built from, on their own. The builder's own test drives them
// through the whole form; these pin down each piece's contract with the builder.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import type { QuizFormData } from '@/lib/schemas/QuizFormSchema';
import QuestionCard from '@/components/admin/quiz-form/QuestionCard';
import FormActions from '@/components/admin/quiz-form/FormActions';
import FormErrorSummary from '@/components/admin/quiz-form/FormErrorSummary';
import FieldError from '@/components/admin/quiz-form/FieldError';

describe('QuestionCard', () => {
  const handlers = () => ({
    onToggle: vi.fn(), onMove: vi.fn(), onRemove: vi.fn(),
    onSetCorrect: vi.fn(), onAddOption: vi.fn(), onRemoveOption: vi.fn(),
  });
  const card = (questionIndex: number, questionCount: number, h = handlers()) => {
    render(
      <QuestionCard
        {...h}
        questionIndex={questionIndex}
        questionCount={questionCount}
        isExpanded={false}
        question={{ text: 'Who won?', options: [], correctOption: null, status: 'active' }}
        quizType="normal"
        register={vi.fn() as unknown as UseFormRegister<QuizFormData>}
      />,
    );
    return h;
  };

  it('moves and removes its own question without collapsing or expanding the card', () => {
    const h = card(1, 3);
    const [up, down, remove] = screen.getAllByRole('button');
    fireEvent.click(up);
    fireEvent.click(down);
    fireEvent.click(remove);
    expect(h.onMove.mock.calls).toEqual([[1, 'up'], [1, 'down']]);
    expect(h.onRemove).toHaveBeenCalledWith(1);
    expect(h.onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Question 2'));
    expect(h.onToggle).toHaveBeenCalledWith(1);
  });

  it('cannot move the first question up or the last one down', () => {
    card(0, 1);
    const [up, down] = screen.getAllByRole('button');
    expect(up).toBeDisabled();
    expect(down).toBeDisabled();
    expect(screen.queryByPlaceholderText('Enter your question')).toBeNull();
  });
});

describe('FormActions', () => {
  it('shows Cancel only when the form can be cancelled, and the unsaved note only when dirty', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<FormActions isDirty={false} isEditing={false} isSubmitting={false} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
    rerender(<FormActions isDirty isEditing={false} isSubmitting={false} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  });

  it('labels and disables the save button for each mode', () => {
    const { rerender } = render(<FormActions isDirty={false} isEditing={false} isSubmitting={false} />);
    expect(screen.getByRole('button', { name: 'Create Quiz' })).toBeEnabled();
    rerender(<FormActions isDirty={false} isEditing={false} isSubmitting />);
    expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled();
    rerender(<FormActions isDirty={false} isEditing isSubmitting={false} />);
    expect(screen.getByRole('button', { name: 'Update Quiz' })).toBeEnabled();
    rerender(<FormActions isDirty={false} isEditing isSubmitting />);
    expect(screen.getByRole('button', { name: 'Updating...' })).toBeDisabled();
  });
});

describe('FormErrorSummary and FieldError', () => {
  it('render nothing while there are no errors', () => {
    const { container } = render(<><FormErrorSummary errors={{}} /><FieldError /></>);
    expect(container).toBeEmptyDOMElement();
  });

  it('list each failing field, with a fallback for the questions array', () => {
    const errors = {
      title: { type: 'too_small', message: 'Title must be at least 3 characters' },
      questions: [{ text: { type: 'too_small', message: 'Too short' } }],
    } as unknown as FieldErrors<QuizFormData>;
    render(<><FormErrorSummary errors={errors} /><FieldError error={errors.title} /></>);
    expect(screen.getByText('Please fix the following errors to save:')).toBeInTheDocument();
    expect(screen.getByText('title: Title must be at least 3 characters')).toBeInTheDocument();
    expect(screen.getByText('questions: Errors in list')).toBeInTheDocument();
    expect(screen.getByText('Title must be at least 3 characters', { selector: 'p' })).toHaveClass('mt-1 text-sm text-red-400');
  });
});
