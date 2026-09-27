import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getFraudAlerts } from '@/actions/security-actions';
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
        endpoint: '/api/admin/security/fraud-alerts',
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
        endpoint: '/api/admin/security/fraud-alerts',
        details: {
          reason: 'Non-admin user attempted to access security fraud alerts',
          userRole: session?.user?.isAdmin ? 'admin' : 'user'
        },
        severity: 'HIGH'
      });

      return createSecureJsonResponse(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Fetch fraud alerts
    const alerts = await getFraudAlerts();

    return createSecureJsonResponse({ alerts }, { status: 200 });

  } catch (error) {
    console.error('Error fetching fraud alerts:', error);

    await securityLogger.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      userId: 'system',
      endpoint: '/api/admin/security/fraud-alerts',
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
