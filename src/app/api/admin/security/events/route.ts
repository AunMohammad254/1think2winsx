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
        endpoint: '/api/admin/security/events',
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
        endpoint: '/api/admin/security/events',
        details: {
          reason: 'Non-admin user attempted to access security events',
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
    const severity = searchParams.get('severity') || 'ALL';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

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

    // Build query
    let query = supabase
      .from('SecurityEvent')
      .select('*', { count: 'exact' })
      .gte('timestamp', startTime.toISOString())
      .lte('timestamp', now.toISOString())
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (severity !== 'ALL') {
      query = query.eq('severity', severity);
    }

    const { data: events, count: totalCount, error } = await query;

    if (error) throw error;

    const response = {
      events: events || [],
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        hasMore: offset + limit < (totalCount || 0)
      },
      filters: {
        timeframe,
        severity
      },
      generatedAt: new Date().toISOString()
    };

    return createSecureJsonResponse(response, { status: 200 });

  } catch (error) {
    console.error('Error fetching security events:', error);

    await securityLogger.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      userId: 'system',
      endpoint: '/api/admin/security/events',
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
