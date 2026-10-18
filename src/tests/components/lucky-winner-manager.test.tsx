import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

import LuckyWinnerManager from '@/components/admin/LuckyWinnerManager';

const quizzes = [
  { id: 'q1', title: 'Cricket Cup', status: 'active', prizeId: 'p1', isBumperPrize: false, prize: { id: 'p1', name: 'Bike', description: null, imageUrl: null } },
  { id: 'q2', title: 'Bumper Night', status: 'ended', prizeId: 'p2', isBumperPrize: true, prize: null },
  { id: 'q3', title: 'No prize', status: 'active', prizeId: null, isBumperPrize: false, prize: null },
];
const attempt = (id: string, score: number, name: string | null) => ({ id, userId: `u-${id}`, score, completedAt: '2026-10-01T10:00:00Z', user: name ? { id: `u-${id}`, name, email: `${id}@x.com` } : null });
const board = (over: Record<string, unknown> = {}) => ({
  quiz: quizzes[0], prize: { id: 'p1', name: 'Bike' }, totalAttempts: 5, maxScore: 90, tiedCount: 2,
  tiedTopAttempts: [attempt('a1', 90, 'Ali'), attempt('a2', 90, null)],
  leaderboard: [attempt('a1', 90, 'Ali'), attempt('a2', 90, null), attempt('a3', 80, 'Sara'), attempt('a4', 70, 'Zed')],
  existingWinner: null, winnerAlreadyDrawn: false, ...over,
});
// The shape POST /api/admin/lucky-winner/[quizId]/draw really answers with: a `winners` list
const drawnWinner = { id: 'w1', userId: 'u-a1', name: 'Ali', email: 'a1@x.com', score: 90, completedAt: '2026-10-01T10:00:00Z', selectionMethod: 'random_draw', seed: 'abc123', selectedAt: '2026-10-02T10:00:00Z' };
const drawResult = (over: Record<string, unknown> = {}) => ({
  success: true, message: 'ok',
  winners: [drawnWinner],
  consolation: { points: 0, losersAwarded: 0 },
  draw: { totalAttempts: 5, maxScore: 90, tiedCount: 2, winnerCount: 1, seed: 'abc123' },
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
const routes = (handlers: { list?: () => Response; board?: () => Response; draw?: () => Response } = {}) =>
  vi.fn(async (url: string) => {
    if (url === '/api/admin/quizzes') return handlers.list?.() ?? jsonResponse({ quizzes });
    if (url.endsWith('/draw')) return handlers.draw?.() ?? jsonResponse(drawResult());
    return handlers.board?.() ?? jsonResponse(board());
  });

beforeEach(() => {
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('LuckyWinnerManager', () => {
  it('lists only prize-linked quizzes', async () => {
    render(<LuckyWinnerManager />);
    expect(await screen.findByText('Cricket Cup')).toBeInTheDocument();
    expect(screen.getByText('Bumper')).toBeInTheDocument();
    expect(screen.getByText('Prize: p2', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('No prize')).toBeNull();
  });

  it('shows the empty state and a load error', async () => {
    vi.stubGlobal('fetch', routes({ list: () => jsonResponse({}) }));
    const { unmount } = render(<LuckyWinnerManager />);
    expect(await screen.findByText('No prize-linked quizzes found.')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', routes({ list: () => jsonResponse({}, 500) }));
    render(<LuckyWinnerManager />);
    expect(await screen.findByText('Failed to load quizzes')).toBeInTheDocument();
  });

  it('walks through leaderboard, confirmation and a fair draw', async () => {
    render(<LuckyWinnerManager />);
    fireEvent.click(await screen.findByText('Cricket Cup'));
    expect(await screen.findByText('2 candidates tied at 90 points — a random draw will select one.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/lucky-winner/q1');
    expect(screen.getAllByText('u-a2').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Run Fair Draw \(2 candidates\)/ }));
    expect(screen.getByText('Confirm Draw')).toBeInTheDocument();
    expect(screen.getByText('Fair random draw from 2 tied candidates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    fireEvent.click(screen.getByRole('button', { name: /Run Fair Draw/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Draw Winner/ }));
    expect(await screen.findByText('🎉 Winner Selected!')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/lucky-winner/q1/draw', { method: 'POST' });
    expect(screen.getByText('Fair random draw from tied candidates')).toBeInTheDocument();
    expect(screen.getByText('Seed: abc123')).toBeInTheDocument();
    expect(screen.getByText('Ali', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/Tied at top score \(90\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Draw for another quiz/ }));
    expect(await screen.findByText('Select a Prize-Linked Quiz')).toBeInTheDocument();
  });

  it('confirms a single top scorer without a draw', async () => {
    vi.stubGlobal('fetch', routes({
      board: () => jsonResponse(board({ tiedCount: 1, prize: null, tiedTopAttempts: [attempt('a1', 90, 'Ali')] })),
      draw: () => jsonResponse(drawResult({ winners: [{ ...drawnWinner, email: undefined, selectionMethod: 'auto_single_winner' }], draw: { ...drawResult().draw, tiedCount: 1 } })),
    }));
    render(<LuckyWinnerManager />);
    fireEvent.click(await screen.findByText('Cricket Cup'));
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/candidates tied/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Single Winner/ }));
    expect(screen.getByText('Auto (single top scorer)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Draw Winner/ }));
    expect(await screen.findByText('Single top scorer — no draw needed')).toBeInTheDocument();
  });

  it('reports a draw that answered without a winner instead of crashing', async () => {
    const drawRes = vi.fn()
      .mockReturnValueOnce(jsonResponse(drawResult({ winners: [] })))
      .mockReturnValueOnce(jsonResponse({ success: true, message: 'ok', draw: drawResult().draw }));
    vi.stubGlobal('fetch', routes({ draw: drawRes }));
    render(<LuckyWinnerManager />);
    fireEvent.click(await screen.findByText('Cricket Cup'));
    fireEvent.click(await screen.findByRole('button', { name: /Run Fair Draw/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Draw Winner/ }));
    const noWinner = 'The draw finished but returned no winner. Reload the quiz to see it.';
    expect(await screen.findByText(noWinner)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Draw Winner/ }));
    await waitFor(() => expect(drawRes).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(noWinner)).toBeInTheDocument();
    expect(screen.queryByText('🎉 Winner Selected!')).toBeNull();
  });

  it('jumps straight to the result when a winner was already drawn', async () => {
    const existingWinner = { id: 'w9', userId: 'u9', score: 88, selectionMethod: 'random_draw', seed: 'seed9', selectedAt: '2026-09-01T00:00:00Z', selectedBy: 'admin', user: null };
    vi.stubGlobal('fetch', routes({ board: () => jsonResponse(board({ winnerAlreadyDrawn: true, existingWinner })) }));
    render(<LuckyWinnerManager />);
    fireEvent.click(await screen.findByText('Bumper Night'));
    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Seed: seed9')).toBeInTheDocument();
  });

  it('shows the existing winner with their details', async () => {
    const existingWinner = { id: 'w9', userId: 'u9', score: 88, selectionMethod: 'random_draw', seed: 's', selectedAt: '2026-09-01T00:00:00Z', selectedBy: null, user: { id: 'u9', name: 'Hina', email: 'hina@x.com' } };
    vi.stubGlobal('fetch', routes({ board: () => jsonResponse(board({ winnerAlreadyDrawn: true, existingWinner })) }));
    render(<LuckyWinnerManager />);
    fireEvent.click(await screen.findByText('Cricket Cup'));
    expect(await screen.findByText('Hina')).toBeInTheDocument();
    expect(screen.getByText('hina@x.com')).toBeInTheDocument();
  });

  it('reports leaderboard and draw failures, and blocks a draw with no attempts', async () => {
    const boardRes = vi.fn()
      .mockReturnValueOnce(jsonResponse({ error: 'Quiz not found' }, 404))
      .mockReturnValueOnce(jsonResponse({}, 500))
      .mockReturnValue(jsonResponse(board({ totalAttempts: 0 })));
    const drawRes = vi.fn().mockReturnValueOnce(jsonResponse({ error: 'Already drawn' }, 409)).mockReturnValueOnce(jsonResponse({}, 500));
    vi.stubGlobal('fetch', routes({ board: boardRes, draw: drawRes }));
    render(<LuckyWinnerManager />);
    fireEvent.click(await screen.findByText('Cricket Cup'));
    expect(await screen.findByText('Quiz not found')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cricket Cup'));
    expect(await screen.findByText('Failed to load leaderboard')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cricket Cup'));
    const run = await screen.findByRole('button', { name: /Run Fair Draw/ });
    expect(run).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    boardRes.mockReturnValue(jsonResponse(board()));
    fireEvent.click(await screen.findByText('Cricket Cup'));
    fireEvent.click(await screen.findByRole('button', { name: /Run Fair Draw/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Draw Winner/ }));
    expect(await screen.findByText('Already drawn')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Draw Winner/ }));
    expect(await screen.findByText('Draw failed')).toBeInTheDocument();
  });

  it('turns non-Error failures into generic messages', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/admin/quizzes') return jsonResponse({ quizzes });
      call += 1;
      if (call === 1) throw 'odd';
      if (url.endsWith('/draw')) throw 'odd';
      return jsonResponse(board());
    }));
    render(<LuckyWinnerManager />);
    fireEvent.click(await screen.findByText('Cricket Cup'));
    expect(await screen.findByText('Failed to load')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cricket Cup'));
    fireEvent.click(await screen.findByRole('button', { name: /Run Fair Draw/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Draw Winner/ }));
    expect(await screen.findByText('Draw failed. Please try again.')).toBeInTheDocument();
  });

  it('shows a spinner while drawing', async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', routes({ draw: () => new Promise<Response>((r) => (release = r)) as unknown as Response }));
    render(<LuckyWinnerManager />);
    fireEvent.click(await screen.findByText('Cricket Cup'));
    fireEvent.click(await screen.findByRole('button', { name: /Run Fair Draw/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Draw Winner/ }));
    expect(await screen.findByRole('button', { name: /Drawing/ })).toBeDisabled();
    release(jsonResponse(drawResult()));
    expect(await screen.findByText('🎉 Winner Selected!')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Drawing/ })).toBeNull());
  });
});
