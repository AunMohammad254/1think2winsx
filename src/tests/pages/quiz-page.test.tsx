import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as { id: string } | null, isLoading: false },
  router: { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() },
  getCSRFToken: vi.fn(),
  fetchWithRetry: vi.fn(),
  countdown: { timeRemaining: 600 as number | null, windowClosed: false },
  onExpire: null as null | (() => void),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => h.router, useParams: () => ({ id: 'q1' }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/quiz/q1' }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.getCSRFToken() }));
vi.mock('@/lib/fetch-retry', () => ({ fetchWithRetry: (...a: unknown[]) => h.fetchWithRetry(...a) }));
vi.mock('@/hooks/useQuizCountdown', () => ({ useQuizCountdown: (o: { onExpire: () => void }) => { h.onExpire = o.onExpire; return h.countdown; } }));
vi.mock('@/components/LazyStreamPlayer', () => ({ default: () => <div>stream</div> }));
vi.mock('@/components/QuizResults', () => ({ default: (p: { message: string; submittedAnswers: number; note: string }) => <div><p>{p.message}</p><p>{`answered ${p.submittedAnswers}`}</p><p>{p.note}</p></div> }));

import QuizPage from '@/app/quiz/[id]/page';

const quiz = (over: Record<string, unknown> = {}) => ({
  id: 'q1', title: 'Cricket Cup', description: 'Three questions', duration: 10, timeLimit: 600, questionCount: 3, totalQuestions: 3,
  questions: [
    { id: 'a', text: 'Who won 1992?', options: ['Pakistan', 'England'] },
    { id: 'b', text: 'Fastest bowler?', options: ['Shoaib', 'Lee'] },
    { id: 'c', text: 'Most sixes?', options: ['Gayle', 'Afridi'] },
  ],
  ...over,
});
const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  h.auth = { user: { id: 'u1' }, isLoading: false };
  h.router.push.mockReset();
  h.getCSRFToken.mockReset().mockResolvedValue('csrf');
  h.countdown = { timeRemaining: 600, windowClosed: false };
  h.fetchWithRetry.mockReset().mockImplementation(async (url: string) => (url.endsWith('/submit')
    ? jsonResponse({ message: 'Locked in!', results: { submittedAnswers: 3, note: 'Review soon' } })
    : jsonResponse({ quiz: quiz() })));
  fetchMock = vi.fn(async () => jsonResponse({ message: 'Synced!' }));
  vi.stubGlobal('fetch', fetchMock);
  setOnline(true);
  localStorage.clear();
});
afterEach(() => {
  setOnline(true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const start = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Start Quiz/ }));
  await screen.findByText('Who won 1992?');
};
const choose = (option: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(option) }));
const answerAll = () => {
  choose('Pakistan');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  choose('Lee');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  choose('Afridi');
};
const submit = () => fireEvent.click(screen.getByRole('button', { name: /Submit Quiz|Submitting/ }));

describe('quiz page: loading', () => {
  it('sends signed-out visitors to login, and shows a spinner while loading', () => {
    h.auth = { user: null, isLoading: true };
    const { rerender } = render(<QuizPage />);
    expect(screen.getByText('Loading quiz...')).toBeInTheDocument();
    h.auth = { user: null, isLoading: false };
    rerender(<QuizPage />);
    expect(h.router.push).toHaveBeenCalledWith('/login');
  });

  it('sends a finished quiz to its results page', async () => {
    h.fetchWithRetry.mockImplementationOnce(async () => jsonResponse({ completed: true, attempt: { score: 7 } }, 403));
    const { unmount } = render(<QuizPage />);
    await waitFor(() => expect(h.router.push).toHaveBeenCalledWith('/quiz/q1/results?score=7&total=10'));
    expect(await screen.findByText('Quiz not found')).toBeInTheDocument();
    unmount();
    h.fetchWithRetry.mockImplementationOnce(async () => jsonResponse({ completed: true, attempt: {} }, 403));
    render(<QuizPage />);
    await waitFor(() => expect(h.router.push).toHaveBeenLastCalledWith('/quiz/q1/results?score=0&total=10'));
  });

  it('explains why the quiz cannot be opened', async () => {
    const cases: [() => Response | Promise<Response>, string | RegExp][] = [
      [() => jsonResponse({ error: 'pay' }, 403), 'You need to pay to access this quiz'],
      [() => jsonResponse({ upcoming: true, startsAt: '2026-12-01T10:00:00Z' }, 409), /This quiz hasn't started yet\. It goes live .+\./],
      [() => jsonResponse({ error: 'Not open yet' }, 409), 'Not open yet'],
      [() => new Response('x', { status: 409 }), "This quiz hasn't started yet."],
      [() => jsonResponse({}, 500), 'Failed to fetch quiz'],
      [() => { throw 'odd'; }, 'Failed to load quiz'],
    ];
    for (const [response, message] of cases) {
      h.fetchWithRetry.mockImplementationOnce(response);
      const { unmount } = render(<QuizPage />);
      expect(await screen.findByText(message)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Back to Quizzes' }));
      unmount();
    }
    expect(h.router.push).toHaveBeenCalledWith('/quizzes');
  });
});

describe('quiz page: before starting', () => {
  it('describes a first attempt and a late join', async () => {
    h.countdown = { timeRemaining: 125, windowClosed: false };
    render(<QuizPage />);
    expect(await screen.findByText('Cricket Cup')).toBeInTheDocument();
    expect(screen.getByText('• Once submitted, you cannot retake this quiz')).toBeInTheDocument();
    expect(screen.getByText(/Answers close in 2:05/)).toBeInTheDocument();
  });

  it('describes a re-attempt, and blocks a closed window', async () => {
    h.fetchWithRetry.mockImplementation(async () => jsonResponse({ quiz: quiz({ duration: 0, isReattempt: true, newQuestionsCount: 2, previousAttempt: { id: 'p', score: 70, points: 7, completedAt: '2026-09-01T00:00:00Z' } }) }));
    h.countdown = { timeRemaining: 0, windowClosed: true };
    render(<QuizPage />);
    expect(await screen.findByText('🎉 New Questions Available!')).toBeInTheDocument();
    expect(screen.getByText(/Previous attempt: 70%/)).toBeInTheDocument();
    expect(screen.getByText(/You have 30 minutes/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The answering window for this quiz has closed');
    expect(screen.getByRole('button', { name: 'Start New Questions' })).toBeDisabled();
  });

  it('shows the re-attempt notice without a previous attempt', async () => {
    h.fetchWithRetry.mockImplementation(async () => jsonResponse({ quiz: quiz({ isReattempt: true, newQuestionsCount: 1 }) }));
    h.countdown = { timeRemaining: null, windowClosed: false };
    render(<QuizPage />);
    expect(await screen.findByText('🎉 New Questions Available!')).toBeInTheDocument();
    expect(screen.queryByText(/Previous attempt/)).toBeNull();
  });
});

describe('quiz page: answering', () => {
  it('navigates, warns about unanswered questions and submits', async () => {
    render(<QuizPage />);
    await start();
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
    choose('Pakistan');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    submit();
    expect(screen.getByText('Answer All Questions')).toBeInTheDocument();
    expect(screen.getByText(/unanswered questions\./)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '2' }).at(-1)!);
    expect(screen.getByText('Fastest bowler?')).toBeInTheDocument();
    choose('Lee');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    submit();
    expect(screen.getByText(/unanswered question\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go Answer Questions' }));
    choose('Gayle');
    submit();
    expect(await screen.findByText('Locked in!')).toBeInTheDocument();
    const [, init] = h.fetchWithRetry.mock.calls.find(([u]) => u.endsWith('/submit'))!;
    expect(init.headers['X-CSRF-Token']).toBe('csrf');
  });

  it('fills in result defaults', async () => {
    h.fetchWithRetry.mockImplementation(async (url: string) => (url.endsWith('/submit') ? jsonResponse({}) : jsonResponse({ quiz: quiz() })));
    render(<QuizPage />);
    await start();
    answerAll();
    submit();
    expect(await screen.findByText('Your predictions have been successfully submitted!')).toBeInTheDocument();
    expect(screen.getByText('answered 3')).toBeInTheDocument();
  });

  it('shows submit failures and lets the player dismiss them', async () => {
    const responses = [jsonResponse({ error: 'Window closed' }, 409), jsonResponse({ message: 'Slow down' }, 429), new Response('<html>', { status: 500 })];
    h.fetchWithRetry.mockImplementation(async (url: string) => (url.endsWith('/submit') ? responses.shift()! : jsonResponse({ quiz: quiz() })));
    render(<QuizPage />);
    await start();
    answerAll();
    for (const message of ['Window closed', 'Slow down', 'Failed to submit quiz']) {
      submit();
      expect(await screen.findByText(`⚠️ ${message}`)).toBeInTheDocument();
    }
    h.getCSRFToken.mockResolvedValueOnce(null);
    submit();
    expect(await screen.findByText(/Unable to verify security token/)).toBeInTheDocument();
    h.getCSRFToken.mockRejectedValueOnce('odd');
    submit();
    expect(await screen.findByText('⚠️ Failed to submit quiz')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(screen.queryByText(/⚠️ Failed to submit quiz/)).toBeNull();
  });

  it('opens and closes the mobile stream, and colours a running-out timer', async () => {
    h.countdown = { timeRemaining: 100, windowClosed: false };
    const { rerender } = render(<QuizPage />);
    await start();
    expect(screen.getByText('1:40').className).toContain('text-yellow-400');
    fireEvent.click(screen.getByRole('button', { name: '📺' }));
    expect(screen.getAllByText('stream')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '✕' }).at(-1)!);
    expect(screen.getAllByText('stream')).toHaveLength(1);
    h.countdown = { timeRemaining: 30, windowClosed: false };
    rerender(<QuizPage />);
    expect(screen.getByText('0:30').className).toContain('text-red-400');
    h.countdown = { timeRemaining: null, windowClosed: false };
    rerender(<QuizPage />);
    expect(screen.getByText('--:--')).toBeInTheDocument();
  });

  it('submits what was answered when time runs out, then shows the results page', async () => {
    render(<QuizPage />);
    await start();
    choose('Pakistan');
    act(() => h.onExpire!());
    expect(screen.getByText('Your Quiz Time is Over!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View Results' }));
    await waitFor(() => expect(h.router.push).toHaveBeenCalledWith('/quiz/q1/results'));
    const body = JSON.parse(h.fetchWithRetry.mock.calls.find(([u]) => u.endsWith('/submit'))![1].body);
    expect(body.answers.filter((a: { selectedOption: number }) => a.selectedOption === -1)).toHaveLength(2);
  });

  it('shows "Question not found" for a quiz without questions', async () => {
    h.fetchWithRetry.mockImplementation(async () => jsonResponse({ quiz: quiz({ questions: [] }) }));
    render(<QuizPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Start Quiz/ }));
    expect(screen.getByText('Question not found')).toBeInTheDocument();
  });
});

describe('quiz page: offline submissions', () => {
  it('saves answers locally while offline', async () => {
    render(<QuizPage />);
    await start();
    answerAll();
    setOnline(false);
    submit();
    expect(await screen.findByText(/You are currently offline/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('pending_submit_q1_u1')!).answers).toHaveLength(3);
  });

  it('submits saved answers when the connection returns', async () => {
    localStorage.setItem('pending_submit_q1_u1', JSON.stringify({ quizId: 'q1', answers: [{ questionId: 'a', selectedOption: 0 }] }));
    render(<QuizPage />);
    expect(await screen.findByText('Synced!')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/quizzes/q1/submit', expect.objectContaining({ method: 'POST' }));
    expect(localStorage.getItem('pending_submit_q1_u1')).toBeNull();
  });

  it('asks the player to resubmit when the sync fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('pending_submit_q1_u1', JSON.stringify({ answers: [] }));
    h.getCSRFToken.mockResolvedValueOnce(null);
    const { unmount } = render(<QuizPage />);
    await start();
    expect(await screen.findByText(/Failed to auto-submit answers/)).toBeInTheDocument();
    unmount();
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    render(<QuizPage />);
    await start();
    expect(await screen.findByText(/Failed to auto-submit answers/)).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith('Failed to sync offline submission:', expect.any(Error));
  });

  it('waits for the online event before syncing', async () => {
    setOnline(false);
    localStorage.setItem('pending_submit_q1_u1', JSON.stringify({ answers: [] }));
    render(<QuizPage />);
    await screen.findByRole('button', { name: /Start Quiz/ });
    expect(fetchMock).not.toHaveBeenCalled();
    setOnline(true);
    act(() => void window.dispatchEvent(new Event('online')));
    expect(await screen.findByText('Synced!')).toBeInTheDocument();
  });
});
