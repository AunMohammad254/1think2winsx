'use client';

import { useState, useEffect, useCallback } from 'react';
import { WalletTransaction, TransactionStatus } from '@/types/wallet';

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

type FilterStatus = 'all' | TransactionStatus;

export default function WalletTransactionsManager() {
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectNotes, setRejectNotes] = useState<string>('');
    const [showRejectModal, setShowRejectModal] = useState<string | null>(null);

    const fetchTransactions = useCallback(async () => {
        try {
            setIsLoading(true);
            const response = await fetch(`/api/admin/wallet-transactions?status=${filterStatus}`);

            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = '/admin/login';
                    return;
                }
                throw new Error('Failed to fetch transactions');
            }

            const data = await response.json();
            setTransactions(data.transactions || []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load transactions');
            setTransactions([]);
        } finally {
            setIsLoading(false);
        }
    }, [filterStatus]);

    useEffect(() => {
        fetchTransactions();
    }, [fetchTransactions]);

    const handleApprove = async (transactionId: string) => {
        if (processingId) return;

        if (!confirm('Are you sure you want to approve this deposit? This will add funds to the user\'s wallet.')) {
            return;
        }

        setProcessingId(transactionId);
        try {
            const response = await fetch('/api/admin/wallet-transactions', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactionId,
                    action: 'approve',
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to approve transaction');
            }

            // Refresh data
            await fetchTransactions();
            alert('Transaction approved successfully! Funds have been added to the user\'s wallet.');
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to approve transaction');
        } finally {
            setProcessingId(null);
        }
    };

    const handleReject = async (transactionId: string) => {
        if (processingId) return;

        setProcessingId(transactionId);
        try {
            const response = await fetch('/api/admin/wallet-transactions', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactionId,
                    action: 'reject',
                    notes: rejectNotes,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to reject transaction');
            }

            // Refresh data
            await fetchTransactions();
            setShowRejectModal(null);
            setRejectNotes('');
            alert('Transaction rejected.');
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to reject transaction');
        } finally {
            setProcessingId(null);
        }
    };

    const filteredTransactions = transactions;

    const pendingCount = transactions.filter((t) => t.status === 'pending').length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-white">Wallet Deposit Requests</h2>
                    <p className="text-gray-300 text-sm">
                        Review and process user deposit requests
                    </p>
                </div>
                {pendingCount > 0 && (
                    <div className="px-4 py-2 bg-yellow-500/20 border border-yellow-500/30 rounded-lg">
                        <span className="text-yellow-300 font-medium">{pendingCount} pending request{pendingCount !== 1 ? 's' : ''}</span>
                    </div>
                )}
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 flex-wrap">
                {(['pending', 'approved', 'rejected', 'all'] as FilterStatus[]).map((status) => (
                    <button
                        key={status}
                        onClick={() => setFilterStatus(status)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${filterStatus === status
                            ? 'bg-blue-500/30 border border-blue-500/50 text-white'
                            : 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10'
                            }`}
                    >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                ))}
            </div>

            {/* Error State */}
            {error && (
                <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-xl">
                    <p className="text-red-300">{error}</p>
                    <button
                        onClick={fetchTransactions}
                        className="mt-2 text-sm text-red-200 hover:text-white underline"
                    >
                        Try again
                    </button>
                </div>
            )}

            {/* Loading State */}
            {isLoading && (
                <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="p-4 glass-card glass-border-blue rounded-xl animate-pulse">
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 bg-white/10 rounded-full"></div>
                                <div className="flex-1 space-y-2">
                                    <div className="h-4 bg-white/10 rounded w-1/3"></div>
                                    <div className="h-3 bg-white/10 rounded w-1/2"></div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Transactions List */}
            {!isLoading && filteredTransactions.length === 0 && (
                <div className="text-center py-12 glass-card glass-border-blue rounded-xl">
                    <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">No Transactions Found</h3>
                    <p className="text-gray-400 text-sm">
                        {filterStatus === 'all'
                            ? 'No deposit requests have been made yet.'
                            : `No ${filterStatus} transactions found.`}
                    </p>
                </div>
            )}

            {!isLoading && filteredTransactions.length > 0 && (
                <div className="space-y-4">
                    {filteredTransactions.map((tx) => {
                        const status = statusConfig[tx.status as TransactionStatus];
                        return (
                            <div
                                key={tx.id}
                                className="glass-card glass-border-blue rounded-xl p-4 sm:p-6 transition-all duration-200 hover:bg-white/5"
                            >
                                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                    {/* User & Amount Info */}
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full flex items-center justify-center flex-shrink-0">
                                            <span className="text-white font-bold text-lg">
                                                {tx.user?.name?.charAt(0) || tx.user?.email?.charAt(0) || '?'}
                                            </span>
                                        </div>
                                        <div>
                                            <p className="text-white font-semibold">
                                                {tx.user?.name || 'Unknown User'}
                                            </p>
                                            <p className="text-gray-400 text-sm">{tx.user?.email}</p>
                                        </div>
                                    </div>

                                    {/* Transaction Details */}
                                    <div className="flex flex-wrap gap-4 lg:gap-6">
                                        <div>
                                            <p className="text-gray-400 text-xs uppercase">Amount</p>
                                            <p className="text-white font-bold text-lg">{tx.amount.toFixed(2)} PKR</p>
                                        </div>
                                        <div>
                                            <p className="text-gray-400 text-xs uppercase">Method</p>
                                            <p className="text-white">{tx.paymentMethod}</p>
                                        </div>
                                        <div>
                                            <p className="text-gray-400 text-xs uppercase">Transaction ID</p>
                                            <code className="text-sm bg-white/10 px-2 py-1 rounded text-gray-200">
                                                {tx.transactionId}
                                            </code>
                                        </div>
                                        <div>
                                            <p className="text-gray-400 text-xs uppercase">Date</p>
                                            <p className="text-white text-sm">
                                                {new Date(tx.createdAt).toLocaleDateString('en-US', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    year: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-gray-400 text-xs uppercase">Status</p>
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bgClass} ${status.textClass}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`}></span>
                                                {status.label}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    {tx.status === 'pending' && (
                                        <div className="flex gap-2 flex-shrink-0">
                                            <button
                                                onClick={() => handleApprove(tx.id)}
                                                disabled={processingId === tx.id}
                                                className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${processingId === tx.id
                                                    ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                                                    : 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/30'
                                                    }`}
                                            >
                                                {processingId === tx.id ? 'Processing...' : 'Approve'}
                                            </button>
                                            <button
                                                onClick={() => setShowRejectModal(tx.id)}
                                                disabled={processingId === tx.id}
                                                className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${processingId === tx.id
                                                    ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                                                    : 'bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30'
                                                    }`}
                                            >
                                                Reject
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Admin Notes (for rejected) */}
                                {tx.status === 'rejected' && tx.adminNotes && (
                                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                        <p className="text-red-300 text-sm">
                                            <span className="font-medium">Rejection Reason:</span> {tx.adminNotes}
                                        </p>
                                    </div>
                                )}

                                {/* Processed Info */}
                                {tx.status !== 'pending' && tx.processedAt && (
                                    <div className="mt-4 text-sm text-gray-400">
                                        Processed by {tx.processedBy || 'Admin'} on{' '}
                                        {new Date(tx.processedAt).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Reject Modal */}
            {showRejectModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-slate-800 border border-white/10 rounded-2xl p-6 max-w-md w-full">
                        <h3 className="text-lg font-bold text-white mb-4">Reject Deposit Request</h3>
                        <p className="text-gray-400 text-sm mb-4">
                            Provide a reason for rejection (optional). This will be visible to the user.
                        </p>
                        <textarea
                            value={rejectNotes}
                            onChange={(e) => setRejectNotes(e.target.value)}
                            placeholder="e.g., Invalid transaction ID, amount mismatch..."
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-red-500/50 resize-none"
                            rows={3}
                        />
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={() => {
                                    setShowRejectModal(null);
                                    setRejectNotes('');
                                }}
                                className="flex-1 px-4 py-2 bg-white/10 border border-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-all duration-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleReject(showRejectModal)}
                                disabled={processingId === showRejectModal}
                                className="flex-1 px-4 py-2 bg-red-500/20 border border-red-500/50 text-red-300 rounded-lg hover:bg-red-500/30 transition-all duration-200"
                            >
                                {processingId === showRejectModal ? 'Processing...' : 'Reject'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
