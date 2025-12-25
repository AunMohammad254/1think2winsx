// 1Think Wallet - TypeScript Types

export type PaymentMethod = 'Easypaisa' | 'Jazzcash' | 'Bank' | 'QuizAccess';
export type TransactionStatus = 'pending' | 'approved' | 'rejected';
export type TransactionType = 'deposit' | 'deduction';

export interface WalletTransaction {
    id: string;
    userId: string;
    amount: number;
    paymentMethod: PaymentMethod;
    transactionId: string;
    status: TransactionStatus;
    proofImage?: string | null;
    adminNotes?: string | null;
    processedAt?: string | null;
    processedBy?: string | null;
    createdAt: string;
    updatedAt: string;
    user?: {
        id: string;
        name: string | null;
        email: string;
    };
}

export interface DepositFormData {
    amount: number;
    paymentMethod: PaymentMethod;
    transactionId: string;
    proofImage?: File;
}

export interface WalletBalance {
    balance: number;
    lastUpdated: string;
}

export interface AdminBankDetails {
    easypaisa: {
        accountNumber: string;
        accountName: string;
    };
    jazzcash?: {
        accountNumber: string;
        accountName: string;
    };
    bank?: {
        bankName: string;
        accountNumber: string;
        accountName: string;
        iban?: string;
    };
}

// Static Admin Bank Details - Update these as needed
export const ADMIN_BANK_DETAILS: AdminBankDetails = {
    easypaisa: {
        accountNumber: '03101201414',
        accountName: 'Aun Abbas',
    },
    // Uncomment and add details when ready
    // jazzcash: {
    //   accountNumber: 'YOUR_JAZZCASH_NUMBER',
    //   accountName: 'YOUR_NAME',
    // },
    // bank: {
    //   bankName: 'YOUR_BANK_NAME',
    //   accountNumber: 'YOUR_ACCOUNT_NUMBER',
    //   accountName: 'YOUR_NAME',
    //   iban: 'YOUR_IBAN',
    // },
};

// Minimum deposit amount in PKR
export const MIN_DEPOSIT_AMOUNT = 5;

// Server action response types
export interface DepositRequestResponse {
    success: boolean;
    message?: string;
    error?: string;
    transaction?: WalletTransaction;
}

export interface WalletBalanceResponse {
    success: boolean;
    balance?: number;
    error?: string;
}

export interface TransactionHistoryResponse {
    success: boolean;
    transactions?: WalletTransaction[];
    error?: string;
}

export interface AdminTransactionResponse {
    success: boolean;
    message?: string;
    error?: string;
    transaction?: WalletTransaction;
}
