import { NextRequest, NextResponse } from 'next/server';
import { newsletterDb } from '@/lib/supabase/db';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';

export async function POST(request: NextRequest) {
  try {
    // Enforce CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Email is required.' },
        { status: 400 }
      );
    }

    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { success: false, message: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }

    const result = await newsletterDb.subscribeEmail(email.trim().toLowerCase());

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 500 }
      );
    }

    return createSecureJsonResponse({
      success: true,
      message: result.message
    }, { status: 200 });
  } catch (error: any) {
    console.error('Error in newsletter subscribe endpoint:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error.' },
      { status: 500 }
    );
  }
}
