// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { awsClient, awsError, sesConfigured, sesRegion } from '@/lib/mail/aws';
import { brevoApiKey, sendViaBrevo } from '@/lib/mail/providers/brevo';
import { defaultSleep, sendViaSes } from '@/lib/mail/providers/ses';
import { EMAIL_PROVIDERS, PROVIDER_NAMES } from '@/lib/mail/types';

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
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('provider names', () => {
  it('lists both services with readable names', () => {
    expect(EMAIL_PROVIDERS).toEqual(['ses', 'brevo']);
    expect(PROVIDER_NAMES).toEqual({ ses: 'Amazon SES', brevo: 'Brevo' });
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
    expect(await sendViaBrevo(email)).toEqual({ ok: true, messageId: '<m1@relay>' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('brevo-key');
    expect(JSON.parse(init.body)).toEqual({
      sender: { name: '1Think "2Win"', email: 'support@1think2win.test' },
      to: [{ email: 'fan@example.test' }],
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
    expect(await sendViaSes(email, {}, sleep)).toEqual({ ok: true, messageId: 'ses-1' });
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe('https://email.ap-southeast-2.amazonaws.com/v2/email/outbound-emails');
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/ap-southeast-2\/ses\/aws4_request/);
    expect(JSON.parse(await request.text())).toEqual({
      FromEmailAddress: '"1Think 2Win" <support@1think2win.test>',
      Destination: { ToAddresses: ['fan@example.test'] },
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
