import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  createQuiz: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/quiz-actions', () => ({ createQuiz: (...a: unknown[]) => h.createQuiz(...a) }));
vi.mock('@/components/ui/DateTimePicker', () => ({
  default: ({ value, onChange }: { value?: string; onChange: (v: string) => void }) => (
    <input aria-label="Start time" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import QuickQuizPanel from '@/components/admin/QuickQuizPanel';

const onOpenChange = vi.fn();
const onSaved = vi.fn();

beforeEach(() => {
  for (const fn of [...Object.values(h.toast), h.createQuiz, onOpenChange, onSaved]) fn.mockReset();
  h.createQuiz.mockResolvedValue({ success: true, message: 'Quiz created and pushed to live viewers!', data: { id: 'new', pushedAt: '2026-10-27T10:00:00Z' } });
});
afterEach(() => vi.restoreAllMocks());

const panel = () => render(<QuickQuizPanel open onOpenChange={onOpenChange} onSaved={onSaved} />);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const alertText = () => screen.getByRole('alert').textContent;
/** A title and one question with two options, the second one correct. */
function fillOneQuestion() {
  type('Title', '  PSL final  ');
  type('Question 1', 'Who wins the toss?');
  type('Question 1, option 1', 'Lahore');
  type('Question 1, option 2', 'Karachi');
  fireEvent.click(screen.getByRole('radio', { name: 'Option 2 of question 1 is correct' }));
}
const local = (ms: number) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

describe('Quick quiz panel', () => {
  it('creates a quiz and pushes it live in one step', async () => {
    panel();
    expect(screen.getByRole('heading', { name: 'Quick quiz' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Go live now/ })).toBeChecked();
    fillOneQuestion();
    type('Duration (minutes)', '5');
    type('Points pool (optional)', '100');
    click('Create & go live');

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Quiz created and pushed to live viewers!'));
    const [input, options] = h.createQuiz.mock.calls[0];
    expect(options).toEqual({ goLive: true });
    expect(input).toMatchObject({
      title: 'PSL final', quizType: 'normal', duration: 5, pointsPool: 100, status: 'active', startsAt: null, maxEntries: 2000,
      questions: [{
        text: 'Who wins the toss?', correctOption: 1, status: 'active',
        options: [{ text: 'Lahore', isCorrect: false }, { text: 'Karachi', isCorrect: true }],
      }],
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Ready for the next quiz
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Question 1') as HTMLInputElement).value).toBe('');
  });

  it('says so when the quiz was created but its push failed, and still closes', async () => {
    h.createQuiz.mockResolvedValueOnce({ success: true, message: 'Quiz created and published, but pushing it live failed.', data: { id: 'new' } });
    panel();
    fillOneQuestion();
    click('Create & go live');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Quiz created and published, but pushing it live failed.'));
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('schedules a quiz for a time to come, sent as the instant the admin picked', async () => {
    h.createQuiz.mockResolvedValue({ success: true, message: 'Quiz created successfully!', data: { id: 'new' } });
    panel();
    fillOneQuestion();
    fireEvent.click(screen.getByRole('radio', { name: /Schedule/ }));
    click('Create & schedule');
    expect(alertText()).toBe('Pick a valid date and time for the schedule');
    type('Start time', local(Date.now() - 3_600_000));
    click('Create & schedule');
    expect(alertText()).toBe('Pick a time in the future');
    expect(h.createQuiz).not.toHaveBeenCalled();

    const at = local(Date.now() + 3_600_000);
    type('Start time', at);
    click('Create & schedule');
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Quiz created successfully!'));
    expect(h.createQuiz).toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled', startsAt: new Date(at).toISOString() }), { goLive: false });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('saves a prediction as a draft, with no answer key', async () => {
    h.createQuiz.mockResolvedValue({ success: true, message: 'Quiz created successfully!', data: { id: 'new' } });
    panel();
    fillOneQuestion();
    fireEvent.click(screen.getByRole('button', { name: 'predictable' }));
    expect(screen.getByRole('button', { name: 'predictable' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('radio', { name: /is correct/ })).toBeNull();
    expect(screen.getByText(/A prediction has no answer key/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Save as draft/ }));
    click('Save draft');
    await waitFor(() => expect(h.createQuiz).toHaveBeenCalled());
    expect(h.createQuiz.mock.calls[0]).toEqual([expect.objectContaining({
      quizType: 'predictable', status: 'draft', startsAt: null, pointsPool: 0,
      questions: [expect.objectContaining({ correctOption: null, options: [{ text: 'Lahore', isCorrect: false }, { text: 'Karachi', isCorrect: false }] })],
    }), { goLive: false }]);
    // Back to a normal quiz: the ticked answer was kept
    fireEvent.click(screen.getByRole('button', { name: 'normal' }));
    expect(screen.getByText('Tick the correct option of each question.')).toBeInTheDocument();
  });

  it('says what to fix first, naming the question', () => {
    panel();
    click('Create & go live');
    expect(alertText()).toBe('Title must be at least 3 characters');
    type('Title', 'PSL final');
    type('Question 1', 'Win?');
    click('Create & go live');
    expect(alertText()).toBe('Question 1: Question must be at least 5 characters');
    type('Question 1', 'Who wins?');
    click('Create & go live');
    expect(alertText()).toBe('Question 1: Option text is required');
    type('Question 1, option 1', 'A');
    type('Question 1, option 2', 'B');
    click('Create & go live');
    expect(alertText()).toBe('Question 1: Correct option must be selected for normal quizzes');
    type('Duration (minutes)', '');
    click('Create & go live');
    expect(alertText()).toBe('Duration must be at least 1 minute');
    expect(h.createQuiz).not.toHaveBeenCalled();
  });

  it('keeps the panel open with the reason when the quiz is refused or saving fails', async () => {
    h.createQuiz.mockResolvedValueOnce({ success: false, error: 'Entry limit must be at least 1' }).mockRejectedValueOnce(new Error('offline'));
    panel();
    fillOneQuestion();
    click('Create & go live');
    expect(await screen.findByRole('alert')).toHaveTextContent('Entry limit must be at least 1');
    click('Create & go live');
    await waitFor(() => expect(alertText()).toBe('Saving the quiz failed. Check your connection and try again.'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('  PSL final  ');
  });

  it('adds and removes questions and options, keeping the correct answer on its option', () => {
    panel();
    expect(screen.queryByRole('button', { name: 'Remove question 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove option/ })).toBeNull();
    click('+ Add option');
    type('Question 1, option 1', 'A');
    type('Question 1, option 2', 'B');
    type('Question 1, option 3', 'C');
    const correct = (n: number) => screen.getByRole('radio', { name: `Option ${n} of question 1 is correct` }) as HTMLInputElement;
    // No answer ticked yet: removing an option ticks none
    click('Remove option 3 of question 1');
    expect([correct(1).checked, correct(2).checked]).toEqual([false, false]);
    click('+ Add option');
    type('Question 1, option 3', 'C');
    fireEvent.click(correct(3));
    // An option before the answer goes: the answer moves up with its option
    click('Remove option 1 of question 1');
    expect(correct(2).checked).toBe(true);
    expect((screen.getByLabelText('Question 1, option 2') as HTMLInputElement).value).toBe('C');
    // An option after it goes: it stays
    click('+ Add option');
    click('Remove option 3 of question 1');
    expect(correct(2).checked).toBe(true);
    // The answer itself goes: nothing is ticked
    click('+ Add option');
    click('Remove option 2 of question 1');
    expect([correct(1).checked, correct(2).checked]).toEqual([false, false]);

    // Six options at most
    for (let i = 0; i < 4; i++) click('+ Add option');
    expect(screen.getAllByLabelText(/^Question 1, option/)).toHaveLength(6);
    expect(screen.queryByRole('button', { name: '+ Add option' })).toBeNull();

    click('Add question');
    type('Question 2', 'Second?');
    expect(screen.getByRole('button', { name: 'Remove question 1' })).toBeInTheDocument();
    click('Remove question 1');
    expect((screen.getByLabelText('Question 1') as HTMLInputElement).value).toBe('Second?');
    expect(screen.queryByLabelText('Question 2')).toBeNull();
  });

  it('saves with Ctrl+Enter once, and stays open while saving', async () => {
    let finish: (r: unknown) => void = () => {};
    h.createQuiz.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    panel();
    fillOneQuestion();
    const title = screen.getByLabelText('Title');
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(h.createQuiz).not.toHaveBeenCalled(); // Enter alone never pushes a quiz live
    fireEvent.keyDown(title, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(title, { key: 'Enter', metaKey: true });
    expect(h.createQuiz).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => finish({ success: true, message: 'Live', data: { id: 'n', pushedAt: 'now' } }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes with Cancel and with Escape', () => {
    panel();
    click('Cancel');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    onOpenChange.mockClear();
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
