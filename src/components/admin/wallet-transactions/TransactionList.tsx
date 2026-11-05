'use client';

import { Search, Wallet } from 'lucide-react';
import type { WalletTransaction } from '@/types/wallet';
import type { FilterStatus } from './filters';
import TransactionRow from './TransactionRow';

interface TransactionListProps {
    /** The transactions left after the method filter and search */
    transactions: WalletTransaction[];
    isLoading: boolean;
    searchQuery: string;
    filterStatus: FilterStatus;
    onClearSearch: () => void;
    selectedIds: Set<string>;
    processingId: string | null;
    onToggleSelected: (transactionId: string, checked: boolean) => void;
    onApprove: (transactionId: string) => void;
    onReject: (transactionId: string) => void;
}

function LoadingSkeleton() {
    return (
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
    );
}

function EmptyState({ searchQuery, filterStatus, onClearSearch }: Pick<TransactionListProps, 'searchQuery' | 'filterStatus' | 'onClearSearch'>) {
    return (
        <div className="text-center py-16 rounded-2xl border border-white/10 bg-linear-to-br from-gray-900/50 to-gray-800/30">
            <div className="w-20 h-20 mx-auto mb-6 bg-linear-to-r from-blue-500/20 to-purple-500/20 rounded-full flex items-center justify-center">
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
                    onClick={onClearSearch}
                    className="mt-4 px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors"
                >
                    Clear Search
                </button>
            )}
        </div>
    );
}

/** The loading skeleton, the empty state, or one row per transaction */
export default function TransactionList({
    transactions,
    isLoading,
    searchQuery,
    filterStatus,
    onClearSearch,
    selectedIds,
    processingId,
    onToggleSelected,
    onApprove,
    onReject,
}: TransactionListProps) {
    if (isLoading) return <LoadingSkeleton />;

    if (transactions.length === 0) {
        return <EmptyState searchQuery={searchQuery} filterStatus={filterStatus} onClearSearch={onClearSearch} />;
    }

    return (
        <div className="space-y-4">
            {transactions.map((tx) => (
                <TransactionRow
                    key={tx.id}
                    tx={tx}
                    isSelected={selectedIds.has(tx.id)}
                    isProcessing={processingId === tx.id}
                    onToggleSelected={onToggleSelected}
                    onApprove={onApprove}
                    onReject={onReject}
                />
            ))}
        </div>
    );
}
