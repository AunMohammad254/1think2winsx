export default function QuizLoading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header Skeleton */}
                <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 mb-6 animate-pulse">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                        <div className="flex-1">
                            <div className="h-8 w-48 bg-gray-700 rounded-lg mb-3" />
                            <div className="h-5 w-32 bg-gray-700/70 rounded" />
                        </div>
                        <div className="mt-4 md:mt-0 flex items-center gap-6">
                            <div className="text-center">
                                <div className="h-8 w-16 bg-gray-700 rounded-lg mb-2" />
                                <div className="h-4 w-14 bg-gray-700/70 rounded" />
                            </div>
                            <div className="text-center">
                                <div className="h-8 w-12 bg-gray-700 rounded-lg mb-2" />
                                <div className="h-4 w-16 bg-gray-700/70 rounded" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Progress Bar Skeleton */}
                <div className="mb-6 animate-pulse">
                    <div className="bg-gray-800 rounded-full p-2">
                        <div className="h-2 w-1/4 bg-gray-700 rounded-full" />
                    </div>
                </div>

                {/* Question Skeleton */}
                <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-8 mb-6 animate-pulse">
                    <div className="h-7 w-3/4 bg-gray-700 rounded-lg mb-8" />

                    <div className="space-y-4">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="h-16 w-full bg-gray-800/50 border border-gray-700 rounded-xl" />
                        ))}
                    </div>
                </div>

                {/* Navigation Skeleton */}
                <div className="flex justify-between items-center animate-pulse">
                    <div className="h-12 w-28 bg-gray-800 rounded-xl" />
                    <div className="h-12 w-28 bg-gray-700 rounded-xl" />
                </div>

                {/* Question Navigator Skeleton */}
                <div className="mt-8 bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 animate-pulse">
                    <div className="h-6 w-40 bg-gray-700 rounded-lg mb-4" />
                    <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
                        {[...Array(10)].map((_, i) => (
                            <div key={i} className="w-10 h-10 bg-gray-700 rounded-lg" />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
