'use client';

import { useState } from 'react';
import { filterTransactions, type MethodFilter } from './wallet-transactions/filters';
import { useWalletTransactions } from './wallet-transactions/useWalletTransactions';
import WalletStatsCards from './wallet-transactions/WalletStatsCards';
import TransactionFilters from './wallet-transactions/TransactionFilters';
import StatementReconcileUpload from './wallet-transactions/StatementReconcileUpload';
import BulkActionBar from './wallet-transactions/BulkActionBar';
import TransactionList from './wallet-transactions/TransactionList';
import RejectModal from './wallet-transactions/RejectModal';

// ============================================
// Main Component
// ============================================
export default function WalletTransactionsManager() {
    const {
        transactions,
        isLoading,
        isRefreshing,
        filterStatus,
        setFilterStatus,
        processingId,
        rejectNotes,
        setRejectNotes,
        showRejectModal,
        setShowRejectModal,
        closeRejectModal,
        isBulkReject,
        isRejecting,
        selectedIds,
        toggleSelected,
        selectPending,
        clearSelection,
        isProcessingBulk,
        isReconciling,
        fetchTransactions,
        handleApprove,
        handleReject,
        handleBulkProcess,
        handleReconcile,
    } = useWalletTransactions();
    const [searchQuery, setSearchQuery] = useState('');
    const [filterMethod, setFilterMethod] = useState<MethodFilter>('all');

    const filteredTransactions = filterTransactions(transactions, filterMethod, searchQuery);

    return (
        <div className="space-y-6">
            <WalletStatsCards transactions={transactions} />

            <TransactionFilters
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                filterStatus={filterStatus}
                onFilterStatusChange={setFilterStatus}
                filterMethod={filterMethod}
                onFilterMethodChange={setFilterMethod}
                canSelectAll={filteredTransactions.some(tx => tx.status === 'pending')}
                onSelectAll={() => selectPending(filteredTransactions)}
                isRefreshing={isRefreshing}
                onRefresh={() => fetchTransactions(true)}
            >
                <StatementReconcileUpload isReconciling={isReconciling} onReconcile={handleReconcile} />
            </TransactionFilters>

            {selectedIds.size > 0 && (
                <BulkActionBar
                    selectedCount={selectedIds.size}
                    isProcessing={isProcessingBulk}
                    onClear={clearSelection}
                    onApprove={() => handleBulkProcess('approve')}
                    onReject={() => setShowRejectModal('bulk')}
                />
            )}

            <TransactionList
                transactions={filteredTransactions}
                isLoading={isLoading}
                searchQuery={searchQuery}
                filterStatus={filterStatus}
                onClearSearch={() => setSearchQuery('')}
                selectedIds={selectedIds}
                processingId={processingId}
                onToggleSelected={toggleSelected}
                onApprove={handleApprove}
                onReject={setShowRejectModal}
            />

            {showRejectModal && (
                <RejectModal
                    notes={rejectNotes}
                    onNotesChange={setRejectNotes}
                    isRejecting={isRejecting}
                    onClose={closeRejectModal}
                    onConfirm={() => isBulkReject ? handleBulkProcess('reject') : handleReject(showRejectModal)}
                />
            )}
        </div>
    );
}
