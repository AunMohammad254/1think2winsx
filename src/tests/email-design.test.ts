import { describe, it, expect, beforeAll } from 'vitest';

import { emailShell, emailButton, emailLinkFallback, escapeHtml, EMAIL_COLORS } from '@/lib/email-theme';
import {
    buildEmailReminderEmail,
    buildNewsletterWelcomeEmail,
    buildVerifyEmailEmail,
    buildAdminMessageEmail,
} from '@/lib/email-templates';
import { SUPABASE_EMAIL_TEMPLATES } from '@/lib/email-supabase-templates';
import { generateBeautifulEmailTemplate } from '@/lib/email';

const VERIFY_URL = 'https://x.supabase.co/auth/v1/verify?token=pkce_abc&type=signup&redirect_to=https%3A%2F%2Fexample.com';

let appEmails: Record<string, string>;

beforeAll(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://1think2win.com/';
    process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'x'.repeat(40);
    appEmails = {
        reminder: buildEmailReminderEmail({ email: 'fan@example.com', phoneLast4: '6789' }).html,
        'newsletter welcome': buildNewsletterWelcomeEmail({ email: 'fan@example.com' }).html,
        'admin verify': buildVerifyEmailEmail({ verificationUrl: VERIFY_URL }).html,
        'admin message': buildAdminMessageEmail({ title: 'Prize approved', message: 'Hello\nthere' }).html,
        'legacy wrapper': generateBeautifulEmailTemplate('Legacy', '<p>Body</p>'),
    };
});

const supabaseEmails = Object.entries(SUPABASE_EMAIL_TEMPLATES);

describe('every email follows the design rules', () => {
    const rules = (name: string, html: string) => {
        expect(html, name).toMatch(/^<!DOCTYPE html>/);
        expect(html, name).toContain('<html lang="en">');
        expect(html, name).toContain('name="viewport"');
        expect(html, name).toMatch(/<title>[^<]+<\/title>/);
        // email clients block or strip these, and they would be a privacy/safety risk
        expect(html, name).not.toMatch(/<script/i);
        expect(html, name).not.toMatch(/<img\b/i);
        expect(html, name).not.toMatch(/<link\b/i);
        expect(html, name).not.toMatch(/@import|url\(/i);
        // the app's palette, not the old yellow-on-grey look
        expect(html, name).toContain(EMAIL_COLORS.pageBg);
        expect(html, name).toContain(EMAIL_COLORS.emerald);
        expect(html.toLowerCase(), name).not.toContain('#eab308');
        expect(html, name).toContain('1Think 2Win');
        expect(html, name).toContain('role="presentation"');
    };

    it('app emails', () => {
        for (const [name, html] of Object.entries(appEmails)) rules(name, html);
    });

    it.each(supabaseEmails)('Supabase email "%s"', (name, tpl) => {
        rules(name, tpl.html);
    });

    it('all links are https (or a Supabase placeholder), never javascript:', () => {
        const all = [...Object.values(appEmails), ...supabaseEmails.map(([, t]) => t.html)];
        for (const html of all) {
            for (const m of html.matchAll(/href="([^"]*)"/g)) {
                expect(m[1]).toMatch(/^(https?:\/\/|\{\{ \.)/);
            }
        }
    });
});

describe('Supabase templates', () => {
    const t = (name: string) => SUPABASE_EMAIL_TEMPLATES[name].html;

    it.each(['confirm-signup', 'reset-password', 'magic-link', 'invite', 'change-email'])(
        '%s has a button and a plain-link fallback that use the confirmation URL',
        (name) => {
            expect(t(name).split('{{ .ConfirmationURL }}').length - 1).toBeGreaterThanOrEqual(2);
        }
    );

    it('uses the right variables where the wording needs them', () => {
        expect(t('change-email')).toContain('{{ .NewEmail }}');
        expect(t('change-email')).toContain('{{ .Email }}');
        expect(t('confirm-signup')).toContain('{{ .Email }}');
        expect(t('reset-password')).toContain('{{ .Email }}');
        expect(t('reauthentication')).toContain('{{ .Token }}');
        expect(t('reauthentication')).not.toContain('{{ .ConfirmationURL }}');
    });

    it('footer links use the dashboard SiteURL and no year is baked in (it would go stale)', () => {
        for (const [, tpl] of supabaseEmails) {
            expect(tpl.html).toContain('href="{{ .SiteURL }}/quizzes"');
            expect(tpl.html).not.toMatch(/&copy; 20\d\d/);
        }
    });

    it('the reset email explains that the link works once and only the newest email counts', () => {
        expect(t('reset-password')).toMatch(/works only once/);
        expect(t('reset-password')).toMatch(/newest email/);
    });

    it('every template has a dashboard name and a subject', () => {
        for (const [, tpl] of supabaseEmails) {
            expect(tpl.dashboardName.length).toBeGreaterThan(3);
            expect(tpl.subject.length).toBeGreaterThan(8);
        }
    });
});

describe('escaping and content', () => {
    it('escapes the title and preheader', () => {
        const html = emailShell({ title: '<img src=x onerror=alert(1)>', preheader: '"quoted" <b>', bodyHtml: '' });
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).toContain('&quot;quoted&quot; &lt;b&gt;');
    });

    it('escapes button labels and link targets', () => {
        const html = emailButton('https://e.com/?a=1&b="2"', '<b>Go</b>');
        expect(html).toContain('href="https://e.com/?a=1&amp;b=&quot;2&quot;"');
        expect(html).toContain('&lt;b&gt;Go&lt;/b&gt;');
        expect(escapeHtml('{{ .ConfirmationURL }}')).toBe('{{ .ConfirmationURL }}'); // placeholders survive
    });

    it('verification email shows the link as a button and as plain text', () => {
        const html = buildVerifyEmailEmail({ verificationUrl: VERIFY_URL }).html;
        const escaped = escapeHtml(VERIFY_URL);
        expect(html.split(escaped).length - 1).toBeGreaterThanOrEqual(3); // button href + fallback href + fallback text
    });

    it('admin message: typed HTML is shown as text, line breaks are kept', () => {
        const mail = buildAdminMessageEmail({ title: 'T <b>x</b>', message: 'Line one\nLine <i>two</i>' });
        expect(mail.html).toContain('Line one<br>Line &lt;i&gt;two&lt;/i&gt;');
        expect(mail.html).not.toContain('<i>two</i>');
        expect(mail.html).toContain('T &lt;b&gt;x&lt;/b&gt;');
        expect(mail.subject).toBe('T <b>x</b>'); // subjects are plain text
    });

    it('the legacy wrapper escapes its title but keeps trusted body markup', () => {
        const html = generateBeautifulEmailTemplate('A & B', '<p id="keep">Body</p>');
        expect(html).toContain('A &amp; B');
        expect(html).toContain('<p id="keep">Body</p>');
    });

    it('the plain-text link fallback is wrapped so long URLs cannot break the layout', () => {
        expect(emailLinkFallback('https://e.com/' + 'a'.repeat(200))).toContain('word-break:break-all');
    });
});
