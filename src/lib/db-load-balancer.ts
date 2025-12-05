/**
 * Enhanced Database Connection Manager with Session Expiration Handling
 * Addresses MongoDB Atlas connection timeouts, JWT expiration, and transaction session management
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { getOptimizedDatabaseUrl } from './prisma';
import { securityLogger } from './security-logger';

interface ConnectionConfig {
  maxRetries: number;
  retryDelay: number;
  connectionTimeout: number;
  transactionTimeout: number;
  healthCheckInterval: number;
}

interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

class DatabaseConnectionManager {
  private static instance: DatabaseConnectionManager;
  private prismaClient: PrismaClient;
  private config: ConnectionConfig;
  private healthCheckTimer?: NodeJS.Timeout;
  private connectionAttempts: number = 0;
  private lastHealthCheck: Date = new Date();

  private constructor() {
    this.config = {
      maxRetries: 2, // Reduce retries for faster response
      retryDelay: 500, // Reduce delay to 500ms
      connectionTimeout: 10000, // 10 seconds
      transactionTimeout: 8000, // 8 seconds for transactions
      healthCheckInterval: 30000, // 30 seconds
    };

    this.prismaClient = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      datasources: {
        db: {
          url: getOptimizedDatabaseUrl(),
        },
      },
    });

    this.setupHealthCheck();
    this.setupGracefulShutdown();
  }

  public static getInstance(): DatabaseConnectionManager {
    if (!DatabaseConnectionManager.instance) {
      DatabaseConnectionManager.instance = new DatabaseConnectionManager();
    }
    return DatabaseConnectionManager.instance;
  }

  /**
   * Get Prisma client with automatic reconnection handling
   */
  public async getClient(): Promise<PrismaClient> {
    try {
      // Test connection with a simple query
      await this.prismaClient.user.findFirst({ take: 1 });
      return this.prismaClient;
    } catch (error) {
      console.error('Database connection test failed:', error);
      return await this.reconnect();
    }
  }

  /**
   * Execute database operation with retry logic for connection failures
   */
  public async executeWithRetry<T>(
    operation: (client: PrismaClient) => Promise<T>,
    context: string = 'database_operation'
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const client = await this.getClient();
        const result = await operation(client);
        
        // Reset connection attempts on success
        this.connectionAttempts = 0;
        return result;
        
      } catch (error) {
        lastError = error as Error;
        
        // Log the attempt
        securityLogger.logSuspiciousActivity(
          undefined,
          context,
          `Database operation failed (attempt ${attempt}/${this.config.maxRetries}): ${error}`,
        );

        // Check if it's a connection-related error
        if (this.isConnectionError(error)) {
          if (attempt < this.config.maxRetries) {
            console.log(`Retrying database operation in ${this.config.retryDelay}ms...`);
            await this.delay(this.config.retryDelay * attempt); // Exponential backoff
            continue;
          }
        }
        
        // If not a connection error or max retries reached, throw immediately
        throw error;
      }
    }
    
    throw lastError!;
  }

  /**
   * Execute transaction with proper session expiration handling
   * MongoDB transactions have a default session timeout of ~30 minutes
   */
  public async executeTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options: TransactionOptions = {},
    context: string = 'transaction'
  ): Promise<T> {
    // Use the correct type for Prisma transaction options
    const transactionOptions = {
      maxWait: options.maxWait || 5000, // 5 seconds max wait
      timeout: options.timeout || this.config.transactionTimeout, // 8 seconds timeout
      // Remove isolationLevel for MongoDB compatibility
    };

    return await this.executeWithRetry(async (client) => {
      try {
        console.log(`Starting transaction: ${context}`);
        const startTime = Date.now();
        
        const result = await client.$transaction(async (tx) => {
          // Check if we're approaching timeout
          const elapsed = Date.now() - startTime;
          if (elapsed > transactionOptions.timeout! * 0.8) {
            throw new Error(`Transaction timeout approaching: ${elapsed}ms elapsed`);
          }
          
          return await operation(tx);
        }, transactionOptions);
        
        const duration = Date.now() - startTime;
        console.log(`Transaction completed: ${context} (${duration}ms)`);
        
        return result;
        
      } catch (error) {
        console.error(`Transaction failed: ${context}`, error);
        
        // Log transaction failures for monitoring
        securityLogger.logSuspiciousActivity(
          undefined,
          context,
          `Transaction failed: ${error}`,
        );
        
        // Handle specific MongoDB transaction errors
        if (error instanceof Error) {
          if (error.message.includes('P2026') || error.message.includes('isolation levels')) {
            throw new Error('Database transaction failed due to configuration issue. Please try again.');
          }
          if (error.message.includes('timeout') || error.message.includes('took too long')) {
            throw new Error('The operation took too long to complete. Please try again.');
          }
        }
        
        // Handle specific transaction errors
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2034') {
            throw new Error('Transaction conflict detected - please retry');
          }
          if (error.code === 'P2028') {
            throw new Error('Transaction API error - session may have expired');
          }
        }
        
        throw error;
      }
    }, context);
  }

  /**
   * Setup periodic health checks to detect connection issues early
   */
  private setupHealthCheck(): void {
    if (process.env.NODE_ENV === 'production') {
      this.healthCheckTimer = setInterval(async () => {
        try {
          await this.prismaClient.user.findFirst({ take: 1 });
          this.lastHealthCheck = new Date();
        } catch (error) {
          console.error('Database health check failed:', error);
          this.connectionAttempts++;
          
          // If multiple health checks fail, attempt reconnection
          if (this.connectionAttempts >= 3) {
            console.log('Multiple health checks failed, attempting reconnection...');
            await this.reconnect();
          }
        }
      }, this.config.healthCheckInterval);
      
      console.log('Database health check enabled');
    }
  }

  /**
   * Attempt to reconnect to the database
   */
  private async reconnect(): Promise<PrismaClient> {
    try {
      console.log('Attempting database reconnection...');
      
      // Disconnect existing client
      await this.prismaClient.$disconnect();
      
      // Create new client instance
      this.prismaClient = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        datasources: {
          db: {
            url: getOptimizedDatabaseUrl(),
          },
        },
      });
      
      // Test the new connection
      await this.prismaClient.user.findFirst({ take: 1 });
      
      console.log('Database reconnection successful');
      this.connectionAttempts = 0;
      
      return this.prismaClient;
      
    } catch (error) {
      console.error('Database reconnection failed:', error);
      this.connectionAttempts++;
      throw error;
    }
  }

  /**
   * Check if error is connection-related and should trigger retry
   */
  private isConnectionError(error: Error | Prisma.PrismaClientInitializationError | Prisma.PrismaClientUnknownRequestError | unknown): boolean {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return true;
    }
    
    if (error instanceof Prisma.PrismaClientUnknownRequestError) {
      return true;
    }
    
    // Check for common connection error messages
    const errorMessage = (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') 
      ? error.message.toLowerCase() 
      : '';
    const connectionErrors = [
      'connection',
      'timeout',
      'network',
      'econnrefused',
      'enotfound',
      'etimedout',
      'socket',
      'ssl',
      'tls'
    ];
    
    return connectionErrors.some(keyword => errorMessage.includes(keyword));
  }

  /**
   * Utility function for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Setup graceful shutdown handling
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      console.log('Shutting down database connections...');
      
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
      }
      
      try {
        await this.prismaClient.$disconnect();
        console.log('Database connections closed successfully');
      } catch (error) {
        console.error('Error during database shutdown:', error);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('beforeExit', shutdown);
  }

  /**
   * Get connection health status
   */
  public getHealthStatus(): {
    isHealthy: boolean;
    lastHealthCheck: Date;
    connectionAttempts: number;
  } {
    const timeSinceLastCheck = Date.now() - this.lastHealthCheck.getTime();
    const isHealthy = timeSinceLastCheck < this.config.healthCheckInterval * 2 && this.connectionAttempts < 3;
    
    return {
      isHealthy,
      lastHealthCheck: this.lastHealthCheck,
      connectionAttempts: this.connectionAttempts,
    };
  }
}

// Export singleton instance
export const dbManager = DatabaseConnectionManager.getInstance();

// Export enhanced prisma client with retry logic
export const enhancedPrisma = {
  // Standard operations with retry
  async query<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T> {
    return dbManager.executeWithRetry(operation, 'query');
  },
  
  // Transaction operations with session management
  async transaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    return dbManager.executeTransaction(operation, options, 'transaction');
  },
  
  // Get raw client (use with caution)
  async getClient(): Promise<PrismaClient> {
    return dbManager.getClient();
  },
  
  // Health check
  getHealth() {
    return dbManager.getHealthStatus();
  }
};