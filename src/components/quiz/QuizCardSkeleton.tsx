export default function QuizCardSkeleton() {
    return (
        <div className="relative bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden animate-pulse">
            {/* Difficulty Strip Skeleton */}
            <div className="h-1.5 w-full bg-gray-700" />

            <div className="p-6">
                {/* Status Badge Skeleton */}
                <div className="absolute top-4 right-4">
                    <div className="h-6 w-16 bg-gray-700 rounded-full" />
                </div>

                {/* Title & Description Skeleton */}
                <div className="mb-6 pr-16">
                    <div className="h-7 w-3/4 bg-gray-700 rounded-lg mb-3" />
                    <div className="space-y-2">
                        <div className="h-4 w-full bg-gray-700/70 rounded" />
                        <div className="h-4 w-2/3 bg-gray-700/70 rounded" />
                    </div>
                </div>

                {/* Stats Grid Skeleton */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex flex-col items-center p-3 rounded-xl bg-white/5 border border-white/5">
                            <div className="w-5 h-5 bg-gray-700 rounded mb-1" />
                            <div className="h-5 w-8 bg-gray-700 rounded mb-1" />
                            <div className="h-3 w-12 bg-gray-700/70 rounded" />
                        </div>
                    ))}
                </div>

                {/* Button Skeleton */}
                <div className="h-12 w-full bg-gray-700 rounded-xl" />
            </div>
        </div>
    );
}

export function QuizCardSkeletonGrid({ count = 6 }: { count?: number }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(count)].map((_, i) => (
                <QuizCardSkeleton key={i} />
            ))}
        </div>
    );
}
