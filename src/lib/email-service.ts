/**
 * Email Dispatch Service
 * Utility for sending emails via Brevo SMTP HTTP API
 */
import logger from '@/lib/logger';
import { emailShell } from '@/lib/email-theme';
import { buildUnsubscribePageUrl, buildOneClickUnsubscribeUrl } from '@/lib/newsletter-unsubscribe';

interface SendEmailParams {
  senderEmail: string;
  senderName?: string;
  subject: string;
  content: string;
  recipients: string[];
}

export async function sendNewsletterEmail({
  senderEmail,
  senderName = '1Think 2Win',
  subject,
  content,
  recipients
}: SendEmailParams): Promise<{ success: boolean; sentCount: number; failedCount?: number; error?: string }> {
  try {
    const brevoApiKey = process.env.BREVO_API_KEY;
    if (!brevoApiKey) {
      throw new Error('BREVO_API_KEY is not configured in environment variables');
    }

    if (!recipients || recipients.length === 0) {
      return { success: true, sentCount: 0, failedCount: 0 };
    }

    // Branded wrapper (see ./email-theme); __UNSUBSCRIBE_URL__ is filled in per recipient.
    // `content` is written by an admin and is inserted as typed (line breaks preserved).
    const htmlTemplate = emailShell({
      title: subject,
      preheader: content.replace(/<[^>]*>/g, '').slice(0, 110),
      bodyHtml: `<div style="white-space: pre-line;">${content}</div>`,
      footerNoteHtml:
        'You received this email because you subscribed to updates on 1Think 2Win. ' +
        '<a href="__UNSUBSCRIBE_URL__" target="_blank" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a>',
    });

    // One email per subscriber: each needs its own unsubscribe link, and Brevo only
    // allows headers (List-Unsubscribe) per request, not per recipient.
    const sendOne = async (email: string) => {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': brevoApiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email }],
          subject,
          htmlContent: htmlTemplate.replace('__UNSUBSCRIBE_URL__', buildUnsubscribePageUrl(email)),
          // RFC 8058 one-click unsubscribe (Gmail/Yahoo bulk-sender requirement)
          headers: {
            'List-Unsubscribe': `<${buildOneClickUnsubscribeUrl(email)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          }
        })
      });
      if (!response.ok) {
        throw new Error(`Brevo API failed with status ${response.status}: ${await response.text()}`);
      }
      const data = await response.json();
      logger.log('[Email] Brevo API response:', data);
    };

    let sentCount = 0;
    const failures: string[] = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      const batch = recipients.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(sendOne));
      results.forEach((r, j) => {
        if (r.status === 'fulfilled') {
          sentCount++;
        } else {
          console.error(`Newsletter send failed for recipient #${i + j + 1}:`, r.reason);
          failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        }
      });
    }

    return {
      success: sentCount > 0,
      sentCount,
      failedCount: failures.length,
      error: failures.length ? `${failures.length} of ${recipients.length} failed. First error: ${failures[0]}` : undefined
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown email dispatch error';
    console.error('Error dispatching newsletter email:', error);
    return {
      success: false,
      sentCount: 0,
      failedCount: recipients?.length ?? 0,
      error: msg
    };
  }
}
