import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

import QuizManagement from '@/components/admin/QuizManagement';

const quiz = (over: Record<string, unknown> = {}) => ({
  id: 'z1', title: 'Cricket Cup', description: 'Weekend quiz', status: 'paused', isActive: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z',
  questions: [{ id: 'q1', text: 'A', status: 'active' }, { id: 'q2', text: 'B', status: 'active' }], _count: { questions: 2, attempts: 7 }, ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
const routes = (over: { csrf?: () => Response | Promise<Response>; get?: () => Response | Promise<Response>; patch?: () => Response | Promise<Response> } = {}) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/csrf-token') return over.csrf ? over.csrf() : jsonResponse({ csrfToken: 'tok' });
    if (init?.method === 'PATCH') return over.patch ? over.patch() : jsonResponse({ ok: true });
    return over.get ? over.get() : jsonResponse({ quiz: quiz() });
  });
const patches = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PATCH');

beforeEach(() => {
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dialog = () => screen.getByRole('dialog');
const confirm = (name: RegExp) => fireEvent.click(within(dialog()).getByRole('button', { name }));

describe('QuizManagement', () => {
  it('shows the quiz overview and health', async () => {
    const onChange = vi.fn();
    render(<QuizManagement quizId="z1" onQuizChange={onChange} />);
    expect(screen.getByText('Loading quiz details...')).toBeInTheDocument();
    expect(await screen.findByText('Cricket Cup')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('All questions active')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'z1' }));
  });

  it('describes each health state', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ questions: [], _count: undefined, description: '' }, 'No questions added'],
      [{ questions: [{ id: 'q', text: 'x', status: 'paused' }] }, 'No active questions'],
      [{ questions: [{ id: 'q', text: 'x', status: 'paused' }, { id: 'r', text: 'y', status: 'active' }] }, '1 questions paused'],
    ];
    for (const [over, message] of cases) {
      vi.stubGlobal('fetch', routes({ get: () => jsonResponse({ quiz: quiz(over) }) }));
      const { unmount } = render(<QuizManagement quizId="z1" />);
      expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
      unmount();
    }
    vi.stubGlobal('fetch', routes({ get: () => jsonResponse({ quiz: quiz({ questions: [], _count: undefined, description: '' }) }) }));
    render(<QuizManagement quizId="z1" />);
    expect(await screen.findByText('Cannot activate quiz: No questions added', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('No description provided')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Activate Quiz/ })).toBeDisabled();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
  });

  it('shows "unknown" health and a draft badge for a quiz without a question list', async () => {
    vi.stubGlobal('fetch', routes({ get: () => jsonResponse({ quiz: quiz({ status: 'draft', questions: undefined }) }) }));
    render(<QuizManagement quizId="z1" />);
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    vi.stubGlobal('fetch', routes({ get: () => jsonResponse({ quiz: quiz({ status: 'archived' }) }) }));
    render(<QuizManagement quizId="z1" />);
    expect(await screen.findByText('archived')).toBeInTheDocument();
  });

  it('shows why a quiz failed to load', async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => jsonResponse({ error: 'Quiz deleted' }, 404), 'Quiz deleted'],
      [() => jsonResponse({}, 500), 'Failed to fetch quiz'],
      [() => new Response('<html/>', { status: 502, statusText: 'Bad Gateway' }), 'Bad Gateway'],
      [() => new Response('<html/>', { status: 502 }), 'Failed to fetch quiz'],
      [() => { throw 'odd'; }, 'An unknown error occurred'],
    ];
    for (const [get, message] of cases) {
      vi.stubGlobal('fetch', routes({ get }));
      const { unmount } = render(<QuizManagement quizId="z1" />);
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByText('Quiz not found')).toBeNull();
      unmount();
    }
    expect(console.error).toHaveBeenCalledWith('Error fetching quiz:', expect.objectContaining({ message: 'Bad Gateway' }));
    render(<QuizManagement quizId="" />);
    expect(screen.getByText('Quiz not found')).toBeInTheDocument();
    vi.stubGlobal('fetch', routes({ get: () => jsonResponse({}) }));
    const onChange = vi.fn();
    render(<QuizManagement quizId="z1" onQuizChange={onChange} />);
    await waitFor(() => expect(screen.getAllByText('Quiz not found')).toHaveLength(2));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('activates a paused quiz after confirmation, warning about paused questions', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ get: () => jsonResponse({ quiz: quiz({ questions: [{ id: 'q', text: 'x', status: 'paused' }, { id: 'r', text: 'y', status: 'active' }] }) }) })));
    const onChange = vi.fn();
    render(<QuizManagement quizId="z1" onQuizChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: /Activate Quiz/ }));
    expect(within(dialog()).getByText('Warning: 1 questions paused', { exact: false })).toBeInTheDocument();
    confirm(/Activate Quiz/);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(JSON.parse(patches()[0][1].body)).toEqual({ status: 'active' });
    expect(patches()[0][1].headers['X-CSRF-Token']).toBe('tok');
    expect(await screen.findByRole('button', { name: /Pause Quiz/ })).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('pauses an active quiz, or cancels', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ get: () => jsonResponse({ quiz: quiz({ status: 'active' }) }) })));
    render(<QuizManagement quizId="z1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Pause Quiz/ }));
    expect(within(dialog()).getByText(/Users will not be able to take the quiz/)).toBeInTheDocument();
    confirm(/Cancel/);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Pause Quiz/ }));
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Pause Quiz/ }));
    confirm(/Pause Quiz/);
    await waitFor(() => expect(JSON.parse(patches()[0][1].body)).toEqual({ status: 'paused' }));
    expect(await screen.findByRole('button', { name: /Activate Quiz/ })).toBeInTheDocument();
  });

  it('reports update failures and refetches the real state', async () => {
    const patch = vi.fn()
      .mockReturnValueOnce(jsonResponse({ error: 'Needs questions' }, 400))
      .mockReturnValueOnce(jsonResponse({}, 500))
      .mockReturnValueOnce(new Response('x', { status: 503, statusText: 'Unavailable' }))
      .mockReturnValueOnce(new Response('x', { status: 503 }))
      .mockImplementationOnce(() => { throw 'odd'; });
    const get = vi.fn(() => jsonResponse({ quiz: quiz() }));
    vi.stubGlobal('fetch', (fetchMock = routes({ patch, get })));
    render(<QuizManagement quizId="z1" />);
    const attempt = async (message: string) => {
      fireEvent.click(await screen.findByRole('button', { name: /Activate Quiz/ }));
      confirm(/Activate Quiz/);
      expect(await screen.findByText(message)).toBeInTheDocument();
      fireEvent.keyDown(dialog(), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    };
    await attempt('Needs questions');
    await attempt('Failed to update quiz status');
    await attempt('Unavailable');
    await attempt('Failed to update quiz status');
    await attempt('Failed to update quiz status');
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('survives a failed refetch after a failed update', async () => {
    let gets = 0;
    vi.stubGlobal('fetch', (fetchMock = routes({
      patch: () => jsonResponse({}, 500),
      get: () => { gets += 1; if (gets === 1) return jsonResponse({ quiz: quiz() }); if (gets === 2) return jsonResponse({}, 500); throw new Error('offline'); },
    })));
    render(<QuizManagement quizId="z1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Activate Quiz/ }));
    confirm(/Activate Quiz/);
    expect(await screen.findByText('Failed to update quiz status')).toBeInTheDocument();
    confirm(/Activate Quiz/);
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Error refetching quiz after failed update:', expect.any(Error)));
  });

  it('does nothing without a CSRF token', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ csrf: () => jsonResponse({}, 500) })));
    render(<QuizManagement quizId="z1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Activate Quiz/ }));
    confirm(/Activate Quiz/);
    expect(patches()).toHaveLength(0);
    vi.stubGlobal('fetch', routes({ csrf: () => Promise.reject(new Error('offline')) }));
    render(<QuizManagement quizId="z1" />);
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to fetch CSRF token:', expect.any(Error)));
  });
});
