import { Prisma } from '@prisma/client';
import { securityLogger } from './security-logger';
import { enhancedPrisma } from './db-load-balancer';

/**
 * Transaction session expiration and rollback manager
 * Handles MongoDB transaction sessions with automatic expiration detection and rollback
 */
export class TransactionManager {
  private static readonly DEFAULT_TIMEOUT = 15 * 1000; // 15 seconds for better user experience
  private static readonly MAX_RETRIES = 2; // Reduce retries for faster failure detection
  private static readonly RETRY_DELAY_BASE = 1000; // 1 second base delay

  /**
   * Execute a transaction with automatic session expiration handling and rollback
   */
  static async executeTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
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
        // Log transaction start
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

        // Execute transaction with timeout
        const result = await Promise.race([
          enhancedPrisma.transaction(async (tx: Prisma.TransactionClient) => {
            const txStartTime = Date.now();
            
            // Check if we're approaching timeout during execution
            const checkTimeout = () => {
              const elapsed = Date.now() - txStartTime;
              if (elapsed > timeout * 0.9) { // 90% of timeout
                throw new Error(`Transaction approaching timeout limit (${elapsed}ms/${timeout}ms)`);
              }
            };

            // Set up periodic timeout checks
            const timeoutChecker = setInterval(checkTimeout, 5000); // Check every 5 seconds
            
            try {
              const operationResult = await operation(tx);
              clearInterval(timeoutChecker);
              return operationResult;
            } catch (error) {
              clearInterval(timeoutChecker);
              throw error;
            }
          }, {
            timeout
            // Remove isolationLevel for MongoDB compatibility
          }),
          
          // Timeout promise
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Transaction timeout after ${timeout}ms`));
            }, timeout);
          })
        ]);

        // Log successful transaction
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
        
        // Determine if this is a retryable error
        const isRetryable = TransactionManager.isRetryableError(error as Error);
        const isLastAttempt = attempt === maxRetries;

        // Log transaction failure
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

        // If it's not retryable or last attempt, throw immediately
        if (!isRetryable || isLastAttempt) {
          throw TransactionManager.wrapTransactionError(error as Error, context, attempt);
        }

        // Wait before retry with exponential backoff
        const delay = TransactionManager.RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Log retry attempt
        securityLogger.logSecurityEvent({
          type: 'SUSPICIOUS_ACTIVITY',
          userId: userId || 'system',
          endpoint: context,
          details: { 
            action: 'transaction_retry',
            delay: delay,
            context: context
          }
        });
      }
    }

    // This should never be reached, but just in case
    throw lastError || new Error('Transaction failed after all retries');
  }

  /**
   * Execute a critical financial transaction with enhanced safety measures
   */
  static async executeCriticalTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options: {
      context: string;
      userId: string;
      amount?: number;
      description?: string;
    }
  ): Promise<T> {
    const { context, userId, amount, description } = options;

    // Log critical transaction start
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
        timeout: 10 * 1000, // 10 seconds for critical operations
        maxRetries: 1, // Single retry for critical operations
        context: `critical_${context}`,
        userId
      });

      // Log critical transaction success
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
      // Log critical transaction failure
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

  /**
   * Check if an error is retryable
   */
  private static isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      /connection.*timeout/i,
      /connection.*reset/i,
      /connection.*refused/i,
      /session.*expired/i,
      /transaction.*timeout/i,
      /network.*error/i,
      /temporary.*failure/i,
      /service.*unavailable/i,
      /too.*many.*connections/i,
      /database.*busy/i
    ];

    const errorMessage = error.message.toLowerCase();
    return retryablePatterns.some(pattern => pattern.test(errorMessage));
  }

  /**
   * Wrap transaction errors with additional context
   */
  private static wrapTransactionError(error: Error, context: string, attempt: number): Error {
    const wrappedError = new Error(
      `Transaction failed in context '${context}' after ${attempt} attempts: ${error.message}`
    );
    
    // Preserve original stack trace
    wrappedError.stack = error.stack;
    // Use type assertion for cause property since it's not available in ES2018
    (wrappedError as Error & { cause?: unknown }).cause = error;
    
    return wrappedError;
  }

  /**
   * Health check for transaction system
   */
  static async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: {
      canConnect: boolean;
      canExecuteTransaction: boolean;
      averageLatency: number;
      lastError?: string;
    };
  }> {
    const startTime = Date.now();
    let canConnect = false;
    let canExecuteTransaction = false;
    let lastError: string | undefined;

    try {
      // Test basic connection
      const client = await enhancedPrisma.getClient();
      await client.user.findFirst({ take: 1 });
      canConnect = true;

      // Test transaction capability
      await TransactionManager.executeTransaction(async (tx) => {
        // Transaction health check - basic query
        await tx.user.findFirst({ take: 1 });
        return true;
      }, {
        timeout: 5000, // 5 second timeout for health check
        maxRetries: 1,
        context: 'health_check'
      });
      canExecuteTransaction = true;

    } catch (error) {
      lastError = (error as Error).message;
    }

    const averageLatency = Date.now() - startTime;
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (canConnect && canExecuteTransaction && averageLatency < 1000) {
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
        canExecuteTransaction,
        averageLatency,
        lastError
      }
    };
  }
}

/**
 * Convenience function for executing transactions
 */
export const executeTransaction = TransactionManager.executeTransaction;
export const executeCriticalTransaction = TransactionManager.executeCriticalTransaction;