import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'standardwebhooks';
import { buildAuthEmails, type HookEmailData, type HookUser } from '@/lib/mail/auth-emails';
import { deliver, type DeliveryResult } from '@/lib/mail/mailer';

/**
 * Supabase Auth's Send Email Hook (Authentication > Hooks > Send Email, HTTPS). With the hook on,
 * Supabase doesn't send the registration, password and sign-in emails itself: it posts them here,
 * and the app sends them through the service selected on the admin Email services page.
 *
 * Supabase signs each call (Standard Webhooks) with SEND_EMAIL_HOOK_SECRET ("v1,whsec_…") and waits
 * 5 seconds at most, so the send gets 3.5 s. To pass a failure back to the person (for example "Unable
 * to send…" on the sign-up form), the answer is HTTP 200 with {"error": {"http_code", "message"}}:
 * Supabase turns any other non-2xx answer into a generic error.
 *
 * Counting against the daily limit stays where the email is asked for (registerAction, resetPassword,
 * sendPasswordSetupEmail), so an email is never counted twice.
 */
const SEND_TIMEOUT_MS = 3_500;

interface HookPayload {
  user: HookUser;
  email_data: HookEmailData;
}

const hookError = (message: string, httpCode = 500) =>
  NextResponse.json({ error: { http_code: httpCode, message } }, { status: 200 });

export async function POST(request: NextRequest) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !supabaseUrl) {
    console.error('[send-email-hook] SEND_EMAIL_HOOK_SECRET or NEXT_PUBLIC_SUPABASE_URL is not set');
    return hookError('Unable to send the email: the email hook is not configured.');
  }

  const body = await request.text();
  let payload: HookPayload;
  try {
    payload = new Webhook(secret.replace(/^v1,whsec_/, '')).verify(body, Object.fromEntries(request.headers)) as HookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const emails = buildAuthEmails(payload.user, payload.email_data, supabaseUrl);
  if (!emails) {
    console.error('[send-email-hook] Unsupported email type:', payload.email_data.email_action_type);
    return hookError('Unable to send the email: this email type is not supported.', 400);
  }

  const from = { email: process.env.BREVO_SENDER_EMAIL || 'support@1think2win.com', name: '1Think 2Win' };
  const results = await Promise.all(
    emails.map((email) => deliver({ from, to: email.to, subject: email.subject, html: email.html, text: email.text }, { kind: email.kind, timeoutMs: SEND_TIMEOUT_MS })),
  );
  const failed = results.find((result): result is Extract<DeliveryResult, { success: false }> => !result.success);
  if (failed) {
    console.error('[send-email-hook] Send failed through %s: %s', failed.provider, failed.error);
    return hookError('Unable to send the email right now. Please try again in a few minutes.');
  }
  return NextResponse.json({}, { status: 200 });
}
