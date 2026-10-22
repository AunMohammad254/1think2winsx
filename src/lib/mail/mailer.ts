import { getAdminDb } from '@/lib/supabase/db';
import type { EmailKind } from '@/lib/email-quota';
import { sesConfigured } from './aws';
import { sendViaBrevo } from './providers/brevo';
import { sendViaSes } from './providers/ses';
import type { EmailProviderId, OutgoingEmail, ProviderResult, SendOptions } from './types';

/**
 * Sends every app email through the service an admin selected on the Email services page
 * (AppSettings email_provider: brevo by default, or ses), and writes each one to "EmailLog".
 *
 * There is no automatic fallback: when the selected service fails, the email is reported as failed
 * and the Email services page shows an alert, so an admin can switch to the other service.
 */
const PROVIDER_CACHE_TTL_MS = 60_000;
let providerCache: { value: EmailProviderId; fetchedAt: number } | null = null;

/** The service an admin selected, cached for a minute (so a switch takes effect within a minute). */
export async function selectedProvider(): Promise<EmailProviderId> {
  const now = Date.now();
  if (providerCache && now - providerCache.fetchedAt < PROVIDER_CACHE_TTL_MS) return providerCache.value;
  try {
    const { data, error } = await getAdminDb().from('AppSettings').select('value').eq('key', 'email_provider').maybeSingle();
    if (error) throw error;
    const value: EmailProviderId = data?.value?.trim() === 'ses' ? 'ses' : 'brevo';
    providerCache = { value, fetchedAt: now };
    return value;
  } catch (error) {
    console.error('[mail] Could not read the selected email service:', error);
    return providerCache?.value ?? 'brevo';
  }
}

/** Call after an admin switches service, so this server picks it up at once. */
export function invalidateProviderCache(): void {
  providerCache = null;
}

/**
 * The service emails actually go through: the selected one, except that SES without an access key
 * can't send, so Brevo does (the Email services page says so).
 */
export async function activeProvider(): Promise<EmailProviderId> {
  return (await selectedProvider()) === 'ses' && sesConfigured() ? 'ses' : 'brevo';
}

export function sendThrough(provider: EmailProviderId, email: OutgoingEmail, options: SendOptions = {}): Promise<ProviderResult> {
  return provider === 'ses' ? sendViaSes(email, options) : sendViaBrevo(email, options);
}

export interface EmailLogEntry {
  kind: EmailKind;
  recipient: string;
  subject: string;
  provider: EmailProviderId;
  status: 'accepted' | 'failed';
  providerMessageId: string | null;
  error: string | null;
}

export function logEntry(kind: EmailKind, email: OutgoingEmail, provider: EmailProviderId, result: ProviderResult): EmailLogEntry {
  return {
    kind,
    recipient: email.to.slice(0, 320),
    subject: email.subject.slice(0, 300),
    provider,
    status: result.ok ? 'accepted' : 'failed',
    providerMessageId: result.ok ? result.messageId?.slice(0, 300) ?? null : null,
    error: result.ok ? null : result.error.slice(0, 1000),
  };
}

const LOG_CHUNK = 500;

/** Best effort: a log that can't be written never fails the send. */
export async function writeEmailLog(entries: EmailLogEntry[]): Promise<void> {
  try {
    for (let i = 0; i < entries.length; i += LOG_CHUNK) {
      const { error } = await getAdminDb().from('EmailLog').insert(entries.slice(i, i + LOG_CHUNK));
      if (error) throw error;
    }
  } catch (error) {
    console.error('[mail] Could not write the email log:', error);
  }
}

export type DeliveryResult =
  | { success: true; provider: EmailProviderId; messageId: string | null }
  | { success: false; provider: EmailProviderId; error: string };

/** Sends one email through the active service and logs it. */
export async function deliver(email: OutgoingEmail, { kind, ...options }: SendOptions & { kind: EmailKind }): Promise<DeliveryResult> {
  const provider = await activeProvider();
  const result = await sendThrough(provider, email, options);
  await writeEmailLog([logEntry(kind, email, provider, result)]);
  return result.ok
    ? { success: true, provider, messageId: result.messageId }
    : { success: false, provider, error: result.error };
}
