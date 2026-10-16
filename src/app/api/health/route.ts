import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { TransactionManager } from '@/lib/transaction-manager';
import { securityLogger } from '@/lib/security-logger';
import { getAdminDb } from '@/lib/supabase/db';
import { securityMonitor } from '@/lib/security-monitoring';
import { getLoadStats } from '@/lib/load-shed';
import { describeClientIpHeaders } from '@/lib/client-ip';

/**
 * Health endpoint.
 *
 * GET /api/health              public liveness probe. NO database access and nothing sensitive:
 *                              Docker, uptime monitors and the hosting platform hit this every few
 *                              seconds, and it used to run 3 database queries (including a
 *                              `count: exact` over the whole User table) per hit, on an
 *                              unauthenticated route, while leaking memory/env details.
 * GET /api/health?stats=1      process stats (event-loop lag, in-flight requests, memory). No DB.
 * GET /api/health?deep=1       full report incl. database round-trips.
 *   The last two require `Authorization: Bearer <CRON_SECRET>`; scripts/loadtest polls ?stats=1.
 */

function hasValidSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const wantsDeep = params.get('deep') === '1';
  const wantsStats = params.get('stats') === '1';

  if (!wantsDeep && !wantsStats) {
    return NextResponse.json(
      { status: 'ok', timestamp: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!hasValidSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  if (!wantsDeep) {
    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        load: getLoadStats(),
        // What this server received for the visitor's IP, and which value it would use. Lets you pick
        // TRUSTED_PROXY_HOPS / TRUSTED_IP_HEADER with one curl (see load-test/README.md).
        client: describeClientIpHeaders(request.headers),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return deepHealth();
}

async function deepHealth() {
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
          canExecuteQuery: false,
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
      load: getLoadStats(),
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
 * Check database connection health using Supabase
 */
async function checkDatabaseHealth() {
  const startTime = Date.now();

  try {
    // Service role: RLS blocks anon/user reads of "User" since the security migration
    const supabase = getAdminDb();

    // Test basic connectivity
    const { error: readError } = await supabase
      .from('User')
      .select('id')
      .limit(1);

    if (readError) throw readError;

    const latency = Date.now() - startTime;

    return {
      status: latency < 1000 ? 'healthy' as const :
        latency < 3000 ? 'degraded' as const : 'unhealthy' as const,
      latency,
      connectionPool: {
        active: 'supabase',
        idle: 'managed',
        total: 'serverless'
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
    // Only report whether configuration is present — never echo values
    const authConfig = {
      nextAuthUrl: process.env.NEXTAUTH_URL ? '[SET]' : '[NOT SET]',
      nextAuthSecret: process.env.NEXTAUTH_SECRET ? '[SET]' : '[NOT SET]',
      adminEmails: process.env.ADMIN_EMAILS ? '[SET]' : '[NOT SET]'
    };

    const missingConfig = Object.entries(authConfig)
      .filter(([_key, value]) => value === '[NOT SET]')
      .map(([key]) => key);

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
