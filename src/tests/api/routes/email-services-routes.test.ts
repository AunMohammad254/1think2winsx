// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'standardwebhooks';
import { createSupabaseMock, makeRequest, type SupabaseMock } from '@/tests/helpers/supabase-mock';
import { signedSns, SNS_TOPIC, testSnsPublicKey } from '@/tests/helpers/sns';

let db: SupabaseMock;
const h = vi.hoisted(() => ({
  deliver: vi.fn(),
  validateAdminSession: vi.fn(),
  requireCSRFToken: vi.fn(),
  getEmailServicesOverview: vi.fn(),
  updateEmailServices: vi.fn(),
  listEmailLog: vi.fn(),
  getAwsCost: vi.fn(),
  fetchSnsCertificate: vi.fn(),
}));
// The SNS signing certificate download, answered with the test public key
vi.mock('@/lib/mail/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mail/events')>()),
  fetchSnsCertificate: h.fetchSnsCertificate,
}));
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => db.client }));
vi.mock('@/lib/mail/mailer', () => ({ deliver: h.deliver }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: h.validateAdminSession }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: h.requireCSRFToken }));
vi.mock('@/lib/mail/status', () => ({ getAwsCost: h.getAwsCost }));
vi.mock('@/lib/mail/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mail/admin')>()),
  getEmailServicesOverview: h.getEmailServicesOverview,
  updateEmailServices: h.updateEmailServices,
  listEmailLog: h.listEmailLog,
}));

const hook = await import('@/app/api/auth/send-email-hook/route');
const sesWebhook = await import('@/app/api/webhooks/ses/route');
const brevoWebhook = await import('@/app/api/webhooks/brevo/route');
const services = await import('@/app/api/admin/email-services/route');
const refresh = await import('@/app/api/admin/email-services/refresh-billing/route');
const emailLog = await import('@/app/api/admin/email-log/route');
const { EmailServicesError } = await import('@/lib/mail/admin');

const SECRET = Buffer.from('hook-secret-for-tests-0123456789').toString('base64');

beforeEach(() => {
  db = createSupabaseMock();
  for (const fn of Object.values(h)) fn.mockReset();
  h.deliver.mockResolvedValue({ success: true, provider: 'ses', messageId: 'm1' });
  h.validateAdminSession.mockResolvedValue({ valid: true, email: 'boss@example.test' });
  h.requireCSRFToken.mockResolvedValue(null);
  h.fetchSnsCertificate.mockResolvedValue(testSnsPublicKey);
  vi.stubEnv('SEND_EMAIL_HOOK_SECRET', `v1,whsec_${SECRET}`);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co');
  vi.stubEnv('BREVO_SENDER_EMAIL', 'support@1think2win.test');
  vi.stubEnv('AWS_SES_SNS_TOPIC_ARN', SNS_TOPIC);
  vi.stubEnv('BREVO_WEBHOOK_TOKEN', 'brevo-token');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Send Email Hook ─────────────────────────────────────────────────────────

function hookRequest(payload: unknown, { secret = SECRET, timestamp = new Date() } = {}) {
  const body = JSON.stringify(payload);
  const id = 'msg_1';
  const signature = new Webhook(secret).sign(id, timestamp, body);
  return new NextRequest('http://localhost/api/auth/send-email-hook', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)), 'webhook-signature': signature },
  });
}
const signup = {
  user: { email: 'fan@example.test' },
  email_data: { email_action_type: 'signup', token: '1', token_hash: 'pkce_h', redirect_to: 'https://1think2win.test/auth/callback', site_url: 'https://1think2win.test' },
};

describe('POST /api/auth/send-email-hook', () => {
  it('sends the email Supabase asks for through the mailer, within the time limit', async () => {
    const res = await hook.POST(hookRequest(signup));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    const [message, options] = h.deliver.mock.calls[0];
    expect(message).toMatchObject({ from: { email: 'support@1think2win.test', name: '1Think 2Win' }, to: 'fan@example.test', subject: 'Confirm your 1Think 2Win account' });
    expect(message.html).toContain('https://ref.supabase.co/auth/v1/verify?token=pkce_h&amp;type=signup');
    expect(options).toEqual({ kind: 'registration', timeoutMs: 3500 });
  });

  it('sends both emails of a secure email change, and uses the default sender', async () => {
    vi.stubEnv('BREVO_SENDER_EMAIL', '');
    await hook.POST(hookRequest({ user: { email: 'old@x.test', new_email: 'new@x.test' }, email_data: { email_action_type: 'email_change', token_hash: 'a', token_hash_new: 'b' } }));
    expect(h.deliver.mock.calls.map(([m]) => [m.to, m.from.email])).toEqual([['old@x.test', 'support@1think2win.com'], ['new@x.test', 'support@1think2win.com']]);
  });

  it('passes a failed send back to Supabase as an error it shows the person', async () => {
    h.deliver.mockResolvedValue({ success: false, provider: 'ses', error: 'AWS paused sending' });
    const res = await hook.POST(hookRequest(signup));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: { http_code: 500, message: 'Unable to send the email right now. Please try again in a few minutes.' } });
  });

  it('refuses a bad signature, another secret and an old timestamp', async () => {
    const tampered = hookRequest(signup);
    const forged = new NextRequest(tampered.url, { method: 'POST', body: JSON.stringify({ ...signup, user: { email: 'evil@x.test' } }), headers: tampered.headers });
    expect((await hook.POST(forged)).status).toBe(401);
    expect((await hook.POST(hookRequest(signup, { secret: Buffer.from('another-secret-0123456789abcdef').toString('base64') }))).status).toBe(401);
    expect((await hook.POST(hookRequest(signup, { timestamp: new Date(Date.now() - 10 * 60_000) }))).status).toBe(401);
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it('accepts the secret without the v1,whsec_ prefix too', async () => {
    vi.stubEnv('SEND_EMAIL_HOOK_SECRET', SECRET);
    expect((await hook.POST(hookRequest(signup))).status).toBe(200);
  });

  it('answers with an error when not configured, or for an unknown email type', async () => {
    const unknown = await hook.POST(hookRequest({ ...signup, email_data: { email_action_type: 'sms' } }));
    expect(await unknown.json()).toEqual({ error: { http_code: 400, message: 'Unable to send the email: this email type is not supported.' } });
    vi.stubEnv('SEND_EMAIL_HOOK_SECRET', '');
    expect(await (await hook.POST(hookRequest(signup))).json()).toEqual({ error: { http_code: 500, message: 'Unable to send the email: the email hook is not configured.' } });
    vi.stubEnv('SEND_EMAIL_HOOK_SECRET', SECRET);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect((await (await hook.POST(hookRequest(signup))).json()).error.http_code).toBe(500);
  });
});

// ─── SES notices (SNS) ───────────────────────────────────────────────────────

const snsPost = (body: unknown) => sesWebhook.POST(new NextRequest('http://localhost/api/webhooks/ses', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'text/plain' } }));
const bounce = JSON.stringify({ notificationType: 'Bounce', mail: { messageId: 'ses-9' }, bounce: { bounceType: 'Permanent', bouncedRecipients: [{ diagnosticCode: '550 no such user' }] } });

/** AWS's subscription confirmation link, as the route sees it. */
function stubAws(confirm: () => Promise<Response> = async () => new Response('<ConfirmSubscriptionResponse/>')) {
  const fetchMock = vi.fn(confirm);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('POST /api/webhooks/ses', () => {
  it('checks the AWS signature and records a permanent bounce', async () => {
    stubAws();
    db.setRpc('record_email_event', { data: 1 });
    const res = await snsPost(signedSns({ Message: bounce }));
    expect(res.status).toBe(200);
    expect(db.rpcCalls).toEqual([{ fn: 'record_email_event', args: { p_provider: 'ses', p_message_id: 'ses-9', p_status: 'bounced', p_error: '550 no such user' } }]);
  });

  it('confirms the subscription by visiting its SNS link, once signed', async () => {
    const fetchMock = stubAws();
    const confirmation = signedSns({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.ap-southeast-2.amazonaws.com/?Action=ConfirmSubscription&Token=t', Token: 't', Message: 'You have chosen to subscribe' });
    const res = await snsPost(confirmation);
    expect(await res.json()).toEqual({ confirmed: true });
    expect(fetchMock).toHaveBeenCalledWith('https://sns.ap-southeast-2.amazonaws.com/?Action=ConfirmSubscription&Token=t', expect.anything());
  });

  it('refuses a confirmation link off AWS, and reports one that fails', async () => {
    stubAws(async () => new Response('denied', { status: 403 }));
    const elsewhere = signedSns({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://evil.test/confirm', Token: 't' });
    expect((await snsPost(elsewhere)).status).toBe(400);
    const good = signedSns({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.ap-southeast-2.amazonaws.com/?Action=ConfirmSubscription', Token: 't' });
    expect((await snsPost(good)).status).toBe(500);
    stubAws(async () => { throw new Error('offline'); });
    expect((await snsPost(good)).status).toBe(500);
  });

  it('ignores other message types and notices it has no use for', async () => {
    stubAws();
    expect(await (await snsPost(signedSns({ Type: 'UnsubscribeConfirmation', SubscribeURL: 'https://sns.ap-southeast-2.amazonaws.com/x', Token: 't' }))).json()).toEqual({ ok: true });
    expect(await (await snsPost(signedSns({ Message: JSON.stringify({ eventType: 'Open', mail: { messageId: 'x' } }) }))).json()).toEqual({ ok: true, ignored: true });
    expect(db.rpcCalls).toEqual([]);
  });

  it('refuses a forged message, another topic and bad JSON', async () => {
    stubAws();
    expect((await snsPost({ ...signedSns({ Message: bounce }), Message: '{"forged":true}' })).status).toBe(403);
    expect((await snsPost(signedSns({ TopicArn: 'arn:aws:sns:ap-southeast-2:999:other', Message: bounce }))).status).toBe(403);
    expect((await snsPost('not json')).status).toBe(400);
    expect((await snsPost('null')).status).toBe(403);
    expect(db.rpcCalls).toEqual([]);
  });

  it('answers 500 (so SNS retries) when the certificate or the database fails', async () => {
    h.fetchSnsCertificate.mockRejectedValueOnce(new Error('Could not fetch the SNS signing certificate (404)'));
    expect((await snsPost(signedSns({ Message: bounce }))).status).toBe(500);
    expect(h.fetchSnsCertificate).toHaveBeenCalledWith('https://sns.ap-southeast-2.amazonaws.com/SimpleNotificationService-abc.pem');
    db.setRpc('record_email_event', { error: { message: 'db down' } });
    expect((await snsPost(signedSns({ Message: bounce }))).status).toBe(500);
  });

  it('is off until the topic is configured', async () => {
    vi.stubEnv('AWS_SES_SNS_TOPIC_ARN', '');
    expect((await snsPost(signedSns({ Message: bounce }))).status).toBe(503);
  });
});

// ─── Brevo notices ───────────────────────────────────────────────────────────

const brevoPost = (body: unknown, token: string | null = 'brevo-token') =>
  brevoWebhook.POST(new NextRequest('http://localhost/api/webhooks/brevo', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }));

describe('POST /api/webhooks/brevo', () => {
  it('records each event it knows, with the bearer token', async () => {
    db.setRpc('record_email_event', { data: 1 });
    const res = await brevoPost([{ event: 'hard_bounce', 'message-id': '<m1@relay>', reason: 'no mailbox' }, { event: 'opened', 'message-id': '<m1@relay>' }, null]);
    expect(await res.json()).toEqual({ ok: true, recorded: 1 });
    expect(db.rpcCalls).toEqual([{ fn: 'record_email_event', args: { p_provider: 'brevo', p_message_id: '<m1@relay>', p_status: 'bounced', p_error: 'no mailbox' } }]);
    expect(await (await brevoPost({ event: 'delivered', 'message-id': 'm2' })).json()).toEqual({ ok: true, recorded: 1 });
  });

  it('refuses a wrong or missing token, and bad JSON', async () => {
    expect((await brevoPost({ event: 'delivered', 'message-id': 'm' }, 'wrong')).status).toBe(401);
    expect((await brevoPost({ event: 'delivered', 'message-id': 'm' }, null)).status).toBe(401);
    expect((await brevoPost('not json')).status).toBe(400);
    expect(db.rpcCalls).toEqual([]);
  });

  it('answers 500 when the database fails, and 503 until configured', async () => {
    db.setRpc('record_email_event', { error: { message: 'db down' } });
    expect((await brevoPost({ event: 'spam', 'message-id': 'm' })).status).toBe(500);
    vi.stubEnv('BREVO_WEBHOOK_TOKEN', '');
    expect((await brevoPost({ event: 'spam', 'message-id': 'm' })).status).toBe(503);
  });
});

// ─── Admin endpoints ─────────────────────────────────────────────────────────

describe('/api/admin/email-services', () => {
  const put = (body: unknown) => services.PUT(makeRequest('/api/admin/email-services', { method: 'PUT', body }));

  it('returns the overview to an admin', async () => {
    h.getEmailServicesOverview.mockResolvedValue({ selected: 'brevo' });
    const res = await services.GET(makeRequest('/api/admin/email-services'));
    expect(await res.json()).toEqual({ success: true, overview: { selected: 'brevo' } });
  });

  it('saves a switch or a limit with the admin as the author', async () => {
    expect(await (await put({ provider: 'ses' })).json()).toEqual({ success: true });
    expect(h.updateEmailServices).toHaveBeenCalledWith({ provider: 'ses' }, 'boss@example.test');
    await put({ sesDailyLimit: 45000 });
    expect(h.updateEmailServices).toHaveBeenLastCalledWith({ sesDailyLimit: 45000 }, 'boss@example.test');
  });

  it('refuses an empty or invalid change', async () => {
    for (const body of [{}, { provider: 'mailgun' }, { sesDailyLimit: 0 }, { sesDailyLimit: 1.5 }]) {
      expect((await put(body)).status).toBe(400);
    }
    expect((await (await services.PUT(makeRequest('/x', { method: 'PUT', rawBody: 'nope' }))).json()).message).toBe('Invalid input: expected object, received null');
    expect(h.updateEmailServices).not.toHaveBeenCalled();
  });

  it('explains why SES cannot be picked, and reports other failures', async () => {
    h.updateEmailServices.mockRejectedValueOnce(new EmailServicesError("Amazon SES isn't set up"));
    expect(await (await put({ provider: 'ses' })).json()).toEqual({ success: false, message: "Amazon SES isn't set up" });
    h.updateEmailServices.mockRejectedValueOnce(new Error('db'));
    expect((await put({ provider: 'brevo' })).status).toBe(500);
    h.getEmailServicesOverview.mockRejectedValueOnce(new Error('db'));
    expect((await services.GET(makeRequest('/x'))).status).toBe(500);
  });

  it('needs an admin and a CSRF token', async () => {
    h.validateAdminSession.mockResolvedValue({ valid: false });
    expect((await services.GET(makeRequest('/x'))).status).toBe(401);
    expect((await put({ provider: 'ses' })).status).toBe(401);
    h.requireCSRFToken.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await services.GET(makeRequest('/x'))).status).toBe(403);
    expect((await put({ provider: 'ses' })).status).toBe(403);
    expect(h.updateEmailServices).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/email-services/refresh-billing', () => {
  it('asks for a fresh AWS cost lookup', async () => {
    h.getAwsCost.mockResolvedValue({ configured: true, cost: null, error: null, refreshAvailableAt: null });
    expect(await (await refresh.POST(makeRequest('/x', { method: 'POST' }))).json()).toEqual({ success: true, awsCost: { configured: true, cost: null, error: null, refreshAvailableAt: null } });
    expect(h.getAwsCost).toHaveBeenCalledWith({ refresh: true });
  });

  it('needs an admin and a CSRF token, and reports failures', async () => {
    h.getAwsCost.mockRejectedValueOnce(new Error('x'));
    expect((await refresh.POST(makeRequest('/x', { method: 'POST' }))).status).toBe(500);
    h.validateAdminSession.mockResolvedValue({ valid: false });
    expect((await refresh.POST(makeRequest('/x', { method: 'POST' }))).status).toBe(401);
    h.requireCSRFToken.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await refresh.POST(makeRequest('/x', { method: 'POST' }))).status).toBe(403);
  });
});

describe('GET /api/admin/email-log', () => {
  it('passes the page and filters through, ignoring empty ones', async () => {
    h.listEmailLog.mockResolvedValue({ entries: [{ id: 1 }], total: 1, ready: true });
    const res = await emailLog.GET(makeRequest('/api/admin/email-log?page=2&q=fan&provider=ses&status=&kind=registration'));
    expect(await res.json()).toEqual({ success: true, entries: [{ id: 1 }], total: 1, ready: true, page: 2, pageSize: 50 });
    expect(h.listEmailLog).toHaveBeenCalledWith({ page: 2, q: 'fan', provider: 'ses', kind: 'registration' });
    await emailLog.GET(makeRequest('/api/admin/email-log'));
    expect(h.listEmailLog).toHaveBeenLastCalledWith({ page: 1 });
  });

  it('refuses a bad filter, needs an admin, and reports failures', async () => {
    expect((await emailLog.GET(makeRequest('/api/admin/email-log?status=opened'))).status).toBe(400);
    h.listEmailLog.mockRejectedValueOnce(new Error('db'));
    expect((await emailLog.GET(makeRequest('/api/admin/email-log'))).status).toBe(500);
    h.validateAdminSession.mockResolvedValue({ valid: false });
    expect((await emailLog.GET(makeRequest('/api/admin/email-log'))).status).toBe(401);
    h.requireCSRFToken.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await emailLog.GET(makeRequest('/api/admin/email-log'))).status).toBe(403);
  });
});
