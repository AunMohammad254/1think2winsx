// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildAuthEmails, fill, verifyUrl } from '@/lib/mail/auth-emails';

const SUPABASE = 'https://ref.supabase.co';
const user = { email: 'fan@example.test', new_email: 'new@example.test' };
const data = (type: string, extra: Record<string, string> = {}) => ({
  email_action_type: type,
  token: '123456',
  token_hash: 'pkce_hash',
  redirect_to: 'https://1think2win.test/auth/callback?next=/quizzes',
  site_url: 'https://1think2win.test',
  ...extra,
});

afterEach(() => vi.unstubAllEnvs());

const linkIn = (html: string) => /href="([^"]+auth\/v1\/verify[^"]+)"/.exec(html)![1].replace(/&amp;/g, '&');

describe('verifyUrl', () => {
  it("builds Supabase's verify link, with or without a redirect", () => {
    expect(verifyUrl(SUPABASE, 'h&1', 'signup', 'https://x.test/cb?next=/a')).toBe(
      'https://ref.supabase.co/auth/v1/verify?token=h%261&type=signup&redirect_to=https%3A%2F%2Fx.test%2Fcb%3Fnext%3D%2Fa',
    );
    expect(verifyUrl(SUPABASE, 'h', 'recovery')).toBe('https://ref.supabase.co/auth/v1/verify?token=h&type=recovery');
  });
});

describe('fill', () => {
  it('fills known variables, escaped, and leaves unknown ones alone', () => {
    expect(fill('<a href="{{ .ConfirmationURL }}">{{ .Email }}</a> {{ .Data.name }} {{ .Unknown }}', { ConfirmationURL: 'https://x.test/?a=1&b=2', Email: 'a<b>' }))
      .toBe('<a href="https://x.test/?a=1&amp;b=2">a&lt;b&gt;</a> {{ .Data.name }} {{ .Unknown }}');
  });
});

describe('buildAuthEmails', () => {
  it.each([
    ['signup', 'Confirm your 1Think 2Win account', 'registration'],
    ['recovery', 'Set or reset your 1Think 2Win password', 'password'],
    ['magiclink', 'Your 1Think 2Win sign-in link', 'account'],
    ['email', 'Your 1Think 2Win sign-in link', 'account'],
    ['invite', "You're invited to 1Think 2Win", 'account'],
  ])('builds the %s email from the dashboard template, link filled in', (type, subject, kind) => {
    const [mail] = buildAuthEmails(user, data(type), SUPABASE)!;
    expect(mail).toMatchObject({ to: 'fan@example.test', subject, kind });
    const link = verifyUrl(SUPABASE, 'pkce_hash', type, 'https://1think2win.test/auth/callback?next=/quizzes');
    expect(linkIn(mail.html)).toBe(link);
    expect(mail.text).toBe(`${subject}\n\n${link}\n`);
    expect(mail.html).not.toContain('{{');
    expect(mail.html).toContain('https://1think2win.test');
  });

  it('fills in the address, escaped', () => {
    const [mail] = buildAuthEmails({ email: 'a<b>@example.test' }, data('signup'), SUPABASE)!;
    expect(mail.html).toContain('a&lt;b&gt;@example.test');
  });

  it('sends the reauthentication code as a code, in the email and the text', () => {
    const [mail] = buildAuthEmails(user, data('reauthentication'), SUPABASE)!;
    expect(mail.html).toContain('123456');
    expect(mail.text).toBe('Your 1Think 2Win security code\n\nYour code: 123456\n');
  });

  it('uses the app address when Supabase sends no site URL, and copes with missing tokens', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.test');
    const [mail] = buildAuthEmails({ email: 'fan@example.test' }, { email_action_type: 'reauthentication' }, SUPABASE)!;
    expect(mail.html).toContain('https://site.example.test');
    expect(mail.text).toBe('Your 1Think 2Win security code\n\nYour code: \n');
    const [noHash] = buildAuthEmails(user, { email_action_type: 'recovery' }, SUPABASE)!;
    expect(linkIn(noHash.html)).toBe('https://ref.supabase.co/auth/v1/verify?token=&type=recovery');
  });

  it('sends two emails for a secure email change, with the tokens Supabase reverses', () => {
    const mails = buildAuthEmails(user, data('email_change', { token_new: '654321', token_hash_new: 'hash_new' }), SUPABASE)!;
    expect(mails.map((m) => m.to)).toEqual(['fan@example.test', 'new@example.test']);
    expect(linkIn(mails[0].html)).toContain('token=hash_new&');
    expect(linkIn(mails[1].html)).toContain('token=pkce_hash&');
    expect(mails[0].html).toContain('new@example.test');
    expect(mails.every((m) => m.kind === 'account')).toBe(true);
  });

  it('sends one email to the new address when Secure Email Change is off', () => {
    const [only, ...rest] = buildAuthEmails(user, { email_action_type: 'email_change', token_hash_new: 'hash_new', token_new: '654321' }, SUPABASE)!;
    expect(rest).toEqual([]);
    expect(only.to).toBe('new@example.test');
    expect(linkIn(only.html)).toContain('token=hash_new&');

    const [fallback] = buildAuthEmails({ email: 'fan@example.test' }, { email_action_type: 'email_change', token_hash: 'h', token: '1' }, SUPABASE)!;
    expect(fallback.to).toBe('fan@example.test');
    expect(fallback.html).toContain('token=h&amp;');
    const [empty] = buildAuthEmails(user, { email_action_type: 'email_change' }, SUPABASE)!;
    expect(linkIn(empty.html)).toContain('token=&');
  });

  it('sends a security notice for each *_notification type', () => {
    const [notice] = buildAuthEmails(user, data('password_changed_notification'), SUPABASE)!;
    expect(notice).toMatchObject({ to: 'fan@example.test', subject: 'Security notice for your 1Think 2Win account', kind: 'account' });
    expect(notice.html).toContain('The password for your 1Think 2Win account was changed.');
    expect(notice.text).toContain('reset your password straight away');
    const [unknown] = buildAuthEmails(user, data('something_new_notification'), SUPABASE)!;
    expect(unknown.html).toContain('A security setting on your 1Think 2Win account was changed.');
  });

  it('knows nothing of other types', () => {
    expect(buildAuthEmails(user, data('sms'), SUPABASE)).toBeNull();
  });
});
