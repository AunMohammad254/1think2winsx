'use client';

import { CheckCircle, XCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';
import type { WalletTransaction, TransactionStatus } from '@/types/wallet';

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

interface TransactionRowProps {
    tx: WalletTransaction;
    isSelected: boolean;
    /** This transaction's approve or reject is in flight */
    isProcessing: boolean;
    onToggleSelected: (transactionId: string, checked: boolean) => void;
    onApprove: (transactionId: string) => void;
    /** Opens the reject modal for this transaction */
    onReject: (transactionId: string) => void;
}

export default function TransactionRow({
    tx,
    isSelected,
    isProcessing,
    onToggleSelected,
    onApprove,
    onReject,
}: TransactionRowProps) {
    const status = statusConfig[tx.status as TransactionStatus];
    const StatusIcon = status.icon;

    return (
        <div
            className="rounded-2xl border border-white/10 bg-linear-to-br from-gray-900/60 to-gray-800/40 p-6 transition-all duration-300 hover:border-white/20 hover:shadow-lg hover:shadow-blue-500/5"
        >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                {/* User Info & Checkbox */}
                <div className="flex items-center gap-4">
                    {tx.status === 'pending' && (
                        <div className="shrink-0">
                            <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => onToggleSelected(tx.id, e.target.checked)}
                                className="w-5 h-5 rounded border-gray-600 bg-gray-700/50 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-gray-900 cursor-pointer"
                            />
                        </div>
                    )}
                    <div className="w-14 h-14 bg-linear-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20">
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
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 lg:gap-6">
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
                        <code className="text-sm bg-white/5 px-2 py-1 rounded text-blue-300 inline-block max-w-30 truncate">
                            {tx.transactionId}
                        </code>
                    </div>
                    <div>
                        <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Receipt</p>
                        {tx.proofImage ? (
                            <a href={tx.proofImage} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-sm font-medium hover:underline">
                                View Image
                            </a>
                        ) : (
                            <span className="text-gray-600 text-sm">No receipt</span>
                        )}
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
                    <div className="flex gap-3 shrink-0">
                        <button
                            onClick={() => onApprove(tx.id)}
                            disabled={isProcessing}
                            className="px-5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 hover:border-emerald-400/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isProcessing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <CheckCircle className="w-4 h-4" />
                            )}
                            Approve
                        </button>
                        <button
                            onClick={() => onReject(tx.id)}
                            disabled={isProcessing}
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
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-300 font-medium text-sm">Rejection Reason</p>
                        <p className="text-red-200/80 text-sm mt-1">{tx.adminNotes}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
