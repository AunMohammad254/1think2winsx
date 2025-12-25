'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';

export default function QuizzesError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log the error to an error reporting service
        console.error('Quizzes page error:', error);
    }, [error]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl border border-red-500/20 p-8 text-center">
                {/* Icon */}
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
                    <AlertTriangle className="w-10 h-10 text-red-400" />
                </div>

                {/* Title */}
                <h1 className="text-2xl font-bold text-white mb-2">
                    Something Went Wrong
                </h1>

                {/* Description */}
                <p className="text-gray-400 mb-6">
                    We couldn&apos;t load the quizzes. This might be a temporary issue.
                </p>

                {/* Error Details (development only) */}
                {process.env.NODE_ENV === 'development' && (
                    <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-left">
                        <p className="text-sm text-red-300 font-mono break-all">
                            {error.message}
                        </p>
                        {error.digest && (
                            <p className="text-xs text-red-400/70 mt-2">
                                Error ID: {error.digest}
                            </p>
                        )}
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={reset}
                        className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all"
                    >
                        <RefreshCw className="w-5 h-5" />
                        Try Again
                    </button>
                    <Link
                        href="/"
                        className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                    >
                        <Home className="w-5 h-5" />
                        Go Home
                    </Link>
                </div>
            </div>
        </div>
    );
}
