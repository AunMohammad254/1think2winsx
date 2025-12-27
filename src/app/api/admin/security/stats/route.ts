import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/supabase/db';
import { securityLogger } from '@/lib/security-logger';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { createSecureJsonResponse } from '@/lib/security-headers';

export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResponse = await applyRateLimit(rateLimiters.admin, request);
    if (rateLimitResponse) {
      await securityLogger.logSecurityEvent({
        type: 'RATE_LIMIT_EXCEEDED',
        userId: 'unknown',
        endpoint: '/api/admin/security/stats',
        details: {
          rateLimiter: 'admin',
          limit: rateLimiters.admin.maxRequests,
          window: rateLimiters.admin.windowMs
        },
        severity: 'MEDIUM'
      });

      return rateLimitResponse;
    }

    // Check authentication and admin privileges
    const session = await auth();
    if (!session?.user?.isAdmin) {
      await securityLogger.logSecurityEvent({
        type: 'UNAUTHORIZED_ACCESS',
        userId: session?.user?.id || 'anonymous',
        endpoint: '/api/admin/security/stats',
        details: {
          reason: 'Non-admin user attempted to access security stats',
          userRole: session?.user?.isAdmin ? 'admin' : 'user'
        },
        severity: 'HIGH'
      });

      return createSecureJsonResponse(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const timeframe = searchParams.get('timeframe') || '24h';

    // Calculate time range
    const now = new Date();
    let startTime: Date;

    switch (timeframe) {
      case '1h':
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    const supabase = await getDb();

    // Get security events from the database
    const { data: securityEvents, error } = await supabase
      .from('SecurityEvent')
      .select('*')
      .gte('timestamp', startTime.toISOString())
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (error) throw error;

    const events = securityEvents || [];

    // Calculate statistics
    const totalEvents = events.length;

    const eventsByType = events.reduce((acc: Record<string, number>, event: any) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {});

    const eventsBySeverity = events.reduce((acc: Record<string, number>, event: any) => {
      if (event.severity) {
        acc[event.severity] = (acc[event.severity] || 0) + 1;
      }
      return acc;
    }, {});

    const endpointCounts = events.reduce((acc: Record<string, number>, event: any) => {
      if (event.endpoint) {
        acc[event.endpoint] = (acc[event.endpoint] || 0) + 1;
      }
      return acc;
    }, {});

    const topEndpoints = Object.entries(endpointCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([endpoint, count]) => ({ endpoint, count }));

    const rateLimitViolations = events.filter((e: any) => e.type === 'RATE_LIMIT_EXCEEDED').length;
    const authenticationFailures = events.filter((e: any) => e.type === 'AUTHENTICATION_FAILURE').length;
    const suspiciousActivities = events.filter((e: any) => e.type === 'SUSPICIOUS_ACTIVITY').length;

    const recentEvents = events.slice(0, 20);

    const stats = {
      totalEvents,
      eventsByType,
      eventsBySeverity,
      topEndpoints,
      rateLimitViolations,
      authenticationFailures,
      suspiciousActivities,
      recentEvents,
      timeframe,
      generatedAt: new Date().toISOString()
    };

    return createSecureJsonResponse(stats, { status: 200 });

  } catch (error) {
    console.error('Error fetching security stats:', error);

    await securityLogger.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      userId: 'system',
      endpoint: '/api/admin/security/stats',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        ...(error instanceof Error && error.stack && { stack: error.stack })
      },
      severity: 'HIGH'
    });

    return createSecureJsonResponse(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
