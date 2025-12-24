'use client';

import type { Prize } from '@/types/prize';
import { STATUS_COLORS } from '@/types/prize';

interface PrizeTableProps {
    prizes: Prize[];
    loading: boolean;
    onEdit: (prize: Prize) => void;
    onDelete: (prize: Prize) => void;
    onToggleStatus: (prize: Prize) => void;
    onToggleActive: (prize: Prize) => void;
}

export default function PrizeTable({
    prizes,
    loading,
    onEdit,
    onDelete,
    onToggleStatus,
    onToggleActive,
}: PrizeTableProps) {
    if (loading) {
        return (
            <div className="bg-slate-800/50 rounded-xl border border-white/10 overflow-hidden">
                <div className="animate-pulse">
                    {/* Header */}
                    <div className="grid grid-cols-7 gap-4 p-4 border-b border-white/10 bg-slate-700/30">
                        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                            <div key={i} className="h-5 bg-slate-600/50 rounded" />
                        ))}
                    </div>
                    {/* Rows */}
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="grid grid-cols-7 gap-4 p-4 border-b border-white/5">
                            <div className="h-12 bg-slate-600/30 rounded" />
                            <div className="h-5 bg-slate-600/30 rounded" />
                            <div className="h-5 bg-slate-600/30 rounded" />
                            <div className="h-5 bg-slate-600/30 rounded" />
                            <div className="h-5 bg-slate-600/30 rounded" />
                            <div className="h-5 bg-slate-600/30 rounded" />
                            <div className="h-8 bg-slate-600/30 rounded" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (prizes.length === 0) {
        return (
            <div className="bg-slate-800/50 rounded-xl border border-white/10 p-12 text-center">
                <div className="text-5xl mb-4">🎁</div>
                <h3 className="text-xl font-bold text-white mb-2">No prizes found</h3>
                <p className="text-gray-400">Create your first prize to get started!</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-800/50 rounded-xl border border-white/10 overflow-hidden">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-white/10 bg-slate-700/30">
                            <th className="text-left p-4 text-sm font-semibold text-gray-300">Prize</th>
                            <th className="text-left p-4 text-sm font-semibold text-gray-300">Category</th>
                            <th className="text-left p-4 text-sm font-semibold text-gray-300">Points</th>
                            <th className="text-left p-4 text-sm font-semibold text-gray-300">Stock</th>
                            <th className="text-left p-4 text-sm font-semibold text-gray-300">Status</th>
                            <th className="text-left p-4 text-sm font-semibold text-gray-300">Active</th>
                            <th className="text-right p-4 text-sm font-semibold text-gray-300">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {prizes.map((prize) => (
                            <tr key={prize.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                {/* Prize Name & Image */}
                                <td className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-lg bg-slate-700/50 overflow-hidden flex-shrink-0">
                                            {prize.imageUrl ? (
                                                <img
                                                    src={prize.imageUrl}
                                                    alt={prize.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-xl">🎁</div>
                                            )}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-white">{prize.name}</p>
                                            <p className="text-xs text-gray-400 line-clamp-1">{prize.type}</p>
                                        </div>
                                    </div>
                                </td>

                                {/* Category */}
                                <td className="p-4">
                                    <span className="px-2 py-1 text-xs rounded-full bg-slate-700/50 text-gray-300 capitalize">
                                        {prize.category}
                                    </span>
                                </td>

                                {/* Points */}
                                <td className="p-4">
                                    <span className="font-semibold text-yellow-400">
                                        {prize.pointsRequired.toLocaleString()}
                                    </span>
                                </td>

                                {/* Stock */}
                                <td className="p-4">
                                    <span className={`font-semibold ${prize.stock <= 0 ? 'text-red-400' :
                                        prize.stock <= 5 ? 'text-orange-400' :
                                            'text-green-400'
                                        }`}>
                                        {prize.stock}
                                    </span>
                                </td>

                                {/* Status */}
                                <td className="p-4">
                                    <button
                                        onClick={() => onToggleStatus(prize)}
                                        className={`px-3 py-1 text-xs rounded-full border ${STATUS_COLORS[prize.status as keyof typeof STATUS_COLORS]?.bg || 'bg-gray-500/20'
                                            } ${STATUS_COLORS[prize.status as keyof typeof STATUS_COLORS]?.text || 'text-gray-400'} ${STATUS_COLORS[prize.status as keyof typeof STATUS_COLORS]?.border || 'border-gray-500/30'
                                            } hover:opacity-80 transition-opacity capitalize cursor-pointer`}
                                    >
                                        {prize.status}
                                    </button>
                                </td>

                                {/* Active Toggle */}
                                <td className="p-4">
                                    <button
                                        onClick={() => onToggleActive(prize)}
                                        className={`relative w-12 h-6 rounded-full transition-colors ${prize.isActive ? 'bg-green-600' : 'bg-slate-600'
                                            }`}
                                    >
                                        <span
                                            className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${prize.isActive ? 'left-7' : 'left-1'
                                                }`}
                                        />
                                    </button>
                                </td>

                                {/* Actions */}
                                <td className="p-4">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => onEdit(prize)}
                                            className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                                            title="Edit"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => onDelete(prize)}
                                            className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                                            title="Delete"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-white/5">
                {prizes.map((prize) => (
                    <div key={prize.id} className="p-4 space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="w-16 h-16 rounded-lg bg-slate-700/50 overflow-hidden flex-shrink-0">
                                {prize.imageUrl ? (
                                    <img
                                        src={prize.imageUrl}
                                        alt={prize.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-2xl">🎁</div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-white truncate">{prize.name}</p>
                                <p className="text-xs text-gray-400 capitalize">{prize.category} • {prize.type}</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-sm font-semibold text-yellow-400">
                                        {prize.pointsRequired.toLocaleString()} pts
                                    </span>
                                    <span className={`text-xs ${prize.stock <= 0 ? 'text-red-400' : 'text-green-400'
                                        }`}>
                                        ({prize.stock} in stock)
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => onToggleStatus(prize)}
                                    className={`px-3 py-1 text-xs rounded-full border ${STATUS_COLORS[prize.status as keyof typeof STATUS_COLORS]?.bg || 'bg-gray-500/20'
                                        } ${STATUS_COLORS[prize.status as keyof typeof STATUS_COLORS]?.text || 'text-gray-400'} ${STATUS_COLORS[prize.status as keyof typeof STATUS_COLORS]?.border || 'border-gray-500/30'
                                        } capitalize`}
                                >
                                    {prize.status}
                                </button>
                                <button
                                    onClick={() => onToggleActive(prize)}
                                    className={`px-3 py-1 text-xs rounded-full ${prize.isActive
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-slate-600/50 text-gray-400'
                                        }`}
                                >
                                    {prize.isActive ? 'Active' : 'Inactive'}
                                </button>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => onEdit(prize)}
                                    className="p-2 rounded-lg bg-blue-500/20 text-blue-400"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => onDelete(prize)}
                                    className="p-2 rounded-lg bg-red-500/20 text-red-400"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
