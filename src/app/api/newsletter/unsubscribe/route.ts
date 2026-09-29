import { NextRequest, NextResponse } from 'next/server';
import { newsletterDb } from '@/lib/supabase/db';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { verifyUnsubscribeToken } from '@/lib/newsletter-unsubscribe';

/**
 * POST /api/newsletter/unsubscribe?e=<email>&t=<token>
 *
 * Called by the /unsubscribe confirmation page and by mail providers for RFC 8058
 * one-click unsubscribe (form body "List-Unsubscribe=One-Click"). No CSRF token: the
 * signed token is the authorisation, and the only thing it can do is remove that
 * one address from the list.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await applyRateLimit(rateLimiters.general, request, undefined, '/api/newsletter/unsubscribe');
    if (rateLimitResponse) return rateLimitResponse;

    const { searchParams } = new URL(request.url);
    let email = searchParams.get('e');
    let token = searchParams.get('t');

    // The confirmation page may send them in a JSON body instead
    if ((!email || !token) && request.headers.get('content-type')?.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      email = typeof body.e === 'string' ? body.e : email;
      token = typeof body.t === 'string' ? body.t : token;
    }

    if (!email || !token || !verifyUnsubscribeToken(email, token)) {
      return NextResponse.json(
        { success: false, message: 'This unsubscribe link is invalid or incomplete.' },
        { status: 400 }
      );
    }

    const removed = await newsletterDb.unsubscribeEmail(email.trim().toLowerCase());
    if (!removed) {
      return NextResponse.json(
        { success: false, message: 'Could not unsubscribe right now. Please try again later.' },
        { status: 500 }
      );
    }

    // Idempotent: an address that was already removed still gets success
    return createSecureJsonResponse({
      success: true,
      message: 'You have been unsubscribed from the 1Think 2Win newsletter.'
    }, { status: 200 });
  } catch (error) {
    console.error('Error in newsletter unsubscribe endpoint:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error.' },
      { status: 500 }
    );
  }
}
