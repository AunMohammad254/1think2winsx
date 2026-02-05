'use client';

import dynamic from 'next/dynamic';

// Loading skeleton for admin managers
const AdminSkeleton = () => (
    <div className="space-y-6 animate-pulse">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 bg-white/5 rounded-xl border border-white/10" />
            ))}
        </div>

        {/* Filters */}
        <div className="h-16 bg-white/5 rounded-xl border border-white/10" />

        {/* Table/Cards */}
        <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="h-20 bg-white/5 rounded-xl border border-white/10" />
            ))}
        </div>
    </div>
);

// Dynamic imports with loading states
export const DynamicPlayerClaimsManager = dynamic(
    () => import('@/components/admin/PlayerClaimsManager'),
    {
        loading: () => <AdminSkeleton />,
        ssr: false
    }
);

export const DynamicLiveStreamManager = dynamic(
    () => import('@/components/admin/LiveStreamManager'),
    {
        loading: () => <AdminSkeleton />,
        ssr: false
    }
);

export const DynamicWalletTransactionsManager = dynamic(
    () => import('@/components/admin/WalletTransactionsManager'),
    {
        loading: () => <AdminSkeleton />,
        ssr: false
    }
);

export const DynamicQuizFormBuilder = dynamic(
    () => import('@/components/admin/QuizFormBuilder'),
    {
        loading: () => <AdminSkeleton />,
        ssr: false
    }
);

export const DynamicPrizeRedemption = dynamic(
    () => import('@/components/PrizeRedemption'),
    {
        loading: () => <AdminSkeleton />,
        ssr: false
    }
);
