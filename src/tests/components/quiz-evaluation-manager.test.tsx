import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({ getCSRFToken: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.getCSRFToken() }));

import QuizEvaluationManager from '@/components/QuizEvaluationManager';

const quizzes = [
  { id: 'z1', title: 'Predict PSL', prizeId: 'p1', _count: { questions: 2 }, questions: [{ hasCorrectAnswer: false }, { hasCorrectAnswer: true }] },
  { id: 'z2', title: 'Plain quiz', prizeId: null },
];
const evaluation = (fullyEvaluated: boolean, prizeId: string | null = 'p1') => ({
  quiz: { id: 'z1', title: 'Predict PSL', prizeId, totalQuestions: 3, questionsWithAnswers: 1 },
  evaluation: { totalAttempts: 25, evaluatedAttempts: fullyEvaluated ? 25 : 0, pendingAttempts: fullyEvaluated ? 0 : 25, isFullyEvaluated: fullyEvaluated },
  questions: [
    { id: 'q1', text: 'Who wins the final?', options: ['Lahore', 'Karachi'], correctOption: null, hasCorrectAnswer: false },
    { id: 'q2', text: 'Top scorer?', options: ['Babar', 'Rizwan'], correctOption: 1, hasCorrectAnswer: true },
    { id: 'q3', text: 'Total sixes?', options: ['Under 10', 'Over 10'], correctOption: null, hasCorrectAnswer: false },
  ],
  attempts: [],
});
const winners = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, userName: `Player ${i}`, userEmail: `p${i}@x.com`, score: 90 - i, pointsAwarded: 10 }));

let state: { evaluated: boolean; prizeId: string | null };
let fetchMock: ReturnType<typeof vi.fn>;
const posts = (path: string) => fetchMock.mock.calls.filter(([u, i]) => u === path && i?.method === 'POST');
const routes = (over: Record<string, () => Response | Promise<Response>> = {}) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    if (over[key]) return over[key]();
    switch (key) {
      case 'GET /api/admin/quizzes': return jsonResponse({ quizzes });
      case 'GET /api/admin/quiz-evaluation': return jsonResponse(evaluation(state.evaluated, state.prizeId));
      case 'POST /api/admin/quiz-evaluation': state.evaluated = true; return jsonResponse({ evaluatedAttempts: 25 });
      case 'POST /api/admin/points-allocation': return jsonResponse({ allocation: { eligibleWinners: 12, pointsPerWinner: 10 }, winners: winners(12) });
      default: return jsonResponse({ message: 'Lucky draw done.', consolation: { losersAwarded: 3, points: 5 }, winners: [{ userId: 'w1', name: 'Ali', email: 'ali@x.com', score: 100 }, { userId: 'w2' }] });
    }
  });

beforeEach(() => {
  state = { evaluated: false, prizeId: 'p1' };
  h.getCSRFToken.mockReset().mockResolvedValue('tok');
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const select = async (title = 'Predict PSL') => {
  fireEvent.click(await screen.findByText(title));
  await screen.findByText('Total Attempts');
};
// Options stay in the DOM; a question is open when its options panel has max-h-96 (closed: max-h-0).
const isOpen = (option: string) => screen.getByText(option).closest('label')!.parentElement!.parentElement!.className.includes('max-h-96');
const pick = (option: string) => fireEvent.click(screen.getByText(option).closest('label')!.querySelector('input')!);

describe('QuizEvaluationManager: answers and evaluation', () => {
  it('maps quizzes from the API, defaulting missing counts', async () => {
    render(<QuizEvaluationManager />);
    expect(await screen.findByText('Predict PSL')).toBeInTheDocument();
    expect(screen.getAllByText('📝 0 questions')).toHaveLength(1);
    expect(screen.getByText('✅ 1 answered')).toBeInTheDocument();
  });

  it('pre-fills known answers, opens the first open question, and moves on as answers are set', async () => {
    render(<QuizEvaluationManager />);
    await select();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(isOpen('Lahore')).toBe(true); // first unanswered question opens
    expect(isOpen('Under 10')).toBe(false);
    pick('Karachi');
    expect(screen.getByText('2/3')).toBeInTheDocument();
    await waitFor(() => expect(isOpen('Under 10')).toBe(true)); // jumps to the next unanswered one
    expect(isOpen('Lahore')).toBe(false);
    pick('Over 10');
    expect(screen.getByText('3/3')).toBeInTheDocument();
    await waitFor(() => expect(isOpen('Over 10')).toBe(false)); // nothing left to open
    fireEvent.click(screen.getByText('Top scorer?'));
    expect(isOpen('Babar')).toBe(true);
    fireEvent.click(screen.getByText('Top scorer?'));
    expect(isOpen('Babar')).toBe(false);
    // selecting the already-selected quiz changes nothing
    fireEvent.click(screen.getAllByText('Predict PSL')[0]);
    expect(screen.getByText('3/3')).toBeInTheDocument();
  });

  it('evaluates the quiz, then moves to points allocation', async () => {
    render(<QuizEvaluationManager />);
    await select();
    pick('Karachi');
    pick('Over 10');
    fireEvent.click(screen.getByRole('button', { name: /Evaluate Quiz/ }));
    expect(await screen.findByText('🎉 Quiz evaluated successfully! 25 attempts processed.')).toBeInTheDocument();
    expect(JSON.parse(posts('/api/admin/quiz-evaluation')[0][1].body)).toEqual({ quizId: 'z1', correctAnswers: { q1: 1, q2: 1, q3: 1 } });
    expect(await screen.findByText(/Allocate Points to Winners/)).toBeInTheDocument();
  });

  it('dismisses success messages after five seconds', async () => {
    render(<QuizEvaluationManager />);
    await select();
    pick('Karachi');
    pick('Over 10');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: /Evaluate Quiz/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.getByText(/Quiz evaluated successfully/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText(/Quiz evaluated successfully/)).toBeNull();
  });

  it('reports evaluation failures, and a missing security token', async () => {
    const results = [jsonResponse({ message: 'Already evaluated' }, 409), jsonResponse({}, 500)];
    vi.stubGlobal('fetch', (fetchMock = routes({ 'POST /api/admin/quiz-evaluation': () => results.shift() ?? Promise.reject(new Error('down')) })));
    render(<QuizEvaluationManager />);
    await select();
    pick('Karachi');
    pick('Over 10');
    const evaluate = () => fireEvent.click(screen.getByRole('button', { name: /Evaluate Quiz/ }));
    evaluate();
    expect(await screen.findByText('Already evaluated')).toBeInTheDocument();
    evaluate();
    expect(await screen.findByText('Failed to evaluate quiz')).toBeInTheDocument();
    evaluate();
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to evaluate quiz:', expect.any(Error)));
  });

  it('asks again for the token after a failed fetch', async () => {
    h.getCSRFToken.mockResolvedValueOnce(null);
    render(<QuizEvaluationManager />);
    await select();
    pick('Karachi');
    pick('Over 10');
    fireEvent.click(screen.getByRole('button', { name: /Evaluate Quiz/ }));
    expect(await screen.findByText('Failed to get security token. Please try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Evaluate Quiz/ }));
    expect(await screen.findByText(/Quiz evaluated successfully/)).toBeInTheDocument();
    expect(h.getCSRFToken).toHaveBeenCalledTimes(2);
  });

  it('reports a failed evaluation load', async () => {
    const results = [jsonResponse({ message: 'No attempts yet' }, 404), jsonResponse({}, 500)];
    vi.stubGlobal('fetch', (fetchMock = routes({ 'GET /api/admin/quiz-evaluation': () => results.shift() ?? Promise.reject(new Error('down')) })));
    render(<QuizEvaluationManager />);
    fireEvent.click(await screen.findByText('Predict PSL'));
    expect(await screen.findByText('No attempts yet')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Plain quiz'));
    expect(await screen.findByText('Failed to fetch quiz evaluation')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Predict PSL'));
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to fetch quiz evaluation:', expect.any(Error)));
  });

  it('reports a failed quiz list, with or without a message', async () => {
    vi.stubGlobal('fetch', routes({ 'GET /api/admin/quizzes': () => jsonResponse({ message: 'Admins only' }, 403) }));
    const { unmount } = render(<QuizEvaluationManager />);
    expect(await screen.findByText('Admins only')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', routes({ 'GET /api/admin/quizzes': () => jsonResponse({}, 500) }));
    const second = render(<QuizEvaluationManager />);
    expect(await screen.findByText('Failed to fetch quizzes')).toBeInTheDocument();
    second.unmount();
    vi.stubGlobal('fetch', routes({ 'GET /api/admin/quizzes': () => jsonResponse({ quizzes: 'not-a-list' }) }));
    const third = render(<QuizEvaluationManager />);
    expect(await screen.findByText('No quizzes found. Create a quiz first.')).toBeInTheDocument();
    third.unmount();
    vi.stubGlobal('fetch', routes({ 'GET /api/admin/quizzes': () => jsonResponse({}) }));
    const fourth = render(<QuizEvaluationManager />);
    expect(await screen.findByText('No quizzes found. Create a quiz first.')).toBeInTheDocument();
    fourth.unmount();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', routes({ 'GET /api/admin/quizzes': () => { throw new Error('offline'); } }));
    render(<QuizEvaluationManager />);
    expect(await screen.findByText('Failed to fetch quizzes')).toBeInTheDocument();
  });

  it('opens no question when every question already has its answer', async () => {
    const done = evaluation(false);
    done.questions = done.questions.map((q, i) => ({ ...q, correctOption: i % 2, hasCorrectAnswer: true }));
    vi.stubGlobal('fetch', routes({ 'GET /api/admin/quiz-evaluation': () => jsonResponse(done) }));
    render(<QuizEvaluationManager />);
    await select();
    expect(isOpen('Lahore')).toBe(false);
    expect(isOpen('Under 10')).toBe(false);
  });

  it('reads options stored as JSON text, and shows none for an empty value', async () => {
    const stored = evaluation(false);
    stored.questions[0] = { ...stored.questions[0], options: '["Multan","Quetta"]' as unknown as string[] };
    stored.questions[2] = { ...stored.questions[2], options: '' as unknown as string[] };
    vi.stubGlobal('fetch', routes({ 'GET /api/admin/quiz-evaluation': () => jsonResponse(stored) }));
    render(<QuizEvaluationManager />);
    await select();
    expect(screen.getByText('Quetta')).toBeInTheDocument();
    expect(screen.getByText('Total sixes?')).toBeInTheDocument();
    expect(screen.queryByText('Under 10')).toBeNull();
  });
});

describe('QuizEvaluationManager: rewards', () => {
  beforeEach(() => { state.evaluated = true; });

  it('previews and allocates points, showing the top ten winners', async () => {
    render(<QuizEvaluationManager />);
    await select();
    const [percent, points] = screen.getAllByRole('slider');
    fireEvent.change(percent, { target: { value: '20' } });
    fireEvent.change(points, { target: { value: '15' } });
    expect(screen.getByText('Winners (top 20%)')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument(); // 5 winners x 15 points
    fireEvent.click(screen.getByRole('button', { name: /Allocate Points to Top 20%/ }));
    expect(await screen.findByText('🏆 Points allocated! 12 winners received 10 points each.')).toBeInTheDocument();
    expect(JSON.parse(posts('/api/admin/points-allocation')[0][1].body)).toEqual({ quizId: 'z1', pointsPerWinner: 15, percentageThreshold: 20 });
    expect(screen.getByText('12 winners')).toBeInTheDocument();
    expect(screen.getByText('And 2 more winners...')).toBeInTheDocument();
  });

  it('reports allocation failures', async () => {
    const results = [jsonResponse({ message: 'Already allocated' }, 409), jsonResponse({}, 500)];
    vi.stubGlobal('fetch', (fetchMock = routes({ 'POST /api/admin/points-allocation': () => results.shift() ?? Promise.reject(new Error('down')) })));
    h.getCSRFToken.mockResolvedValueOnce(null);
    render(<QuizEvaluationManager />);
    await select();
    const allocate = () => fireEvent.click(screen.getByRole('button', { name: /Allocate Points to Top/ }));
    allocate();
    expect(await screen.findByText('Failed to get security token. Please try again.')).toBeInTheDocument();
    allocate();
    expect(await screen.findByText('Already allocated')).toBeInTheDocument();
    allocate();
    expect(await screen.findByText('Failed to allocate points')).toBeInTheDocument();
    allocate();
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to allocate points:', expect.any(Error)));
  });

  it('shows an allocation result without winners or counts', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ 'POST /api/admin/points-allocation': () => jsonResponse({}) })));
    render(<QuizEvaluationManager />);
    await select();
    fireEvent.click(screen.getByRole('button', { name: /Allocate Points to Top/ }));
    expect(await screen.findByText('🏆 Points allocated! undefined winners received undefined points each.')).toBeInTheDocument();
    expect(screen.queryByText(/Winners Leaderboard/)).toBeNull();
  });

  it('runs the lucky draw for a prize quiz, with consolation points', async () => {
    render(<QuizEvaluationManager />);
    await select();
    const [winnersInput, consolationInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(winnersInput, { target: { value: '0' } });
    expect(winnersInput).toHaveValue(1);
    fireEvent.change(winnersInput, { target: { value: '3' } });
    fireEvent.change(consolationInput, { target: { value: '-4' } });
    expect(consolationInput).toHaveValue(0);
    fireEvent.change(consolationInput, { target: { value: 'abc' } });
    fireEvent.change(consolationInput, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Run Lucky Draw/ }));
    expect(await screen.findByText('Lucky draw done. 3 runner(s) up received 5 points.')).toBeInTheDocument();
    expect(JSON.parse(posts('/api/admin/lucky-winner/z1/draw')[0][1].body)).toEqual({ numberOfWinners: 3, consolationPoints: 5 });
    expect(screen.getByText('Ali')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('No email')).toBeInTheDocument();
  });

  it('reports draws without winners, and draw failures', async () => {
    const results = [jsonResponse({}), jsonResponse({ error: 'No perfect scores' }, 400), jsonResponse({}, 500)];
    vi.stubGlobal('fetch', (fetchMock = routes({ 'POST /api/admin/lucky-winner/z1/draw': () => results.shift() ?? Promise.reject(new Error('down')) })));
    render(<QuizEvaluationManager />);
    await select();
    const draw = () => fireEvent.click(screen.getByRole('button', { name: /Run Lucky Draw/ }));
    draw();
    expect(await screen.findByText('🎲 Lucky Draw complete!')).toBeInTheDocument();
    expect(screen.queryByText(/Winners Leaderboard/)).toBeNull();
    draw();
    expect(await screen.findByText('No perfect scores')).toBeInTheDocument();
    draw();
    expect(await screen.findByText('Failed to run lucky draw')).toBeInTheDocument();
    draw();
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to run lucky draw:', expect.any(Error)));
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(screen.queryByText('Failed to run lucky draw')).toBeNull();
  });

  it('refuses a draw without a security token, and hides the draw for quizzes without a prize', async () => {
    h.getCSRFToken.mockResolvedValueOnce(null);
    render(<QuizEvaluationManager />);
    await select();
    fireEvent.click(screen.getByRole('button', { name: /Run Lucky Draw/ }));
    expect(await screen.findByText('Failed to get security token. Please try again.')).toBeInTheDocument();
    state.prizeId = null;
    fireEvent.click(screen.getByText('Plain quiz'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Run Lucky Draw/ })).toBeNull());
    expect(await screen.findByRole('button', { name: /Allocate Points to Top/ })).toBeInTheDocument();
  });
});

