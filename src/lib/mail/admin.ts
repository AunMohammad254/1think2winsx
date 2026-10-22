import { getAdminDb } from '@/lib/supabase/db';
import { getEmailQuotaStatus, type EmailQuotaStatus } from '@/lib/email-quota';
import { sesConfigured, sesRegion } from './aws';
import { activeProvider, invalidateProviderCache, selectedProvider } from './mailer';
import { getAwsCost, getBrevoPlans, getSesAccount, type AwsCostView, type BrevoPlan, type Lookup, type SesAccount } from './status';
import type { EmailProviderId } from './types';

/**
 * Everything the admin Email services page shows, and the one change it makes: which service sends
 * the app's email (and the SES daily limit). Nothing here switches the service by itself.
 */
export interface LogTotal { provider: EmailProviderId; period: '24h' | '30d'; status: string; count: number }

export interface EmailServicesOverview {
  selected: EmailProviderId;
  /** The service emails really go through (Brevo when SES is selected but has no access key) */
  active: EmailProviderId;
  sesConfigured: boolean;
  sesRegion: string;
  limits: { brevo: number; ses: number; reserve: number };
  quota: EmailQuotaStatus | null;
  totals: LogTotal[];
  /** Failed sends through the active service in the last hour */
  recentFailures: { count: number; lastError: string | null; lastAt: string | null };
  ses: Lookup<SesAccount> | null;
  brevo: Lookup<BrevoPlan[]> | null;
  awsCost: AwsCostView;
}

const LIMIT_KEYS = { brevo: 'email_daily_limit', ses: 'email_daily_limit_ses', reserve: 'email_essential_reserve' } as const;
const LIMIT_DEFAULTS = { brevo: 299, ses: 199, reserve: 20 };

async function readLimits(): Promise<EmailServicesOverview['limits']> {
  const { data, error } = await getAdminDb().from('AppSettings').select('key, value').in('key', Object.values(LIMIT_KEYS));
  if (error) throw error;
  const value = (key: string, fallback: number) => {
    const raw = data?.find((row) => row.key === key)?.value?.trim() ?? '';
    return /^[0-9]{1,7}$/.test(raw) ? Number(raw) : fallback;
  };
  return {
    brevo: value(LIMIT_KEYS.brevo, LIMIT_DEFAULTS.brevo),
    ses: value(LIMIT_KEYS.ses, LIMIT_DEFAULTS.ses),
    reserve: value(LIMIT_KEYS.reserve, LIMIT_DEFAULTS.reserve),
  };
}

async function readTotals(): Promise<LogTotal[]> {
  const { data, error } = await getAdminDb().rpc('email_log_totals');
  if (error) throw error;
  return (data ?? []) as LogTotal[];
}

async function readRecentFailures(provider: EmailProviderId, now: Date): Promise<EmailServicesOverview['recentFailures']> {
  const since = new Date(now.getTime() - 60 * 60_000).toISOString();
  const { data, count, error } = await getAdminDb()
    .from('EmailLog')
    .select('error, sentAt', { count: 'exact' })
    .eq('provider', provider)
    .eq('status', 'failed')
    .gte('sentAt', since)
    .order('sentAt', { ascending: false })
    .limit(1);
  if (error) throw error;
  return { count: count ?? 0, lastError: data?.[0]?.error ?? null, lastAt: data?.[0]?.sentAt ?? null };
}

export async function getEmailServicesOverview(now = new Date()): Promise<EmailServicesOverview> {
  const [selected, active] = await Promise.all([selectedProvider(), activeProvider()]);
  const [limits, quota, totals, recentFailures, ses, brevo, awsCost] = await Promise.all([
    readLimits(),
    getEmailQuotaStatus().catch(() => null),
    readTotals(),
    readRecentFailures(active, now),
    getSesAccount(now.getTime()),
    getBrevoPlans(now.getTime()),
    getAwsCost({ now }),
  ]);
  return { selected, active, sesConfigured: sesConfigured(), sesRegion: sesRegion(), limits, quota, totals, recentFailures, ses, brevo, awsCost };
}

export class EmailServicesError extends Error {}

/** Saves an admin's choice of service and/or the SES daily limit. */
export async function updateEmailServices(change: { provider?: EmailProviderId; sesDailyLimit?: number }, adminEmail: string): Promise<void> {
  if (change.provider === 'ses' && !sesConfigured()) {
    throw new EmailServicesError("Amazon SES isn't set up on the server yet: add AWS_SES_ACCESS_KEY_ID and AWS_SES_SECRET_ACCESS_KEY in hPanel, then deploy.");
  }
  const updatedAt = new Date().toISOString();
  const rows = [
    ...(change.provider ? [{ key: 'email_provider', value: change.provider }] : []),
    ...(change.sesDailyLimit !== undefined ? [{ key: LIMIT_KEYS.ses, value: String(change.sesDailyLimit) }] : []),
  ].map((row) => ({ ...row, updatedAt, updatedBy: adminEmail }));
  if (rows.length === 0) return;

  const { error } = await getAdminDb().from('AppSettings').upsert(rows);
  if (error) throw error;
  invalidateProviderCache();
}

export const EMAIL_LOG_PAGE_SIZE = 50;

export interface EmailLogQuery {
  page: number;
  q?: string;
  provider?: EmailProviderId;
  status?: string;
  kind?: string;
}

export interface EmailLogRow {
  id: number;
  sentAt: string;
  kind: string;
  recipient: string;
  subject: string;
  provider: EmailProviderId;
  status: string;
  providerMessageId: string | null;
  error: string | null;
}

/** Characters that would break PostgREST's or=(…) filter or act as wildcards. */
export const cleanSearch = (q: string) => q.replace(/[,()*%\\]/g, ' ').trim().slice(0, 100);

export async function listEmailLog(query: EmailLogQuery): Promise<{ entries: EmailLogRow[]; total: number }> {
  const from = (query.page - 1) * EMAIL_LOG_PAGE_SIZE;
  let request = getAdminDb()
    .from('EmailLog')
    .select('id, sentAt, kind, recipient, subject, provider, status, providerMessageId, error', { count: 'exact' })
    .order('sentAt', { ascending: false })
    .range(from, from + EMAIL_LOG_PAGE_SIZE - 1);
  if (query.provider) request = request.eq('provider', query.provider);
  if (query.status) request = request.eq('status', query.status);
  if (query.kind) request = request.eq('kind', query.kind);
  const q = query.q ? cleanSearch(query.q) : '';
  if (q) request = request.or(`recipient.ilike.*${q}*,subject.ilike.*${q}*`);

  const { data, count, error } = await request;
  if (error) throw error;
  return { entries: (data ?? []) as EmailLogRow[], total: count ?? 0 };
}
