import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1', email: 'ali@x.com', user_metadata: {} } as Record<string, unknown> | null, isLoading: false },
  router: { push: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => h.router, useParams: () => ({ id: 'q1' }), useSearchParams: () => h.params }));

import QuizResultsPage from '@/app/quiz/[id]/results/page';

const api = (correct: number, total: number, over: Record<string, unknown> = {}) =>
  jsonResponse({ results: { attemptId: 'a1', score: correct * 10, totalQuestions: total, correctAnswers: correct, isEvaluated: true, completedAt: '2026-10-01T00:00:00Z', ...over }, quiz: { title: 'Cricket Cup', description: 'd' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  h.auth = { user: { id: 'u1', email: 'ali@x.com', user_metadata: {} }, isLoading: false };
  h.router.push.mockReset();
  h.params = new URLSearchParams();
  fetchMock = vi.fn(async () => api(9, 10));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('quiz results page', () => {
  it('sends signed-out visitors to login and waits for auth', () => {
    h.auth = { user: null, isLoading: true };
    const { rerender } = render(<QuizResultsPage />);
    expect(screen.getByText('Loading results...')).toBeInTheDocument();
    h.auth = { user: null, isLoading: false };
    rerender(<QuizResultsPage />);
    expect(h.router.push).toHaveBeenCalledWith('/login');
  });

  it.each([
    [10, 'Excellent', 'Excellent! Outstanding performance! 🏆', true],
    [8, 'Very Good', 'Great job! Well done! 🎉', true],
    [7, 'Good', 'Good work! Keep it up! 👍', false],
    [6, 'Average', 'Not bad! Room for improvement! 📚', false],
    [3, 'Needs Improvement', 'Keep practicing! You can do better! 💪', false],
  ])('rates %i/10 as %s', async (correct, level, message, achievement) => {
    fetchMock.mockImplementation(async () => api(correct, 10));
    render(<QuizResultsPage />);
    expect(await screen.findByText(level)).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(!!screen.queryByText('Achievement Unlocked!')).toBe(achievement);
  });

  it('marks a result that is still being evaluated', async () => {
    fetchMock.mockImplementation(async () => api(9, 10, { isEvaluated: false, score: 0 }));
    render(<QuizResultsPage />);
    expect(await screen.findByText('Evaluation In Progress')).toBeInTheDocument();
    expect(screen.getByText('Preliminary Score')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument(); // points fall back to correct x 10
    expect(screen.queryByText('Achievement Unlocked!')).toBeNull();
  });

  it('falls back to the score in the URL when results are missing or fail', async () => {
    h.params = new URLSearchParams('score=7&total=10');
    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'not found' }, 404));
    const { unmount } = render(<QuizResultsPage />);
    expect(await screen.findByText('Quiz Results')).toBeInTheDocument();
    expect(screen.getAllByText('70%').length).toBeGreaterThan(0);
    unmount();
    fetchMock.mockImplementationOnce(async () => { throw new Error('offline'); });
    render(<QuizResultsPage />);
    expect(await screen.findByText('Quiz Results')).toBeInTheDocument();
  });

  it('explains missing results and other failures', async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => jsonResponse({}, 404), 'Quiz results not found. You may not have completed this quiz yet.'],
      [() => jsonResponse({ error: 'No attempt' }, 404), 'No attempt'],
      [() => jsonResponse({ error: 'Server down' }, 500), 'Server down'],
      [() => jsonResponse({}, 500), 'Failed to fetch results'],
      [() => { throw 'odd'; }, 'Failed to load results'],
    ];
    for (const [response, message] of cases) {
      fetchMock.mockImplementationOnce(response);
      const { unmount } = render(<QuizResultsPage />);
      expect(await screen.findByText(message)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Back to Quizzes' }));
      unmount();
    }
    expect(h.router.push).toHaveBeenCalledWith('/quizzes');
  });

  it('navigates onward and shares the result', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    window.open = open;
    render(<QuizResultsPage />);
    await screen.findByText('Excellent');
    fireEvent.click(screen.getByRole('button', { name: 'Take More Quizzes' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Leaderboard' }));
    expect(h.router.push.mock.calls).toEqual([['/quizzes'], ['/leaderboard']]);
    fireEvent.click(screen.getByRole('button', { name: /WhatsApp/ }));
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/api\.whatsapp\.com\/send\?text=/);
    fireEvent.click(screen.getByRole('button', { name: /Share on X/ }));
    expect(open.mock.calls[1][0]).toMatch(/^https:\/\/twitter\.com\/intent\/tweet\?text=.+&url=/);
    expect(screen.getByRole('img', { name: 'Quiz Achievement Share Card' }).getAttribute('src')).toContain('name=ali');
  });

  it('downloads the share card, and logs a failed download', async () => {
    h.auth = { user: { id: 'u1', user_metadata: { name: 'Ali Raza' } }, isLoading: false };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:card');
    URL.revokeObjectURL = vi.fn();
    render(<QuizResultsPage />);
    await screen.findByText('Excellent');
    fetchMock.mockImplementationOnce(async () => new Response(new Blob(['png'])));
    fireEvent.click(screen.getByRole('button', { name: /Download Card/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(fetchMock.mock.calls.at(-1)![0]).toContain('name=Ali%20Raza');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:card');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementationOnce(async () => { throw new Error('offline'); });
    fireEvent.click(screen.getByRole('button', { name: /Download Card/ }));
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to download card:', expect.any(Error)));
  });

  it('names the downloaded card after the email, or "Player"', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:card');
    URL.revokeObjectURL = vi.fn();
    const download = async () => {
      await screen.findByText('Excellent');
      fetchMock.mockImplementationOnce(async () => new Response(new Blob(['png'])));
      fireEvent.click(screen.getByRole('button', { name: /Download Card/ }));
      await waitFor(() => expect(fetchMock.mock.calls.at(-1)![0]).toContain('share-card'));
      return fetchMock.mock.calls.at(-1)![0] as string;
    };
    const { unmount } = render(<QuizResultsPage />);
    expect(await download()).toContain('name=ali');
    unmount();
    h.auth = { user: { id: 'u1' }, isLoading: false };
    render(<QuizResultsPage />);
    expect(await download()).toContain('name=Player');
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
  });

  it('names the card "Player" when the account has no name or email', async () => {
    h.auth = { user: { id: 'u1' }, isLoading: false };
    render(<QuizResultsPage />);
    await screen.findByText('Excellent');
    expect(screen.getByRole('img', { name: 'Quiz Achievement Share Card' }).getAttribute('src')).toContain('name=Player');
  });
});
