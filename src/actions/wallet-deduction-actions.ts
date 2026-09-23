'use server';

/**
 * Wallet Deduction Server Actions — thin shim over src/lib/wallet/service.ts
 *
 * These remain here for backward compatibility with existing call sites
 * (quizzes/page.tsx, etc.). All business logic now lives in the wallet service.
 *
 * Do NOT add new wallet logic here — add it to src/lib/wallet/service.ts instead.
 */

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import {
    isWalletEnabled,
    getWalletBalance,
    getQuizAccessPrice as _getQuizAccessPrice,
    deductForQuizAccess as _deductForQuizAccess,
} from '@/lib/wallet/service';

export type { DeductionResult as WalletDeductionResponse } from '@/lib/wallet/service';

// Re-export the flag for convenience
export { isWalletEnabled };

/**
 * Get wallet balance for deduction check.
 * Used by quizzes/page.tsx PaymentModal flow.
 */
export async function getWalletBalanceForDeduction(): Promise<{
    success: boolean;
    balance?: number;
    error?: string;
}> {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user?.email) {
            return { success: false, error: 'You must be logged in' };
        }

        return await getWalletBalance(user.email);
    } catch (err) {
        console.error('[wallet-actions] getWalletBalanceForDeduction error:', err);
        return { success: false, error: 'Failed to fetch wallet balance' };
    }
}

/**
 * Deduct wallet balance for quiz access.
 * Creates a transaction record and grants 24-hour access.
 */
export async function deductWalletForQuizAccess(
    amount: number,
    quizId?: string
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user?.email) {
            return { success: false, error: 'You must be logged in' };
        }

        const result = await _deductForQuizAccess(user.id, user.email, amount, quizId);

        if (result.success) {
            revalidatePath('/profile/wallet');
            revalidatePath('/quizzes');
        }

        return result;
    } catch (err) {
        console.error('[wallet-actions] deductWalletForQuizAccess error:', err);
        return { success: false, error: 'Failed to process payment. Please try again.' };
    }
}

/**
 * Get the access price for all quizzes.
 */
export async function getQuizAccessPrice(): Promise<{
    success: boolean;
    price?: number;
    error?: string;
}> {
    return _getQuizAccessPrice();
}
