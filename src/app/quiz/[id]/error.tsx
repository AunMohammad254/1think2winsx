'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function QuizError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Quiz page error:', error);
    }, [error]);

    // Check for specific error types
    const isAccessError = error.message?.toLowerCase().includes('access') ||
        error.message?.toLowerCase().includes('payment') ||
        error.message?.toLowerCase().includes('pay');
    const isNotFoundError = error.message?.toLowerCase().includes('not found');

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-red-500/20 p-8 text-center">
                {/* Icon */}
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
                    {isAccessError ? (
                        <span className="text-4xl">🔒</span>
                    ) : isNotFoundError ? (
                        <span className="text-4xl">🔍</span>
                    ) : (
                        <AlertTriangle className="w-10 h-10 text-red-400" />
                    )}
                </div>

                {/* Title */}
                <h1 className="text-2xl font-bold text-white mb-2">
                    {isAccessError
                        ? 'Quiz Access Required'
                        : isNotFoundError
                            ? 'Quiz Not Found'
                            : 'Quiz Error'}
                </h1>

                {/* Description */}
                <p className="text-gray-400 mb-6">
                    {isAccessError
                        ? 'You need to unlock this quiz before you can take it.'
                        : isNotFoundError
                            ? 'This quiz may have been removed or is no longer available.'
                            : 'Something went wrong while loading the quiz.'}
                </p>

                {/* Error Details (development only) */}
                {process.env.NODE_ENV === 'development' && !isAccessError && (
                    <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-left">
                        <p className="text-sm text-red-300 font-mono break-all">
                            {error.message}
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3">
                    {!isNotFoundError && (
                        <button
                            onClick={reset}
                            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all"
                        >
                            <RefreshCw className="w-5 h-5" />
                            Try Again
                        </button>
                    )}
                    <Link
                        href="/quizzes"
                        className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Quizzes
                    </Link>
                </div>
            </div>
        </div>
    );
}
