import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import type { MatchView } from '@/lib/match-service';

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() }, push: vi.fn() }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({ 'X-CSRF-Token': 'tok' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));

import MatchList from '@/components/admin/matches/MatchList';
import MatchConsole, { countdown } from '@/components/admin/matches/MatchConsole';

let fetchMock: ReturnType<typeof vi.fn>;
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => ({ url, body: JSON.parse(init.body) }));

beforeEach(() => {
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.push.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MatchList', () => {
  const MATCHES = [
    { id: 'm1', quizId: 'q1', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 20, status: 'live', createdAt: '2026-10-29T10:00:00Z' },
    { id: 'm2', quizId: 'q2', teamA: 'Quetta', teamB: 'Multan', oversPerInnings: 10, status: 'completed', createdAt: '2026-10-28T10:00:00Z' },
  ];

  it('lists the matches with their state, each opening its console', async () => {
    fetchMock = vi.fn(async () => jsonResponse({ matches: MATCHES }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchList />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('Lahore vs Karachi')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Finished')).toBeInTheDocument();
    expect(screen.getByText('Lahore vs Karachi').closest('a')).toHaveAttribute('href', '/admin/matches/m1');
  });

  it('says when there are none, or when they could not be loaded', async () => {
    fetchMock = vi.fn(async () => jsonResponse({ matches: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<MatchList />);
    expect(await screen.findByText('No matches yet.')).toBeInTheDocument();
    unmount();
    fetchMock = vi.fn(async () => jsonResponse({ error: 'down' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchList />);
    expect(await screen.findByText('No matches yet.')).toBeInTheDocument();
    expect(h.toast.error).toHaveBeenCalledWith('Failed to load the matches');
  });

  it('creates a match and opens its console', async () => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? jsonResponse({ matchId: 'm9', quizId: 'q9' }, 201) : jsonResponse({ matches: [] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchList />);
    await screen.findByText('No matches yet.');
    fireEvent.change(screen.getByLabelText('Team A'), { target: { value: 'Islamabad United' } });
    fireEvent.change(screen.getByLabelText('Team B'), { target: { value: 'Peshawar Zalmi' } });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Questions per over'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create match' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/admin/matches/m9'));
    expect(posts()).toEqual([{ url: '/api/admin/matches', body: { teamA: 'Islamabad United', teamB: 'Peshawar Zalmi', oversPerInnings: 10, questionsPerOver: 3 } }]);
    expect(fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')![1].headers).toMatchObject({ 'X-CSRF-Token': 'tok' });
    expect(h.toast.success).toHaveBeenCalledWith('Match created');
  });

  it('shows why a match could not be created', async () => {
    let answer: () => Promise<Response> = async () => jsonResponse({ error: 'The two teams need different names' }, 400);
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? answer() : jsonResponse({ matches: [] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchList />);
    await screen.findByText('No matches yet.');
    const create = () => fireEvent.submit(screen.getByRole('form', { name: 'New match' }));
    create();
    expect(await screen.findByRole('alert')).toHaveTextContent('The two teams need different names');
    answer = async () => jsonResponse({}, 500);
    create();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to create the match'));
    answer = async () => { throw new Error('offline'); };
    create();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Check your connection/));
    expect(h.push).not.toHaveBeenCalled();
  });
});

describe('countdown', () => {
  it('shows minutes and seconds left, never below zero', () => {
    expect([countdown(83_000), countdown(59_001), countdown(-5)]).toEqual(['1:23', '1:00', '0:00']);
  });
});

describe('MatchConsole', () => {
  const inFuture = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
  const question = (over: Partial<MatchView['questions'][number]> = {}) => ({
    id: 'q', innings: 1 as const, over: 3, text: 'Will a wicket fall in over 3?', options: ['Yes', 'No'], market: 'wicket_in_over',
    state: 'open' as const, closesAt: inFuture(60), correctOption: null, reopenable: false, ...over,
  });
  // Scorecard labels as deliveries: '4' is 4 off the bat, 'W' a wicket with no run
  const deliveries = (prefix: string, labels: string[]) => labels.map((label, i) => ({
    id: `${prefix}${i + 1}`, label, runs: Number.parseInt(label, 10) || 0, extra: 'none' as const, wicket: label.includes('W'),
  }));
  const view = (over: Partial<MatchView> = {}, match: Partial<MatchView['match']> = {}): MatchView => ({
    match: {
      id: 'm1', quizId: 'quiz1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 20, questionsPerOver: 2,
      firstWindowSeconds: 120, lockFallbackSeconds: 150, status: 'live', version: 3, ...match,
    },
    settled: false,
    innings: [{
      innings: 1, battingTeam: 'Lahore', endReason: null, runs: 12, wickets: 1, oversText: '1.3', target: null,
      overs: [
        { number: 1, runs: 7, wickets: 0, complete: true, balls: deliveries('o1b', ['1', '4', '0', '1', '1', '0']) },
        { number: 2, runs: 5, wickets: 1, complete: false, balls: deliveries('o2b', ['4', 'W', '1']) },
      ],
    }],
    questions: [],
    serverNow: new Date().toISOString(),
    ...over,
  });

  function serve(first: MatchView, onPost: (body: { version: number; event: Record<string, unknown> }) => Response | Promise<Response> = () => jsonResponse(first)) {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? onPost(JSON.parse(init.body as string)) : jsonResponse(first)));
    vi.stubGlobal('fetch', fetchMock);
  }
  const lastEvent = () => posts().at(-1)!.body;

  it('shows the score and this over, loading first', async () => {
    serve(view({ innings: [{ ...view().innings[0] }, { innings: 2, battingTeam: 'Karachi', endReason: null, runs: 3, wickets: 0, oversText: '0.2', target: 13, overs: [] }] }, { questionsPerOver: 1 }));
    render(<MatchConsole matchId="m1" />);
    expect(screen.getByText('Loading the match…')).toBeInTheDocument();
    expect(await screen.findByText('Lahore vs Karachi')).toBeInTheDocument();
    expect(screen.getByText(/T20 · 1 question an over · free entry/)).toBeInTheDocument();
    expect(screen.getByText('(0.2 overs, target 13)')).toBeInTheDocument();
    expect(screen.getByLabelText('This over')).toHaveTextContent('Over 1 next');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/matches/m1');
  });

  it("offers to try again when the match can't be loaded", async () => {
    let ok = false;
    fetchMock = vi.fn(async () => (ok ? jsonResponse(view()) : jsonResponse({ error: 'down' }, 500)));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchConsole matchId="m1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The match could not be loaded');
    ok = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Lahore vs Karachi')).toBeInTheDocument();
  });

  it('starts the first innings with the team that bats', async () => {
    const setup = view({ innings: [] }, { status: 'setup' });
    serve(setup, () => jsonResponse(view()));
    render(<MatchConsole matchId="m1" />);
    expect(await screen.findByText('Who bats first?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Undo last ball/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Karachi bat' }));
    await waitFor(() => expect(lastEvent()).toEqual({ version: 3, event: { type: 'start_innings', battingTeam: 'Karachi' } }));
    expect(await screen.findByLabelText('This over')).toHaveTextContent('Over 2: 4 W 1');
  });

  it('starts the chase with the other team at the innings break', async () => {
    serve(view({}, { status: 'innings_break' }));
    render(<MatchConsole matchId="m1" />);
    expect(await screen.findByText('Start the second innings')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lahore bat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Karachi bat' }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'start_innings', battingTeam: 'Karachi' }));
    expect(screen.getByRole('button', { name: /Undo last ball/ })).toBeInTheDocument();
  });

  it('records balls: plain runs, extras, wickets, then back to a plain ball', async () => {
    serve(view());
    render(<MatchConsole matchId="m1" />);
    await screen.findByText('Lahore vs Karachi');
    fireEvent.click(screen.getByRole('button', { name: '4 runs' }));
    await waitFor(() => expect(lastEvent()).toEqual({ version: 3, event: { type: 'ball', runs: 4, extra: 'none', wicket: false } }));

    fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
    expect(screen.getByRole('button', { name: 'Wide' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '1 run' }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'ball', runs: 1, extra: 'wide', wicket: false }));
    // The kind of delivery goes back to a plain ball
    await waitFor(() => expect(screen.getByRole('button', { name: 'Off the bat' })).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(screen.getByRole('button', { name: 'Wicket' }));
    fireEvent.click(screen.getByRole('button', { name: '1 run' }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'ball', runs: 1, extra: 'none', wicket: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Wicket' })).toHaveAttribute('aria-pressed', 'false'));

    fireEvent.click(screen.getByRole('button', { name: 'Wicket, no run' }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'ball', runs: 0, extra: 'none', wicket: true }));
    expect(posts().every((p) => p.url === '/api/admin/matches/m1/events')).toBe(true);
  });

  it('undoes, and asks before closing answers, ending the innings or abandoning, saying how to put each back', async () => {
    serve(view());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<MatchConsole matchId="m1" />);
    await screen.findByText('Lahore vs Karachi');
    const click = async (name: RegExp, type: string) => {
      fireEvent.click(screen.getByRole('button', { name }));
      await waitFor(() => expect(lastEvent().event).toEqual({ type }));
    };
    await click(/Undo last ball/, 'undo');
    fireEvent.click(screen.getByRole('button', { name: /Close answers now/ }));
    fireEvent.click(screen.getByRole('button', { name: /End innings/ }));
    fireEvent.click(screen.getByRole('button', { name: /Abandon match/ }));
    expect(confirm.mock.calls.map(([text]) => text)).toEqual([expect.stringMatching(/Reopen answers puts back/), expect.stringMatching(/Resume innings puts it back/)]);
    expect(prompt).toHaveBeenCalledWith(expect.stringMatching(/Restore match puts it back[\s\S]*Type the match name to confirm: Lahore vs Karachi/));
    expect(posts()).toHaveLength(1);

    confirm.mockReturnValue(true);
    await click(/Close answers now/, 'close_answers');
    await click(/End innings/, 'end_innings');
    // Abandoning needs the match's name typed (case and spaces don't matter)
    prompt.mockReturnValue('Lahore vs');
    fireEvent.click(screen.getByRole('button', { name: /Abandon match/ }));
    expect(posts()).toHaveLength(3);
    prompt.mockReturnValue('  lahore VS karachi ');
    await click(/Abandon match/, 'abandon');
  });

  it('corrects any ball from the scorecard, starting from what was recorded', async () => {
    serve(view());
    render(<MatchConsole matchId="m1" />);
    const card = await screen.findByRole('region', { name: 'Scorecard' });
    expect(card).toHaveTextContent('Innings 1: Lahore');
    expect(card).toHaveTextContent('Over 1' + '140110' + '7 runs');

    fireEvent.click(screen.getByRole('button', { name: 'Correct innings 1, over 2, ball 2: W' }));
    const panel = screen.getByRole('group', { name: 'Correct a ball' });
    expect(panel).toHaveTextContent('Innings 1, over 2, ball 2: was W. What really happened?');
    expect(screen.getByRole('button', { name: 'Wicket' , pressed: true })).toBeInTheDocument();
    // It was a wide that took a run, not a wicket
    fireEvent.click(screen.getAllByRole('button', { name: 'Wide' })[1]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Wicket' })[1]);
    fireEvent.click(screen.getByRole('button', { name: '1 run (correction)' }));
    await waitFor(() => expect(lastEvent()).toEqual({ version: 3, event: { type: 'correct_ball', ballId: 'o2b2', runs: 1, extra: 'wide', wicket: false } }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Correct a ball' })).toBeNull());

    // Picked by mistake: cancel
    fireEvent.click(screen.getByRole('button', { name: 'Correct innings 1, over 1, ball 1: 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the correction' }));
    expect(screen.queryByRole('group', { name: 'Correct a ball' })).toBeNull();
  });

  it("gives each over's runs in the scorecard", async () => {
    const quiet = { number: 1, runs: 1, wickets: 0, complete: true, balls: deliveries('q', ['1', '0', '0', '0', '0', '0']) };
    serve(view({ innings: [{ ...view().innings[0], overs: [quiet] }] }));
    render(<MatchConsole matchId="m1" />);
    expect(await screen.findByRole('region', { name: 'Scorecard' })).toHaveTextContent('Over 1100000' + '1 run');
  });

  it("offers the corrections where they apply: resume, remove, reopen answers", async () => {
    const endedByHand = view({
      innings: [{ ...view().innings[0], endReason: 'admin' }],
      questions: [question({ id: 'r1', state: 'closed', reopenable: true }), question({ id: 'r2', state: 'closed', reopenable: true }), question({ id: 'r3', state: 'closed' })],
    }, { status: 'innings_break' });
    serve(endedByHand);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { unmount } = render(<MatchConsole matchId="m1" />);
    const section = await screen.findByRole('region', { name: 'Put a mistake right' });
    expect(section).toHaveTextContent('To fix a wrong ball, pick it in the scorecard below');
    expect(screen.queryByRole('button', { name: /Remove innings/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Resume innings 1/ }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'resume_innings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen answers (2)' }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'reopen_answers' }));
    expect(confirm).not.toHaveBeenCalled();
    unmount();

    // The wrong team sent in: no balls yet, so the innings can go
    serve(view({ innings: [{ ...view().innings[0], endReason: 'admin' }, { innings: 2, battingTeam: 'Lahore', endReason: null, runs: 0, wickets: 0, oversText: '0.0', target: 13, overs: [] }] }));
    render(<MatchConsole matchId="m1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Remove innings 2/ }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Remove innings 2 \(Lahore batting\)\? .*any players already answered are voided/));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'remove_innings' }));
    expect(screen.queryByRole('button', { name: /Resume innings/ })).toBeNull();
  });

  it('restores an abandoned match after asking; nothing else can change it', async () => {
    serve(view({}, { status: 'abandoned' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MatchConsole matchId="m1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Restore match/ }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Settled results stand/));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'restore' }));
    expect(screen.getByRole('button', { name: /Correct innings 1, over 1, ball 1/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Reopen answers/ })).toBeNull();
  });

  it('shows refusals, reloads when someone else changed the match, and survives a lost connection', async () => {
    let answer: () => Promise<Response> = async () => jsonResponse({ error: 'Runs must be a whole number from 0 to 7' }, 400);
    serve(view(), () => answer());
    render(<MatchConsole matchId="m1" />);
    await screen.findByText('Lahore vs Karachi');
    const gets = () => fetchMock.mock.calls.filter(([, i]) => !i).length;

    fireEvent.click(screen.getByRole('button', { name: '0 runs' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Runs must be a whole number from 0 to 7'));
    expect(gets()).toBe(1);

    // A ball that wasn't saved keeps its kind, to try again
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
    fireEvent.click(screen.getByRole('button', { name: '0 runs' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Wide' })).toHaveAttribute('aria-pressed', 'true');

    answer = async () => jsonResponse({ error: 'Someone else changed this match first.', code: 'stale' }, 409);
    fireEvent.click(screen.getByRole('button', { name: '0 runs' }));
    await waitFor(() => expect(gets()).toBe(2));
    expect(h.toast.error).toHaveBeenLastCalledWith('Someone else changed this match first.');

    answer = async () => jsonResponse({}, 500);
    fireEvent.click(screen.getByRole('button', { name: '0 runs' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to save the change'));

    answer = async () => { throw new Error('offline'); };
    fireEvent.click(screen.getByRole('button', { name: '0 runs' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith(expect.stringMatching(/nothing was recorded/)));
  });

  it('sends one change at a time', async () => {
    let release!: () => void;
    serve(view(), () => new Promise<Response>((resolve) => { release = () => resolve(jsonResponse(view())); }));
    render(<MatchConsole matchId="m1" />);
    await screen.findByText('Lahore vs Karachi');
    // A double click: the second comes before the buttons are disabled
    fireEvent.click(screen.getByRole('button', { name: '1 run' }));
    fireEvent.click(screen.getByRole('button', { name: '1 run' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.getByRole('button', { name: /Close answers now/ })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole('button', { name: /Close answers now/ })).toBeEnabled());
    expect(posts()).toHaveLength(1);
  });

  it("lists this innings' questions, newest over first, with where each stands", async () => {
    serve(view({
      questions: [
        question({ id: 'a', over: 2, state: 'settled', correctOption: 1, text: 'Settled one' }),
        question({ id: 'b', over: 3, text: 'Open one' }),
        question({ id: 'c', over: 3, closesAt: new Date(Date.now() - 1000).toISOString(), text: 'Ran out of time' }),
        question({ id: 'd', over: 2, state: 'void', text: 'Void one' }),
        question({ id: 'e', over: 2, state: 'closed', text: 'Closed one' }),
        question({ id: 'f', over: 2, state: 'settled', correctOption: 7, text: 'Odd result' }),
        question({ id: 'g', innings: 2, over: 1, text: 'Other innings' }),
        question({ id: 'h', over: 3, closesAt: null, text: 'No close time' }),
      ],
    }));
    render(<MatchConsole matchId="m1" />);
    const list = await screen.findByRole('region', { name: 'Questions' });
    const rows = list.querySelectorAll('li');
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^Open oneOpen · closes in (1:01|1:00|0:59)$/),
      'Ran out of timeClosed',
      'No close timeOpen',
      'Settled oneSettled: No',
      'Void oneVoid',
      'Closed oneClosed',
      'Odd resultSettled: ?',
    ]);
  });

  it("warns that over 1's questions are open before the first ball", async () => {
    serve(view({
      innings: [{ innings: 1, battingTeam: 'Lahore', endReason: null, runs: 0, wickets: 0, oversText: '0.0', target: null, overs: [] }],
      questions: [question({ over: 1, closesAt: inFuture(90) }), question({ id: 'q2', over: 1, closesAt: inFuture(100) })],
    }));
    render(<MatchConsole matchId="m1" />);
    expect(await screen.findByText(/Over 1's questions close in 1:(31|30|29)\. Close them before the first ball/)).toBeInTheDocument();
  });

  it('after the match: only undo, and a pointer to settling; nothing for an abandoned or settled match', async () => {
    serve(view({}, { status: 'completed' }));
    const { unmount } = render(<MatchConsole matchId="m1" />);
    expect(await screen.findByText(/Settle its quiz from Settle Quizzes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Undo last ball/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abandon match/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Record a ball' })).toBeNull();
    unmount();

    serve(view({}, { status: 'abandoned' }));
    const abandoned = render(<MatchConsole matchId="m1" />);
    expect(await screen.findByText('Abandoned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Undo last ball/ })).toBeNull();
    abandoned.unmount();

    serve(view({ settled: true, innings: [{ ...view().innings[0], endReason: 'admin' }] }, { status: 'completed' }));
    render(<MatchConsole matchId="m1" />);
    expect(await screen.findByText(/has been settled/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Undo last ball/ })).toBeNull();
    expect(screen.queryByText(/Settle its quiz/)).toBeNull();
    // Settled is final: no corrections at all
    expect(screen.queryByRole('region', { name: 'Put a mistake right' })).toBeNull();
    expect(screen.getByRole('button', { name: /Correct innings 1, over 1, ball 1/ })).toBeDisabled();
  });
});
