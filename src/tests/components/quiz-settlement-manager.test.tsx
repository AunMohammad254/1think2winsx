import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({ getCSRFToken: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.getCSRFToken() }));

import QuizSettlementManager from '@/components/admin/QuizSettlementManager';
import { WinnersTable } from '@/components/quiz-settlement/WinnersTable';
import { toRewards } from '@/components/quiz-settlement/RewardsEditor';

const summary = (id: string, stage: string, over: Record<string, unknown> = {}) => ({
  id, title: `Quiz ${id}`, status: 'active', quizType: 'predictable', pushedAt: null as string | null, duration: 10,
  closesAt: null as string | null, totalQuestions: 2, questionsWithResult: 0, attempts: 3, maxEntries: 2000, pointsPool: 0, settledAt: null as string | null, stage, ...over,
});
const QUIZZES = [
  summary('open', 'open', { closesAt: '2026-10-19T12:10:30.000Z' }),
  summary('nolimit', 'open', { totalQuestions: 1, attempts: 1 }),
  summary('await', 'awaiting_result', { closesAt: '2026-10-19T10:10:30.000Z' }),
  summary('ready', 'ready_to_settle', { questionsWithResult: 2 }),
  summary('settled', 'settled', { settledAt: '2026-10-19T11:00:00Z' }),
  summary('soon', 'upcoming'),
];
const PRIZES = [
  { id: 'p-bumper', name: 'Mystery bike', category: 'bumper', stock: 1, imageUrl: null },
  { id: 'p-watch', name: 'Smartwatch', category: 'electronics', stock: 2, imageUrl: null },
  { id: 'p-gone', name: 'Phone', category: 'electronics', stock: 0, imageUrl: null },
];
const QUESTIONS = [
  { id: 'a', text: 'Next ball?', options: ['Four', 'Six'], correctOption: null },
  { id: 'b', text: 'Wicket?', options: ['Yes', 'No'], correctOption: null },
];
const answered = [{ ...QUESTIONS[0], correctOption: 1 }, { ...QUESTIONS[1], correctOption: 0 }];
const detailOf = (quiz: ReturnType<typeof summary>, extra: Record<string, unknown> = {}) => ({
  quiz, questions: quiz.stage === 'ready_to_settle' ? answered : QUESTIONS, settlement: null, ...extra,
});
const winner = (rank: number, over: Record<string, unknown> = {}) => ({
  rank, userId: `u${rank}`, name: `Player ${rank}`, email: `p${rank}@x.test`, score: 100 - rank * 10, tiedWith: 0,
  selectionMethod: 'ranked', points: null, prizeId: null, prizeName: null, prizeCategory: null, ...over,
});
const SEED = 'a'.repeat(32);
const NO_POOL = { percent: 0, poolSize: 0, target: 0, places: 0, paid: 0, eligible: 2, recipients: 0, min: 0, max: 0 };
const previewResult = (over: Record<string, unknown> = {}) => ({
  success: true, preview: true, quizId: 'ready', quizTitle: 'Quiz ready', participants: 4, questions: 2, tieRule: 'random', seed: SEED,
  winners: [winner(1, { points: 500 }), winner(2, { prizeId: 'p-bumper', prizeName: 'Mystery bike', prizeCategory: 'bumper', selectionMethod: 'ranked_random_tiebreak', tiedWith: 1 })],
  unfilled: [3], pool: NO_POOL, ...over,
});
const NO_POOL_SETTLED = { percent: 0, points: 0, recipients: 0 };

type Handler = (body: any) => Response | Promise<Response>;
let details: Record<string, unknown>;
let onResult: Handler;
let onPreview: Handler;
let onSettle: Handler;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.getCSRFToken.mockReset().mockResolvedValue('tok');
  details = Object.fromEntries(QUIZZES.map((q) => [q.id, detailOf(q)]));
  onResult = () => jsonResponse({ ok: true });
  onPreview = () => jsonResponse({ result: previewResult() });
  onSettle = () => jsonResponse({ result: previewResult({ preview: undefined }), notified: true });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url === '/api/admin/quiz-settlement' && !init) return jsonResponse({ quizzes: QUIZZES, prizes: PRIZES });
    if (url.startsWith('/api/admin/quiz-settlement?quizId=')) {
      const id = decodeURIComponent(url.split('=')[1]);
      return details[id] ? jsonResponse(details[id]) : jsonResponse({ error: 'Quiz not found' }, 404);
    }
    if (url === '/api/admin/quiz-settlement/result') return onResult(body);
    if (url === '/api/admin/quiz-settlement/preview') return onPreview(body);
    if (url === '/api/admin/quiz-settlement') return onSettle(body);
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const posts = (url: string) => fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === 'POST');
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const quizCard = async (title: string) => within(await screen.findByRole('region', { name: 'Quizzes' })).findByRole('button', { name: new RegExp(title) });
const panel = () => screen.getByRole('region', { name: 'Selected quiz' });
async function open(title: string) {
  render(<QuizSettlementManager />);
  fireEvent.click(await quizCard(title));
  return screen.findByRole('region', { name: 'Selected quiz' });
}

describe('quiz list', () => {
  it('shows each quiz with its stage, and filters by stage', async () => {
    render(<QuizSettlementManager />);
    expect(screen.getByText('Loading quizzes…')).toBeInTheDocument();
    const list = await screen.findByRole('region', { name: 'Quizzes' });
    expect(within(list).getAllByRole('button')).toHaveLength(6);
    expect(within(list).getByRole('button', { name: /Quiz nolimit.*1 question · 1 \/ 2,000 players/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Quiz open.*2 questions · 3 \/ 2,000 players/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open (2)' }));
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Settled (1)' }));
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Quiz settled')]);
    expect(screen.getByRole('button', { name: 'Settled (1)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'All (6)' }));
    expect(within(list).getAllByRole('button')).toHaveLength(6);
  });

  it('says when a filter is empty, and when the list cannot load', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ quizzes: [QUIZZES[5]], prizes: [] }));
    const { unmount } = render(<QuizSettlementManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ready to settle (0)' }));
    expect(screen.getByText('No quizzes here.')).toBeInTheDocument();
    unmount();

    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'Admin only' }, 401));
    const second = render(<QuizSettlementManager />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Admin only');
    second.unmount();

    fetchMock.mockImplementationOnce(async () => jsonResponse({}, 500));
    const third = render(<QuizSettlementManager />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load quizzes');
    third.unmount();

    fetchMock.mockImplementationOnce(async () => { throw 'offline'; });
    const fourth = render(<QuizSettlementManager />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load quizzes');
    fourth.unmount();

    // A proxy error page instead of JSON
    fetchMock.mockImplementationOnce(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    render(<QuizSettlementManager />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load quizzes');
  });
});

describe('an open quiz', () => {
  it('can be ended now by saving its result, after a warning', async () => {
    details.open = detailOf(QUIZZES[0]);
    const section = await open('Quiz open');
    expect(within(section).getByText(/answering closes/)).toBeInTheDocument();
    expect(within(section).getByText('Players can still answer.')).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: 'End quiz now and enter the result' }));
    const save = within(section).getByRole('button', { name: 'Save result' });
    expect(save).toBeDisabled();
    fireEvent.click(within(section).getByRole('radio', { name: 'Six' }));
    fireEvent.click(within(section).getByRole('radio', { name: 'Yes' }));
    expect(within(section).getByRole('radio', { name: '✓ Six' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(save);
    const confirm = within(section).getByRole('alertdialog', { name: 'Confirm result' });
    expect(confirm).toHaveTextContent('This ends the quiz now');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Back' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Save result' }));

    details.open = detailOf({ ...QUIZZES[0], stage: 'ready_to_settle', questionsWithResult: 2 });
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, save the result' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Result saved. The quiz is ready to settle.');
    expect(bodyOf(posts('/api/admin/quiz-settlement/result')[0])).toEqual({ quizId: 'open', answers: { a: 1, b: 0 }, endNow: true });
    expect(posts('/api/admin/quiz-settlement/result')[0][1].headers).toMatchObject({ 'X-CSRF-Token': 'tok' });
    expect(await within(panel()).findByRole('heading', { name: 'Rewards' })).toBeInTheDocument();
  });

  it('can be left open, and says when it has no time limit', async () => {
    const section = await open('Quiz nolimit');
    expect(within(section).getByText('Players can still answer: this quiz has no time limit.')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'End quiz now and enter the result' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Cancel' }));
    expect(within(section).queryByRole('button', { name: 'Save result' })).toBeNull();
  });
});

describe('a quiz awaiting its result', () => {
  it('reports a refused save and allows another try', async () => {
    onResult = () => jsonResponse({ error: 'This quiz has already been settled' }, 409);
    const section = await open('Quiz await');
    expect(within(section).getByText(/answering closed/)).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('radio', { name: 'Four' }));
    fireEvent.click(within(section).getByRole('radio', { name: 'No' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Save result' }));
    expect(within(section).getByRole('alertdialog')).toHaveTextContent('Players can no longer answer these questions once the result is saved.');
    // Changing an answer withdraws the confirmation
    fireEvent.click(within(section).getByRole('radio', { name: 'Yes' }));
    expect(within(section).queryByRole('alertdialog')).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Save result' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, save the result' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This quiz has already been settled');

    onResult = () => { throw 'offline'; };
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, save the result' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to save the result'));

    // A proxy error page instead of JSON
    onResult = () => new Response('<html>Bad gateway</html>', { status: 502 });
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, save the result' }));
    await waitFor(() => expect(posts('/api/admin/quiz-settlement/result')).toHaveLength(3));
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save the result');
  });
});

describe('a quiz ready to settle', () => {
  it('previews the winners, then settles exactly that once', async () => {
    h.getCSRFToken.mockResolvedValue(null);
    const section = await open('Quiz ready');
    expect(within(section).getByText('→ Six')).toBeInTheDocument();
    expect(within(section).getByText('→ Yes')).toBeInTheDocument();

    // A reward needs its details
    fireEvent.change(within(section).getByRole('combobox', { name: '1st place reward type' }), { target: { value: 'points' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1st place: enter 1 to 100,000 points');
    fireEvent.change(within(section).getByRole('spinbutton', { name: '1st place points' }), { target: { value: '500' } });
    fireEvent.change(within(section).getByRole('combobox', { name: '2nd place reward type' }), { target: { value: 'prize' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('2nd place: choose a prize');

    const prizeSelect = within(section).getByRole('combobox', { name: '2nd place prize' });
    expect(within(prizeSelect).getByRole('option', { name: 'Phone (out of stock)' })).toBeDisabled();
    expect(prizeSelect.querySelector('optgroup[label^="🎁 Bumper prizes"]')).not.toBeNull();
    fireEvent.change(prizeSelect, { target: { value: 'p-bumper' } });

    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    expect(await within(section).findByRole('heading', { name: 'Preview: 4 players' })).toBeInTheDocument();
    expect(bodyOf(posts('/api/admin/quiz-settlement/preview')[0])).toEqual({
      quizId: 'ready', rewards: [{ rank: 1, points: 500 }, { rank: 2, prizeId: 'p-bumper' }], tieRule: 'random', poolPercent: 0,
    });
    expect(posts('/api/admin/quiz-settlement/preview')[0][1].headers).toMatchObject({ 'X-CSRF-Token': '' });
    expect(within(section).getByText('500 points')).toBeInTheDocument();
    expect(within(section).getByText('won a tie by random draw (tied with 1)')).toBeInTheDocument();
    expect(within(section).getByText(/No player scored high enough/)).toBeInTheDocument();

    // Changing anything asks for a new preview, which keeps the same draw seed
    fireEvent.click(within(section).getByRole('radio', { name: /Earliest submission/ }));
    expect(within(section).getByText('The rewards changed since this preview. Preview again before settling.')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Settle quiz' })).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    await waitFor(() => expect(posts('/api/admin/quiz-settlement/preview')).toHaveLength(2));
    expect(bodyOf(posts('/api/admin/quiz-settlement/preview')[1])).toMatchObject({ tieRule: 'earliest', seed: SEED });

    fireEvent.click(await within(section).findByRole('button', { name: 'Settle quiz' }));
    const confirm = within(section).getByRole('alertdialog', { name: 'Confirm settlement' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Back' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Settle quiz' }));

    details.ready = detailOf({ ...QUIZZES[3], stage: 'settled', settledAt: '2026-10-19T12:30:00Z' }, {
      settlement: { settledAt: '2026-10-19T12:30:00Z', settledBy: 'admin@x', tieRule: 'earliest', seed: SEED, winners: [winner(1, { points: 500 })], pool: NO_POOL_SETTLED },
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, settle now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Settled: 2 winners paid. Players have been notified.');
    expect(bodyOf(posts('/api/admin/quiz-settlement')[0])).toEqual({
      quizId: 'ready', rewards: [{ rank: 1, points: 500 }, { rank: 2, prizeId: 'p-bumper' }], tieRule: 'earliest', seed: SEED, poolPercent: 0,
    });
    expect(await within(panel()).findByText(/Settled .* by admin@x · ties: Earliest submission/)).toBeInTheDocument();
  });

  it('says when notifying failed, and reports preview and settle errors', async () => {
    onSettle = () => jsonResponse({ result: previewResult({ winners: [winner(1, { points: 5 })] }), notified: false });
    const section = await open('Quiz ready');
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    fireEvent.click(await within(section).findByRole('button', { name: 'Settle quiz' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, settle now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Settled: 1 winner paid. Notifying players failed, but the rewards are paid.');

    onPreview = () => jsonResponse({ error: 'Smartwatch is out of stock' }, 409);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Preview winners' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Smartwatch is out of stock');
    onPreview = () => { throw 'offline'; };
    fireEvent.click(within(panel()).getByRole('button', { name: 'Preview winners' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to preview the winners'));

    onPreview = () => jsonResponse({ result: previewResult({ participants: 1, winners: [], unfilled: [] }) });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Preview winners' }));
    expect(await within(panel()).findByRole('heading', { name: 'Preview: 1 player' })).toBeInTheDocument();
    expect(within(panel()).getByText('No rewards were set for this quiz.')).toBeInTheDocument();
    onSettle = () => jsonResponse({ error: 'This quiz has already been settled' }, 409);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Settle quiz' }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Yes, settle now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This quiz has already been settled');
    onSettle = () => { throw 'offline'; };
    fireEvent.click(within(panel()).getByRole('button', { name: 'Yes, settle now' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to settle the quiz'));
  });

  it('lets the result be edited before settling', async () => {
    const section = await open('Quiz ready');
    fireEvent.click(within(section).getByRole('button', { name: 'Edit result' }));
    expect(within(section).getByRole('radio', { name: '✓ Six' })).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Cancel' }));
    expect(within(section).getByRole('heading', { name: 'Rewards' })).toBeInTheDocument();
  });
});

describe('settled and upcoming quizzes', () => {
  it('shows who won what, how ties were broken, and the draw seed', async () => {
    details.settled = detailOf(QUIZZES[4], {
      settlement: {
        settledAt: '2026-10-19T11:00:00Z', settledBy: 'admin@x', tieRule: 'random', seed: SEED,
        winners: [
          winner(1, { prizeId: 'p-bumper', prizeName: 'Mystery bike', prizeCategory: 'bumper' }),
          winner(2, { prizeId: 'p-watch', prizeName: 'Smartwatch', prizeCategory: 'electronics', selectionMethod: 'ranked_earliest_tiebreak', email: null, name: null }),
          winner(3, { points: 100, selectionMethod: 'random_draw' }),
        ],
        pool: NO_POOL_SETTLED,
      },
    });
    const section = await open('Quiz settled');
    expect(within(section).getByText(/ties: Fair random draw/)).toBeInTheDocument();
    expect(within(section).getByText(/🎁/).textContent).toContain('Mystery bike');
    expect(within(section).getByText(/🏆/).textContent).toContain('Smartwatch');
    expect(within(section).getByText('won a tie by answering first')).toBeInTheDocument();
    expect(within(section).getByText('lucky draw')).toBeInTheDocument();
    // The column header and the fallback name of the winner without one
    expect(within(section).getAllByText('Player')).toHaveLength(2);
    expect(within(section).getByText(`Draw seed: ${SEED}`)).toBeInTheDocument();
  });

  it('names an unknown tie rule as it is, and hides an empty seed', async () => {
    details.settled = detailOf(QUIZZES[4], { settlement: { settledAt: '2026-10-19T11:00:00Z', settledBy: 'admin', tieRule: 'odd', seed: '', winners: [], pool: NO_POOL_SETTLED } });
    const section = await open('Quiz settled');
    expect(within(section).getByText(/ties: odd/)).toBeInTheDocument();
    expect(within(section).queryByText(/Draw seed/)).toBeNull();
  });

  it('cannot settle a quiz before it runs', async () => {
    const section = await open('Quiz soon');
    expect(within(section).getByText("This quiz hasn't started yet. You can settle it after it has run.")).toBeInTheDocument();
  });
});

describe('loading a quiz', () => {
  it('shows progress, does not reload the open quiz, and reports failures', async () => {
    render(<QuizSettlementManager />);
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { release = r; }));
    fireEvent.click(await quizCard('Quiz await'));
    expect(screen.getByText('Loading the quiz…')).toBeInTheDocument();
    release(jsonResponse(details.await));
    await screen.findByRole('region', { name: 'Selected quiz' });
    const calls = fetchMock.mock.calls.length;
    fireEvent.click(await quizCard('Quiz await'));
    expect(fetchMock.mock.calls.length).toBe(calls);

    delete details.soon;
    fireEvent.click(await quizCard('Quiz soon'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Quiz not found');
    expect(screen.queryByRole('region', { name: 'Selected quiz' })).toBeNull();
    fetchMock.mockImplementationOnce(async () => { throw 'offline'; });
    fireEvent.click(await quizCard('Quiz settled'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load the quiz'));
  });
});

describe('pieces', () => {
  it('turns the reward rows into rewards', () => {
    expect(toRewards([{ kind: 'points', points: '10', prizeId: '' }, { kind: 'none', points: '', prizeId: '' }, { kind: 'prize', points: '', prizeId: 'p' }]))
      .toEqual({ rewards: [{ rank: 1, points: 10 }, { rank: 3, prizeId: 'p' }] });
    expect(toRewards([{ kind: 'points', points: '100001', prizeId: '' }])).toEqual({ error: '1st place: enter 1 to 100,000 points' });
    expect(toRewards([{ kind: 'points', points: '2.5', prizeId: '' }])).toEqual({ error: '1st place: enter 1 to 100,000 points' });
  });

  it('a winners table without winners or empty places says so', () => {
    render(<WinnersTable winners={[]} />);
    expect(screen.getByText('No rewards were set for this quiz.')).toBeInTheDocument();
  });
});

describe('entry limit and points pool', () => {
  const POOL = { poolSize: 50_000, target: 50_000, places: 400, paid: 50_000, eligible: 1800, recipients: 400, min: 1, max: 260 };

  it('shows the entries against the limit, then gives the whole pool to the first players who got in', async () => {
    details.ready = detailOf({ ...QUIZZES[3], attempts: 2000, maxEntries: 2000, pointsPool: 50_000 });
    onPreview = (body) => jsonResponse({ result: previewResult({ participants: 2000, pool: { ...POOL, percent: body.poolPercent } }) });
    onSettle = (body) => jsonResponse({ result: previewResult({ preview: undefined, participants: 2000, pool: { ...POOL, percent: body.poolPercent } }), notified: true });
    const section = await open('Quiz ready');
    expect(within(section).getByText('Entries: 2,000 / 2,000 players · entries closed · points pool 50,000 (only admins see these)')).toBeInTheDocument();
    expect(within(section).getByText('Points pool (50,000 points): who gets it')).toBeInTheDocument();

    // A custom percentage must be above 0, up to 100, with at most two decimals
    fireEvent.click(within(section).getByRole('radio', { name: 'Custom' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Points pool: enter a percentage above 0 and up to 100');
    fireEvent.change(within(section).getByRole('spinbutton', { name: 'Custom percentage of players' }), { target: { value: '12.555' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Points pool: use at most two decimals');
    // Places round up: 0.05 % of 2,000 is one place
    fireEvent.change(within(section).getByRole('spinbutton', { name: 'Custom percentage of players' }), { target: { value: '0.05' } });
    expect(within(section).getByText(/^The first 1 of 2,000 players who got in share 50,000 points at random/)).toBeInTheDocument();
    expect(posts('/api/admin/quiz-settlement/preview')).toHaveLength(0);

    fireEvent.click(within(section).getByRole('radio', { name: 'First 20%' }));
    expect(within(section).getByText("The first 400 of 2,000 players who got in share 50,000 points at random. Players who scored 0 don't take a place.")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    expect(await within(section).findByText(
      '50,000 pool points shared at random among the first 400 players who scored (20% of 2,000 entrants), 1 to 260 points each.')).toBeInTheDocument();
    expect(bodyOf(posts('/api/admin/quiz-settlement/preview')[0])).toMatchObject({ poolPercent: 20 });

    // A different percentage needs a new preview, with the same draw seed
    fireEvent.click(within(section).getByRole('radio', { name: 'First 10%' }));
    expect(within(section).getByText('The rewards changed since this preview. Preview again before settling.')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    await waitFor(() => expect(posts('/api/admin/quiz-settlement/preview')).toHaveLength(2));
    expect(bodyOf(posts('/api/admin/quiz-settlement/preview')[1])).toMatchObject({ poolPercent: 10, seed: SEED });

    fireEvent.click(await within(section).findByRole('button', { name: 'Settle quiz' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, settle now' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Settled: 2 winners paid, and 50,000 pool points shared among 400 players. Players have been notified.');
    expect(bodyOf(posts('/api/admin/quiz-settlement')[0])).toMatchObject({ poolPercent: 10, seed: SEED });
  });

  it('says how to add a pool when a quiz has none, when nobody has got in, and when no entrant scored', async () => {
    onPreview = () => jsonResponse({ result: previewResult({ pool: { ...POOL, percent: 10, paid: 0, recipients: 0 } }) });
    const section = await open('Quiz ready');
    expect(within(section).getByText(/This quiz has no points pool/)).toBeInTheDocument();
    expect(within(section).queryByRole('radiogroup', { name: 'Who gets the points pool' })).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    expect(await within(section).findByText('Points pool (first 10%): no entrant scored, so nothing is shared.')).toBeInTheDocument();
    expect(bodyOf(posts('/api/admin/quiz-settlement/preview')[0])).toMatchObject({ poolPercent: 0 });
  });

  it('reports a settlement from a database without the pool yet as the winners alone', async () => {
    onSettle = () => jsonResponse({ result: previewResult({ preview: undefined, pool: undefined }), notified: true });
    const section = await open('Quiz ready');
    fireEvent.click(within(section).getByRole('button', { name: 'Preview winners' }));
    fireEvent.click(await within(section).findByRole('button', { name: 'Settle quiz' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, settle now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Settled: 2 winners paid. Players have been notified.');
  });

  it('says nobody has got in yet', async () => {
    details.ready = detailOf({ ...QUIZZES[3], attempts: 0, pointsPool: 900 });
    const section = await open('Quiz ready');
    fireEvent.click(within(section).getByRole('radio', { name: 'First 10%' }));
    expect(within(section).getByText('Nobody has got in yet.')).toBeInTheDocument();
  });

  it('shows the pool a settled quiz paid', async () => {
    details.settled = detailOf(QUIZZES[4], {
      settlement: { settledAt: '2026-10-19T11:00:00Z', settledBy: 'admin@x', tieRule: 'random', seed: SEED, winners: [],
        pool: { percent: 12.5, points: 6250, recipients: 250 } },
    });
    const section = await open('Quiz settled');
    expect(within(section).getByText('Points pool (first 12.5% of entrants): 6,250 points shared at random among 250 players.')).toBeInTheDocument();
  });
});
