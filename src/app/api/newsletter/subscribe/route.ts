import { NextRequest, NextResponse } from 'next/server';
import { newsletterDb } from '@/lib/supabase/db';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { applyRateLimit, rateLimiters } from '@/lib/rate-limiter';

export async function POST(request: NextRequest) {
  try {
    // Enforce CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) return csrfValidation;

    // Each new sign-up sends an email, so cap sign-ups per IP
    const limited = await applyRateLimit(rateLimiters.newsletter, request);
    if (limited) return limited;

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

    const normalizedEmail = email.trim().toLowerCase();
    const result = await newsletterDb.subscribeEmail(normalizedEmail);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 500 }
      );
    }

    // One confirmation email, only for a brand-new subscription (never on repeats). A failed send
    // must not fail the sign-up itself, so it is logged and the subscription still succeeds.
    let message = result.message;
    if (result.isNew) {
      try {
        const { sendEmail } = await import('@/lib/email');
        const { buildNewsletterWelcomeEmail } = await import('@/lib/email-templates');
        const mail = buildNewsletterWelcomeEmail({ email: normalizedEmail });
        const sent = await sendEmail({ to: normalizedEmail, subject: mail.subject, html: mail.html, text: mail.text });
        if (sent.success) {
          message = 'Subscribed successfully! We sent you a confirmation email.';
        } else {
          console.error('Newsletter confirmation email failed:', sent.error);
        }
      } catch (mailError) {
        console.error('Newsletter confirmation email failed:', mailError);
      }
    }

    return createSecureJsonResponse({
      success: true,
      message
    }, { status: 200 });
  } catch (error: any) {
    console.error('Error in newsletter subscribe endpoint:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error.' },
      { status: 500 }
    );
  }
}
