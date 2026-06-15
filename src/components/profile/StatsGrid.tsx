'use client';

interface StatItem {
    id: string;
    label: string;
    value: number | string;
    icon: React.ReactNode;
    gradient?: string;
}

interface StatsGridProps {
    stats: StatItem[];
}

export default function StatsGrid({ stats }: StatsGridProps) {
    return (
        <div
            role="list"
            aria-label="Profile statistics"
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
        >
            {stats.map((stat) => (
                <div
                    key={stat.id}
                    role="listitem"
                    aria-label={`${stat.label}: ${stat.value}`}
                    className={`relative backdrop-blur-xl ${stat.gradient || 'bg-white/5'} border border-white/10 rounded-3xl p-4 text-center transition-all duration-200 hover:scale-[1.02] hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900`}
                    tabIndex={0}
                >
                    <div
                        className="w-10 h-10 mx-auto mb-2 bg-white/10 rounded-full flex items-center justify-center"
                        aria-hidden="true"
                    >
                        {stat.icon}
                    </div>
                    <p className="text-2xl font-bold text-white tabular-nums">
                        {stat.value}
                    </p>
                    <p className="text-xs text-slate-300 font-medium">{stat.label}</p>
                </div>
            ))}
        </div>
    );
}
