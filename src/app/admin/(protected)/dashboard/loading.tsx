import { KPICardSkeleton } from '@/components/admin/dashboard/KPICard';
import { RecentActivityFeedSkeleton } from '@/components/admin/dashboard/RecentActivityFeed';

export default function DashboardLoading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
            {/* Header Skeleton */}
            <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <div className="space-y-2">
                            <div className="h-8 w-48 bg-gray-700/50 rounded animate-pulse" />
                            <div className="h-4 w-32 bg-gray-700/50 rounded animate-pulse" />
                        </div>
                        <div className="flex items-center gap-4">
                            {[...Array(3)].map((_, i) => (
                                <div key={i} className="hidden md:block h-10 w-32 bg-gray-700/50 rounded-lg animate-pulse" />
                            ))}
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* KPI Cards */}
                <section className="mb-8">
                    <div className="h-6 w-24 bg-gray-700/50 rounded animate-pulse mb-4" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[...Array(4)].map((_, i) => (
                            <KPICardSkeleton key={i} />
                        ))}
                    </div>
                </section>

                {/* Two Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Recent Activity */}
                    <section className="lg:col-span-2">
                        <RecentActivityFeedSkeleton />
                    </section>

                    {/* Quick Actions */}
                    <section className="space-y-6">
                        <div className="rounded-2xl border border-white/10 bg-gray-900/50 p-6">
                            <div className="h-6 w-32 bg-gray-700/50 rounded animate-pulse mb-4" />
                            <div className="space-y-3">
                                {[...Array(3)].map((_, i) => (
                                    <div key={i} className="h-16 bg-gray-700/30 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-gray-900/50 p-6">
                            <div className="h-6 w-28 bg-gray-700/50 rounded animate-pulse mb-4" />
                            <div className="space-y-2">
                                {[...Array(6)].map((_, i) => (
                                    <div key={i} className="h-12 bg-gray-700/30 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
