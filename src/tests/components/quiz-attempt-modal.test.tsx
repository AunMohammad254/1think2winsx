import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1', email: 'u1@x.test' } as { id: string; email: string } | null },
  getCSRFToken: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.getCSRFToken() }));
vi.mock('@/lib/fetch-retry', () => ({ fetchWithRetry: (url: string, init?: RequestInit) => fetch(url, init) }));
vi.mock('@/components/LazyStreamPlayer', () => ({
  default: ({ onAvailabilityChange }: { onAvailabilityChange?: (a: boolean) => void }) =>
    onAvailabilityChange ? (
      <>
        <button onClick={() => onAvailabilityChange(true)}>stream live</button>
        <button onClick={() => onAvailabilityChange(false)}>stream offline</button>
      </>
    ) : null,
}));
vi.mock('@/components/QuizResults', () => ({
  default: (p: { message: string; submittedAnswers: number; totalQuestions: number; note: string; onClose: () => void }) => (
    <div>
      <p>{p.message}</p>
      <p>{`answered ${p.submittedAnswers}/${p.totalQuestions}`}</p>
      <p>{p.note}</p>
      <button onClick={p.onClose}>results close</button>
    </div>
  ),
}));

import QuizAttemptModal from '@/components/quiz/QuizAttemptModal';

const quiz = (over: Record<string, unknown> = {}) => ({
  id: 'q1', title: 'Cricket Cup', description: 'Five questions on cricket', duration: 10, timeLimit: 600, questionCount: 3, totalQuestions: 3,
  questions: [
    { id: 'a', text: 'Who won 1992?', options: ['Pakistan', 'England'] },
    { id: 'b', text: 'Fastest bowler?', options: ['Shoaib', 'Lee'] },
    { id: 'c', text: 'Most sixes?', options: ['Gayle', 'Afridi'] },
  ],
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
const routes = (over: { get?: () => Response | Promise<Response>; submit?: () => Response | Promise<Response> } = {}) =>
  vi.fn(async (url: string) => (url.endsWith('/submit')
    ? (over.submit?.() ?? jsonResponse({ message: 'Locked in!', results: { submittedAnswers: 3, note: 'We will review.' } }))
    : (over.get?.() ?? jsonResponse({ quiz: quiz() }))));

beforeEach(() => {
  h.auth = { user: { id: 'u1', email: 'u1@x.test' } };
  h.getCSRFToken.mockReset().mockResolvedValue('csrf');
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const open = (props: Partial<Parameters<typeof QuizAttemptModal>[0]> = {}) => {
  const p = { quizId: 'q1', isOpen: true, onClose: vi.fn(), onQuizCompleted: vi.fn(), ...props };
  const utils = render(<QuizAttemptModal {...p} />);
  return { ...utils, p };
};
const start = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Start Quiz/ }));
  await screen.findByText('Who won 1992?');
};
const choose = (option: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(option) }));

describe('QuizAttemptModal: loading', () => {
  it('renders nothing when closed, and waits for a signed-in user', () => {
    const { container, rerender } = render(<QuizAttemptModal quizId="q1" isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    h.auth = { user: null };
    rerender(<QuizAttemptModal quizId="q1" isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Loading quiz...')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains why a quiz cannot be opened', async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => jsonResponse({ completed: true, attempt: { id: 'x' } }, 403), 'You have already completed this quiz.'],
      [() => jsonResponse({ error: 'pay' }, 403), 'You need to pay to access this quiz'],
      [() => jsonResponse({}, 500), 'Failed to fetch quiz'],
      [() => { throw 'odd'; }, 'Failed to load quiz'],
    ];
    for (const [get, message] of cases) {
      vi.stubGlobal('fetch', routes({ get }));
      const { p, unmount } = open();
      expect(await screen.findByText(message)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Back to Quizzes' }));
      expect(p.onClose).toHaveBeenCalled();
      unmount();
    }
  });

  it('closes from the loading screen', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { p, container } = open();
    fireEvent.click(container.querySelector('.fixed')!.querySelector('button')!);
    fireEvent.click(container.querySelector('.fixed')!);
    fireEvent.click(screen.getByText('Loading quiz...'));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});

describe('QuizAttemptModal: before starting', () => {
  it('shows the quiz details and closes from Cancel, the X and the backdrop', async () => {
    const { p, container } = open();
    expect(await screen.findByText('Cricket Cup')).toBeInTheDocument();
    expect(screen.getByText('Five questions on cricket')).toBeInTheDocument();
    expect(screen.getByText('• Once submitted, you cannot retake this quiz')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(container.querySelector('.fixed')!.querySelector('button')!);
    fireEvent.click(container.querySelector('.fixed')!);
    fireEvent.click(screen.getByText('Cricket Cup'));
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });

  it('describes a re-attempt with only the new questions', async () => {
    vi.stubGlobal('fetch', routes({ get: () => jsonResponse({ quiz: quiz({ duration: 0, isReattempt: true, newQuestionsCount: 2, previousAttempt: { id: 'p', score: 80, points: 8, completedAt: '2026-10-01T00:00:00Z' } }) }) }));
    open();
    expect(await screen.findByText('🎉 New Questions Available!')).toBeInTheDocument();
    expect(screen.getByText(/Previous attempt: 80%/)).toBeInTheDocument();
    expect(screen.getByText('New Questions')).toBeInTheDocument();
    expect(screen.getByText(/You have 30 minutes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start New Questions/ })).toBeInTheDocument();
    vi.stubGlobal('fetch', routes({ get: () => jsonResponse({ quiz: quiz({ isReattempt: true, newQuestionsCount: 1 }) }) }));
    open({ quizId: 'q2' });
    await waitFor(() => expect(screen.getAllByText('🎉 New Questions Available!')).toHaveLength(2));
  });
});

describe('QuizAttemptModal: answering', () => {
  it('navigates questions, warns about unanswered ones, and submits', async () => {
    const { p } = open();
    await start();
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();
    choose('Pakistan');
    expect(screen.getByRole('button', { name: /Pakistan/ }).className).toContain('border-blue-400');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Fastest bowler?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Prev/ }));
    expect(screen.getByText('Who won 1992?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByText('Most sixes?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByText('Answer All Questions')).toBeInTheDocument();
    expect(screen.getByText(/unanswered questions\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go Answer Questions' }));
    expect(screen.queryByText('Answer All Questions')).toBeNull();
    choose('Gayle');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByText(/unanswered question\./)).toBeInTheDocument();
    const jump = screen.getAllByRole('button', { name: '2' }).find((b) => b.closest('.z-\\[60\\]'))!;
    fireEvent.click(jump);
    expect(screen.getByText('Fastest bowler?')).toBeInTheDocument();
    choose('Shoaib');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Locked in!')).toBeInTheDocument();
    expect(screen.getByText('answered 3/3')).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls.find(([u]) => u.endsWith('/submit'))!;
    expect(init.headers['X-CSRF-Token']).toBe('csrf');
    expect(JSON.parse(init.body)).toEqual({ answers: [{ questionId: 'a', selectedOption: 0 }, { questionId: 'b', selectedOption: 0 }, { questionId: 'c', selectedOption: 0 }] });
    expect(p.onQuizCompleted).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'results close' }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it('fills in result defaults and counts answers itself', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ submit: () => jsonResponse({}) })));
    const { container } = open({ onQuizCompleted: undefined });
    await start();
    for (const [option, next] of [['Pakistan', true], ['Lee', true], ['Afridi', false]] as const) {
      choose(option);
      if (next) fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Your predictions have been successfully submitted!')).toBeInTheDocument();
    expect(screen.getByText('answered 3/3')).toBeInTheDocument();
    expect(screen.getByText(/The admin will review all submissions/)).toBeInTheDocument();
    fireEvent.click(container.querySelector('.fixed button')!);
  });

  it('tells the player why a submission failed, keeping their answers for a retry', async () => {
    const results = [jsonResponse({ error: 'Window closed' }, 409), jsonResponse({ message: 'Rate limited' }, 429), new Response('<html>', { status: 500 })];
    vi.stubGlobal('fetch', (fetchMock = routes({ submit: () => results.shift()! })));
    open();
    await start();
    for (const [option, next] of [['Pakistan', true], ['Lee', true], ['Afridi', false]] as const) {
      choose(option);
      if (next) fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    }
    const submit = async (message: string | RegExp) => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
      expect(screen.getByRole('alert')).toHaveTextContent(message);
    };
    await submit('Window closed');
    await submit('Rate limited');
    await submit('Failed to submit quiz');
    h.getCSRFToken.mockResolvedValueOnce(null);
    await submit(/Unable to verify security token/);
    h.getCSRFToken.mockRejectedValueOnce('odd');
    await submit('Failed to submit quiz');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('Most sixes?')).toBeInTheDocument();
    expect(screen.getByText('3', { selector: '.text-green-400' })).toBeInTheDocument(); // all three answers kept
  });

  it('switches to theater mode, and drops the stream column when nothing is live', async () => {
    open();
    await start();
    fireEvent.click(screen.getByTitle('Enter Theater Mode'));
    expect(screen.getByTitle('Exit Theater Mode')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'stream live' }));
    expect(screen.getByTitle('Exit Theater Mode')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'stream offline' }));
    expect(screen.queryByTitle(/Theater Mode/)).toBeNull();
  });

  it('shows nothing once started when every question was paused', async () => {
    vi.stubGlobal('fetch', routes({ get: () => jsonResponse({ quiz: quiz({ questions: [], questionCount: 0 }) }) }));
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: /Start Quiz/ }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('resets when closed and reopened', async () => {
    const { rerender } = open();
    await start();
    choose('Pakistan');
    rerender(<QuizAttemptModal quizId="q1" isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Who won 1992?')).toBeNull();
    rerender(<QuizAttemptModal quizId="q1" isOpen onClose={vi.fn()} />);
    await start();
    expect(screen.getByRole('button', { name: /Pakistan/ }).className).not.toContain('border-blue-400');
  });
});

describe('QuizAttemptModal: running out of time', () => {
  it('turns the timer red, then submits what was answered when time is up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', (fetchMock = routes({ get: () => jsonResponse({ quiz: quiz({ duration: 3 }) }) })));
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Start Quiz/ }));
    await screen.findByText('Who won 1992?');
    choose('Pakistan');
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });
    expect(screen.getAllByText(/^1:5\d$/)[0].className).toContain('text-yellow-400');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getAllByText(/^0:5\d$/)[0].className).toContain('text-red-400');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(await screen.findByText('Your Quiz Time is Over!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit & View Results' }));
    expect(await screen.findByText('Locked in!')).toBeInTheDocument();
    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => u.endsWith('/submit'))![1].body);
    expect(body.answers.filter((a: { selectedOption: number }) => a.selectedOption === -1)).toHaveLength(2);
  });

  it('shows the submit in progress when time runs out mid-submit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', (fetchMock = routes({ get: () => jsonResponse({ quiz: quiz({ duration: 1 }) }), submit: () => new Promise<Response>(() => {}) })));
    open();
    await start();
    for (const [option, next] of [['Pakistan', true], ['Lee', true], ['Afridi', false]] as const) {
      choose(option);
      if (next) fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(await screen.findByText('Your Quiz Time is Over!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submitting/ })).toBeDisabled();
  });
});
