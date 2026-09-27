'use client';

import { useState } from 'react';
import { WalletTransaction, TransactionStatus } from '@/types/wallet';

interface TransactionHistoryProps {
    transactions: WalletTransaction[];
    isLoading?: boolean;
    initialLimit?: number;
    loadMoreCount?: number;
}

const statusConfig: Record<TransactionStatus, { label: string; bgClass: string; textClass: string; dotClass: string }> = {
    pending: {
        label: 'Pending',
        bgClass: 'bg-amber-500/20',
        textClass: 'text-amber-100',
        dotClass: 'bg-amber-300',
    },
    approved: {
        label: 'Approved',
        bgClass: 'bg-emerald-500/20',
        textClass: 'text-emerald-100',
        dotClass: 'bg-emerald-300',
    },
    rejected: {
        label: 'Rejected',
        bgClass: 'bg-rose-500/20',
        textClass: 'text-rose-100',
        dotClass: 'bg-rose-300',
    },
};

function getTransactionInfo(tx: WalletTransaction) {
    const isQuizAccess = tx.paymentMethod === 'QuizAccess';
    const isDeduction = tx.amount < 0 || isQuizAccess;

    if (isDeduction) {
        return {
            type: 'deduction' as const,
            label: 'Quiz Access',
            description: 'Daily quiz access payment',
            iconBg: 'bg-gradient-to-br from-blue-600 to-blue-800',
            amountPrefix: '-',
            amountColor: 'text-rose-200',
            amount: Math.abs(tx.amount),
        };
    }

    return {
        type: 'deposit' as const,
        label: 'Deposit',
        description: `Via ${tx.paymentMethod}`,
        iconBg: tx.status === 'approved'
            ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
            : tx.status === 'rejected'
                ? 'bg-gradient-to-br from-rose-500 to-red-600'
                : 'bg-gradient-to-br from-amber-500 to-amber-700',
        amountPrefix: tx.status === 'approved' ? '+' : '',
        amountColor: tx.status === 'approved'
            ? 'text-emerald-200'
            : tx.status === 'rejected'
                ? 'text-rose-200 line-through opacity-70'
                : 'text-amber-100',
        amount: tx.amount,
    };
}

export default function TransactionHistory({
    transactions,
    isLoading = false,
    initialLimit = 5,
    loadMoreCount = 5
}: TransactionHistoryProps) {
    const [visibleCount, setVisibleCount] = useState(initialLimit);

    const visibleTransactions = transactions.slice(0, visibleCount);
    const hasMore = visibleCount < transactions.length;
    const remainingCount = transactions.length - visibleCount;

    const handleLoadMore = () => {
        setVisibleCount(prev => prev + loadMoreCount);
    };

    if (isLoading) {
        return (
            <div className="space-y-3" role="status" aria-label="Loading transactions">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 animate-pulse">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/10 rounded-full" aria-hidden="true" />
                            <div className="flex-1">
                                <div className="h-4 w-24 bg-white/10 rounded mb-2" />
                                <div className="h-3 w-16 bg-white/10 rounded" />
                            </div>
                            <div className="h-5 w-16 bg-white/10 rounded" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (transactions.length === 0) {
        return (
            <div className="text-center py-8">
                <div
                    className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-600/20 to-blue-800/20 rounded-full flex items-center justify-center"
                    aria-hidden="true"
                >
                    <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                </div>
                <h3 className="text-white font-semibold mb-2">No Transactions</h3>
                <p className="text-slate-400 text-sm">Your transaction history will appear here</p>
            </div>
        );
    }

    return (
        <div className="space-y-3" role="list" aria-label="Transaction history">
            {visibleTransactions.map((tx) => {
                const config = statusConfig[tx.status];
                const txInfo = getTransactionInfo(tx);
                const isDeduction = txInfo.type === 'deduction';

                return (
                    <article
                        key={tx.id}
                        role="listitem"
                        aria-label={`${txInfo.label} of ${txInfo.amount.toFixed(0)} PKR, status ${isDeduction ? 'completed' : config.label}`}
                        className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 transition-colors"
                        tabIndex={0}
                    >
                        <div className="flex items-center gap-3">
                            <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center ${txInfo.iconBg}`}
                                aria-hidden="true"
                            >
                                {isDeduction ? (
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                ) : tx.status === 'approved' ? (
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                ) : tx.status === 'rejected' ? (
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className="text-white font-medium text-sm">
                                        {txInfo.label}
                                    </span>
                                    {isDeduction ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-100 border border-blue-400/30">
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-300" aria-hidden="true" />
                                            Completed
                                        </span>
                                    ) : (
                                        <span
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${config.bgClass} ${config.textClass} border-current/20`}
                                        >
                                            <span
                                                className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`}
                                                aria-hidden="true"
                                            />
                                            {config.label}
                                        </span>
                                    )}
                                </div>
                                <p className="text-slate-400 text-xs truncate">
                                    <time dateTime={tx.createdAt}>
                                        {new Date(tx.createdAt).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </time>
                                </p>
                            </div>

                            <div className="text-right">
                                <span className={`text-lg font-bold tabular-nums ${txInfo.amountColor}`}>
                                    {txInfo.amountPrefix}{txInfo.amount.toFixed(0)}
                                </span>
                                <span className="text-slate-400 text-xs ml-1">PKR</span>
                            </div>
                        </div>

                        {!isDeduction && tx.transactionId && !tx.transactionId.startsWith('quiz_access_') && (
                            <div className="mt-3 pt-3 border-t border-white/5">
                                <p className="text-xs text-slate-500">
                                    ID: <span className="text-slate-300 font-mono">{tx.transactionId}</span>
                                </p>
                            </div>
                        )}

                        {isDeduction && tx.adminNotes && (
                            <div className="mt-3 pt-3 border-t border-white/5">
                                <p className="text-xs text-slate-400">
                                    {tx.adminNotes}
                                </p>
                            </div>
                        )}
                    </article>
                );
            })}

            {hasMore && (
                <button
                    type="button"
                    onClick={handleLoadMore}
                    aria-label={`Load ${remainingCount} more transactions`}
                    className="w-full py-3 px-4 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl text-slate-200 font-medium text-sm hover:bg-white/10 hover:text-white transition-all duration-200 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    Load More ({remainingCount} remaining)
                </button>
            )}

            {transactions.length > 0 && (
                <p className="text-center text-slate-400 text-xs pt-2" aria-live="polite">
                    Showing {visibleTransactions.length} of {transactions.length} transactions
                </p>
            )}
        </div>
    );
}
