import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import QuizHistory from '@/components/admin/QuizHistory';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

const entry = (id: string, action: string, details: Record<string, unknown> = {}) => ({
  id, quizId: 'q1', quizTitle: 'Final', action, adminEmail: 'boss@example.test', details, createdAt: '2026-10-24T10:00:00Z',
});

describe('QuizHistory', () => {
  it("lists who did what, newest first, with a short summary of each action's details", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      actions: [
        entry('1', 'quiz_status_changed', { changes: { status: 'paused' } }),
        entry('2', 'quiz_created', { questions: 1 }),
        entry('3', 'quiz_edited', { questions: 4 }),
        entry('4', 'quiz_edited', {}),
        entry('5', 'question_added', { text: 'Who wins?' }),
        entry('6', 'question_deleted', {}),
        entry('7', 'result_saved', { endedNow: true }),
        entry('8', 'result_saved', { endedNow: false }),
        entry('9', 'quiz_settled', { winners: [{ rank: 1 }] }),
        entry('10', 'quiz_settled', { winners: [{ rank: 1 }, { rank: 2 }] }),
        entry('11', 'quiz_settled', {}),
        entry('12', 'notices_resent', { notified: 3 }),
        entry('13', 'notices_resent', {}),
        entry('14', 'quiz_announced', { resent: true }),
        entry('15', 'quiz_announced', { resent: false }),
        entry('16', 'quiz_paused'),
        entry('17', 'something_new'),
        entry('18', 'quiz_scheduled', { startsAt: '2026-11-01T13:00:00Z' }),
        entry('19', 'quiz_scheduled', {}),
      ],
    }));
    render(<QuizHistory quizId="q 1" />);
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/quizzes/q%201/history');
    const cells = rows.map((row) => within(row).getAllByRole('cell').slice(1).map((c) => c.textContent));
    expect(cells).toEqual([
      ['boss@example.test', 'Changed the status', 'Status: paused'],
      ['boss@example.test', 'Created the quiz', '1 question'],
      ['boss@example.test', 'Edited the quiz', '4 questions'],
      ['boss@example.test', 'Edited the quiz', ''],
      ['boss@example.test', 'Added a question', '“Who wins?”'],
      ['boss@example.test', 'Deleted a question', ''],
      ['boss@example.test', 'Saved the result', 'Ended the quiz'],
      ['boss@example.test', 'Saved the result', ''],
      ['boss@example.test', 'Settled the quiz', '1 winner'],
      ['boss@example.test', 'Settled the quiz', '2 winners'],
      ['boss@example.test', 'Settled the quiz', ''],
      ['boss@example.test', 'Sent the notices again', '3 sent'],
      ['boss@example.test', 'Sent the notices again', ''],
      ['boss@example.test', 'Announced as upcoming', 'Sent again'],
      ['boss@example.test', 'Announced as upcoming', ''],
      ['boss@example.test', 'Paused', ''],
      ['boss@example.test', 'something_new', ''],
      ['boss@example.test', 'Scheduled', 'For 1 Nov 2026, 18:00'],
      ['boss@example.test', 'Scheduled', ''],
    ]);
    // Times in Pakistan time, as the column says
    expect(within(rows[0]).getAllByRole('cell')[0]).toHaveTextContent('24 Oct 2026, 15:00');
  });

  it('says when nothing was recorded yet, and while it loads', async () => {
    let answer: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { answer = resolve; }));
    render(<QuizHistory quizId="q1" />);
    expect(screen.getByText('Loading the history…')).toBeInTheDocument();
    answer(jsonResponse({}));
    expect(await screen.findByText(/No admin actions recorded yet/)).toBeInTheDocument();
  });

  it('shows why the history could not load', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Admin access required' }, 403));
    const first = render(<QuizHistory quizId="q1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required');
    first.unmount();
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    const second = render(<QuizHistory quizId="q1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the history');
    second.unmount();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<QuizHistory quizId="q1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the history');
  });

  it('ignores an answer that arrives after it was closed', async () => {
    let answer: (r: Response) => void = () => {};
    let fail: (e: Error) => void = () => {};
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((resolve) => { answer = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((_, reject) => { fail = reject; }));
    render(<QuizHistory quizId="q1" />).unmount();
    render(<QuizHistory quizId="q2" />).unmount();
    answer(jsonResponse({ actions: [entry('1', 'quiz_paused')] }));
    fail(new Error('late'));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
