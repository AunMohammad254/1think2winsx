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
        dotClass: 'bg-yellow-400 animate-pulse',
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
            <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                            Transaction History
                        </h2>
                    </div>
                </div>
                <div className="p-6">
                    <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="p-4 bg-white/5 rounded-xl animate-pulse">
                                <div className="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
                                <div className="h-3 bg-white/10 rounded w-1/2"></div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                        Transaction History
                    </h2>
                </div>
            </div>

            <div className="p-6">
                {transactions.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-white mb-2">No Transactions Yet</h3>
                        <p className="text-slate-400 text-sm">
                            Your deposit requests will appear here once you make them.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Desktop Table */}
                        <div className="hidden lg:block overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/10">
                                        <th className="text-left py-3 px-4 text-slate-300 font-semibold text-sm">Date</th>
                                        <th className="text-left py-3 px-4 text-slate-300 font-semibold text-sm">Amount</th>
                                        <th className="text-left py-3 px-4 text-slate-300 font-semibold text-sm">Method</th>
                                        <th className="text-left py-3 px-4 text-slate-300 font-semibold text-sm">Transaction ID</th>
                                        <th className="text-left py-3 px-4 text-slate-300 font-semibold text-sm">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.map((tx) => {
                                        const status = statusConfig[tx.status as TransactionStatus];
                                        return (
                                            <tr key={tx.id} className="border-b border-white/5 hover:bg-white/5 transition-colors duration-200">
                                                <td className="py-4 px-4 text-slate-300 text-sm">
                                                    {new Date(tx.createdAt).toLocaleDateString('en-US', {
                                                        year: 'numeric',
                                                        month: 'short',
                                                        day: 'numeric',
                                                    })}
                                                </td>
                                                <td className="py-4 px-4">
                                                    <span className="text-white font-semibold">{tx.amount.toFixed(2)} PKR</span>
                                                </td>
                                                <td className="py-4 px-4 text-slate-300 text-sm">{tx.paymentMethod}</td>
                                                <td className="py-4 px-4">
                                                    <code className="text-xs bg-white/10 px-2 py-1 rounded text-slate-300">
                                                        {tx.transactionId}
                                                    </code>
                                                </td>
                                                <td className="py-4 px-4">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bgClass} ${status.textClass}`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`}></span>
                                                        {status.label}
                                                    </span>
                                                    {tx.adminNotes && tx.status === 'rejected' && (
                                                        <p className="text-red-300/70 text-xs mt-1">{tx.adminNotes}</p>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Cards */}
                        <div className="lg:hidden space-y-4">
                            {transactions.map((tx) => {
                                const status = statusConfig[tx.status as TransactionStatus];
                                return (
                                    <div key={tx.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <span className="text-white font-semibold text-lg">{tx.amount.toFixed(2)} PKR</span>
                                                <p className="text-slate-400 text-xs mt-0.5">{tx.paymentMethod}</p>
                                            </div>
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bgClass} ${status.textClass}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`}></span>
                                                {status.label}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-400">
                                                {new Date(tx.createdAt).toLocaleDateString('en-US', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    year: 'numeric',
                                                })}
                                            </span>
                                            <code className="text-xs bg-white/10 px-2 py-1 rounded text-slate-300">
                                                {tx.transactionId}
                                            </code>
                                        </div>
                                        {tx.adminNotes && tx.status === 'rejected' && (
                                            <p className="text-red-300/70 text-xs mt-2 p-2 bg-red-500/10 rounded">{tx.adminNotes}</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
