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
        <div className="grid grid-cols-2 gap-3">
            {stats.map((stat) => (
                <div
                    key={stat.id}
                    className={`backdrop-blur-xl ${stat.gradient || 'bg-white/5'} border border-white/10 rounded-[24px] p-4 text-center transition-all duration-200 hover:scale-[1.02]`}
                >
                    <div className="w-10 h-10 mx-auto mb-2 bg-white/10 rounded-full flex items-center justify-center">
                        {stat.icon}
                    </div>
                    <p className="text-2xl font-bold text-white">{stat.value}</p>
                    <p className="text-xs text-slate-400 font-medium">{stat.label}</p>
                </div>
            ))}
        </div>
    );
}
