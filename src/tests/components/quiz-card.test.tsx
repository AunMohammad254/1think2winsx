import '@/tests/helpers/ui';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import QuizCard, { changeLine } from '@/components/admin/matches/QuizCard';
import type { QuizView } from '@/lib/match-service';

const RUNS = {
  id: 'r', market: 'over_runs_at_least', options: ['Yes', 'No'], line: 9,
  text: 'Lahore 87/2 after 9 overs: will over 11 go for 9 or more runs?', textRomanUrdu: '9 overs ke baad Lahore 87/2: kya over 11 mein 9 ya us se zyada runs banenge?',
  source: 'ai' as const, builtIn: { text: 'Lahore: will over 11 go for 9 or more runs?', textRomanUrdu: 'Lahore: kya over 11 mein 9 ya us se zyada runs banenge?', line: 9 },
  best: true, selected: true,
};
const WICKET = {
  id: 'w', market: 'wicket_in_over', options: ['Yes', 'No'], line: null, text: 'Will a wicket fall in over 11?', textRomanUrdu: 'Kya over 11 mein koi wicket giray ga?',
  source: 'built_in' as const, builtIn: { text: 'Will a wicket fall in over 11?', textRomanUrdu: 'Kya over 11 mein koi wicket giray ga?', line: null },
  best: false, selected: false,
};
const quiz = (over: Partial<QuizView> = {}): QuizView => ({
  innings: 1, over: 11, during: 10, ballsBowled: 0, started: false, pushOn: null, pushBy: null, wording: 'ai', rebuilt: false,
  questions: [RUNS, WICKET], ...over,
});

function setup(over: Partial<QuizView> = {}, language: 'both' | 'en' | 'ur' = 'both') {
  const handlers = {
    onSend: vi.fn(async () => true), onQueue: vi.fn(async () => true), onUnqueue: vi.fn(async () => true), onSkip: vi.fn(async () => true),
  };
  render(<QuizCard quiz={quiz(over)} language={language} busy={false} {...handlers} />);
  return { ...handlers, card: screen.getByRole('group', { name: 'Over 11 quiz' }) };
}

describe('changeLine', () => {
  it('changes the line, never the over or the same number in the lead-in', () => {
    expect(changeLine('Will over 9 go for 9 or more runs?', 9, 10)).toBe('Will over 9 go for 10 or more runs?');
    expect(changeLine('Over 9 mein 9 ya zyada? 19 nahi', 9, 7)).toBe('Over 9 mein 7 ya zyada? 19 nahi');
    expect(changeLine('Lahore 87/2 after 9 overs: will over 11 go for 9 or more runs?', 9, 10)).toBe('Lahore 87/2 after 9 overs: will over 11 go for 10 or more runs?');
    expect(changeLine('Will over 9 go for more runs?', 9, 10)).toBe('Will over 9 go for more runs?');
  });
});

describe('QuizCard', () => {
  it('shows the questions as players will see them, the best ticked, and when the quiz goes out', () => {
    const { card } = setup();
    expect(card).toHaveTextContent('Goes out during over 10');
    expect(card).toHaveTextContent('Worded by Gemini');
    // Roman Urdu first, English under it
    expect(within(card).getAllByRole('listitem')[0].textContent).toMatch(/^9 overs ke baad Lahore 87\/2: kya over 11.*Lahore 87\/2 after 9 overs: will over 11/);
    expect(within(card).getByRole('checkbox', { name: 'Include question 1' })).toBeChecked();
    expect(within(card).getByRole('checkbox', { name: 'Include question 2' })).not.toBeChecked();
    expect(within(card).getAllByText('Best')).toHaveLength(1);
  });

  it('shows one language when the match uses one', () => {
    setup({}, 'en');
    expect(screen.queryByText(RUNS.textRomanUrdu)).toBeNull();
    expect(screen.getByText(RUNS.text)).toBeInTheDocument();
  });

  it('shows Roman Urdu only when the match uses it', () => {
    setup({}, 'ur');
    expect(screen.queryByText(RUNS.text)).toBeNull();
    expect(screen.getByText(RUNS.textRomanUrdu)).toBeInTheDocument();
  });

  it('sends the ticked questions now, each with its line', async () => {
    const { card, onSend, onQueue } = setup();
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Include question 2' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Send now (2)' }));
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith([
      { id: 'r', text: RUNS.text, textRomanUrdu: RUNS.textRomanUrdu, line: 9 },
      { id: 'w', text: WICKET.text, textRomanUrdu: WICKET.textRomanUrdu },
    ]));
    expect(onQueue).not.toHaveBeenCalled();
  });

  it('asks for at least one question', () => {
    const { card, onSend } = setup();
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Include question 1' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Send now (0)' }));
    expect(within(card).getByRole('alert')).toHaveTextContent('Tick at least one question');
    expect(onSend).not.toHaveBeenCalled();
    // Ticking again clears it
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Include question 2' }));
    expect(within(card).queryByRole('alert')).toBeNull();
  });

  it('queues the quiz for a ball of the over before it; picking the ball again sends now instead', async () => {
    const { card, onQueue, onSend } = setup();
    const chips = within(card).getByRole('group', { name: 'Push on ball' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['10.1', '10.2', '10.3', '10.4']);
    fireEvent.click(within(chips).getByRole('button', { name: 'Push on ball 1' }));
    expect(within(chips).getByRole('button', { name: 'Push on ball 1' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(card).getByRole('button', { name: 'Queue for ball 1' }));
    await vi.waitFor(() => expect(onQueue).toHaveBeenCalledWith(1, [{ id: 'r', text: RUNS.text, textRomanUrdu: RUNS.textRomanUrdu, line: 9 }]));
    fireEvent.click(within(chips).getByRole('button', { name: 'Push on ball 1' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Send now (1)' }));
    await vi.waitFor(() => expect(onSend).toHaveBeenCalled());
  });

  it("can't pick a ball already bowled", () => {
    setup({ started: true, ballsBowled: 2 });
    const chips = screen.getByRole('group', { name: 'Push on ball' });
    expect(within(chips).getAllByRole('button').map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, true, false, false]);
    expect(screen.getByText('Over 10 is being bowled: 2 balls so far')).toBeInTheDocument();
  });

  it("over 1's quiz goes out before the first ball: no ball to pick", () => {
    setup({ during: null, ballsBowled: null });
    expect(screen.getByText('Goes out before the first ball')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Push on ball' })).toBeNull();
    cleanupAndSetup({ started: true, ballsBowled: 1 });
    expect(screen.getByText('Over 10 is being bowled: 1 ball so far')).toBeInTheDocument();
  });

  it('edits a wording, changes the line (rewording from where it started), and goes back to the built-in wording', async () => {
    const { card, onSend } = setup();
    fireEvent.click(within(card).getByRole('button', { name: 'Edit question 1' }));
    const line = within(card).getByRole('spinbutton');
    // Typing 10 passes through 1: the text follows from the start each time
    fireEvent.change(line, { target: { value: '1' } });
    fireEvent.change(line, { target: { value: '10' } });
    expect(within(card).getByLabelText('English')).toHaveValue('Lahore 87/2 after 9 overs: will over 11 go for 10 or more runs?');
    expect(within(card).getByLabelText('Roman Urdu')).toHaveValue('9 overs ke baad Lahore 87/2: kya over 11 mein 10 ya us se zyada runs banenge?');
    // Out of range or not a number: nothing changes
    fireEvent.change(line, { target: { value: '40' } });
    fireEvent.change(line, { target: { value: '' } });
    expect(line).toHaveValue(10);
    fireEvent.change(within(card).getByLabelText('English'), { target: { value: 'Big over 11, 10 or more?' } });
    fireEvent.click(within(card).getByRole('button', { name: /Built-in wording/ }));
    expect(within(card).getByLabelText('English')).toHaveValue(RUNS.builtIn.text);
    expect(line).toHaveValue(9);
    // Back to the built-in one: nothing to undo
    expect(within(card).queryByRole('button', { name: /Built-in wording/ })).toBeNull();
    fireEvent.change(within(card).getByLabelText('Roman Urdu'), { target: { value: 'Over 11 mein 9 ya zyada?' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Close question 1' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Send now (1)' }));
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith([{ id: 'r', text: RUNS.builtIn.text, textRomanUrdu: 'Over 11 mein 9 ya zyada?', line: 9 }]));
    // A question without a line has no line box
    fireEvent.click(within(card).getByRole('button', { name: 'Edit question 2' }));
    expect(within(card).queryByRole('spinbutton')).toBeNull();
  });

  it('a queued quiz goes out as it was set: send it now, or cancel it', async () => {
    const { card, onSend, onUnqueue, onSkip } = setup({ pushOn: 3, pushBy: 'admin', started: true, ballsBowled: 1, wording: 'pending', rebuilt: true });
    expect(within(card).getByRole('status')).toHaveTextContent('Goes out on ball 3 of over 10.');
    expect(card).toHaveTextContent('Gemini is wording it…');
    expect(card).toHaveTextContent('Updated from the corrected score.');
    expect(within(card).queryByRole('group', { name: 'Push on ball' })).toBeNull();
    expect(within(card).queryByRole('button', { name: /Edit question/ })).toBeNull();
    expect(within(card).getByRole('checkbox', { name: 'Include question 1' })).toBeDisabled();
    expect(within(card).queryByRole('button', { name: /Skip/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Send now' }));
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith([{ id: 'r', text: RUNS.text, textRomanUrdu: RUNS.textRomanUrdu, line: 9 }]));
    fireEvent.click(within(card).getByRole('button', { name: /Cancel/ }));
    expect(onUnqueue).toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('skips the whole quiz, and shows when the built-in wording is used', () => {
    const { card, onSkip } = setup({ wording: 'built_in' });
    expect(card).toHaveTextContent('Built-in wording');
    fireEvent.click(within(card).getByRole('button', { name: /Skip/ }));
    expect(onSkip).toHaveBeenCalledWith(['r', 'w']);
  });
});

function cleanupAndSetup(over: Partial<QuizView>) {
  document.body.innerHTML = '';
  return setup(over);
}
