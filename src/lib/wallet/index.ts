/**
 * Wallet module public re-export.
 * Import from here instead of importing service.ts directly.
 *
 * @example
 *   import { isWalletEnabled, getWalletBalance } from '@/lib/wallet';
 */
export {
    isWalletEnabled,
    invalidateWalletEnabledCache,
    getWalletBalance,
    getQuizAccessPrice,
    deductForQuizAccess,
} from './service';

export type {
    GetBalanceResult,
    GetPriceResult,
    DeductionResult,
} from './service';
