'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Wallet,
    Search,
    RefreshCw,
    CheckCircle,
    XCircle,
    Clock,
    AlertCircle,
    Filter,
    Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { WalletTransaction, TransactionStatus } from '@/types/wallet';

// ============================================
// Status Configuration
// ============================================
const statusConfig: Record<TransactionStatus, {
    label: string;
    bgClass: string;
    textClass: string;
    dotClass: string;
    icon: typeof CheckCircle;
}> = {
    pending: {
        label: 'Pending Review',
        bgClass: 'bg-amber-500/20',
        textClass: 'text-amber-300',
        dotClass: 'bg-amber-400 animate-pulse',
        icon: Clock,
    },
    approved: {
        label: 'Approved',
        bgClass: 'bg-emerald-500/20',
        textClass: 'text-emerald-300',
        dotClass: 'bg-emerald-400',
        icon: CheckCircle,
    },
    rejected: {
        label: 'Rejected',
        bgClass: 'bg-red-500/20',
        textClass: 'text-red-300',
        dotClass: 'bg-red-400',
        icon: XCircle,
    },
};

type FilterStatus = 'all' | TransactionStatus;

// ============================================
// Main Component
// ============================================
export default function WalletTransactionsManager() {
    // State
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
    const [searchQuery, setSearchQuery] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectNotes, setRejectNotes] = useState('');
    const [showRejectModal, setShowRejectModal] = useState<string | null>(null);

    // ============================================
    // Data Fetching
    // ============================================
    const fetchTransactions = useCallback(async (showRefreshState = false) => {
        try {
            if (showRefreshState) {
                setIsRefreshing(true);
            } else {
                setIsLoading(true);
            }

            const response = await fetch(`/api/admin/wallet-transactions?status=${filterStatus}`);

            if (!response.ok) {
                if (response.status === 401) {
                    toast.error('Session expired. Redirecting to login...');
                    window.location.href = '/admin/login';
                    return;
                }
                throw new Error('Failed to fetch transactions');
            }

            const data = await response.json();
            setTransactions(data.transactions || []);

            if (showRefreshState) {
                toast.success('Transactions refreshed');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load transactions';
            toast.error(message);
            setTransactions([]);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [filterStatus]);

    useEffect(() => {
        fetchTransactions();
    }, [fetchTransactions]);

    // ============================================
    // Actions
    // ============================================
    const handleApprove = async (transactionId: string) => {
        if (processingId) return;

        setProcessingId(transactionId);

        // Optimistic update
        const originalTransactions = [...transactions];
        setTransactions(prev =>
            prev.map(tx =>
                tx.id === transactionId
                    ? { ...tx, status: 'approved' as TransactionStatus }
                    : tx
            )
        );

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

            toast.success('Deposit approved! Funds added to user wallet.', {
                icon: <CheckCircle className="w-5 h-5 text-emerald-400" />,
            });

            // Refresh to get accurate data
            await fetchTransactions();
        } catch (err) {
            // Rollback on error
            setTransactions(originalTransactions);
            toast.error(err instanceof Error ? err.message : 'Failed to approve transaction');
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

            toast.success('Transaction rejected', {
                icon: <XCircle className="w-5 h-5 text-red-400" />,
            });

            setShowRejectModal(null);
            setRejectNotes('');
            await fetchTransactions();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to reject transaction');
        } finally {
            setProcessingId(null);
        }
    };

    // ============================================
    // Filtered & Searched Transactions
    // ============================================
    const filteredTransactions = transactions.filter(tx => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            tx.user?.name?.toLowerCase().includes(query) ||
            tx.user?.email?.toLowerCase().includes(query) ||
            tx.transactionId?.toLowerCase().includes(query) ||
            tx.paymentMethod?.toLowerCase().includes(query)
        );
    });

    const pendingCount = transactions.filter(t => t.status === 'pending').length;

    // ============================================
    // Render
    // ============================================
    return (
        <div className="space-y-6">
            {/* Stats Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-4">
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
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 p-4">
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
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 p-4">
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

            {/* Controls */}
            <div className="flex flex-col sm:flex-row gap-4">
                {/* Search */}
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search by name, email, or transaction ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25"
                    />
                </div>

                {/* Filter & Refresh */}
                <div className="flex gap-2">
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                            className="appearance-none pl-9 pr-8 py-3 rounded-xl bg-gray-800 border border-white/10 text-white focus:outline-none focus:border-blue-500/50 cursor-pointer"
                            style={{ colorScheme: 'dark' }}
                        >
                            <option value="pending" className="bg-gray-800 text-white">Pending</option>
                            <option value="approved" className="bg-gray-800 text-white">Approved</option>
                            <option value="rejected" className="bg-gray-800 text-white">Rejected</option>
                            <option value="all" className="bg-gray-800 text-white">All</option>
                        </select>
                    </div>
                    <button
                        onClick={() => fetchTransactions(true)}
                        disabled={isRefreshing}
                        className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="p-6 rounded-xl border border-white/10 bg-white/5 animate-pulse">
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 bg-white/10 rounded-full" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-4 bg-white/10 rounded w-1/3" />
                                    <div className="h-3 bg-white/10 rounded w-1/2" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Empty State */}
            {!isLoading && filteredTransactions.length === 0 && (
                <div className="text-center py-16 rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/30">
                    <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full flex items-center justify-center">
                        {searchQuery ? (
                            <Search className="w-10 h-10 text-gray-400" />
                        ) : (
                            <Wallet className="w-10 h-10 text-gray-400" />
                        )}
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">
                        {searchQuery ? 'No Matching Transactions' : 'No Transactions Found'}
                    </h3>
                    <p className="text-gray-400 max-w-md mx-auto">
                        {searchQuery
                            ? `No transactions match "${searchQuery}". Try adjusting your search.`
                            : filterStatus === 'all'
                                ? 'No deposit requests have been made yet.'
                                : `No ${filterStatus} transactions found.`}
                    </p>
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="mt-4 px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors"
                        >
                            Clear Search
                        </button>
                    )}
                </div>
            )}

            {/* Transactions List */}
            {!isLoading && filteredTransactions.length > 0 && (
                <div className="space-y-4">
                    {filteredTransactions.map((tx) => {
                        const status = statusConfig[tx.status as TransactionStatus];
                        const StatusIcon = status.icon;

                        return (
                            <div
                                key={tx.id}
                                className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/60 to-gray-800/40 p-6 transition-all duration-300 hover:border-white/20 hover:shadow-lg hover:shadow-blue-500/5"
                            >
                                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                                    {/* User Info */}
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
                                            <span className="text-white font-bold text-xl">
                                                {tx.user?.name?.charAt(0) || tx.user?.email?.charAt(0) || '?'}
                                            </span>
                                        </div>
                                        <div>
                                            <p className="text-white font-semibold text-lg">
                                                {tx.user?.name || 'Unknown User'}
                                            </p>
                                            <p className="text-gray-400 text-sm">{tx.user?.email}</p>
                                        </div>
                                    </div>

                                    {/* Transaction Details */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 lg:gap-6">
                                        <div>
                                            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Amount</p>
                                            <p className="text-white font-bold text-xl">PKR {tx.amount.toFixed(0)}</p>
                                        </div>
                                        <div>
                                            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Method</p>
                                            <p className="text-white font-medium">{tx.paymentMethod}</p>
                                        </div>
                                        <div>
                                            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Reference</p>
                                            <code className="text-sm bg-white/5 px-2 py-1 rounded text-blue-300 inline-block max-w-[120px] truncate">
                                                {tx.transactionId}
                                            </code>
                                        </div>
                                        <div>
                                            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Status</p>
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${status.bgClass} ${status.textClass}`}>
                                                <StatusIcon className="w-3.5 h-3.5" />
                                                {status.label}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    {tx.status === 'pending' && (
                                        <div className="flex gap-3 flex-shrink-0">
                                            <button
                                                onClick={() => handleApprove(tx.id)}
                                                disabled={processingId === tx.id}
                                                className="px-5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 hover:border-emerald-400/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                {processingId === tx.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <CheckCircle className="w-4 h-4" />
                                                )}
                                                Approve
                                            </button>
                                            <button
                                                onClick={() => setShowRejectModal(tx.id)}
                                                disabled={processingId === tx.id}
                                                className="px-5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 hover:border-red-400/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                <XCircle className="w-4 h-4" />
                                                Reject
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Additional Info */}
                                <div className="mt-4 pt-4 border-t border-white/5 flex flex-wrap gap-4 text-sm text-gray-400">
                                    <span>
                                        Submitted: {new Date(tx.createdAt).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </span>
                                    {tx.status !== 'pending' && tx.processedAt && (
                                        <span>
                                            Processed: {new Date(tx.processedAt).toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                            {tx.processedBy && ` by ${tx.processedBy}`}
                                        </span>
                                    )}
                                </div>

                                {/* Rejection Notes */}
                                {tx.status === 'rejected' && tx.adminNotes && (
                                    <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex gap-3">
                                        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-red-300 font-medium text-sm">Rejection Reason</p>
                                            <p className="text-red-200/80 text-sm mt-1">{tx.adminNotes}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Reject Modal */}
            {showRejectModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    onClick={() => {
                        setShowRejectModal(null);
                        setRejectNotes('');
                    }}
                >
                    <div
                        className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-xl bg-red-500/20">
                                <XCircle className="w-6 h-6 text-red-400" />
                            </div>
                            <h3 className="text-xl font-bold text-white">Reject Deposit</h3>
                        </div>

                        <p className="text-gray-400 text-sm mb-4">
                            Please provide a reason for rejection. This will be visible to the user.
                        </p>

                        <textarea
                            value={rejectNotes}
                            onChange={(e) => setRejectNotes(e.target.value)}
                            placeholder="e.g., Invalid transaction ID, amount mismatch, duplicate request..."
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/25 resize-none"
                            rows={3}
                            autoFocus
                        />

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => {
                                    setShowRejectModal(null);
                                    setRejectNotes('');
                                }}
                                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 text-gray-300 rounded-xl hover:bg-white/10 transition-all duration-200 font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleReject(showRejectModal)}
                                disabled={processingId === showRejectModal}
                                className="flex-1 px-4 py-3 bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl hover:bg-red-500/30 transition-all duration-200 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {processingId === showRejectModal ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <XCircle className="w-4 h-4" />
                                        Reject Deposit
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
