import { getAdminDb } from '@/lib/supabase/db';
import { formatBusinessStart } from '@/lib/schedule-time';

/**
 * The daily email limit (supabase/migrations/20261022140000_email_daily_quota.sql). The Brevo account
 * sends at most 300 emails a day and silently drops the rest, so every email the app sends is counted
 * first: reserve before sending, release when nothing went out. The database holds the count, the
 * limit (AppSettings email_daily_limit, 299) and the reserve kept for password, account and support
 * emails (email_essential_reserve, 20), over a rolling 24 hours.
 */
export type EmailKind = 'registration' | 'newsletter_signup' | 'newsletter' | 'password' | 'account' | 'support';

/** `id` is null when the emails were not counted (see reserveEmails); releasing it does nothing. */
export type EmailReservation =
  | { ok: true; id: number | null }
  | { ok: false; used: number; cap: number; remaining: number; retryAt: string | null };

export interface EmailQuotaStatus {
  used: number;
  limit: number;
  reserve: number;
  /** The cap for registrations and newsletters: limit minus reserve */
  cap: number;
  remaining: number;
  capRemaining: number;
  /** When the oldest counted email stops counting; null when none is counted */
  nextFreeAt: string | null;
}

/**
 * Counts `count` emails of this kind if they fit in the last 24 hours. When the count can't be checked
 * (the migration isn't applied, or the database errors) the email goes out uncounted: refusing every
 * registration over a counting problem would be worse than the odd email Brevo drops.
 */
export async function reserveEmails(kind: EmailKind, count = 1): Promise<EmailReservation> {
  try {
    const { data, error } = await getAdminDb().rpc('reserve_email_quota', { p_kind: kind, p_emails: count });
    if (error) throw error;
    const r = data as { ok: boolean; id?: number; used: number; cap: number; remaining: number; retryAt?: string | null };
    return r.ok
      ? { ok: true, id: r.id ?? null }
      : { ok: false, used: r.used, cap: r.cap, remaining: r.remaining, retryAt: r.retryAt ?? null };
  } catch (error) {
    console.error('[email-quota] Could not check the daily email limit; sending uncounted:', error);
    return { ok: true, id: null };
  }
}

/**
 * Gives back a reservation whose emails didn't go out (keep = 0), or the part of a newsletter that
 * failed (keep = the number Brevo accepted). Best effort: a failure only means the count runs high.
 */
export async function releaseEmails(id: number | null, keep = 0): Promise<void> {
  if (id === null) return;
  try {
    const { error } = await getAdminDb().rpc('release_email_quota', { p_id: id, p_keep: keep });
    if (error) throw error;
  } catch (error) {
    console.error('[email-quota] Could not release reserved emails:', error);
  }
}

/** For the admin newsletter screen. Throws when the status can't be read. */
export async function getEmailQuotaStatus(): Promise<EmailQuotaStatus> {
  const { data, error } = await getAdminDb().rpc('email_quota_status');
  if (error) throw error;
  return data as EmailQuotaStatus;
}

/**
 * "today after 8:15 PM PKT" / "tomorrow after 8:15 PM PKT", in the business time zone (Pakistan by
 * default). Rounded up to the minute, so the time shown is never before the email frees up.
 */
export function retryText(retryAt: string, now: Date = new Date()): string {
  const at = new Date(Math.ceil(Date.parse(retryAt) / 60_000) * 60_000);
  const when = formatBusinessStart(at, now);
  const m = /^(Today|Tomorrow), (.+)$/.exec(when);
  return m ? `${m[1].toLowerCase()} after ${m[2]}` : `after ${when}`;
}

/** What to tell someone whose email didn't fit. */
export function limitMessage(kind: EmailKind, retryAt: string | null, now: Date = new Date()): string {
  const again = retryAt ? `Please try again ${retryText(retryAt, now)}.` : 'Please try again tomorrow.';
  return kind === 'registration'
    ? `Today's registration limit has been reached. ${again}`
    : `Today's email limit has been reached, so we can't send this email right now. ${again}`;
}
