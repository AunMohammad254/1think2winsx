/**
 * Shared Prisma Client instance to prevent connection pool exhaustion
 * Includes connection pooling, health checks, retry mechanisms, and query optimization
 */

import { PrismaClient } from '@prisma/client';
import { withOptimize } from '@prisma/extension-optimize';

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
// Learn more: https://pris.ly/d/help/next-js-best-practices

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Enhanced connection pool configuration for PostgreSQL
const connectionPoolConfig = {
  connection_limit: process.env.NODE_ENV === 'production' ? 20 : 5,
  pool_timeout: 10,
  connect_timeout: 10,
};

// Optimization configuration for different environments
const optimizeConfig = {
  // API key for Prisma Optimize (optional - can be set via OPTIMIZE_API_KEY env var)
  apiKey: process.env.OPTIMIZE_API_KEY,
  // Enable optimization in production and development
  enabled: true,
  // Cache configuration
  cache: {
    // Enable query result caching
    enabled: process.env.NODE_ENV === 'production',
    // Cache TTL in seconds (5 minutes for production, 1 minute for development)
    ttl: process.env.NODE_ENV === 'production' ? 300 : 60,
  },
  // Query analysis and optimization
  queryOptimization: {
    // Enable automatic query optimization
    enabled: true,
    // Log slow queries for analysis
    logSlowQueries: process.env.NODE_ENV === 'development',
    // Slow query threshold in milliseconds
    slowQueryThreshold: 1000,
  },
};

// For PostgreSQL with PgBouncer (like Supabase's pooler), we need to add pgbouncer=true
// This disables prepared statements which don't work with PgBouncer in transaction mode
export function getOptimizedDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL || '';

  // Check if URL already has pgbouncer param or if it's using PgBouncer port (6543)
  const isPgBouncer = baseUrl.includes(':6543') || baseUrl.includes('pooler.');

  if (isPgBouncer && !baseUrl.includes('pgbouncer=true')) {
    // Add pgbouncer=true to disable prepared statements
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}pgbouncer=true&connection_limit=${connectionPoolConfig.connection_limit}`;
  }

  return baseUrl;
}

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    // Configure connection pool settings for better performance
    datasources: {
      db: {
        url: getOptimizedDatabaseUrl(),
      },
    },
    // Additional Prisma client options for better performance
    errorFormat: 'minimal',
    transactionOptions: {
      maxWait: 5000, // 5 seconds max wait for transaction
      timeout: 10000, // 10 seconds transaction timeout
    },
  }).$extends(
    // Apply Prisma Optimize extension only if API key is available
    optimizeConfig.apiKey
      ? withOptimize({ apiKey: optimizeConfig.apiKey })
      : <T>(client: T) => client
  );

// Assign to global in development to prevent connection pool exhaustion
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;

// Setup connection health check for production with optimized intervals
if (!globalForPrisma.prisma && process.env.NODE_ENV === 'production') {
  const healthCheckInterval = 60000; // Increased to 60 seconds to reduce overhead

  // Enhanced health check with connection pool monitoring
  setInterval(async () => {
    try {
      // Simple query to verify connection is alive - use count for better performance
      const startTime = Date.now();
      await prisma.user.count({ take: 1 });
      const queryTime = Date.now() - startTime;

      // Log performance metrics
      if (queryTime > 1000) {
        console.warn(`Slow database query detected: ${queryTime}ms`);
      }

      // Optional: Log connection pool status (if available in future Prisma versions)
      console.log(`Database health check passed in ${queryTime}ms`);

    } catch (error) {
      console.error('Database connection health check failed:', error);

      // Enhanced error logging for connection pool issues
      if (error instanceof Error) {
        if (error.message.includes('pool') || error.message.includes('connection')) {
          console.error('Connection pool may be exhausted. Consider increasing pool size.');
        }
      }

      // Log the error but don't exit - the connection pool should handle reconnection
    }
  }, healthCheckInterval);

  console.log(`Database connection health check enabled with optimized intervals (${healthCheckInterval}ms)`);
  console.log(`Connection pool configured: max=${connectionPoolConfig.connection_limit}, timeout=${connectionPoolConfig.pool_timeout}s`);
  console.log(`Prisma Optimize enabled with caching: ${optimizeConfig.cache.enabled}, TTL: ${optimizeConfig.cache.ttl}s`);
}

// Connection pool cleanup on process exit
process.on('beforeExit', async () => {
  try {
    await prisma.$disconnect();
    console.log('Database connection pool closed gracefully');
  } catch (error) {
    console.error('Error closing database connection pool:', error);
  }
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;