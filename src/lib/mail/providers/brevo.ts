import { fetchWithRetry } from '@/lib/fetch-retry';
import type { OutgoingEmail, ProviderResult, SendOptions } from '../types';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * BREVO_API_KEY, or the legacy base64-encoded JSON key whose hyphenated name hosting panels can't set.
 * Returns null when neither is set.
 */
export function brevoApiKey(): string | null {
  const key = process.env.BREVO_API_KEY;
  if (key) return key;
  const legacy = process.env['Bravo-MCP-API-key'];
  if (!legacy) return null;
  return JSON.parse(Buffer.from(legacy, 'base64').toString('utf-8')).api_key as string;
}

/**
 * Sends one email through Brevo's REST API. Brevo rate-limits bulk sends with 429, so those and 503
 * are retried with backoff; a timeout is never retried, because Brevo may still have taken the email
 * and a repeat could send it twice.
 */
export async function sendViaBrevo(email: OutgoingEmail, { timeoutMs = 15_000, retries = 0 }: SendOptions = {}): Promise<ProviderResult> {
  try {
    const apiKey = brevoApiKey();
    if (!apiKey) return { ok: false, error: 'Brevo is not configured (BREVO_API_KEY is missing)' };

    const response = await fetchWithRetry(BREVO_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: email.from.name, email: email.from.email },
        to: [{ email: email.to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text || 'Please use an HTML compatible email client.',
        ...(email.headers ? { headers: email.headers } : {}),
      }),
    }, { retries, retryOn: [429, 503], baseDelayMs: 1_000, maxDelayMs: 20_000, timeoutMs, retryOnTimeout: false });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: `Brevo refused the email (${response.status}): ${data.message || 'no reason given'}` };
    }
    return { ok: true, messageId: data.messageId ?? null };
  } catch (error) {
    return { ok: false, error: `Brevo could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}
