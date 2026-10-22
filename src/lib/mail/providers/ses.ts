import { awsClient, awsError, sesRegion } from '../aws';
import type { OutgoingEmail, ProviderResult, SendOptions } from '../types';

/**
 * SES errors worth repeating after a pause: rate limits and short outages. ThrottlingException comes
 * back as HTTP 400, so errors are matched by type, not by status. Anything else is final.
 */
const RETRYABLE = new Set(['ThrottlingException', 'TooManyRequestsException', 'InternalFailure', 'ServiceUnavailable']);

/** Plain words for the admin page and the log. */
const REASONS: Record<string, string> = {
  ThrottlingException: 'AWS is throttling sends (the sending rate limit was reached)',
  TooManyRequestsException: 'AWS is throttling sends (too many requests)',
  InternalFailure: 'AWS had an internal error',
  ServiceUnavailable: 'AWS SES is temporarily unavailable',
  RequestTimeoutException: 'AWS took too long to answer',
  SendingPausedException: 'AWS paused sending for this account',
  AccountSuspendedException: 'AWS suspended sending for this account',
  MessageRejected: 'AWS rejected the email',
  MailFromDomainNotVerifiedException: 'The sending domain is not verified in AWS SES',
  NotFoundException: 'The sender address is not verified in AWS SES',
  BadRequestException: 'AWS refused the request',
  UnrecognizedClientException: 'AWS did not accept the access key',
  InvalidSignatureException: 'AWS did not accept the secret key',
  AccessDeniedException: 'The AWS access key is not allowed to send email',
};

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const encodeName = (name: string) => `"${name.replace(/["\\]/g, '')}"`;

/**
 * Sends one email through SES v2 (POST /v2/email/outbound-emails, simple content) in the configured
 * region. Throttling and outages are retried `retries` times with growing pauses (1 s, 2 s, 4 s);
 * a timeout is never retried, because SES may still have taken the email.
 */
export async function sendViaSes(
  email: OutgoingEmail,
  { timeoutMs = 15_000, retries = 0 }: SendOptions = {},
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<ProviderResult> {
  const region = sesRegion();
  const client = awsClient('ses', region);
  if (!client) return { ok: false, error: 'Amazon SES is not configured (the AWS access key is missing)' };

  const headers = Object.entries(email.headers ?? {}).map(([Name, Value]) => ({ Name, Value }));
  const body = JSON.stringify({
    FromEmailAddress: `${encodeName(email.from.name)} <${email.from.email}>`,
    Destination: { ToAddresses: [email.to] },
    Content: {
      Simple: {
        Subject: { Data: email.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: email.html, Charset: 'UTF-8' },
          ...(email.text ? { Text: { Data: email.text, Charset: 'UTF-8' } } : {}),
        },
        ...(headers.length ? { Headers: headers } : {}),
      },
    },
  });

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await client.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError';
      return { ok: false, error: timedOut ? `AWS SES did not answer within ${timeoutMs / 1000} s` : `AWS SES could not be reached: ${(error as Error).message}` };
    }

    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as { MessageId?: string };
      return { ok: true, messageId: data.MessageId ?? null };
    }

    const { type, message } = await awsError(response);
    if (RETRYABLE.has(type) && attempt < retries) {
      await sleep(1_000 * 2 ** attempt);
      continue;
    }
    const reason = REASONS[type] ?? `AWS SES refused the email (${type})`;
    return { ok: false, error: message ? `${reason}: ${message}` : reason };
  }
}
