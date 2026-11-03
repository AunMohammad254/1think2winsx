/**
 * Shared shapes for the mail layer (src/lib/mail). One email goes to one address: newsletters send
 * one per subscriber so each carries its own unsubscribe link.
 */
export type EmailProviderId = 'ses' | 'brevo' | 'cloudflare';

/** In the order an admin falls back to them: Amazon SES, then Brevo, then Cloudflare. */
export const EMAIL_PROVIDERS = ['ses', 'brevo', 'cloudflare'] as const satisfies readonly EmailProviderId[];

export const PROVIDER_NAMES: Record<EmailProviderId, string> = { ses: 'Amazon SES', brevo: 'Brevo', cloudflare: 'Cloudflare' };

export const isEmailProvider = (value: unknown): value is EmailProviderId =>
  (EMAIL_PROVIDERS as readonly unknown[]).includes(value);

export interface OutgoingEmail {
  from: { email: string; name: string };
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Extra headers, e.g. List-Unsubscribe */
  headers?: Record<string, string>;
}

/** How hard a provider tries: a request timeout, and retries for rate limits and outages. */
export interface SendOptions {
  timeoutMs?: number;
  retries?: number;
}

export type ProviderResult = { ok: true; messageId: string | null } | { ok: false; error: string };
