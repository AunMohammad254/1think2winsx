import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import type { MatchView } from '@/lib/match-service';

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() }, push: vi.fn() }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({ 'X-CSRF-Token': 'tok' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));

import MatchList from '@/components/admin/matches/MatchList';
import MatchConsole from '@/components/admin/matches/MatchConsole';

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

describe('MatchConsole', () => {
  const inFuture = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
  const question = (over: Partial<MatchView['questions'][number]> = {}) => ({
    id: 'q', innings: 1 as const, over: 3, text: 'Will a wicket fall in over 3?', options: ['Yes', 'No'], market: 'wicket_in_over',
    state: 'open' as const, closesAt: inFuture(60), correctOption: null, reopenable: false, textRomanUrdu: null, ...over,
  });
  // Scorecard labels as deliveries: '4' is 4 off the bat, 'W' a wicket with no run
  const deliveries = (prefix: string, labels: string[]) => labels.map((label, i) => ({
    id: `${prefix}${i + 1}`, label, runs: Number.parseInt(label, 10) || 0, extra: 'none' as const, wicket: label.includes('W'),
    wicketKind: null, boundary: null,
  }));
  const view = (over: Partial<MatchView> = {}, match: Partial<MatchView['match']> = {}): MatchView => ({
    match: {
      id: 'm1', quizId: 'quiz1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 20, questionsPerOver: 2,
      firstWindowSeconds: 120, lockFallbackSeconds: 150, status: 'live', autoSend: false, language: 'both', aiLevel: 'full', version: 3,
      published: false, ...match,
    },
    settled: false,
    players: { entries: 0, maxEntries: 2000 },
    innings: [{
      innings: 1, battingTeam: 'Lahore', endReason: null, runs: 12, wickets: 1, oversText: '1.3', target: null,
      overs: [
        { number: 1, runs: 7, wickets: 0, complete: true, balls: deliveries('o1b', ['1', '4', '0', '1', '1', '0']) },
        { number: 2, runs: 5, wickets: 1, complete: false, balls: deliveries('o2b', ['4', 'W', '1']) },
      ],
    }],
    questions: [],
    quizzes: [],
    lapsed: [],
    wording: {
      on: false, model: 'gemini-3.1-flash-lite', limits: { rpm: 5, tpm: 25_000, rpd: 100 },
      thisMinute: { requests: 0, tokens: 0 }, today: { requests: 0, peakRequestsPerMinute: 0, peakTokensPerMinute: 0 },
      pausedUntil: null, pausedForDay: false,
      plan: { chosen: 'full', effective: 'off', lowered: false, usage: 'off', share: 0 },
    },
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
    expect(screen.getByText(/T20 · 1 question a quiz · free entry/)).toBeInTheDocument();
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

  it('records balls: a boundary, extras, dismissals, then back to a normal ball', async () => {
    serve(view());
    render(<MatchConsole matchId="m1" />);
    await screen.findByText('Lahore vs Karachi');
    fireEvent.click(screen.getByRole('button', { name: 'Four' }));
    await waitFor(() => expect(lastEvent()).toEqual({ version: 3, event: { type: 'ball', runs: 4, extra: 'none', wicket: false, boundary: true } }));

    fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
    expect(screen.getByRole('button', { name: 'Wide' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '1 run' }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'ball', runs: 1, extra: 'wide', wicket: false }));
    // The kind of delivery goes back to a normal ball
    await waitFor(() => expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(screen.getByRole('button', { name: 'Caught' }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'ball', runs: 0, extra: 'none', wicket: true, wicketKind: 'caught' }));

    fireEvent.click(screen.getByRole('button', { name: 'Run out' }));
    fireEvent.click(screen.getByRole('button', { name: '1 run' }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'ball', runs: 1, extra: 'none', wicket: true, wicketKind: 'run_out' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run out' })).toHaveAttribute('aria-pressed', 'false'));

    fireEvent.click(screen.getByRole('button', { name: '+5 penalty runs' }));
    await waitFor(() => expect(lastEvent().event).toEqual({ type: 'ball', runs: 0, extra: 'penalty', wicket: false }));
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
    // It was a wide that took a run, not a wicket
    fireEvent.click(within(panel).getByRole('button', { name: 'Wide' }));
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

  it('shows each question in Roman Urdu first, English under it', async () => {
    serve(view({ questions: [question({ textRomanUrdu: 'Kya over 3 mein koi wicket giray ga?' })] }));
    render(<MatchConsole matchId="m1" />);
    const list = await screen.findByRole('region', { name: 'Questions' });
    expect(list.querySelector('li')!.textContent).toMatch(/^Kya over 3 mein koi wicket giray ga\?Will a wicket fall in over 3\?/);
  });

  it('switches between Manual and Auto in one tap, saying what each does', async () => {
    // PATCH answers with the match as the switch now is
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PATCH'
      ? jsonResponse(view({}, { autoSend: JSON.parse(init.body as string).autoSend }))
      : jsonResponse(view())));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchConsole matchId="m1" />);
    const mode = await screen.findByRole('group', { name: 'Quiz mode' });
    expect(within(mode).getByRole('button', { name: 'Manual' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Manual: tick the questions for each quiz/)).toBeInTheDocument();
    // The one already on does nothing
    fireEvent.click(within(mode).getByRole('button', { name: 'Manual' }));
    fireEvent.click(within(mode).getByRole('button', { name: 'Auto' }));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Quiz mode' })).getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByText(/Auto: each over's best questions go out on ball 1/)).toBeInTheDocument();
    const patches = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0][0]).toBe('/api/admin/matches/m1');
    expect(JSON.parse((patches[0][1] as RequestInit).body as string)).toEqual({ autoSend: true });
  });

  const quiz = (over: Partial<MatchView['quizzes'][number]> = {}): MatchView['quizzes'][number] => ({
    innings: 1, over: 3, during: 2, ballsBowled: 1, started: true, pushOn: null, pushBy: null, wording: 'built_in', rebuilt: false,
    questions: [{
      id: 'd1', market: 'wicket_in_over', options: ['Yes', 'No'], line: null, text: 'Will a wicket fall in over 3?', textRomanUrdu: 'Kya over 3 mein koi wicket giray ga?',
      source: 'built_in', builtIn: { text: 'Will a wicket fall in over 3?', textRomanUrdu: 'Kya over 3 mein koi wicket giray ga?', line: null }, best: true, selected: true,
    }],
    ...over,
  });

  it("shows each waiting quiz, and sends it now, sets it to a ball, takes it off, or skips it", async () => {
    serve(view({ quizzes: [quiz(), quiz({ over: 4, during: 3, ballsBowled: 0, started: false, pushOn: 2, pushBy: 'admin', questions: [{ ...quiz().questions[0], id: 'q4' }] })] }), () => jsonResponse(view()));
    render(<MatchConsole matchId="m1" />);
    const first = await screen.findByRole('group', { name: 'Over 3 quiz' });
    fireEvent.click(within(first).getByRole('button', { name: /Send now/ }));
    await waitFor(() => expect(posts().at(-1)).toEqual({
      url: '/api/admin/matches/m1/questions',
      body: { action: 'send', questions: [{ id: 'd1', text: 'Will a wicket fall in over 3?', textRomanUrdu: 'Kya over 3 mein koi wicket giray ga?' }] },
    }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Over 3 quiz' })).toBeNull());
  });

  it('sets a quiz to a ball, cancels one, and skips one', async () => {
    const queued = quiz({ over: 4, during: 3, ballsBowled: 0, started: false, pushOn: 2, pushBy: 'auto', questions: [{ ...quiz().questions[0], id: 'q4' }] });
    serve(view({ quizzes: [quiz(), queued] }), () => jsonResponse(view({ quizzes: [quiz(), queued] })));
    render(<MatchConsole matchId="m1" />);
    const first = await screen.findByRole('group', { name: 'Over 3 quiz' });
    fireEvent.click(within(first).getByRole('button', { name: 'Push on ball 3' }));
    fireEvent.click(within(first).getByRole('button', { name: 'Queue for ball 3' }));
    await waitFor(() => expect(posts().at(-1)!.body).toEqual({
      action: 'queue', ball: 3, questions: [{ id: 'd1', text: 'Will a wicket fall in over 3?', textRomanUrdu: 'Kya over 3 mein koi wicket giray ga?' }],
    }));
    const second = screen.getByRole('group', { name: 'Over 4 quiz' });
    expect(within(second).getByRole('status')).toHaveTextContent('Goes out on ball 2 of over 3 (Auto).');
    fireEvent.click(within(second).getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(posts().at(-1)!.body).toEqual({ action: 'unqueue', innings: 1, over: 4 }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Over 3 quiz' })).getByRole('button', { name: /Skip/ }));
    await waitFor(() => expect(posts().at(-1)!.body).toEqual({ action: 'skip', ids: ['d1'] }));
  });

  it("says which overs' quizzes ran out of time, and looks again while Gemini is wording one", async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let pending = true;
    fetchMock = vi.fn(async () => jsonResponse(view({ quizzes: [quiz({ wording: pending ? 'pending' : 'ai' })], lapsed: [{ innings: 1, over: 2 }] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchConsole matchId="m1" />);
    expect(await screen.findByText(/Ran out of time, never sent: over 2/)).toBeInTheDocument();
    expect(screen.getByText('Gemini is wording it…')).toBeInTheDocument();
    // The admin picks a ball while Gemini works: the wording arriving keeps it
    fireEvent.click(screen.getByRole('button', { name: 'Push on ball 3' }));
    pending = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(await screen.findByText('Worded by Gemini')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push on ball 3' })).toHaveAttribute('aria-pressed', 'true');
    const loads = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    // Nothing pending: no more looking
    expect(fetchMock.mock.calls.length).toBe(loads);
    vi.useRealTimers();
  });

  it('opens the scoreboard editor from the pencil: change a recent ball, undo the last, pick the quiz language', async () => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PATCH'
      ? jsonResponse(view({}, { language: JSON.parse(init.body as string).language }))
      : jsonResponse(view())));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchConsole matchId="m1" />);
    const pencil = await screen.findByRole('button', { name: 'Edit the scoreboard' });
    expect(screen.queryByRole('group', { name: 'Scoreboard editor' })).toBeNull();
    fireEvent.click(pencil);
    const editor = screen.getByRole('group', { name: 'Scoreboard editor' });
    // The last two overs, tappable
    fireEvent.click(within(editor).getByRole('button', { name: 'Change over 2, ball 2: W' }));
    const correction = within(editor).getByRole('group', { name: 'Correct a ball' });
    expect(correction).toHaveTextContent('Innings 1, over 2, ball 2: was W. What really happened?');
    // Only one correction panel at a time: the scorecard's stays shut
    expect(screen.getAllByRole('group', { name: 'Correct a ball' })).toHaveLength(1);
    fireEvent.click(within(correction).getByRole('button', { name: '1 run (correction)' }));
    await waitFor(() => expect(posts().at(-1)!.body).toEqual({ version: 3, event: { type: 'correct_ball', ballId: 'o2b2', runs: 1, extra: 'none', wicket: false } }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Scoreboard editor' })).getByRole('button', { name: /Undo last ball/ }));
    await waitFor(() => expect(posts().at(-1)!.body).toEqual({ version: 3, event: { type: 'undo' } }));
    const language = within(screen.getByRole('group', { name: 'Scoreboard editor' })).getByRole('group', { name: 'Quiz language' });
    fireEvent.click(within(language).getByRole('button', { name: 'Roman Urdu' }));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Quiz language' })).getByRole('button', { name: 'Roman Urdu' })).toHaveAttribute('aria-pressed', 'true'));
    expect(JSON.parse((fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')![1] as RequestInit).body as string)).toEqual({ language: 'ur' });
    // Cancel closes the correction; the pencil closes the editor
    fireEvent.click(within(screen.getByRole('group', { name: 'Scoreboard editor' })).getByRole('button', { name: 'Change over 1, ball 1: 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the correction' }));
    expect(screen.queryByRole('group', { name: 'Correct a ball' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the scoreboard' }));
    expect(screen.queryByRole('group', { name: 'Scoreboard editor' })).toBeNull();
  });

  it('says there are no balls to change before the first', async () => {
    serve(view({ innings: [{ ...view().innings[0], overs: [] }] }));
    render(<MatchConsole matchId="m1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit the scoreboard' }));
    expect(within(screen.getByRole('group', { name: 'Scoreboard editor' })).getByText('No balls yet.')).toBeInTheDocument();
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
    // Nor does who can see it
    expect(screen.queryByRole('region', { name: 'Players' })).toBeNull();
  });

  /** Answers each PATCH with the match as its setting now is */
  function serveSettings(first: MatchView) {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return jsonResponse(first);
      const body = JSON.parse(init.body as string);
      return 'published' in body
        ? jsonResponse(view({ players: first.players }, { published: body.published }))
        : jsonResponse(view({ players: { ...first.players!, maxEntries: body.maxEntries } }));
    });
    vi.stubGlobal('fetch', fetchMock);
  }
  const patches = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

  it('takes the match live after asking, links the player screen, and hides it again', async () => {
    serveSettings(view());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MatchConsole matchId="m1" />);
    const panel = await screen.findByRole('region', { name: 'Players' });
    expect(panel).toHaveTextContent("Players can't see this match yet");
    fireEvent.click(screen.getByRole('button', { name: /Go live/ }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/every player gets a notification \(only the first time\)/));
    expect(patches()).toEqual([]);

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Go live/ }));
    expect(await screen.findByText('Players can see this match')).toBeInTheDocument();
    expect(screen.getByText(/each over's questions pop up on the live stream once you send them/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hide from players/ }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/^Hide this match from players\?/));
    expect(await screen.findByText("Players can't see this match yet")).toBeInTheDocument();
    expect(patches()).toEqual([{ published: true }, { published: false }]);
  });

  it('only takes a restored match live', async () => {
    serveSettings(view({}, { status: 'abandoned' }));
    render(<MatchConsole matchId="m1" />);
    expect(await screen.findByText('Restore the match before taking it live.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go live/ })).toBeDisabled();
  });

  it('changes how many players can join, asking first when that turns new players away', async () => {
    serveSettings(view({ players: { entries: 10, maxEntries: 2000 } }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MatchConsole matchId="m1" />);
    expect(await screen.findByText('10 of 2,000 joined')).toBeInTheDocument();
    const box = screen.getByRole('spinbutton', { name: 'Players who can join' });
    const save = screen.getByRole('button', { name: 'Save' });
    // Nothing to save until it changes to a valid number
    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: '0' } });
    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: '5' } });
    fireEvent.click(save);
    expect(confirm).toHaveBeenCalledWith('10 players have already joined, so nobody new can join. Save anyway?');
    expect(patches()).toEqual([]);

    fireEvent.change(box, { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('10 of 5,000 joined')).toBeInTheDocument();
    expect(patches()).toEqual([{ maxEntries: 5000 }]);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe('MatchConsole: Gemini usage', () => {
  const base = {
    match: {
      id: 'm1', quizId: 'quiz1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 20, questionsPerOver: 2,
      firstWindowSeconds: 120, lockFallbackSeconds: 150, status: 'setup' as const, autoSend: false, language: 'both' as const,
      aiLevel: 'full' as const, version: 1, published: false,
    },
    settled: false, players: null, innings: [], questions: [], quizzes: [], lapsed: [], serverNow: new Date().toISOString(),
  };
  const usage = (over: Partial<MatchView['wording']> = {}, plan: Partial<MatchView['wording']['plan']> = {}): MatchView['wording'] => ({
    on: true, model: 'gemini-3.1-flash-lite', limits: { rpm: 5, tpm: 25_000, rpd: 100 },
    thisMinute: { requests: 1, tokens: 640 }, today: { requests: 12, peakRequestsPerMinute: 2, peakTokensPerMinute: 1_300 },
    pausedUntil: null, pausedForDay: false, ...over,
    plan: { chosen: 'full', effective: 'full', lowered: false, usage: 'ok', share: 0.2, ...plan },
  });
  let fetchMock: ReturnType<typeof vi.fn>;
  const show = async (wording: MatchView['wording']) => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => jsonResponse({
      ...base, wording, match: { ...base.match, ...(init?.method === 'PATCH' ? JSON.parse(init.body as string) : {}) },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchConsole matchId="m1" />);
    await screen.findByText('Lahore vs Karachi');
  };

  it('says when Gemini is off, without bars, and the AI level can\'t change', async () => {
    await show(usage({ on: false }, { usage: 'off', effective: 'off' }));
    const box = screen.getByLabelText('Gemini usage');
    expect(box).toHaveTextContent('Off: no MATCH_GEMINI_API_KEY');
    expect(within(box).queryAllByRole('meter')).toEqual([]);
    expect(within(box).getByRole('button', { name: 'Half' })).toBeDisabled();
  });

  it('shows bars for the requests today, this minute and the tokens, coloured by how close the fullest is', async () => {
    await show(usage());
    const box = screen.getByLabelText('Gemini usage');
    expect(box).toHaveTextContent('Gemini (gemini-3.1-flash-lite)');
    expect(box).toHaveTextContent('Healthy');
    const [today, minute, tokens] = within(box).getAllByRole('meter');
    expect(today).toHaveAttribute('aria-valuenow', '12');
    expect(today).toHaveAttribute('aria-valuemax', '100');
    expect(today.firstElementChild).toHaveStyle({ width: '12%' });
    expect(today.firstElementChild).toHaveClass('bg-emerald-500');
    expect(minute).toHaveAttribute('aria-valuenow', '1');
    expect(tokens).toHaveAttribute('aria-valuemax', '25000');
    expect(box).toHaveTextContent('12/100');
    expect(box).toHaveTextContent('640/25,000');
    expect(within(box).queryByRole('status')).toBeNull();
    cleanup();
    await show(usage({ today: { requests: 70, peakRequestsPerMinute: 2, peakTokensPerMinute: 0 } }, { usage: 'busy', share: 0.7 }));
    expect(screen.getByLabelText('Gemini usage')).toHaveTextContent('Busy');
    expect(within(screen.getByLabelText('Gemini usage')).getAllByRole('meter')[0].firstElementChild).toHaveClass('bg-amber-400');
  });

  it('changes the AI level in one tap', async () => {
    await show(usage());
    fireEvent.click(within(screen.getByRole('group', { name: 'AI level' })).getByRole('button', { name: 'Half' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ aiLevel: 'half' });
  });

  it('says when it lowered the level on its own, or Google paused it, for the day or until a time', async () => {
    await show(usage({ today: { requests: 90, peakRequestsPerMinute: 2, peakTokensPerMinute: 0 } }, { usage: 'near', effective: 'half', lowered: true, share: 0.9 }));
    const box = screen.getByLabelText('Gemini usage');
    expect(box).toHaveTextContent('Near the limit');
    expect(within(box).getByRole('status')).toHaveTextContent("Lowered to Half on its own: close to Google's limit.");
    expect(within(box).getAllByRole('meter')[0].firstElementChild).toHaveClass('bg-red-500');
    cleanup();
    await show(usage({ pausedForDay: true }, { usage: 'paused', effective: 'off', lowered: true }));
    expect(within(screen.getByLabelText('Gemini usage')).getByRole('status')).toHaveTextContent('Paused until midnight Pacific time: quizzes use the built-in wording.');
    cleanup();
    const until = new Date(Date.now() + 30_000).toISOString();
    await show(usage({ pausedUntil: until }, { usage: 'paused', effective: 'off', lowered: true }));
    expect(screen.getByLabelText('Gemini usage')).toHaveTextContent(`until ${new Date(until).toLocaleTimeString()}`);
  });
});
