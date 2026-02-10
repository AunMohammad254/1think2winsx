'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { X, Clock, HelpCircle, Target, AlertTriangle, Play, ChevronLeft, ChevronRight, Check, Tv, Loader2 } from 'lucide-react';
import QuizResults from '@/components/QuizResults';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Question {
    id: string;
    text: string;
    options: string[];
}

interface QuizData {
    id: string;
    title: string;
    description: string;
    questions: Question[];
    duration: number;
    timeLimit: number;
    questionCount: number;
    totalQuestions: number;
    isReattempt?: boolean;
    newQuestionsCount?: number;
    previousAttempt?: {
        id: string;
        score: number;
        points: number;
        completedAt: string;
    };
}

interface Answer {
    questionId: string;
    selectedOption: number;
}

interface SubmissionResult {
    message?: string;
    results?: {
        submittedAnswers?: number;
        note?: string;
    };
}

type ModalPhase = 'loading' | 'pre-start' | 'active' | 'results';

interface QuizAttemptModalProps {
    quizId: string;
    isOpen: boolean;
    onClose: () => void;
    onQuizCompleted?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function QuizAttemptModal({ quizId, isOpen, onClose, onQuizCompleted }: QuizAttemptModalProps) {
    const { user } = useAuth();

    // Phase state
    const [phase, setPhase] = useState<ModalPhase>('loading');

    // Quiz data
    const [quiz, setQuiz] = useState<QuizData | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Active quiz state
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<Answer[]>([]);
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Sub-dialogs
    const [showTimeExpired, setShowTimeExpired] = useState(false);
    const [showUnansweredWarning, setShowUnansweredWarning] = useState(false);
    const [showStream, setShowStream] = useState(false);

    // Results
    const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);

    // ─── Body scroll lock ────────────────────────────────────────────────────
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    // ─── Fetch quiz ──────────────────────────────────────────────────────────
    const fetchQuiz = useCallback(async () => {
        setPhase('loading');
        setError(null);
        try {
            const response = await fetch(`/api/quizzes/${quizId}`);
            if (!response.ok) {
                if (response.status === 403) {
                    const errorData = await response.json();
                    if (errorData.completed && errorData.attempt) {
                        setError('You have already completed this quiz.');
                        return;
                    }
                    throw new Error('You need to pay to access this quiz');
                }
                throw new Error('Failed to fetch quiz');
            }
            const data = await response.json();
            setQuiz(data.quiz);
            const durationInSeconds = (data.quiz.duration || 30) * 60;
            setTimeRemaining(durationInSeconds);
            const initialAnswers: Answer[] = data.quiz.questions.map((q: Question) => ({
                questionId: q.id,
                selectedOption: -1,
            }));
            setAnswers(initialAnswers);
            setCurrentQuestionIndex(0);
            setPhase('pre-start');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load quiz');
        }
    }, [quizId]);

    useEffect(() => {
        if (isOpen && user) {
            fetchQuiz();
        }
        // Reset state when modal closes
        if (!isOpen) {
            setPhase('loading');
            setQuiz(null);
            setError(null);
            setAnswers([]);
            setCurrentQuestionIndex(0);
            setTimeRemaining(null);
            setIsSubmitting(false);
            setShowTimeExpired(false);
            setShowUnansweredWarning(false);
            setShowStream(false);
            setSubmissionResult(null);
        }
    }, [isOpen, user, fetchQuiz]);

    // ─── Timer ───────────────────────────────────────────────────────────────
    useEffect(() => {
        if (phase !== 'active' || timeRemaining === null || timeRemaining <= 0) return;

        const timer = setInterval(() => {
            setTimeRemaining(prev => {
                if (prev === null) return null;
                if (prev <= 1) {
                    setShowTimeExpired(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [phase, timeRemaining]);

    // ─── CSRF helper ─────────────────────────────────────────────────────────
    const getCSRFToken = useCallback(async (): Promise<string | null> => {
        try {
            const response = await fetch('/api/csrf-token');
            if (!response.ok) return null;
            const data = await response.json();
            return data.csrfToken;
        } catch {
            return null;
        }
    }, []);

    // ─── Submit quiz ─────────────────────────────────────────────────────────
    const handleSubmitQuiz = useCallback(async (forceSubmit: boolean = false) => {
        if (isSubmitting) return;

        const unansweredCount = answers.filter(a => a.selectedOption === -1).length;
        if (!forceSubmit && unansweredCount > 0) {
            setShowUnansweredWarning(true);
            return;
        }

        setShowUnansweredWarning(false);
        setIsSubmitting(true);
        try {
            const csrfToken = await getCSRFToken();
            if (!csrfToken) {
                throw new Error('Unable to verify security token. Please refresh the page and try again.');
            }

            const response = await fetch(`/api/quizzes/${quizId}/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                body: JSON.stringify({ answers }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || errorData.message || 'Failed to submit quiz');
            }

            const result = await response.json();
            setSubmissionResult(result);
            setPhase('results');
            onQuizCompleted?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to submit quiz');
        } finally {
            setIsSubmitting(false);
        }
    }, [quizId, answers, isSubmitting, getCSRFToken, onQuizCompleted]);

    // ─── Answer handling ─────────────────────────────────────────────────────
    const handleAnswerSelect = (questionId: string, optionIndex: number) => {
        setAnswers(prev =>
            prev.map(answer =>
                answer.questionId === questionId
                    ? { ...answer, selectedOption: optionIndex }
                    : answer
            )
        );
    };

    const handleNextQuestion = () => {
        if (quiz && currentQuestionIndex < quiz.questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        }
    };

    const handlePreviousQuestion = () => {
        if (currentQuestionIndex > 0) {
            setCurrentQuestionIndex(prev => prev - 1);
        }
    };

    // ─── Helpers ─────────────────────────────────────────────────────────────
    const formatTime = (seconds: number | null) => {
        if (seconds === null) return '--:--';
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const getAnsweredCount = () => answers.filter(a => a.selectedOption !== -1).length;

    const handleTimeExpiredClose = async () => {
        setShowTimeExpired(false);
        await handleSubmitQuiz(true);
    };

    const handleModalClose = () => {
        // Only allow closing from pre-start / results / error, not during active quiz
        if (phase === 'active' && !showTimeExpired) return;
        onClose();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            handleModalClose();
        }
    };

    if (!isOpen) return null;

    // ─── LOADING PHASE ───────────────────────────────────────────────────────
    if (phase === 'loading') {
        return (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={handleBackdropClick}>
                <div className="relative w-full max-w-md bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 p-8 text-center">
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                    {error ? (
                        <>
                            <div className="text-red-400 text-6xl mb-4">⚠️</div>
                            <h2 className="text-2xl font-bold text-white mb-4">Quiz Access Error</h2>
                            <p className="text-gray-300 mb-6">{error}</p>
                            <button onClick={onClose} className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-purple-600 transition-all">
                                Back to Quizzes
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-400 mx-auto mb-4" />
                            <p className="text-white text-lg">Loading quiz...</p>
                        </>
                    )}
                </div>
            </div>
        );
    }

    // ─── PRE-START PHASE ─────────────────────────────────────────────────────
    if (phase === 'pre-start' && quiz) {
        return (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={handleBackdropClick}>
                <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 shadow-2xl shadow-purple-500/10">
                    {/* Close Button */}
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors z-10">
                        <X className="w-5 h-5" />
                    </button>

                    <div className="p-6 md:p-8">
                        {/* Header */}
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                                <HelpCircle className="w-8 h-8 text-white" />
                            </div>
                            <h1 className="text-3xl font-bold text-white mb-3">{quiz.title}</h1>
                            <p className="text-gray-300 text-lg">{quiz.description}</p>

                            {/* Reattempt notification */}
                            {quiz.isReattempt && (
                                <div className="mt-6 bg-green-500/20 border border-green-500/30 rounded-xl p-4 text-left">
                                    <h3 className="text-green-200 font-semibold mb-2">🎉 New Questions Available!</h3>
                                    <p className="text-green-100 text-sm">
                                        You&apos;ve already completed this quiz, but {quiz.newQuestionsCount} new questions have been added.
                                        You can now attempt these new questions to improve your score!
                                    </p>
                                    {quiz.previousAttempt && (
                                        <p className="text-green-100 text-xs mt-2">
                                            Previous attempt: {quiz.previousAttempt.score}% on {new Date(quiz.previousAttempt.completedAt).toLocaleDateString()}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-3 gap-4 mb-8">
                            <div className="text-center p-4 rounded-xl bg-white/5 border border-white/5">
                                <Clock className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                                <div className="text-2xl font-bold text-white">{quiz.duration || 30}</div>
                                <div className="text-xs text-gray-500">Minutes</div>
                            </div>
                            <div className="text-center p-4 rounded-xl bg-white/5 border border-white/5">
                                <HelpCircle className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                                <div className="text-2xl font-bold text-white">
                                    {quiz.isReattempt ? quiz.newQuestionsCount : quiz.questions.length}
                                </div>
                                <div className="text-xs text-gray-500">
                                    {quiz.isReattempt ? 'New Questions' : 'Questions'}
                                </div>
                            </div>
                            <div className="text-center p-4 rounded-xl bg-white/5 border border-white/5">
                                <Target className="w-6 h-6 text-green-400 mx-auto mb-2" />
                                <div className="text-2xl font-bold text-white">
                                    {quiz.isReattempt ? 'Re' : '1'}
                                </div>
                                <div className="text-xs text-gray-500">
                                    {quiz.isReattempt ? 'Attempt' : 'Attempt'}
                                </div>
                            </div>
                        </div>

                        {/* Instructions */}
                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mb-8">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="font-semibold text-yellow-300 mb-2">Before You Start</h4>
                                    <ul className="text-sm text-yellow-200/80 space-y-1">
                                        <li>• You have {quiz.duration || 30} minutes to complete all questions</li>
                                        <li>• You can navigate between questions and change answers</li>
                                        <li>• Make sure to submit before time runs out</li>
                                        {quiz.isReattempt ? (
                                            <li>• You&apos;re only answering the new questions added to this quiz</li>
                                        ) : (
                                            <li>• Once submitted, you cannot retake this quiz</li>
                                        )}
                                    </ul>
                                </div>
                            </div>
                        </div>

                        {/* Live Stream Preview */}
                        <div className="mb-8 rounded-xl overflow-hidden border border-white/10">
                            <Suspense fallback={<div className="h-48 bg-gray-800 animate-pulse rounded-xl" />}>
                                <LazyStreamPlayer autoPlay={false} />
                            </Suspense>
                        </div>

                        {/* Start Button */}
                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="flex-1 py-4 px-6 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => setPhase('active')}
                                className="flex-1 flex items-center justify-center gap-2 py-4 px-6 bg-gradient-to-r from-green-500 to-blue-500 text-white text-xl font-bold rounded-xl hover:from-green-600 hover:to-blue-600 transition-all shadow-lg shadow-green-500/25"
                            >
                                <Play className="w-6 h-6" />
                                {quiz.isReattempt ? 'Start New Questions' : 'Start Quiz'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ─── RESULTS PHASE ───────────────────────────────────────────────────────
    if (phase === 'results' && submissionResult) {
        return (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                <div className="relative w-full max-w-lg max-h-[95vh] overflow-y-auto bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 shadow-2xl">
                    {/* Close Button */}
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors z-10">
                        <X className="w-5 h-5" />
                    </button>
                    <div className="p-2">
                        <QuizResults
                            success={true}
                            message={submissionResult.message || "Your predictions have been successfully submitted!"}
                            totalQuestions={quiz?.questions.length || 0}
                            submittedAnswers={submissionResult.results?.submittedAnswers || getAnsweredCount()}
                            note={submissionResult.results?.note || "The admin will review all submissions and add the correct answers. Points will be allocated to the top performers based on accuracy and speed."}
                            isInModal={true}
                            onClose={onClose}
                        />
                    </div>
                </div>
            </div>
        );
    }

    // ─── ACTIVE QUIZ PHASE ───────────────────────────────────────────────────
    if (phase !== 'active' || !quiz) return null;

    const currentQuestion = quiz.questions[currentQuestionIndex];
    const currentAnswer = answers.find(a => a.questionId === currentQuestion?.id);
    const progressPercent = Math.floor(((currentQuestionIndex + 1) / quiz.questions.length) * 100);

    if (!currentQuestion) return null;

    return (
        <div className="fixed inset-0 z-50 bg-gray-950/95 backdrop-blur-sm flex flex-col">
            {/* ──── Top Header Bar ──── */}
            <div className="flex-shrink-0 bg-gray-900/90 border-b border-white/10 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
                    {/* Quiz Title */}
                    <div className="flex-1 min-w-0">
                        <h1 className="text-lg md:text-xl font-bold text-white truncate">{quiz.title}</h1>
                        <p className="text-gray-400 text-sm">
                            Question <span className="text-blue-400 font-semibold">{currentQuestionIndex + 1}</span> of <span className="text-blue-400 font-semibold">{quiz.questions.length}</span>
                        </p>
                    </div>

                    {/* Timer */}
                    <div className={`text-center px-4 py-2 rounded-xl flex-shrink-0 ${(timeRemaining ?? 0) <= 60 ? 'bg-red-500/20 border border-red-500/50' : 'bg-blue-500/10 border border-blue-500/30'}`}>
                        <div className={`text-xl md:text-2xl font-bold font-mono ${(timeRemaining ?? 0) <= 60 ? 'text-red-400 animate-pulse' : (timeRemaining ?? 0) <= 120 ? 'text-yellow-400' : 'text-white'}`}>
                            {formatTime(timeRemaining)}
                        </div>
                        <div className="text-gray-400 text-xs">Time Left</div>
                    </div>

                    {/* Answered Count */}
                    <div className="text-center px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/30 flex-shrink-0 hidden sm:block">
                        <div className="text-xl font-bold text-white">
                            <span className="text-green-400">{getAnsweredCount()}</span>/{quiz.questions.length}
                        </div>
                        <div className="text-gray-400 text-xs">Answered</div>
                    </div>

                    {/* Stream Toggle (mobile) */}
                    <button
                        onClick={() => setShowStream(!showStream)}
                        className="lg:hidden p-2 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:bg-purple-500/30 transition-colors flex-shrink-0"
                        title="Toggle Live Stream"
                    >
                        <Tv className="w-5 h-5" />
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="h-1.5 bg-gray-800">
                    <div
                        className="h-full bg-gradient-to-r from-green-400 via-blue-500 to-purple-500 transition-all duration-500 ease-out"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* ──── Main Content ──── */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-7xl mx-auto px-4 py-6">
                    <div className="flex flex-col lg:flex-row gap-6">
                        {/* Left: Quiz Content */}
                        <div className="flex-1 max-w-4xl space-y-6">
                            {/* Question Card */}
                            <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 md:p-8">
                                {/* Question Number Badge */}
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-sm mb-4">
                                    <span>❓</span>
                                    <span>Question {currentQuestionIndex + 1}</span>
                                </div>

                                <h2 className="text-lg md:text-xl font-semibold text-white mb-6 leading-relaxed">
                                    {currentQuestion.text}
                                </h2>

                                {/* Options */}
                                <div className="space-y-3">
                                    {currentQuestion.options.map((option, index) => {
                                        const isSelected = currentAnswer?.selectedOption === index;
                                        return (
                                            <button
                                                key={index}
                                                onClick={() => handleAnswerSelect(currentQuestion.id, index)}
                                                className={`w-full min-h-[60px] p-4 md:p-5 text-left rounded-xl border-2 transition-all duration-200 transform active:scale-[0.98] ${isSelected
                                                    ? 'border-blue-400 bg-gradient-to-r from-blue-500/30 to-purple-500/30 text-white shadow-lg shadow-blue-500/20'
                                                    : 'border-gray-600 bg-gray-800/50 text-gray-300 hover:border-gray-400 hover:bg-gray-700/50'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-4">
                                                    <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full border-2 flex items-center justify-center font-bold text-sm md:text-base flex-shrink-0 transition-all duration-200 ${isSelected
                                                        ? 'border-blue-400 bg-blue-500 text-white'
                                                        : 'border-gray-500 text-gray-400'
                                                        }`}>
                                                        {String.fromCharCode(65 + index)}
                                                    </div>
                                                    <span className="font-medium text-sm md:text-base">{option}</span>
                                                    {isSelected && (
                                                        <div className="ml-auto">
                                                            <Check className="w-6 h-6 text-blue-400" />
                                                        </div>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Navigation */}
                            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                                <button
                                    onClick={handlePreviousQuestion}
                                    disabled={currentQuestionIndex === 0}
                                    className="w-full sm:w-auto py-3 px-6 bg-gray-800/60 border border-white/10 text-gray-300 rounded-xl font-medium hover:bg-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                    Previous
                                </button>

                                {/* Mobile answered count */}
                                <div className="sm:hidden text-center px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/30">
                                    <span className="text-green-400 font-bold">{getAnsweredCount()}</span>
                                    <span className="text-white font-bold">/{quiz.questions.length}</span>
                                    <span className="text-gray-400 text-xs ml-2">Answered</span>
                                </div>

                                <div className="flex gap-3 w-full sm:w-auto">
                                    {currentQuestionIndex === quiz.questions.length - 1 ? (
                                        <button
                                            onClick={() => handleSubmitQuiz()}
                                            disabled={isSubmitting}
                                            className="flex-1 sm:flex-none py-3 px-8 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-semibold hover:from-green-600 hover:to-emerald-700 transition-all disabled:opacity-50 shadow-lg shadow-green-500/25 flex items-center justify-center gap-2"
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <Loader2 className="w-5 h-5 animate-spin" />
                                                    Submitting...
                                                </>
                                            ) : (
                                                <>
                                                    Submit Quiz
                                                    <Check className="w-5 h-5" />
                                                </>
                                            )}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleNextQuestion}
                                            className="flex-1 sm:flex-none py-3 px-8 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-semibold hover:from-blue-600 hover:to-purple-600 transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2"
                                        >
                                            Next
                                            <ChevronRight className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Question Navigator */}
                            <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">Question Navigator</h3>
                                <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
                                    {quiz.questions.map((_, index) => {
                                        const isAnswered = answers[index]?.selectedOption !== -1;
                                        const isCurrent = index === currentQuestionIndex;
                                        return (
                                            <button
                                                key={index}
                                                onClick={() => setCurrentQuestionIndex(index)}
                                                className={`w-10 h-10 rounded-lg font-medium transition-all duration-200 ${isCurrent
                                                    ? 'bg-blue-500 text-white ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900'
                                                    : isAnswered
                                                        ? 'bg-green-500/30 text-green-400 border border-green-500/50'
                                                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                                                    }`}
                                            >
                                                {index + 1}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Right: Live Stream Sidebar (Desktop) */}
                        <div className="hidden lg:block lg:w-80 xl:w-96">
                            <div className="sticky top-6 space-y-4">
                                <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-lg font-semibold text-white">📺 Live Stream</h3>
                                        <div className="flex items-center space-x-2">
                                            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                            <span className="text-red-400 text-sm font-medium">LIVE</span>
                                        </div>
                                    </div>
                                    <LazyStreamPlayer />
                                </div>
                                <div className="bg-gray-900/60 border border-white/10 rounded-xl p-4">
                                    <p className="text-gray-300 text-sm">
                                        💡 <strong>Tip:</strong> Watch the live stream for hints and explanations that might help you with the quiz!
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ──── Mobile Stream Modal ──── */}
            {showStream && (
                <div className="lg:hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/10 rounded-2xl p-4 w-full max-w-md max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-white">📺 Live Stream</h3>
                            <button onClick={() => setShowStream(false)} className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <LazyStreamPlayer />
                        <div className="mt-4 p-3 bg-blue-500/20 border border-blue-500/30 rounded-xl">
                            <p className="text-blue-100 text-sm">
                                💡 Watch for hints and explanations that might help with your quiz!
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ──── Time Expired Dialog ──── */}
            {showTimeExpired && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/10 rounded-2xl p-8 max-w-md w-full text-center">
                        <div className="text-6xl mb-6">⏰</div>
                        <h2 className="text-2xl font-bold text-white mb-4">Your Quiz Time is Over!</h2>
                        <p className="text-gray-300 mb-6">
                            Your time has expired. We&apos;ll submit your answers now.
                        </p>
                        <button
                            onClick={handleTimeExpiredClose}
                            disabled={isSubmitting}
                            className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-lg font-bold rounded-xl hover:from-blue-600 hover:to-purple-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Submitting...
                                </>
                            ) : (
                                'Submit & View Results'
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* ──── Unanswered Questions Warning ──── */}
            {showUnansweredWarning && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/10 rounded-2xl p-8 max-w-md w-full text-center">
                        <div className="text-6xl mb-6">⚠️</div>
                        <h2 className="text-2xl font-bold text-white mb-4">Answer All Questions</h2>
                        <p className="text-gray-300 mb-4">
                            You have <span className="text-red-400 font-bold">{answers.filter(a => a.selectedOption === -1).length}</span> unanswered question{answers.filter(a => a.selectedOption === -1).length !== 1 ? 's' : ''}.
                        </p>
                        <p className="text-yellow-300 text-sm mb-6">
                            Please answer all questions before submitting the quiz.
                        </p>

                        {/* Show unanswered question numbers */}
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                            <p className="text-gray-400 text-sm mb-2">Unanswered questions:</p>
                            <div className="flex flex-wrap gap-2 justify-center">
                                {answers.map((answer, index) =>
                                    answer.selectedOption === -1 ? (
                                        <button
                                            key={index}
                                            onClick={() => {
                                                setCurrentQuestionIndex(index);
                                                setShowUnansweredWarning(false);
                                            }}
                                            className="w-10 h-10 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 font-medium hover:bg-red-500/30 transition-colors"
                                        >
                                            {index + 1}
                                        </button>
                                    ) : null
                                )}
                            </div>
                        </div>

                        <button
                            onClick={() => setShowUnansweredWarning(false)}
                            className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-lg font-bold rounded-xl hover:from-blue-600 hover:to-purple-600 transition-all"
                        >
                            Go Answer Questions
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
