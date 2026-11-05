import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuizResults from '@/components/QuizResults';

// Mock LazyStreamPlayer since we don't want to test it here
vi.mock('@/components/LazyStreamPlayer', () => ({
  default: () => <div data-testid="stream-player-mock" />
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

describe('QuizResults', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const defaultProps = {
    success: true,
    message: 'You have successfully submitted your answers!',
    totalQuestions: 10,
    submittedAnswers: 8,
    note: 'Next step: Wait for the result.'
  };

  it('renders success state correctly and handles animation phases', () => {
    const { container } = render(<QuizResults {...defaultProps} />);

    // Initial state: confetti should be visible, title and other details are scaled/hidden
    expect(document.querySelector('.animate-confetti')).toBeInTheDocument();

    // Check initial text rendering
    expect(screen.getByText('🎉 Predictions Locked In!')).toBeInTheDocument();
    expect(screen.getByText(defaultProps.message)).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('/10')).toBeInTheDocument();
    expect(screen.getByText(defaultProps.note)).toBeInTheDocument();

    // Test animation timing
    act(() => {
      vi.advanceTimersByTime(500); // Trigger 'revealed' phase
    });

    act(() => {
      vi.advanceTimersByTime(1000); // Trigger 'final' phase (1500ms total)
    });

    // Confetti is hidden after 5000ms
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(document.querySelector('.animate-confetti')).not.toBeInTheDocument();
  });

  it('renders failure state correctly', () => {
    render(<QuizResults {...defaultProps} success={false} message="Failed to submit" />);

    // Confetti should not be rendered when success is false
    expect(document.querySelector('.animate-confetti')).not.toBeInTheDocument();

    // Title changes for failure state
    expect(screen.getByText('Submission Failed')).toBeInTheDocument();
    expect(screen.getByText('Failed to submit')).toBeInTheDocument();

    // Still shows stats and note
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText(defaultProps.note)).toBeInTheDocument();
  });

  it('renders correct layout and handles navigation when isInModal is false', () => {
    render(<QuizResults {...defaultProps} isInModal={false} />);

    // Renders Next.js Links when not in modal
    const quizzesLink = screen.getByRole('link', { name: /Take More Quizzes/i });
    expect(quizzesLink).toHaveAttribute('href', '/quizzes');

    const profileLink = screen.getByRole('link', { name: /View My Points & Prizes/i });
    expect(profileLink).toHaveAttribute('href', '/profile');

    const lobbyLink = screen.getByRole('link', { name: /Back to Lobby/i });
    expect(lobbyLink).toHaveAttribute('href', '/');

    // Stream player is present
    expect(screen.getByTestId('stream-player-mock')).toBeInTheDocument();
  });

  it('renders correct layout and handles callbacks when isInModal is true', async () => {
    // using fake timers with userEvent requires caution, use real timers or simple click
    vi.useRealTimers();
    const user = userEvent.setup();
    const onCloseMock = vi.fn();
    mockPush.mockClear();

    render(<QuizResults {...defaultProps} isInModal={true} onClose={onCloseMock} />);

    // Renders buttons instead of links when in modal
    const quizzesBtn = screen.getByRole('button', { name: /Take More Quizzes/i });
    const profileBtn = screen.getByRole('button', { name: /View My Points & Prizes/i });

    // The lobby link is hidden in modal mode
    expect(screen.queryByRole('link', { name: /Back to Lobby/i })).not.toBeInTheDocument();

    // Trigger Take More Quizzes button
    await user.click(quizzesBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(1);

    // Trigger Profile button
    await user.click(profileBtn);
    expect(mockPush).toHaveBeenCalledWith('/profile');
    expect(onCloseMock).toHaveBeenCalledTimes(2);
  });
});
