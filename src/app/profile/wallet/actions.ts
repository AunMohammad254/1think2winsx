'use server';

import { createClient } from '@/lib/supabase/server';
import { MIN_DEPOSIT_AMOUNT, DepositRequestResponse, WalletBalanceResponse, TransactionHistoryResponse, PaymentMethod } from '@/types/wallet';
import { revalidatePath } from 'next/cache';

/**
 * Submit a new deposit request
 */
export async function submitDepositRequest(formData: FormData): Promise<DepositRequestResponse> {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return { success: false, error: 'You must be logged in to submit a deposit request' };
        }

        // Parse form data
        const amountStr = formData.get('amount') as string;
        const paymentMethod = formData.get('paymentMethod') as PaymentMethod;
        const transactionId = formData.get('transactionId') as string;

        // Validate amount
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount < MIN_DEPOSIT_AMOUNT) {
            return { success: false, error: `Minimum deposit amount is ${MIN_DEPOSIT_AMOUNT} PKR` };
        }

        // Validate payment method
        const validMethods: PaymentMethod[] = ['Easypaisa', 'Jazzcash', 'Bank'];
        if (!validMethods.includes(paymentMethod)) {
            return { success: false, error: 'Invalid payment method' };
        }

        // Validate transaction ID
        if (!transactionId || transactionId.trim().length === 0) {
            return { success: false, error: 'Transaction ID is required' };
        }

        // Call Supabase RPC function
        const { data, error } = await supabase.rpc('submit_deposit_request', {
            p_amount: amount,
            p_payment_method: paymentMethod,
            p_transaction_id: transactionId.trim()
        });

        if (error) {
            console.error('Supabase RPC Error:', error);
            // Handle specific errors returned by the function
            // The function returns JSON, but the RPC client might wrap it or return Postgres error
            return { success: false, error: error.message || 'Failed to submit request' };
        }

        // The RPC returns { success: boolean, error?: string, id?: string }
        // We need to cast it or check properties
        const result = data as any;

        if (!result.success) {
            return { success: false, error: result.error || 'Submission failed' };
        }

        // If successful, fetch the created transaction to return it
        const { data: transaction, error: fetchError } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('id', result.id)
            .single();

        if (fetchError || !transaction) {
            // It succeeded but we couldn't fetch it back immediately (rare)
            revalidatePath('/profile/wallet');
            return { success: true, message: 'Deposit request submitted successfully' };
        }

        // Revalidate the wallet page
        revalidatePath('/profile/wallet');

        return {
            success: true,
            message: 'Deposit request submitted successfully',
            transaction: {
                ...transaction,
                createdAt: transaction.createdAt, // Supabase returns ISO string usually
                updatedAt: transaction.updatedAt,
                processedAt: transaction.processedAt,
                paymentMethod: transaction.paymentMethod as PaymentMethod,
                status: transaction.status as 'pending' | 'approved' | 'rejected',
            },
        };
    } catch (error) {
        console.error('Error submitting deposit request:', error);
        return { success: false, error: 'Failed to submit deposit request. Please try again.' };
    }
}

/**
 * Get current user's wallet balance
 */
export async function getWalletBalance(): Promise<WalletBalanceResponse> {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return { success: false, error: 'You must be logged in to view wallet balance' };
        }

        // Query by email since Prisma User uses CUID while Supabase uses UUID
        const { data, error } = await supabase
            .from('User')
            .select('walletBalance')
            .eq('email', user.email)
            .single();

        if (error) {
            console.error('Error fetching balance from Supabase:', error);
            // If user not found, return 0 balance (user may not be synced yet)
            if (error.code === 'PGRST116') {
                return { success: true, balance: 0 };
            }
            return { success: false, error: 'Failed to fetch wallet balance' };
        }

        return {
            success: true,
            balance: data?.walletBalance || 0,
        };
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        return { success: false, error: 'Failed to fetch wallet balance' };
    }
}

/**
 * Get current user's transaction history
 */
export async function getTransactionHistory(): Promise<TransactionHistoryResponse> {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return { success: false, error: 'You must be logged in to view transaction history' };
        }

        // First get the user ID from the User table by email
        const { data: userData, error: userError } = await supabase
            .from('User')
            .select('id')
            .eq('email', user.email)
            .single();

        if (userError || !userData) {
            console.error('Error finding user:', userError);
            // If user not found, return empty transactions
            return { success: true, transactions: [] };
        }

        const { data: transactions, error } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('userId', userData.id)
            .order('createdAt', { ascending: false });

        if (error) {
            console.error('Error fetching transactions from Supabase:', error);
            return { success: false, error: 'Failed to fetch transaction history' };
        }

        return {
            success: true,
            transactions: (transactions || []).map((tx) => ({
                ...tx,
                createdAt: tx.createdAt,
                updatedAt: tx.updatedAt,
                processedAt: tx.processedAt,
                paymentMethod: tx.paymentMethod as PaymentMethod,
                status: tx.status as 'pending' | 'approved' | 'rejected',
            })),
        };
    } catch (error) {
        console.error('Error fetching transaction history:', error);
        return { success: false, error: 'Failed to fetch transaction history' };
    }
}
