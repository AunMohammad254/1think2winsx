'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Trophy, CheckCircle, XCircle, RotateCcw, Home, Share2, Clock, Target } from 'lucide-react';
import confetti from 'canvas-confetti';

interface QuizResultsCardProps {
    quizTitle: string;
    totalQuestions: number;
    correctAnswers: number;
    incorrectAnswers: number;
    unanswered: number;
    timeTaken?: string;
    passingScore: number;
    isPending?: boolean;
    quizId: string;
    message?: string;
    note?: string;
    showDetailedBreakdown?: boolean;
}

export default function QuizResultsCard({
    quizTitle,
    totalQuestions,
    correctAnswers,
    incorrectAnswers,
    unanswered,
    timeTaken,
    passingScore,
    isPending = false,
    quizId,
    message,
    note,
    showDetailedBreakdown = true,
}: QuizResultsCardProps) {
    const [showAnimation, setShowAnimation] = useState(true);

    const scorePercentage = Math.round((correctAnswers / totalQuestions) * 100);
    const passed = !isPending && scorePercentage >= passingScore;
    const totalAnswered = correctAnswers + incorrectAnswers;

    // Confetti animation for passing score
    useEffect(() => {
        if (passed && !isPending) {
            const duration = 3 * 1000;
            const animationEnd = Date.now() + duration;

            const interval = setInterval(() => {
                const timeLeft = animationEnd - Date.now();
                if (timeLeft <= 0) {
                    clearInterval(interval);
                    return;
                }

                confetti({
                    particleCount: 3,
                    angle: 60,
                    spread: 55,
                    origin: { x: 0 },
                    colors: ['#a855f7', '#3b82f6', '#22c55e'],
                });
                confetti({
                    particleCount: 3,
                    angle: 120,
                    spread: 55,
                    origin: { x: 1 },
                    colors: ['#a855f7', '#3b82f6', '#22c55e'],
                });
            }, 150);

            return () => clearInterval(interval);
        }
    }, [passed, isPending]);

    // Hide animation after delay
    useEffect(() => {
        const timer = setTimeout(() => setShowAnimation(false), 3000);
        return () => clearTimeout(timer);
    }, []);

    const getScoreColor = () => {
        if (isPending) return 'text-yellow-400';
        if (scorePercentage >= 80) return 'text-green-400';
        if (scorePercentage >= 60) return 'text-yellow-400';
        return 'text-red-400';
    };

    const getScoreGradient = () => {
        if (isPending) return 'from-yellow-500 to-orange-500';
        if (scorePercentage >= 80) return 'from-green-500 to-emerald-600';
        if (scorePercentage >= 60) return 'from-yellow-500 to-orange-500';
        return 'from-red-500 to-rose-600';
    };

    return (
        <div className="w-full max-w-2xl mx-auto">
            <div className="bg-gradient-to-br from-gray-900/90 to-gray-800/70 backdrop-blur-xl rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
                {/* Header with Animation */}
                <div className={`relative py-8 px-6 bg-gradient-to-r ${getScoreGradient()} bg-opacity-10`}>
                    {showAnimation && !isPending && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className={`text-6xl ${passed ? 'animate-bounce' : 'animate-pulse'}`}>
                                {passed ? '🎉' : '💪'}
                            </div>
                        </div>
                    )}

                    <div className="text-center relative z-10">
                        <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
                            {isPending ? 'Quiz Submitted!' : passed ? 'Congratulations!' : 'Quiz Complete!'}
                        </h1>
                        <p className="text-white/80">{quizTitle}</p>
                    </div>
                </div>

                {/* Score Display */}
                <div className="p-8">
                    {/* Main Score Circle */}
                    <div className="flex justify-center mb-8">
                        <div className="relative">
                            <div className={`w-36 h-36 rounded-full bg-gradient-to-br ${getScoreGradient()} flex items-center justify-center shadow-lg`}>
                                <div className="w-28 h-28 rounded-full bg-gray-900 flex flex-col items-center justify-center">
                                    {isPending ? (
                                        <>
                                            <Clock className="w-8 h-8 text-yellow-400 mb-1" />
                                            <span className="text-sm text-yellow-400">Pending</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className={`text-4xl font-bold ${getScoreColor()}`}>
                                                {scorePercentage}%
                                            </span>
                                            <span className="text-gray-400 text-sm">Score</span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Status Badge */}
                            {!isPending && (
                                <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-sm font-semibold ${passed
                                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                    }`}>
                                    {passed ? 'Passed' : 'Failed'}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Message */}
                    {message && (
                        <div className="text-center mb-6">
                            <p className="text-lg text-gray-300">{message}</p>
                        </div>
                    )}

                    {/* Stats Grid */}
                    {showDetailedBreakdown && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                            <div className="bg-white/5 rounded-xl p-4 text-center border border-white/5">
                                <div className="text-2xl font-bold text-white">{totalQuestions}</div>
                                <div className="text-xs text-gray-500">Total</div>
                            </div>
                            <div className="bg-green-500/10 rounded-xl p-4 text-center border border-green-500/20">
                                <div className="flex items-center justify-center gap-1">
                                    <CheckCircle className="w-5 h-5 text-green-400" />
                                    <span className="text-2xl font-bold text-green-400">{correctAnswers}</span>
                                </div>
                                <div className="text-xs text-green-400/70">Correct</div>
                            </div>
                            <div className="bg-red-500/10 rounded-xl p-4 text-center border border-red-500/20">
                                <div className="flex items-center justify-center gap-1">
                                    <XCircle className="w-5 h-5 text-red-400" />
                                    <span className="text-2xl font-bold text-red-400">{incorrectAnswers}</span>
                                </div>
                                <div className="text-xs text-red-400/70">Incorrect</div>
                            </div>
                            <div className="bg-white/5 rounded-xl p-4 text-center border border-white/5">
                                <div className="flex items-center justify-center gap-1">
                                    <Target className="w-5 h-5 text-gray-400" />
                                    <span className="text-2xl font-bold text-gray-400">{unanswered}</span>
                                </div>
                                <div className="text-xs text-gray-500">Skipped</div>
                            </div>
                        </div>
                    )}

                    {/* Time Taken */}
                    {timeTaken && (
                        <div className="flex items-center justify-center gap-2 mb-6 text-gray-400">
                            <Clock className="w-4 h-4" />
                            <span>Time taken: {timeTaken}</span>
                        </div>
                    )}

                    {/* Note for Pending */}
                    {isPending && note && (
                        <div className="mb-8 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                            <h3 className="font-semibold text-yellow-300 mb-2">What&apos;s Next?</h3>
                            <p className="text-yellow-200/80 text-sm">{note}</p>
                            <ul className="mt-3 space-y-1 text-sm text-yellow-200/70">
                                <li>• Admin will review and add correct answers</li>
                                <li>• Top performers will receive points</li>
                                <li>• Use points to redeem amazing prizes!</li>
                            </ul>
                        </div>
                    )}

                    {/* Passing Info */}
                    {!isPending && (
                        <div className="mb-6 p-4 bg-white/5 rounded-xl border border-white/5">
                            <div className="flex items-center justify-between">
                                <span className="text-gray-400">Passing Score</span>
                                <span className="font-medium text-white">{passingScore}%</span>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-gray-400">Your Score</span>
                                <span className={`font-medium ${getScoreColor()}`}>{scorePercentage}%</span>
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-3">
                        <Link
                            href="/quizzes"
                            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all"
                        >
                            <Trophy className="w-5 h-5" />
                            More Quizzes
                        </Link>

                        {!isPending && (
                            <Link
                                href={`/quiz/${quizId}`}
                                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                            >
                                <RotateCcw className="w-5 h-5" />
                                Retake Quiz
                            </Link>
                        )}

                        <button
                            onClick={() => {
                                navigator.share?.({
                                    title: 'Quiz Results',
                                    text: `I scored ${scorePercentage}% on ${quizTitle}!`,
                                    url: window.location.href,
                                });
                            }}
                            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                        >
                            <Share2 className="w-5 h-5" />
                            Share
                        </button>
                    </div>

                    {/* Home Link */}
                    <div className="mt-4 text-center">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <Home className="w-4 h-4" />
                            Back to Home
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
