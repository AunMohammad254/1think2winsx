/**
 * Wording and layout for the transactional emails the app sends itself through Brevo
 * (see `sendEmail` in ./email). Kept in one file so the look can be restyled in one place.
 *
 * Everything interpolated into HTML goes through `escapeHtml`.
 */
import { generateBeautifulEmailTemplate } from './email';
import { buildUnsubscribePageUrl } from './newsletter-unsubscribe';
import { siteUrl } from './site-url';

export { siteUrl };

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const buttonStyle =
    'display:inline-block;background:#eab308;color:#000000;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;margin:6px 6px 0 0;';
const secondaryButtonStyle =
    'display:inline-block;background:#27272a;color:#ffffff;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;margin:6px 0 0 0;border:1px solid #3f3f46;';

/** Sent to the account's own address when someone asks "what is my email?" on /forgot-email. */
export function buildEmailReminderEmail(opts: { email: string; phoneLast4: string }) {
    const base = siteUrl();
    const html = generateBeautifulEmailTemplate(
        'Your sign-in email',
        `
        <p>Someone asked for the email address linked to the phone number ending in <strong style="color:#ffffff;">${escapeHtml(opts.phoneLast4)}</strong>.</p>
        <p>Your 1Think 2Win sign-in email is:</p>
        <p style="font-size:20px;font-weight:700;color:#eab308;word-break:break-all;">${escapeHtml(opts.email)}</p>
        <p>
            <a href="${base}/auth?mode=login" class="button" style="${buttonStyle}">Sign in</a>
            <a href="${base}/forgot-password" style="${secondaryButtonStyle}">Reset password</a>
        </p>
        <p style="font-size:13px;">If this wasn't you, you can ignore this email. Nobody else can see this address.</p>`
    );
    const text =
        `Your 1Think 2Win sign-in email is: ${opts.email}\n\n` +
        `Sign in: ${base}/auth?mode=login\nReset your password: ${base}/forgot-password\n\n` +
        `If this wasn't you, you can ignore this email.`;
    return { subject: 'Your 1Think 2Win sign-in email', html, text };
}

/** Sent once, right after a new newsletter subscription. */
export function buildNewsletterWelcomeEmail(opts: { email: string }) {
    const base = siteUrl();
    const unsubscribeUrl = buildUnsubscribePageUrl(opts.email);
    const html = generateBeautifulEmailTemplate(
        "You're subscribed",
        `
        <p>Thanks for subscribing! You'll now get news about new quizzes, prizes and winners from 1Think 2Win.</p>
        <p>
            <a href="${base}/quizzes" class="button" style="${buttonStyle}">Browse quizzes</a>
        </p>
        <p style="font-size:13px;">You received this email because ${escapeHtml(opts.email)} was subscribed to 1Think 2Win updates.
        If that wasn't you, <a href="${unsubscribeUrl}" style="color:#a1a1aa;">unsubscribe here</a>; you won't get anything else from us.</p>`
    );
    const text =
        `Thanks for subscribing to 1Think 2Win updates!\n\nBrowse quizzes: ${base}/quizzes\n\n` +
        `If this wasn't you, unsubscribe here: ${unsubscribeUrl}`;
    return { subject: "You're subscribed to 1Think 2Win updates", html, text };
}
