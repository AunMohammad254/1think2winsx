// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest } from '@/tests/helpers/supabase-mock';

const newsletterDb = { getSubscribers: vi.fn(), unsubscribeEmail: vi.fn(), subscribeEmail: vi.fn() };
const validateAdminSession = vi.fn();
const requireCSRFToken = vi.fn();
const applyRateLimit = vi.fn();
const sendNewsletterEmail = vi.fn();
const sendEmail = vi.fn();
const logSecurityEvent = vi.fn();

vi.mock('@/lib/supabase/db', () => ({ newsletterDb }));
vi.mock('@/lib/admin-session', () => ({ validateAdminSession: (...a: unknown[]) => validateAdminSession(...a) }));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: (...a: unknown[]) => requireCSRFToken(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { general: 'general', newsletter: 'newsletter' }, applyRateLimit: (...a: unknown[]) => applyRateLimit(...a) }));
vi.mock('@/lib/email-service', () => ({ sendNewsletterEmail: (...a: unknown[]) => sendNewsletterEmail(...a) }));
vi.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/email-templates', () => ({ buildNewsletterWelcomeEmail: ({ email }: { email: string }) => ({ subject: 'Welcome', html: `<p>${email}</p>`, text: email }) }));
vi.mock('@/lib/security-logger', () => ({ securityLogger: { logSecurityEvent: (...a: unknown[]) => logSecurityEvent(...a) } }));
// The daily email limit: the real messages, a stand-in counter
const reserveEmails = vi.fn();
const releaseEmails = vi.fn();
const getEmailQuotaStatus = vi.fn();
vi.mock('@/lib/email-quota', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email-quota')>()),
  reserveEmails: (...a: unknown[]) => reserveEmails(...a),
  releaseEmails: (...a: unknown[]) => releaseEmails(...a),
  getEmailQuotaStatus: (...a: unknown[]) => getEmailQuotaStatus(...a),
}));

const SECRET = 's'.repeat(40);
const subscribers = await import('@/app/api/admin/newsletter/subscribers/route');
const send = await import('@/app/api/admin/newsletter/send/route');
const unsubscribe = await import('@/app/api/newsletter/unsubscribe/route');
const subscribe = await import('@/app/api/newsletter/subscribe/route');
const emailQuota = await import('@/app/api/admin/email-quota/route');
const tokens = await import('@/lib/newsletter-unsubscribe');

beforeEach(() => {
  for (const fn of [validateAdminSession, requireCSRFToken, applyRateLimit, sendNewsletterEmail, sendEmail, logSecurityEvent, reserveEmails, releaseEmails, getEmailQuotaStatus, ...Object.values(newsletterDb)]) fn.mockReset();
  reserveEmails.mockResolvedValue({ ok: true, id: 8 });
  validateAdminSession.mockResolvedValue({ valid: true, email: 'boss@example.test' });
  requireCSRFToken.mockResolvedValue(null);
  applyRateLimit.mockResolvedValue(null);
  newsletterDb.unsubscribeEmail.mockResolvedValue(true);
  vi.stubEnv('NEWSLETTER_UNSUBSCRIBE_SECRET', SECRET);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('unsubscribe tokens', () => {
  it('signs the lowercased email so links cannot be forged for other addresses', () => {
    const t = tokens.createUnsubscribeToken(' Ali@Example.test ');
    expect(t).toBe(tokens.createUnsubscribeToken('ali@example.test'));
    expect(tokens.verifyUnsubscribeToken('ali@example.test', t)).toBe(true);
    expect(tokens.verifyUnsubscribeToken('sara@example.test', t)).toBe(false);
    expect(tokens.verifyUnsubscribeToken('ali@example.test', t.slice(1))).toBe(false);
    expect(tokens.verifyUnsubscribeToken('', t)).toBe(false);
    expect(tokens.verifyUnsubscribeToken('ali@example.test', '')).toBe(false);
  });

  it('builds the confirmation-page and one-click links', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.test/');
    const t = tokens.createUnsubscribeToken('a+b@x.co');
    expect(tokens.buildUnsubscribePageUrl('A+B@x.co')).toBe(`https://site.example.test/unsubscribe?e=a%2Bb%40x.co&t=${t}`);
    expect(tokens.buildOneClickUnsubscribeUrl('a+b@x.co')).toBe(`https://site.example.test/api/newsletter/unsubscribe?e=a%2Bb%40x.co&t=${t}`);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(tokens.buildUnsubscribePageUrl('a@x.co')).toMatch(/^http:\/\/localhost:3000\/unsubscribe\?/);
  });

  it('refuses to sign with a missing or short secret', () => {
    vi.stubEnv('NEWSLETTER_UNSUBSCRIBE_SECRET', 'short');
    expect(() => tokens.createUnsubscribeToken('a@x.co')).toThrow(/NEWSLETTER_UNSUBSCRIBE_SECRET/);
    vi.stubEnv('NEWSLETTER_UNSUBSCRIBE_SECRET', '');
    expect(() => tokens.createUnsubscribeToken('a@x.co')).toThrow();
  });
});

describe('POST /api/newsletter/unsubscribe', () => {
  const good = () => tokens.createUnsubscribeToken('ali@example.test');

  it('removes the address for a valid signed link (query string, RFC 8058 one-click)', async () => {
    const res = await unsubscribe.POST(new NextRequest(`http://localhost/api/newsletter/unsubscribe?e=Ali@Example.test&t=${good()}`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(await res.json()).toEqual({ success: true, message: 'You have been unsubscribed from the 1Think 2Win newsletter.' });
    expect(newsletterDb.unsubscribeEmail).toHaveBeenCalledWith('ali@example.test');
  });

  it('accepts the email and token in a JSON body', async () => {
    expect((await unsubscribe.POST(makeRequest('/api/newsletter/unsubscribe', { body: { e: 'ali@example.test', t: good() } }))).status).toBe(200);
    expect((await unsubscribe.POST(makeRequest('/api/newsletter/unsubscribe', { body: { e: 5, t: null } }))).status).toBe(400);
    expect((await unsubscribe.POST(makeRequest('/api/newsletter/unsubscribe', { method: 'POST', rawBody: '{bad', headers: { 'content-type': 'application/json' } }))).status).toBe(400);
  });

  it('rejects forged or incomplete links', async () => {
    for (const qs of ['', `?e=ali@example.test`, `?e=sara@example.test&t=${good()}`]) {
      expect((await unsubscribe.POST(makeRequest(`/api/newsletter/unsubscribe${qs}`, { method: 'POST' }))).status).toBe(400);
    }
    expect(newsletterDb.unsubscribeEmail).not.toHaveBeenCalled();
  });

  it('reports a failed removal, the rate limit and errors', async () => {
    newsletterDb.unsubscribeEmail.mockResolvedValueOnce(false);
    expect((await unsubscribe.POST(makeRequest(`/api/newsletter/unsubscribe?e=ali@example.test&t=${good()}`, { method: 'POST' }))).status).toBe(500);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await unsubscribe.POST(makeRequest('/x', { method: 'POST' }))).status).toBe(429);
    vi.stubEnv('NEWSLETTER_UNSUBSCRIBE_SECRET', '');
    expect((await unsubscribe.POST(makeRequest(`/x?e=a@x.co&t=abc`, { method: 'POST' }))).status).toBe(500);
  });
});

describe('POST /api/newsletter/subscribe', () => {
  const post = (body: unknown) => subscribe.POST(makeRequest('/api/newsletter/subscribe', { body }));

  it('subscribes a new address and sends one confirmation email', async () => {
    newsletterDb.subscribeEmail.mockResolvedValue({ success: true, isNew: true, message: 'Subscribed successfully!' });
    sendEmail.mockResolvedValue({ success: true });
    expect(await (await post({ email: ' Ali@Example.test ' })).json()).toEqual({ success: true, message: 'Subscribed successfully! We sent you a confirmation email.' });
    expect(newsletterDb.subscribeEmail).toHaveBeenCalledWith('ali@example.test');
    expect(sendEmail).toHaveBeenCalledWith({ to: 'ali@example.test', subject: 'Welcome', html: '<p>ali@example.test</p>', text: 'ali@example.test', kind: 'newsletter_signup' });
  });

  it('never re-sends the email for a repeat sign-up, and survives a failed send', async () => {
    newsletterDb.subscribeEmail.mockResolvedValue({ success: true, isNew: false, message: 'You are already subscribed!' });
    expect((await (await post({ email: 'a@x.co' })).json()).message).toBe('You are already subscribed!');
    expect(sendEmail).not.toHaveBeenCalled();

    newsletterDb.subscribeEmail.mockResolvedValue({ success: true, isNew: true, message: 'Subscribed successfully!' });
    sendEmail.mockResolvedValueOnce({ success: false, error: 'smtp' });
    expect((await (await post({ email: 'a@x.co' })).json()).message).toBe('Subscribed successfully!');
    sendEmail.mockRejectedValueOnce(new Error('boom'));
    expect((await post({ email: 'a@x.co' })).status).toBe(200);
  });

  it('validates the email and reports failures', async () => {
    for (const body of [{}, { email: 5 }, { email: 'nope' }]) expect((await post(body)).status).toBe(400);
    newsletterDb.subscribeEmail.mockResolvedValue({ success: false, message: 'Failed to subscribe' });
    expect(await (await post({ email: 'a@x.co' })).json()).toEqual({ success: false, message: 'Failed to subscribe' });
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post({ email: 'a@x.co' })).status).toBe(403);
    applyRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await post({ email: 'a@x.co' })).status).toBe(429);
    newsletterDb.subscribeEmail.mockRejectedValueOnce(new Error('db'));
    expect((await post({ email: 'a@x.co' })).status).toBe(500);
  });
});

describe('/api/admin/newsletter/subscribers', () => {
  it('GET lists subscribers for admins', async () => {
    newsletterDb.getSubscribers.mockResolvedValue(['a@x', 'b@x']);
    expect(await (await subscribers.GET(makeRequest('/x'))).json()).toEqual({ success: true, subscribers: ['a@x', 'b@x'], count: 2 });
    validateAdminSession.mockResolvedValueOnce({ valid: true });
    expect((await subscribers.GET(makeRequest('/x'))).status).toBe(401);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await subscribers.GET(makeRequest('/x'))).status).toBe(403);
    newsletterDb.getSubscribers.mockRejectedValueOnce(new Error('db'));
    expect((await subscribers.GET(makeRequest('/x'))).status).toBe(500);
  });

  it('DELETE removes one subscriber', async () => {
    const del = (body: unknown) => subscribers.DELETE(makeRequest('/x', { method: 'DELETE', body }));
    expect(await (await del({ email: 'a@x' })).json()).toEqual({ success: true, message: 'Subscriber successfully removed.' });
    expect((await del({})).status).toBe(400);
    newsletterDb.unsubscribeEmail.mockResolvedValueOnce(false);
    expect((await del({ email: 'a@x' })).status).toBe(500);
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await del({ email: 'a@x' })).status).toBe(401);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await del({ email: 'a@x' })).status).toBe(403);
    newsletterDb.unsubscribeEmail.mockRejectedValueOnce(new Error('db'));
    expect((await del({ email: 'a@x' })).status).toBe(500);
  });
});

describe('POST /api/admin/newsletter/send', () => {
  const post = (body: unknown) => send.POST(makeRequest('/x', { body }));
  const good = { subject: ' News ', content: '  Big quiz tonight! ', senderEmail: ' news@example.test ' };

  it('sends to every subscriber and logs the dispatch', async () => {
    vi.stubEnv('BREVO_SENDER_EMAIL', 'noreply@example.test');
    newsletterDb.getSubscribers.mockResolvedValue(['a@x', 'b@x']);
    sendNewsletterEmail.mockResolvedValue({ success: true, sentCount: 2 });
    // "Accepted": Brevo can still drop an email after taking the request
    expect(await (await post(good)).json()).toEqual({ success: true, message: 'Brevo accepted the newsletter for all 2 subscriber(s).', sentCount: 2, failedCount: 0 });
    expect(sendNewsletterEmail).toHaveBeenCalledWith({ senderEmail: 'news@example.test', subject: 'News', content: 'Big quiz tonight!', recipients: ['a@x', 'b@x'] });
    expect(logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ action: 'newsletter_dispatched', subscriberCount: 2, failedCount: 0 }) }));
  });

  it('reports partial failures and uses the default sender when blank', async () => {
    vi.stubEnv('BREVO_SENDER_EMAIL', 'default@example.test');
    newsletterDb.getSubscribers.mockResolvedValue(['a@x', 'b@x', 'c@x']);
    sendNewsletterEmail.mockResolvedValue({ success: true, sentCount: 2, failedCount: 1 });
    expect((await (await post({ ...good, senderEmail: '' })).json()).message).toBe('Brevo accepted 2 of 3 email(s); 1 failed.');
    expect(sendNewsletterEmail.mock.calls[0][0].senderEmail).toBe('default@example.test');
  });

  it("refuses a sender outside the domain verified in Brevo, which accepted such emails and then dropped them", async () => {
    vi.stubEnv('BREVO_SENDER_EMAIL', 'noreply@1think2win.example');
    newsletterDb.getSubscribers.mockResolvedValue(['a@x']);
    sendNewsletterEmail.mockResolvedValue({ success: true, sentCount: 1 });

    const res = await post({ ...good, senderEmail: 'owner@gmail.com' });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Newsletters can only be sent from an @1think2win.example address, the domain verified in Brevo. Leave the sender blank to use noreply@1think2win.example.');
    expect(sendNewsletterEmail).not.toHaveBeenCalled();
    expect(newsletterDb.getSubscribers).not.toHaveBeenCalled();

    // Any address on the verified domain is fine, whatever its case
    expect((await post({ ...good, senderEmail: 'News@1Think2Win.example' })).status).toBe(200);
    expect(sendNewsletterEmail.mock.calls[0][0].senderEmail).toBe('News@1Think2Win.example');
  });

  it('sends a test to one address only, never to the subscribers', async () => {
    vi.stubEnv('BREVO_SENDER_EMAIL', 'noreply@example.test');
    sendNewsletterEmail.mockResolvedValue({ success: true, sentCount: 1 });

    const body = await (await post({ ...good, testEmail: ' me@example.org ' })).json();

    expect(body).toEqual({
      success: true, test: true, sentCount: 1, failedCount: 0,
      message: "Brevo accepted the test email to me@example.org. If it doesn't arrive, Brevo's Transactional logs show why.",
    });
    expect(sendNewsletterEmail).toHaveBeenCalledWith({ senderEmail: 'news@example.test', subject: '[TEST] News', content: 'Big quiz tonight!', recipients: ['me@example.org'] });
    expect(newsletterDb.getSubscribers).not.toHaveBeenCalled();
    expect(logSecurityEvent).not.toHaveBeenCalled();

    expect((await (await post({ ...good, testEmail: 'nope' })).json()).message).toBe('Please enter a valid address for the test email.');
    sendNewsletterEmail.mockResolvedValue({ success: false, error: 'Key not found' });
    const failed = await post({ ...good, testEmail: 'me@example.org' });
    expect(failed.status).toBe(500);
    expect((await failed.json()).message).toBe('Key not found');
    sendNewsletterEmail.mockResolvedValue({ success: false });
    expect((await (await post({ ...good, testEmail: 'me@example.org' })).json()).message).toBe('Failed to send the test email.');
    expect(newsletterDb.getSubscribers).not.toHaveBeenCalled();
  });

  it('answers early with no subscribers and reports dispatch failures', async () => {
    newsletterDb.getSubscribers.mockResolvedValue([]);
    expect((await (await post(good)).json()).sentCount).toBe(0);
    expect(sendNewsletterEmail).not.toHaveBeenCalled();
    newsletterDb.getSubscribers.mockResolvedValue(['a@x']);
    sendNewsletterEmail.mockResolvedValue({ success: false, error: 'brevo down' });
    expect(await (await post(good)).json()).toEqual({ success: false, message: 'brevo down' });
    sendNewsletterEmail.mockResolvedValue({ success: false });
    expect((await (await post(good)).json()).message).toBe('Failed to dispatch emails.');
  });

  it('validates the fields and guards', async () => {
    vi.stubEnv('BREVO_SENDER_EMAIL', '');
    expect((await post({ ...good, senderEmail: '' })).status).toBe(400);
    expect((await post({ ...good, subject: '' })).status).toBe(400);
    expect((await (await post({ ...good, senderEmail: 'not-an-email' })).json()).message).toBe('Please enter a valid sender email address.');
    expect((await (await post({ ...good, content: 'short' })).json()).message).toMatch(/at least 10 characters/);
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await post(good)).status).toBe(401);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await post(good)).status).toBe(403);
    newsletterDb.getSubscribers.mockRejectedValueOnce(new Error('db'));
    expect((await post(good)).status).toBe(500);
  });

  describe("today's email limit", () => {
    beforeEach(() => {
      vi.stubEnv('BREVO_SENDER_EMAIL', 'noreply@example.test');
      vi.useFakeTimers({ now: new Date('2026-10-22T10:00:00Z'), toFake: ['Date'] }); // 3:00 PM PKT
    });
    afterEach(() => vi.useRealTimers());

    it('counts the whole newsletter first and keeps only the emails Brevo accepted', async () => {
      newsletterDb.getSubscribers.mockResolvedValue(['a@x', 'b@x', 'c@x']);
      sendNewsletterEmail.mockResolvedValue({ success: true, sentCount: 3, failedCount: 0 });
      await post(good);
      expect(reserveEmails).toHaveBeenCalledWith('newsletter', 3);
      expect(releaseEmails).not.toHaveBeenCalled();

      sendNewsletterEmail.mockResolvedValue({ success: true, sentCount: 2, failedCount: 1 });
      await post(good);
      sendNewsletterEmail.mockResolvedValue({ success: false, sentCount: 0, error: 'brevo down' });
      await post(good);
      expect(releaseEmails.mock.calls).toEqual([[8, 2], [8, 0]]);
    });

    it('refuses a newsletter that does not fit, saying how many are left and when more free up', async () => {
      newsletterDb.getSubscribers.mockResolvedValue(Array.from({ length: 1450 }, (_, i) => `s${i}@x`));
      reserveEmails.mockResolvedValue({ ok: false, used: 159, cap: 279, remaining: 120, retryAt: '2026-10-22T15:15:00Z' });
      const res = await post(good);
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({
        success: false,
        message: "Today's email limit has been reached: only 120 emails are left for newsletters and this one needs 1,450 emails. Enough free up today after 8:15 PM PKT.",
      });
      expect(sendNewsletterEmail).not.toHaveBeenCalled();

      newsletterDb.getSubscribers.mockResolvedValue(['a@x']);
      reserveEmails.mockResolvedValue({ ok: false, used: 278, cap: 279, remaining: 1, retryAt: '2026-10-23T01:00:00Z' });
      expect((await (await post(good)).json()).message).toBe(
        "Today's email limit has been reached: only 1 email is left for newsletters and this one needs 1 email. Enough free up tomorrow after 6:00 AM PKT.",
      );
    });

    it('says when a newsletter is bigger than a whole day allows', async () => {
      newsletterDb.getSubscribers.mockResolvedValue(Array.from({ length: 300 }, (_, i) => `s${i}@x`));
      reserveEmails.mockResolvedValue({ ok: false, used: 0, cap: 279, remaining: 279, retryAt: null });
      expect((await (await post(good)).json()).message).toBe('This newsletter needs 300 emails, but at most 279 newsletter emails can be sent in 24 hours.');
    });

    it('counts a test email, gives it back when it fails, and refuses it once the limit is reached', async () => {
      sendNewsletterEmail.mockResolvedValue({ success: true, sentCount: 1 });
      await post({ ...good, testEmail: 'me@example.org' });
      expect(reserveEmails).toHaveBeenCalledWith('newsletter');
      expect(releaseEmails).not.toHaveBeenCalled();

      sendNewsletterEmail.mockResolvedValue({ success: false, error: 'Key not found' });
      await post({ ...good, testEmail: 'me@example.org' });
      expect(releaseEmails).toHaveBeenCalledExactlyOnceWith(8);

      sendNewsletterEmail.mockClear();
      reserveEmails.mockResolvedValue({ ok: false, used: 279, cap: 279, remaining: 0, retryAt: '2026-10-22T10:30:30Z' });
      const res = await post({ ...good, testEmail: 'me@example.org' });
      expect(res.status).toBe(429);
      expect((await res.json()).message).toBe(
        "Today's email limit has been reached: only 0 emails are left for newsletters and this one needs 1 email. Enough free up today after 3:31 PM PKT.",
      );
      expect(sendNewsletterEmail).not.toHaveBeenCalled();
    });
  });
});

describe('GET /api/admin/email-quota', () => {
  const get = () => emailQuota.GET(makeRequest('/api/admin/email-quota', { method: 'GET' }));
  const status = { used: 120, limit: 299, reserve: 20, cap: 279, remaining: 179, capRemaining: 159, nextFreeAt: '2026-10-22T15:15:00Z' };

  it("returns today's email count to an admin", async () => {
    getEmailQuotaStatus.mockResolvedValue(status);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, quota: status });
  });

  it('needs an admin session and a CSRF token, and reports a failed read', async () => {
    validateAdminSession.mockResolvedValueOnce({ valid: false });
    expect((await get()).status).toBe(401);
    requireCSRFToken.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await get()).status).toBe(403);
    expect(getEmailQuotaStatus).not.toHaveBeenCalled();

    getEmailQuotaStatus.mockRejectedValueOnce(new Error('no such function'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, message: 'Could not read the daily email count.' });
  });
});
