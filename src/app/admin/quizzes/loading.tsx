import { QuizDataTableSkeleton } from '@/components/admin/quizzes/QuizDataTable';

export default function QuizzesLoading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
            {/* Header Skeleton */}
            <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between py-4">
                        <div className="flex items-center gap-4">
                            <div className="w-9 h-9 bg-gray-700/50 rounded-lg animate-pulse" />
                            <div className="space-y-2">
                                <div className="h-8 w-48 bg-gray-700/50 rounded animate-pulse" />
                                <div className="h-4 w-64 bg-gray-700/50 rounded animate-pulse" />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Stats Skeleton */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="rounded-xl border border-white/10 bg-gray-900/50 p-4">
                            <div className="h-8 w-16 bg-gray-700/50 rounded animate-pulse mb-2" />
                            <div className="h-4 w-20 bg-gray-700/50 rounded animate-pulse" />
                        </div>
                    ))}
                </div>

                {/* Filters Skeleton */}
                <div className="flex flex-col lg:flex-row gap-4 mb-6">
                    <div className="h-11 w-full max-w-md bg-gray-700/30 rounded-xl animate-pulse" />
                    <div className="flex gap-2">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="h-9 w-20 bg-gray-700/30 rounded-lg animate-pulse" />
                        ))}
                    </div>
                    <div className="lg:ml-auto h-11 w-32 bg-purple-600/30 rounded-xl animate-pulse" />
                </div>

                {/* Table Skeleton */}
                <QuizDataTableSkeleton />
            </main>
        </div>
    );
}
