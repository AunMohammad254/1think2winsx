import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

type Handler = (payload: Record<string, Record<string, unknown>>) => void;
const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => 'toast-1') },
  actions: {
    publishQuiz: vi.fn(),
    pauseQuiz: vi.fn(),
    deleteQuiz: vi.fn(),
    pushQuizLive: vi.fn(),
    notifyUpcomingQuiz: vi.fn(),
    createQuiz: vi.fn(),
  },
  handlers: {} as Record<string, Handler>,
  removeChannel: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/quiz-actions', () => h.actions);
vi.mock('@/lib/supabase/client', () => {
  const channel = {
    on: (_type: string, filter: { event: string }, cb: Handler) => { h.handlers[filter.event] = cb; return channel; },
    subscribe: () => channel,
  };
  return { createClient: () => ({ channel: () => channel, removeChannel: h.removeChannel }) };
});
vi.mock('@/components/admin/DynamicAdminComponents', () => ({
  DynamicQuizFormBuilder: ({ initialData, onSuccess, onCancel }: { initialData?: unknown; onSuccess: () => void; onCancel: () => void }) => (
    <div>
      <pre data-testid="initial-data">{JSON.stringify(initialData ?? null)}</pre>
      <button onClick={onSuccess}>Form saved</button>
      <button onClick={onCancel}>Form cancelled</button>
    </div>
  ),
}));

import AdminQuizManagementPage from '@/app/admin/(protected)/quiz/page';

const quiz = (id: string, title: string, day: number, over: Record<string, unknown> = {}) => ({
  id, title, description: null, duration: 10, passingScore: 70, status: 'draft', createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, updatedAt: '', ...over,
});
const quizzes = [
  quiz('q1', 'Cricket Basics', 1, { description: 'Bats and balls', status: 'active', _count: { questions: 10, attempts: 50 } }),
  quiz('q2', 'History Quiz', 2, { stats: { totalQuestions: 5, totalAttempts: 7, averageScore: 0 } }),
  quiz('q3', 'Science', 3, { description: 'Atoms', status: 'scheduled', startsAt: '2026-11-01T15:00:00Z' }),
  quiz('q4', 'Upcoming Final', 4, { status: 'upcoming', startsAt: '2026-11-02T15:00:00Z', _count: { questions: 3, attempts: 0 } }),
  quiz('q5', 'Paused One', 5, { status: 'paused' }),
  quiz('q6', 'Legacy', 6, { status: 'archived' }),
  quiz('q7', 'Later', 7, { status: 'scheduled', startsAt: null }),
];
const many = (n: number) => Array.from({ length: n }, (_, i) => quiz(`m${i + 1}`, `Quiz ${String(i + 1).padStart(2, '0')}`, 1, { createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }));

let fetchMock: ReturnType<typeof vi.fn>;
const routes = (list: () => Response | Promise<Response> = () => jsonResponse({ quizzes }), detail: () => Response = () => jsonResponse({})) =>
  vi.fn(async (url: string) => (url === '/api/admin/quizzes' ? list() : detail()));

beforeEach(() => {
  for (const fn of [...Object.values(h.toast), ...Object.values(h.actions), h.removeChannel]) fn.mockClear();
  for (const fn of Object.values(h.actions)) fn.mockReset().mockResolvedValue({ success: true, message: 'Done' });
  h.handlers = {};
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const loaded = (title = 'Cricket Basics') => screen.findByRole('heading', { name: title });
const titles = () => screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent);
const row = (title: string) => screen.getByRole('heading', { name: title }).closest('.grid') as HTMLElement;
const openMenu = (title: string) => fireEvent.click(within(row(title)).getAllByRole('button')[0]);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const headerButtons = () => within(screen.getByRole('button', { name: /^Title/ }).parentElement!).getAllByRole('button');
const stat = (label: string) => screen.getByText(label, { selector: 'p.text-sm' }).previousElementSibling!.textContent;
const pager = () => screen.getByText(/^Showing/).nextElementSibling as HTMLElement;
const realtime = (event: string, payload: Record<string, Record<string, unknown>> = {}) => act(() => h.handlers[event](payload));

describe('admin quiz list page', () => {
  it('lists quizzes with status badges, counts and quick stats', async () => {
    render(<AdminQuizManagementPage />);
    expect(screen.getByText('Loading quizzes...')).toBeInTheDocument();
    await loaded();
    expect(titles()).toEqual(['Later', 'Legacy', 'Paused One', 'Upcoming Final', 'Science', 'History Quiz', 'Cricket Basics']);
    expect(within(row('Cricket Basics')).getByText('Published').className).toContain('text-green-400');
    expect(within(row('Cricket Basics')).getByText('Bats and balls')).toBeInTheDocument();
    expect(within(row('Cricket Basics')).getByText('50')).toBeInTheDocument();
    expect(within(row('History Quiz')).getByText('5')).toBeInTheDocument(); // falls back to stats
    expect(within(row('History Quiz')).getByText('7')).toBeInTheDocument();
    const startsAt = new Date('2026-11-01T15:00:00Z').toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    expect(within(row('Science')).getByText(`(${startsAt})`)).toBeInTheDocument();
    expect(within(row('Upcoming Final')).getByText('Upcoming').className).toContain('text-amber-400');
    expect(within(row('Later')).getByText('Scheduled').textContent).toBe('Scheduled'); // no start time
    expect(within(row('Legacy')).getByText('Draft').className).toContain('text-gray-400'); // unknown status
    expect(within(row('Paused One')).getAllByText('0')).toHaveLength(2);
    expect(stat('Total Quizzes')).toBe('7');
    expect(stat('Published')).toBe('1');
    expect(stat('Scheduled')).toBe('3');
    expect(stat('Drafts/Paused')).toBe('2');
    expect(screen.queryByText(/^Showing/)).toBeNull();
  });

  it('searches titles and descriptions and filters by status', async () => {
    render(<AdminQuizManagementPage />);
    await loaded();
    const search = (q: string) => fireEvent.change(screen.getByPlaceholderText('Search quizzes...'), { target: { value: q } });
    search('ATOMS');
    expect(titles()).toEqual(['Science']);
    search('hist');
    expect(titles()).toEqual(['History Quiz']);
    search('zzz');
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Create Quiz/ })).toHaveLength(1);
    search('');
    click('Draft');
    expect(screen.getByRole('button', { name: 'Draft' }).className).toContain('bg-purple-600');
    expect(titles()).toEqual(['History Quiz']);
    click('Published');
    expect(titles()).toEqual(['Cricket Basics']);
    click('Paused');
    expect(titles()).toEqual(['Paused One']);
    click('Scheduled');
    expect(titles()).toEqual(['Later', 'Upcoming Final', 'Science']);
    click('All');
    expect(titles()).toHaveLength(7);
  });

  it('sorts by each column and flips the order', async () => {
    render(<AdminQuizManagementPage />);
    await loaded();
    const [title, status, questions, attempts, created] = headerButtons();
    fireEvent.click(title);
    expect(titles()[0]).toBe('Upcoming Final');
    fireEvent.click(title);
    expect(titles()[0]).toBe('Cricket Basics');
    fireEvent.click(status);
    expect([titles()[0], titles()[6]]).toEqual(['Upcoming Final', 'Cricket Basics']);
    fireEvent.click(questions);
    expect(titles().slice(0, 3)).toEqual(['Cricket Basics', 'History Quiz', 'Upcoming Final']); // History's count comes from stats
    fireEvent.click(attempts);
    expect(titles().slice(0, 2)).toEqual(['Cricket Basics', 'History Quiz']);
    fireEvent.click(created);
    expect(titles()[0]).toBe('Later');
    fireEvent.click(created);
    expect(titles()[0]).toBe('Cricket Basics');
    fireEvent.click(created);
    expect(titles()[0]).toBe('Later');
  });

  it('sorts by questions using the same counts the table shows, from _count or stats', async () => {
    render(<AdminQuizManagementPage />);
    await loaded();
    fireEvent.click(headerButtons()[2]);
    expect(within(row('History Quiz')).getByText('5')).toBeInTheDocument();
    expect(titles().indexOf('History Quiz')).toBeLessThan(titles().indexOf('Upcoming Final')); // 5 questions sorted above 3
  });

  it('paginates long lists with a sliding window of page numbers', async () => {
    vi.stubGlobal('fetch', routes(() => jsonResponse({ quizzes: many(70) })));
    render(<AdminQuizManagementPage />);
    await loaded('Quiz 70');
    expect(screen.getByText('Showing 1 to 10 of 70')).toBeInTheDocument();
    const pages = () => within(pager()).getAllByRole('button').map((b) => b.textContent).filter(Boolean);
    const [prev, next] = [() => within(pager()).getAllByRole('button')[0], () => within(pager()).getAllByRole('button').at(-1)!];
    expect(prev()).toBeDisabled();
    expect(pages()).toEqual(['1', '2', '3', '4', '5']);
    fireEvent.click(within(pager()).getByRole('button', { name: '3' }));
    expect(within(pager()).getByRole('button', { name: '3' }).className).toContain('bg-purple-600');
    expect(pages()).toEqual(['1', '2', '3', '4', '5']);
    fireEvent.click(next());
    expect(pages()).toEqual(['2', '3', '4', '5', '6']);
    fireEvent.click(within(pager()).getByRole('button', { name: '6' }));
    expect(pages()).toEqual(['3', '4', '5', '6', '7']);
    fireEvent.click(within(pager()).getByRole('button', { name: '7' }));
    expect(screen.getByText('Showing 61 to 70 of 70')).toBeInTheDocument();
    expect(next()).toBeDisabled();
    fireEvent.click(prev());
    expect(screen.getByText('Showing 51 to 60 of 70')).toBeInTheDocument();
  });

  it('shows every page number when there are five pages or fewer', async () => {
    vi.stubGlobal('fetch', routes(() => jsonResponse({ quizzes: many(25) })));
    render(<AdminQuizManagementPage />);
    await loaded('Quiz 25');
    expect(within(pager()).getAllByRole('button').map((b) => b.textContent).filter(Boolean)).toEqual(['1', '2', '3']);
  });

  it('steps back to the last page when quizzes disappear from the open one', async () => {
    vi.stubGlobal('fetch', routes(() => jsonResponse({ quizzes: many(11) })));
    render(<AdminQuizManagementPage />);
    await loaded('Quiz 11');
    fireEvent.click(within(pager()).getByRole('button', { name: '2' }));
    expect(titles()).toEqual(['Quiz 01']);
    realtime('DELETE', { old: { id: 'm1' } });
    expect(titles()).toHaveLength(10);
    expect(titles()[0]).toBe('Quiz 11');
    expect(screen.queryByText('Get started by creating your first quiz')).toBeNull();
  });

  it('selects quizzes and deletes them in bulk', async () => {
    h.actions.deleteQuiz.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
    render(<AdminQuizManagementPage />);
    await loaded();
    const [selectAll] = screen.getAllByRole('checkbox');
    const box = (title: string) => within(row(title)).getByRole('checkbox');
    fireEvent.click(box('Science'));
    fireEvent.click(box('Legacy'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(box('Legacy'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    click('Clear Selection');
    expect(screen.queryByText(/selected$/)).toBeNull();

    fireEvent.click(selectAll);
    expect(screen.getByText('7 selected')).toBeInTheDocument();
    expect(selectAll).toBeChecked();
    fireEvent.click(selectAll);
    expect(screen.queryByText(/selected$/)).toBeNull();

    fireEvent.click(box('Science'));
    fireEvent.click(box('Legacy'));
    vi.mocked(confirm).mockReturnValueOnce(false);
    click(/Delete Selected/);
    expect(h.actions.deleteQuiz).not.toHaveBeenCalled();
    click(/Delete Selected/);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Deleted 1 quiz(es)'));
    expect(h.toast.error).toHaveBeenCalledWith('Failed to delete 1 quiz(es)');
    expect(h.actions.deleteQuiz.mock.calls).toEqual([['q3'], ['q6']]);
    expect(screen.queryByText(/selected$/)).toBeNull();

    h.toast.error.mockClear();
    fireEvent.click(box('Science'));
    click(/Delete Selected/);
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Deleted 1 quiz(es)'));
    expect(h.actions.deleteQuiz).toHaveBeenCalledTimes(3);
    expect(h.toast.error).not.toHaveBeenCalled(); // nothing failed, so no failure toast
  });

  it('reports a bulk delete in which every delete failed as a failure', async () => {
    h.actions.deleteQuiz.mockResolvedValue({ success: false, error: 'FK violation' });
    render(<AdminQuizManagementPage />);
    await loaded();
    fireEvent.click(within(row('Science')).getByRole('checkbox'));
    click(/Delete Selected/);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to delete 1 quiz(es)'));
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it('select-all reflects the quizzes on the current page, not the selection count', async () => {
    vi.stubGlobal('fetch', routes(() => jsonResponse({ quizzes: many(20) })));
    render(<AdminQuizManagementPage />);
    await loaded('Quiz 20');
    const selectAll = () => screen.getAllByRole('checkbox')[0];
    fireEvent.click(selectAll());
    fireEvent.click(within(pager()).getByRole('button', { name: '2' }));
    expect(selectAll()).not.toBeChecked();
    expect(within(row('Quiz 01')).getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(selectAll()); // selects page 2
    expect(screen.getByText('10 selected')).toBeInTheDocument();
    expect(selectAll()).toBeChecked();
    expect(within(row('Quiz 01')).getByRole('checkbox')).toBeChecked();
  });

  it('publishes, pushes, pauses and deletes from the action menu', async () => {
    render(<AdminQuizManagementPage />);
    await loaded();
    openMenu('History Quiz');
    expect(screen.getByRole('link', { name: 'Preview' })).toHaveAttribute('href', '/quizzes?openQuiz=q2');
    expect(screen.queryByRole('button', { name: /Notify users/ })).toBeNull();
    click('Publish');
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Done'));
    expect(h.actions.publishQuiz).toHaveBeenCalledWith('q2');
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();

    h.actions.publishQuiz.mockResolvedValueOnce({ success: false, error: 'No questions' });
    openMenu('History Quiz');
    click('Publish');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('No questions'));

    openMenu('Cricket Basics');
    click('Push to live viewers');
    await waitFor(() => expect(h.actions.pushQuizLive).toHaveBeenCalledWith('q1'));
    h.actions.pushQuizLive.mockResolvedValueOnce({ success: false, error: 'Not live' });
    openMenu('Cricket Basics');
    click('Push to live viewers');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Not live'));

    openMenu('Cricket Basics');
    click('Pause');
    await waitFor(() => expect(h.actions.pauseQuiz).toHaveBeenCalledWith('q1'));
    h.actions.pauseQuiz.mockResolvedValueOnce({ success: false, error: 'Already paused' });
    openMenu('Cricket Basics');
    click('Pause');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Already paused'));

    openMenu('Legacy');
    vi.mocked(confirm).mockReturnValueOnce(false);
    click('Delete');
    expect(h.actions.deleteQuiz).not.toHaveBeenCalled();
    click('Delete');
    await waitFor(() => expect(h.actions.deleteQuiz).toHaveBeenCalledWith('q6'));
    h.actions.deleteQuiz.mockResolvedValueOnce({ success: false, error: 'Has attempts' });
    openMenu('Legacy');
    click('Delete');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Has attempts'));
  });

  it('toggles and dismisses the action menu', async () => {
    render(<AdminQuizManagementPage />);
    await loaded();
    openMenu('Science');
    expect(screen.getByRole('button', { name: /Notify users/ })).toBeInTheDocument();
    openMenu('Science');
    expect(screen.queryByRole('button', { name: 'Edit Quiz' })).toBeNull();
    openMenu('Science');
    fireEvent.click(document.querySelector('.fixed.inset-0')!);
    expect(screen.queryByRole('button', { name: 'Edit Quiz' })).toBeNull();
  });

  it('notifies users about upcoming quizzes, re-sending only after confirmation', async () => {
    const notify = h.actions.notifyUpcomingQuiz;
    render(<AdminQuizManagementPage />);
    await loaded();
    const send = () => { openMenu('Upcoming Final'); click(/Notify users/); };

    notify.mockResolvedValueOnce({ success: true, message: 'Notified 40 users' });
    send();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Notified 40 users'));

    notify.mockResolvedValueOnce({ success: false, error: 'Not scheduled' });
    send();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Not scheduled'));

    notify.mockResolvedValueOnce({ success: false, code: 'ALREADY_NOTIFIED', error: 'Already notified' });
    vi.mocked(confirm).mockReturnValueOnce(false);
    send();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledTimes(3);
    expect(h.toast.error).not.toHaveBeenCalledWith('Already notified');

    notify.mockResolvedValueOnce({ success: false, code: 'ALREADY_NOTIFIED' }).mockResolvedValueOnce({ success: true, message: 'Re-sent' });
    send();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Re-sent'));
    expect(notify).toHaveBeenLastCalledWith('q4', true);

    notify.mockResolvedValueOnce({ success: false, code: 'ALREADY_NOTIFIED' }).mockResolvedValueOnce({ success: false, error: 'Mailer down' });
    send();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Mailer down'));
  });

  it('opens the quiz form to create and to edit', async () => {
    const full = {
      quiz: {
        id: 'q1', title: 'Cricket Basics', description: 'Bats', duration: 20, timeUpDuration: 0, passingScore: 60, accessPrice: 0, status: 'active',
        startsAt: '2026-11-01T00:00:00Z', prizeId: 'p1', isBumperPrize: true, quizType: 'live',
        questions: [
          { id: 'x1', text: 'Q1', options: ['A', 'B'], correctOption: 1, status: 'inactive' },
          { id: 'x2', text: 'Q2', options: '["X","Y"]' },
          { id: 'x3', text: 'Q3', options: '' },
        ],
      },
    };
    const details = [jsonResponse(full), jsonResponse({ id: 'q2' })];
    vi.stubGlobal('fetch', (fetchMock = routes(undefined, () => details.shift()!)));
    render(<AdminQuizManagementPage />);
    await loaded();

    click(/Create Quiz/);
    expect(screen.getByRole('heading', { name: 'Create New Quiz' })).toBeInTheDocument();
    expect(screen.getByTestId('initial-data').textContent).toBe('null');
    click('Back to Quizzes');
    await loaded();

    openMenu('Cricket Basics');
    click('Edit Quiz');
    expect(await screen.findByRole('heading', { name: 'Edit Quiz' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/quizzes/q1');
    expect(JSON.parse(screen.getByTestId('initial-data').textContent!)).toEqual({
      id: 'q1', title: 'Cricket Basics', description: 'Bats', duration: 20, timeUpDuration: 0, passingScore: 60, accessPrice: 0, difficulty: 'medium',
      status: 'active', startsAt: '2026-11-01T00:00:00Z', prizeId: 'p1', isBumperPrize: true, quizType: 'live',
      questions: [
        { id: 'x1', text: 'Q1', options: [{ text: 'A', isCorrect: false }, { text: 'B', isCorrect: true }], correctOption: 1, status: 'inactive' },
        { id: 'x2', text: 'Q2', options: [{ text: 'X', isCorrect: false }, { text: 'Y', isCorrect: false }], status: 'active' },
        { id: 'x3', text: 'Q3', options: [], status: 'active' },
      ],
    });
    click('Form cancelled');
    await loaded();

    openMenu('History Quiz');
    click('Edit Quiz');
    await screen.findByRole('heading', { name: 'Edit Quiz' });
    expect(JSON.parse(screen.getByTestId('initial-data').textContent!)).toEqual({
      id: 'q2', title: '', description: '', duration: 30, timeUpDuration: 60, passingScore: 70, accessPrice: 0, difficulty: 'medium',
      status: 'draft', startsAt: null, prizeId: null, isBumperPrize: false, quizType: 'normal', questions: [],
    });
    const listCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/admin/quizzes').length;
    const before = listCalls();
    click('Form saved');
    await loaded();
    expect(listCalls()).toBe(before + 1);
  });

  it('reports a quiz that fails to load for editing', async () => {
    vi.stubGlobal('fetch', routes(undefined, () => jsonResponse({}, 500)));
    render(<AdminQuizManagementPage />);
    await loaded();
    openMenu('Science');
    click('Edit Quiz');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to load quiz details'));
    expect(await screen.findByText('Quiz Management')).toBeInTheDocument();
  });

  it('duplicates a quiz as a draft copy', async () => {
    const details = [
      jsonResponse({ quiz: { title: 'Cricket Basics', description: 'Bats', duration: 20, timeUpDuration: 0, passingScore: 60, accessPrice: 50, prizeId: 'p1', isBumperPrize: true, quizType: 'live',
        questions: [{ text: 'Q1', options: ['A', 'B'], correctOption: 1, status: 'inactive' }, { text: 'Q2', options: '["X"]' }, { text: 'Q3', options: '' }] } }),
      jsonResponse({ title: 'Bare' }),
      jsonResponse({ title: 'Bare' }),
    ];
    vi.stubGlobal('fetch', routes(undefined, () => details.shift()!));
    h.actions.createQuiz
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'Title taken' })
      .mockResolvedValueOnce({ success: false });
    render(<AdminQuizManagementPage />);
    await loaded();
    const reuse = async () => { openMenu('Cricket Basics'); click('Reuse Quiz'); await loaded(); };

    await reuse();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Quiz duplicated and saved to draft!', { id: 'toast-1' }));
    expect(h.toast.loading).toHaveBeenCalledWith('Loading quiz details to copy...');
    expect(h.toast.loading).toHaveBeenCalledWith('Creating duplicated quiz...', { id: 'toast-1' });
    expect(h.actions.createQuiz).toHaveBeenCalledWith({
      title: 'Cricket Basics (Copy)', description: 'Bats', duration: 20, timeUpDuration: 0, passingScore: 60, accessPrice: 50, difficulty: 'medium',
      status: 'draft', startsAt: null, prizeId: 'p1', isBumperPrize: true, quizType: 'live',
      questions: [
        { text: 'Q1', options: [{ text: 'A', isCorrect: false }, { text: 'B', isCorrect: true }], correctOption: 1, status: 'inactive' },
        { text: 'Q2', options: [{ text: 'X', isCorrect: false }], correctOption: 0, status: 'active' },
        { text: 'Q3', options: [], correctOption: 0, status: 'active' },
      ],
    });

    await reuse();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Title taken', { id: 'toast-1' }));
    expect(h.actions.createQuiz).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Bare (Copy)', description: '', duration: 30, timeUpDuration: 60, passingScore: 70, accessPrice: 0, prizeId: null, isBumperPrize: false, quizType: 'normal', questions: [],
    }));
    await reuse();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to duplicate quiz', { id: 'toast-1' }));
  });

  it('replaces the loading toast when a duplicate fails', async () => {
    vi.stubGlobal('fetch', routes(undefined, () => jsonResponse({}, 404)));
    render(<AdminQuizManagementPage />);
    await loaded();
    openMenu('Science');
    click('Reuse Quiz');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('An unexpected error occurred while duplicating', { id: 'toast-1' }));
    expect(h.actions.createQuiz).not.toHaveBeenCalled();
  });

  it('shows the empty state and opens the form from it', async () => {
    vi.stubGlobal('fetch', routes(() => jsonResponse({})));
    render(<AdminQuizManagementPage />);
    expect(await screen.findByText('Get started by creating your first quiz')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /Create Quiz/ })[1]);
    expect(screen.getByRole('heading', { name: 'Create New Quiz' })).toBeInTheDocument();
  });

  it('reports load failures', async () => {
    vi.stubGlobal('fetch', routes(() => jsonResponse({}, 403)));
    const { unmount } = render(<AdminQuizManagementPage />);
    expect(await screen.findByText('Access denied. Admin privileges required.')).toBeInTheDocument();
    expect(h.toast.error).not.toHaveBeenCalled();
    unmount();

    vi.stubGlobal('fetch', routes(() => jsonResponse({}, 500)));
    const second = render(<AdminQuizManagementPage />);
    expect(await screen.findByText('Failed to fetch quizzes')).toBeInTheDocument();
    expect(h.toast.error).toHaveBeenCalledWith('Failed to load quizzes');
    second.unmount();

    vi.stubGlobal('fetch', routes(() => Promise.reject('offline')));
    render(<AdminQuizManagementPage />);
    expect(await screen.findByText('Failed to load quizzes', { selector: 'div' })).toBeInTheDocument();
  });

  it('clears the error banner after a successful refresh', async () => {
    const results = [jsonResponse({}, 500), jsonResponse({ quizzes })];
    vi.stubGlobal('fetch', routes(() => results.shift()!));
    render(<AdminQuizManagementPage />);
    await screen.findByText('Failed to fetch quizzes');
    const refresh = screen.getAllByRole('button', { name: /Create Quiz/ })[0].previousElementSibling as HTMLElement;
    fireEvent.click(refresh);
    await loaded();
    expect(screen.queryByText('Failed to fetch quizzes')).toBeNull();
  });

  it('keeps in sync through realtime events, debouncing refetches', async () => {
    render(<AdminQuizManagementPage />);
    await loaded();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    realtime('INSERT', { new: { title: 'Fresh Quiz' } });
    realtime('UPDATE');
    expect(h.toast.success).toHaveBeenCalledWith('New quiz "Fresh Quiz" added');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(screen.queryByText('Loading quizzes...')).toBeNull(); // silent refetch

    realtime('DELETE', { old: { id: 'q1' } });
    expect(h.toast.info).toHaveBeenCalledWith('A quiz was deleted');
    expect(screen.queryByRole('heading', { name: 'Cricket Basics' })).toBeNull();
  });

  it('cancels a pending refetch and leaves the channel on unmount', async () => {
    const { unmount } = render(<AdminQuizManagementPage />);
    await loaded();
    realtime('UPDATE');
    unmount();
    expect(h.removeChannel).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 700));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
