'use server';

import { createClient } from '@/lib/supabase/server';
import prisma from '@/lib/prisma';
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

        // Get user by email since Prisma uses CUID and Supabase uses UUID
        const dbUser = await prisma.user.findUnique({
            where: { email: user.email! },
            select: { walletBalance: true }
        });

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
        const dbUser = await prisma.user.findUnique({
            where: { email: user.email! },
            select: { id: true, walletBalance: true }
        });

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

        // Use Prisma transaction to atomically:
        // 1. Deduct wallet balance
        // 2. Create wallet transaction record
        // 3. Create daily payment for quiz access
        const result = await prisma.$transaction(async (tx) => {
            // Deduct balance
            const updatedUser = await tx.user.update({
                where: { id: dbUser.id },
                data: {
                    walletBalance: { decrement: amount }
                },
                select: { walletBalance: true }
            });

            // Create wallet transaction record for history
            await tx.walletTransaction.create({
                data: {
                    userId: dbUser.id,
                    amount: -amount, // Negative for deduction
                    paymentMethod: 'QuizAccess',
                    transactionId: `quiz_access_${Date.now()}_${dbUser.id}`,
                    status: 'approved', // Auto-approved since it's a deduction
                    adminNotes: quizId ? `Quiz access payment for quiz: ${quizId}` : '24-hour quiz access payment',
                    processedAt: now,
                }
            });

            // Create daily payment record for quiz access
            const dailyPayment = await tx.dailyPayment.create({
                data: {
                    userId: dbUser.id,
                    amount: amount,
                    status: 'completed',
                    paymentMethod: 'wallet',
                    transactionId: `wallet_${Date.now()}_${dbUser.id}`,
                    expiresAt: expiresAt,
                }
            });

            return {
                newBalance: updatedUser.walletBalance,
                paymentId: dailyPayment.id,
            };
        });

        // Revalidate wallet page to show new balance and transaction
        revalidatePath('/profile/wallet');
        revalidatePath('/quizzes');

        return {
            success: true,
            message: 'Payment successful! You now have 24-hour quiz access.',
            newBalance: result.newBalance,
            paymentId: result.paymentId,
        };
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
        // Get the minimum access price across all active quizzes
        // or return the default if no quizzes exist
        const quiz = await prisma.quiz.findFirst({
            where: { status: 'active' },
            select: { accessPrice: true },
            orderBy: { accessPrice: 'asc' }
        });

        return {
            success: true,
            price: quiz?.accessPrice ?? 2.0, // Default to 2 PKR if no quizzes
        };
    } catch (error) {
        console.error('Error fetching quiz access price:', error);
        return { success: false, error: 'Failed to fetch price' };
    }
}
