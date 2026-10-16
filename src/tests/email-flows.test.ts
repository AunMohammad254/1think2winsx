import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- mocks (hoisted above the imports below) ----------------------------------------------------
const findByPhone = vi.fn();
const subscribeEmail = vi.fn();
vi.mock('@/lib/supabase/db', () => ({
    userDb: { findByPhone: (...a: unknown[]) => findByPhone(...a) },
    newsletterDb: { subscribeEmail: (...a: unknown[]) => subscribeEmail(...a) },
}));

vi.mock('next/headers', () => ({
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
}));

const authLimit = vi.fn();
const reminderLimit = vi.fn();
vi.mock('@/lib/rate-limiter', () => ({
    rateLimiters: {
        auth: { checkLimit: (...a: unknown[]) => authLimit(...a) },
        emailReminder: { checkLimit: (...a: unknown[]) => reminderLimit(...a) },
        newsletter: {},
    },
    applyRateLimit: vi.fn().mockResolvedValue(null),
}));

const sendEmail = vi.fn();
vi.mock('@/lib/email', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/email')>()),
    sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/security-headers', async () => {
    const { NextResponse } = await import('next/server');
    return { createSecureJsonResponse: (body: unknown, init?: ResponseInit) => NextResponse.json(body, init) };
});

import { lookupEmailByPhone, sendEmailReminder } from '@/app/forgot-email/actions';
import { POST as subscribe } from '@/app/api/newsletter/subscribe/route';
import { escapeHtml, siteUrl, buildEmailReminderEmail } from '@/lib/email-templates';

const FULL_EMAIL = 'ahmed.khan2007@example.com';
const phoneForm = (phone: string) => {
    const f = new FormData();
    f.append('phone', phone);
    return f;
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEWSLETTER_UNSUBSCRIBE_SECRET', 'x'.repeat(40));
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://1think2win.com/'); // trailing slash on purpose
    authLimit.mockResolvedValue({ success: true });
    reminderLimit.mockResolvedValue({ success: true });
    findByPhone.mockResolvedValue({ id: 'u1', email: FULL_EMAIL, name: 'Ahmed' });
    sendEmail.mockResolvedValue({ success: true, messageId: 'm1' });
});

describe('forgot-email: lookup', () => {
    it('still returns only a masked address', async () => {
        const res = await lookupEmailByPhone(phoneForm('03123456789'));
        expect(res.success).toBe(true);
        expect(res.maskedEmail).toBe('a***7@example.com');
        expect(JSON.stringify(res)).not.toContain(FULL_EMAIL);
    });
});

describe('forgot-email: "Email me a reminder"', () => {
    it('rejects an invalid phone number without touching the database', async () => {
        const res = await sendEmailReminder(phoneForm('12345'));
        expect(res.error).toMatch(/valid phone/i);
        expect(findByPhone).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends nothing when no account has that phone number', async () => {
        findByPhone.mockResolvedValue(null);
        const res = await sendEmailReminder(phoneForm('03123456789'));
        expect(res.error).toMatch(/No account found/);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('emails the full address to that address only, and never returns it to the browser', async () => {
        const res = await sendEmailReminder(phoneForm('+923123456789'));

        expect(res.success).toBe(true);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        const mail = sendEmail.mock.calls[0][0] as { to: string; html: string; text: string };
        expect(mail.to).toBe(FULL_EMAIL);
        expect(mail.html).toContain(FULL_EMAIL);
        expect(mail.text).toContain(FULL_EMAIL);
        expect(mail.html).toContain('6789'); // phone's last 4 digits identify the request

        expect(res.maskedEmail).toBe('a***7@example.com');
        expect(JSON.stringify(res)).not.toContain(FULL_EMAIL);
    });

    it('limits reminders per phone number (+92 and 0 forms share one counter)', async () => {
        await sendEmailReminder(phoneForm('+923123456789'));
        expect(reminderLimit.mock.calls[0][1]).toBe('phone:03123456789');

        reminderLimit.mockResolvedValue({ success: false });
        const res = await sendEmailReminder(phoneForm('03123456789'));
        expect(res.error).toMatch(/already sent/i);
        expect(sendEmail).toHaveBeenCalledTimes(1); // only the first one went out
    });

    it('reports a delivery failure instead of claiming success', async () => {
        sendEmail.mockResolvedValue({ success: false, error: 'boom' });
        const res = await sendEmailReminder(phoneForm('03123456789'));
        expect(res.success).toBeUndefined();
        expect(res.error).toMatch(/couldn't send/i);
    });
});

describe('newsletter subscription confirmation email', () => {
    const post = (email: string) =>
        subscribe(
            new NextRequest('http://localhost/api/newsletter/subscribe', {
                method: 'POST',
                body: JSON.stringify({ email }),
                headers: { 'content-type': 'application/json' },
            })
        );

    it('sends one confirmation email to a new subscriber (lowercased)', async () => {
        subscribeEmail.mockResolvedValue({ success: true, isNew: true, message: 'Subscribed successfully!' });
        const res = await post('  New.Fan@Example.com ');
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(subscribeEmail).toHaveBeenCalledWith('new.fan@example.com');
        expect(sendEmail).toHaveBeenCalledTimes(1);
        const mail = sendEmail.mock.calls[0][0] as { to: string; html: string };
        expect(mail.to).toBe('new.fan@example.com');
        expect(mail.html).toContain('/unsubscribe?e=new.fan%40example.com&amp;t='); // signed unsubscribe link (& is written &amp; in HTML)
        expect(body.message).toMatch(/confirmation email/i);
    });

    it('does not email someone who was already subscribed', async () => {
        subscribeEmail.mockResolvedValue({ success: true, isNew: false, message: 'You are already subscribed!' });
        const res = await post('fan@example.com');
        expect(res.status).toBe(200);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('still subscribes when the confirmation email cannot be sent', async () => {
        subscribeEmail.mockResolvedValue({ success: true, isNew: true, message: 'Subscribed successfully!' });
        sendEmail.mockResolvedValue({ success: false, error: 'brevo down' });
        const res = await post('fan@example.com');
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.message).toBe('Subscribed successfully!');
    });
});

describe('email templates', () => {
    it('escapes HTML in interpolated values', () => {
        expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
        const { html } = buildEmailReminderEmail({ email: 'a<script>@x.com', phoneLast4: '1234' });
        expect(html).not.toContain('<script>');
    });

    it('builds links without a double slash even if the site URL ends with "/"', () => {
        expect(siteUrl()).toBe('https://1think2win.com');
        const { html } = buildEmailReminderEmail({ email: FULL_EMAIL, phoneLast4: '1234' });
        expect(html).toContain('https://1think2win.com/auth?mode=login');
        expect(html).not.toContain('com//');
    });
});
