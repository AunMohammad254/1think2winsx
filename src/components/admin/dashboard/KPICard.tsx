'use client';

import { ReactNode } from 'react';
import {
    Users,
    FileText,
    TrendingUp,
    DollarSign,
    Target,
    Activity,
    Award,
    Clock
} from 'lucide-react';

// Icon mapping
const iconMap = {
    users: Users,
    quizzes: FileText,
    revenue: DollarSign,
    completion: Target,
    trending: TrendingUp,
    activity: Activity,
    award: Award,
    clock: Clock,
};

type IconType = keyof typeof iconMap;

interface KPICardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: IconType;
    trend?: {
        value: number;
        isPositive: boolean;
    };
    color?: 'purple' | 'blue' | 'green' | 'yellow' | 'red';
}

const colorStyles = {
    purple: {
        bg: 'from-purple-600/20 to-purple-800/10',
        icon: 'bg-purple-500/20 text-purple-400',
        border: 'border-purple-500/20',
    },
    blue: {
        bg: 'from-blue-600/20 to-blue-800/10',
        icon: 'bg-blue-500/20 text-blue-400',
        border: 'border-blue-500/20',
    },
    green: {
        bg: 'from-green-600/20 to-green-800/10',
        icon: 'bg-green-500/20 text-green-400',
        border: 'border-green-500/20',
    },
    yellow: {
        bg: 'from-yellow-600/20 to-yellow-800/10',
        icon: 'bg-yellow-500/20 text-yellow-400',
        border: 'border-yellow-500/20',
    },
    red: {
        bg: 'from-red-600/20 to-red-800/10',
        icon: 'bg-red-500/20 text-red-400',
        border: 'border-red-500/20',
    },
};

export default function KPICard({
    title,
    value,
    subtitle,
    icon,
    trend,
    color = 'purple',
}: KPICardProps) {
    const Icon = iconMap[icon];
    const styles = colorStyles[color];

    return (
        <div
            className={`
                relative overflow-hidden rounded-2xl border ${styles.border}
                bg-gradient-to-br ${styles.bg} backdrop-blur-xl
                p-6 transition-all duration-300
                hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-500/10
            `}
        >
            {/* Background glow effect */}
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-white/5 rounded-full blur-3xl" />

            <div className="relative flex items-start justify-between">
                <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-400">{title}</p>
                    <p className="text-3xl font-bold text-white tracking-tight">
                        {typeof value === 'number' ? value.toLocaleString() : value}
                    </p>
                    {subtitle && (
                        <p className="text-sm text-gray-500">{subtitle}</p>
                    )}
                    {trend && (
                        <div className={`flex items-center gap-1 text-sm ${trend.isPositive ? 'text-green-400' : 'text-red-400'
                            }`}>
                            <TrendingUp
                                className={`w-4 h-4 ${!trend.isPositive && 'rotate-180'}`}
                            />
                            <span>{trend.value}% from last week</span>
                        </div>
                    )}
                </div>

                <div className={`p-3 rounded-xl ${styles.icon}`}>
                    <Icon className="w-6 h-6" />
                </div>
            </div>
        </div>
    );
}

// Skeleton version for loading state
export function KPICardSkeleton() {
    return (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gray-900/50 backdrop-blur-xl p-6">
            <div className="flex items-start justify-between">
                <div className="space-y-3 flex-1">
                    <div className="h-4 w-24 bg-gray-700/50 rounded animate-pulse" />
                    <div className="h-8 w-32 bg-gray-700/50 rounded animate-pulse" />
                    <div className="h-3 w-20 bg-gray-700/50 rounded animate-pulse" />
                </div>
                <div className="w-12 h-12 bg-gray-700/50 rounded-xl animate-pulse" />
            </div>
        </div>
    );
}
