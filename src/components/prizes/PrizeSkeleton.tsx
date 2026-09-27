export default function PrizeSkeleton({ count = 6 }: { count?: number }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: count }).map((_, index) => (
                <div
                    key={index}
                    className="relative overflow-hidden rounded-2xl bg-slate-800/50 border border-white/10 animate-pulse"
                >
                    {/* Image Skeleton */}
                    <div className="h-48 bg-slate-700/50">
                        <div className="absolute top-3 left-3 w-20 h-6 bg-slate-600/50 rounded-full" />
                    </div>

                    {/* Content Skeleton */}
                    <div className="p-5 space-y-4">
                        {/* Title */}
                        <div className="h-6 bg-slate-700/50 rounded-lg w-3/4" />

                        {/* Description */}
                        <div className="space-y-2">
                            <div className="h-4 bg-slate-700/50 rounded w-full" />
                            <div className="h-4 bg-slate-700/50 rounded w-2/3" />
                        </div>

                        {/* Points Section */}
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-700/50" />
                            <div className="space-y-1">
                                <div className="h-3 bg-slate-700/50 rounded w-16" />
                                <div className="h-5 bg-slate-700/50 rounded w-20" />
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="h-2 bg-slate-700/50 rounded-full" />

                        {/* Button */}
                        <div className="h-12 bg-slate-700/50 rounded-xl" />
                    </div>

                    {/* Shimmer Effect */}
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                </div>
            ))}
        </div>
    );
}
