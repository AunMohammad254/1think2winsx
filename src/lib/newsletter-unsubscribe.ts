/**
 * Signed newsletter unsubscribe links.
 *
 * The token is an HMAC of the lowercased email, so links can't be forged for other
 * addresses and no per-subscriber token needs to be stored.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function getSecret(): string {
  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('NEWSLETTER_UNSUBSCRIBE_SECRET is missing or shorter than 32 characters');
  }
  return secret;
}

export function createUnsubscribeToken(email: string): string {
  return createHmac('sha256', getSecret()).update(email.trim().toLowerCase()).digest('base64url');
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  if (!email || !token) return false;
  const expected = Buffer.from(createUnsubscribeToken(email));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** Link for the email footer: opens a confirmation page (link scanners must not unsubscribe people). */
export function buildUnsubscribePageUrl(email: string): string {
  const e = email.trim().toLowerCase();
  return `${siteUrl()}/unsubscribe?e=${encodeURIComponent(e)}&t=${createUnsubscribeToken(e)}`;
}

/** Target of the RFC 8058 List-Unsubscribe-Post one-click header (mail providers POST here). */
export function buildOneClickUnsubscribeUrl(email: string): string {
  const e = email.trim().toLowerCase();
  return `${siteUrl()}/api/newsletter/unsubscribe?e=${encodeURIComponent(e)}&t=${createUnsubscribeToken(e)}`;
}
