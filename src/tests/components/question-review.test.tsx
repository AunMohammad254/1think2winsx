import '@/tests/helpers/ui';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import QuestionReview, { changeLine } from '@/components/admin/matches/QuestionReview';
import type { MatchView } from '@/lib/match-service';

type Draft = MatchView['drafts'][number];
const NOW = Date.parse('2026-10-31T12:00:00Z');

const runs = (over: Partial<Draft> = {}): Draft => ({
  id: 'r', innings: 1, over: 4, market: 'over_runs_at_least', params: { line: 9 }, options: ['Yes', 'No'], line: 9,
  text: 'Lahore need runs: will over 4 go for 9 or more?', textRomanUrdu: 'Lahore ko runs chahiye: over 4 mein 9 ya zyada?',
  plainText: 'Lahore: will over 4 go for 9 or more runs?', plainTextRomanUrdu: 'Lahore: kya over 4 mein 9 ya us se zyada runs banenge?',
  ai: true, closesAt: new Date(NOW + 100_000).toISOString(), state: 'waiting', ...over,
});
const wicket = (over: Partial<Draft> = {}): Draft => ({
  id: 'w', innings: 1, over: 4, market: 'wicket_in_over', params: {}, options: ['Yes', 'No'], line: null,
  text: 'Will a wicket fall in over 4?', textRomanUrdu: 'Kya over 4 mein koi wicket giray ga?',
  plainText: 'Will a wicket fall in over 4?', plainTextRomanUrdu: 'Kya over 4 mein koi wicket giray ga?',
  ai: false, closesAt: new Date(NOW + 100_000).toISOString(), state: 'waiting', ...over,
});

function setup(drafts: Draft[], answer = true) {
  const onSend = vi.fn(async () => answer);
  const onSkip = vi.fn(async () => answer);
  const utils = render(<QuestionReview drafts={drafts} now={NOW} busy={false} onSend={onSend} onSkip={onSkip} />);
  return { ...utils, onSend, onSkip };
}

describe('changeLine', () => {
  it('changes the line where it stands as a number of its own, never the over it names', () => {
    expect(changeLine('Will over 9 go for 9 or more? 19 is not it', 9, 10)).toBe('Will over 9 go for 10 or more? 19 is not it');
    expect(changeLine('Kya Over 4 mein 4 ya zyada?', 4, 6)).toBe('Kya Over 4 mein 6 ya zyada?');
  });
});

describe('QuestionReview', () => {
  it('shows nothing when no question waits', () => {
    const { container } = setup([]);
    expect(container).toBeEmptyDOMElement();
    expect(setup([runs({ state: 'skipped' })]).container).toBeEmptyDOMElement();
  });

  it("shows an over's questions with who worded them and the time left to send", () => {
    setup([runs(), wicket()]);
    const over = screen.getByRole('group', { name: 'Over 4 questions' });
    // 100 s left, less the 10 s players need to answer
    expect(over).toHaveTextContent('Send within 1:30, and before the 5th ball of over 3');
    expect(over).toHaveTextContent('Worded by Gemini: check it');
    expect(over).toHaveTextContent('Built-in wording');
    expect(within(over).getAllByRole('textbox')[0]).toHaveValue('Lahore ko runs chahiye: over 4 mein 9 ya zyada?');
    expect(within(over).getAllByRole('textbox')[1]).toHaveValue('Lahore need runs: will over 4 go for 9 or more?');
    // Only the runs question has a line
    expect(within(over).getAllByRole('spinbutton')).toHaveLength(1);
  });

  it('warns in red under 30 seconds, and words over 1 differently', () => {
    setup([wicket({ over: 1, closesAt: new Date(NOW + 35_000).toISOString() })]);
    const text = screen.getByText(/Send within 0:25, and before over 1 starts/);
    expect(text).toHaveClass('text-red-300');
  });

  it('sends one question as edited, a changed line in both wordings, and forgets the edit once sent', async () => {
    const { onSend } = setup([runs(), wicket()]);
    const [urdu, english] = screen.getAllByRole('textbox');
    fireEvent.change(english, { target: { value: 'Will Lahore get 9 or more in over 4?' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '11' } });
    expect(english).toHaveValue('Will Lahore get 11 or more in over 4?');
    expect(urdu).toHaveValue('Lahore ko runs chahiye: over 4 mein 11 ya zyada?');
    // Out of range or not a number: nothing changes
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(english).toHaveValue('Will Lahore get 11 or more in over 4?');

    fireEvent.change(urdu, { target: { value: 'Kya Lahore over 4 mein 11 ya zyada banayega?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send over 4 question 1' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith([
      { id: 'r', text: 'Will Lahore get 11 or more in over 4?', textRomanUrdu: 'Kya Lahore over 4 mein 11 ya zyada banayega?', line: 11 },
    ]));
    await waitFor(() => expect(screen.getAllByRole('textbox')[1]).toHaveValue('Lahore need runs: will over 4 go for 9 or more?'));
  });

  it('rewords from the text before the line box was touched, so typing 10 never leaves a 1 behind', () => {
    setup([runs({ over: 1, text: 'Will over 1 go for 9 or more?', textRomanUrdu: 'Kya over 1 mein 9 ya zyada?' })]);
    const box = screen.getByRole('spinbutton');
    fireEvent.change(box, { target: { value: '1' } });
    fireEvent.change(box, { target: { value: '10' } });
    expect(screen.getAllByRole('textbox')[1]).toHaveValue('Will over 1 go for 10 or more?');
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Kya over 1 mein 10 ya zyada?');
    // A hand edit starts a new base: the next line change rewords the edited text
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Over 1: 10 or more for Lahore?' } });
    fireEvent.change(box, { target: { value: '12' } });
    expect(screen.getAllByRole('textbox')[1]).toHaveValue('Over 1: 12 or more for Lahore?');
  });

  it('puts a question back to the built-in wording and line', () => {
    setup([runs()]);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /Built-in wording/ }));
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Lahore: kya over 4 mein 9 ya us se zyada runs banenge?');
    expect(screen.getAllByRole('textbox')[1]).toHaveValue('Lahore: will over 4 go for 9 or more runs?');
    expect(screen.getByRole('spinbutton')).toHaveValue(9);
    // Already the built-in wording: nothing to put back
    expect(screen.queryByRole('button', { name: /Built-in wording/ })).toBeNull();
  });

  it('sends the whole over at once, unchanged questions without a line', async () => {
    const { onSend } = setup([runs(), wicket()]);
    fireEvent.click(screen.getByRole('button', { name: /Send all 2 for over 4/ }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith([
      { id: 'r', text: runs().text, textRomanUrdu: runs().textRomanUrdu },
      { id: 'w', text: wicket().text, textRomanUrdu: wicket().textRomanUrdu },
    ]));
  });

  it('skips a question, and keeps its edits when the server refuses', async () => {
    const { onSkip, onSend } = setup([runs(), wicket()], false);
    fireEvent.click(screen.getByRole('button', { name: 'Skip over 4 question 2' }));
    await waitFor(() => expect(onSkip).toHaveBeenCalledWith(['w']));
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Edited over 4 for 9?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send over 4 question 1' }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(screen.getAllByRole('textbox')[1]).toHaveValue('Edited over 4 for 9?');
  });

  it('skips a question, forgetting its edits once skipped', async () => {
    const { onSkip } = setup([wicket()]);
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Edited over 4?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skip over 4 question 1' }));
    await waitFor(() => expect(onSkip).toHaveBeenCalledWith(['w']));
    await waitFor(() => expect(screen.getAllByRole('textbox')[1]).toHaveValue('Will a wicket fall in over 4?'));
  });

  it("says which overs' questions ran out of time", () => {
    setup([runs({ state: 'too_late', over: 2 }), wicket({ state: 'too_late', over: 2 }), wicket({ id: 'w3', state: 'too_late', over: 3 })]);
    expect(screen.getByText('Ran out of time, never sent: over 2, 3. Those overs have no questions.')).toBeInTheDocument();
    expect(screen.queryByRole('group')).toBeNull();
  });
});
