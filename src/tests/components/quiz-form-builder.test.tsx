import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  createQuiz: vi.fn(),
  updateQuiz: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/quiz-actions', () => ({
  createQuiz: (...a: unknown[]) => h.createQuiz(...a),
  updateQuiz: (...a: unknown[]) => h.updateQuiz(...a),
}));

import QuizFormBuilder from '@/components/admin/QuizFormBuilder';
import type { QuizFormData } from '@/lib/schemas/QuizFormSchema';

let fetchMock: ReturnType<typeof vi.fn>;
const routes = (over: { prizes?: () => Response; wallet?: () => Response } = {}) =>
  vi.fn(async (url: string) => {
    if (url === '/api/prizes') return over.prizes?.() ?? jsonResponse({ data: [{ id: 'p1', name: 'Bike', description: null }] });
    return over.wallet?.() ?? jsonResponse({ walletEnabled: true });
  });

beforeEach(() => {
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.createQuiz.mockReset().mockResolvedValue({ success: true, message: 'Quiz created and published', data: { id: 'new-id' } });
  h.updateQuiz.mockReset().mockResolvedValue({ success: true });
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const type = (placeholder: string | RegExp, value: string, index = 0) =>
  fireEvent.change(screen.getAllByPlaceholderText(placeholder)[index], { target: { value } });
const submit = () => fireEvent.submit(screen.getByRole('button', { name: /Create Quiz|Update Quiz/ }).closest('form')!);
const optionRow = (n: number, q = 0) => screen.getAllByPlaceholderText(`Option ${n}`)[q].parentElement as HTMLElement;
const removeOptionBtn = (n: number, q = 0) => within(optionRow(n, q)).getAllByRole('button').at(-1)!;
const correctBtn = (n: number, q = 0) => within(optionRow(n, q)).getAllByRole('button')[0];

/** Fills the one default question with two answer options and marks the first correct. */
const fillValidQuestion = () => {
  type('Enter your question', 'Who won PSL 2020?');
  fireEvent.click(removeOptionBtn(4));
  fireEvent.click(removeOptionBtn(3));
  type('Option 1', 'Pakistan');
  type('Option 2', 'England');
  fireEvent.click(correctBtn(1));
};

describe('QuizFormBuilder: creating', () => {
  it('creates a normal quiz with the default settings', async () => {
    const onSuccess = vi.fn();
    render(<QuizFormBuilder onSuccess={onSuccess} />);
    type('Enter quiz title', 'Cricket Cup');
    fillValidQuestion();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    submit();
    await waitFor(() => expect(h.createQuiz).toHaveBeenCalled());
    const payload = h.createQuiz.mock.calls[0][0];
    expect(payload).toMatchObject({ title: 'Cricket Cup', duration: 30, passingScore: 70, accessPrice: 2, status: 'draft', startsAt: null, quizType: 'normal' });
    expect(payload.questions[0]).toMatchObject({ correctOption: 0, options: [{ text: 'Pakistan', isCorrect: true }, { text: 'England', isCorrect: false }] });
    expect(h.toast.success).toHaveBeenCalledWith('Quiz created and published');
    expect(onSuccess).toHaveBeenCalledWith('new-id');
  });

  it('shows validation errors and refuses to save', async () => {
    render(<QuizFormBuilder />);
    submit();
    expect(await screen.findByText('Title must be at least 3 characters')).toBeInTheDocument();
    expect(screen.getByText('Please fix the following errors to save:')).toBeInTheDocument();
    expect(screen.getByText('Has errors')).toBeInTheDocument();
    expect(screen.getByText('Question must be at least 5 characters')).toBeInTheDocument();
    expect(screen.getByText(/questions: Errors in list/)).toBeInTheDocument();
    type('Enter quiz title', 'Cricket Cup');
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '500' } });
    submit();
    expect(await screen.findByText('Duration cannot exceed 180 minutes')).toBeInTheDocument();
    expect(h.createQuiz).not.toHaveBeenCalled();
  });

  it('needs a correct answer on every question of a normal quiz', async () => {
    render(<QuizFormBuilder />);
    type('Enter quiz title', 'Cricket Cup');
    type('Enter your question', 'Who won PSL 2020?');
    fireEvent.click(removeOptionBtn(4));
    fireEvent.click(removeOptionBtn(3));
    type('Option 1', 'Pakistan');
    type('Option 2', 'England');
    submit();
    expect(await screen.findByText('Correct option must be selected for normal quizzes')).toBeInTheDocument();
    expect(screen.getByText('Has errors')).toBeInTheDocument();
    expect(screen.getByText(/questions: Errors in list/)).toBeInTheDocument();
    expect(h.createQuiz).not.toHaveBeenCalled();
  });

  it('lets a predictable quiz skip correct answers, clearing any already marked', async () => {
    render(<QuizFormBuilder />);
    type('Enter quiz title', 'Prediction night');
    fillValidQuestion();
    fireEvent.click(screen.getByRole('button', { name: 'Predictable' }));
    expect(screen.getByText('Answers will be evaluated later by Admin')).toBeInTheDocument();
    expect(within(optionRow(1)).getAllByRole('button')).toHaveLength(1);
    submit();
    await waitFor(() => expect(h.createQuiz).toHaveBeenCalled());
    expect(h.createQuiz.mock.calls[0][0]).toMatchObject({ quizType: 'predictable', questions: [expect.objectContaining({ correctOption: null })] });
    fireEvent.click(screen.getByRole('button', { name: 'Normal' }));
    expect(screen.getByText('Click the check to mark correct answer')).toBeInTheDocument();
  });

  it('asks for a new correct answer after the marked option is removed', async () => {
    render(<QuizFormBuilder />);
    type('Enter quiz title', 'Cricket Cup');
    type('Enter your question', 'Who won PSL 2020?');
    fireEvent.click(removeOptionBtn(4));
    type('Option 1', 'Karachi Kings');
    type('Option 2', 'Lahore Qalandars');
    type('Option 3', 'Multan Sultans');
    fireEvent.click(correctBtn(3));
    fireEvent.click(removeOptionBtn(3));
    submit();
    expect(await screen.findByText('Correct option must be selected for normal quizzes')).toBeInTheDocument();
    expect(h.createQuiz).not.toHaveBeenCalled();
  });

  it('keeps the correct answer when an option before it is removed', async () => {
    render(<QuizFormBuilder />);
    type('Enter quiz title', 'Cricket Cup');
    type('Enter your question', 'Who won PSL 2020?');
    type('Option 1', 'Lahore Qalandars');
    type('Option 2', 'Multan Sultans');
    type('Option 3', 'Karachi Kings');
    type('Option 4', 'Peshawar Zalmi');
    fireEvent.click(correctBtn(3));
    fireEvent.click(removeOptionBtn(1));
    submit();
    await waitFor(() => expect(h.createQuiz).toHaveBeenCalled());
    const q = h.createQuiz.mock.calls[0][0].questions[0];
    expect(q.options.map((o: { text: string }) => o.text)).toEqual(['Multan Sultans', 'Karachi Kings', 'Peshawar Zalmi']);
    expect(q.correctOption).toBe(1);
  });

  it('says which option is missing its text', async () => {
    render(<QuizFormBuilder />);
    type('Enter quiz title', 'Cricket Cup');
    fillValidQuestion();
    type('Option 2', '');
    submit();
    expect(await screen.findByText('Every option needs text')).toBeInTheDocument();
  });

  it('schedules a quiz with a start time, converted to UTC', async () => {
    render(<QuizFormBuilder />);
    type('Enter quiz title', 'Scheduled Cup');
    fillValidQuestion();
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    submit();
    expect(await screen.findByText('Pick a valid date and time for the schedule')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Select date and time'));
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === '20')!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    submit();
    await waitFor(() => expect(h.createQuiz).toHaveBeenCalled());
    const payload = h.createQuiz.mock.calls[0][0];
    expect(payload).toMatchObject({ status: 'scheduled', difficulty: 'hard' });
    expect(payload.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    expect(new Date(payload.startsAt).getDate()).toBe(20);
  });

  it('drops the start time for statuses that do not wait', async () => {
    render(<QuizFormBuilder />);
    type('Enter quiz title', 'Upcoming Cup');
    fillValidQuestion();
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
    fireEvent.click(screen.getByText('Select date and time'));
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === '21')!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Published' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paused' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Easy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    submit();
    await waitFor(() => expect(h.createQuiz).toHaveBeenCalled());
    expect(h.createQuiz.mock.calls[0][0]).toMatchObject({ status: 'draft', startsAt: null, difficulty: 'medium' });
  });

  it('makes quizzes free when the wallet is switched off', async () => {
    vi.stubGlobal('fetch', routes({ wallet: () => jsonResponse({ walletEnabled: false }) }));
    render(<QuizFormBuilder />);
    await waitFor(() => expect(screen.getByPlaceholderText('2').closest('.hidden')).not.toBeNull());
    type('Enter quiz title', 'Free Cup');
    fillValidQuestion();
    submit();
    await waitFor(() => expect(h.createQuiz).toHaveBeenCalled());
    expect(h.createQuiz.mock.calls[0][0].accessPrice).toBe(0);
  });

  it('logs a failed wallet-setting check and keeps the price', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.includes('wallet')) throw new Error('down'); return jsonResponse({}); }));
    render(<QuizFormBuilder />);
    await waitFor(() => expect(err).toHaveBeenCalledWith(expect.any(Error)));
    expect(screen.getByPlaceholderText('2').closest('.hidden')).toBeNull();
  });

  it('reports a refused or failed save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.createQuiz.mockResolvedValueOnce({ success: false, error: 'Title already used' }).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ success: true });
    const onSuccess = vi.fn();
    render(<QuizFormBuilder onSuccess={onSuccess} />);
    type('Enter quiz title', 'Cricket Cup');
    fillValidQuestion();
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Title already used'));
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('An unexpected error occurred'));
    submit();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Quiz created!'));
    expect(onSuccess).toHaveBeenCalledWith(undefined);
  });

  it('shows a busy button while saving', async () => {
    let release!: (v: unknown) => void;
    h.createQuiz.mockReturnValueOnce(new Promise((r) => (release = r)));
    render(<QuizFormBuilder />);
    type('Enter quiz title', 'Cricket Cup');
    fillValidQuestion();
    submit();
    expect(await screen.findByRole('button', { name: /Creating/ })).toBeDisabled();
    release({ success: true });
    await waitFor(() => expect(screen.getByRole('button', { name: /Create Quiz/ })).toBeEnabled());
  });
});

describe('QuizFormBuilder: questions and options', () => {
  it('adds, collapses, reorders and removes questions', () => {
    render(<QuizFormBuilder />);
    fireEvent.click(screen.getByRole('button', { name: /Add Question/ }));
    expect(screen.getByText('Questions (2)')).toBeInTheDocument();
    type('Enter your question', 'First question', 0);
    type('Enter your question', 'Second question', 1);
    const header = (n: number) => screen.getByText(`Question ${n}`).parentElement!.parentElement as HTMLElement;
    fireEvent.click(header(1));
    expect(screen.getAllByPlaceholderText('Enter your question')).toHaveLength(1);
    fireEvent.click(header(1));
    expect(screen.getAllByPlaceholderText('Enter your question')).toHaveLength(2);
    const [, down] = within(header(1)).getAllByRole('button');
    fireEvent.click(down);
    expect(within(header(1)).getByText(/Second question/)).toBeInTheDocument();
    const [up] = within(header(2)).getAllByRole('button');
    fireEvent.click(up);
    expect(within(header(1)).getByText(/First question/)).toBeInTheDocument();
    fireEvent.click(within(header(1)).getAllByRole('button')[2]);
    expect(screen.getByText('Questions (1)')).toBeInTheDocument();
    fireEvent.click(within(header(1)).getAllByRole('button')[2]);
    expect(h.toast.error).toHaveBeenCalledWith('Quiz must have at least one question');
  });

  it('removing an earlier question keeps later ones expanded', () => {
    render(<QuizFormBuilder />);
    fireEvent.click(screen.getByRole('button', { name: /Add Question/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add Question/ }));
    const header = (n: number) => screen.getByText(`Question ${n}`).parentElement!.parentElement as HTMLElement;
    fireEvent.click(within(header(1)).getAllByRole('button')[2]);
    expect(screen.getAllByPlaceholderText('Enter your question')).toHaveLength(2);
  });

  it('removing a later question keeps an earlier one expanded', () => {
    render(<QuizFormBuilder />);
    fireEvent.click(screen.getByRole('button', { name: /Add Question/ }));
    const header = (n: number) => screen.getByText(`Question ${n}`).parentElement!.parentElement as HTMLElement;
    fireEvent.click(within(header(2)).getAllByRole('button')[2]);
    expect(screen.getAllByPlaceholderText('Enter your question')).toHaveLength(1);
  });

  it('shows range errors for the time-up, passing score and price fields', async () => {
    render(<QuizFormBuilder />);
    type('Enter quiz title', 'Cricket Cup');
    fillValidQuestion();
    const field = (label: RegExp) => screen.getByText(label).parentElement!.querySelector('input')!;
    fireEvent.change(field(/Display Duration/), { target: { value: '0' } });
    fireEvent.change(field(/Passing Score/), { target: { value: '101' } });
    fireEvent.change(screen.getByPlaceholderText('2'), { target: { value: '5000' } });
    submit();
    expect(await screen.findByText('Time-up duration must be at least 1 minute')).toBeInTheDocument();
    expect(screen.getByText('Passing score cannot exceed 100')).toBeInTheDocument();
    expect(screen.getByText('Access price cannot exceed 1000 PKR')).toBeInTheDocument();
  });

  it('adds options up to six and keeps at least two', () => {
    render(<QuizFormBuilder />);
    fireEvent.click(screen.getByRole('button', { name: /Add Option/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add Option/ }));
    expect(screen.getByPlaceholderText('Option 6')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Option/ })).toBeNull();
    for (let n = 6; n > 2; n--) fireEvent.click(removeOptionBtn(n));
    fireEvent.click(removeOptionBtn(2));
    expect(h.toast.error).toHaveBeenCalledWith('Minimum 2 options required');
    expect(screen.getByPlaceholderText('Option 2')).toBeInTheDocument();
  });

  it('warns before leaving with unsaved changes', () => {
    const { unmount } = render(<QuizFormBuilder />);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    type('Enter quiz title', 'Changed');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    unmount();
  });
});

describe('QuizFormBuilder: editing and prizes', () => {
  const existing: QuizFormData = {
    id: 'z1', title: 'Cricket Cup', description: 'desc', duration: 15, timeUpDuration: 60, passingScore: 50, accessPrice: 2, difficulty: 'easy',
    status: 'scheduled', startsAt: '2026-12-01T11:30:00.000Z', prizeId: 'p1', isBumperPrize: false, quizType: 'normal',
    maxEntries: 500, pointsPool: 20_000,
    questions: [{ id: 'q1', text: 'Who won in 1992?', options: [{ text: 'Pakistan', isCorrect: true }, { text: 'England', isCorrect: false }], correctOption: 0, status: 'active' }],
  };

  it('loads an existing quiz with its prize and saves an update', async () => {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();
    render(<QuizFormBuilder initialData={existing} onSuccess={onSuccess} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: /Update Quiz/ })).toBeInTheDocument();
    expect(await screen.findByText('Prize linked: Bike')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('p1');
    expect(screen.getByText(/Dec 1, 2026/)).toBeInTheDocument();
    submit();
    await waitFor(() => expect(h.updateQuiz).toHaveBeenCalled());
    expect(h.updateQuiz.mock.calls[0][0]).toMatchObject({ id: 'z1', startsAt: '2026-12-01T11:30:00.000Z', prizeId: 'p1' });
    expect(h.toast.success).toHaveBeenCalledWith('Quiz updated!');
    expect(onSuccess).toHaveBeenCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('loads and saves the entry limit and points pool, which start at 2,000 and 0 for a new quiz', async () => {
    const { unmount } = render(<QuizFormBuilder initialData={existing} />);
    expect(screen.getByLabelText(/Entry Limit/)).toHaveValue(500);
    expect(screen.getByLabelText(/Points Pool/)).toHaveValue(20_000);
    fireEvent.change(screen.getByLabelText(/Entry Limit/), { target: { value: '1500' } });
    submit();
    await waitFor(() => expect(h.updateQuiz).toHaveBeenCalled());
    expect(h.updateQuiz.mock.calls[0][0]).toMatchObject({ maxEntries: 1500, pointsPool: 20_000 });
    unmount();

    render(<QuizFormBuilder />);
    expect(screen.getByLabelText(/Entry Limit/)).toHaveValue(2000);
    expect(screen.getByLabelText(/Points Pool/)).toHaveValue(0);
    expect(screen.getByText(/Players never see this number/)).toBeInTheDocument();
  });

  it('shows the update spinner wording', async () => {
    h.updateQuiz.mockReturnValueOnce(new Promise(() => {}));
    render(<QuizFormBuilder initialData={{ ...existing, startsAt: null, status: 'draft' }} />);
    submit();
    expect(await screen.findByRole('button', { name: /Updating/ })).toBeInTheDocument();
  });

  it('links and unlinks a prize and marks it as a bumper draw', async () => {
    render(<QuizFormBuilder />);
    expect(screen.getByText('Optional: shows this prize on the quiz card. You award prizes when you settle the quiz')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Link to Prize'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bike' })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } });
    expect(screen.getByText('Prize linked: Bike')).toBeInTheDocument();
    const bumper = screen.getByText('Bumper Prize').closest('label')!.querySelector('div')!;
    fireEvent.click(bumper);
    expect(bumper.className).toContain('bg-yellow-500');
    fireEvent.click(bumper);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(screen.getByText('Optional: shows this prize on the quiz card. You award prizes when you settle the quiz')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Link to Prize'));
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('copes with prize lists that are empty, in another shape or unavailable', async () => {
    const shapes = [() => jsonResponse({ prizes: [{ id: 'p2', name: 'Phone', description: null }] }), () => jsonResponse({}, 500), () => jsonResponse({})];
    for (const prizes of shapes) {
      vi.stubGlobal('fetch', routes({ prizes }));
      const { unmount } = render(<QuizFormBuilder />);
      fireEvent.click(screen.getByText('Link to Prize'));
      await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
      unmount();
    }
    vi.stubGlobal('fetch', routes({ prizes: () => { throw new Error('x'); } }));
    render(<QuizFormBuilder initialData={{ ...existing, prizeId: 'gone' }} />);
    expect(await screen.findByText('Prize linked: gone')).toBeInTheDocument();
    expect(screen.getByText(/No active prizes found/)).toBeInTheDocument();
  });
});
