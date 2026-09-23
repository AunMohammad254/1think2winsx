'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

// Lazy-load the heavy manager component
const LuckyWinnerManager = dynamic(
    () => import('@/components/admin/LuckyWinnerManager'),
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
        ssr: false,
    }
);

export default function LuckyWinnerPage() {
    const router = useRouter();
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkAdmin = async () => {
            try {
                const response = await fetch('/api/admin/quizzes');
                if (response.status === 401 || response.status === 403) {
                    router.push('/admin/login');
                    return;
                }
                setIsAdmin(true);
            } catch {
                router.push('/admin/login');
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
                    <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Loading...</p>
                </div>
            </div>
        );
    }

    if (!isAdmin) return null;

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
                        <h1 className="text-3xl font-bold text-white">Lucky Winner Draw</h1>
                        <span className="px-2 py-0.5 bg-yellow-500/20 border border-yellow-400/30 rounded-full text-xs font-medium text-yellow-300">
                            Admin Only
                        </span>
                    </div>
                    <p className="text-gray-400 ml-8">
                        Conduct fair, auditable random draws for prize-linked quizzes
                    </p>
                </div>

                <LuckyWinnerManager />
            </div>
        </div>
    );
}
