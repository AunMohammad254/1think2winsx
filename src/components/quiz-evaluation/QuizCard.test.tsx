import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuizCard } from './QuizCard';
import type { Quiz } from './types';

const mockQuiz: Quiz = {
    id: 'quiz-1',
    title: 'JavaScript Basics',
    totalQuestions: 10,
    questionsWithAnswers: 5,
};

describe('QuizCard', () => {
    it('renders quiz title and question counts', () => {
        render(<QuizCard quiz={mockQuiz} isSelected={false} onClick={vi.fn()} />);

        expect(screen.getByText('JavaScript Basics')).toBeInTheDocument();
        expect(screen.getByText('📝 10 questions')).toBeInTheDocument();
        expect(screen.getByText('✅ 5 answered')).toBeInTheDocument();
    });

    it('shows progress percentage correctly', () => {
        render(<QuizCard quiz={mockQuiz} isSelected={false} onClick={vi.fn()} />);

        // 5/10 = 50%
        expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('shows checkmark when selected', () => {
        render(<QuizCard quiz={mockQuiz} isSelected={true} onClick={vi.fn()} />);

        expect(screen.getByText('✓')).toBeInTheDocument();
    });

    it('does not show checkmark when not selected', () => {
        render(<QuizCard quiz={mockQuiz} isSelected={false} onClick={vi.fn()} />);

        expect(screen.queryByText('✓')).not.toBeInTheDocument();
    });

    it('calls onClick when clicked', () => {
        const handleClick = vi.fn();
        render(<QuizCard quiz={mockQuiz} isSelected={false} onClick={handleClick} />);

        fireEvent.click(screen.getByRole('button'));
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('shows 100% with green progress when fully answered', () => {
        const fullyAnsweredQuiz: Quiz = {
            ...mockQuiz,
            questionsWithAnswers: 10,
        };

        render(<QuizCard quiz={fullyAnsweredQuiz} isSelected={false} onClick={vi.fn()} />);

        expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('handles quiz with no questions', () => {
        const emptyQuiz: Quiz = {
            ...mockQuiz,
            totalQuestions: 0,
            questionsWithAnswers: 0,
        };

        render(<QuizCard quiz={emptyQuiz} isSelected={false} onClick={vi.fn()} />);

        expect(screen.getByText('0%')).toBeInTheDocument();
    });
});
