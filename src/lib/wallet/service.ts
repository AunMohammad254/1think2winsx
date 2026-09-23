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

import { getAdminDb, walletTransactionDb, dailyPaymentDb, userDb, quizDb, generateId } from '@/lib/supabase/db';

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
 * @param authUserId  - Supabase auth user ID (from session)
 * @param userEmail   - Email for looking up the DB user record
 * @param amount      - Amount to deduct in PKR
 * @param quizId      - Optional quiz ID for the transaction audit note
 */
export async function deductForQuizAccess(
    authUserId: string,
    userEmail: string,
    amount: number,
    quizId?: string
): Promise<DeductionResult> {
    if (amount <= 0) return { success: false, error: 'Invalid amount' };

    try {
        const dbUser = await userDb.findByEmail(userEmail);
        if (!dbUser) {
            return { success: false, error: 'User not found. Please try logging out and back in.' };
        }

        if (dbUser.walletBalance < amount) {
            return {
                success: false,
                error: 'Insufficient wallet balance',
                insufficientBalance: true,
                requiredAmount: amount,
                currentBalance: dbUser.walletBalance,
            };
        }

        const adminDb = getAdminDb();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // 1. Atomic deduction via RPC (prevents race conditions)
        const { data: rpcResult, error: rpcError } = await adminDb.rpc('deduct_wallet_balance', {
            p_user_id: authUserId,
            p_amount: amount,
        });

        if (rpcError || !rpcResult || !rpcResult.success) {
            console.error('[wallet/service] Deduction RPC failed:', rpcError || rpcResult?.error);
            return {
                success: false,
                error: (rpcResult?.error as string) || 'Insufficient balance or transaction failed',
                insufficientBalance: rpcResult?.error === 'Insufficient funds',
            };
        }

        const newBalance = rpcResult.new_balance as number;

        // 2. Record transaction history + daily payment (best-effort — deduction already happened)
        try {
            await walletTransactionDb.create({
                userId: dbUser.id,
                amount: -amount,
                paymentMethod: 'QuizAccess',
                transactionId: `quiz_access_${Date.now()}_${dbUser.id}`,
                status: 'approved',
                adminNotes: quizId ? `Quiz access payment for quiz: ${quizId}` : '24-hour quiz access payment',
                processedAt: now.toISOString(),
            });

            await dailyPaymentDb.create({
                userId: dbUser.id,
                amount,
                status: 'completed',
                paymentMethod: 'wallet',
                transactionId: `wallet_${Date.now()}_${dbUser.id}`,
                expiresAt: expiresAt.toISOString(),
            });
        } catch (logError) {
            // Non-fatal — deduction occurred. Log for ops team but don't surface to user.
            console.error('[wallet/service] Failed to log transaction history (deduction already succeeded):', logError);
        }

        return {
            success: true,
            message: 'Payment successful! You now have 24-hour quiz access.',
            newBalance,
            paymentId: `wallet_${Date.now()}_${dbUser.id}`,
        };
    } catch (err) {
        console.error('[wallet/service] deductForQuizAccess error:', err);
        return { success: false, error: 'Failed to process payment. Please try again.' };
    }
}
