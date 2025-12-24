import PrizeSkeleton from '@/components/prizes/PrizeSkeleton';

export default function PrizesLoading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900/50 to-slate-900">
            {/* Background Effects */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
            </div>

            <div className="relative">
                {/* Hero Section Skeleton */}
                <section className="pt-12 pb-8 md:pt-20 md:pb-12">
                    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="text-center space-y-6">
                            {/* Badge Skeleton */}
                            <div className="flex justify-center">
                                <div className="h-12 w-48 bg-slate-800/50 rounded-full animate-pulse" />
                            </div>

                            {/* Title Skeleton */}
                            <div className="flex justify-center">
                                <div className="h-14 w-96 max-w-full bg-slate-800/50 rounded-lg animate-pulse" />
                            </div>

                            {/* Description Skeleton */}
                            <div className="flex flex-col items-center gap-2">
                                <div className="h-5 w-full max-w-xl bg-slate-800/50 rounded animate-pulse" />
                                <div className="h-5 w-3/4 max-w-md bg-slate-800/50 rounded animate-pulse" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Filters Section Skeleton */}
                <section className="py-6">
                    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="space-y-4">
                            {/* Category Filters Skeleton */}
                            <div className="flex flex-wrap gap-2">
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <div key={i} className="h-10 w-28 bg-slate-800/50 rounded-full animate-pulse" />
                                ))}
                            </div>

                            {/* Sort Row Skeleton */}
                            <div className="flex justify-between items-center">
                                <div className="h-5 w-32 bg-slate-800/50 rounded animate-pulse" />
                                <div className="h-10 w-40 bg-slate-800/50 rounded-lg animate-pulse" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Prizes Grid Skeleton */}
                <section className="py-8 pb-20">
                    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                        <PrizeSkeleton count={6} />
                    </div>
                </section>
            </div>
        </div>
    );
}
