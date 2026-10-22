import { SUPABASE_EMAIL_TEMPLATES } from '@/lib/email-supabase-templates';
import { emailNote, emailParagraph, emailShell, escapeHtml } from '@/lib/email-theme';
import { siteUrl } from '@/lib/site-url';
import type { EmailKind } from '@/lib/email-quota';

/**
 * The emails Supabase Auth hands to the app through its Send Email Hook (see
 * src/app/api/auth/send-email-hook/route.ts), built from the same templates that were pasted into the
 * Supabase dashboard (src/lib/email-supabase-templates.ts) with Supabase's variables filled in here.
 */
export interface HookUser {
  email: string;
  new_email?: string | null;
}

export interface HookEmailData {
  token?: string;
  token_hash?: string;
  redirect_to?: string;
  email_action_type: string;
  site_url?: string;
  token_new?: string;
  token_hash_new?: string;
}

export interface AuthEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
}

/** Template and daily-limit type for each email Supabase asks for. "email" is a one-time sign-in code. */
const TEMPLATES: Record<string, { key: string; kind: EmailKind }> = {
  signup: { key: 'confirm-signup', kind: 'registration' },
  recovery: { key: 'reset-password', kind: 'password' },
  magiclink: { key: 'magic-link', kind: 'account' },
  email: { key: 'magic-link', kind: 'account' },
  invite: { key: 'invite', kind: 'account' },
  email_change: { key: 'change-email', kind: 'account' },
  reauthentication: { key: 'reauthentication', kind: 'account' },
};

/** Security notices Supabase sends after a change, when they are turned on in the dashboard. */
const NOTICES: Record<string, string> = {
  password_changed_notification: 'The password for your 1Think 2Win account was changed.',
  email_changed_notification: 'The email address on your 1Think 2Win account was changed.',
  phone_changed_notification: 'The phone number on your 1Think 2Win account was changed.',
  identity_linked_notification: 'A new sign-in method was linked to your 1Think 2Win account.',
  identity_unlinked_notification: 'A sign-in method was removed from your 1Think 2Win account.',
  mfa_factor_enrolled_notification: 'A two-step verification method was added to your 1Think 2Win account.',
  mfa_factor_unenrolled_notification: 'A two-step verification method was removed from your 1Think 2Win account.',
};

/**
 * Supabase's own verify link. It checks the token and redirects to redirect_to with a ?code=, which
 * /auth/callback exchanges for a session (the same flow as Supabase's own emails).
 */
export function verifyUrl(supabaseUrl: string, tokenHash: string, type: string, redirectTo?: string): string {
  const url = new URL('/auth/v1/verify', supabaseUrl);
  url.searchParams.set('token', tokenHash);
  url.searchParams.set('type', type);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

/** Fills in {{ .Name }} variables, escaped for HTML; an unknown one is left as it is. */
export function fill(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{ \.(\w+) \}\}/g, (match, name: string) => (name in vars ? escapeHtml(vars[name]) : match));
}

function fromTemplate(type: string, to: string, user: HookUser, data: HookEmailData, link: string, token: string): AuthEmail {
  const { key, kind } = TEMPLATES[type];
  const template = SUPABASE_EMAIL_TEMPLATES[key];
  const html = fill(template.html, {
    ConfirmationURL: link,
    SiteURL: data.site_url || siteUrl(),
    Email: user.email,
    NewEmail: user.new_email ?? '',
    Token: token,
  });
  const text = type === 'reauthentication' ? `${template.subject}\n\nYour code: ${token}\n` : `${template.subject}\n\n${link}\n`;
  return { to, subject: template.subject, html, text, kind };
}

function notice(type: string, user: HookUser): AuthEmail {
  const what = NOTICES[type] ?? 'A security setting on your 1Think 2Win account was changed.';
  const subject = 'Security notice for your 1Think 2Win account';
  const html = emailShell({
    title: 'Security notice',
    preheader: what,
    bodyHtml: [
      emailParagraph(escapeHtml(what)),
      emailNote("If this wasn't you, reset your password straight away and contact our support team."),
    ].join('\n'),
  });
  return { to: user.email, subject, html, text: `${subject}\n\n${what}\nIf this wasn't you, reset your password straight away and contact our support team.\n`, kind: 'account' };
}

/**
 * The email(s) to send for one hook call, or null for a type the app doesn't know.
 *
 * An email change with Secure Email Change on sends two: the current address confirms with
 * token + token_hash_new and the new address with token_new + token_hash (Supabase's names are
 * reversed for backward compatibility). With it off, one email goes to the new address.
 */
export function buildAuthEmails(user: HookUser, data: HookEmailData, supabaseUrl: string): AuthEmail[] | null {
  const type = data.email_action_type;
  if (type.endsWith('_notification')) return [notice(type, user)];
  if (!(type in TEMPLATES)) return null;

  const link = (hash: string) => verifyUrl(supabaseUrl, hash, type, data.redirect_to);

  if (type === 'email_change') {
    const newAddress = user.new_email || user.email;
    if (data.token_hash && data.token_hash_new) {
      return [
        fromTemplate(type, user.email, user, data, link(data.token_hash_new), data.token ?? ''),
        fromTemplate(type, newAddress, user, data, link(data.token_hash), data.token_new ?? ''),
      ];
    }
    return [fromTemplate(type, newAddress, user, data, link(data.token_hash || data.token_hash_new || ''), data.token_new || data.token || '')];
  }

  return [fromTemplate(type, user.email, user, data, link(data.token_hash ?? ''), data.token ?? '')];
}
