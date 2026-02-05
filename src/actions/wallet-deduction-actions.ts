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
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return { success: false, error: 'You must be logged in' };
        }

        // Validate amount
        if (amount <= 0) {
            return { success: false, error: 'Invalid amount' };
        }

        // Get user with current balance
        const dbUser = await userDb.findByEmail(user.email!);

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
            // 1. Atomic Deduction using RPC
            // This prevents race conditions where a user could spend the same balance twice
            const { data: rpcResult, error: rpcError } = await supabase.rpc('deduct_wallet_balance', {
                p_user_id: user.id,
                p_amount: amount
            });

            if (rpcError || !rpcResult || !rpcResult.success) {
                console.error('Wallet deduction failed:', rpcError || rpcResult?.error);
                return {
                    success: false,
                    error: (rpcResult?.error as string) || 'Insufficient balance or transaction failed',
                    insufficientBalance: rpcResult?.error === 'Insufficient funds'
                };
            }

            const newBalance = rpcResult.new_balance;

            // 2. Create wallet transaction record for history
            // Even if this fails, the deduction has happened. Ideally this should be in the same transaction
            // but Supabase HTTP API doesn't support multi-statement transactions easily without RPC.
            // Since we prioritized the deduction safely, we record the log best-effort.
            try {
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
                await dailyPaymentDb.create({
                    userId: dbUser.id,
                    amount: amount,
                    status: 'completed',
                    paymentMethod: 'wallet',
                    transactionId: `wallet_${Date.now()}_${dbUser.id}`,
                    expiresAt: expiresAt.toISOString(),
                });
            } catch (logError) {
                console.error('Failed to log transaction history, but deduction occurred:', logError);
                // We do NOT rollback here because the money is already gone safely.
                // In a production banking app, this whole block would be one big PL/pgSQL function.
            }

            // Revalidate wallet page to show new balance and transaction
            revalidatePath('/profile/wallet');
            revalidatePath('/quizzes');

            return {
                success: true,
                message: 'Payment successful! You now have 24-hour quiz access.',
                newBalance: newBalance,
                // We might not have a dailyPayment.id if logging failed, but that's acceptable for now to avoid blocking the user
                paymentId: `wallet_${Date.now()}_${dbUser.id}`,
            };
        } catch (innerError) {
            console.error('Transaction error:', innerError);
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
