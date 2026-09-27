'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function PrizesError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Prizes page error:', error);
    }, [error]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900/50 to-slate-900 flex items-center justify-center">
            <div className="max-w-md mx-auto text-center px-4">
                <div className="mb-8">
                    <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
                        <span className="text-5xl">😔</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-3">
                        Oops! Something went wrong
                    </h1>
                    <p className="text-gray-400 mb-6">
                        We couldn&apos;t load the prizes. This might be a temporary issue.
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button
                        onClick={reset}
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300"
                    >
                        Try Again
                    </button>
                    <Link
                        href="/"
                        className="px-6 py-3 bg-slate-800 text-gray-300 font-semibold rounded-xl border border-white/10 hover:bg-slate-700 transition-colors"
                    >
                        Go Home
                    </Link>
                </div>

                {error.digest && (
                    <p className="mt-8 text-xs text-gray-500">
                        Error ID: {error.digest}
                    </p>
                )}
            </div>
        </div>
    );
}
