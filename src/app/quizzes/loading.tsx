import { QuizCardSkeletonGrid } from '@/components/quiz/QuizCardSkeleton';

export default function QuizzesLoading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-12 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header Skeleton */}
                <div className="mb-12 animate-pulse">
                    <div className="h-10 w-64 bg-gray-800 rounded-xl mb-4" />
                    <div className="h-5 w-96 bg-gray-800/70 rounded-lg" />
                </div>

                {/* Filter Tabs Skeleton */}
                <div className="flex gap-3 mb-8 animate-pulse">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-10 w-24 bg-gray-800 rounded-full" />
                    ))}
                </div>

                {/* Quiz Grid Skeleton */}
                <QuizCardSkeletonGrid count={6} />
            </div>
        </div>
    );
}
