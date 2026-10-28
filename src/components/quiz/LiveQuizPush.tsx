'use client';

import { useState, useCallback, useEffect, useLayoutEffect, useRef, forwardRef, useImperativeHandle, memo } from 'react';
import { X, Loader2, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { getCSRFToken } from '@/lib/csrf';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { isWindowClosed, localWindowEnd } from '@/lib/quiz-clock';
import { ENTRIES_CLOSED_MESSAGE } from '@/lib/quiz-entries';
import { describeStart, formatClock } from '@/lib/live-countdown';
import { isStreamFullscreen } from '@/lib/stream-fullscreen';
import { isNotificationSoundOn, playChime } from '@/lib/notification-sound';

interface PushedQuestion {
    id: string;
    text: string;
    options: string[];
}

interface PushedQuizData {
    id: string;
    title: string;
    questions: PushedQuestion[];
}

/** A quiz pushed live. `endsAtMs`: device time its answering window closes; `windowMs`: its length. */
interface LiveEntry {
    id: string;
    title: string;
    endsAtMs: number | null;
    windowMs: number | null;
}

/** An announced quiz that hasn't started. `startsAtMs` null: no start time was set. */
interface UpcomingEntry {
    id: string;
    title: string;
    startsAtMs: number | null;
}

export interface LiveQuizPushHandle {
    /**
     * The page's live check saw a quiz pushed live: banner with a countdown, then a pill under the
     * stream until the window closes or the viewer answers. `endsAt`: when its answering window
     * closes; `durationMinutes`: that window's length (for the countdown ring).
     */
    notify: (quizId: string, quizTitle: string, endsAt?: string | null, durationMinutes?: number) => void;
    /** The page's live check saw an upcoming quiz announced: banner, then a pill counting down to `startsAt`. */
    announce: (quizId: string, quizTitle: string, startsAt: string | null) => void;
    /**
     * Called when the viewer opens this quiz from somewhere other than the
     * banner (a quiz card, the bell, a notification deep link) - skips the
     * banner and goes straight to the quiz. Safe to call even if this quiz is
     * already open: reuses in-progress answers instead of resetting them.
     */
    open: (quizId: string) => void;
    /**
     * From every live check: whether this quiz is full for this viewer (full, and they are not one of its
     * players). While it is, Lock in says entries have closed without sending a submit the server would
     * refuse; false (the limit was raised, or the viewer got in) lets them submit again.
     */
    setEntriesClosed: (quizId: string, closed: boolean) => void;
}

interface LiveQuizPushProps {
    /** Fires after a successful submit, so the parent can refresh badges/lists. */
    onAnswered?: () => void;
    /**
     * True when this quiz may load from the shared copy Cloudflare caches (/api/live/quizzes/[id])
     * instead of the personal route: quizzes are free and the viewer has not answered this one.
     */
    canUseSharedCopy?: (quizId: string) => boolean;
}

type Panel = 'hidden' | 'popup' | 'split';
type Banner = 'live' | 'upcoming' | null;

/** How long a banner shows before it shrinks to its pill. */
const BANNER_MS = 8000;

/** Toast for a "Lock in" after the countdown reads "Time's up". */
const TIME_UP_MESSAGE = 'The time is up for the quiz. You cannot lock in answer.';

/**
 * At the deadline the viewer's answers are locked in after a random wait of up to this long, inside the
 * server's 30 s grace period, so a crowd whose countdowns all reach zero together doesn't submit at once.
 */
const AUTO_LOCK_SPREAD_MS = 15_000;

const parseMs = (iso: string | null | undefined) => {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? ms : null;
};

/** In fullscreen, the quiz opens as a centered modal popup over the stream so the video experience is preserved. */
const preferredPanel = (): Panel => (isStreamFullscreen() ? 'popup' : window.innerWidth < 768 ? 'split' : 'popup');

/** The bell's sound setting covers the stream's pop-ups too. */
function alertViewer() {
    if (!isNotificationSoundOn()) return;
    playChime();
    navigator.vibrate?.([90, 50, 90]);
}

/** Countdown ring: the part of the answering window that is left. */
function Ring({ fraction, label }: { fraction: number; label?: string }) {
    const circumference = 2 * Math.PI * 15;
    return (
        <span className={`lq-ring ${label ? '' : 'small'}`} aria-hidden="true">
            <svg viewBox="0 0 36 36">
                <circle className="track" cx="18" cy="18" r="15" />
                <circle className="fill" cx="18" cy="18" r="15" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)} />
            </svg>
            {label && <span className="lq-ring-label">{label}</span>}
        </span>
    );
}

/**
 * Self-contained live-push quiz experience, scoped entirely to the
 * live-stream section (rendered as a sibling of the stream player, inside
 * the same `position:relative` wrapper, which is also what goes fullscreen).
 * Nothing here touches the full-page quiz flow (/quiz/[id]), which keeps a
 * player on the quiz until they submit - right for a payment-gated attempt but
 * wrong for "glance at a live quiz during the stream, come back to it". This
 * component keeps its own answers/lock state for exactly that reason, and is
 * never unmounted by its parent between open/close - only hidden - so closing
 * (including from split view) can never lose what the viewer already answered.
 * For the same reason a quiz pushed while the viewer is mid-answer waits as
 * "next" instead of replacing the one they are answering.
 */
const LiveQuizPush = forwardRef<LiveQuizPushHandle, LiveQuizPushProps>(function LiveQuizPush({ onAnswered, canUseSharedCopy }, ref) {
    const [panel, setPanel] = useState<Panel>('hidden');
    const [banner, setBanner] = useState<Banner>(null);
    const [bannerShown, setBannerShown] = useState(false);
    const [live, setLive] = useState<LiveEntry | null>(null);
    const [next, setNext] = useState<LiveEntry | null>(null);
    const [upcoming, setUpcoming] = useState<UpcomingEntry | null>(null);
    const [quiz, setQuiz] = useState<PushedQuizData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [locked, setLocked] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    // Time is up and the answers given are about to be locked in (see AUTO_LOCK_SPREAD_MS)
    const [autoLocking, setAutoLocking] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The answering window (quiz and end time) whose answers were already handed to the deadline lock-in
    const autoLockKeyRef = useRef<string | null>(null);
    useEffect(() => () => {
        clearTimeout(bannerTimerRef.current!);
        clearTimeout(autoLockTimerRef.current!);
    }, []);

    // Latest state for the handle, which the page calls from its live check. A layout effect, so it is
    // current as soon as a render commits (a push right after "Lock in" must see the lock)
    const stateRef = useRef({ panel, banner, live, next, quiz, locked, answers, submitting });
    useLayoutEffect(() => {
        stateRef.current = { panel, banner, live, next, quiz, locked, answers, submitting };
    }, [panel, banner, live, next, quiz, locked, answers, submitting]);

    // One tick a second while something counts down
    const counting = live?.endsAtMs != null || upcoming !== null;
    useEffect(() => {
        if (!counting) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [counting]);

    const showBanner = useCallback((kind: 'live' | 'upcoming') => {
        setBanner(kind);
        setBannerShown(false);
        // Slide in on the next frame (CSS transition)
        requestAnimationFrame(() => setBannerShown(true));
        clearTimeout(bannerTimerRef.current!);
        bannerTimerRef.current = setTimeout(() => setBanner(null), BANNER_MS);
    }, []);

    const hideBanner = useCallback(() => {
        clearTimeout(bannerTimerRef.current!);
        setBanner(null);
    }, []);

    // Fetches quiz content by id. Never touches `answers`/`locked` - safe to
    // call again for a quiz that's already loaded (e.g. reopening from the
    // bell) without losing what the viewer already picked.
    const loadQuiz = useCallback(async (quizId: string) => {
        try {
            let res: Response | null = null;
            if (canUseSharedCopy?.(quizId)) {
                // One cached copy serves everyone who opens the quiz at once. Anything but the copy or
                // "not started yet" (a refusal, an error, no network) falls back to the personal route.
                const shared = await fetch(`/api/live/quizzes/${quizId}`, { credentials: 'omit' }).catch(() => null);
                if (shared && (shared.ok || shared.status === 409)) res = shared;
            }
            // When thousands of players open the quiz at once the server may shed load with a
            // 503 + Retry-After; retry with jittered backoff instead of showing an error.
            res ??= await fetchWithRetry(`/api/quizzes/${quizId}`, undefined, { retries: 3 });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                if (data.upcoming && data.startsAt) {
                    // Show the start time in the viewer's own timezone
                    setLoadError(`This quiz hasn't started yet. It goes live ${new Date(data.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`);
                    return;
                }
                setLoadError(data.error || 'This quiz is no longer available');
                return;
            }
            const { quiz: loaded } = await res.json();
            setQuiz({ id: loaded.id, title: loaded.title, questions: loaded.questions });
            // The server's answering window, corrected for this device's clock when the personal route
            // sends its own time (the cached copy can't)
            setLive({
                id: loaded.id,
                title: loaded.title,
                endsAtMs: localWindowEnd(loaded.endsAt, loaded.serverNow, Date.now()),
                windowMs: loaded.duration * 60_000,
            });
            setNow(Date.now());
            setLoadError(null);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load quiz');
        }
    }, [canUseSharedCopy]);

    // Starts `entry` from scratch (a new push, or the queued one)
    const startFresh = useCallback((entry: LiveEntry) => {
        setLive(entry);
        setQuiz(null);
        setAnswers({});
        setLocked(false);
        setLoadError(null);
        clearTimeout(autoLockTimerRef.current!);
        setAutoLocking(false);
    }, []);

    const notify = useCallback((quizId: string, quizTitle: string, endsAt: string | null = null, durationMinutes = 0) => {
        const entry: LiveEntry = { id: quizId, title: quizTitle, endsAtMs: parseMs(endsAt), windowMs: durationMinutes * 60_000 || null };
        setNow(Date.now());
        // The announcement for this quiz is over: it is live now
        setUpcoming((u) => (u?.id === quizId ? null : u));
        alertViewer();
        const s = stateRef.current;
        if (s.panel !== 'hidden' && !s.locked && Object.keys(s.answers).length > 0) {
            // Mid-answer: never wipe what the viewer picked. Pushed again, the same quiz just gets its
            // new window; another one waits as "next" in the panel.
            if (s.live!.id === quizId) setLive(entry);
            else setNext(entry);
            return;
        }
        // A new push replaces whatever was showing before (previous answers,
        // if any, were already submitted server-side - only one quiz can be
        // "live" at a time on the stream).
        startFresh(entry);
        setNext(null);
        setPanel('hidden');
        showBanner('live');
    }, [showBanner, startFresh]);

    const announce = useCallback((quizId: string, quizTitle: string, startsAt: string | null) => {
        setNow(Date.now());
        setUpcoming({ id: quizId, title: quizTitle, startsAtMs: parseMs(startsAt) });
        alertViewer();
        // A live quiz comes first: its banner or open quiz stays, and the announcement waits as a pill
        const s = stateRef.current;
        if (s.panel === 'hidden' && s.banner !== 'live') showBanner('upcoming');
    }, [showBanner]);

    // Card, bell or deep-link entry point: go straight to the quiz. Only
    // reset answers/lock state if this is a DIFFERENT quiz than whatever was
    // already showing - reopening the same one preserves progress.
    const open = useCallback((quizId: string) => {
        hideBanner();
        if (stateRef.current.live?.id !== quizId) startFresh({ id: quizId, title: 'Live quiz', endsAtMs: null, windowMs: null });
        setPanel(preferredPanel());
        loadQuiz(quizId);
    }, [hideBanner, startFresh, loadQuiz]);

    const closedEntriesRef = useRef(new Set<string>());
    // Quizzes this viewer locked in here. Their own entry may be what filled the quiz, and the page's
    // next live check can say "full" before its personal list knows they entered.
    const enteredRef = useRef(new Set<string>());
    const setEntriesClosed = useCallback((quizId: string, closed: boolean) => {
        if (closed && !enteredRef.current.has(quizId)) closedEntriesRef.current.add(quizId);
        else closedEntriesRef.current.delete(quizId);
    }, []);

    useImperativeHandle(ref, () => ({ notify, announce, open, setEntriesClosed }), [notify, announce, open, setEntriesClosed]);

    // From the live banner or pill. Both show only for a pushed quiz, so there is always one to open;
    // a quiz already loaded is not fetched again.
    const openPanel = useCallback(() => {
        const s = stateRef.current;
        hideBanner();
        setPanel(preferredPanel());
        if (!s.quiz) loadQuiz(s.live!.id);
    }, [hideBanner, loadQuiz]);

    const playNext = useCallback(() => {
        const queued = stateRef.current.next!;
        setNext(null);
        startFresh(queued);
        loadQuiz(queued.id);
    }, [startFresh, loadQuiz]);

    // Closing with a quiz waiting brings that one up
    const close = useCallback(() => {
        setPanel('hidden');
        const queued = stateRef.current.next;
        if (!queued) return;
        setNext(null);
        startFresh(queued);
        showBanner('live');
    }, [startFresh, showBanner]);

    const toggleSplit = useCallback(() => setPanel((v) => (v === 'split' ? 'popup' : 'split')), []);

    const pick = useCallback((questionId: string, optionIndex: number) => {
        // Once time is up the answers are final: what was picked by then is what gets locked in
        if (locked || isWindowClosed(live?.endsAtMs ?? null, Date.now())) return;
        setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
    }, [locked, live?.endsAtMs]);

    const answeredCount = quiz ? quiz.questions.filter((q) => answers[q.id] !== undefined).length : 0;
    const allAnswered = !!quiz && answeredCount === quiz.questions.length && quiz.questions.length > 0;

    // The submit button only shows for a loaded, unlocked quiz, and stays disabled until
    // every question is answered and while a submit is in flight. `atDeadline`: time is up, and the
    // effect below locks in the questions answered so far (the server's grace period still takes them).
    const send = useCallback(async (atDeadline: boolean) => {
        // Loaded: the button only shows for a loaded quiz, and the deadline lock-in is only set up for one
        // (startFresh, the only thing that unloads it, also cancels that lock-in)
        const loaded = quiz!;
        // The countdown reads "Time's up": say so instead of sending a submit the server refuses
        const timeUp = () => isWindowClosed(live?.endsAtMs ?? null, Date.now());
        if (!atDeadline && timeUp()) {
            toast.error(TIME_UP_MESSAGE);
            return;
        }
        // Full, and this viewer is not one of its players: the server would refuse the submit
        if (closedEntriesRef.current.has(loaded.id)) {
            toast.error(ENTRIES_CLOSED_MESSAGE);
            return;
        }
        // Every question for a Lock in; at the deadline, those answered (an unanswered one was never sent)
        const picked = loaded.questions.filter((q) => answers[q.id] !== undefined);
        setSubmitting(true);
        try {
            const csrfToken = await getCSRFToken();
            // Submitting is idempotent (one attempt per user and quiz is enforced in the database),
            // so overload responses (502/503/504) are retried with jittered backoff. 429 is
            // deliberately NOT retried: that is the per-user submission limit, not overload.
            const res = await fetchWithRetry(`/api/quizzes/${loaded.id}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '' },
                body: JSON.stringify({
                    answers: picked.map((q) => ({ questionId: q.id, selectedOption: answers[q.id] })),
                }),
            }, { retries: 4, retryOn: [502, 503, 504] });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                // Locked in on the last second and refused: the window closed while it was on its way
                toast.error(!atDeadline && timeUp() ? TIME_UP_MESSAGE : data.error || 'Failed to submit');
                return;
            }
            // They are one of its players now: questions added later stay open to them even once it is full
            enteredRef.current.add(loaded.id);
            closedEntriesRef.current.delete(loaded.id);
            setLocked(true);
            const n = picked.length;
            toast.success(atDeadline ? `Time's up: your ${n} answer${n === 1 ? ' was' : 's were'} locked in.` : 'Answer locked in!');
            onAnswered?.();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to submit your answer');
        } finally {
            setSubmitting(false);
        }
    }, [quiz, answers, live, onAnswered]);
    const submit = useCallback(() => send(false), [send]);
    // The deadline lock-in runs from a timer: it must use the answers as they are when it fires
    const sendRef = useRef(send);
    useLayoutEffect(() => {
        sendRef.current = send;
    }, [send]);

    // Countdowns. `liveLeft` null: the live quiz has no answering window (or there is none).
    const liveLeft = live?.endsAtMs != null ? live.endsAtMs - now : null;
    const liveFraction = liveLeft !== null && live!.windowMs ? Math.min(1, Math.max(0, liveLeft / live!.windowMs)) : 1;
    const upcomingOn = upcoming !== null && (upcoming.startsAtMs === null || upcoming.startsAtMs > now);

    // Time is up: lock in what the viewer answered, even with the panel closed. Lock in needs every
    // question and refuses once time is up, so a half-answered quiz used to save nothing. Once per
    // answering window (a push that gives the quiz a new window gets its own).
    const timeIsUp = liveLeft !== null && liveLeft <= 0;
    const deadlineKey = live?.endsAtMs != null ? `${live.id}@${live.endsAtMs}` : null;
    useEffect(() => {
        if (!timeIsUp || !deadlineKey || autoLockKeyRef.current === deadlineKey) return;
        autoLockKeyRef.current = deadlineKey;
        const s = stateRef.current;
        // A Lock in already on its way covers it, and so does one already done
        if (!s.quiz || s.locked || s.submitting || !s.quiz.questions.some((q) => s.answers[q.id] !== undefined)) return;
        setAutoLocking(true);
        autoLockTimerRef.current = setTimeout(async () => {
            try {
                await sendRef.current(true);
            } finally {
                setAutoLocking(false);
            }
        }, Math.random() * AUTO_LOCK_SPREAD_MS);
    }, [timeIsUp, deadlineKey]);

    // Pills under the stream (over it, in fullscreen) for what the banners announced
    const livePill = panel === 'hidden' && banner !== 'live' && !locked && liveLeft !== null && liveLeft > 0;
    const upcomingPill = panel === 'hidden' && banner !== 'upcoming' && upcomingOn;

    if (!banner && panel === 'hidden' && !livePill && !upcomingPill) return null;

    return (
        <>
            {banner === 'live' && (
                <div className={`lq-banner live ${bannerShown ? 'show' : ''}`} role="status">
                    <button className="lq-banner-main" onClick={openPanel}>
                        {liveLeft !== null ? (
                            <Ring fraction={liveFraction} label={formatClock(liveLeft)} />
                        ) : (
                            <span className="ticon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>
                            </span>
                        )}
                        <span className="ttext">
                            <span className="ttitle">New quiz just dropped</span>
                            <span className="tsub">{live!.title} · tap to play</span>
                        </span>
                    </button>
                    <button className="lq-banner-close" onClick={hideBanner} aria-label="Close notification">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {banner === 'upcoming' && (
                <div className={`lq-banner upcoming ${bannerShown ? 'show' : ''}`} role="status">
                    <div className="lq-banner-main">
                        <span className="ticon" aria-hidden="true"><CalendarClock className="w-4 h-4" /></span>
                        <span className="ttext">
                            <span className="ttitle">Upcoming quiz: {upcoming!.title}</span>
                            <span className="tsub">Starts {describeStart(upcoming!.startsAtMs, now)} · stay on the stream</span>
                        </span>
                    </div>
                    <button className="lq-banner-close" onClick={hideBanner} aria-label="Close notification">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {(livePill || upcomingPill) && (
                <div className="lq-dock">
                    {livePill && (
                        <button className="lq-pill live" onClick={openPanel} aria-label={`Play live quiz ${live!.title}, ${formatClock(liveLeft!)} left`}>
                            <Ring fraction={liveFraction} />
                            <span className="lq-pill-text">Live quiz · {formatClock(liveLeft!)}</span>
                        </button>
                    )}
                    {upcomingPill && (
                        <button className="lq-pill upcoming" onClick={() => showBanner('upcoming')} aria-label={`Upcoming quiz ${upcoming!.title}, starts ${describeStart(upcoming!.startsAtMs, now)}`}>
                            <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                            <span className="lq-pill-text">Next quiz {describeStart(upcoming!.startsAtMs, now)}</span>
                        </button>
                    )}
                </div>
            )}

            {panel !== 'hidden' && (
                <div
                    className={panel === 'popup' ? 'quiz-pop open' : 'split-slot'}
                    onClick={panel === 'popup' ? (e) => { if (e.target === e.currentTarget) close(); } : undefined}
                >
                    <div className="quiz-panel" role="region" aria-label={live!.title}>
                        <div className="qp-head">
                            <div className="qp-title">
                                <span className="livedot"></span>
                                <span className="tt">{live!.title}</span>
                            </div>
                            <div className="qp-actions">
                                {liveLeft !== null && (
                                    <span className={`qp-timer ${liveLeft > 0 ? '' : 'over'}`}>{liveLeft > 0 ? `${formatClock(liveLeft)} left` : "Time's up"}</span>
                                )}
                                <button
                                    className={`icon-btn ${panel === 'split' ? 'active' : ''}`}
                                    onClick={toggleSplit}
                                    title={panel === 'split' ? 'Back to popup' : 'Split view'}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>
                                </button>
                                <button className="icon-btn" onClick={close} title="Close">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><path d="M6 6l12 12M18 6 6 18"/></svg>
                                </button>
                            </div>
                        </div>
                        {liveLeft !== null && (
                            <div className="qp-progress" aria-hidden="true"><span style={{ width: `${liveFraction * 100}%` }} /></div>
                        )}

                        {next && (
                            <div className="qp-next">
                                <span className="qp-next-text">Next quiz ready: <strong>{next.title}</strong></span>
                                <button onClick={playNext}>Play it now</button>
                            </div>
                        )}

                        <div className="qp-body">
                            {loadError && <p className="text-sm text-red-300">{loadError}</p>}
                            {!quiz && !loadError && (
                                <div className="flex items-center justify-center py-10 text-gray-400">
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                </div>
                            )}
                            {quiz && (
                                <>
                                    <div className={`qp-status ${locked ? 'locked' : ''}`}>
                                        {locked ? (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                        ) : (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
                                        )}
                                        <span>{locked ? 'Answer locked in — waiting for results' : 'Active'}</span>
                                    </div>

                                    <LiveQuizQuestions
                                        questions={quiz.questions}
                                        answers={answers}
                                        locked={locked}
                                        pick={pick}
                                    />

                                    {!locked && (
                                        <button
                                            className="qp-submit"
                                            onClick={submit}
                                            disabled={!allAnswered || submitting || autoLocking}
                                        >
                                            {submitting || autoLocking ? 'Submitting...' : (allAnswered ? 'Lock in answer' : `Answer all ${quiz.questions.length} questions`)}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="dockhint">
                            {panel === 'split' ? 'Split view: the stream keeps playing beside the quiz.' : 'Popup mode: the quiz floats above the stream.'}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
});

// ⚡ Bolt Performance Optimization:
// Extracted `LiveQuizQuestions` from `LiveQuizPush` into a memoized component.
// Why: `LiveQuizPush` re-renders every second when counting down, triggering
// unnecessary reconciliations of the large, static question list.
// Impact: Reduces React render time by skipping reconciliation of questions/options
// during timer updates, saving main thread cycles while the countdown is running.
const LiveQuizQuestions = memo(function LiveQuizQuestions({
    questions,
    answers,
    locked,
    pick
}: {
    questions: PushedQuestion[];
    answers: Record<string, number>;
    locked: boolean;
    pick: (questionId: string, optionIndex: number) => void;
}) {
    return (
        <>
            {questions.map((q, i) => (
                <div key={q.id}>
                    <div className="qp-q">{i + 1}. {q.text}</div>
                    {q.options.map((opt, idx) => {
                        const picked = answers[q.id] === idx;
                        return (
                            <div
                                key={idx}
                                onClick={() => pick(q.id, idx)}
                                className={`qp-opt ${picked ? 'picked' : ''} ${locked ? 'locked' : ''}`}
                            >
                                <span className="radio"></span>
                                {opt}
                            </div>
                        );
                    })}
                </div>
            ))}
        </>
    );
});

export default LiveQuizPush;
