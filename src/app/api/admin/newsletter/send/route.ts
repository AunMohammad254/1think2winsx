import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { newsletterDb } from '@/lib/supabase/db';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { sendNewsletterEmail } from '@/lib/email-service';
import { securityLogger } from '@/lib/security-logger';

export async function POST(request: NextRequest) {
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
    const { senderEmail, subject, content } = body;

    // 4. Validate input fields
    if (!senderEmail || !subject || !content) {
      return NextResponse.json(
        { success: false, message: 'Sender email, subject, and content/description are required.' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(senderEmail.trim())) {
      return NextResponse.json(
        { success: false, message: 'Please enter a valid sender email address.' },
        { status: 400 }
      );
    }

    if (content.trim().length < 10) {
      return NextResponse.json(
        { success: false, message: 'Email description should be at least 10 characters long.' },
        { status: 400 }
      );
    }

    // 5. Fetch all newsletter subscribers
    const subscribers = await newsletterDb.getSubscribers();

    if (subscribers.length === 0) {
      return createSecureJsonResponse({
        success: true,
        message: 'No active subscribers found to send emails to.',
        sentCount: 0
      }, { status: 200 });
    }

    // 6. Send newsletter dispatch
    const emailResult = await sendNewsletterEmail({
      senderEmail: senderEmail.trim(),
      subject: subject.trim(),
      content: content.trim(),
      recipients: subscribers
    });

    if (!emailResult.success) {
      return NextResponse.json(
        { success: false, message: emailResult.error || 'Failed to dispatch emails.' },
        { status: 500 }
      );
    }

    // 7. Log admin action to security logs
    securityLogger.logSecurityEvent({
      type: 'QUIZ_ACCESS',
      userId: undefined,
      endpoint: '/api/admin/newsletter/send',
      details: {
        action: 'newsletter_dispatched',
        senderEmail: senderEmail.trim(),
        subject: subject.trim(),
        subscriberCount: subscribers.length
      }
    });

    return createSecureJsonResponse({
      success: true,
      message: `Successfully sent newsletter to ${subscribers.length} subscribed user(s)!`,
      sentCount: subscribers.length
    }, { status: 200 });
  } catch (error: any) {
    console.error('Error in admin newsletter send endpoint:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error.' },
      { status: 500 }
    );
  }
}
