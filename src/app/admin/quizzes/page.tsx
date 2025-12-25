import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, RefreshCw } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';

import { getQuizzes } from '@/actions/dashboard-actions';
import QuizDataTable, { QuizDataTableSkeleton } from '@/components/admin/quizzes/QuizDataTable';
import QuizFilters from '@/components/admin/quizzes/QuizFilters';

// ============================================
// Types
// ============================================
interface PageProps {
    searchParams: Promise<{
        query?: string;
        page?: string;
        status?: string;
        sortBy?: string;
        sortOrder?: string;
    }>;
}

// ============================================
// Auth Check
// ============================================
async function checkAuth() {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        redirect('/login');
    }

    return session;
}

// ============================================
// Data Fetching Component
// ============================================
async function QuizTable({ searchParams }: {
    searchParams: {
        query?: string;
        page?: string;
        status?: string;
        sortBy?: string;
        sortOrder?: string;
    }
}) {
    const data = await getQuizzes({
        page: parseInt(searchParams.page || '1'),
        pageSize: 10,
        search: searchParams.query || '',
        status: searchParams.status || 'all',
        sortBy: searchParams.sortBy || 'createdAt',
        sortOrder: (searchParams.sortOrder as 'asc' | 'desc') || 'desc',
    });

    return <QuizDataTable data={data} searchParams={searchParams} />;
}

// ============================================
// Stats Summary Component
// ============================================
async function QuizStats() {
    const [allData, activeData, draftData, pausedData] = await Promise.all([
        getQuizzes({ pageSize: 1, status: 'all' }),
        getQuizzes({ pageSize: 1, status: 'active' }),
        getQuizzes({ pageSize: 1, status: 'draft' }),
        getQuizzes({ pageSize: 1, status: 'paused' }),
    ]);

    const stats = [
        { label: 'Total', value: allData.pagination.total, color: 'text-white' },
        { label: 'Published', value: activeData.pagination.total, color: 'text-green-400' },
        { label: 'Drafts', value: draftData.pagination.total, color: 'text-gray-400' },
        { label: 'Paused', value: pausedData.pagination.total, color: 'text-yellow-400' },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {stats.map((stat) => (
                <div
                    key={stat.label}
                    className="rounded-xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl p-4"
                >
                    <p className="text-3xl font-bold text-white">{stat.value}</p>
                    <p className={`text-sm ${stat.color}`}>{stat.label}</p>
                </div>
            ))}
        </div>
    );
}

function StatsSkeleton() {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[...Array(4)].map((_, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-gray-900/50 p-4">
                    <div className="h-8 w-16 bg-gray-700/50 rounded animate-pulse mb-2" />
                    <div className="h-4 w-20 bg-gray-700/50 rounded animate-pulse" />
                </div>
            ))}
        </div>
    );
}

// ============================================
// Main Page Component
// ============================================
export default async function AdminQuizzesPage({ searchParams }: PageProps) {
    await checkAuth();
    const resolvedSearchParams = await searchParams;

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between py-4">
                        <div className="flex items-center gap-4">
                            <Link
                                href="/admin/dashboard"
                                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </Link>
                            <div>
                                <h1 className="text-2xl font-bold text-white">Quiz Management</h1>
                                <p className="text-gray-400 text-sm">Create, edit, and manage your quizzes</p>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Stats Summary */}
                <Suspense fallback={<StatsSkeleton />}>
                    <QuizStats />
                </Suspense>

                {/* Filters - Client Component for interactivity */}
                <QuizFilters
                    defaultSearch={resolvedSearchParams.query}
                    defaultStatus={resolvedSearchParams.status}
                />

                {/* Data Table */}
                <Suspense
                    key={JSON.stringify(resolvedSearchParams)}
                    fallback={<QuizDataTableSkeleton />}
                >
                    <QuizTable searchParams={resolvedSearchParams} />
                </Suspense>
            </main>
        </div>
    );
}
