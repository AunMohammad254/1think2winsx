'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { WalletTransaction, TransactionStatus } from '@/types/wallet';
import { getCSRFHeaders } from '@/lib/csrf';
import type { FilterStatus } from './filters';

/**
 * The admin wallet-transactions state: loads the transactions for the status filter, and runs every
 * write (approve, reject, bulk approve/reject, statement reconcile) with the selection and the
 * reject modal they share.
 */
export function useWalletTransactions() {
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectNotes, setRejectNotes] = useState('');
    const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isProcessingBulk, setIsProcessingBulk] = useState(false);
    const [isReconciling, setIsReconciling] = useState(false);

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
    // Selection & Reject Modal
    // ============================================
    const toggleSelected = (transactionId: string, checked: boolean) => {
        const newSelected = new Set(selectedIds);
        if (checked) {
            newSelected.add(transactionId);
        } else {
            newSelected.delete(transactionId);
        }
        setSelectedIds(newSelected);
    };

    const selectPending = (candidates: WalletTransaction[]) => {
        const newSelected = new Set(selectedIds);
        candidates.forEach(tx => {
            if (tx.status === 'pending') newSelected.add(tx.id);
        });
        setSelectedIds(newSelected);
    };

    const clearSelection = () => setSelectedIds(new Set());

    const closeRejectModal = () => {
        setShowRejectModal(null);
        setRejectNotes('');
    };

    // "Reject Selected" opens the reject modal with this id instead of a transaction id
    const isBulkReject = showRejectModal === 'bulk';
    const isRejecting = isBulkReject ? isProcessingBulk : processingId === showRejectModal;

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
                headers: { 'Content-Type': 'application/json', ...(await getCSRFHeaders()) },
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
                headers: { 'Content-Type': 'application/json', ...(await getCSRFHeaders()) },
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

            closeRejectModal();
            await fetchTransactions();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to reject transaction');
        } finally {
            setProcessingId(null);
        }
    };

    // The bulk buttons only show with a selection, and are disabled while processing
    const handleBulkProcess = async (action: 'approve' | 'reject') => {
        setIsProcessingBulk(true);
        try {
            const response = await fetch('/api/admin/wallet-transactions/bulk-process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getCSRFHeaders()) },
                body: JSON.stringify({
                    transactionIds: Array.from(selectedIds),
                    action,
                    notes: action === 'reject' ? rejectNotes : undefined,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `Failed to bulk ${action}`);
            }

            toast.success(data.message);
            setSelectedIds(new Set());
            closeRejectModal();
            await fetchTransactions();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : `Failed to bulk ${action}`);
        } finally {
            setIsProcessingBulk(false);
        }
    };

    const handleReconcile = async (file: File) => {
        const shouldAutoApprove = window.confirm(
            'Auto-approve matched transactions?\n\nYes = Matched deposits will be approved instantly (recommended for high-confidence matches).\nNo = Matched deposits will be selected for your review.'
        );

        setIsReconciling(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('auto_approve', shouldAutoApprove ? 'true' : 'false');

            const response = await fetch('/api/admin/wallet-transactions/reconcile', {
                method: 'POST',
                // No Content-Type: the browser sets the multipart boundary for FormData
                headers: await getCSRFHeaders(),
                body: formData,
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to reconcile statement');
            }

            const { matchedIds = [], autoApproved = [], unmatchedPending = [], statementEntriesFound = 0 } = data;

            if (matchedIds.length === 0) {
                toast.info(`Statement parsed: ${statementEntriesFound} entries found. No matching pending transactions.`);
            } else if (shouldAutoApprove) {
                toast.success(
                    `✅ Statement reconciled: ${autoApproved.length} transaction(s) auto-approved from ${statementEntriesFound} statement entries.`,
                    { duration: 6000 }
                );
                // Refresh to reflect approvals
                await fetchTransactions();
            } else {
                // Select matched for manual review
                const newSelected = new Set(selectedIds);
                matchedIds.forEach((id: string) => newSelected.add(id));
                setSelectedIds(newSelected);
                toast.success(
                    `Found ${matchedIds.length} matching transaction(s) from ${statementEntriesFound} statement entries — selected for review.`,
                    { duration: 5000 }
                );
            }

            if (unmatchedPending.length > 0) {
                toast.warning(
                    `⚠️ ${unmatchedPending.length} pending deposit(s) could not be matched in the statement — review manually.`,
                    { duration: 8000 }
                );
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Error reconciling statement');
        } finally {
            setIsReconciling(false);
        }
    };

    return {
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
    };
}
