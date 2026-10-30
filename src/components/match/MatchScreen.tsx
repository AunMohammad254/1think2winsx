'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Loader2, Lock, XCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useJitteredPolling } from '@/hooks/useJitteredPolling';
import { useNow } from '@/hooks/useNow';
import { getCSRFToken } from '@/lib/csrf';
import { fetchWithRetry } from '@/lib/fetch-retry';
import type { PublicMatch } from '@/lib/match-feed';
import { formatClock } from '@/lib/live-countdown';
import { byOver, clockOffset, closesAt, isOpen, tally, type FeedQuestion, type MyAnswers, type OverGroup } from '@/lib/match-play';

const STATUS: Record<PublicMatch['match']['status'], string> = {
  setup: 'Starting soon',
  live: 'Live',
  innings_break: 'Innings break',
  completed: 'Finished',
  abandoned: 'Abandoned',
};

// Ball by ball while the match is on (the feed is cached 3 s at the edge). Once it is over, only the
// settlement is left to see; before it is live (or once hidden) nothing changes often either
const LIVE_POLL_MS = 3_000;
const QUIET_POLL_MS = 30_000;
// A failed read of the player's earlier answers is tried again after this, doubling each time
const ANSWERS_RETRY_MS = 5_000;
const ANSWERS_RETRY_MAX_MS = 60_000;

// Match questions are Yes/No: Roman Urdu first, as in the questions
const OPTION_LABELS: Record<string, string> = { Yes: 'Haan · Yes', No: 'Nahi · No' };
const optionLabel = (option: string) => OPTION_LABELS[option] ?? option;

const card = 'glass-card glass-border rounded-2xl p-5';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

type Notice = { tone: 'ok' | 'error'; text: string };

function Wording({ question, large }: { question: FeedQuestion; large: boolean }) {
  const main = large ? 'text-lg font-semibold text-white' : 'font-medium text-white';
  return (
    <div className="space-y-1">
      {question.textRomanUrdu && <p className={main}>{question.textRomanUrdu}</p>}
      <p className={question.textRomanUrdu ? 'text-sm text-gray-400' : main}>{question.text}</p>
    </div>
  );
}

/** One over's open questions: pick, then Lock in (answers are final) */
function OpenOver({ group, now, answers, picks, late, canAnswer, sending, onPick, onLockIn }: {
  group: OverGroup;
  now: number;
  answers: MyAnswers;
  picks: MyAnswers;
  late: Set<string>;
  canAnswer: boolean;
  sending: boolean;
  onPick: (questionId: string, option: number) => void;
  onLockIn: (group: OverGroup) => void;
}) {
  const until = closesAt(group, now, late);
  const answerable = (q: FeedQuestion) => answers[q.id] === undefined && !late.has(q.id) && isOpen(q, now);
  const ready = group.questions.some((q) => answerable(q) && picks[q.id] !== undefined);
  const allAnswered = group.questions.every((q) => answers[q.id] !== undefined);
  return (
    <section aria-label={`Over ${group.over} predictions`} className={`${card} space-y-4 border-emerald-400/30`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-white">Over {group.over}: what will happen?</h2>
        {until !== null && (
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ${until - now < 20_000 ? 'bg-red-500/20 text-red-200' : 'bg-amber-500/20 text-amber-100'}`}>
            <Clock className="h-4 w-4" /> Closes in {formatClock(until - now)}
          </span>
        )}
      </div>
      <div className="divide-y divide-white/10">
      {group.questions.map((q) => {
        const mine = answers[q.id];
        return (
          <div key={q.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
            <Wording question={q} large />
            {mine !== undefined ? (
              <p className="inline-flex items-center gap-2 text-sm text-emerald-200"><Lock className="h-4 w-4" /> Your answer: {optionLabel(q.options[mine])}</p>
            ) : late.has(q.id) || !isOpen(q, now) ? (
              <p className="text-sm text-gray-400">Closed: answers for this one are in.</p>
            ) : (
              <div role="radiogroup" aria-label={q.text} className="grid grid-cols-2 gap-3">
                {q.options.map((option, index) => (
                  <button key={option} type="button" role="radio" aria-checked={picks[q.id] === index} disabled={!canAnswer || sending}
                    onClick={() => onPick(q.id, index)}
                    className={`${button} border-2 ${picks[q.id] === index ? 'border-emerald-400 bg-emerald-500/25 text-white' : 'border-gray-600 bg-gray-800/60 text-gray-200 hover:border-gray-400'}`}>
                    {optionLabel(option)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>
      {canAnswer && !allAnswered && (
        <div className="space-y-2">
          <button type="button" disabled={!ready || sending} onClick={() => onLockIn(group)} className={`${button} w-full bg-gradient-to-r from-emerald-500 to-blue-500 text-white`}>
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-5 w-5" />} Lock in for over {group.over}
          </button>
          <p className="text-center text-xs text-gray-400">Answers are final once locked in.</p>
        </div>
      )}
    </section>
  );
}

function Result({ question, mine }: { question: FeedQuestion; mine: number | undefined }) {
  if (question.state === 'void') return <span className="text-gray-400">Void: this one doesn&apos;t count</span>;
  if (question.state !== 'settled') return <span className="text-amber-200">{mine === undefined ? 'Closed' : `You said ${optionLabel(question.options[mine])}`} · waiting for the over</span>;
  const answer = optionLabel(question.options[question.correctOption!]);
  if (mine === undefined) return <span className="text-gray-300">Answer: {answer}</span>;
  return mine === question.correctOption
    ? <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Right: {answer}</span>
    : <span className="inline-flex items-center gap-1 text-red-300"><XCircle className="h-4 w-4" /> Wrong: the answer was {answer}</span>;
}

/**
 * A live match for players (match mode): the score ball by ball and, each over, predictions about the next
 * over in Roman Urdu and English. Everything shown comes from the shared feed GET /api/live/matches/[id],
 * which Cloudflare caches for a few seconds, so however many people watch, Hostinger sees a handful of
 * requests. Signed out, a visitor can watch; answering needs an account (free entry). A signed-in player's
 * earlier answers are read once (GET /api/quizzes/[id]/answers, tried again until it works) and answering
 * waits for them, so an earlier answer is never shown as a new one; answers go through the quiz submit
 * route, which takes each one once and refuses one whose over has closed.
 */
export default function MatchScreen({ matchId }: { matchId: string }) {
  const { user } = useAuth();
  const [feed, setFeed] = useState<PublicMatch | null>(null);
  const [load, setLoad] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  // How far this device's clock is behind the server's
  const [offset, setOffset] = useState(0);
  const [answers, setAnswers] = useState<MyAnswers>({});
  // The player's earlier answers have been read
  const [answersRead, setAnswersRead] = useState(false);
  const [answersAttempt, setAnswersAttempt] = useState(0);
  const [picks, setPicks] = useState<MyAnswers>({});
  // Questions the server said closed before an answer arrived
  const [late, setLate] = useState<Set<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const answersFor = useRef<string | null>(null);

  const loadFeed = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/live/matches/${encodeURIComponent(matchId)}`, { credentials: 'omit' });
      if (response.status === 404) {
        setLoad('not_found');
        return true;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: PublicMatch = await response.json();
      setOffset(clockOffset(data.serverNow, response.headers.get('age'), Date.now()));
      setFeed(data);
      setLoad('ready');
      return true;
    } catch {
      // A failure keeps what is on screen; the poller backs off
      setLoad((current) => (current === 'loading' ? 'error' : current));
      return false;
    }
  }, [matchId]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);
  const quiet = load === 'not_found' || feed?.match.status === 'completed' || feed?.match.status === 'abandoned';
  useJitteredPolling(loadFeed, { intervalMs: quiet ? QUIET_POLL_MS : LIVE_POLL_MS, jitterMs: 1_000, maxBackoffMs: 30_000 });

  // The player's earlier answers, once per player and match; a failed read is tried again
  const quizId = feed?.match.quizId;
  useEffect(() => {
    if (!user || !quizId || answersFor.current === `${user.id}:${quizId}`) return;
    answersFor.current = `${user.id}:${quizId}`;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const response = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}/answers`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: { answers: Array<{ questionId: string; selectedOption: number }> } = await response.json();
        setAnswers((mine) => ({ ...Object.fromEntries(data.answers.map((a) => [a.questionId, a.selectedOption])), ...mine }));
        setAnswersRead(true);
      } catch {
        answersFor.current = null;
        retry = setTimeout(() => setAnswersAttempt((n) => n + 1), Math.min(ANSWERS_RETRY_MAX_MS, ANSWERS_RETRY_MS * 2 ** answersAttempt));
      }
    })();
    return () => clearTimeout(retry);
  }, [user, quizId, answersAttempt]);

  const anyOpen = feed?.questions.some((q) => q.state === 'open') ?? false;
  const now = useNow(1000, anyOpen) + offset;

  const lockIn = async (group: OverGroup) => {
    // Only reachable from the screen of a loaded match
    const match = feed!.match;
    let toSend = group.questions
      .filter((q) => answers[q.id] === undefined && picks[q.id] !== undefined && !late.has(q.id) && isOpen(q, now))
      .map((q) => ({ questionId: q.id, selectedOption: picks[q.id] }));
    setSending(true);
    setNotice(null);
    try {
      const csrfToken = await getCSRFToken();
      if (!csrfToken) throw new Error('Unable to verify security token. Please refresh the page and try again.');
      // A question that closed meanwhile is dropped and the rest sent once more
      for (let attempt = 0; attempt < 2 && toSend.length > 0; attempt++) {
        const response = await fetchWithRetry(`/api/quizzes/${encodeURIComponent(match.quizId)}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ answers: toSend }),
        }, { retries: 3, retryOn: [502, 503, 504] });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          const sent = toSend;
          setAnswers((mine) => ({ ...mine, ...Object.fromEntries(sent.map((a) => [a.questionId, a.selectedOption])) }));
          setNotice({ tone: 'ok', text: `Locked in for over ${group.over}. The results come once it has been bowled.` });
          return;
        }
        if (response.status === 409 && data.code === 'questions_closed' && Array.isArray(data.closed)) {
          const closed: string[] = data.closed;
          setLate((all) => new Set([...all, ...closed]));
          setNotice({ tone: 'error', text: data.error });
          toSend = toSend.filter((a) => !closed.includes(a.questionId));
          continue;
        }
        throw new Error(response.status === 401 ? 'Sign in again to answer.' : data.error || 'Your answers could not be sent. Try again.');
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Your answers could not be sent. Try again.' });
    } finally {
      setSending(false);
    }
  };

  const shell = (children: ReactNode) => (
    <main className="min-h-screen bg-gradient-glass-dark px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">{children}</div>
    </main>
  );

  if (load === 'loading') return shell(<p className="text-center text-gray-300">Loading the match…</p>);
  if (load === 'not_found') {
    return shell(
      <div className={`${card} space-y-4 text-center`}>
        <h1 className="text-xl font-bold text-white">This match isn&apos;t live</h1>
        <p className="text-gray-300">It hasn&apos;t started for players yet, or it has been taken down. This page checks again every half a minute, and live matches show on the quiz list.</p>
        <Link href="/quizzes" prefetch={false} className={`${button} bg-white/10 text-white hover:bg-white/15`}>Go to quizzes</Link>
      </div>,
    );
  }
  if (!feed) {
    return shell(
      <p role="alert" className="text-center text-red-300">
        The match could not be loaded. <button type="button" onClick={() => void loadFeed()} className="underline">Try again</button>
      </p>,
    );
  }

  const { match } = feed;
  const groups = byOver(feed.questions);
  const open = groups.filter((g) => g.questions.some((q) => isOpen(q, now) && !late.has(q.id)));
  const past = groups.filter((g) => !open.includes(g)).reverse();
  const played = Object.keys(answers).length > 0;
  // Only once the player's answers are read: one who already joined is still in, whatever the limit
  const full = match.entriesClosed && answersRead && !played;
  const canAnswer = !!user && answersRead && !full;
  const score = tally(feed.questions, answers);
  const current = feed.innings[feed.innings.length - 1];
  const lastOver = current?.overs[current.overs.length - 1];
  const thisOver = lastOver && !lastOver.complete ? lastOver : null;

  return shell(
    <>
      <header className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-white">{match.title}</h1>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${match.status === 'live' ? 'bg-red-500/20 text-red-200' : 'bg-white/10 text-gray-200'}`}>
            {match.status === 'live' && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />}
            {STATUS[match.status]}
          </span>
        </div>
        {feed.innings.map((innings) => (
          <p key={innings.innings} className="text-lg text-white">
            <span className="font-semibold">{innings.battingTeam}</span> {innings.runs}/{innings.wickets}{' '}
            <span className="text-gray-400">({innings.oversText} overs{innings.target !== null ? `, target ${innings.target}` : ''})</span>
          </p>
        ))}
        {thisOver && (
          <p aria-label="This over" className="font-mono text-sm text-gray-300">Over {thisOver.number}: {thisOver.balls.join(' ')}</p>
        )}
        {feed.innings.length === 0 && <p className="text-gray-300">The first innings hasn&apos;t started yet.</p>}
        <p className="text-xs text-gray-400">
          Each over, predict what happens in the next one. Its questions close before it starts. Free to play.
        </p>
      </header>

      {!user && (
        <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
          <p className="text-gray-200">Sign in to play: it&apos;s free. Then open the match from Quizzes.</p>
          <Link href="/auth?mode=login" prefetch={false} className={`${button} bg-gradient-to-r from-emerald-500 to-blue-500 text-white`}>Sign in to play</Link>
        </div>
      )}
      {user && !answersRead && <p className="text-center text-sm text-gray-400">Loading your answers…</p>}
      {user && full && <p role="status" className="rounded-xl bg-amber-500/10 p-4 text-amber-100">This match is full: entries have closed.</p>}
      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl p-4 text-sm ${notice.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-100' : 'bg-red-500/10 text-red-100'}`}>
          {notice.text}
        </p>
      )}
      {played && score.settled > 0 && (
        <p className="text-center text-gray-200">You got <span className="font-bold text-emerald-300">{score.right}</span> of {score.settled} right so far.</p>
      )}
      {match.settled && played && (
        <Link href={`/quiz/${match.quizId}/results`} prefetch={false} className={`${button} w-full bg-white/10 text-white hover:bg-white/15`}>See your points</Link>
      )}

      {open.map((group) => (
        <OpenOver key={group.key} group={group} now={now} answers={answers} picks={picks} late={late} canAnswer={canAnswer} sending={sending}
          onPick={(id, option) => setPicks((all) => ({ ...all, [id]: option }))} onLockIn={(g) => void lockIn(g)} />
      ))}
      {open.length === 0 && match.status === 'live' && (
        <p className={`${card} text-center text-gray-300`}>The next over&apos;s questions are on their way.</p>
      )}

      {past.length > 0 && (
        <section aria-label="Earlier overs" className={`${card} space-y-4`}>
          <h2 className="font-semibold text-white">Earlier overs</h2>
          {past.map((group) => (
            <div key={group.key} className="space-y-2">
              <p className="text-sm text-gray-400">{feed.innings.length > 1 ? `Innings ${group.innings}, over ${group.over}` : `Over ${group.over}`}</p>
              <ul className="space-y-2">
                {group.questions.map((q) => (
                  <li key={q.id} className="space-y-1 rounded-xl bg-gray-900/40 p-3 text-sm">
                    <Wording question={q} large={false} />
                    <Result question={q} mine={answers[q.id]} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </>,
  );
}
