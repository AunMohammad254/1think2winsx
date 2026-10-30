import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import type { PublicMatch } from '@/lib/match-feed';

type Poll = { task: () => Promise<boolean>; opts: Record<string, unknown> };
const h = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null },
  poll: null as Poll | null,
  csrf: vi.fn(),
  submit: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/hooks/useJitteredPolling', () => ({ useJitteredPolling: (task: () => Promise<boolean>, opts: Record<string, unknown>) => { h.poll = { task, opts }; } }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.csrf() }));
vi.mock('@/lib/fetch-retry', () => ({ fetchWithRetry: (...a: unknown[]) => h.submit(...a) }));

import MatchScreen from '@/components/match/MatchScreen';
import LiveMatchCards from '@/components/match/LiveMatchCards';
import MatchPage, { metadata } from '@/app/match/[id]/page';

const inFuture = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
type Question = PublicMatch['questions'][number];
const question = (over: Partial<Question> = {}): Question => ({
  id: 'q3a', innings: 1, over: 3, text: 'Lahore: will over 3 go for 8 or more runs?', textRomanUrdu: 'Lahore: kya over 3 mein 8 ya us se zyada runs banenge?',
  options: ['Yes', 'No'], state: 'open', closesAt: inFuture(90), correctOption: null, ...over,
});
const OPEN = [
  question(),
  question({ id: 'q3b', text: 'Will a wicket fall in over 3?', textRomanUrdu: 'Kya over 3 mein koi wicket giray ga?' }),
];
const PAST = [
  question({ id: 'q2a', over: 2, state: 'settled', correctOption: 0, closesAt: inFuture(-120) }),
  question({ id: 'q2b', over: 2, state: 'settled', correctOption: 1, closesAt: inFuture(-120), text: 'Will a wicket fall in over 2?', textRomanUrdu: null }),
  question({ id: 'q1a', over: 1, state: 'void', closesAt: inFuture(-300) }),
  question({ id: 'q1b', over: 1, state: 'closed', closesAt: inFuture(-300) }),
];

function feed(over: Partial<PublicMatch> = {}, match: Partial<PublicMatch['match']> = {}): PublicMatch {
  return {
    match: {
      id: 'm1', quizId: 'quiz1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', oversPerInnings: 20, status: 'live',
      settled: false, entriesClosed: false, ...match,
    },
    innings: [{
      innings: 1, battingTeam: 'Lahore', endReason: null, runs: 12, wickets: 1, oversText: '1.3', target: null,
      overs: [
        { number: 1, runs: 7, wickets: 0, complete: true, balls: ['1', '4', '0', '1', '1', '0'] },
        { number: 2, runs: 5, wickets: 1, complete: false, balls: ['4', 'W', '1'] },
      ],
    }],
    questions: [...PAST.slice().reverse().sort((a, b) => a.over - b.over), ...OPEN],
    serverNow: new Date().toISOString(),
    ...over,
  };
}

/** The feed and the player's answers, as the server would give them */
function serve(first: PublicMatch | (() => Response), answers: Array<{ questionId: string; selectedOption: number }> | Response = []) {
  h.fetch.mockImplementation(async (url: string) => {
    if (url === '/api/quizzes/quiz1/answers') return answers instanceof Response ? answers : jsonResponse({ answers });
    return typeof first === 'function' ? first() : new Response(JSON.stringify(first), { status: 200, headers: { 'content-type': 'application/json', age: '2' } });
  });
}
/** Over 3's questions, once the player's earlier answers are read (answering waits for them) */
async function readyOver3() {
  await screen.findByRole('button', { name: /Lock in for over 3/ });
  return screen.getByRole('region', { name: 'Over 3 predictions' });
}
const submits = () => h.submit.mock.calls.map(([url, init]) => ({ url, body: JSON.parse((init as RequestInit).body as string) }));

beforeEach(() => {
  h.auth = { user: null };
  h.poll = null;
  h.csrf.mockReset().mockResolvedValue('tok');
  h.submit.mockReset();
  h.fetch.mockReset();
  vi.stubGlobal('fetch', (...a: unknown[]) => h.fetch(...a));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MatchScreen: watching', () => {
  it('shows the score, this over and the questions in Roman Urdu first, read-only until the visitor signs in', async () => {
    serve(feed());
    render(<MatchScreen matchId="m1" />);
    expect(screen.getByText('Loading the match…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Lahore vs Karachi' })).toBeInTheDocument();
    expect(h.fetch).toHaveBeenCalledWith('/api/live/matches/m1', { credentials: 'omit' });
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/12\/1/)).toHaveTextContent('Lahore 12/1 (1.3 overs)');
    expect(screen.getByLabelText('This over')).toHaveTextContent('Over 2: 4 W 1');

    const over3 = screen.getByRole('region', { name: 'Over 3 predictions' });
    expect(over3.textContent).toMatch(/Lahore: kya over 3 mein 8 ya us se zyada runs banenge\?Lahore: will over 3 go for 8 or more runs\?/);
    expect(within(over3).getByText(/Closes in 1:(30|29|28)/)).toBeInTheDocument();
    for (const option of within(over3).getAllByRole('radio')) expect(option).toBeDisabled();
    expect(within(over3).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Haan · Yes', 'Nahi · No', 'Haan · Yes', 'Nahi · No']);
    expect(within(over3).queryByRole('button', { name: /Lock in/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in to play' })).toHaveAttribute('href', '/auth?mode=login');
    // Nobody signed in: nothing personal is asked for
    expect(h.fetch).toHaveBeenCalledTimes(1);

    const earlier = screen.getByRole('region', { name: 'Earlier overs' });
    // Newest over first; a question without Roman Urdu shows its English as the question
    expect(within(earlier).getAllByText(/^Over \d$/).map((n) => n.textContent)).toEqual(['Over 2', 'Over 1']);
    expect(within(earlier).getByText('Will a wicket fall in over 2?')).toHaveClass('font-medium');
    expect(within(earlier).getByText('Answer: Haan · Yes')).toBeInTheDocument();
    expect(within(earlier).getByText('Answer: Nahi · No')).toBeInTheDocument();
    expect(within(earlier).getByText("Void: this one doesn't count")).toBeInTheDocument();
    expect(within(earlier).getByText('Closed · waiting for the over')).toBeInTheDocument();
  });

  it('keeps polling every 3 s while the match is on and every 30 s after, keeping the last copy through failures', async () => {
    serve(feed());
    const { rerender } = render(<MatchScreen matchId="m1" />);
    await screen.findByRole('heading', { name: 'Lahore vs Karachi' });
    expect(h.poll!.opts).toMatchObject({ intervalMs: 3_000, jitterMs: 1_000, maxBackoffMs: 30_000 });

    serve(() => jsonResponse({ error: 'busy' }, 503));
    let ok = true;
    await act(async () => { ok = await h.poll!.task(); });
    expect(ok).toBe(false);
    expect(screen.getByRole('heading', { name: 'Lahore vs Karachi' })).toBeInTheDocument();

    serve(feed({ innings: [] }, { status: 'completed' }));
    await act(async () => { await h.poll!.task(); });
    rerender(<MatchScreen matchId="m1" />);
    expect(h.poll!.opts).toMatchObject({ intervalMs: 30_000 });
    expect(screen.getByText('Finished')).toBeInTheDocument();
    expect(screen.getByText("The first innings hasn't started yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText('This over')).toBeNull();

    // Taken down by an admin
    serve(() => jsonResponse({ error: 'Match not found' }, 404));
    await act(async () => { await h.poll!.task(); });
    expect(screen.getByRole('heading', { name: "This match isn't live" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to quizzes' })).toHaveAttribute('href', '/quizzes');
    // Nothing changes often on a match that isn't live: checked every 30 s, not every 3 s
    rerender(<MatchScreen matchId="m1" />);
    expect(h.poll!.opts).toMatchObject({ intervalMs: 30_000 });
    expect(screen.getByText(/checks again every half a minute/)).toBeInTheDocument();
  });

  it('offers to try again when the first load fails', async () => {
    serve(() => { throw new Error('offline'); });
    render(<MatchScreen matchId="m1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The match could not be loaded.');
    serve(feed());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Lahore vs Karachi' })).toBeInTheDocument();
  });

  it('shows the second innings, the target, and that the next questions are coming', async () => {
    const first = feed().innings[0];
    serve(feed({
      innings: [
        { ...first, endReason: 'overs', overs: [{ ...first.overs[0] }] },
        { innings: 2, battingTeam: 'Karachi', endReason: null, runs: 0, wickets: 0, oversText: '0.0', target: 13, overs: [] },
      ],
      questions: [{ ...PAST[0], innings: 1 }, question({ id: 'c1', innings: 2, over: 1, state: 'closed' })],
    }));
    render(<MatchScreen matchId="m1" />);
    expect((await screen.findByText(/target 13/)).closest('p')).toHaveTextContent('Karachi 0/0 (0.0 overs, target 13)');
    expect(screen.getByText("The next over's questions are on their way.")).toBeInTheDocument();
    expect(screen.getByText('Innings 2, over 1')).toBeInTheDocument();
    expect(screen.getByText('Innings 1, over 2')).toBeInTheDocument();
  });

  it('marks a question that closed in an over still open, counts down in red near the end, and keeps other options as they are', async () => {
    serve(feed({
      questions: [
        question({ closesAt: inFuture(15), options: ['Over 8', 'Under 8'] }),
        question({ id: 'q3b', closesAt: inFuture(-1) }),
        question({ id: 'q4', over: 4, closesAt: null }),
      ],
    }));
    render(<MatchScreen matchId="m1" />);
    const over3 = await screen.findByRole('region', { name: 'Over 3 predictions' });
    expect(within(over3).getByText(/Closes in 0:1\d/)).toHaveClass('text-red-200');
    expect(within(over3).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Over 8', 'Under 8']);
    expect(within(over3).getByText('Closed: answers for this one are in.')).toBeInTheDocument();
    // No closing time: no countdown
    expect(within(screen.getByRole('region', { name: 'Over 4 predictions' })).queryByText(/Closes in/)).toBeNull();
  });
});

describe('MatchScreen: playing', () => {
  beforeEach(() => {
    h.auth = { user: { id: 'u1' } };
  });

  it("reads the player's earlier answers once, and shows how they are doing", async () => {
    serve(feed(), [{ questionId: 'q2a', selectedOption: 0 }, { questionId: 'q2b', selectedOption: 0 }, { questionId: 'q3a', selectedOption: 1 }, { questionId: 'q1b', selectedOption: 0 }]);
    const { rerender } = render(<MatchScreen matchId="m1" />);
    expect(await screen.findByText('Your answer: Nahi · No')).toBeInTheDocument();
    expect(h.fetch).toHaveBeenCalledWith('/api/quizzes/quiz1/answers');
    expect(screen.getByText(/You got/)).toHaveTextContent('You got 1 of 2 right so far.');
    const earlier = screen.getByRole('region', { name: 'Earlier overs' });
    expect(within(earlier).getByText('Right: Haan · Yes')).toBeInTheDocument();
    expect(within(earlier).getByText('Wrong: the answer was Nahi · No')).toBeInTheDocument();
    expect(within(earlier).getByText('You said Haan · Yes · waiting for the over')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in to play' })).toBeNull();

    // Another poll doesn't ask again
    await act(async () => { await h.poll!.task(); });
    rerender(<MatchScreen matchId="m1" />);
    expect(h.fetch.mock.calls.filter(([url]) => url === '/api/quizzes/quiz1/answers')).toHaveLength(1);
  });

  it('picks, then locks in the over with the security token, and shows the answers as final', async () => {
    serve(feed());
    h.submit.mockResolvedValue(jsonResponse({ message: 'ok' }));
    render(<MatchScreen matchId="m1" />);
    const over3 = await readyOver3();
    const lockIn = within(over3).getByRole('button', { name: /Lock in for over 3/ });
    expect(lockIn).toBeDisabled();
    const [yesA, , , noB] = within(over3).getAllByRole('radio');
    fireEvent.click(yesA);
    fireEvent.click(noB);
    expect(yesA).toHaveAttribute('aria-checked', 'true');
    expect(within(over3).getByText('Answers are final once locked in.')).toBeInTheDocument();
    fireEvent.click(lockIn);
    expect(await screen.findByRole('status')).toHaveTextContent('Locked in for over 3. The results come once it has been bowled.');
    expect(submits()).toEqual([{ url: '/api/quizzes/quiz1/submit', body: { answers: [{ questionId: 'q3a', selectedOption: 0 }, { questionId: 'q3b', selectedOption: 1 }] } }]);
    expect(h.submit.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'tok' });
    expect(h.submit.mock.calls[0][2]).toEqual({ retries: 3, retryOn: [502, 503, 504] });
    expect(within(over3).getByText('Your answer: Haan · Yes')).toBeInTheDocument();
    expect(within(over3).getByText('Your answer: Nahi · No')).toBeInTheDocument();
    expect(within(over3).queryByRole('button', { name: /Lock in/ })).toBeNull();
  });

  it('drops a question that closed meanwhile and sends the rest once more', async () => {
    serve(feed());
    h.submit
      .mockResolvedValueOnce(jsonResponse({ error: 'Too late for over 3: answers closed before yours arrived. Nothing was saved, so send your other answers again.', code: 'questions_closed', closed: ['q3a'] }, 409))
      .mockResolvedValueOnce(jsonResponse({ message: 'ok' }));
    render(<MatchScreen matchId="m1" />);
    const over3 = await readyOver3();
    const [yesA, , yesB] = within(over3).getAllByRole('radio');
    fireEvent.click(yesA);
    fireEvent.click(yesB);
    fireEvent.click(within(over3).getByRole('button', { name: /Lock in/ }));
    await waitFor(() => expect(submits()).toHaveLength(2));
    expect(submits()[1].body).toEqual({ answers: [{ questionId: 'q3b', selectedOption: 0 }] });
    expect(await within(over3).findByText('Closed: answers for this one are in.')).toBeInTheDocument();
    expect(within(over3).getByText('Your answer: Haan · Yes')).toBeInTheDocument();
  });

  it('says when every answer was too late', async () => {
    serve(feed());
    h.submit.mockResolvedValue(jsonResponse({ error: 'Too late for over 3: answers closed before yours arrived.', code: 'questions_closed', closed: ['q3a', 'q3b'] }, 409));
    render(<MatchScreen matchId="m1" />);
    const over3 = await readyOver3();
    fireEvent.click(within(over3).getAllByRole('radio')[0]);
    fireEvent.click(within(over3).getByRole('button', { name: /Lock in/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too late for over 3: answers closed before yours arrived.');
    expect(submits()).toHaveLength(1);
    // Both closed: the over is no longer open
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Over 3 predictions' })).toBeNull());
  });

  it('gives up after a second late answer', async () => {
    serve(feed());
    h.submit
      .mockResolvedValueOnce(jsonResponse({ error: 'Late A', code: 'questions_closed', closed: ['q3a'] }, 409))
      .mockResolvedValueOnce(jsonResponse({ error: 'Late B', code: 'questions_closed', closed: ['q3b'] }, 409))
      .mockResolvedValueOnce(jsonResponse({ error: 'never sent' }, 500));
    // A third question in the over, so something is left after two refusals
    serve(feed({ questions: [...OPEN, question({ id: 'q3c' })] }));
    render(<MatchScreen matchId="m1" />);
    const over3 = await readyOver3();
    const radios = within(over3).getAllByRole('radio');
    fireEvent.click(radios[0]);
    fireEvent.click(radios[2]);
    fireEvent.click(radios[4]);
    fireEvent.click(within(over3).getByRole('button', { name: /Lock in/ }));
    expect(await screen.findByText('Late B')).toBeInTheDocument();
    expect(submits()).toHaveLength(2);
  });

  it('explains every other refusal and lets the player try again', async () => {
    serve(feed());
    render(<MatchScreen matchId="m1" />);
    const over3 = await readyOver3();
    fireEvent.click(within(over3).getAllByRole('radio')[0]);
    const lockIn = () => fireEvent.click(within(over3).getByRole('button', { name: /Lock in/ }));

    h.csrf.mockResolvedValueOnce(null);
    lockIn();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to verify security token.');

    h.submit.mockResolvedValueOnce(jsonResponse({ error: 'Sign in' }, 401));
    lockIn();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sign in again to answer.'));

    h.submit.mockResolvedValueOnce(jsonResponse({ error: 'Entries for this quiz have closed.' }, 403));
    lockIn();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Entries for this quiz have closed.'));

    h.submit.mockResolvedValueOnce(new Response('not json', { status: 500 }));
    lockIn();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your answers could not be sent. Try again.'));

    h.submit.mockRejectedValueOnce('offline');
    lockIn();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your answers could not be sent. Try again.'));
    expect(within(over3).getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('tells a newcomer to a full match that entries have closed, and a player of a settled one where their points are', async () => {
    serve(feed({}, { entriesClosed: true }));
    const { unmount } = render(<MatchScreen matchId="m1" />);
    expect(await screen.findByText('This match is full: entries have closed.')).toBeInTheDocument();
    for (const option of screen.getAllByRole('radio')) expect(option).toBeDisabled();
    unmount();

    // Already playing: still in, whatever the limit
    serve(feed({}, { entriesClosed: true, settled: true }), [{ questionId: 'q2a', selectedOption: 0 }]);
    render(<MatchScreen matchId="m1" />);
    expect(await screen.findByRole('link', { name: 'See your points' })).toHaveAttribute('href', '/quiz/quiz1/results');
    expect(screen.queryByText('This match is full: entries have closed.')).toBeNull();
  });

  it("waits for the player's earlier answers before taking new ones, trying again until they are read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let reads = 0;
      h.fetch.mockImplementation(async (url: string) => {
        if (url !== '/api/quizzes/quiz1/answers') return jsonResponse(feed({}, { entriesClosed: true }));
        reads += 1;
        if (reads === 1) return jsonResponse({ error: 'down' }, 500);
        if (reads === 2) throw new Error('offline');
        return jsonResponse({ answers: [{ questionId: 'q3a', selectedOption: 0 }] });
      });
      render(<MatchScreen matchId="m1" />);
      expect(await screen.findByText('Loading your answers…')).toBeInTheDocument();
      await waitFor(() => expect(reads).toBe(1));
      // Not known yet whether they joined: neither "full" nor answerable
      expect(screen.queryByText('This match is full: entries have closed.')).toBeNull();
      expect(screen.queryByRole('button', { name: /Lock in/ })).toBeNull();
      for (const option of screen.getAllByRole('radio')) expect(option).toBeDisabled();

      // Tried again after 5 s, then 10 s
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(reads).toBe(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(reads).toBe(3);
      expect(await screen.findByText('Your answer: Haan · Yes')).toBeInTheDocument();
      expect(screen.queryByText('Loading your answers…')).toBeNull();
      // Joined already: still in although the match is full
      expect(screen.queryByText('This match is full: entries have closed.')).toBeNull();
      expect(screen.getByRole('button', { name: /Lock in for over 3/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('LiveMatchCards', () => {
  it('shows nothing without a match, and each match with where it stands', () => {
    const { container, rerender } = render(<LiveMatchCards matches={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LiveMatchCards matches={[
      { id: 'm1', title: 'Lahore vs Karachi', teamA: 'Lahore', teamB: 'Karachi', status: 'live' },
      { id: 'm2', title: 'Quetta vs Multan', teamA: 'Quetta', teamB: 'Multan', status: 'abandoned' },
      { id: 'm3', title: 'Islamabad vs Peshawar', teamA: 'Islamabad', teamB: 'Peshawar', status: 'innings_break' },
    ]} />);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/match/m1', '/match/m2', '/match/m3']);
    expect(links[0]).toHaveTextContent('Live now');
    expect(links[0]).toHaveTextContent('Play now');
    expect(links[1]).toHaveTextContent('Abandoned');
    expect(links[1]).toHaveTextContent('See how it ended');
    expect(links[2]).toHaveTextContent('Innings break');
  });
});

describe('/match/[id] page', () => {
  it('renders the match screen for the match in the address', async () => {
    const element = await MatchPage({ params: Promise.resolve({ id: 'm7' }) });
    expect(element.props).toEqual({ matchId: 'm7' });
    expect(metadata.title).toBe('Live match · 1Think 2Win');
  });
});
