import { emailShell } from './email-theme';
import { deliver } from './mail/mailer';
import type { EmailKind } from './email-quota';

export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
    /** What the email is for, as counted by the daily limit; shown in the admin email log */
    kind?: EmailKind;
}

/**
 * Sends one email through the service selected on the admin Email services page (Brevo or Amazon SES;
 * see ./mail/mailer). The sender must be on the domain verified with both services.
 */
export const sendEmail = async ({ to, subject, html, text, kind = 'account' }: SendEmailOptions) => {
    const result = await deliver({
        // Must be a verified sender (or authenticated domain), or the send is rejected
        from: { email: process.env.BREVO_SENDER_EMAIL || 'support@1think2win.com', name: '1Think 2Win Support' },
        to,
        subject,
        html,
        text,
    }, { kind });

    if (!result.success) {
        console.error('Error sending email:', result.error);
        return { success: false, error: result.error };
    }
    console.log('Message sent via %s: %s', result.provider, result.messageId);
    return { success: true, messageId: result.messageId };
};

/**
 * Wraps an email body in the shared 1Think 2Win layout (see ./email-theme).
 * Kept so existing callers keep working; new emails should use the builders in ./email-templates.
 * `title` is escaped; `messageHtml` is trusted markup.
 */
export const generateBeautifulEmailTemplate = (title: string, messageHtml: string) =>
    emailShell({ title, bodyHtml: messageHtml });
