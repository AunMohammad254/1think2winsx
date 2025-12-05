import { NextResponse } from 'next/server';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { TransactionManager } from '@/lib/transaction-manager';
import { securityLogger } from '@/lib/security-logger';
import { enhancedPrisma } from '@/lib/db-load-balancer';
import { securityMonitor } from '@/lib/security-monitoring';

/**
 * Health check endpoint for monitoring database connections and transaction system
 * GET /api/health
 */
export async function GET() {
  const startTime = Date.now();
  
  try {
    // Perform comprehensive health checks
    const [transactionHealth, dbHealth] = await Promise.allSettled([
      TransactionManager.healthCheck(),
      checkDatabaseHealth()
    ]);

    const responseTime = Date.now() - startTime;
    
    // Process transaction health results
    const txHealth = transactionHealth.status === 'fulfilled' 
      ? transactionHealth.value 
      : {
          status: 'unhealthy' as const,
          details: {
            canConnect: false,
            canExecuteTransaction: false,
            averageLatency: 0,
            lastError: transactionHealth.reason?.message || 'Unknown error'
          }
        };

    // Process database health results
    const databaseHealth = dbHealth.status === 'fulfilled'
      ? dbHealth.value
      : {
          status: 'unhealthy' as const,
          connectionPool: { active: 0, idle: 0, total: 0 },
          lastError: dbHealth.reason?.message || 'Unknown error'
        };

    // Determine overall system health
    const overallStatus = determineOverallHealth(txHealth.status, databaseHealth.status);
    
    // Log health check results
    securityLogger.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      userId: 'system',
      endpoint: '/api/health',
      details: {
        action: 'health_check',
        overallStatus: overallStatus,
        responseTime: responseTime
      }
    });

    const healthReport = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTime,
      components: {
        transactions: txHealth,
        database: databaseHealth,
        authentication: await checkAuthHealth()
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version
      },
      performance: securityMonitor.getPerfSummary()
    };

    // Return appropriate HTTP status based on health
    const httpStatus = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 200 : 503;

    return createSecureJsonResponse(healthReport, { status: httpStatus });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    securityLogger.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      userId: 'system',
      endpoint: '/api/health',
      details: {
        action: 'health_check_failure',
        responseTime: responseTime,
        error: error instanceof Error ? error.message : String(error)
      }
    });

    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        responseTime,
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 503 }
    );
  }
}

/**
 * Check database connection health
 */
async function checkDatabaseHealth() {
  const startTime = Date.now();
  
  try {
    // Test basic connectivity
    const client = await enhancedPrisma.getClient();
    await client.user.findFirst({ take: 1 });
    
    // Test read capability
    await client.user.count();
    
    const latency = Date.now() - startTime;
    
    return {
      status: latency < 1000 ? 'healthy' as const : 
              latency < 3000 ? 'degraded' as const : 'unhealthy' as const,
      latency,
      connectionPool: {
        // Note: Prisma doesn't expose connection pool stats directly
        // This is a placeholder for monitoring purposes
        active: 'unknown',
        idle: 'unknown',
        total: 'unknown'
      }
    };
    
  } catch (error) {
    return {
      status: 'unhealthy' as const,
      latency: Date.now() - startTime,
      connectionPool: { active: 0, idle: 0, total: 0 },
      lastError: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check authentication system health
 */
async function checkAuthHealth() {
  try {
    // Check if auth configuration is valid
    const authConfig = {
      nextAuthUrl: process.env.NEXTAUTH_URL,
      nextAuthSecret: process.env.NEXTAUTH_SECRET ? '[SET]' : '[NOT SET]',
      adminEmails: process.env.ADMIN_EMAILS ? '[SET]' : '[NOT SET]'
    };
    
    const missingConfig = Object.entries(authConfig)
      .filter(([_key, value]) => value === '[NOT SET]')
      .map(([_key]) => _key);
    
    return {
      status: missingConfig.length === 0 ? 'healthy' as const : 'degraded' as const,
      configuration: authConfig,
      missingConfig: missingConfig.length > 0 ? missingConfig : undefined
    };
    
  } catch (error) {
    return {
      status: 'unhealthy' as const,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Determine overall system health based on component health
 */
function determineOverallHealth(
  transactionStatus: 'healthy' | 'degraded' | 'unhealthy',
  databaseStatus: 'healthy' | 'degraded' | 'unhealthy'
): 'healthy' | 'degraded' | 'unhealthy' {
  // If any critical component is unhealthy, system is unhealthy
  if (transactionStatus === 'unhealthy' || databaseStatus === 'unhealthy') {
    return 'unhealthy';
  }
  
  // If any component is degraded, system is degraded
  if (transactionStatus === 'degraded' || databaseStatus === 'degraded') {
    return 'degraded';
  }
  
  // All components healthy
  return 'healthy';
}
