import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
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

    // Get security events from the database
    const securityEvents = await prisma.securityEvent.findMany({
      where: {
        timestamp: {
          gte: startTime
        }
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 1000 // Limit to prevent performance issues
    });

    // Calculate statistics
    const totalEvents = securityEvents.length;
    
    const eventsByType = securityEvents.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const eventsBySeverity = securityEvents.reduce((acc, event) => {
      if (event.severity) {
        acc[event.severity] = (acc[event.severity] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const endpointCounts = securityEvents.reduce((acc, event) => {
      if (event.endpoint) {
        acc[event.endpoint] = (acc[event.endpoint] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const topEndpoints = Object.entries(endpointCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([endpoint, count]) => ({ endpoint, count }));

    const rateLimitViolations = securityEvents.filter(e => e.type === 'RATE_LIMIT_EXCEEDED').length;
    const authenticationFailures = securityEvents.filter(e => e.type === 'AUTHENTICATION_FAILURE').length;
    const suspiciousActivities = securityEvents.filter(e => e.type === 'SUSPICIOUS_ACTIVITY').length;

    const recentEvents = securityEvents.slice(0, 20);

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
