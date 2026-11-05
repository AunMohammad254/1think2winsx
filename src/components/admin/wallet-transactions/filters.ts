import type { PaymentMethod, TransactionStatus, WalletTransaction } from '@/types/wallet';

/** The status filter: the server returns only transactions with this status */
export type FilterStatus = 'all' | TransactionStatus;

/** The payment-method filter, applied in the browser */
export type MethodFilter = 'all' | PaymentMethod;

/** Applies the payment-method filter and the search box to the loaded transactions */
export function filterTransactions(
    transactions: WalletTransaction[],
    filterMethod: MethodFilter,
    searchQuery: string,
): WalletTransaction[] {
    return transactions.filter(tx => {
        const matchesMethod = filterMethod === 'all' || tx.paymentMethod === filterMethod;
        if (!matchesMethod) return false;

        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            tx.user?.name?.toLowerCase().includes(query) ||
            tx.user?.email?.toLowerCase().includes(query) ||
            tx.transactionId?.toLowerCase().includes(query) ||
            tx.paymentMethod?.toLowerCase().includes(query)
        );
    });
}
