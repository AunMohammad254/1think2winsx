'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

// Lazy load the heavy QuizEvaluationManager component (967 lines, 36KB)
const QuizEvaluationManager = dynamic(
    () => import('@/components/QuizEvaluationManager'),
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

export default function QuizEvaluationPage() {
    const router = useRouter();
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check admin access
        const checkAdmin = async () => {
            try {
                const response = await fetch('/api/admin/quizzes');
                if (response.status === 403) {
                    router.push('/login');
                    return;
                }
                setIsAdmin(true);
            } catch (error) {
                console.error('Admin check failed:', error);
                router.push('/login');
            } finally {
                setLoading(false);
            }
        };

        checkAdmin();
    }, [router]);

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-400">Loading...</p>
                </div>
            </div>
        );
    }

    if (!isAdmin) {
        return null;
    }

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
                        <h1 className="text-3xl font-bold text-white">Quiz Evaluation</h1>
                    </div>
                    <p className="text-gray-400">Set correct answers and evaluate quiz attempts</p>
                </div>

                {/* Quiz Evaluation Manager */}
                <QuizEvaluationManager />
            </div>
        </div>
    );
}
