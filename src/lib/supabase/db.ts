/**
 * Supabase Database Layer
 * 
 * This file is maintained for backward compatibility.
 * All database operations have been split into modular files under ./db/
 * 
 * @see ./db/user.db.ts - User operations
 * @see ./db/quiz.db.ts - Quiz, Question, QuizAttempt, Answer operations
 * @see ./db/wallet.db.ts - WalletTransaction, DailyPayment operations
 * @see ./db/prize.db.ts - Prize, PrizeRedemption operations
 * @see ./db/admin.db.ts - AdminSession, RateLimit, SecurityEvent operations
 * @see ./db/stream.db.ts - StreamConfiguration operations
 */

// Re-export everything from the modular files
export * from './db-modules'
export { default } from './db-modules'
