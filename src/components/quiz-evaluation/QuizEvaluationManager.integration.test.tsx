import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Import the main component
import QuizEvaluationManager from '../QuizEvaluationManager';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Test data
const mockQuizzes = {
    quizzes: [
        {
            id: 'quiz-1',
            title: 'JavaScript Basics',
            _count: { questions: 5 },
            questions: [
                { hasCorrectAnswer: true },
                { hasCorrectAnswer: true },
                { hasCorrectAnswer: false },
                { hasCorrectAnswer: false },
                { hasCorrectAnswer: false },
            ],
        },
        {
            id: 'quiz-2',
            title: 'React Advanced',
            _count: { questions: 3 },
            questions: [
                { hasCorrectAnswer: true },
                { hasCorrectAnswer: true },
                { hasCorrectAnswer: true },
            ],
        },
    ],
};

const mockQuizEvaluation = {
    quiz: {
        id: 'quiz-1',
        title: 'JavaScript Basics',
        totalQuestions: 5,
    },
    evaluation: {
        totalAttempts: 50,
        evaluatedAttempts: 0,
        pendingAttempts: 50,
        isFullyEvaluated: false,
    },
    questions: [
        {
            id: 'q1',
            text: 'What is JavaScript?',
            options: '["A programming language", "A markup language", "A database", "An OS"]',
            correctOption: null,
            hasCorrectAnswer: false,
        },
        {
            id: 'q2',
            text: 'What is a closure?',
            options: '["A function", "A variable", "A data type", "An operator"]',
            correctOption: 0,
            hasCorrectAnswer: true,
        },
    ],
    attempts: [],
};

const mockCSRFToken = { csrfToken: 'test-csrf-token' };

describe('QuizEvaluationManager Integration', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads and displays quizzes on mount', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockQuizzes),
        });

        render(<QuizEvaluationManager />);

        // Should show loading skeleton initially
        expect(screen.getByText('📋 Select Quiz to Evaluate')).toBeInTheDocument();

        // Wait for quizzes to load
        await waitFor(() => {
            expect(screen.getByText('JavaScript Basics')).toBeInTheDocument();
            expect(screen.getByText('React Advanced')).toBeInTheDocument();
        });

        // Verify fetch was called
        expect(mockFetch).toHaveBeenCalledWith('/api/admin/quizzes');
    });

    it('shows empty state when no quizzes available', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ quizzes: [] }),
        });

        render(<QuizEvaluationManager />);

        await waitFor(() => {
            expect(screen.getByText(/No quizzes found/i)).toBeInTheDocument();
        });
    });

    it('displays quiz details when a quiz is selected', async () => {
        // First call: load quizzes
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockQuizzes),
        });
        // Second call: load quiz evaluation
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockQuizEvaluation),
        });

        render(<QuizEvaluationManager />);

        // Wait for quizzes to load
        await waitFor(() => {
            expect(screen.getByText('JavaScript Basics')).toBeInTheDocument();
        });

        // Click on the first quiz
        fireEvent.click(screen.getByText('JavaScript Basics'));

        // Wait for quiz evaluation to load
        await waitFor(() => {
            expect(screen.getByText('Total Questions')).toBeInTheDocument();
            expect(screen.getByText('Total Attempts')).toBeInTheDocument();
        });

        // Verify fetch was called for quiz evaluation
        expect(mockFetch).toHaveBeenCalledWith('/api/admin/quiz-evaluation?quizId=quiz-1');
    });

    it('shows error message on API failure', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            json: () => Promise.resolve({ message: 'Failed to fetch quizzes' }),
        });

        render(<QuizEvaluationManager />);

        await waitFor(() => {
            expect(screen.getByText(/Failed to fetch quizzes/i)).toBeInTheDocument();
        });
    });

    it('displays step indicator with correct initial step', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockQuizzes),
        });

        render(<QuizEvaluationManager />);

        await waitFor(() => {
            // Check all steps are visible
            expect(screen.getByText('Select Quiz')).toBeInTheDocument();
            expect(screen.getByText('Set Answers')).toBeInTheDocument();
            expect(screen.getByText('Evaluate')).toBeInTheDocument();
            expect(screen.getByText('Allocate Points')).toBeInTheDocument();
        });
    });

    it('shows instructions when no quiz is selected', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockQuizzes),
        });

        render(<QuizEvaluationManager />);

        await waitFor(() => {
            expect(screen.getByText('💡 How to Use Quiz Evaluation')).toBeInTheDocument();
            expect(screen.getByText('Select a quiz from the cards above')).toBeInTheDocument();
        });
    });

    it('allows dismissing error messages', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            json: () => Promise.resolve({ message: 'Test error' }),
        });

        render(<QuizEvaluationManager />);

        await waitFor(() => {
            expect(screen.getByText(/Test error/i)).toBeInTheDocument();
        });

        // Find and click the dismiss button
        const dismissButton = screen.getByRole('button', { name: '×' });
        fireEvent.click(dismissButton);

        // Error should be dismissed
        await waitFor(() => {
            expect(screen.queryByText(/Test error/i)).not.toBeInTheDocument();
        });
    });
});

describe('QuizEvaluationManager - Quiz Evaluation Flow', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    it('shows questions with answer options when quiz is selected', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuizzes),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuizEvaluation),
            });

        render(<QuizEvaluationManager />);

        await waitFor(() => {
            expect(screen.getByText('JavaScript Basics')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('JavaScript Basics'));

        await waitFor(() => {
            expect(screen.getByText('✏️ Set Correct Answers')).toBeInTheDocument();
            expect(screen.getByText('What is JavaScript?')).toBeInTheDocument();
            expect(screen.getByText('What is a closure?')).toBeInTheDocument();
        });
    });

    it('shows evaluation button disabled until all questions answered', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuizzes),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuizEvaluation),
            });

        render(<QuizEvaluationManager />);

        await waitFor(() => {
            expect(screen.getByText('JavaScript Basics')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('JavaScript Basics'));

        await waitFor(() => {
            const evaluateButton = screen.getByRole('button', { name: /Evaluate Quiz/i });
            expect(evaluateButton).toBeDisabled();
        });
    });
});

describe('QuizEvaluationManager - Stats Display', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    it('displays stats after quiz selection', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuizzes),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockQuizEvaluation),
            });

        render(<QuizEvaluationManager />);

        await waitFor(() => {
            expect(screen.getByText('JavaScript Basics')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('JavaScript Basics'));

        await waitFor(() => {
            // Check stats labels are displayed
            expect(screen.getByText('Total Questions')).toBeInTheDocument();
            expect(screen.getByText('Total Attempts')).toBeInTheDocument();
            expect(screen.getByText('Evaluated')).toBeInTheDocument();
            expect(screen.getByText('Pending')).toBeInTheDocument();
        });
    });
});
