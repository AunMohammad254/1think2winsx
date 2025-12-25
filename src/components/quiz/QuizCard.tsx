'use client';

import Link from 'next/link';
import { Clock, HelpCircle, Users, Trophy, ChevronRight } from 'lucide-react';

interface QuizCardProps {
    id: string;
    title: string;
    description?: string;
    duration: number;
    questionCount: number;
    attemptCount?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    status: 'active' | 'paused' | 'completed' | 'new';
    hasAccess?: boolean;
    isCompleted?: boolean;
    score?: number;
    onStartClick?: (id: string) => void;
}

const difficultyColors = {
    easy: 'from-green-500 to-emerald-600 text-green-100',
    medium: 'from-yellow-500 to-orange-500 text-yellow-100',
    hard: 'from-red-500 to-rose-600 text-red-100',
};

const statusConfig = {
    active: { label: 'Active', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    paused: { label: 'Paused', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
    completed: { label: 'Completed', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    new: { label: 'New', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
};

export default function QuizCard({
    id,
    title,
    description,
    duration,
    questionCount,
    attemptCount = 0,
    difficulty = 'medium',
    status,
    hasAccess = false,
    isCompleted = false,
    score,
    onStartClick,
}: QuizCardProps) {
    const statusInfo = statusConfig[status] || statusConfig.active;

    const handleClick = (e: React.MouseEvent) => {
        if (onStartClick) {
            e.preventDefault();
            onStartClick(id);
        }
    };

    return (
        <div
            className="group relative bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden transition-all duration-300 hover:border-white/20 hover:shadow-2xl hover:shadow-purple-500/10 hover:-translate-y-1"
        >
            {/* Gradient overlay on hover */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-blue-500/0 group-hover:from-purple-500/5 group-hover:to-blue-500/5 transition-all duration-300" />

            {/* Status Badge */}
            <div className="absolute top-4 right-4 z-10">
                <span className={`px-3 py-1 text-xs font-medium rounded-full border ${statusInfo.color}`}>
                    {statusInfo.label}
                </span>
            </div>

            {/* Difficulty Strip */}
            <div className={`h-1.5 w-full bg-gradient-to-r ${difficultyColors[difficulty]}`} />

            <div className="relative p-6">
                {/* Title & Description */}
                <div className="mb-6 pr-16">
                    <h3 className="text-xl font-bold text-white mb-2 line-clamp-1 group-hover:text-purple-300 transition-colors">
                        {title}
                    </h3>
                    {description && (
                        <p className="text-gray-400 text-sm line-clamp-2">
                            {description}
                        </p>
                    )}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="flex flex-col items-center p-3 rounded-xl bg-white/5 border border-white/5">
                        <Clock className="w-5 h-5 text-blue-400 mb-1" />
                        <span className="text-white font-semibold">{duration}</span>
                        <span className="text-gray-500 text-xs">min</span>
                    </div>
                    <div className="flex flex-col items-center p-3 rounded-xl bg-white/5 border border-white/5">
                        <HelpCircle className="w-5 h-5 text-purple-400 mb-1" />
                        <span className="text-white font-semibold">{questionCount}</span>
                        <span className="text-gray-500 text-xs">questions</span>
                    </div>
                    <div className="flex flex-col items-center p-3 rounded-xl bg-white/5 border border-white/5">
                        <Users className="w-5 h-5 text-green-400 mb-1" />
                        <span className="text-white font-semibold">{attemptCount}</span>
                        <span className="text-gray-500 text-xs">attempts</span>
                    </div>
                </div>

                {/* Completed Score Display */}
                {isCompleted && score !== undefined && (
                    <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/20">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Trophy className="w-5 h-5 text-yellow-400" />
                                <span className="text-gray-300 text-sm">Your Score</span>
                            </div>
                            <span className="text-2xl font-bold text-white">{score}%</span>
                        </div>
                    </div>
                )}

                {/* Action Button */}
                {hasAccess ? (
                    <Link
                        href={`/quiz/${id}`}
                        onClick={handleClick}
                        className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl font-semibold transition-all duration-200 bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 hover:shadow-lg hover:shadow-purple-500/25"
                    >
                        {isCompleted ? 'View Results' : 'Start Quiz'}
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </Link>
                ) : (
                    <button
                        onClick={handleClick}
                        className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl font-semibold transition-all duration-200 bg-gray-700/50 text-gray-300 border border-gray-600/50 hover:bg-gray-600/50 hover:border-gray-500/50"
                    >
                        Unlock Quiz
                        <ChevronRight className="w-5 h-5" />
                    </button>
                )}
            </div>
        </div>
    );
}
