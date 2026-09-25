/**
 * Wallet Service — Single public entry point for all wallet business logic.
 *
 * ARCHITECTURE:
 *   src/lib/wallet/service.ts  ← YOU ARE HERE (business logic)
 *   src/lib/supabase/db-modules/wallet.db.ts  ← data layer (service imports this)
 *   src/actions/wallet-deduction-actions.ts   ← thin shim (calls service)
 *
 * Rule: No other module should import directly from wallet.db.ts or
 * wallet-deduction-actions.ts for wallet business logic. Import from this
 * file (or the re-export at src/lib/wallet/index.ts) instead.
 *
 * FEATURE FLAG:
 *   isWalletEnabled() reads from the AppSettings DB table (key='wallet_enabled').
 *   Fallback: WALLET_FEATURE_ENABLED env var. Default: enabled.
 *   When disabled: the wallet UI is fully hidden, quiz access is blocked for all users,
 *   and wallet API routes return 503 WALLET_DISABLED.
 */

import { getAdminDb, userDb, quizDb } from '@/lib/supabase/db';
import { createClient as createServerClient } from '@/lib/supabase/server';

// ============================================================================
// FEATURE FLAG
// ============================================================================

let _walletEnabledCache: { value: boolean; fetchedAt: number } | null = null;
const FLAG_CACHE_TTL_MS = 60_000; // cache the flag for 1 minute

/**
 * Check whether the wallet feature is enabled.
 *
 * Resolution order:
 *   1. WALLET_FEATURE_ENABLED env var (deployment-level kill switch)
 *   2. AppSettings DB row key='wallet_enabled' (admin-toggleable, cached 1 min)
 *   3. Default: true (wallet ON)
 */
export async function isWalletEnabled(): Promise<boolean> {
    // 1. Env-var override — fastest path, no DB round-trip
    const envFlag = process.env.WALLET_FEATURE_ENABLED;
    if (envFlag === 'false') return false;
    if (envFlag === 'true') return true;

    // 2. Cached DB read
    const now = Date.now();
    if (_walletEnabledCache && now - _walletEnabledCache.fetchedAt < FLAG_CACHE_TTL_MS) {
        return _walletEnabledCache.value;
    }

    try {
        const adminDb = getAdminDb();
        const { data } = await adminDb
            .from('AppSettings')
            .select('value')
            .eq('key', 'wallet_enabled')
            .single();

        const enabled = data?.value !== 'false'; // missing row → default ON
        _walletEnabledCache = { value: enabled, fetchedAt: now };
        return enabled;
    } catch {
        // If the AppSettings table doesn't exist yet (before migration), default ON
        return true;
    }
}

/** Invalidate the in-memory wallet-enabled flag cache (call after admin toggles it). */
export function invalidateWalletEnabledCache(): void {
    _walletEnabledCache = null;
}

// ============================================================================
// BALANCE
// ============================================================================

export interface GetBalanceResult {
    success: boolean;
    balance?: number;
    error?: string;
}

/**
 * Get the current wallet balance for a user.
 * Throws if called from a client context (use the server action wrapper instead).
 */
export async function getWalletBalance(userEmail: string): Promise<GetBalanceResult> {
    try {
        const dbUser = await userDb.findByEmail(userEmail);
        if (!dbUser) return { success: true, balance: 0 };
        return { success: true, balance: dbUser.walletBalance };
    } catch (err) {
        console.error('[wallet/service] getWalletBalance error:', err);
        return { success: false, error: 'Failed to fetch wallet balance' };
    }
}

// ============================================================================
// QUIZ ACCESS PRICE
// ============================================================================

export interface GetPriceResult {
    success: boolean;
    price?: number;
    error?: string;
}

/** Get the access price for quiz play (from the first active quiz, fallback 2 PKR). */
export async function getQuizAccessPrice(): Promise<GetPriceResult> {
    try {
        const quizzes = await quizDb.findMany({ status: 'active', limit: 1, orderBy: 'createdAt' });
        return { success: true, price: quizzes[0]?.accessPrice ?? 2.0 };
    } catch (err) {
        console.error('[wallet/service] getQuizAccessPrice error:', err);
        return { success: false, error: 'Failed to fetch price' };
    }
}

// ============================================================================
// DEDUCTION
// ============================================================================

export interface DeductionResult {
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
 * Atomically deduct wallet balance and grant 24-hour quiz access.
 *
 * SECURITY: the price is decided by the database (`pay_quiz_access` reads the
 * quiz's accessPrice). The `amount` argument is kept only for backwards
 * compatibility and is ignored — it used to come straight from the browser, so a
 * user could buy 24h access for 0.01 PKR. Balance deduction, the transaction
 * record and the DailyPayment row are written in ONE transaction (previously three
 * separate requests: a failure after the deduction charged the user without
 * granting access).
 *
 * Must be called in a request context that carries the user's Supabase session.
 */
export async function deductForQuizAccess(
    _authUserId: string,
    _userEmail: string,
    _amount: number,
    quizId?: string
): Promise<DeductionResult> {
    try {
        const supabase = await createServerClient();
        const { data, error } = await supabase.rpc('pay_quiz_access', { p_quiz_id: quizId ?? null });

        if (error || !data) {
            console.error('[wallet/service] pay_quiz_access failed:', error);
            return { success: false, error: 'Failed to process payment. Please try again.' };
        }

        const r = data as {
            success: boolean; error?: string; alreadyActive?: boolean; paymentId?: string;
            newBalance?: number; insufficientBalance?: boolean; requiredAmount?: number; currentBalance?: number;
        };

        if (!r.success) {
            return {
                success: false,
                error: r.error || 'Payment failed',
                insufficientBalance: !!r.insufficientBalance,
                requiredAmount: r.requiredAmount,
                currentBalance: r.currentBalance,
            };
        }

        return {
            success: true,
            message: r.alreadyActive
                ? 'You already have active quiz access.'
                : 'Payment successful! You now have 24-hour quiz access.',
            newBalance: r.newBalance,
            paymentId: r.paymentId,
        };
    } catch (err) {
        console.error('[wallet/service] deductForQuizAccess error:', err);
        return { success: false, error: 'Failed to process payment. Please try again.' };
    }
}
