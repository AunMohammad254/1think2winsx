import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { validateAdminSession } from '@/lib/admin-session';
import { generateCSRFToken } from '@/lib/csrf-protection';
import { securityLogger } from '@/lib/security-logger';
import { createSecureJsonResponse } from '@/lib/security-headers';

/**
 * CSRF Token API Endpoint
 * Provides CSRF tokens for authenticated users and admins
 */

export async function GET(request: NextRequest) {
  try {
    // Check for user authentication (Supabase)
    const session = await auth();

    // Check for admin session authentication
    const adminSession = await validateAdminSession();

    // Allow access if either user is authenticated OR admin is authenticated
    if (!session?.user?.id && !adminSession.valid) {
      securityLogger.logUnauthorizedAccess(
        undefined,
        '/api/csrf-token',
        request
      );

      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Use user ID if available, otherwise use admin email as identifier
    const userId = session?.user?.id || `admin:${adminSession.email}`;

    // Generate CSRF token
    const csrfToken = generateCSRFToken();

    return createSecureJsonResponse(
      {
        csrfToken,
        expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour expiration
      },
      { status: 200 }
    );

  } catch (error) {
    console.error('Error generating CSRF token:', error);

    securityLogger.logSystemError(
      undefined,
      '/api/csrf-token',
      error instanceof Error ? error : new Error('CSRF token generation failed'),
      request
    );

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
