'use client';

import { useState } from 'react';
import { X, Clock, HelpCircle, Target, AlertTriangle, Play } from 'lucide-react';

interface QuizDetailModalProps {
    quiz: {
        id: string;
        title: string;
        description?: string;
        duration: number;
        questionCount: number;
        passingScore: number;
        difficulty?: 'easy' | 'medium' | 'hard';
        attemptCount?: number;
        isReattempt?: boolean;
        newQuestionsCount?: number;
    };
    isOpen: boolean;
    onClose: () => void;
    onStartQuiz?: (quizId: string) => void;
}

const difficultyConfig = {
    easy: { label: 'Easy', color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/30' },
    medium: { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30' },
    hard: { label: 'Hard', color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30' },
};

export default function QuizDetailModal({ quiz, isOpen, onClose, onStartQuiz }: QuizDetailModalProps) {
    const [isStarting, setIsStarting] = useState(false);

    const difficulty = quiz.difficulty || 'medium';
    const difficultyInfo = difficultyConfig[difficulty];

    const handleStartQuiz = () => {
        setIsStarting(true);
        if (onStartQuiz) {
            onStartQuiz(quiz.id);
        }
        onClose();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={handleBackdropClick}
        >
            <div className="relative w-full max-w-lg bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-white/10 shadow-2xl shadow-purple-500/10 animate-in zoom-in-95 duration-200">
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors z-10"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* Header */}
                <div className="p-6 pb-4 border-b border-white/10">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                            <HelpCircle className="w-6 h-6 text-white" />
                        </div>
                        <div className="flex-1 min-w-0 pr-8">
                            <h2 className="text-2xl font-bold text-white mb-1 line-clamp-2">
                                {quiz.title}
                            </h2>
                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${difficultyInfo.bg} ${difficultyInfo.color} ${difficultyInfo.border}`}>
                                {difficultyInfo.label}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Description */}
                    {quiz.description && (
                        <p className="text-gray-300 leading-relaxed">
                            {quiz.description}
                        </p>
                    )}

                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-4 rounded-xl bg-white/5 border border-white/5">
                            <Clock className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                            <div className="text-xl font-bold text-white">{quiz.duration}</div>
                            <div className="text-xs text-gray-500">Minutes</div>
                        </div>
                        <div className="text-center p-4 rounded-xl bg-white/5 border border-white/5">
                            <HelpCircle className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                            <div className="text-xl font-bold text-white">
                                {quiz.isReattempt ? quiz.newQuestionsCount : quiz.questionCount}
                            </div>
                            <div className="text-xs text-gray-500">
                                {quiz.isReattempt ? 'New Questions' : 'Questions'}
                            </div>
                        </div>
                        <div className="text-center p-4 rounded-xl bg-white/5 border border-white/5">
                            <Target className="w-6 h-6 text-green-400 mx-auto mb-2" />
                            <div className="text-xl font-bold text-white">{quiz.passingScore}%</div>
                            <div className="text-xs text-gray-500">To Pass</div>
                        </div>
                    </div>

                    {/* Reattempt Notice */}
                    {quiz.isReattempt && (
                        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                            <div className="flex items-start gap-3">
                                <span className="text-2xl">🎉</span>
                                <div>
                                    <h4 className="font-semibold text-green-300">New Questions Available!</h4>
                                    <p className="text-sm text-green-200/80 mt-1">
                                        {quiz.newQuestionsCount} new questions have been added. Answer them to improve your score!
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Instructions */}
                    <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <h4 className="font-semibold text-yellow-300 mb-2">Before You Start</h4>
                                <ul className="text-sm text-yellow-200/80 space-y-1">
                                    <li>• Timer starts immediately after you begin</li>
                                    <li>• You can navigate between questions freely</li>
                                    <li>• Quiz auto-submits when time runs out</li>
                                    <li>• Ensure stable internet connection</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 pt-4 border-t border-white/10 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleStartQuiz}
                        disabled={isStarting}
                        className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isStarting ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                <Play className="w-5 h-5" />
                                Start Quiz
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
