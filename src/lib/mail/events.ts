import crypto from 'node:crypto';

/**
 * Delivery, bounce and complaint notices from the two services, turned into an update of the matching
 * "EmailLog" row (record_email_event). SES sends them through an SNS topic, whose messages are signed
 * by AWS; Brevo calls a webhook and sends a bearer token we chose (it doesn't sign).
 *
 * Soft bounces are ignored: the service keeps trying, and the email may still arrive.
 */
export type EmailEvent = { messageId: string; status: 'delivered' | 'bounced' | 'complained'; reason: string | null };

// ─── SNS ──────────────────────────────────────────────────────────────────────

export interface SnsMessage {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

/** True only for an https URL on an SNS host, e.g. https://sns.ap-southeast-2.amazonaws.com/… */
export function isSnsUrl(raw: string | undefined): boolean {
  try {
    const url = new URL(raw ?? '');
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

const certCache = new Map<string, string>();

/** The signing certificate, fetched once per URL. */
export async function fetchSnsCertificate(url: string): Promise<string> {
  const cached = certCache.get(url);
  if (cached) return cached;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const pem = await response.text();
  if (!response.ok || !pem.startsWith('-----BEGIN CERTIFICATE-----')) {
    throw new Error(`Could not fetch the SNS signing certificate (${response.status})`);
  }
  certCache.set(url, pem);
  return pem;
}

/** The text AWS signed: chosen fields as "Name\nvalue\n", in byte order (Subject only when present). */
export function snsStringToSign(message: SnsMessage): string {
  const fields: (keyof SnsMessage)[] = message.Type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields.filter((name) => message[name] !== undefined).map((name) => `${name}\n${message[name]}\n`).join('');
}

/**
 * True when AWS signed this message: its certificate URL is on an SNS host and ends in .pem, and the
 * signature (SHA256 for SignatureVersion 2, SHA1 for 1) matches.
 */
export async function verifySnsMessage(message: SnsMessage, getCertificate = fetchSnsCertificate): Promise<boolean> {
  if (!isSnsUrl(message.SigningCertURL) || !new URL(message.SigningCertURL).pathname.endsWith('.pem')) return false;
  const algorithm = message.SignatureVersion === '2' ? 'sha256' : message.SignatureVersion === '1' ? 'sha1' : null;
  if (!algorithm || typeof message.Signature !== 'string') return false;
  const certificate = await getCertificate(message.SigningCertURL);
  return crypto.verify(algorithm, Buffer.from(snsStringToSign(message)), certificate, Buffer.from(message.Signature, 'base64'));
}

/** An SES notice (identity feedback "notificationType", or configuration-set "eventType"). */
export function sesEvent(raw: string): EmailEvent | null {
  let notice: Record<string, any>;
  try {
    notice = JSON.parse(raw);
  } catch {
    return null;
  }
  const messageId = notice?.mail?.messageId;
  if (typeof messageId !== 'string') return null;
  switch (notice.notificationType ?? notice.eventType) {
    case 'Delivery':
      return { messageId, status: 'delivered', reason: null };
    case 'Bounce': {
      if (notice.bounce?.bounceType !== 'Permanent') return null;
      const reason = notice.bounce?.bouncedRecipients?.[0]?.diagnosticCode || `Permanent bounce (${notice.bounce?.bounceSubType ?? 'General'})`;
      return { messageId, status: 'bounced', reason };
    }
    case 'Complaint':
      return { messageId, status: 'complained', reason: 'Marked as spam by the recipient' };
    default:
      return null;
  }
}

// ─── Brevo ────────────────────────────────────────────────────────────────────

/** A Brevo transactional webhook event. */
export function brevoEvent(body: Record<string, unknown>): EmailEvent | null {
  const messageId = body['message-id'];
  if (typeof messageId !== 'string' || !messageId) return null;
  const reason = typeof body.reason === 'string' && body.reason ? body.reason : null;
  switch (body.event) {
    case 'delivered':
      return { messageId, status: 'delivered', reason: null };
    case 'hard_bounce':
      return { messageId, status: 'bounced', reason: reason ?? 'Hard bounce' };
    case 'blocked':
      return { messageId, status: 'bounced', reason: reason ? `Blocked by Brevo: ${reason}` : 'Blocked by Brevo' };
    case 'spam':
      return { messageId, status: 'complained', reason: 'Marked as spam by the recipient' };
    default:
      return null;
  }
}

/** Compares a presented token with the expected one in constant time. */
export function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
