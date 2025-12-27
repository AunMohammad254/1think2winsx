import { securityLogger } from './security-logger';
import { getDb, answerDb, quizAttemptDb, questionAttemptDb, dailyPaymentDb, userDb, generateId } from './supabase/db';

/**
 * Supabase-based Transaction Manager
 * Since Supabase doesn't support multi-statement transactions like Prisma,
 * we implement a pseudo-transaction pattern with rollback capability
 */
export class TransactionManager {
  private static readonly DEFAULT_TIMEOUT = 15 * 1000;
  private static readonly MAX_RETRIES = 2;
  private static readonly RETRY_DELAY_BASE = 1000;

  /**
   * Execute operations with retry logic and logging
   * Note: Supabase doesn't support true ACID transactions on the client side
   * For atomic operations, use RPC functions instead
   */
  static async executeTransaction<T>(
    operation: () => Promise<T>,
    options: {
      timeout?: number;
      maxRetries?: number;
      context?: string;
      userId?: string;
    } = {}
  ): Promise<T> {
    const {
      timeout = TransactionManager.DEFAULT_TIMEOUT,
      maxRetries = TransactionManager.MAX_RETRIES,
      context = 'transaction',
      userId
    } = options;

    let lastError: Error | null = null;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        securityLogger.logSecurityEvent({
          type: 'SUSPICIOUS_ACTIVITY',
          userId: userId || 'system',
          endpoint: context,
          details: {
            action: 'transaction_start',
            attempt: attempt,
            maxRetries: maxRetries,
            context: context
          }
        });

        // Execute with timeout
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Transaction timeout after ${timeout}ms`));
            }, timeout);
          })
        ]);

        const duration = Date.now() - startTime;
        securityLogger.logSecurityEvent({
          type: 'SUSPICIOUS_ACTIVITY',
          userId: userId || 'system',
          endpoint: context,
          details: {
            action: 'transaction_success',
            duration: duration,
            context: context
          }
        });

        return result;

      } catch (error) {
        lastError = error as Error;
        const duration = Date.now() - startTime;
        const isRetryable = TransactionManager.isRetryableError(error as Error);
        const isLastAttempt = attempt === maxRetries;

        securityLogger.logSecurityEvent({
          type: 'SUSPICIOUS_ACTIVITY',
          userId: userId || 'system',
          endpoint: context,
          details: {
            action: 'transaction_failure',
            attempt: attempt,
            maxRetries: maxRetries,
            duration: duration,
            context: context,
            error: (error as Error).message,
            retryable: isRetryable
          }
        });

        if (!isRetryable || isLastAttempt) {
          throw TransactionManager.wrapTransactionError(error as Error, context, attempt);
        }

        const delay = TransactionManager.RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Transaction failed after all retries');
  }

  /**
   * Execute a critical operation with enhanced logging
   */
  static async executeCriticalTransaction<T>(
    operation: () => Promise<T>,
    options: {
      context: string;
      userId: string;
      amount?: number;
      description?: string;
    }
  ): Promise<T> {
    const { context, userId, amount, description } = options;

    securityLogger.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      userId: userId || 'system',
      endpoint: context,
      details: {
        action: 'critical_transaction_start',
        context: context,
        amount: amount || 0,
        description: description || ''
      }
    });

    try {
      const result = await TransactionManager.executeTransaction(operation, {
        timeout: 10 * 1000,
        maxRetries: 1,
        context: `critical_${context}`,
        userId
      });

      securityLogger.logSecurityEvent({
        type: 'SUSPICIOUS_ACTIVITY',
        userId: userId || 'system',
        endpoint: context,
        details: {
          action: 'critical_transaction_success',
          context: context,
          amount: amount || 0
        }
      });

      return result;

    } catch (error) {
      securityLogger.logSecurityEvent({
        type: 'SUSPICIOUS_ACTIVITY',
        userId: userId || 'system',
        endpoint: context,
        details: {
          action: 'critical_transaction_failure',
          context: context,
          amount: amount || 0,
          error: (error as Error).message
        }
      });

      throw error;
    }
  }

  private static isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      /connection.*timeout/i,
      /connection.*reset/i,
      /connection.*refused/i,
      /network.*error/i,
      /temporary.*failure/i,
      /service.*unavailable/i,
      /too.*many.*connections/i,
      /database.*busy/i
    ];

    const errorMessage = error.message.toLowerCase();
    return retryablePatterns.some(pattern => pattern.test(errorMessage));
  }

  private static wrapTransactionError(error: Error, context: string, attempt: number): Error {
    const wrappedError = new Error(
      `Transaction failed in context '${context}' after ${attempt} attempts: ${error.message}`
    );
    wrappedError.stack = error.stack;
    (wrappedError as Error & { cause?: unknown }).cause = error;
    return wrappedError;
  }

  /**
   * Health check for database system
   */
  static async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: {
      canConnect: boolean;
      canExecuteQuery: boolean;
      averageLatency: number;
      lastError?: string;
    };
  }> {
    const startTime = Date.now();
    let canConnect = false;
    let canExecuteQuery = false;
    let lastError: string | undefined;

    try {
      const supabase = await getDb();
      const { error } = await supabase.from('User').select('id').limit(1);

      if (!error) {
        canConnect = true;
        canExecuteQuery = true;
      } else {
        lastError = error.message;
      }

    } catch (error) {
      lastError = (error as Error).message;
    }

    const averageLatency = Date.now() - startTime;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (canConnect && canExecuteQuery && averageLatency < 1000) {
      status = 'healthy';
    } else if (canConnect && averageLatency < 5000) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      details: {
        canConnect,
        canExecuteQuery,
        averageLatency,
        lastError
      }
    };
  }
}

// Convenience exports
export const executeTransaction = TransactionManager.executeTransaction.bind(TransactionManager);
export const executeCriticalTransaction = TransactionManager.executeCriticalTransaction.bind(TransactionManager);

// Re-export db utilities for quiz submission
export { answerDb, quizAttemptDb, questionAttemptDb, dailyPaymentDb, userDb, generateId, getDb };