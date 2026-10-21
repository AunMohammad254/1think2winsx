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
    const { subject, content } = body;
    // Blank sender -> the verified default (Brevo rejects unverified senders)
    const senderEmail: string = (body.senderEmail || '').trim() || process.env.BREVO_SENDER_EMAIL || '';

    // 4. Validate input fields
    if (!senderEmail || !subject || !content) {
      return NextResponse.json(
        { success: false, message: 'Subject and content/description are required (and a sender email when BREVO_SENDER_EMAIL is not set).' },
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

    // Brevo accepts the request for any sender and only afterwards rejects one it hasn't verified, so
    // this route reported "sent" for newsletters nobody received (the 18 and 20 Oct 2026 ones, sent
    // from a Gmail address). The default sender's domain is the one authenticated in Brevo: any
    // address on it can send, others never arrive.
    const defaultSender = process.env.BREVO_SENDER_EMAIL || '';
    const verifiedDomain = defaultSender.split('@')[1]?.toLowerCase();
    if (verifiedDomain && senderEmail.trim().split('@')[1]?.toLowerCase() !== verifiedDomain) {
      return NextResponse.json(
        { success: false, message: `Newsletters can only be sent from an @${verifiedDomain} address, the domain verified in Brevo. Leave the sender blank to use ${defaultSender}.` },
        { status: 400 }
      );
    }

    // A test goes to that one address only, never to the subscribers
    const testEmail: string = typeof body.testEmail === 'string' ? body.testEmail.trim() : '';
    if (body.testEmail !== undefined && !emailRegex.test(testEmail)) {
      return NextResponse.json(
        { success: false, message: 'Please enter a valid address for the test email.' },
        { status: 400 }
      );
    }

    if (content.trim().length < 10) {
      return NextResponse.json(
        { success: false, message: 'Email description should be at least 10 characters long.' },
        { status: 400 }
      );
    }

    if (testEmail) {
      const testResult = await sendNewsletterEmail({
        senderEmail: senderEmail.trim(),
        subject: `[TEST] ${subject.trim()}`,
        content: content.trim(),
        recipients: [testEmail]
      });
      if (!testResult.success) {
        return NextResponse.json(
          { success: false, message: testResult.error || 'Failed to send the test email.' },
          { status: 500 }
        );
      }
      return createSecureJsonResponse({
        success: true,
        test: true,
        message: `Brevo accepted the test email to ${testEmail}. If it doesn't arrive, Brevo's Transactional logs show why.`,
        sentCount: 1,
        failedCount: 0
      }, { status: 200 });
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
        subscriberCount: subscribers.length,
        sentCount: emailResult.sentCount,
        failedCount: emailResult.failedCount ?? 0
      }
    });

    return createSecureJsonResponse({
      success: true,
      // "Accepted", not "delivered": Brevo can still drop an email after accepting it
      message: emailResult.failedCount
        ? `Brevo accepted ${emailResult.sentCount} of ${subscribers.length} email(s); ${emailResult.failedCount} failed.`
        : `Brevo accepted the newsletter for all ${emailResult.sentCount} subscriber(s).`,
      sentCount: emailResult.sentCount,
      failedCount: emailResult.failedCount ?? 0
    }, { status: 200 });
  } catch (error: any) {
    console.error('Error in admin newsletter send endpoint:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error.' },
      { status: 500 }
    );
  }
}
