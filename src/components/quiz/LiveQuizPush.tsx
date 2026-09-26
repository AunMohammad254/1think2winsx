'use client';

import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { X, Zap, PanelRightClose, PanelRightOpen, Loader2, CheckCircle2, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { getCSRFToken } from '@/lib/csrf';

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
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Fetches quiz content by id. Never touches `answers`/`locked` - safe to
    // call again for a quiz that's already loaded (e.g. reopening from the
    // bell) without losing what the viewer already picked.
    const loadQuiz = useCallback(async (quizId: string) => {
        try {
            const res = await fetch(`/api/quizzes/${quizId}`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'This quiz is no longer available');
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
        setView('toast');
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
        setView('popup');
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
            const res = await fetch(`/api/quizzes/${quiz.id}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '' },
                body: JSON.stringify({
                    answers: quiz.questions.map((q) => ({ questionId: q.id, selectedOption: answers[q.id] })),
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to submit');
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
                <div className="absolute left-3 right-3 top-3 z-40 flex items-center justify-between rounded-2xl border border-white/15 bg-gradient-to-br from-blue-600/25 via-purple-600/20 to-pink-600/20 backdrop-blur-xl px-4 py-3 shadow-2xl animate-in slide-in-from-top-4 duration-300">
                    <button
                        onClick={() => openPanel('popup')}
                        className="flex items-center gap-3 text-left flex-1 min-w-0"
                    >
                        <span className="flex-none w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-pink-500 flex items-center justify-center animate-bounce">
                            <Bell className="w-4 h-4 text-white" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold text-white">New quiz just dropped</span>
                            <span className="block text-xs text-gray-300 truncate">{pending.title} · tap to play</span>
                        </span>
                    </button>
                    <button
                        onClick={close}
                        className="ml-3 p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                        aria-label="Close notification"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {(view === 'popup' || view === 'split') && (
                <div
                    className={
                        view === 'popup'
                            ? 'absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4'
                            : 'contents'
                    }
                    onClick={view === 'popup' ? (e) => { if (e.target === e.currentTarget) close(); } : undefined}
                >
                    <div
                        className={
                            view === 'popup'
                                ? 'w-full max-w-sm max-h-full flex flex-col rounded-2xl border border-white/15 bg-gray-950/95 backdrop-blur-xl shadow-2xl overflow-hidden'
                                // Split view: side-by-side on md+ (stream left, quiz right, both
                                // in one frame via the shared flex row in quizzes/page.tsx); on
                                // phones a flex row can't fit both meaningfully, so it stacks
                                // below the stream instead with its own capped, scrollable height.
                                : 'flex-1 md:basis-2/5 min-w-0 max-h-[55vh] md:max-h-none flex flex-col border-t md:border-t-0 md:border-l border-white/10 bg-gray-950/95 backdrop-blur-xl overflow-hidden'
                        }
                    >
                        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 flex-none">
                            <div className="min-w-0 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-none" />
                                <span className="text-sm font-bold text-white truncate">{pending.title}</span>
                            </div>
                            <div className="flex items-center gap-1.5 flex-none">
                                <button
                                    onClick={toggleSplit}
                                    title={view === 'split' ? 'Back to popup' : 'Split view'}
                                    className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${view === 'split' ? 'border-blue-400 text-blue-400 bg-blue-500/10' : 'border-white/15 text-gray-400 hover:text-white hover:bg-white/10'}`}
                                >
                                    {view === 'split' ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                    onClick={close}
                                    title="Close"
                                    className="w-7 h-7 rounded-lg border border-white/15 text-gray-400 hover:text-white hover:bg-white/10 flex items-center justify-center"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 py-4">
                            {loadError && (
                                <p className="text-sm text-red-300">{loadError}</p>
                            )}
                            {!quiz && !loadError && (
                                <div className="flex items-center justify-center py-10 text-gray-400">
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                </div>
                            )}
                            {quiz && (
                                <div className="space-y-5">
                                    {locked && (
                                        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            Answer locked in — waiting for the admin to reveal results
                                        </div>
                                    )}
                                    {quiz.questions.map((q, i) => (
                                        <div key={q.id}>
                                            <p className="text-sm font-semibold text-white mb-2">{i + 1}. {q.text}</p>
                                            <div className="space-y-1.5">
                                                {q.options.map((opt, idx) => {
                                                    const picked = answers[q.id] === idx;
                                                    return (
                                                        <button
                                                            key={idx}
                                                            disabled={locked}
                                                            onClick={() => pick(q.id, idx)}
                                                            className={`w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${picked
                                                                ? (locked ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-blue-500/50 bg-blue-500/10 text-blue-100')
                                                                : 'border-white/10 text-gray-300 hover:border-white/25 hover:bg-white/5'
                                                                } ${locked ? 'cursor-default' : 'cursor-pointer'}`}
                                                        >
                                                            <span className={`w-3 h-3 rounded-full border-2 flex-none ${picked ? (locked ? 'border-emerald-400 bg-emerald-400' : 'border-blue-400 bg-blue-400') : 'border-gray-500'}`} />
                                                            {opt}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {quiz && !locked && (
                            <div className="flex-none px-4 py-3 border-t border-white/10">
                                <button
                                    onClick={submit}
                                    disabled={!allAnswered || submitting}
                                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-purple-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {allAnswered ? 'Lock in answer' : `Answer all ${quiz.questions.length} questions (${answeredCount}/${quiz.questions.length})`}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
});

export default LiveQuizPush;
