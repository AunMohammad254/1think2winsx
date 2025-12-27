'use server';

import { createClient } from '@/lib/supabase/server';
import { userDb, walletTransactionDb, dailyPaymentDb, quizDb, generateId } from '@/lib/supabase/db';
import { revalidatePath } from 'next/cache';

export interface WalletDeductionResponse {
    success: boolean;
    message?: string;
    error?: string;
    newBalance?: number;
    paymentId?: string;
    insufficientBalance?: boolean;
    requiredAmount?: number;
    currentBalance?: number;
}

/**
 * Get wallet balance for deduction check
 */
export async function getWalletBalanceForDeduction(): Promise<{
    success: boolean;
    balance?: number;
    error?: string;
}> {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return { success: false, error: 'You must be logged in' };
        }

        // Get user by email
        const dbUser = await userDb.findByEmail(user.email!);

        if (!dbUser) {
            return { success: true, balance: 0 };
        }

        return { success: true, balance: dbUser.walletBalance };
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        return { success: false, error: 'Failed to fetch wallet balance' };
    }
}

/**
 * Deduct wallet balance for quiz access
 * Creates a transaction record and grants 24-hour access
 */
export async function deductWalletForQuizAccess(
    amount: number,
    quizId?: string
): Promise<WalletDeductionResponse> {
    try {
        console.log('[deductWallet] Starting payment for amount:', amount);
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            console.log('[deductWallet] Auth error:', authError?.message);
            return { success: false, error: 'You must be logged in' };
        }

        console.log('[deductWallet] User email:', user.email);

        // Validate amount
        if (amount <= 0) {
            return { success: false, error: 'Invalid amount' };
        }

        // Get user with current balance
        const dbUser = await userDb.findByEmail(user.email!);

        console.log('[deductWallet] DB User found:', !!dbUser, dbUser?.id, dbUser?.walletBalance);

        if (!dbUser) {
            return {
                success: false,
                error: 'User not found. Please try logging out and back in.',
            };
        }

        // Check if user has sufficient balance
        if (dbUser.walletBalance < amount) {
            return {
                success: false,
                error: 'Insufficient wallet balance',
                insufficientBalance: true,
                requiredAmount: amount,
                currentBalance: dbUser.walletBalance,
            };
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

        // Note: Supabase doesn't have native transactions like Prisma
        // We'll perform operations sequentially and handle errors
        try {
            // 1. Deduct balance
            const newBalance = dbUser.walletBalance - amount;
            await userDb.update(dbUser.id, { walletBalance: newBalance });

            // 2. Create wallet transaction record for history
            await walletTransactionDb.create({
                userId: dbUser.id,
                amount: -amount, // Negative for deduction
                paymentMethod: 'QuizAccess',
                transactionId: `quiz_access_${Date.now()}_${dbUser.id}`,
                status: 'approved', // Auto-approved since it's a deduction
                adminNotes: quizId ? `Quiz access payment for quiz: ${quizId}` : '24-hour quiz access payment',
                processedAt: now.toISOString(),
            });

            // 3. Create daily payment record for quiz access
            const dailyPayment = await dailyPaymentDb.create({
                userId: dbUser.id,
                amount: amount,
                status: 'completed',
                paymentMethod: 'wallet',
                transactionId: `wallet_${Date.now()}_${dbUser.id}`,
                expiresAt: expiresAt.toISOString(),
            });

            // Revalidate wallet page to show new balance and transaction
            revalidatePath('/profile/wallet');
            revalidatePath('/quizzes');

            return {
                success: true,
                message: 'Payment successful! You now have 24-hour quiz access.',
                newBalance: newBalance,
                paymentId: dailyPayment.id,
            };
        } catch (innerError) {
            // If any operation fails, try to rollback the balance
            console.error('Transaction error, attempting rollback:', innerError);
            try {
                await userDb.update(dbUser.id, { walletBalance: dbUser.walletBalance });
            } catch (rollbackError) {
                console.error('Rollback failed:', rollbackError);
            }
            throw innerError;
        }
    } catch (error) {
        console.error('Error processing wallet deduction:', error);
        return {
            success: false,
            error: 'Failed to process payment. Please try again.'
        };
    }
}

/**
 * Get the access price for all quizzes (for now uses the minimum/default)
 * In the future, this could be per-quiz pricing
 */
export async function getQuizAccessPrice(): Promise<{
    success: boolean;
    price?: number;
    error?: string;
}> {
    try {
        // Get the first active quiz to get the access price
        const quizzes = await quizDb.findMany({
            status: 'active',
            limit: 1,
            orderBy: 'createdAt'
        });

        const quiz = quizzes[0];

        return {
            success: true,
            price: quiz?.accessPrice ?? 2.0, // Default to 2 PKR if no quizzes
        };
    } catch (error) {
        console.error('Error fetching quiz access price:', error);
        return { success: false, error: 'Failed to fetch price' };
    }
}
