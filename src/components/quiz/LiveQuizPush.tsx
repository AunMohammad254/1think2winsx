'use client';

import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getCSRFToken } from '@/lib/csrf';
import { fetchWithRetry } from '@/lib/fetch-retry';

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

export interface LiveQuizPushHandle {
    /** Called by the parent when Realtime reports a quiz was pushed - shows the toast. */
    notify: (quizId: string, quizTitle: string) => void;
    /**
     * Called when the viewer opens this quiz from somewhere other than the
     * toast (the bell dropdown, a notification deep link) - skips the toast
     * and goes straight to the popup. Safe to call even if this quiz is
     * already open: reuses in-progress answers instead of resetting them.
     */
    open: (quizId: string) => void;
}

interface LiveQuizPushProps {
    /** Fires after a successful submit, so the parent can refresh badges/lists. */
    onAnswered?: () => void;
}

type View = 'hidden' | 'toast' | 'popup' | 'split';

/**
 * Self-contained live-push quiz experience, scoped entirely to the
 * live-stream section (rendered as a sibling of the stream player, inside
 * the same `position:relative` wrapper). Nothing here touches the regular
 * quiz-taking flow (QuizAttemptModal) used elsewhere in the app - that
 * component intentionally resets on close and blocks closing mid-attempt,
 * which is right for a payment-gated attempt but wrong for "glance at a
 * live quiz during the stream, come back to it". This component keeps its
 * own answers/lock state for exactly that reason, and is never unmounted
 * by its parent between open/close - only hidden - so closing (including
 * from split view) can never lose what the viewer already answered.
 */
const LiveQuizPush = forwardRef<LiveQuizPushHandle, LiveQuizPushProps>(function LiveQuizPush({ onAnswered }, ref) {
    const [view, setView] = useState<View>('hidden');
    const [pending, setPending] = useState<{ id: string; title: string } | null>(null);
    const [quiz, setQuiz] = useState<PushedQuizData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [locked, setLocked] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [toastAnim, setToastAnim] = useState(false);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Fetches quiz content by id. Never touches `answers`/`locked` - safe to
    // call again for a quiz that's already loaded (e.g. reopening from the
    // bell) without losing what the viewer already picked.
    const loadQuiz = useCallback(async (quizId: string) => {
        try {
            // When thousands of players open the quiz at once the server may shed load with a
            // 503 + Retry-After; retry with jittered backoff instead of showing an error.
            const res = await fetchWithRetry(`/api/quizzes/${quizId}`, undefined, { retries: 3 });
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
            const data = await res.json();
            setQuiz({ id: data.quiz.id, title: data.quiz.title, questions: data.quiz.questions });
            setPending({ id: data.quiz.id, title: data.quiz.title });
            setLoadError(null);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load quiz');
        }
    }, []);

    // Exposed to the parent via a ref-like callback prop pattern (see below).
    const notify = useCallback((quizId: string, quizTitle: string) => {
        // A new push replaces whatever was showing before (previous answers,
        // if any, were already submitted server-side - only one quiz can be
        // "live" at a time on the stream).
        setPending({ id: quizId, title: quizTitle });
        setQuiz(null);
        setAnswers({});
        setLocked(false);
        setLoadError(null);
        setToastAnim(false);
        setView('toast');
        
        // Trigger CSS transition
        requestAnimationFrame(() => setToastAnim(true));
        
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
            setView((v) => (v === 'toast' ? 'hidden' : v));
        }, 8000);
    }, []);

    // Bell / notification-link entry point: go straight to the popup. Only
    // reset answers/lock state if this is a DIFFERENT quiz than whatever was
    // already showing - reopening the same one preserves progress.
    const open = useCallback((quizId: string) => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setPending((prev) => {
            if (!prev || prev.id !== quizId) {
                setQuiz(null);
                setAnswers({});
                setLocked(false);
                setLoadError(null);
                return { id: quizId, title: 'Live quiz' };
            }
            return prev;
        });
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
        setView(isMobile ? 'split' : 'popup');
        loadQuiz(quizId);
    }, [loadQuiz]);

    useImperativeHandle(ref, () => ({ notify, open }), [notify, open]);

    const openPanel = useCallback((mode: 'popup' | 'split') => {
        setView(mode);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        if (!pending || quiz || loadError) return; // already loaded (or failed) - don't refetch and wipe answers
        loadQuiz(pending.id);
    }, [pending, quiz, loadError, loadQuiz]);

    const close = useCallback(() => setView('hidden'), []);
    const toggleSplit = useCallback(() => setView((v) => (v === 'split' ? 'popup' : 'split')), []);

    const pick = (questionId: string, optionIndex: number) => {
        if (locked) return;
        setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
    };

    const answeredCount = quiz ? quiz.questions.filter((q) => answers[q.id] !== undefined).length : 0;
    const allAnswered = !!quiz && answeredCount === quiz.questions.length && quiz.questions.length > 0;

    const submit = useCallback(async () => {
        if (!quiz || !allAnswered || locked || submitting) return;
        setSubmitting(true);
        try {
            const csrfToken = await getCSRFToken();
            // Submitting is idempotent (one attempt per user and quiz is enforced in the database),
            // so overload responses (502/503/504) are retried with jittered backoff. 429 is
            // deliberately NOT retried: that is the per-user submission limit, not overload.
            const res = await fetchWithRetry(`/api/quizzes/${quiz.id}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '' },
                body: JSON.stringify({
                    answers: quiz.questions.map((q) => ({ questionId: q.id, selectedOption: answers[q.id] })),
                }),
            }, { retries: 4, retryOn: [502, 503, 504] });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || 'Failed to submit');
                return;
            }
            setLocked(true);
            toast.success('Answer locked in!');
            onAnswered?.();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to submit your answer');
        } finally {
            setSubmitting(false);
        }
    }, [quiz, allAnswered, locked, submitting, answers, onAnswered]);

    if (view === 'hidden' || !pending) return null;

    return (
        <>
            {view === 'toast' && (
                <div className={`toast ${toastAnim ? 'show' : ''}`} onClick={() => {
                    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
                    openPanel(isMobile ? 'split' : 'popup');
                }}>
                    <div className="ticon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>
                    </div>
                    <div className="ttext">
                        <div className="ttitle">New quiz just dropped</div>
                        <div className="tsub">{pending.title} · tap to play</div>
                    </div>
                    <div className="tarrow">
                        <button onClick={(e) => { e.stopPropagation(); close(); }} aria-label="Close notification">
                           <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {(view === 'popup' || view === 'split') && (
                <div 
                    className={view === 'popup' ? 'quiz-pop open' : 'split-slot'}
                    onClick={view === 'popup' ? (e) => { if (e.target === e.currentTarget) close(); } : undefined}
                >
                    <div className="quiz-panel">
                        <div className="qp-head">
                            <div className="qp-title">
                                <span className="livedot"></span>
                                <span className="tt">{pending.title}</span>
                            </div>
                            <div className="qp-actions">
                                <button 
                                    className={`icon-btn ${view === 'split' ? 'active' : ''}`}
                                    onClick={toggleSplit}
                                    title={view === 'split' ? 'Back to popup' : 'Split view'}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>
                                </button>
                                <button className="icon-btn" onClick={close} title="Close">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><path d="M6 6l12 12M18 6 6 18"/></svg>
                                </button>
                            </div>
                        </div>

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

                                    {quiz.questions.map((q, i) => (
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

                                    {!locked && (
                                        <button 
                                            className="qp-submit" 
                                            onClick={submit} 
                                            disabled={!allAnswered || submitting}
                                        >
                                            {submitting ? 'Submitting...' : (allAnswered ? 'Lock in answer' : `Answer all ${quiz.questions.length} questions`)}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="dockhint">
                            {view === 'split' ? 'Split view: the stream keeps playing beside the quiz.' : 'Popup mode: the quiz floats above the stream.'}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
});

export default LiveQuizPush;
