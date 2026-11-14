import '@/tests/helpers/ui';
/**
 * System test of the answer lock-in path, from a viewer's pick to the database:
 *   picks in the browser (LiveQuizPush, or the quiz page) -> fetchWithRetry -> CSRF token client ->
 *   POST /api/quizzes/[id]/submit (the real route) -> submit_quiz_attempt.
 *
 * Without the edge Worker there is no server-side buffer or batch: one lock-in is one request and one RPC,
 * written at once. What waits is the browser. Picks live only in React state until "Lock in"; when the countdown ends the
 * answers given are locked in after a random wait (up to 22 s for a quiz, inside the database's 30 s
 * grace; up to 25 s for a match over, before it closes), so a crowd's lock-ins arrive spread out instead of
 * all at once. A lock-in still waiting goes at once when the viewer leaves the page or the quiz makes way
 * for another. The quiz page keeps an offline submit in localStorage and sends it when the connection
 * returns.
 *
 * With the edge Worker (edge-shield/) in front, a quiz's lock-in stops at Cloudflare: the Worker answers
 * 202 "received", queues it, and a batch function saves it 0-2 minutes later (`drainQueue` here). It only
 * reads the session cookie, and answers 401 session_expired once the access token in it has lapsed: the
 * browser refreshes the session and sends once more. A live match's over goes through the queue too: every
 * player locks one in each over. The Worker's kill switch sends every submit to Hostinger as before: every
 * test without `edge`.
 *
 * Only the edges are stand-ins. The network is a fetch that hands submits to the route and can drop a
 * request, lose its response or answer for Cloudflare and Hostinger. The database is an in-memory
 * submit_quiz_attempt with the SQL's rules: one attempt per player and quiz, each answer written once
 * (ON CONFLICT DO NOTHING), the 30 s grace, a match question's closesAt, no answers to a question with
 * its result. db-tests/submit-quiz-attempt.test.ts checks those rules against Postgres, concurrent
 * double submits included.
 *
 * Tests named "KNOWN GAP" pin how answers are lost today and say what goes wrong; when a gap is fixed,
 * its test changes with the fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createRef } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { authOk, createSupabaseMock, routeParams, type QueryCall, type SupabaseMock } from '@/tests/helpers/supabase-mock';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  // The signed-in player of each submit; a function hands out one per request (a crowd of viewers)
  player: 'viewer-1' as string | (() => string),
  // The quiz page
  auth: { user: { id: 'viewer-1' }, isLoading: false },
  router: { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() },
  onExpire: null as null | (() => void),
  // The browser's Supabase client refreshing the session (src/lib/lock-in.ts)
  refreshSession: vi.fn(),
}));
let db: SupabaseMock;

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/notification-sound', () => ({ playChime: () => {}, isNotificationSoundOn: () => false }));
vi.mock('@/lib/supabase/db', () => ({ getDb: async () => db.client, getAdminDb: () => db.client }));
vi.mock('@/lib/auth-middleware', () => ({
  requireAuth: async () => authOk(typeof h.player === 'function' ? h.player() : h.player),
}));
// The server's check, as far as a lock-in meets it: a submit without a token is refused with its 403
vi.mock('@/lib/csrf-protection', () => ({
  requireCSRFToken: async (request: Request) => (request.headers.get('x-csrf-token')
    ? null
    : new Response(JSON.stringify({ error: 'CSRF validation failed', message: 'CSRF token missing' }), { status: 403 })),
}));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { quiz: 'quiz' }, applyRateLimit: async () => null }));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: () => {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({
  useRouter: () => h.router, useParams: () => ({ id: 'quiz-1' }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/quiz/quiz-1',
}));
vi.mock('@/hooks/useQuizCountdown', () => ({
  useQuizCountdown: (o: { onExpire: () => void }) => { h.onExpire = o.onExpire; return { timeRemaining: 60, windowClosed: false }; },
}));
vi.mock('@/components/LazyStreamPlayer', () => ({ default: () => null }));
vi.mock('@/components/QuizResults', () => ({ default: (p: { message: string }) => <p>{p.message}</p> }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { refreshSession: h.refreshSession } }) }));

import LiveQuizPush, { type LiveQuizPushHandle, type MatchPush } from '@/components/quiz/LiveQuizPush';
import QuizPage from '@/app/quiz/[id]/page';
import { POST } from '@/app/api/quizzes/[id]/submit/route';
import { clearCSRFTokenCache } from '@/lib/csrf';
import { quizStage } from '@/lib/quiz-stage';
import { QUIZ_ENDED_MESSAGE } from '@/lib/quiz-catalog';

const T0 = Date.parse('2026-11-04T15:00:00Z');
const GRACE_MS = 30_000;
const TIME_UP = 'The time is up for the quiz. You cannot lock in answer.';
const ENDED = 'This quiz has ended and no longer accepts answers.';

// ── The database: submit_quiz_attempt's rules, in memory ───────────────────────────────────────────
interface QuestionRow { id: string; text: string; options: string[]; status: 'active' | 'paused'; hasCorrectAnswer: boolean; closesAt: string | null; matchOver: number | null }
let quizRow: { id: string; status: string; pushedAt: string; duration: number; isMatch: boolean };
let questions: QuestionRow[];
const attempts = new Map<string, string>(); // player -> attempt id
const saved = new Map<string, number>(); // `${player}:${questionId}` -> option
/** What each RPC answered, in order */
let outcomes: Array<Record<string, unknown>>;
const playerOf = () => (typeof h.player === 'function' ? h.player() : h.player);
/** The server's clock minus this device's */
let serverAheadMs: number;
const serverNow = () => Date.now() + serverAheadMs;
const deadline = () => Date.parse(quizRow.pushedAt) + quizRow.duration * 60_000;

function submitQuizAttempt(args: Record<string, unknown>) {
  const player = args.p_user_id as string;
  const picks = args.p_answers as Array<{ questionId: string; selectedOption: number }>;
  const now = serverNow();
  const answer = (data: Record<string, unknown>) => {
    outcomes.push(data);
    return { data };
  };
  if (quizRow.status !== 'active') return answer({ success: false, code: 'not_found', error: 'Quiz not found or inactive' });
  if (!quizRow.isMatch && now > deadline() + GRACE_MS) return answer({ success: false, code: 'closed', error: ENDED });
  const open = (id: string) => questions.some((q) => q.id === id && q.status === 'active' && !q.hasCorrectAnswer
    && (q.closesAt === null || Date.parse(q.closesAt) > now));
  if (!picks.every((p) => open(p.questionId))) {
    return answer({ success: false, code: 'invalid', error: 'Invalid or closed question IDs in submission' });
  }
  const isReattempt = attempts.has(player);
  if (!isReattempt) attempts.set(player, `qa_${player}`);
  let inserted = 0;
  for (const p of picks) {
    const key = `${player}:${p.questionId}`;
    if (saved.has(key)) continue; // ON CONFLICT ("userId", "questionId") DO NOTHING
    saved.set(key, p.selectedOption);
    inserted++;
  }
  return answer({ success: true, attemptId: attempts.get(player), answersSubmitted: inserted, isReattempt, totalQuestions: questions.length });
}

/** The route's read of the submitted questions after an 'invalid' refusal */
function questionRows(call: QueryCall) {
  const ids = call.ops.find((o) => o.op === 'in')!.args[1] as string[];
  return { data: questions.filter((q) => ids.includes(q.id)).map(({ id, status, hasCorrectAnswer, closesAt, matchOver }) => ({ id, status, hasCorrectAnswer, closesAt, matchOver })) };
}

const question = (id: string, text: string, options: string[], over: Partial<QuestionRow> = {}): QuestionRow => ({
  id, text, options, status: 'active', hasCorrectAnswer: false, closesAt: null, matchOver: null, ...over,
});

/** A quiz pushed live at `pushedAt` (server time) with a one-minute answering window */
function liveQuiz(pushedAt = T0) {
  quizRow = { id: 'quiz-1', status: 'active', pushedAt: new Date(pushedAt).toISOString(), duration: 1, isMatch: false };
  questions = [question('a', 'Who?', ['Babar', 'Rizwan']), question('b', 'When?', ['1992', '2009'])];
}

/** A live match's over 7, whose questions close at `closesAt` */
function matchOver(closesAt: number) {
  quizRow = { id: 'quiz-1', status: 'active', pushedAt: new Date(T0).toISOString(), duration: 240, isMatch: true };
  const at = new Date(closesAt).toISOString();
  questions = [
    question('r', 'Will over 7 go for 8 or more runs?', ['Yes', 'No'], { closesAt: at, matchOver: 7 }),
    question('w', 'Will a wicket fall in over 7?', ['Out', 'Not out'], { closesAt: at, matchOver: 7 }),
  ];
}
const overPush = (closesAtMs: number): MatchPush => ({
  key: 'm1:r+w', quizId: 'quiz-1', matchTitle: 'Lahore vs Karachi', over: 7, score: 'Lahore 48/2 (6.0 overs)',
  closesAtMs, windowMs: 120_000, questions: questions.map(({ id, text, options }) => ({ id, text, options })),
});

const answersOf = (player: string) => Object.fromEntries([...saved]
  .filter(([key]) => key.startsWith(`${player}:`))
  .map(([key, option]) => [key.slice(player.length + 1), option]));

// ── The edge Worker (edge-shield/), when `edge` is on ─────────────────────────────────────────────
/** On: the Worker takes quiz lock-ins into its queue. Off: its kill switch, every submit reaches Hostinger */
let edge: boolean;
/** The access token in the session cookie has lapsed (the browser's refresh renews it) */
let sessionLapsed: boolean;
/** Lock-ins the Worker took, waiting for the batch function */
let queue: Array<{ player: string; quizId: string; answers: unknown }>;
/** The batch function: saves what the Worker queued, with submit_quiz_attempt's rules */
function drainQueue() {
  for (const item of queue.splice(0)) submitQuizAttempt({ p_user_id: item.player, p_quiz_id: item.quizId, p_answers: item.answers });
}

/** The Worker's answer to a submit it takes, or null when it passes the submit on to Hostinger */
function edgeWorker(quizId: string, init: RequestInit): Response | null {
  if (!edge || new Headers(init.headers).get('x-lockin-direct') === '1') return null;
  if (sessionLapsed) return jsonResponse({ error: 'Your session has expired', code: 'session_expired' }, 401);
  queue.push({ player: playerOf(), quizId, answers: JSON.parse(init.body as string).answers });
  return jsonResponse({ results: { status: 'received' } }, 202);
}

// ── The network: Cloudflare + Hostinger in front of the route ──────────────────────────────────────
type Fault = 'drop' | 'lost-response' | { status: number; retryAfter?: number; html?: boolean };
/** What the next submits meet, one each, before the route */
let faults: Fault[];
/** How many of the next /api/csrf-token requests are shed */
let csrfShed: number;
/** Every request, with the device time it left (ms after T0) and how it ended */
let traffic: Array<{ at: number; path: string; status: number | 'dropped' }>;
const submits = () => traffic.filter((t) => t.path.endsWith('/submit'));

function failure(f: { status: number; retryAfter?: number; html?: boolean }) {
  // Cloudflare's 52x pages and Hostinger's block page are HTML; a busy answer is the app's JSON with Retry-After
  return f.html
    ? new Response('<html><body>Error</body></html>', { status: f.status, headers: { 'content-type': 'text/html' } })
    : new Response(JSON.stringify({ error: 'Server is busy, please retry shortly', code: 'OVERLOADED' }), {
      status: f.status,
      headers: { 'content-type': 'application/json', ...(f.retryAfter ? { 'Retry-After': String(f.retryAfter) } : {}) },
    });
}

async function network(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  const log = (status: number | 'dropped') => traffic.push({ at: Date.now() - T0, path: url.pathname, status });
  if (url.pathname === '/api/csrf-token') {
    const res = csrfShed-- > 0 ? failure({ status: 503, retryAfter: 2 }) : jsonResponse({ csrfToken: 'csrf-token', expiresAt: Date.now() + 3_600_000 });
    log(res.status);
    return res;
  }
  const submit = /^\/api\/quizzes\/([^/]+)\/submit$/.exec(url.pathname);
  if (submit) {
    const atEdge = edgeWorker(submit[1], init);
    if (atEdge) {
      log(atEdge.status);
      return atEdge;
    }
    const fault = faults.shift();
    if (fault === 'drop') {
      log('dropped');
      throw new TypeError('Failed to fetch');
    }
    if (fault && fault !== 'lost-response') {
      const res = failure(fault);
      log(res.status);
      return res;
    }
    const res = await POST(new NextRequest(url, { method: init.method, headers: init.headers, body: init.body as string }), routeParams({ id: submit[1] }));
    if (fault === 'lost-response') {
      // Saved, then the connection broke before the answer reached the browser
      log('dropped');
      throw new TypeError('Failed to fetch');
    }
    log(res.status);
    return res;
  }
  // The quiz: the personal route sends the server's clock, the shared copy Cloudflare caches can't
  const id = url.pathname.split('/').pop()!;
  const shared = url.pathname.startsWith('/api/live/quizzes/');
  const endsAt = id === quizRow.id ? deadline() : T0 + 600_000;
  const res = jsonResponse({
    quiz: {
      id, title: id === quizRow.id ? 'Live Cricket' : 'Next quiz', description: 'Two questions', duration: quizRow.duration,
      questions: questions.map(({ id: qid, text, options }) => ({ id: qid, text, options })),
      endsAt: new Date(endsAt).toISOString(), ...(shared ? {} : { serverNow: serverNow() }),
    },
  });
  log(res.status);
  return res;
}

// ── Viewers of the live stream (LiveQuizPush) ──────────────────────────────────────────────────────
const fakeClock = () => vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/** Every random wait (the deadline spread, retry jitter) takes this fraction of its range */
const randomWait = (fraction: number) => vi.spyOn(Math, 'random').mockReturnValue(fraction);

function viewer(props: { canUseSharedCopy?: (quizId: string) => boolean } = {}) {
  const ref = createRef<LiveQuizPushHandle>();
  const { container, unmount } = render(<LiveQuizPush ref={ref} onAnswered={vi.fn()} onMatchLocked={vi.fn()} {...props} />);
  const view = within(container);
  return {
    ref,
    view,
    unmount,
    open: async (quizId = 'quiz-1') => {
      act(() => ref.current!.open(quizId));
      await tick(0);
    },
    pick: (...options: string[]) => options.forEach((name) => fireEvent.click(view.getByRole('radio', { name }))),
    lockIn: () => fireEvent.click(view.getByRole('button', { name: 'Lock in answer' })),
  };
}

beforeEach(() => {
  db = createSupabaseMock();
  db.setRpc('submit_quiz_attempt', submitQuizAttempt);
  db.setTable('Question', questionRows);
  attempts.clear();
  saved.clear();
  outcomes = [];
  serverAheadMs = 0;
  faults = [];
  csrfShed = 0;
  traffic = [];
  edge = false;
  sessionLapsed = false;
  queue = [];
  h.refreshSession.mockReset().mockImplementation(async () => {
    sessionLapsed = false;
    return { data: {}, error: null };
  });
  h.player = 'viewer-1';
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.router.push.mockReset();
  clearCSRFTokenCache();
  localStorage.clear();
  window.innerWidth = 1024;
  vi.stubGlobal('fetch', vi.fn(network));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  liveQuiz();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('answer lock-in: what waits, and where', () => {
  it('keeps picks in the browser until Lock in, which goes at once as one request and one RPC', async () => {
    fakeClock();
    const v = viewer();
    await v.open();
    v.pick('Babar', '2009');
    await tick(5_000);
    // Nothing has left the browser: no submit, no RPC, nothing saved, no copy kept on the device
    expect(submits()).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    expect(localStorage.length).toBe(0);

    v.lockIn();
    await tick(0);
    expect(submits()).toEqual([{ at: 5_000, path: '/api/quizzes/quiz-1/submit', status: 200 }]);
    expect(db.rpcCalls).toHaveLength(1);
    expect(answersOf('viewer-1')).toEqual({ a: 0, b: 1 });
    // The CSRF token the lock-in needs was fetched with it (and is kept for an hour), not as the quiz opened:
    // a crowd opening a quiz at once would all send one
    expect(traffic.filter((t) => t.path === '/api/csrf-token')).toEqual([{ at: 5_000, path: '/api/csrf-token', status: 200 }]);
    expect(h.toast.success).toHaveBeenCalledWith('Locked in. Your answers count.');
  });

  it("spreads a crowd's deadline lock-ins over 22 s, all inside the grace: one request and one RPC each, no batching", async () => {
    fakeClock();
    const crowd = 30;
    let n = 0;
    h.player = () => `viewer-${++n}`;
    const viewers = Array.from({ length: crowd }, () => viewer());
    for (const v of viewers) await v.open();
    // One of two answered: Lock in needs both, so only the deadline lock-in sends these
    for (const v of viewers) v.pick('Babar');
    // Each viewer's random wait, evenly across the spread
    let draw = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (draw++ + 0.5) / crowd);
    await tick(60_000);
    expect(submits()).toEqual([]);
    await tick(GRACE_MS);

    const arrivals = submits().map((s) => s.at - 60_000);
    expect(arrivals).toHaveLength(crowd);
    expect(submits().every((s) => s.status === 200)).toBe(true);
    expect(Math.min(...arrivals)).toBeGreaterThan(0);
    expect(Math.max(...arrivals)).toBeLessThan(22_000);
    // At most ceil(crowd / 22) a second, instead of the whole crowd in the first second
    const perSecond = new Map<number, number>();
    for (const a of arrivals) perSecond.set(Math.floor(a / 1000), (perSecond.get(Math.floor(a / 1000)) ?? 0) + 1);
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(Math.ceil(crowd / 22));
    // Writes are not reduced: every lock-in is its own RPC and its own attempt
    expect(db.rpcCalls).toHaveLength(crowd);
    expect(attempts.size).toBe(crowd);
    expect(saved.size).toBe(crowd);
  });

  it("spreads a crowd's lock-ins for a match over across the 25 s after its countdown, all before the over closes", async () => {
    fakeClock();
    matchOver(T0 + 90_000);
    const crowd = 25;
    let n = 0;
    h.player = () => `viewer-${++n}`;
    const viewers = Array.from({ length: crowd }, () => viewer());
    for (const v of viewers) {
      act(() => v.ref.current!.match(overPush(T0 + 90_000)));
      fireEvent.click(v.view.getByText('Over 7: what will happen?'));
      v.pick('Yes');
    }
    let draw = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (draw++ + 0.5) / crowd);
    // The countdown ends 30 s before the over closes
    await tick(60_000);
    expect(submits()).toEqual([]);
    await tick(30_000);

    const arrivals = submits().map((s) => s.at);
    expect(arrivals).toHaveLength(crowd);
    expect(submits().every((s) => s.status === 200)).toBe(true);
    expect(Math.max(...arrivals)).toBeLessThan(85_000); // 5 s before the over closes
    expect(saved.size).toBe(crowd);
  });
});

describe('answer lock-in: restarts, retries and duplicates', () => {
  it('a lock-in whose answer is lost after the database saved it (a restart mid-request) is sent again, saves nothing twice, and shows as locked in', async () => {
    fakeClock();
    const v = viewer();
    await v.open();
    v.pick('Babar', '2009');
    faults = ['lost-response'];
    v.lockIn();
    await tick(1_000);
    expect(submits().map((s) => s.status)).toEqual(['dropped', 200]);
    expect(outcomes).toEqual([
      expect.objectContaining({ success: true, answersSubmitted: 2, isReattempt: false }),
      expect.objectContaining({ success: true, answersSubmitted: 0, isReattempt: true }),
    ]);
    expect(attempts.size).toBe(1);
    expect(answersOf('viewer-1')).toEqual({ a: 0, b: 1 });
    expect(v.view.getByText('Answer locked in — waiting for results')).toBeInTheDocument();
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it('a deadline lock-in that meets Hostinger restarting (503 with Retry-After, then 502, then a dropped connection) is retried and saved inside the grace', async () => {
    fakeClock();
    randomWait(0.5); // 11 s into the spread; retry jitter half its step
    const v = viewer();
    await v.open();
    v.pick('Babar');
    faults = [{ status: 503, retryAfter: 3 }, { status: 502 }, 'drop'];
    await tick(60_000);
    await tick(GRACE_MS);
    expect(submits().map((s) => s.status)).toEqual([503, 502, 'dropped', 200]);
    expect(submits()[3].at).toBeLessThan(60_000 + GRACE_MS);
    expect(answersOf('viewer-1')).toEqual({ a: 0 });
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 1 answer was locked in.");
  });

  it("a deadline lock-in that meets Cloudflare's 522 (Hostinger down or restarting) is retried and saved inside the grace", async () => {
    fakeClock();
    randomWait(0); // sent the moment the countdown ends: 30 s of grace left
    const v = viewer();
    await v.open();
    v.pick('Babar', '2009');
    faults = [{ status: 522, html: true }, { status: 524, html: true }];
    await tick(60_000);
    await tick(1_000);
    expect(submits().map((s) => s.status)).toEqual([522, 524, 200]);
    expect(answersOf('viewer-1')).toEqual({ a: 0, b: 1 });
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 2 answers were locked in.");
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("a deadline lock-in that meets Hostinger's HTML 403 block (its ~100 req/s limit) is not retried, but Lock in sends it again while the server still takes it", async () => {
    fakeClock();
    randomWait(0);
    const v = viewer();
    await v.open();
    v.pick('Babar');
    faults = [{ status: 403, html: true }];
    await tick(60_000);
    await tick(1_000);
    // Retrying feeds the block, which lasts about 19 minutes
    expect(submits().map((s) => s.status)).toEqual([403]);
    expect(h.toast.error).toHaveBeenCalledWith('Failed to submit');

    // Only one of two answered, and time is up: Lock in sends the one answered
    v.lockIn();
    await tick(0);
    expect(submits().map((s) => s.status)).toEqual([403, 200]);
    expect(answersOf('viewer-1')).toEqual({ a: 0 });
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 1 answer was locked in.");
  });

  it('a lock-in late in the spread that is shed twice (503, Retry-After 6 s) cuts its last wait short, and arrives 2 s before the grace ends', async () => {
    fakeClock();
    randomWait(0.99); // 21.8 s into the spread
    const v = viewer();
    await v.open();
    v.pick('Babar');
    faults = [{ status: 503, retryAfter: 6 }, { status: 503, retryAfter: 6 }];
    await tick(60_000);
    await tick(40_000);
    expect(submits().map(({ at, status }) => [at, status])).toEqual([[81_780, 503], [87_780, 503], [88_000, 200]]);
    expect(answersOf('viewer-1')).toEqual({ a: 0 });
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 1 answer was locked in.");
  });

  it('a match lock-in late in its 25 s spread that is shed once (503, Retry-After 6 s) cuts its wait short, and reaches the over 2 s before it closes', async () => {
    fakeClock();
    matchOver(T0 + 90_000);
    randomWait(0.98); // 24.5 s into the spread: 5.5 s before the over closes
    const v = viewer();
    act(() => v.ref.current!.match(overPush(T0 + 90_000)));
    fireEvent.click(v.view.getByText('Over 7: what will happen?'));
    v.pick('Yes');
    faults = [{ status: 503, retryAfter: 6 }];
    await tick(60_000);
    await tick(40_000);
    expect(submits().map(({ at, status }) => [at, status])).toEqual([[84_500, 503], [88_000, 200]]);
    expect(answersOf('viewer-1')).toEqual({ r: 0 });
  });

  it('a lock-in shed until the server stops taking answers is not sent again after that', async () => {
    fakeClock();
    randomWait(0.99);
    const v = viewer();
    await v.open();
    v.pick('Babar', '2009');
    faults = Array.from({ length: 10 }, () => ({ status: 503, retryAfter: 6 }));
    await tick(60_000);
    await tick(40_000);
    expect(submits().map((s) => s.at)).toEqual([81_780, 87_780, 88_000]);
    expect(h.toast.error).toHaveBeenCalledWith('Server is busy, please retry shortly');
    // Its last chance passed with the grace: Lock in says so instead of sending
    v.lockIn();
    await tick(0);
    expect(h.toast.error).toHaveBeenLastCalledWith(TIME_UP);
    expect(submits()).toHaveLength(3);
  });

  it('KNOWN GAP: one closed question sinks the whole lock-in: nothing is saved, and the pop-up cannot send the rest again as the refusal asks', async () => {
    fakeClock();
    matchOver(T0 + 90_000);
    randomWait(0.5); // 12.5 s after the countdown
    const v = viewer();
    act(() => v.ref.current!.match(overPush(T0 + 90_000)));
    fireEvent.click(v.view.getByText('Over 7: what will happen?'));
    v.pick('Yes', 'Not out');
    await tick(60_000);
    // The scorer voids the wicket question while the lock-in waits
    questions = questions.map((q) => (q.id === 'w' ? { ...q, status: 'paused' as const } : q));
    await tick(15_000);
    expect(submits().map((s) => s.status)).toEqual([409]);
    expect(h.toast.error).toHaveBeenCalledWith('Too late for over 7: answers closed before yours arrived. Nothing was saved, so send your other answers again.');
    expect(saved.size).toBe(0);

    // The runs question is still open for 15 s, but Lock in says time is up
    v.lockIn();
    await tick(0);
    expect(h.toast.error).toHaveBeenLastCalledWith(TIME_UP);
    expect(submits()).toHaveLength(1);
  });

  it('fetches the CSRF token with the deadline lock-in and retries it when shed, so the lock-in still goes with one inside the grace', async () => {
    fakeClock();
    randomWait(0);
    csrfShed = 2;
    const v = viewer();
    await v.open();
    v.pick('Babar', '2009');
    // Nothing as the quiz opens
    expect(traffic.filter((t) => t.path === '/api/csrf-token')).toEqual([]);
    await tick(60_000);
    await tick(5_000);
    // Retry-After 2 s each time
    expect(traffic.filter((t) => t.path === '/api/csrf-token').map(({ at, status }) => [at, status])).toEqual([[60_000, 503], [62_000, 503], [64_000, 200]]);
    expect(submits().map(({ at, status }) => [at, status])).toEqual([[64_000, 200]]);
    expect(answersOf('viewer-1')).toEqual({ a: 0, b: 1 });
  });

  it('a lock-in sent without a CSRF token (the token request failed every time) is refused, and Lock in sends it again with a fresh one', async () => {
    fakeClock();
    randomWait(0);
    csrfShed = 4; // the one with the lock-in, tried 4 times
    const v = viewer();
    await v.open();
    v.pick('Babar', '2009');
    await tick(60_000);
    await tick(10_000);
    expect(submits().map((s) => s.status)).toEqual([403]);
    expect(h.toast.error).toHaveBeenCalledWith('CSRF validation failed');

    v.lockIn();
    await tick(0);
    expect(submits().map((s) => s.status)).toEqual([403, 200]);
    expect(answersOf('viewer-1')).toEqual({ a: 0, b: 1 });
  });

  it('KNOWN GAP: a second tab or device that locks in other picks is told "locked in", though only the first picks count', async () => {
    fakeClock();
    const phone = viewer();
    const laptop = viewer();
    await phone.open();
    await laptop.open();
    phone.pick('Babar', '1992');
    phone.lockIn();
    await tick(0);
    laptop.pick('Rizwan', '2009');
    laptop.lockIn();
    await tick(0);

    expect(submits().map((s) => s.status)).toEqual([200, 200]);
    expect(outcomes[1]).toMatchObject({ success: true, isReattempt: true, answersSubmitted: 0 });
    expect(answersOf('viewer-1')).toEqual({ a: 0, b: 0 });
    // The laptop shows its own picks as locked in
    expect(h.toast.success).toHaveBeenNthCalledWith(2, 'Locked in. Your answers count.');
    expect(laptop.view.getByRole('radio', { name: 'Rizwan' })).toBeChecked();
    expect(laptop.view.getByText('Answer locked in — waiting for results')).toBeInTheDocument();
  });
});

describe('answer lock-in: answers that never leave the browser', () => {
  /** Answered one of two, and time is up: the lock-in waits its random 11 s */
  async function waitingLockIn() {
    fakeClock();
    randomWait(0.5);
    const v = viewer();
    await v.open();
    v.pick('Babar');
    await tick(61_000);
    expect(v.view.getByRole('button', { name: 'Submitting...' })).toBeDisabled();
    return v;
  }

  /** The submit requests, as the browser was asked to send them */
  const submitInits = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/submit')).map(([, init]) => init);

  it('leaving the quizzes page while the deadline lock-in waits sends it at once, as a request that outlives the page', async () => {
    const v = await waitingLockIn();
    v.unmount();
    await tick(0);
    expect(submits()).toEqual([{ at: 61_000, path: '/api/quizzes/quiz-1/submit', status: 200 }]);
    expect(submitInits()).toEqual([expect.objectContaining({ keepalive: true })]);
    expect(answersOf('viewer-1')).toEqual({ a: 0 });
    // Shown on the page the viewer went to
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 1 answer was locked in.");
    await tick(GRACE_MS);
    expect(submits()).toHaveLength(1);
  });

  it('closing or reloading the tab while the deadline lock-in waits sends it at once, as a request that outlives the page', async () => {
    const v = await waitingLockIn();
    act(() => void window.dispatchEvent(new Event('pagehide')));
    await tick(0);
    expect(submits()).toEqual([{ at: 61_000, path: '/api/quizzes/quiz-1/submit', status: 200 }]);
    expect(submitInits()).toEqual([expect.objectContaining({ keepalive: true })]);
    expect(answersOf('viewer-1')).toEqual({ a: 0 });
    // A page kept in the back-forward cache shows it locked in when it comes back
    expect(v.view.getByText('Answer locked in — waiting for results')).toBeInTheDocument();
    await tick(GRACE_MS);
    expect(submits()).toHaveLength(1);
  });

  it('KNOWN GAP: closing the tab before the countdown ends loses the picks: nothing is kept or sent', async () => {
    fakeClock();
    const v = viewer();
    await v.open();
    v.pick('Babar');
    await tick(30_000);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    v.unmount();
    await tick(60_000);
    expect(submits()).toEqual([]);
    expect(saved.size).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('a quiz pushed while the deadline lock-in waits with the pop-up closed sends it at once, then takes its place afresh', async () => {
    fakeClock();
    randomWait(0.5);
    const v = viewer();
    await v.open();
    v.pick('Babar');
    fireEvent.click(v.view.getByTitle('Close'));
    await tick(63_000);
    // The deadline lock-in drew its random wait: it is due at 71 s
    expect(Math.random).toHaveBeenCalledTimes(1);
    act(() => v.ref.current!.notify('quiz-2', 'Next quiz', new Date(T0 + 600_000).toISOString(), 10));
    await tick(0);
    expect(submits()).toEqual([{ at: 63_000, path: '/api/quizzes/quiz-1/submit', status: 200 }]);
    expect(answersOf('viewer-1')).toEqual({ a: 0 });
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 1 answer was locked in.");

    // The new quiz is not locked in by the lock-in that went for the one before
    fireEvent.click(v.view.getByText('New quiz just dropped'));
    await tick(0);
    expect(v.view.getByRole('button', { name: 'Answer all 2 questions' })).toBeDisabled();
    expect(v.view.queryByText('Answer locked in — waiting for results')).toBeNull();
    await tick(GRACE_MS);
    expect(submits()).toHaveLength(1);
  });

  it('"Play it now" on the next quiz while the deadline lock-in waits sends it at once, then plays the next one afresh', async () => {
    const v = await waitingLockIn();
    act(() => v.ref.current!.notify('quiz-2', 'Next quiz', new Date(T0 + 600_000).toISOString(), 10));
    expect(v.view.getByText('Next quiz ready:')).toBeInTheDocument();
    fireEvent.click(v.view.getByRole('button', { name: 'Play it now' }));
    await tick(0);
    expect(submits()).toEqual([{ at: 61_000, path: '/api/quizzes/quiz-1/submit', status: 200 }]);
    expect(answersOf('viewer-1')).toEqual({ a: 0 });
    expect(v.view.getByRole('button', { name: 'Answer all 2 questions' })).toBeDisabled();
    expect(v.view.queryByText('Answer locked in — waiting for results')).toBeNull();
    await tick(GRACE_MS);
    expect(submits()).toHaveLength(1);
  });

  it('KNOWN GAP: a phone asleep through the deadline and the grace locks in when it wakes, and is refused', async () => {
    fakeClock();
    randomWait(0);
    const v = viewer();
    await v.open();
    v.pick('Babar');
    await tick(30_000);
    // Asleep: no timer runs while the clock moves on two minutes
    act(() => vi.setSystemTime(T0 + 150_000));
    await tick(1_000);
    await tick(1_000); // the deadline effect runs once the first act ends, then its timer
    expect(submits().map((s) => s.status)).toEqual([403]);
    expect(h.toast.error).toHaveBeenCalledWith(ENDED);
    expect(saved.size).toBe(0);
  });

  it('KNOWN GAP: a device clock 15 s slow ends the shared copy\'s countdown late, so a lock-in late in the spread misses the grace; the personal route corrects for it', async () => {
    fakeClock();
    // Pushed as this device's clock read T0: the server's clock already read T0 + 15 s
    serverAheadMs = 15_000;
    liveQuiz(T0 + 15_000);
    randomWait(0.8); // 17.6 s into the spread
    let n = 0;
    h.player = () => ['personal-route', 'shared-copy'][n++];
    const personal = viewer();
    const shared = viewer({ canUseSharedCopy: () => true });
    await personal.open();
    await shared.open();
    expect(traffic.map((t) => t.path).filter((path) => path !== '/api/csrf-token')).toEqual(['/api/quizzes/quiz-1', '/api/live/quizzes/quiz-1']);
    personal.pick('Babar');
    shared.pick('Rizwan');
    // Each act ends on a countdown's end, where its deadline effect runs
    await tick(60_000);
    await tick(15_000);
    await tick(GRACE_MS);

    // Device times: the grace ends at 90 s (server 105 s). The personal countdown ended at 60 s, the shared one at 75 s.
    expect(submits().map(({ at, status }) => [at, status])).toEqual([[77_600, 200], [92_600, 403]]);
    expect(answersOf('personal-route')).toEqual({ a: 0 });
    expect(answersOf('shared-copy')).toEqual({});
  });

  it('KNOWN GAP: answers given in time to a match over the scorer closes early are never sent, unless Lock in was pressed', async () => {
    fakeClock();
    matchOver(T0 + 150_000);
    randomWait(0);
    const v = viewer();
    act(() => v.ref.current!.match(overPush(T0 + 150_000)));
    fireEvent.click(v.view.getByText('Over 7: what will happen?'));
    // One of two answered: Lock in needs both
    v.pick('Yes');
    await tick(30_000);
    // Ball 5 of over 6 closes over 7's questions now; the next check of the feed shows it
    questions = questions.map((q) => ({ ...q, closesAt: new Date(Date.now()).toISOString() }));
    act(() => v.ref.current!.match(overPush(Date.now())));
    await tick(30_000);
    expect(v.view.getByText("Time's up")).toBeInTheDocument();
    expect(submits()).toEqual([]);
    expect(saved.size).toBe(0);
  });
});

describe('answer lock-in: results and settlement against lock-ins on their way', () => {
  it('results cannot be saved without "End quiz now" until the grace is over, so the last lock-in of the spread is in first', async () => {
    fakeClock();
    randomWait(0.9999); // the end of the spread: 22 s after the countdown
    const v = viewer();
    await v.open();
    v.pick('Babar');
    const stage = () => quizStage({ status: 'active', pushedAt: quizRow.pushedAt, duration: 1, settledAt: null, totalQuestions: 2, questionsWithResult: 0 }, Date.now());
    await tick(60_000);
    await tick(21_000);
    expect(submits()).toEqual([]);
    expect(stage()).toBe('open');
    await tick(1_000);
    expect(submits().map((s) => s.status)).toEqual([200]);
    expect(stage()).toBe('open');
    await tick(8_000);
    expect(stage()).toBe('awaiting_result');
  });

  it('KNOWN GAP: "End quiz now" at the deadline refuses the lock-ins still waiting in browsers, so they are never scored', async () => {
    fakeClock();
    randomWait(0.5);
    const v = viewer();
    await v.open();
    v.pick('Babar');
    await tick(62_000);
    // The admin saves the result with "End quiz now" while the crowd's lock-ins are still spread out
    questions = questions.map((q) => ({ ...q, hasCorrectAnswer: true }));
    await tick(15_000);
    expect(submits().map((s) => s.status)).toEqual([409]);
    expect(h.toast.error).toHaveBeenCalledWith(QUIZ_ENDED_MESSAGE);
    expect(saved.size).toBe(0);
  });
});

describe('answer lock-in: the edge Worker in front (edge-shield/)', () => {
  beforeEach(() => {
    edge = true;
  });

  it('a lock-in is received at once (202) and saved when the queue drains: nothing reaches Hostinger or the database before', async () => {
    fakeClock();
    const v = viewer();
    await v.open();
    v.pick('Babar', '2009');
    v.lockIn();
    await tick(0);
    expect(submits()).toEqual([{ at: 0, path: '/api/quizzes/quiz-1/submit', status: 202 }]);
    expect(h.toast.success).toHaveBeenCalledWith('Locked in. Your answers count.');
    expect(v.view.getByText('Answer locked in — waiting for results')).toBeInTheDocument();
    expect(db.rpcCalls).toEqual([]);
    expect(saved.size).toBe(0);

    // The batch function, 0-2 minutes later
    await tick(90_000);
    drainQueue();
    expect(answersOf('viewer-1')).toEqual({ a: 0, b: 1 });
    // Received is final: nothing is sent again
    expect(submits()).toHaveLength(1);
  });

  it("a crowd's deadline lock-ins are all received inside the 22 s spread, and the database sees none of them until the queue drains", async () => {
    fakeClock();
    const crowd = 20;
    let n = 0;
    h.player = () => `viewer-${++n}`;
    const viewers = Array.from({ length: crowd }, () => viewer());
    for (const v of viewers) await v.open();
    for (const v of viewers) v.pick('Babar');
    let draw = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (draw++ + 0.5) / crowd);
    await tick(60_000);
    await tick(GRACE_MS);

    expect(submits()).toHaveLength(crowd);
    expect(submits().every((s) => s.status === 202 && s.at < 82_000)).toBe(true);
    expect(h.toast.success).toHaveBeenCalledWith("Time's up: your 1 answer was locked in.");
    expect(db.rpcCalls).toEqual([]);
    drainQueue();
    expect(attempts.size).toBe(crowd);
    expect(saved.size).toBe(crowd);
  });

  it('a lapsed session (401 session_expired) is refreshed by the browser, and the lock-in is received on its second try', async () => {
    fakeClock();
    sessionLapsed = true;
    const v = viewer();
    await v.open();
    v.pick('Babar', '2009');
    v.lockIn();
    await tick(0);
    expect(submits().map((s) => s.status)).toEqual([401, 202]);
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
    expect(h.toast.success).toHaveBeenCalledWith('Locked in. Your answers count.');
    expect(h.toast.error).not.toHaveBeenCalled();
    drainQueue();
    expect(answersOf('viewer-1')).toEqual({ a: 0, b: 1 });
  });

  it('a session that cannot be refreshed (signed out elsewhere) is not sent again, and the viewer is told', async () => {
    fakeClock();
    sessionLapsed = true;
    h.refreshSession.mockResolvedValue({ data: {}, error: new Error('Invalid Refresh Token') });
    const v = viewer();
    await v.open();
    v.pick('Babar', '2009');
    v.lockIn();
    await tick(0);
    expect(submits().map((s) => s.status)).toEqual([401]);
    expect(h.toast.error).toHaveBeenCalledWith('Your session has expired');
    expect(queue).toEqual([]);
  });

  it("a live match's over goes through the queue like any lock-in, and is saved when the queue drains", async () => {
    fakeClock();
    matchOver(T0 + 90_000);
    const v = viewer();
    act(() => v.ref.current!.match(overPush(T0 + 90_000)));
    fireEvent.click(v.view.getByText('Over 7: what will happen?'));
    v.pick('Yes', 'Not out');
    v.lockIn();
    await tick(0);
    // Nothing reached Hostinger: the edge took it
    expect(submits().map((s) => s.status)).toEqual([202]);
    expect(queue).toHaveLength(1);
    expect(answersOf('viewer-1')).toEqual({});
    expect(h.toast.success).toHaveBeenCalledWith('Locked in. Your answers count.');
    drainQueue();
    expect(answersOf('viewer-1')).toEqual({ r: 0, w: 1 });
  });

  it('the quiz page counts a 202 as submitted, after refreshing a lapsed session, and shows the same words as a 200', async () => {
    vi.setSystemTime(T0);
    sessionLapsed = true;
    render(<QuizPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Start Quiz/ }));
    await screen.findByText('Who?');
    fireEvent.click(screen.getByRole('button', { name: /Babar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: /2009/ }));
    fireEvent.click(screen.getByRole('button', { name: /Submit Quiz/ }));
    expect(await screen.findByText('Locked in. Your answers count.')).toBeInTheDocument();
    expect(submits().map((s) => s.status)).toEqual([401, 202]);
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('1t2w_sub_quiz-1')).toBe('1');
    drainQueue();
    expect(answersOf('viewer-1')).toEqual({ a: 0, b: 1 });
  });
});

describe('answer lock-in: the quiz page', () => {
  const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  const start = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /Start Quiz/ }));
    await screen.findByText('Who?');
  };
  const choose = (option: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(option) }));

  beforeEach(() => {
    vi.setSystemTime(T0);
    setOnline(true);
  });
  afterEach(() => setOnline(true));

  it('KNOWN GAP: when time runs out the page sends nothing until the dialog is clicked; clicked after the grace, the answers are refused', async () => {
    render(<QuizPage />);
    await start();
    choose('Babar');
    vi.setSystemTime(T0 + 60_000);
    act(() => h.onExpire!());
    expect(screen.getByText(/submit the 1 question you answered/)).toBeInTheDocument();
    expect(submits()).toEqual([]);

    // The player looked away for 35 s
    vi.setSystemTime(T0 + 95_000);
    fireEvent.click(screen.getByRole('button', { name: 'View Results' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ENDED);
    expect(submits().map((s) => s.status)).toEqual([403]);
    expect(saved.size).toBe(0);
  });

  it('KNOWN GAP: answers kept offline and sent after the window are refused, then kept and sent again on every visit', async () => {
    const { unmount } = render(<QuizPage />);
    await start();
    choose('Babar');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    choose('2009');
    setOnline(false);
    fireEvent.click(screen.getByRole('button', { name: /Submit Quiz/ }));
    expect(await screen.findByText(/You are currently offline/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('pending_submit_quiz-1_viewer-1')!).answers).toHaveLength(2);

    // Back online two minutes later
    vi.setSystemTime(T0 + 120_000);
    setOnline(true);
    act(() => void window.dispatchEvent(new Event('online')));
    expect(await screen.findByText(/Failed to auto-submit answers/)).toBeInTheDocument();
    expect(localStorage.getItem('pending_submit_quiz-1_viewer-1')).not.toBeNull();
    unmount();

    render(<QuizPage />);
    await waitFor(() => expect(submits()).toHaveLength(2));
    expect(submits().map((s) => s.status)).toEqual([403, 403]);
    expect(saved.size).toBe(0);
  });
});
