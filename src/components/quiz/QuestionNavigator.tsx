'use client';

import { CheckCircle2, Circle } from 'lucide-react';

interface QuestionNavigatorProps {
    totalQuestions: number;
    currentIndex: number;
    answeredIndexes: number[];
    onNavigate: (index: number) => void;
    className?: string;
}

export default function QuestionNavigator({
    totalQuestions,
    currentIndex,
    answeredIndexes,
    onNavigate,
    className = '',
}: QuestionNavigatorProps) {
    const getQuestionStatus = (index: number) => {
        const isCurrent = index === currentIndex;
        const isAnswered = answeredIndexes.includes(index);

        return { isCurrent, isAnswered };
    };

    return (
        <div className={`bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 ${className}`}>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Question Navigator</h3>
                <span className="text-sm text-gray-400">
                    {answeredIndexes.length}/{totalQuestions} answered
                </span>
            </div>

            <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
                {Array.from({ length: totalQuestions }, (_, index) => {
                    const { isCurrent, isAnswered } = getQuestionStatus(index);

                    return (
                        <button
                            key={index}
                            onClick={() => onNavigate(index)}
                            className={`
                relative w-10 h-10 rounded-lg font-medium transition-all duration-200 
                flex items-center justify-center
                ${isCurrent
                                    ? 'bg-gradient-to-br from-purple-500 to-blue-600 text-white shadow-lg shadow-purple-500/30 scale-110'
                                    : isAnswered
                                        ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                                        : 'bg-gray-700/50 text-gray-400 border border-gray-600/30 hover:bg-gray-700 hover:text-white'
                                }
              `}
                            aria-label={`Go to question ${index + 1}${isAnswered ? ' (answered)' : ''}`}
                        >
                            <span className="relative">
                                {index + 1}
                                {isAnswered && !isCurrent && (
                                    <CheckCircle2 className="absolute -top-1 -right-1 w-3 h-3 text-green-400" />
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-6 mt-4 pt-4 border-t border-white/5">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Circle className="w-3 h-3 fill-purple-500 text-purple-500" />
                    <span>Current</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Circle className="w-3 h-3 fill-green-500/30 text-green-500" />
                    <span>Answered</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Circle className="w-3 h-3 fill-gray-700 text-gray-600" />
                    <span>Unanswered</span>
                </div>
            </div>
        </div>
    );
}
