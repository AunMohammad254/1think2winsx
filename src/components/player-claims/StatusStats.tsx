'use client';

import { statusConfig, type ClaimStatus } from './types';

interface StatusStatsProps {
    counts: Record<ClaimStatus, number>;
    selectedStatus: string;
    onSelectStatus: (status: string) => void;
}

/**
 * Status stat cards for filtering claims by status
 */
export function StatusStats({ counts, selectedStatus, onSelectStatus }: StatusStatsProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {(['pending', 'approved', 'fulfilled', 'rejected'] as const).map((status) => {
                const config = statusConfig[status];
                const count = counts[status] || 0;
                const Icon = config.icon;

                return (
                    <button
                        key={status}
                        onClick={() => onSelectStatus(status)}
                        className={`p-4 rounded-xl border transition-all duration-200 text-left ${selectedStatus === status
                                ? `${config.bgClass} ${config.borderClass} ring-1 ring-white/10`
                                : 'border-white/10 bg-white/5 hover:bg-white/10'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${config.bgClass}`}>
                                <Icon className={`w-5 h-5 ${config.textClass}`} />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-white">{count}</p>
                                <p className="text-sm text-gray-400">{config.label}</p>
                            </div>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
