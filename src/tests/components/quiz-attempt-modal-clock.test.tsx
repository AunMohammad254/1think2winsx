import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const authValue = vi.hoisted(() => ({ user: { id: 'u1', email: 'u1@x.test' } })); // stable reference: a new object per render would re-trigger the modal's fetch effect forever
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authValue }));
vi.mock('@/components/LazyStreamPlayer', () => ({ default: () => null }));
vi.mock('@/components/QuizResults', () => ({ default: () => <div>results</div> }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: async () => 'csrf' }));

import QuizAttemptModal from '@/components/quiz/QuizAttemptModal';

const MIN = 60_000;
const T0 = new Date('2026-10-09T10:00:00.000Z').getTime();

/** What GET /api/quizzes/[id] answers for a quiz, from the server's point of view. */
function quizResponse(opts: { pushedAgoMin: number | null; durationMin: number; serverNow?: number }) {
  const serverNow = opts.serverNow ?? T0;
  const pushedAt = opts.pushedAgoMin === null ? null : new Date(serverNow - opts.pushedAgoMin * MIN).toISOString();
  const endsAt = pushedAt === null ? null : new Date(Date.parse(pushedAt) + opts.durationMin * MIN).toISOString();
  return {
    quiz: {
      id: 'q1', title: 'Live Quiz', description: 'desc', duration: opts.durationMin, passingScore: 70,
      pushedAt, endsAt, serverNow,
      questionCount: 1, totalQuestions: 1, isReattempt: false, newQuestionsCount: 0, previousAttempt: null,
      questions: [{ id: 'a', text: 'First question?', options: ['One', 'Two'] }],
    },
  };
}

function stubQuizApi(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })));
}

async function openModal() {
  render(<QuizAttemptModal quizId="q1" isOpen onClose={() => {}} />);
  // wait for the pre-start phase (the fetch resolves on a microtask)
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('QuizAttemptModal answering-window clock', () => {
  it('a late joiner is told how long is really left, and the timer starts there (not at the full duration)', async () => {
    stubQuizApi(quizResponse({ pushedAgoMin: 20, durationMin: 30 }));
    await openModal();

    expect(screen.getByText(/This quiz went live a while ago/)).toBeInTheDocument();
    expect(screen.getByText(/Answers close in (10:00|9:59)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Start Quiz/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    // ~10 minutes, not the 30 a fresh countdown would show
    expect(screen.getAllByText(/^(9:5\d|10:00)$/).length).toBeGreaterThan(0);
    expect(screen.queryByText('30:00')).not.toBeInTheDocument();
  });

  it('counts down against the clock as time passes', async () => {
    stubQuizApi(quizResponse({ pushedAgoMin: 20, durationMin: 30 }));
    await openModal();
    fireEvent.click(screen.getByRole('button', { name: /Start Quiz/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getAllByText(/^(8:5\d|9:00)$/).length).toBeGreaterThan(0);
  });

  it('a quiz whose window has closed cannot be started', async () => {
    stubQuizApi(quizResponse({ pushedAgoMin: 35, durationMin: 30 }));
    await openModal();
    expect(screen.getByRole('alert')).toHaveTextContent(/answering window for this quiz has closed/i);
    expect(screen.getByRole('button', { name: /Start Quiz/i })).toBeDisabled();
  });

  it('a quiz that was never pushed keeps the plain full-length timer and shows no warning', async () => {
    stubQuizApi(quizResponse({ pushedAgoMin: null, durationMin: 30 }));
    await openModal();
    expect(screen.queryByText(/went live a while ago/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Quiz/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Start Quiz/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(screen.getAllByText(/^(30:00|29:59)$/).length).toBeGreaterThan(0);
  });

  it('is not fooled by a device clock that is two hours ahead of the server', async () => {
    // The server thinks it is 2 h earlier than this device does; its deadline is 10 minutes after ITS now
    stubQuizApi(quizResponse({ pushedAgoMin: 20, durationMin: 30, serverNow: T0 - 120 * MIN }));
    await openModal();
    expect(screen.getByText(/Answers close in (10:00|9:59)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Quiz/i })).toBeEnabled();
  });

  it('shows the time-over dialog exactly when the window ends', async () => {
    // 3 seconds left in the window
    const body = quizResponse({ pushedAgoMin: 0, durationMin: 30 });
    body.quiz.endsAt = new Date(T0 + 3_000).toISOString();
    stubQuizApi(body);
    await openModal();
    fireEvent.click(screen.getByRole('button', { name: /Start Quiz/i }));
    expect(screen.queryByText('Your Quiz Time is Over!')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_500); });
    expect(screen.getByText('Your Quiz Time is Over!')).toBeInTheDocument();
  });
});
