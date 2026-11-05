'use client';

import { Wallet, CheckCircle, Clock } from 'lucide-react';
import type { WalletTransaction } from '@/types/wallet';

interface WalletStatsCardsProps {
    /** The loaded transactions, before the method filter and search */
    transactions: WalletTransaction[];
}

export default function WalletStatsCards({ transactions }: WalletStatsCardsProps) {
    const pendingCount = transactions.filter(t => t.status === 'pending').length;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/10 bg-linear-to-br from-amber-500/10 to-orange-500/10 p-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-500/20">
                        <Clock className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-white">{pendingCount}</p>
                        <p className="text-sm text-gray-400">Pending Requests</p>
                    </div>
                </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-linear-to-br from-emerald-500/10 to-teal-500/10 p-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/20">
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-white">
                            {transactions.filter(t => t.status === 'approved').length}
                        </p>
                        <p className="text-sm text-gray-400">Approved Today</p>
                    </div>
                </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-linear-to-br from-blue-500/10 to-indigo-500/10 p-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/20">
                        <Wallet className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-white">
                            PKR {transactions.reduce((sum, t) => t.status === 'approved' ? sum + t.amount : sum, 0).toLocaleString()}
                        </p>
                        <p className="text-sm text-gray-400">Total Approved</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
