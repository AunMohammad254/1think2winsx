import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { newsletterDb } from '@/lib/supabase/db';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';

export async function GET(request: NextRequest) {
  try {
    // 1. Enforce CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    // 2. Validate admin session
    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized. Admin session required.' },
        { status: 401 }
      );
    }

    // 3. Fetch all newsletter subscribers
    const subscribers = await newsletterDb.getSubscribers();

    return createSecureJsonResponse({
      success: true,
      subscribers,
      count: subscribers.length
    }, { status: 200 });
  } catch (error: any) {
    console.error('Error in admin newsletter subscribers endpoint:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 1. Enforce CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    // 2. Validate admin session
    const adminSession = await validateAdminSession();
    if (!adminSession.valid || !adminSession.email) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized. Admin session required.' },
        { status: 401 }
      );
    }

    // 3. Parse request body
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, message: 'Email is required.' },
        { status: 400 }
      );
    }

    // 4. Delete subscriber
    const success = await newsletterDb.unsubscribeEmail(email);

    if (!success) {
      return NextResponse.json(
        { success: false, message: 'Failed to delete subscriber.' },
        { status: 500 }
      );
    }

    return createSecureJsonResponse({
      success: true,
      message: 'Subscriber successfully removed.'
    }, { status: 200 });
  } catch (error: any) {
    console.error('Error in delete subscriber endpoint:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error.' },
      { status: 500 }
    );
  }
}
