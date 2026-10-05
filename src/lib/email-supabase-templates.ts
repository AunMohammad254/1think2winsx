/**
 * The six Supabase Auth emails, designed with the same kit as every other email (./email-theme).
 *
 * Supabase sends these itself, from the dashboard (Authentication > Email Templates), so they are NOT
 * deployed with the app: they were pasted into the dashboard once. This file is the source of that HTML,
 * so a redesign can be re-pasted. Print one with, from the repo root:
 *
 *   bun -e "import {SUPABASE_EMAIL_TEMPLATES as T} from './src/lib/email-supabase-templates'; console.log(T['reset-password'].html)"
 *
 * Keys: confirm-signup, reset-password, magic-link, invite, change-email, reauthentication.
 * The {{ .Placeholder }} values are Supabase's own template variables and are filled in by Supabase.
 */
import { emailShell, emailButton, emailParagraph, emailNote, emailLinkFallback, emailCode } from './email-theme';

const BASE = '{{ .SiteURL }}';
const LINK = '{{ .ConfirmationURL }}';

const ignoreNote = (what: string) => emailNote(`If you didn't ${what}, you can safely ignore this email.`, 'amber');

export interface SupabaseEmailTemplate {
    /** Where it goes in the dashboard */
    dashboardName: string;
    /** Subject line to set in the dashboard */
    subject: string;
    html: string;
}

const shell = (title: string, preheader: string, body: string[]) =>
    emailShell({ title, preheader, bodyHtml: body.join('\n'), baseUrl: BASE, year: null });

export const SUPABASE_EMAIL_TEMPLATES: Record<string, SupabaseEmailTemplate> = {
    'confirm-signup': {
        dashboardName: 'Confirm sign up',
        subject: 'Confirm your 1Think 2Win account',
        html: shell('Confirm your email', 'Confirm your email to activate your 1Think 2Win account.', [
            emailParagraph('Welcome to 1Think 2Win! Tap the button below to confirm <strong style="color:#ffffff;">{{ .Email }}</strong> and activate your account.'),
            emailButton(LINK, 'Confirm my email'),
            emailLinkFallback(LINK),
            ignoreNote('create an account'),
        ]),
    },

    'reset-password': {
        dashboardName: 'Reset password',
        subject: 'Set or reset your 1Think 2Win password',
        html: shell('Set or reset your password', 'Choose a new password for your 1Think 2Win account.', [
            emailParagraph('We received a request to set or reset the password for <strong style="color:#ffffff;">{{ .Email }}</strong>. Use the button below to choose a new password.'),
            emailButton(LINK, 'Choose a new password'),
            emailLinkFallback(LINK),
            emailNote(
                "This link works only once, and only the newest email works. If you asked for several, use the latest one. If you didn't request this, ignore this email: your password won't change."
            ),
        ]),
    },

    'magic-link': {
        dashboardName: 'Magic link',
        subject: 'Your 1Think 2Win sign-in link',
        html: shell('Your sign-in link', 'Use this link to sign in to 1Think 2Win.', [
            emailParagraph('Tap the button below to sign in to 1Think 2Win. The link works once and expires soon.'),
            emailButton(LINK, 'Sign in'),
            emailLinkFallback(LINK),
            ignoreNote('ask to sign in'),
        ]),
    },

    invite: {
        dashboardName: 'Invite user',
        subject: "You're invited to 1Think 2Win",
        html: shell("You're invited", "You've been invited to join 1Think 2Win.", [
            emailParagraph("You've been invited to join 1Think 2Win, the sports quiz competition where real prizes are won. Accept your invitation to create your account."),
            emailButton(LINK, 'Accept invitation'),
            emailLinkFallback(LINK),
        ]),
    },

    'change-email': {
        dashboardName: 'Change email address',
        subject: 'Confirm your new 1Think 2Win email',
        html: shell('Confirm your new email', 'Confirm the new email address for your 1Think 2Win account.', [
            emailParagraph('You asked to change the email on your account from <strong style="color:#ffffff;">{{ .Email }}</strong> to <strong style="color:#ffffff;">{{ .NewEmail }}</strong>. Confirm the change below.'),
            emailButton(LINK, 'Confirm new email'),
            emailLinkFallback(LINK),
            ignoreNote('ask to change your email'),
        ]),
    },

    reauthentication: {
        dashboardName: 'Reauthentication',
        subject: 'Your 1Think 2Win security code',
        html: shell("Confirm it's you", 'Your one-time security code for 1Think 2Win.', [
            emailParagraph('Enter this code to continue. It works once and expires soon.'),
            emailCode('{{ .Token }}'),
            emailNote("Never share this code with anyone. We will never ask you for it."),
        ]),
    },
};
