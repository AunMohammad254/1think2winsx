import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionCard } from './QuestionCard';
import type { Question } from './types';

const mockQuestion: Question = {
    id: 'q1',
    text: 'What is the capital of France?',
    options: '["Paris", "London", "Berlin", "Madrid"]',
    correctOption: null,
    hasCorrectAnswer: false,
};

const mockQuestionWithAnswer: Question = {
    ...mockQuestion,
    correctOption: 0,
    hasCorrectAnswer: true,
};

describe('QuestionCard', () => {
    const mockOnAnswerChange = vi.fn();
    const mockOnToggle = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders question text', () => {
        render(
            <QuestionCard
                question={mockQuestion}
                index={0}
                correctAnswer={undefined}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={false}
                onToggle={mockOnToggle}
                disabled={false}
            />
        );

        expect(screen.getByText('What is the capital of France?')).toBeInTheDocument();
    });

    it('shows options when expanded', () => {
        render(
            <QuestionCard
                question={mockQuestion}
                index={0}
                correctAnswer={undefined}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={true}
                onToggle={mockOnToggle}
                disabled={false}
            />
        );

        expect(screen.getByText('Paris')).toBeInTheDocument();
        expect(screen.getByText('London')).toBeInTheDocument();
        expect(screen.getByText('Berlin')).toBeInTheDocument();
        expect(screen.getByText('Madrid')).toBeInTheDocument();
    });

    it('calls onToggle when header clicked', () => {
        render(
            <QuestionCard
                question={mockQuestion}
                index={0}
                correctAnswer={undefined}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={false}
                onToggle={mockOnToggle}
                disabled={false}
            />
        );

        const header = screen.getByRole('button');
        fireEvent.click(header);

        expect(mockOnToggle).toHaveBeenCalledTimes(1);
    });

    it('calls onAnswerChange when option selected', () => {
        render(
            <QuestionCard
                question={mockQuestion}
                index={0}
                correctAnswer={undefined}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={true}
                onToggle={mockOnToggle}
                disabled={false}
            />
        );

        const parisOption = screen.getByText('Paris');
        fireEvent.click(parisOption);

        expect(mockOnAnswerChange).toHaveBeenCalledWith(0);
    });

    it('shows checkmark when question is answered', () => {
        const { container } = render(
            <QuestionCard
                question={mockQuestion}
                index={0}
                correctAnswer={0}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={false}
                onToggle={mockOnToggle}
                disabled={false}
            />
        );

        expect(screen.getByText('✓')).toBeInTheDocument();
        // Should have green styling
        expect(container.firstChild).toHaveClass('bg-green-500/10');
    });

    it('shows question number when not answered', () => {
        render(
            <QuestionCard
                question={mockQuestion}
                index={0}
                correctAnswer={undefined}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={false}
                onToggle={mockOnToggle}
                disabled={false}
            />
        );

        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('shows "Saved ✓" badge for previously saved answers', () => {
        render(
            <QuestionCard
                question={mockQuestionWithAnswer}
                index={0}
                correctAnswer={0}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={true}
                onToggle={mockOnToggle}
                disabled={false}
            />
        );

        expect(screen.getByText('Saved ✓')).toBeInTheDocument();
    });

    it('disables options when disabled prop is true', () => {
        render(
            <QuestionCard
                question={mockQuestion}
                index={0}
                correctAnswer={undefined}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={true}
                onToggle={mockOnToggle}
                disabled={true}
            />
        );

        const radioInputs = screen.getAllByRole('radio');
        radioInputs.forEach((input) => {
            expect(input).toBeDisabled();
        });
    });

    it('handles array options format', () => {
        const questionWithArrayOptions: Question = {
            ...mockQuestion,
            options: ['Option A', 'Option B', 'Option C'],
        };

        render(
            <QuestionCard
                question={questionWithArrayOptions}
                index={0}
                correctAnswer={undefined}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={true}
                onToggle={mockOnToggle}
                disabled={false}
            />
        );

        expect(screen.getByText('Option A')).toBeInTheDocument();
        expect(screen.getByText('Option B')).toBeInTheDocument();
        expect(screen.getByText('Option C')).toBeInTheDocument();
    });

    it('highlights selected option', () => {
        render(
            <QuestionCard
                question={mockQuestion}
                index={0}
                correctAnswer={1}
                onAnswerChange={mockOnAnswerChange}
                isExpanded={true}
                onToggle={mockOnToggle}
                disabled={false}
            />
        );

        // The selected option (London, index 1) should have special styling
        const londonOption = screen.getByText('London').closest('label');
        expect(londonOption).toHaveClass('bg-blue-500/30');
    });
});
