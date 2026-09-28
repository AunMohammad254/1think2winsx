import { NextRequest, NextResponse } from 'next/server';
import { generateCSRFToken } from '@/lib/csrf-protection';
import { securityLogger } from '@/lib/security-logger';
import { createSecureJsonResponse } from '@/lib/security-headers';

/**
 * CSRF Token API Endpoint
 *
 * The token itself is a double-submit style custom header; the actual CSRF defence
 * is enforced in validateCSRFToken() (Origin/Host match + mandatory custom header +
 * session cookie). Issuing a token therefore only requires that a session cookie is
 * present — this endpoint no longer hits Supabase Auth or the database, which matters
 * because the client fetches a fresh token before every mutation.
 */
export async function GET(request: NextRequest) {
  try {
    // Allow public access to generate CSRF token for registration/newsletter forms

    const csrfToken = generateCSRFToken();
    return createSecureJsonResponse(
      { csrfToken, expiresAt: Date.now() + 60 * 60 * 1000 },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error generating CSRF token:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
