'use server';

import { createClient } from '@/lib/supabase/server';
import prisma from '@/lib/prisma';
import { MIN_DEPOSIT_AMOUNT, DepositRequestResponse, WalletBalanceResponse, TransactionHistoryResponse, PaymentMethod } from '@/types/wallet';
import { revalidatePath } from 'next/cache';

/**
 * Submit a new deposit request
 */
export async function submitDepositRequest(formData: FormData): Promise<DepositRequestResponse> {
    try {
        // Get authenticated user
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

        // Check if transaction ID already exists
        const existingTransaction = await prisma.walletTransaction.findUnique({
            where: { transactionId: transactionId.trim() },
        });

        if (existingTransaction) {
            return { success: false, error: 'This transaction ID has already been submitted' };
        }

        // Ensure user exists in Prisma database
        let dbUser = await prisma.user.findUnique({
            where: { email: user.email! },
        });

        if (!dbUser) {
            // Create user if not exists (sync from Supabase)
            dbUser = await prisma.user.create({
                data: {
                    id: user.id,
                    email: user.email!,
                    name: user.user_metadata?.name || user.user_metadata?.full_name || null,
                    phone: user.user_metadata?.phone || null,
                },
            });
        }

        // Create deposit request
        const transaction = await prisma.walletTransaction.create({
            data: {
                userId: dbUser.id,
                amount,
                paymentMethod,
                transactionId: transactionId.trim(),
                status: 'pending',
            },
        });

        // Revalidate the wallet page
        revalidatePath('/profile/wallet');

        return {
            success: true,
            message: 'Deposit request submitted successfully',
            transaction: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
                updatedAt: transaction.updatedAt.toISOString(),
                processedAt: transaction.processedAt?.toISOString() || null,
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

        const dbUser = await prisma.user.findUnique({
            where: { email: user.email! },
            select: { walletBalance: true },
        });

        return {
            success: true,
            balance: dbUser?.walletBalance || 0,
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

        const dbUser = await prisma.user.findUnique({
            where: { email: user.email! },
            select: { id: true },
        });

        if (!dbUser) {
            return { success: true, transactions: [] };
        }

        const transactions = await prisma.walletTransaction.findMany({
            where: { userId: dbUser.id },
            orderBy: { createdAt: 'desc' },
        });

        return {
            success: true,
            transactions: transactions.map((tx) => ({
                ...tx,
                createdAt: tx.createdAt.toISOString(),
                updatedAt: tx.updatedAt.toISOString(),
                processedAt: tx.processedAt?.toISOString() || null,
                paymentMethod: tx.paymentMethod as PaymentMethod,
                status: tx.status as 'pending' | 'approved' | 'rejected',
            })),
        };
    } catch (error) {
        console.error('Error fetching transaction history:', error);
        return { success: false, error: 'Failed to fetch transaction history' };
    }
}
