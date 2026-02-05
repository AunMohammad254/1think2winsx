/**
 * Database Layer Barrel Export
 * 
 * This file re-exports all database modules for easy imports.
 * Import from '@/lib/supabase/db' for backward compatibility.
 */

// Shared utilities
export { generateId, getDb, getAdminDb } from './shared'

// Domain-specific modules
export { userDb } from './user.db'
export {
    quizDb,
    questionDb,
    quizAttemptDb,
    answerDb,
    questionAttemptDb
} from './quiz.db'
export {
    walletTransactionDb,
    dailyPaymentDb
} from './wallet.db'
export {
    prizeDb,
    prizeRedemptionDb
} from './prize.db'
export {
    adminSessionDb,
    rateLimitDb,
    securityEventDb
} from './admin.db'
export { streamConfigDb } from './stream.db'

// Combined db object for convenience
import { userDb } from './user.db'
import { quizDb, questionDb, quizAttemptDb, answerDb } from './quiz.db'
import { walletTransactionDb, dailyPaymentDb } from './wallet.db'
import { prizeDb, prizeRedemptionDb } from './prize.db'
import { adminSessionDb, rateLimitDb, securityEventDb } from './admin.db'
import { streamConfigDb } from './stream.db'

export const db = {
    user: userDb,
    quiz: quizDb,
    question: questionDb,
    quizAttempt: quizAttemptDb,
    answer: answerDb,
    walletTransaction: walletTransactionDb,
    prize: prizeDb,
    prizeRedemption: prizeRedemptionDb,
    adminSession: adminSessionDb,
    rateLimit: rateLimitDb,
    securityEvent: securityEventDb,
    dailyPayment: dailyPaymentDb,
    streamConfig: streamConfigDb,
}

export default db
