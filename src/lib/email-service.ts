/**
 * Email Dispatch Service
 * Sends newsletters through the service selected on the admin Email services page (Brevo or Amazon
 * SES; see ./mail/mailer), one email per subscriber.
 */
import logger from '@/lib/logger';
import { emailShell } from '@/lib/email-theme';
import { buildUnsubscribePageUrl, buildOneClickUnsubscribeUrl } from '@/lib/newsletter-unsubscribe';
import { activeProvider, logEntry, sendThrough, writeEmailLog, type EmailLogEntry } from '@/lib/mail/mailer';
import { brevoApiKey } from '@/lib/mail/providers/brevo';

/** Per-request ceiling (seconds-long in practice; this only guards a hung connection). */
const SEND_TIMEOUT_MS = 15_000;

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
    const provider = await activeProvider();
    if (provider === 'brevo' && !brevoApiKey()) {
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

    // One email per subscriber: each needs its own unsubscribe link and List-Unsubscribe header.
    // Rate limits (Brevo 429, SES throttling) and outages are retried with backoff; a timeout is never
    // retried, because the request may still have been processed and a repeat could email someone twice.
    const log: EmailLogEntry[] = [];
    const sendOne = async (email: string) => {
      const message = {
        from: { name: senderName, email: senderEmail },
        to: email,
        subject,
        html: htmlTemplate.replace('__UNSUBSCRIBE_URL__', buildUnsubscribePageUrl(email)),
        // RFC 8058 one-click unsubscribe (Gmail/Yahoo bulk-sender requirement)
        headers: {
          'List-Unsubscribe': `<${buildOneClickUnsubscribeUrl(email)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      };
      const result = await sendThrough(provider, message, { retries: 3, timeoutMs: SEND_TIMEOUT_MS });
      log.push(logEntry('newsletter', message, provider, result));
      if (!result.ok) throw new Error(result.error);
      logger.log('[Email] Accepted by %s:', provider, result.messageId);
    };

    let sentCount = 0;
    const failures: string[] = [];
    // SES allows only a few sends a second (1 a second in its sandbox), so it goes one at a time
    const CONCURRENCY = provider === 'ses' ? 1 : 5;
    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      const batch = recipients.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(sendOne));
      results.forEach((r, j) => {
        if (r.status === 'fulfilled') {
          sentCount++;
        } else {
          console.error(`Newsletter send failed for recipient #${i + j + 1}:`, r.reason);
          failures.push((r.reason as Error).message);
        }
      });
    }
    await writeEmailLog(log);

    return {
      success: sentCount > 0,
      sentCount,
      failedCount: failures.length,
      error: failures.length ? `${failures.length} of ${recipients.length} failed. First error: ${failures[0]}` : undefined
    };
  } catch (error: unknown) {
    const msg = (error as Error).message; // everything above throws Error instances
    console.error('Error dispatching newsletter email:', error);
    return {
      success: false,
      sentCount: 0,
      failedCount: recipients?.length ?? 0,
      error: msg
    };
  }
}
