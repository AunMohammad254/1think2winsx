import { fetchWithRetry } from '@/lib/fetch-retry';
import type { OutgoingEmail, ProviderResult, SendOptions } from '../types';

/**
 * Cloudflare Email Service (Email Sending, on the account's Workers Paid plan), through its REST API.
 * CLOUDFLARE_EMAIL_ACCOUNT_ID is the Cloudflare account; CLOUDFLARE_EMAIL_API_TOKEN is an API token
 * allowed only "Email Sending: Edit" (not the cache-purge token). The sender's domain must be
 * onboarded for Email Sending in that account. Returns null when either is missing.
 */
export function cloudflareCredentials(): { accountId: string; token: string } | null {
  const accountId = process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  return accountId && token ? { accountId, token } : null;
}

export const cloudflareConfigured = (): boolean => cloudflareCredentials() !== null;

export const cloudflareEmailUrl = (accountId: string, path: 'send' | 'limits') =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/${path}`;

/** Plain words for the admin page and the log, by Cloudflare's error code. */
const REASONS: Record<number, string> = {
  10001: 'Cloudflare refused the request as malformed',
  10004: 'Cloudflare is throttling sends (the rate limit was reached)',
  10101: 'Cloudflare did not accept the API token',
  10102: 'The Cloudflare API token is not allowed to send email',
  10103: 'The Cloudflare API token is the wrong kind',
  10105: 'This Cloudflare account has no Email Sending (it needs the Workers Paid plan)',
  10200: 'The email is too big for Cloudflare',
  10202: 'Cloudflare refused the email as invalid',
  10203: 'Email Sending is turned off for this domain or account',
  10207: 'Cloudflare paused Email Sending for this account',
};

interface SendResponse {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { message_id?: string; permanent_bounces?: string[]; suppressed_recipients?: string[] } | null;
}

/**
 * Sends one email through Cloudflare's REST API. Rate limits (429) and its auth service being down
 * (503) are retried with backoff; a timeout or a 500 is never retried, because Cloudflare may still
 * have taken the email and a repeat could send it twice. The answer says at once whether the address
 * bounced or is on the suppression list; both count as failed, since the email never arrives.
 */
export async function sendViaCloudflare(email: OutgoingEmail, { timeoutMs = 15_000, retries = 0 }: SendOptions = {}): Promise<ProviderResult> {
  try {
    const credentials = cloudflareCredentials();
    if (!credentials) {
      return { ok: false, error: 'Cloudflare is not configured (CLOUDFLARE_EMAIL_ACCOUNT_ID or CLOUDFLARE_EMAIL_API_TOKEN is missing)' };
    }

    const response = await fetchWithRetry(cloudflareEmailUrl(credentials.accountId, 'send'), {
      method: 'POST',
      headers: { authorization: `Bearer ${credentials.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: { address: email.from.email, name: email.from.name },
        to: email.to,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        subject: email.subject,
        html: email.html,
        ...(email.text ? { text: email.text } : {}),
        ...(email.headers ? { headers: email.headers } : {}),
      }),
    }, { retries, retryOn: [429, 503], baseDelayMs: 1_000, maxDelayMs: 20_000, timeoutMs, retryOnTimeout: false });

    const data = (await response.json().catch(() => ({}))) as SendResponse;
    if (!response.ok || data.success === false) {
      const first = data.errors?.[0];
      const reason = (first?.code !== undefined && REASONS[first.code]) || `Cloudflare refused the email (${response.status})`;
      return { ok: false, error: first?.message ? `${reason}: ${first.message}` : reason };
    }
    if (data.result?.suppressed_recipients?.length) {
      return { ok: false, error: 'Cloudflare did not send it: the address is on its suppression list (it bounced or complained before)' };
    }
    if (data.result?.permanent_bounces?.length) {
      return { ok: false, error: 'The address bounced: the mailbox does not exist or refused the email' };
    }
    return { ok: true, messageId: data.result?.message_id ?? null };
  } catch (error) {
    return { ok: false, error: `Cloudflare could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}
