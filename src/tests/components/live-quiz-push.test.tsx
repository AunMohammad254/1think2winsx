import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createRef } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  fetchWithRetry: vi.fn(),
  getCSRFToken: vi.fn(),
  chime: vi.fn(),
  soundOn: true,
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.getCSRFToken() }));
vi.mock('@/lib/fetch-retry', () => ({ fetchWithRetry: (...a: unknown[]) => h.fetchWithRetry(...a) }));
vi.mock('@/lib/notification-sound', () => ({ playChime: () => h.chime(), isNotificationSoundOn: () => h.soundOn }));

import LiveQuizPush, { type LiveQuizPushHandle, type MatchPush } from '@/components/quiz/LiveQuizPush';
import { STREAM_FULLSCREEN_ATTR } from '@/lib/stream-fullscreen';

const quiz = { id: 'q1', title: 'Live Cricket', questions: [{ id: 'a', text: 'Who?', options: ['Babar', 'Rizwan'] }, { id: 'b', text: 'When?', options: ['1992', '2009'] }] };
const T0 = new Date('2026-10-19T15:00:00Z').getTime();
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();
let ref: React.RefObject<LiveQuizPushHandle | null>;
const setup = (onAnswered = vi.fn()) => {
  ref = createRef<LiveQuizPushHandle>();
  const utils = render(<LiveQuizPush ref={ref} onAnswered={onAnswered} />);
  return { ...utils, onAnswered };
};
/** Fake clock and timers; promises still resolve, flushed with `flush()`. */
const fakeClock = () => vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const banner = () => screen.queryByText('New quiz just dropped');
const option = (name: string) => screen.getByRole('radio', { name });

beforeEach(() => {
  h.fetchWithRetry.mockReset().mockImplementation(async () => jsonResponse({ quiz }));
  h.getCSRFToken.mockReset().mockResolvedValue('tok');
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.chime.mockReset();
  h.soundOn = true;
  window.innerWidth = 1024;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // The deadline lock-in tests pin the random wait
  if (vi.isMockFunction(Math.random)) vi.mocked(Math.random).mockRestore();
  document.querySelectorAll(`[${STREAM_FULLSCREEN_ATTR}]`).forEach((el) => el.remove());
});

describe('LiveQuizPush: the live banner', () => {
  it('renders nothing until a quiz is pushed', () => {
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it('counts down the answering window, then shrinks to a pill under the stream until the window closes', async () => {
    fakeClock();
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket', inMs(60_000), 1));
    expect(banner()).toBeInTheDocument();
    expect(screen.getByText('Live Cricket · tap to play')).toBeInTheDocument();
    expect(screen.getByText('1:00')).toBeInTheDocument();
    await tick(3000);
    act(() => ref.current!.notify('q1', 'Live Cricket', inMs(57_000), 1)); // a second push restarts the timer
    await tick(7000);
    expect(banner()).toBeInTheDocument();
    await tick(1000);
    expect(banner()).toBeNull();
    // The quiz is still open: a pill keeps it one tap away, with the time left
    const pill = screen.getByRole('button', { name: 'Play live quiz Live Cricket, 0:49 left' });
    expect(pill).toHaveTextContent('Live quiz · 0:49');
    await tick(49_000);
    expect(screen.queryByRole('button', { name: /Play live quiz/ })).toBeNull();
  });

  it('slides in on the next frame; without an answering window, closing it leaves nothing behind', async () => {
    fakeClock();
    const { container } = setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    expect(container.querySelector('.lq-banner')).not.toHaveClass('show');
    await tick(20);
    expect(container.querySelector('.lq-banner')).toHaveClass('show');
    // No countdown to show: the lightning icon instead of the ring
    expect(container.querySelector('.lq-ring')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    await tick(8000);
    expect(container).toBeEmptyDOMElement();
  });

  it('closing the banner keeps the pill while the quiz is open', () => {
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket', inMs(60_000), 0));
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    expect(banner()).toBeNull();
    expect(screen.getByRole('button', { name: /Play live quiz Live Cricket/ })).toBeInTheDocument();
  });

  it('chimes and buzzes when the bell sound is on, and stays quiet when it is off', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate });
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    expect(h.chime).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([90, 50, 90]);
    h.soundOn = false;
    act(() => ref.current!.announce('u1', 'Toss', null));
    expect(h.chime).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    // A browser without vibration (iOS) just chimes
    h.soundOn = true;
    act(() => ref.current!.notify('q2', 'Second'));
    expect(h.chime).toHaveBeenCalledTimes(2);
  });
});

describe('LiveQuizPush: answering', () => {
  it('opens from the banner, answers every question and locks the answer', async () => {
    const { onAnswered } = setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    fireEvent.click(screen.getByText('New quiz just dropped'));
    expect(await screen.findByText('1. Who?')).toBeInTheDocument();
    expect(h.fetchWithRetry).toHaveBeenCalledWith('/api/quizzes/q1', undefined, { retries: 3 });
    const submit = screen.getByRole('button', { name: 'Answer all 2 questions' });
    expect(submit).toBeDisabled();
    // Each question is a group of options named by the question
    const who = screen.getByRole('radiogroup', { name: '1. Who?' });
    expect(within(who).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(['Babar', 'Rizwan']);
    expect(screen.getByRole('radiogroup', { name: '2. When?' })).toBeInTheDocument();
    fireEvent.click(option('Rizwan'));
    fireEvent.click(option('1992'));
    expect(option('Rizwan')).toBeChecked();
    expect(option('Rizwan').closest('label')).toHaveClass('picked');
    expect(option('Babar')).not.toBeChecked();

    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    expect(await screen.findByText('Answer locked in — waiting for results')).toBeInTheDocument();
    const [url, init, opts] = h.fetchWithRetry.mock.calls.at(-1)!;
    expect(url).toBe('/api/quizzes/q1/submit');
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(JSON.parse(init.body)).toEqual({ answers: [{ questionId: 'a', selectedOption: 1 }, { questionId: 'b', selectedOption: 0 }] });
    expect(opts).toEqual({ retries: 4, retryOn: [502, 503, 504] });
    expect(h.toast.success).toHaveBeenCalledWith('Answer locked in!');
    expect(onAnswered).toHaveBeenCalled();
    // Locked in: the answers are final, and every option says so
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    fireEvent.click(screen.getByText('Babar'));
    expect(option('Babar')).not.toBeChecked();
    expect(option('Rizwan')).toBeChecked();
    expect(option('Rizwan').closest('label')).toHaveClass('locked');
  });

  it('shows the time left on the server clock, and when it has run out', async () => {
    fakeClock();
    // The device runs 5 s slow: the countdown follows the server's clock
    h.fetchWithRetry.mockImplementation(async () => jsonResponse({ quiz: { ...quiz, duration: 2, endsAt: new Date(T0 + 65_000).toISOString(), serverNow: T0 + 5_000 } }));
    const { container } = setup();
    act(() => ref.current!.open('q1'));
    await flush();
    expect(screen.getByText('1:00 left')).toBeInTheDocument();
    expect((container.querySelector('.qp-progress span') as HTMLElement).style.width).toBe('50%');
    await tick(60_000);
    expect(screen.getByText("Time's up")).toHaveClass('over');
    // Nothing was answered, so nothing is locked in at the deadline
    await tick(15_000);
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
    // Closed, a quiz whose time is up leaves no pill behind
    fireEvent.click(screen.getByTitle('Close'));
    expect(container).toBeEmptyDOMElement();
  });

  it('reopens from the pill without loading the quiz again', async () => {
    h.fetchWithRetry.mockImplementation(async () => jsonResponse({ quiz: { ...quiz, duration: 1, endsAt: inMs(60_000) } }));
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket', inMs(60_000), 1));
    fireEvent.click(screen.getByText('New quiz just dropped'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Babar'));
    fireEvent.click(screen.getByTitle('Close'));
    fireEvent.click(screen.getByRole('button', { name: /Play live quiz/ }));
    expect(option('Babar')).toBeChecked();
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps answers across close and reopen, and toggles split view', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    expect(await screen.findByText('1. Who?')).toBeInTheDocument();
    fireEvent.click(option('Babar'));
    fireEvent.click(screen.getByTitle('Split view'));
    expect(screen.getByText('Split view: the stream keeps playing beside the quiz.')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Back to popup'));
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.queryByText('1. Who?')).toBeNull();
    act(() => ref.current!.open('q1'));
    expect(await screen.findByRole('radio', { name: 'Babar' })).toBeChecked();

    const panel = screen.getByText('1. Who?').closest('.quiz-pop')!;
    fireEvent.click(screen.getByText('1. Who?'));
    expect(screen.getByText('1. Who?')).toBeInTheDocument();
    fireEvent.click(panel);
    expect(screen.queryByText('1. Who?')).toBeNull();
  });

  it('opens beside or under the video on phones, and as a popup modal in fullscreen', async () => {
    window.innerWidth = 500;
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    fireEvent.click(screen.getByText('New quiz just dropped'));
    expect(await screen.findByText('Split view: the stream keeps playing beside the quiz.')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Close'));
    act(() => ref.current!.open('q2'));
    expect(await screen.findByText('Split view: the stream keeps playing beside the quiz.')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Close'));

    // In fullscreen: the popup modal floats over the stream
    window.innerWidth = 1600;
    document.body.insertAdjacentHTML('beforeend', `<div ${STREAM_FULLSCREEN_ATTR}="immersive"></div>`);
    act(() => ref.current!.open('q3'));
    expect(await screen.findByText('Popup mode: the quiz floats above the stream.')).toBeInTheDocument();
  });

  it('a new push of the same quiz starts fresh and loads it once', async () => {
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    fireEvent.click(screen.getByText('New quiz just dropped'));
    await screen.findByText('1. Who?');
    fireEvent.click(screen.getByTitle('Close'));
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    h.fetchWithRetry.mockClear();
    fireEvent.click(screen.getByText('New quiz just dropped'));
    await screen.findByText('1. Who?');
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('replaces an open quiz the viewer has not started, or has already locked in', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    act(() => ref.current!.notify('q2', 'Second'));
    expect(screen.queryByText('1. Who?')).toBeNull();
    expect(screen.getByText('Second · tap to play')).toBeInTheDocument();

    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Babar'));
    fireEvent.click(option('2009'));
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({}));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    await screen.findByText('Answer locked in — waiting for results');
    act(() => ref.current!.notify('q3', 'Third'));
    expect(screen.queryByText('1. Who?')).toBeNull();
    expect(screen.getByText('Third · tap to play')).toBeInTheDocument();
  });
});

describe('LiveQuizPush: answering with the keyboard', () => {
  it('answers with Tab, Space and the arrow keys, and locks in with Enter', async () => {
    const user = userEvent.setup();
    const { onAnswered } = setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    // Past the panel's split view and close buttons to the first question, which nothing is picked in yet
    await user.tab();
    await user.tab();
    await user.tab();
    expect(option('Babar')).toHaveFocus();
    expect(option('Babar')).not.toBeChecked();
    await user.keyboard(' ');
    expect(option('Babar')).toBeChecked();
    // An arrow key moves to the next option and picks it, wrapping round at the end
    await user.keyboard('{ArrowDown}');
    expect(option('Rizwan')).toHaveFocus();
    expect(option('Rizwan')).toBeChecked();
    expect(option('Babar')).not.toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(option('Babar')).toBeChecked();
    await user.keyboard('{ArrowUp}');
    expect(option('Rizwan')).toBeChecked();
    // Tab leaves the question for the next one, whose own picks don't touch the first
    await user.tab();
    expect(option('1992')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(option('2009')).toHaveFocus();
    expect(option('2009')).toBeChecked();
    expect(option('Rizwan')).toBeChecked();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Lock in answer' })).toHaveFocus();
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Answer locked in — waiting for results')).toBeInTheDocument();
    expect(JSON.parse(h.fetchWithRetry.mock.calls.at(-1)![1].body)).toEqual({ answers: [{ questionId: 'a', selectedOption: 1 }, { questionId: 'b', selectedOption: 1 }] });
    expect(onAnswered).toHaveBeenCalled();
  });

  it('a question already answered is entered at the picked option', async () => {
    const user = userEvent.setup();
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Rizwan'));
    screen.getByTitle('Close').focus();
    await user.tab();
    expect(option('Rizwan')).toHaveFocus();
  });

  it('once locked in, the options are out of reach of the keyboard', async () => {
    const user = userEvent.setup();
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Babar'));
    fireEvent.click(option('2009'));
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    await screen.findByText('Answer locked in — waiting for results');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    // Tab goes from the close button straight out of the panel, past every option
    screen.getByTitle('Close').focus();
    await user.tab();
    expect(screen.getAllByRole('radio')).not.toContain(document.activeElement);
    expect(option('Babar')).toBeChecked();
  });
});

describe('LiveQuizPush: a push while the viewer is mid-answer', () => {
  const midAnswer = async () => {
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Babar'));
  };

  it('waits as "next" instead of wiping their answers, until they play it', async () => {
    await midAnswer();
    act(() => ref.current!.notify('q2', 'Second', inMs(60_000), 1));
    expect(option('Babar')).toBeChecked();
    expect(banner()).toBeNull();
    expect(screen.getByText('Second')).toBeInTheDocument();
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ quiz: { id: 'q2', title: 'Second', questions: [{ id: 'c', text: 'Where?', options: ['Lahore', 'Karachi'] }] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Play it now' }));
    expect(await screen.findByText('1. Where?')).toBeInTheDocument();
    expect(h.fetchWithRetry).toHaveBeenLastCalledWith('/api/quizzes/q2', undefined, { retries: 3 });
    expect(screen.queryByText('Play it now')).toBeNull();
  });

  it('comes up as a banner once they close the quiz', async () => {
    await midAnswer();
    act(() => ref.current!.notify('q2', 'Second'));
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.getByText('Second · tap to play')).toBeInTheDocument();
    // Their answers to the first quiz went with it: it was replaced, as a new push always does
    fireEvent.click(screen.getByText('New quiz just dropped'));
    expect(h.fetchWithRetry).toHaveBeenLastCalledWith('/api/quizzes/q2', undefined, { retries: 3 });
    expect(await screen.findByText('1. Who?')).toBeInTheDocument();
    expect(option('Babar')).not.toBeChecked();
  });

  it('pushed again, the same quiz keeps their answers and just gets its new window', async () => {
    await midAnswer();
    act(() => ref.current!.notify('q1', 'Live Cricket', inMs(120_000), 2));
    expect(option('Babar')).toBeChecked();
    expect(screen.getByText('2:00 left')).toBeInTheDocument();
    expect(screen.queryByText('Play it now')).toBeNull();
  });
});

describe('LiveQuizPush: upcoming quizzes', () => {
  it('announces with a countdown to the start, then shrinks to a pill until it starts', async () => {
    fakeClock();
    setup();
    act(() => ref.current!.announce('u1', 'Toss prediction', inMs(10 * 60_000)));
    expect(screen.getByText('Upcoming quiz: Toss prediction')).toBeInTheDocument();
    expect(screen.getByText('Starts in 10:00 · stay on the stream')).toBeInTheDocument();
    await tick(20);
    expect(document.querySelector('.lq-banner.upcoming')).toHaveClass('show');
    await tick(7980);
    const pill = screen.getByRole('button', { name: 'Upcoming quiz Toss prediction, starts in 9:52' });
    expect(pill).toHaveTextContent('Next quiz in 9:52');
    // The pill brings the banner back; its X puts it away again
    fireEvent.click(pill);
    expect(screen.getByText('Upcoming quiz: Toss prediction')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    expect(screen.getByRole('button', { name: /Upcoming quiz Toss prediction/ })).toBeInTheDocument();
    await tick(10 * 60_000);
    expect(screen.queryByRole('button', { name: /Upcoming quiz/ })).toBeNull();
  });

  it('without a start time it says "soon" and stays', async () => {
    fakeClock();
    setup();
    act(() => ref.current!.announce('u1', 'Toss prediction', null));
    expect(screen.getByText('Starts soon · stay on the stream')).toBeInTheDocument();
    await tick(60 * 60_000);
    expect(screen.getByRole('button', { name: 'Upcoming quiz Toss prediction, starts soon' })).toBeInTheDocument();
  });

  it('waits behind a live quiz, and ends when that quiz goes live', async () => {
    setup();
    act(() => ref.current!.notify('q1', 'Live Cricket', inMs(60_000), 1));
    act(() => ref.current!.announce('u1', 'Toss prediction', inMs(10 * 60_000)));
    // The live banner stays; the announcement is a pill beside it
    expect(banner()).toBeInTheDocument();
    expect(screen.queryByText('Upcoming quiz: Toss prediction')).toBeNull();
    expect(screen.getByRole('button', { name: /Upcoming quiz Toss prediction/ })).toBeInTheDocument();
    // Another quiz going live leaves it; this one going live ends it
    act(() => ref.current!.notify('q2', 'Second'));
    expect(screen.getByRole('button', { name: /Upcoming quiz Toss prediction/ })).toBeInTheDocument();
    act(() => ref.current!.notify('u1', 'Toss prediction'));
    expect(screen.queryByRole('button', { name: /Upcoming quiz/ })).toBeNull();
  });

  it('stays quiet while a quiz is open, and shows once it closes', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    act(() => ref.current!.announce('u1', 'Toss prediction', inMs(10 * 60_000)));
    expect(screen.queryByText(/Toss prediction/)).toBeNull();
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.getByRole('button', { name: /Upcoming quiz Toss prediction/ })).toBeInTheDocument();
  });
});

describe('LiveQuizPush: loading and submitting', () => {
  it('explains why a quiz could not be loaded', async () => {
    setup();
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ upcoming: true, startsAt: '2026-10-20T15:00:00Z' }, 403));
    act(() => ref.current!.open('q1'));
    expect(await screen.findByText(/hasn't started yet/)).toBeInTheDocument();
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ error: 'Quiz ended' }, 410));
    act(() => ref.current!.open('q2'));
    expect(await screen.findByText('Quiz ended')).toBeInTheDocument();
    h.fetchWithRetry.mockResolvedValueOnce(new Response('not json', { status: 500 }));
    act(() => ref.current!.open('q3'));
    expect(await screen.findByText('This quiz is no longer available')).toBeInTheDocument();
    h.fetchWithRetry.mockRejectedValueOnce(new Error('offline'));
    act(() => ref.current!.open('q4'));
    expect(await screen.findByText('offline')).toBeInTheDocument();
    h.fetchWithRetry.mockRejectedValueOnce('odd');
    act(() => ref.current!.open('q5'));
    expect(await screen.findByText('Failed to load quiz')).toBeInTheDocument();
    // a failed load is not retried by reopening from the banner path
    act(() => ref.current!.notify('q5', 'Again'));
    h.fetchWithRetry.mockClear();
    h.fetchWithRetry.mockRejectedValueOnce('odd');
    fireEvent.click(screen.getByText('New quiz just dropped'));
    expect(await screen.findByText('Failed to load quiz')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Close'));
    fireEvent.click(document.body);
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('opens from the shared cached copy when the page allows it, and from the personal route otherwise', async () => {
    const shared = vi.fn(async () => jsonResponse({ quiz }));
    vi.stubGlobal('fetch', shared);
    ref = createRef<LiveQuizPushHandle>();
    render(<LiveQuizPush ref={ref} canUseSharedCopy={(id) => id !== 'q9'} />);

    act(() => ref.current!.open('q1'));
    expect(await screen.findByText('1. Who?')).toBeInTheDocument();
    expect(shared).toHaveBeenCalledWith('/api/live/quizzes/q1', { credentials: 'omit' });
    expect(h.fetchWithRetry).not.toHaveBeenCalled();

    // "Not started yet" from the copy is shown as it is
    shared.mockResolvedValueOnce(jsonResponse({ upcoming: true, startsAt: '2026-10-20T15:00:00Z' }, 409));
    act(() => ref.current!.open('q2'));
    expect(await screen.findByText(/hasn't started yet/)).toBeInTheDocument();
    expect(h.fetchWithRetry).not.toHaveBeenCalled();

    // A refusal (the wallet came on), an error or no network: the personal route answers instead
    shared.mockResolvedValueOnce(jsonResponse({ personal: true }, 403));
    act(() => ref.current!.open('q3'));
    await waitFor(() => expect(h.fetchWithRetry).toHaveBeenCalledWith('/api/quizzes/q3', undefined, { retries: 3 }));
    expect(await screen.findByText('1. Who?')).toBeInTheDocument();
    shared.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => ref.current!.open('q4'));
    await waitFor(() => expect(h.fetchWithRetry).toHaveBeenCalledWith('/api/quizzes/q4', undefined, { retries: 3 }));

    // A quiz the page does not allow goes straight to the personal route
    shared.mockClear();
    act(() => ref.current!.open('q9'));
    await waitFor(() => expect(h.fetchWithRetry).toHaveBeenCalledWith('/api/quizzes/q9', undefined, { retries: 3 }));
    expect(shared).not.toHaveBeenCalled();
  });

  it('reports submit failures and allows another try', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Babar'));
    fireEvent.click(option('2009'));
    const lock = () => fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));

    h.getCSRFToken.mockResolvedValueOnce(null);
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ error: 'Too many submissions' }, 429));
    lock();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Too many submissions'));
    expect(h.fetchWithRetry.mock.calls.at(-1)![1].headers['X-CSRF-Token']).toBe('');
    h.fetchWithRetry.mockResolvedValueOnce(new Response('x', { status: 500 }));
    lock();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to submit'));
    h.fetchWithRetry.mockRejectedValueOnce(new Error('network down'));
    lock();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('network down'));
    h.fetchWithRetry.mockRejectedValueOnce('odd');
    lock();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to submit your answer'));
    expect(screen.getByRole('button', { name: 'Lock in answer' })).toBeEnabled();
  });

  it('locks in what was answered when time runs out, after a random wait inside the grace period', async () => {
    fakeClock();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // 7.5 s into the 15 s spread
    h.fetchWithRetry.mockImplementation(async () => jsonResponse({ quiz: { ...quiz, duration: 1, endsAt: inMs(60_000) } }));
    const { onAnswered } = setup();
    act(() => ref.current!.open('q1'));
    await flush();
    fireEvent.click(option('Babar')); // only the first of two questions
    await tick(59_500);
    // Past the deadline, before the countdown's next tick shows it: a late pick changes nothing
    act(() => vi.setSystemTime(T0 + 60_000));
    fireEvent.click(option('2009'));
    expect(option('2009')).not.toBeChecked();
    await tick(500);
    expect(screen.getByText("Time's up")).toBeInTheDocument();
    // The answers are final now, and every option says so
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(option('Babar')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Submitting...' })).toBeDisabled();

    h.fetchWithRetry.mockClear();
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await tick(6_000);
    expect(h.fetchWithRetry).not.toHaveBeenCalled();
    await tick(2_000);
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.fetchWithRetry.mock.calls[0][1].body)).toEqual({ answers: [{ questionId: 'a', selectedOption: 0 }] });
    expect(screen.getByText('Answer locked in — waiting for results')).toBeInTheDocument();
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 1 answer was locked in.");
    expect(onAnswered).toHaveBeenCalled();
  });

  it('locks in at the deadline with the panel closed too, once per answering window', async () => {
    fakeClock();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    h.fetchWithRetry.mockImplementation(async () => jsonResponse({ quiz: { ...quiz, duration: 1, endsAt: inMs(60_000) } }));
    setup();
    act(() => ref.current!.open('q1'));
    await flush();
    fireEvent.click(option('Babar'));
    fireEvent.click(option('2009'));
    fireEvent.click(screen.getByTitle('Close'));
    h.fetchWithRetry.mockClear();
    h.fetchWithRetry.mockResolvedValue(jsonResponse({ ok: true }));
    await tick(61_000);
    await tick(1_000); // the deadline effect runs once the first act ends, then its timer
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 2 answers were locked in.");
    await tick(30_000);
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('reports a refused deadline lock-in, and Lock in then says the time is up without submitting', async () => {
    fakeClock();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    h.fetchWithRetry.mockImplementation(async () => jsonResponse({ quiz: { ...quiz, duration: 1, endsAt: inMs(60_000) } }));
    setup();
    act(() => ref.current!.open('q1'));
    await flush();
    fireEvent.click(option('Babar'));
    fireEvent.click(option('2009'));
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ error: 'This quiz has ended and no longer accepts answers.' }, 403));
    await tick(61_000);
    await tick(1_000); // the deadline effect runs once the first act ends, then its timer
    expect(h.toast.error).toHaveBeenCalledWith('This quiz has ended and no longer accepts answers.');
    h.fetchWithRetry.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    await flush();
    expect(h.toast.error).toHaveBeenCalledWith('The time is up for the quiz. You cannot lock in answer.');
    expect(h.fetchWithRetry).not.toHaveBeenCalled();
    expect(screen.queryByText('Answer locked in — waiting for results')).toBeNull();
  });

  it('says the time is up when a last-second submit is refused after the window closed', async () => {
    fakeClock();
    h.fetchWithRetry.mockImplementation(async () => jsonResponse({ quiz: { ...quiz, duration: 1, endsAt: inMs(60_000) } }));
    setup();
    act(() => ref.current!.open('q1'));
    await flush();
    fireEvent.click(option('Babar'));
    fireEvent.click(option('2009'));
    await tick(59_000);
    let release!: (r: Response) => void;
    h.fetchWithRetry.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    await tick(2000);
    await act(async () => release(jsonResponse({ error: 'Quiz not found or inactive' }, 404)));
    expect(h.toast.error).toHaveBeenCalledWith('The time is up for the quiz. You cannot lock in answer.');
  });

  it('says entries have closed, without submitting, once the page saw the quiz full', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Babar'));
    fireEvent.click(option('2009'));
    // Another quiz being full changes nothing here
    act(() => ref.current!.setEntriesClosed('other', true));
    h.fetchWithRetry.mockClear();
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ error: 'Entries for this quiz have closed.' }, 403));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Entries for this quiz have closed.'));
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1); // the server said so

    act(() => ref.current!.setEntriesClosed('q1', true));
    h.fetchWithRetry.mockClear();
    h.toast.error.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Entries for this quiz have closed.'));
    expect(h.fetchWithRetry).not.toHaveBeenCalled();
    expect(screen.queryByText('Answer locked in — waiting for results')).toBeNull();

    // The limit was raised: the next live check reopens it
    act(() => ref.current!.setEntriesClosed('q1', false));
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    expect(await screen.findByText('Answer locked in — waiting for results')).toBeInTheDocument();
  });

  it('keeps a quiz open to a viewer whose own lock-in filled it, whatever the next live check says', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Babar'));
    fireEvent.click(option('2009'));
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    await screen.findByText('Answer locked in — waiting for results');
    // The page's personal list hasn't caught up yet, so it still says "full" for this viewer
    act(() => ref.current!.setEntriesClosed('q1', true));
    // A question added later and pushed again: they can answer it
    act(() => ref.current!.notify('q1', 'Live Cricket'));
    fireEvent.click(screen.getByText('New quiz just dropped'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Rizwan'));
    fireEvent.click(option('1992'));
    h.fetchWithRetry.mockClear();
    h.fetchWithRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    await waitFor(() => expect(h.fetchWithRetry).toHaveBeenCalledWith('/api/quizzes/q1/submit', expect.anything(), expect.anything()));
    expect(h.toast.error).not.toHaveBeenCalledWith('Entries for this quiz have closed.');
  });

  it('ignores a submit while one is in flight', async () => {
    setup();
    act(() => ref.current!.open('q1'));
    await screen.findByText('1. Who?');
    fireEvent.click(option('Babar'));
    fireEvent.click(option('2009'));
    let release!: (r: Response) => void;
    h.fetchWithRetry.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    const busy = await screen.findByRole('button', { name: 'Submitting...' });
    expect(busy).toBeDisabled();
    await act(async () => release(jsonResponse({})));
    expect(await screen.findByText('Answer locked in — waiting for results')).toBeInTheDocument();
  });
});

describe('LiveQuizPush: a live match over', () => {
  const RUNS = { id: 'r', text: 'Will over 7 go for 8 or more runs?', textRomanUrdu: 'Kya over 7 mein 8 ya zyada runs banenge?', options: ['Yes', 'No'], optionsRomanUrdu: ['Haan', 'Nahi'] };
  const WICKET = { id: 'w', text: 'Will a wicket fall in over 7?', textRomanUrdu: 'Kya over 7 mein koi wicket giray ga?', options: ['Yes', 'No'], optionsRomanUrdu: ['Haan', 'Nahi'] };
  const push = (over: Partial<MatchPush> = {}): MatchPush => ({
    key: 'm1:r+w', quizId: 'mq1', matchTitle: 'Lahore vs Karachi', over: 7, score: 'Lahore 48/2 (6.0 overs)',
    closesAtMs: Date.now() + 90_000, windowMs: 120_000, questions: [RUNS, WICKET],
    ...over,
  });
  const overBanner = (n = 7) => screen.queryByText(`Over ${n}: what will happen?`);
  const panel = (n = 7) => screen.getByRole('region', { name: `Over ${n} · Lahore vs Karachi` });
  const setupMatch = (onMatchLocked = vi.fn()) => {
    ref = createRef<LiveQuizPushHandle>();
    const onAnswered = vi.fn();
    render(<LiveQuizPush ref={ref} onAnswered={onAnswered} onMatchLocked={onMatchLocked} />);
    return { onAnswered, onMatchLocked };
  };

  it('pops up like a pushed quiz, counting down to 30 s before it closes, with Roman Urdu first and the score', async () => {
    fakeClock();
    setupMatch();
    act(() => ref.current!.match(push()));
    expect(overBanner()).toBeInTheDocument();
    expect(screen.getByText('Lahore vs Karachi · tap to play')).toBeInTheDocument();
    // 90 s until it closes, less the margin that gets the last answers there in time
    expect(screen.getByText('1:00')).toBeInTheDocument();
    expect(h.chime).toHaveBeenCalledTimes(1);
    fireEvent.click(overBanner()!);
    // Its questions came with it: nothing to load
    expect(h.fetchWithRetry).not.toHaveBeenCalled();
    expect(within(panel()).getByText('Lahore 48/2 (6.0 overs)')).toHaveClass('qp-score');
    const first = within(panel()).getByRole('radiogroup', { name: /Kya over 7 mein 8/ });
    expect(first).toHaveTextContent('1. Kya over 7 mein 8 ya zyada runs banenge?Will over 7 go for 8 or more runs?');
    expect(within(first).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(['Haan · Yes', 'Nahi · No']);
  });

  it('follows the same over checked again: its score, and its close time when the scorer reopens or closes it', async () => {
    fakeClock();
    setupMatch();
    act(() => ref.current!.match(push()));
    await tick(8000);
    expect(screen.getByRole('button', { name: /Play live quiz Over 7 · Lahore vs Karachi/ })).toHaveTextContent('Over 7 · 0:52');
    act(() => ref.current!.match(push({ score: 'Lahore 52/2 (6.2 overs)', closesAtMs: T0 + 150_000 })));
    // No second banner or chime; reopened, it has longer
    expect(overBanner()).toBeNull();
    expect(h.chime).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Play live quiz Over 7/ })).toHaveTextContent('Over 7 · 1:52');
    fireEvent.click(screen.getByRole('button', { name: /Play live quiz Over 7/ }));
    expect(within(panel()).getByText('Lahore 52/2 (6.2 overs)')).toBeInTheDocument();
    // Nothing new: nothing changes
    act(() => ref.current!.match(push({ score: 'Lahore 52/2 (6.2 overs)', closesAtMs: T0 + 150_000 })));
    // Closed early: time's up at once
    act(() => ref.current!.match(push({ score: 'Lahore 52/2 (6.2 overs)', closesAtMs: Date.now() })));
    await tick(1000);
    expect(within(panel()).getByText("Time's up")).toBeInTheDocument();
  });

  it("locks in to the match's quiz and tells the page, without the refresh a quiz's lock-in asks for", async () => {
    const { onAnswered, onMatchLocked } = setupMatch();
    h.fetchWithRetry.mockResolvedValue(jsonResponse({ message: 'ok' }));
    act(() => ref.current!.match(push()));
    fireEvent.click(overBanner()!);
    const [yesRuns, , , noWicket] = within(panel()).getAllByRole('radio');
    fireEvent.click(yesRuns);
    fireEvent.click(noWicket);
    fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Answer locked in!'));
    const [url, init] = h.fetchWithRetry.mock.calls[0];
    expect(url).toBe('/api/quizzes/mq1/submit');
    expect(JSON.parse(init.body)).toEqual({ answers: [{ questionId: 'r', selectedOption: 0 }, { questionId: 'w', selectedOption: 1 }] });
    expect(onMatchLocked).toHaveBeenCalledWith('mq1', ['r', 'w']);
    expect(onAnswered).not.toHaveBeenCalled();
    expect(screen.getByText(/Answer locked in/)).toBeInTheDocument();

    // The next over pops up fresh. English only without Roman Urdu, and options as they are without theirs
    act(() => ref.current!.match(push({
      key: 'm1:x+y', over: 8, questions: [
        { id: 'x', text: 'Will over 8 have a four or a six?', textRomanUrdu: null, options: ['Maybe'] },
        { id: 'y', text: 'Will a wicket fall in over 8?', textRomanUrdu: 'Kya over 8 mein koi wicket giray ga?', options: ['Yes', 'Shayad'], optionsRomanUrdu: ['Haan', null] },
      ],
    })));
    expect(overBanner(8)).toBeInTheDocument();
    fireEvent.click(overBanner(8)!);
    expect(within(panel(8)).getByText('1. Will over 8 have a four or a six?')).toBeInTheDocument();
    expect(within(panel(8)).getByRole('radio', { name: 'Maybe' })).not.toBeChecked();
    expect(within(panel(8)).getByRole('radio', { name: 'Haan · Yes' })).toBeInTheDocument();
    expect(within(panel(8)).getByRole('radio', { name: 'Shayad' })).toBeInTheDocument();
  });

  it('waits as "next" while the viewer is answering something else, comes with its questions, and follows its close time there', async () => {
    setupMatch();
    act(() => ref.current!.open('q1'));
    await waitFor(() => expect(option('Babar')).toBeInTheDocument());
    fireEvent.click(option('Babar'));
    act(() => ref.current!.match(push()));
    expect(screen.getByText('Over 7 · Lahore vs Karachi')).toBeInTheDocument();
    act(() => ref.current!.match(push({ score: 'Lahore 60/2 (6.4 overs)' })));
    h.fetchWithRetry.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Play it now' }));
    expect(within(panel()).getAllByRole('radio')).toHaveLength(4);
    expect(within(panel()).getByText('Lahore 60/2 (6.4 overs)')).toBeInTheDocument();
    expect(h.fetchWithRetry).not.toHaveBeenCalled();
  });

  it("doesn't wait behind an over whose time is up with nothing left to lock in", async () => {
    fakeClock();
    setupMatch();
    // Closed early with a pick left: no lock-in (the server would refuse it)
    act(() => ref.current!.match(push()));
    fireEvent.click(overBanner()!);
    fireEvent.click(within(panel()).getAllByRole('radio')[0]);
    act(() => ref.current!.match(push({ closesAtMs: Date.now() })));
    await tick(1000);
    expect(within(panel()).getByText("Time's up")).toBeInTheDocument();
    await tick(30_000);
    expect(h.fetchWithRetry).not.toHaveBeenCalled();
    // The next over takes its place at once
    act(() => ref.current!.match(push({ key: 'm1:x', over: 8, closesAtMs: Date.now() + 90_000, questions: [{ ...RUNS, id: 'x' }] })));
    expect(overBanner(8)).toBeInTheDocument();
    expect(screen.queryByText(/Next quiz ready/)).toBeNull();
  });

  it("doesn't pop an over up twice, even after another quiz took its place", async () => {
    setupMatch();
    act(() => ref.current!.match(push()));
    act(() => ref.current!.notify('q1', 'Live Cricket', inMs(60_000), 1));
    act(() => ref.current!.match(push({ score: 'Lahore 60/2 (6.4 overs)' })));
    expect(overBanner()).toBeNull();
    expect(banner()).toBeInTheDocument();
  });

  it('locks in the answers given over the 25 s after the countdown ends, before the over closes, unless it closed meanwhile', async () => {
    fakeClock();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    setupMatch();
    h.fetchWithRetry.mockResolvedValue(jsonResponse({ message: 'ok' }));
    act(() => ref.current!.match(push()));
    fireEvent.click(overBanner()!);
    fireEvent.click(within(panel()).getAllByRole('radio')[0]);
    await tick(60_000);
    expect(h.fetchWithRetry).not.toHaveBeenCalled();
    await tick(24_750);
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 1 answer was locked in.");

    // The scorer closes the next over while its lock-in waits: nothing is sent
    act(() => ref.current!.match(push({ key: 'm1:x', over: 8, closesAtMs: Date.now() + 90_000, questions: [{ ...RUNS, id: 'x' }] })));
    fireEvent.click(overBanner(8)!);
    fireEvent.click(within(panel(8)).getAllByRole('radio')[0]);
    await tick(60_000);
    act(() => ref.current!.match(push({ key: 'm1:x', over: 8, closesAtMs: Date.now() + 5_000, questions: [{ ...RUNS, id: 'x' }] })));
    await tick(6_000);
    act(() => ref.current!.match(push({ key: 'm1:x', over: 8, closesAtMs: Date.now() - 1_000, questions: [{ ...RUNS, id: 'x' }] })));
    await tick(30_000);
    expect(h.fetchWithRetry).toHaveBeenCalledTimes(1);
  });
});
