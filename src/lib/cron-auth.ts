import { timingSafeEqual } from 'node:crypto';

/**
 * Does the `Authorization` header carry `Bearer <CRON_SECRET>`?
 *
 * Constant-time comparison, and header-only on purpose: a secret passed as `?secret=...` ends up in
 * access logs, proxy logs and browser history, so the query-string form is no longer accepted.
 * Returns false when CRON_SECRET is not configured (callers decide what "unconfigured" means).
 */
export function hasValidCronSecret(authorizationHeader: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(authorizationHeader || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
