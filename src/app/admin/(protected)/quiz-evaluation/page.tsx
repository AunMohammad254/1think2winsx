'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

// Lazy load the settlement screen: admin-only, so it stays out of every other page's bundle
const QuizSettlementManager = dynamic(
    () => import('@/components/admin/QuizSettlementManager'),
    {
        loading: () => (
            <div className="space-y-6">
                <div className="h-32 bg-gray-800/50 rounded-xl animate-pulse" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-24 bg-gray-800/50 rounded-xl animate-pulse" />
                    ))}
                </div>
                <div className="h-64 bg-gray-800/50 rounded-xl animate-pulse" />
            </div>
        ),
        ssr: false // Admin component, no SSR needed
    }
);

/**
 * The admin layout checks the admin session on the server before this renders, so the screen loads its
 * quizzes at once. It used to fetch the whole admin quiz list first, only to check access.
 */
export default function QuizEvaluationPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <Link
                            href="/admin/dashboard"
                            className="text-gray-400 hover:text-white transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </Link>
                        <h1 className="text-3xl font-bold text-white">Settle Quizzes</h1>
                    </div>
                    <p className="text-gray-400">
                        Enter each quiz&apos;s result, reward 1st to 3rd place with points or a prize, share the points pool, and settle it once
                    </p>
                </div>

                {/* Settlement: Open -> Awaiting result -> Ready to settle -> Settled */}
                <QuizSettlementManager />
            </div>
        </div>
    );
}
