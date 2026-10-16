import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

import QuestionManagement from '@/components/admin/questions/QuestionManagement';

const apiQuestions = [
  { id: 'q1', quizId: 'z1', text: 'Who won in 1992?', options: '["India","Pakistan"]', correctOption: 1, status: 'active', order: 0 },
  { id: 'q2', quizId: 'z1', text: 'Best bowler?', options: ['Wasim', 'Waqar'], correctOption: null, status: 'paused', order: 1 },
];

let fetchMock: ReturnType<typeof vi.fn>;
const routes = (over: { csrf?: () => Response | Promise<Response>; quiz?: () => Response; write?: (url: string, init: RequestInit) => Response } = {}) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/csrf-token') return over.csrf ? over.csrf() : jsonResponse({ csrfToken: 'tok' });
    if (!init?.method) return over.quiz?.() ?? jsonResponse({ quiz: { questions: apiQuestions } });
    return over.write?.(url, init) ?? jsonResponse({ ok: true });
  });
const writes = () => fetchMock.mock.calls.filter(([, i]) => i?.method);

beforeEach(() => {
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const loaded = () => screen.findByText('Who won in 1992?');
const card = (n: number) => screen.getByText(`Question ${n}`).closest('.glass-card') as HTMLElement;
const dialog = () => screen.getByRole('dialog');
const option = (i: number) => within(dialog()).getByPlaceholderText(`Option ${i}`);
const setText = (v: string) => fireEvent.change(within(dialog()).getByLabelText('Question Text'), { target: { value: v } });
const save = () => fireEvent.click(within(dialog()).getByRole('button', { name: /Add Question|Update Question/ }));
const openAdd = () => fireEvent.click(screen.getAllByRole('button', { name: /Add Question/ })[0]);

describe('QuestionManagement', () => {
  it('loads the quiz questions, parsing JSON option lists', async () => {
    const onChange = vi.fn();
    render(<QuestionManagement quizId="z1" onQuestionsChange={onChange} />);
    expect(screen.getByText('Loading questions...')).toBeInTheDocument();
    await loaded();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/quizzes/z1');
    expect(screen.getByText('Pakistan')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'q1', options: ['India', 'Pakistan'], hasCorrectAnswer: true }),
      expect.objectContaining({ id: 'q2', hasCorrectAnswer: false }),
    ]);
  });

  it('fetches nothing without a quiz, and reports load errors', async () => {
    const { unmount } = render(<QuestionManagement quizId="" />);
    expect(await screen.findByText('No Questions Found')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/admin/quizzes'));
    unmount();
    vi.stubGlobal('fetch', routes({ quiz: () => jsonResponse({}, 500) }));
    const second = render(<QuestionManagement quizId="z1" />);
    expect(await screen.findByText('Failed to fetch quiz questions')).toBeInTheDocument();
    second.unmount();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.includes('quizzes')) throw 'odd'; return jsonResponse({}); }));
    render(<QuestionManagement quizId="z1" />);
    expect(await screen.findByText('An unknown error occurred')).toBeInTheDocument();
  });

  it('treats a quiz without questions as empty', async () => {
    vi.stubGlobal('fetch', routes({ quiz: () => jsonResponse({ quiz: {} }) }));
    render(<QuestionManagement quizId="z1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Add First Question/ }));
    expect(screen.getByText('Add New Question')).toBeInTheDocument();
  });

  it('adds a question with a correct answer', async () => {
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    openAdd();
    setText('  Fastest century?  ');
    fireEvent.change(option(1), { target: { value: 'Afridi' } });
    fireEvent.change(option(2), { target: { value: 'Miller' } });
    fireEvent.click(within(dialog()).getAllByRole('button', { name: 'Set Correct' })[1]);
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [url, init] = writes()[0];
    expect(url).toBe('/api/admin/questions');
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(JSON.parse(init.body)).toEqual({ quizId: 'z1', text: 'Fastest century?', options: ['Afridi', 'Miller'], correctOption: 1 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('adds a question without an answer, dropping a "correct" mark on a blank option', async () => {
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    openAdd();
    setText('Who?');
    fireEvent.change(option(1), { target: { value: 'A' } });
    fireEvent.change(option(2), { target: { value: 'B' } });
    fireEvent.click(within(dialog()).getAllByRole('button', { name: 'Set Correct' })[3]); // blank option D
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ quizId: 'z1', text: 'Who?', options: ['A', 'B'] });
  });

  it('validates the question text and option count', async () => {
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    openAdd();
    save();
    expect(await screen.findByText('Question text is required')).toBeInTheDocument();
    setText('Only one option');
    fireEvent.change(option(1), { target: { value: 'A' } });
    save();
    expect(await screen.findByText('At least 2 options are required')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('keeps what the admin typed in the add form after a validation error', async () => {
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    openAdd();
    setText('Typed carefully');
    fireEvent.change(option(1), { target: { value: 'Only option' } });
    save();
    await screen.findByText('At least 2 options are required');
    expect(within(dialog()).getByLabelText('Question Text')).toHaveValue('Typed carefully');
    expect(option(1)).toHaveValue('Only option');
  });

  it('trims options, so one with surrounding spaces can be marked correct', async () => {
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    openAdd();
    setText('Spaces?');
    fireEvent.change(option(1), { target: { value: ' Padded ' } });
    fireEvent.change(option(3), { target: { value: 'Plain' } });
    fireEvent.change(option(4), { target: { value: 'Plain' } });
    fireEvent.click(within(dialog()).getAllByRole('button', { name: 'Set Correct' })[3]); // the second "Plain", after a blank
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ quizId: 'z1', text: 'Spaces?', options: ['Padded', 'Plain', 'Plain'], correctOption: 2 });
  });

  it('explains create failures from the server', async () => {
    const responses = [
      jsonResponse({ error: 'Duplicate question' }, 409),
      jsonResponse({ details: [{ message: 'Text too short' }, { message: 'Too many options' }] }, 400),
      jsonResponse({}, 400),
      new Response('<html>502</html>', { status: 502 }),
    ];
    vi.stubGlobal('fetch', (fetchMock = routes({ write: () => responses.shift()! })));
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    const attempt = async (message: string) => {
      openAdd();
      setText('Q');
      fireEvent.change(option(1), { target: { value: 'A' } });
      fireEvent.change(option(2), { target: { value: 'B' } });
      save();
      expect(await screen.findByText(message)).toBeInTheDocument();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByText(message)).toBeNull();
    };
    await attempt('Duplicate question');
    await attempt('Text too short, Too many options');
    await attempt('Failed to create question');
    await attempt('Server error occurred');
  });

  it('edits a question, and reports update failures', async () => {
    const responses = [jsonResponse({ ok: true }), jsonResponse({ error: 'Locked' }, 409), jsonResponse({}, 500)];
    vi.stubGlobal('fetch', (fetchMock = routes({ write: () => responses.shift()! })));
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    fireEvent.click(within(card(1)).getAllByRole('button')[0]);
    expect(screen.getByText('Edit Question')).toBeInTheDocument();
    expect(option(2)).toHaveValue('Pakistan');
    setText('Who won the 1992 World Cup?');
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/api/admin/questions/q1');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ text: 'Who won the 1992 World Cup?', options: ['India', 'Pakistan'], correctOption: 1, status: 'active' });

    fireEvent.click(within(card(2)).getAllByRole('button')[0]);
    save();
    expect(await screen.findByText('Locked')).toBeInTheDocument();
    expect(JSON.parse(writes()[1][1].body).correctOption).toBeNull();
    save();
    expect(await screen.findByText('Failed to update question')).toBeInTheDocument();
  });

  it('refuses to save a stored answer that points past the options', async () => {
    const broken = { ...apiQuestions[0], options: ['India', 'Pakistan'], correctOption: 5 };
    vi.stubGlobal('fetch', (fetchMock = routes({ quiz: () => jsonResponse({ quiz: { questions: [broken] } }) })));
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    fireEvent.click(within(card(1)).getAllByRole('button')[0]);
    save();
    expect(await screen.findByText('Invalid correct option selected')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('turns network failures while saving into a message', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ write: () => { throw 'down'; } })));
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    fireEvent.click(within(card(1)).getAllByRole('button')[0]);
    save();
    expect(await screen.findByText('Failed to save question')).toBeInTheDocument();
  });

  it('pauses and resumes questions', async () => {
    const responses: (Response | 'throw')[] = [jsonResponse({ ok: true }), jsonResponse({ ok: true }), jsonResponse({ error: 'Nope' }, 400), 'throw', jsonResponse({}, 500)];
    vi.stubGlobal('fetch', (fetchMock = routes({ write: () => { const r = responses.shift()!; if (r === 'throw') throw 'down'; return r; } })));
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    const toggle = (n: number) => fireEvent.click(within(card(n)).getAllByRole('button')[1]);
    toggle(1);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ status: 'paused' });
    await screen.findByText('Question 2');
    toggle(2);
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(JSON.parse(writes()[1][1].body)).toEqual({ status: 'active' });
    await screen.findByText('Question 1');
    toggle(1);
    expect(await screen.findByText('Nope')).toBeInTheDocument();
    toggle(1); // a non-Error throw
    expect(await screen.findByText('Failed to update question status')).toBeInTheDocument();
    toggle(1);
    await waitFor(() => expect(writes()).toHaveLength(5));
    expect(await screen.findByText('Failed to update question status')).toBeInTheDocument();
  });

  it('deletes after confirmation, and reports delete failures', async () => {
    const responses: (Response | 'throw')[] = [jsonResponse({ ok: true }), jsonResponse({ error: 'Has answers' }, 409), 'throw', jsonResponse({}, 500)];
    vi.stubGlobal('fetch', (fetchMock = routes({ write: () => { const r = responses.shift()!; if (r === 'throw') throw 'down'; return r; } })));
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    const del = () => fireEvent.click(within(card(1)).getAllByRole('button')[2]);
    del();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    del();
    fireEvent.click(within(dialog()).getByRole('button', { name: /Delete Question/ }));
    await waitFor(() => expect(writes()[0][1].method).toBe('DELETE'));
    expect(writes()[0][0]).toBe('/api/admin/questions/q1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    del();
    fireEvent.click(within(dialog()).getByRole('button', { name: /Delete Question/ }));
    expect(await screen.findByText('Has answers')).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: /Delete Question/ })); // a non-Error throw
    expect(await screen.findByText('Failed to delete question')).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: /Delete Question/ }));
    await waitFor(() => expect(writes()).toHaveLength(4));
    expect(await screen.findByText('Failed to delete question')).toBeInTheDocument();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses to write without a CSRF token', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ csrf: () => jsonResponse({}, 500) })));
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    fireEvent.click(within(card(1)).getAllByRole('button')[1]);
    fireEvent.click(within(card(1)).getAllByRole('button')[2]);
    fireEvent.click(within(dialog()).getByRole('button', { name: /Delete Question/ }));
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(card(1)).getAllByRole('button')[0]);
    save();
    expect(await screen.findByText('CSRF token not available')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('logs a CSRF token request that fails outright', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ csrf: () => Promise.reject(new Error('offline')) })));
    render(<QuestionManagement quizId="z1" />);
    await loaded();
    expect(console.error).toHaveBeenCalledWith('Failed to fetch CSRF token:', expect.any(Error));
  });
});
