/**
 * Content for the transactional emails the app sends itself through Brevo (see `sendEmail` in ./email).
 * Layout and styling come from ./email-theme, so the look is changed in one place.
 *
 * The Supabase auth emails (sign-up confirmation, password reset, ...) live in
 * ./email-supabase-templates because Supabase sends those from its own dashboard.
 */
import { buildUnsubscribePageUrl } from './newsletter-unsubscribe';
import { siteUrl } from './site-url';
import {
    emailShell,
    emailButton,
    emailParagraph,
    emailNote,
    emailValue,
    emailLinkFallback,
    escapeHtml,
} from './email-theme';

export { siteUrl, escapeHtml };

/** Sent to the account's own address when someone asks "what is my email?" on /forgot-email. */
export function buildEmailReminderEmail(opts: { email: string; phoneLast4: string }) {
    const base = siteUrl();
    const html = emailShell({
        title: 'Your sign-in email',
        preheader: 'Here is the email address linked to your 1Think 2Win account.',
        bodyHtml: [
            emailParagraph(
                `Someone asked for the email address linked to the phone number ending in <strong style="color:#ffffff;">${escapeHtml(opts.phoneLast4)}</strong>. Your sign-in email is:`
            ),
            emailValue(opts.email),
            emailButton(`${base}/auth?mode=login`, 'Sign in'),
            emailButton(`${base}/forgot-password`, 'Reset password', { variant: 'secondary' }),
            emailNote("If this wasn't you, you can ignore this email. Nobody else can see this address."),
        ].join('\n'),
    });
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
    const html = emailShell({
        title: "You're subscribed",
        preheader: 'Thanks for joining 1Think 2Win. New quizzes and prizes are on the way.',
        bodyHtml: [
            emailParagraph(
                "Thanks for subscribing! You'll now get news about new quizzes, prizes and winners from 1Think 2Win."
            ),
            emailButton(`${base}/quizzes`, 'Browse quizzes'),
        ].join('\n'),
        footerNoteHtml: `You received this email because ${escapeHtml(opts.email)} was subscribed to 1Think 2Win updates. If that wasn't you, <a href="${escapeHtml(unsubscribeUrl)}" target="_blank" style="color:#94a3b8;text-decoration:underline;">unsubscribe here</a>; you won't get anything else from us.`,
    });
    const text =
        `Thanks for subscribing to 1Think 2Win updates!\n\nBrowse quizzes: ${base}/quizzes\n\n` +
        `If this wasn't you, unsubscribe here: ${unsubscribeUrl}`;
    return { subject: "You're subscribed to 1Think 2Win updates", html, text };
}

/** Admin "resend verification" email (the link comes from Supabase). */
export function buildVerifyEmailEmail(opts: { verificationUrl: string }) {
    const html = emailShell({
        title: 'Verify your email',
        preheader: 'One tap to finish setting up your 1Think 2Win account.',
        bodyHtml: [
            emailParagraph('Welcome to 1Think 2Win! Please verify your email address to finish setting up your account.'),
            emailButton(opts.verificationUrl, 'Verify my email address'),
            emailLinkFallback(opts.verificationUrl),
        ].join('\n'),
    });
    const text = `Welcome to 1Think 2Win! Verify your email address: ${opts.verificationUrl}`;
    return { subject: 'Action required: verify your 1Think 2Win account', html, text };
}

/** Admin message sent to a player as an email. Title and message are escaped: they are typed by a person. */
export function buildAdminMessageEmail(opts: { title: string; message: string }) {
    const messageHtml = escapeHtml(opts.message).replace(/\r?\n/g, '<br>');
    const html = emailShell({
        title: opts.title,
        preheader: opts.message.slice(0, 110),
        bodyHtml: [
            emailParagraph(messageHtml),
            emailParagraph('Log in to your dashboard to see more details.', { muted: true }),
            emailButton(`${siteUrl()}/profile`, 'Open my profile'),
        ].join('\n'),
    });
    return { subject: opts.title, html, text: opts.message };
}
