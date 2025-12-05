import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateCSRFToken } from '@/lib/csrf-protection';
import { securityLogger } from '@/lib/security-logger';
import { createSecureJsonResponse } from '@/lib/security-headers';

/**
 * CSRF Token API Endpoint
 * Provides CSRF tokens for authenticated users
 */

export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await auth();
    
    if (!session?.user?.id) {
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

    // Generate CSRF token
    const csrfToken = generateCSRFToken();
    
    // Log successful token generation
    console.log(`CSRF token generated for user: ${session.user.id}`);
    
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
