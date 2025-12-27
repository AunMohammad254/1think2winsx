'use client';

import { WalletTransaction, TransactionStatus } from '@/types/wallet';

interface TransactionHistoryProps {
    transactions: WalletTransaction[];
    isLoading?: boolean;
}

const statusConfig: Record<TransactionStatus, { label: string; bgClass: string; textClass: string; dotClass: string }> = {
    pending: {
        label: 'Pending',
        bgClass: 'bg-yellow-500/20',
        textClass: 'text-yellow-300',
        dotClass: 'bg-yellow-400',
    },
    approved: {
        label: 'Approved',
        bgClass: 'bg-emerald-500/20',
        textClass: 'text-emerald-300',
        dotClass: 'bg-emerald-400',
    },
    rejected: {
        label: 'Rejected',
        bgClass: 'bg-red-500/20',
        textClass: 'text-red-300',
        dotClass: 'bg-red-400',
    },
};

export default function TransactionHistory({ transactions, isLoading = false }: TransactionHistoryProps) {
    if (isLoading) {
        return (
            <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 animate-pulse">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/10 rounded-full"></div>
                            <div className="flex-1">
                                <div className="h-4 w-24 bg-white/10 rounded mb-2"></div>
                                <div className="h-3 w-16 bg-white/10 rounded"></div>
                            </div>
                            <div className="h-5 w-16 bg-white/10 rounded"></div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (transactions.length === 0) {
        return (
            <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                </div>
                <h3 className="text-white font-semibold mb-2">No Transactions</h3>
                <p className="text-slate-400 text-sm">Your deposit history will appear here</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {transactions.map((tx) => {
                const config = statusConfig[tx.status];
                const isApproved = tx.status === 'approved';

                return (
                    <div key={tx.id} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/[0.08] transition-colors">
                        <div className="flex items-center gap-3">
                            {/* Icon */}
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isApproved
                                    ? 'bg-gradient-to-br from-emerald-400 to-green-500'
                                    : tx.status === 'rejected'
                                        ? 'bg-gradient-to-br from-red-400 to-pink-500'
                                        : 'bg-gradient-to-br from-yellow-400 to-orange-500'
                                }`}>
                                {isApproved ? (
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                ) : tx.status === 'rejected' ? (
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                )}
                            </div>

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-white font-medium text-sm">Deposit</span>
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bgClass} ${config.textClass}`}>
                                        <div className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`}></div>
                                        {config.label}
                                    </span>
                                </div>
                                <p className="text-slate-400 text-xs truncate">
                                    {new Date(tx.createdAt).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </p>
                            </div>

                            {/* Amount */}
                            <div className="text-right">
                                <span className={`text-lg font-bold ${isApproved
                                        ? 'text-emerald-400'
                                        : tx.status === 'rejected'
                                            ? 'text-red-400 line-through opacity-50'
                                            : 'text-white'
                                    }`}>
                                    {isApproved ? '+' : ''}{tx.amount.toFixed(0)}
                                </span>
                                <span className="text-slate-400 text-xs ml-1">PKR</span>
                            </div>
                        </div>

                        {/* Transaction ID */}
                        {tx.transactionId && (
                            <div className="mt-3 pt-3 border-t border-white/5">
                                <p className="text-xs text-slate-500">
                                    ID: <span className="text-slate-400 font-mono">{tx.transactionId}</span>
                                </p>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
