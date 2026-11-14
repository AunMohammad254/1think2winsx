// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { awsClient, awsError, sesConfigured, sesRegion } from '@/lib/mail/aws';
import { brevoApiKey, sendViaBrevo } from '@/lib/mail/providers/brevo';
import { cloudflareConfigured, cloudflareCredentials, sendViaCloudflare } from '@/lib/mail/providers/cloudflare';
import { defaultSleep, sendViaSes } from '@/lib/mail/providers/ses';
import { EMAIL_PROVIDERS, isEmailProvider, PROVIDER_NAMES } from '@/lib/mail/types';

const email = {
  from: { email: 'support@1think2win.test', name: '1Think "2Win"' },
  to: 'fan@example.test',
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
  headers: { 'List-Unsubscribe': '<https://x.test/u>' },
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('AWS_SES_ACCESS_KEY_ID', 'AKIDTEST');
  vi.stubEnv('AWS_SES_SECRET_ACCESS_KEY', 'secret');
  vi.stubEnv('AWS_SES_REGION', '');
  vi.stubEnv('BREVO_API_KEY', 'brevo-key');
  vi.stubEnv('CLOUDFLARE_EMAIL_ACCOUNT_ID', 'acc123');
  vi.stubEnv('CLOUDFLARE_EMAIL_API_TOKEN', 'cf-token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('provider names', () => {
  it('lists the three services in fallback order, with readable names', () => {
    expect(EMAIL_PROVIDERS).toEqual(['ses', 'brevo', 'cloudflare']);
    expect(PROVIDER_NAMES).toEqual({ ses: 'Amazon SES', brevo: 'Brevo', cloudflare: 'Cloudflare' });
  });

  it('knows a service id when it sees one', () => {
    expect(['ses', 'brevo', 'cloudflare'].every(isEmailProvider)).toBe(true);
    expect([' ses', 'mailgun', undefined, null, 1].some(isEmailProvider)).toBe(false);
  });
});

describe('Cloudflare', () => {
  const cfSent = (result: Record<string, unknown> = {}) =>
    json({ success: true, errors: [], messages: [], result: { message_id: '<cf-1@1think2win.com>', delivered: ['fan@example.test'], queued: [], permanent_bounces: [], suppressed_recipients: [], ...result } });

  it('needs both the account id and the token', () => {
    expect(cloudflareCredentials()).toEqual({ accountId: 'acc123', token: 'cf-token' });
    expect(cloudflareConfigured()).toBe(true);
    vi.stubEnv('CLOUDFLARE_EMAIL_API_TOKEN', ' ');
    expect(cloudflareCredentials()).toBeNull();
    expect(cloudflareConfigured()).toBe(false);
    vi.stubEnv('CLOUDFLARE_EMAIL_API_TOKEN', 'cf-token');
    vi.stubEnv('CLOUDFLARE_EMAIL_ACCOUNT_ID', '');
    expect(cloudflareConfigured()).toBe(false);
  });

  it('sends one email through the REST API with its headers and returns the message id', async () => {
    fetchMock.mockResolvedValue(cfSent());
    expect(await sendViaCloudflare({ ...email, replyTo: 'help@example.test' })).toEqual({ ok: true, messageId: '<cf-1@1think2win.com>' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/email/sending/send');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer cf-token');
    expect(JSON.parse(init.body)).toEqual({
      from: { address: 'support@1think2win.test', name: '1Think "2Win"' },
      to: 'fan@example.test',
      reply_to: 'help@example.test',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
      headers: { 'List-Unsubscribe': '<https://x.test/u>' },
    });
  });

  it('leaves out the text part and headers when there are none, and takes a queued email', async () => {
    fetchMock.mockResolvedValue(json({ success: true, result: { delivered: [], queued: ['fan@example.test'] } }));
    expect(await sendViaCloudflare({ ...email, text: undefined, headers: undefined })).toEqual({ ok: true, messageId: null });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('text');
    expect(body).not.toHaveProperty('headers');
    expect(body).not.toHaveProperty('reply_to');
    fetchMock.mockResolvedValue(json({ success: true, result: null }));
    expect(await sendViaCloudflare(email)).toEqual({ ok: true, messageId: null });
  });

  it('counts a bounced or suppressed address as failed', async () => {
    fetchMock.mockResolvedValueOnce(cfSent({ delivered: [], permanent_bounces: ['fan@example.test'] }));
    expect(await sendViaCloudflare(email)).toEqual({ ok: false, error: 'The address bounced: the mailbox does not exist or refused the email' });
    fetchMock.mockResolvedValueOnce(cfSent({ delivered: [], suppressed_recipients: ['fan@example.test'] }));
    expect(await sendViaCloudflare(email)).toEqual({
      ok: false, error: 'Cloudflare did not send it: the address is on its suppression list (it bounced or complained before)',
    });
  });

  it('explains a refusal in plain words, by error code', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, errors: [{ code: 10105, message: 'authentication.not_entitled' }], result: null }, 403));
    expect(await sendViaCloudflare(email)).toEqual({
      ok: false, error: 'This Cloudflare account has no Email Sending (it needs the Workers Paid plan): authentication.not_entitled',
    });
    fetchMock.mockResolvedValueOnce(json({ success: false, errors: [{ code: 10203 }] }, 403));
    expect(await sendViaCloudflare(email)).toEqual({ ok: false, error: 'Email Sending is turned off for this domain or account' });
    fetchMock.mockResolvedValueOnce(json({ success: false, errors: [{ code: 99999, message: 'odd' }] }, 400));
    expect(await sendViaCloudflare(email)).toEqual({ ok: false, error: 'Cloudflare refused the email (400): odd' });
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await sendViaCloudflare(email)).toEqual({ ok: false, error: 'Cloudflare refused the email (502)' });
    fetchMock.mockResolvedValueOnce(json({ success: false, errors: [] }, 200));
    expect(await sendViaCloudflare(email)).toEqual({ ok: false, error: 'Cloudflare refused the email (200)' });
  });

  it('retries throttling and its auth outage, but never a 500', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetchMock
      .mockResolvedValueOnce(json({ success: false, errors: [{ code: 10004, message: 'throttled' }] }, 429))
      .mockResolvedValueOnce(json({ success: false, errors: [{ code: 10100 }] }, 503))
      .mockResolvedValueOnce(cfSent());
    expect(await sendViaCloudflare(email, { retries: 3 })).toEqual({ ok: true, messageId: '<cf-1@1think2win.com>' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockReset().mockResolvedValue(json({ success: false, errors: [{ code: 10002, message: 'internal_server' }] }, 500));
    expect(await sendViaCloudflare(email, { retries: 3 })).toEqual({ ok: false, error: 'Cloudflare refused the email (500): internal_server' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset().mockResolvedValue(json({ success: false, errors: [{ code: 10004, message: 'throttled' }] }, 429));
    expect(await sendViaCloudflare(email, { retries: 1 })).toEqual({ ok: false, error: 'Cloudflare is throttling sends (the rate limit was reached): throttled' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a timeout without retrying, an unreachable Cloudflare and missing keys', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    expect(await sendViaCloudflare(email, { timeoutMs: 3500, retries: 3 })).toEqual({ ok: false, error: 'Cloudflare could not be reached: The operation was aborted due to timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce('socket hang up');
    expect(await sendViaCloudflare(email)).toEqual({ ok: false, error: 'Cloudflare could not be reached: socket hang up' });
    vi.stubEnv('CLOUDFLARE_EMAIL_ACCOUNT_ID', '');
    expect(await sendViaCloudflare(email)).toEqual({
      ok: false, error: 'Cloudflare is not configured (CLOUDFLARE_EMAIL_ACCOUNT_ID or CLOUDFLARE_EMAIL_API_TOKEN is missing)',
    });
  });
});

describe('AWS access', () => {
  it('uses Sydney unless AWS_SES_REGION says otherwise', () => {
    expect(sesRegion()).toBe('ap-southeast-2');
    vi.stubEnv('AWS_SES_REGION', ' us-west-2 ');
    expect(sesRegion()).toBe('us-west-2');
  });

  it('needs both halves of the access key', () => {
    expect(sesConfigured()).toBe(true);
    expect(awsClient('ses', 'ap-southeast-2')).not.toBeNull();
    vi.stubEnv('AWS_SES_SECRET_ACCESS_KEY', ' ');
    expect(sesConfigured()).toBe(false);
    expect(awsClient('ce', 'us-east-1')).toBeNull();
  });

  it('reads the error type from the header or the body', async () => {
    expect(await awsError(json({ message: 'Slow down' }, 400, { 'x-amzn-ErrorType': 'ThrottlingException:http://internal.amazon.com/' }))).toEqual({ type: 'ThrottlingException', message: 'Slow down' });
    expect(await awsError(json({ __type: 'com.amazonaws#DataUnavailableException', Message: 'No data' }, 400))).toEqual({ type: 'DataUnavailableException', message: 'No data' });
    expect(await awsError(json({ code: 'AccessDeniedException' }, 403))).toEqual({ type: 'AccessDeniedException', message: '' });
    expect(await awsError(json({ Code: 'Other' }, 400))).toEqual({ type: 'Other', message: '' });
    expect(await awsError(new Response('<html>', { status: 502 }))).toEqual({ type: 'HTTP 502', message: '' });
  });
});

describe('Brevo', () => {
  it('reads BREVO_API_KEY, or the legacy base64 key, or nothing', () => {
    expect(brevoApiKey()).toBe('brevo-key');
    vi.stubEnv('BREVO_API_KEY', '');
    vi.stubEnv('Bravo-MCP-API-key', Buffer.from(JSON.stringify({ api_key: 'legacy' })).toString('base64'));
    expect(brevoApiKey()).toBe('legacy');
    vi.stubEnv('Bravo-MCP-API-key', '');
    expect(brevoApiKey()).toBeNull();
  });

  it('sends one email with its headers and returns the message id', async () => {
    fetchMock.mockResolvedValue(json({ messageId: '<m1@relay>' }, 201));
    expect(await sendViaBrevo({ ...email, replyTo: 'help@example.test' })).toEqual({ ok: true, messageId: '<m1@relay>' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('brevo-key');
    expect(JSON.parse(init.body)).toEqual({
      sender: { name: '1Think "2Win"', email: 'support@1think2win.test' },
      to: [{ email: 'fan@example.test' }],
      replyTo: { email: 'help@example.test' },
      subject: 'Hello',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
      headers: { 'List-Unsubscribe': '<https://x.test/u>' },
    });
  });

  it('fills a text part and leaves out headers when there are none', async () => {
    fetchMock.mockResolvedValue(json({}, 201));
    expect(await sendViaBrevo({ ...email, text: undefined, headers: undefined })).toEqual({ ok: true, messageId: null });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.textContent).toBe('Please use an HTML compatible email client.');
    expect(body).not.toHaveProperty('headers');
    expect(body).not.toHaveProperty('replyTo');
  });

  it('reports a refusal, a missing key and an unreachable Brevo', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'unauthorized sender' }, 400));
    expect(await sendViaBrevo(email)).toEqual({ ok: false, error: 'Brevo refused the email (400): unauthorized sender' });
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await sendViaBrevo(email)).toEqual({ ok: false, error: 'Brevo could not be reached: ECONNRESET' });
    vi.stubEnv('BREVO_API_KEY', '');
    expect(await sendViaBrevo(email)).toEqual({ ok: false, error: 'Brevo is not configured (BREVO_API_KEY is missing)' });
  });
});

describe('Amazon SES', () => {
  const sleep = vi.fn(async () => {});
  beforeEach(() => sleep.mockClear());

  it('signs a SES v2 request in Sydney and returns the message id', async () => {
    fetchMock.mockResolvedValue(json({ MessageId: 'ses-1' }));
    expect(await sendViaSes({ ...email, replyTo: 'help@example.test' }, {}, sleep)).toEqual({ ok: true, messageId: 'ses-1' });
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe('https://email.ap-southeast-2.amazonaws.com/v2/email/outbound-emails');
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/ap-southeast-2\/ses\/aws4_request/);
    expect(JSON.parse(await request.text())).toEqual({
      FromEmailAddress: '"1Think 2Win" <support@1think2win.test>',
      Destination: { ToAddresses: ['fan@example.test'] },
      ReplyToAddresses: ['help@example.test'],
      Content: {
        Simple: {
          Subject: { Data: 'Hello', Charset: 'UTF-8' },
          Body: { Html: { Data: '<p>Hi</p>', Charset: 'UTF-8' }, Text: { Data: 'Hi', Charset: 'UTF-8' } },
          Headers: [{ Name: 'List-Unsubscribe', Value: '<https://x.test/u>' }],
        },
      },
    });
  });

  it('leaves out the text part and headers when there are none', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    expect(await sendViaSes({ ...email, text: undefined, headers: undefined })).toEqual({ ok: true, messageId: null });
    const body = JSON.parse(await (fetchMock.mock.calls[0][0] as Request).text());
    expect(body.Content.Simple).not.toHaveProperty('Headers');
    expect(body).not.toHaveProperty('ReplyToAddresses');
    expect(body.Content.Simple.Body).not.toHaveProperty('Text');
  });

  it('retries throttling with growing pauses, then sends', async () => {
    const throttled = () => json({ message: 'Maximum sending rate exceeded.' }, 400, { 'x-amzn-ErrorType': 'ThrottlingException' });
    fetchMock.mockResolvedValueOnce(throttled()).mockResolvedValueOnce(throttled()).mockResolvedValueOnce(json({ MessageId: 'ses-2' }));
    expect(await sendViaSes(email, { retries: 3 }, sleep)).toEqual({ ok: true, messageId: 'ses-2' });
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it('gives up after the retries, in plain words', async () => {
    fetchMock.mockImplementation(async () => json({ message: 'Maximum sending rate exceeded.' }, 400, { 'x-amzn-ErrorType': 'ThrottlingException' }));
    expect(await sendViaSes(email, { retries: 1 }, sleep)).toEqual({
      ok: false,
      error: 'AWS is throttling sends (the sending rate limit was reached): Maximum sending rate exceeded.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a final refusal', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 400, { 'x-amzn-ErrorType': 'SendingPausedException' }));
    expect(await sendViaSes(email, { retries: 3 }, sleep)).toEqual({ ok: false, error: 'AWS paused sending for this account' });
    fetchMock.mockResolvedValueOnce(json({ message: 'odd' }, 400, { 'x-amzn-ErrorType': 'SomethingNewException' }));
    expect(await sendViaSes(email, { retries: 3 }, sleep)).toEqual({ ok: false, error: 'AWS SES refused the email (SomethingNewException): odd' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('reports a timeout, an unreachable AWS and a missing key', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }));
    expect(await sendViaSes(email, { timeoutMs: 3500 })).toEqual({ ok: false, error: 'AWS SES did not answer within 3.5 s' });
    fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
    expect(await sendViaSes(email)).toEqual({ ok: false, error: 'AWS SES could not be reached: getaddrinfo ENOTFOUND' });
    vi.stubEnv('AWS_SES_ACCESS_KEY_ID', '');
    expect(await sendViaSes(email)).toEqual({ ok: false, error: 'Amazon SES is not configured (the AWS access key is missing)' });
  });

  it('pauses for real by default', async () => {
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      defaultSleep(1000).then(done);
      await vi.advanceTimersByTimeAsync(999);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
