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

export const DynamicQuickQuizPanel = dynamic(
    () => import('@/components/admin/QuickQuizPanel'),
    {
        loading: () => (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="h-96 w-full max-w-2xl rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
            </div>
        ),
        ssr: false
    }
);

// Fetch a form's code when the admin points at its button, so it opens without waiting for it
export const preloadQuizFormBuilder = () => import('@/components/admin/QuizFormBuilder');
export const preloadQuickQuizPanel = () => import('@/components/admin/QuickQuizPanel');

export const DynamicPrizeRedemption = dynamic(
    () => import('@/components/PrizeRedemption'),
    {
        loading: () => <AdminSkeleton />,
        ssr: false
    }
);
