import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { resetPasswordForEmail: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), exchangeCodeForSession: vi.fn() },
  findByPhone: vi.fn(),
  authLimit: vi.fn(),
  reminderLimit: vi.fn(),
  markPasswordSet: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: h.auth }) }));
vi.mock('@/lib/supabase/db', () => ({ userDb: { findByPhone: (...a: unknown[]) => h.findByPhone(...a) } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }) }));
vi.mock('@/lib/rate-limiter', () => ({
  rateLimiters: {
    auth: { checkLimit: (...a: unknown[]) => h.authLimit(...a) },
    emailReminder: { checkLimit: (...a: unknown[]) => h.reminderLimit(...a) },
  },
}));
vi.mock('@/lib/password-flag', () => ({ markPasswordSet: (...a: unknown[]) => h.markPasswordSet(...a) }));

import { resetPassword } from '@/app/forgot-password/actions';
import { lookupEmailByPhone, sendEmailReminder } from '@/app/forgot-email/actions';
import { updatePassword } from '@/app/update-password/actions';
import { GET as callback } from '@/app/auth/callback/route';
import * as anim from '@/app/leaderboard/animations';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://1think2win.com');
  h.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  h.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  h.auth.updateUser.mockResolvedValue({ error: null });
  h.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  h.authLimit.mockResolvedValue({ success: true });
  h.reminderLimit.mockResolvedValue({ success: true });
  h.findByPhone.mockResolvedValue({ id: 'u1', email: 'ab@example.com' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('resetPassword', () => {
  it('rejects a malformed email without calling Supabase', async () => {
    expect(await resetPassword(form({ email: 'nope' }))).toEqual({ error: 'Please enter a valid email address' });
    expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('sends the reset link back to /update-password through the callback', async () => {
    const res = await resetPassword(form({ email: 'ali@example.com', captchaToken: 'tok' }));
    expect(res).toMatchObject({ success: true });
    expect(h.auth.resetPasswordForEmail).toHaveBeenCalledWith('ali@example.com', {
      redirectTo: 'https://1think2win.com/auth/callback?next=/update-password',
      captchaToken: 'tok',
    });
  });

  it('answers the same way when Supabase fails, so accounts cannot be probed', async () => {
    h.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'User not found' } });
    const ok = await resetPassword(form({ email: 'ali@example.com', captchaToken: 'tok' }));
    h.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    expect(ok).toEqual(await resetPassword(form({ email: 'ali@example.com', captchaToken: 'tok' })));
  });

  it('needs a Turnstile token, and reports a failed check instead of claiming the email went out', async () => {
    expect(await resetPassword(form({ email: 'ali@example.com' }))).toEqual({ error: 'Please complete the security check.' });
    expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    h.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'captcha protection: request disallowed', code: 'captcha_failed' } });
    expect(await resetPassword(form({ email: 'ali@example.com', captchaToken: 'used' }))).toEqual({ error: 'The security check failed or expired. Please try again.' });
  });
});

describe('forgot-email gaps', () => {
  it('masks a two-letter local part as first letter + ***', async () => {
    expect(await lookupEmailByPhone(form({ phone: '03123456789' }))).toMatchObject({ maskedEmail: 'a***@example.com' });
  });

  it('stops at the per-IP limit', async () => {
    h.authLimit.mockResolvedValue({ success: false });
    expect(await lookupEmailByPhone(form({ phone: '03123456789' }))).toEqual({ error: 'Too many requests. Please try again later.' });
    expect(h.findByPhone).not.toHaveBeenCalled();
  });

  it('turns unexpected failures into a generic error', async () => {
    h.findByPhone.mockRejectedValue(new Error('db down'));
    expect(await lookupEmailByPhone(form({ phone: '03123456789' }))).toEqual({ error: 'An error occurred. Please try again.' });
    expect(await sendEmailReminder(form({ phone: '03123456789' }))).toEqual({ error: 'An error occurred. Please try again.' });
  });
});

describe('updatePassword', () => {
  const strong = { password: 'Str0ng!pass', confirmPassword: 'Str0ng!pass' };

  it('validates strength and confirmation first', async () => {
    expect(await updatePassword(form({ password: 'short', confirmPassword: 'short' }))).toEqual({ error: 'Password must be at least 8 characters' });
    expect(await updatePassword(form({ ...strong, confirmPassword: 'other' }))).toEqual({ error: "Passwords don't match" });
  });

  it('needs a live session from the reset link', async () => {
    h.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await updatePassword(form(strong))).toEqual({ error: 'Session expired. Please try the password reset link again.' });
  });

  it('updates the password and records it for Google accounts', async () => {
    expect(await updatePassword(form(strong))).toEqual({ success: true, message: 'Password updated successfully!' });
    expect(h.auth.updateUser).toHaveBeenCalledWith({ password: 'Str0ng!pass' });
    expect(h.markPasswordSet).toHaveBeenCalledWith('u1');
  });

  it('explains Supabase refusals', async () => {
    h.auth.updateUser.mockResolvedValueOnce({ error: { message: 'New password should be different from the old password.' } });
    expect(await updatePassword(form(strong))).toEqual({ error: 'New password must be different from your current password' });
    h.auth.updateUser.mockResolvedValueOnce({ error: { message: 'weak' } });
    expect(await updatePassword(form(strong))).toEqual({ error: 'Failed to update password. Please try again.' });
    expect(h.markPasswordSet).not.toHaveBeenCalled();
  });
});

describe('/auth/callback redirect host', () => {
  const call = (headers: Record<string, string> = {}) =>
    callback(new Request('http://internal:3000/auth/callback?code=c&next=/profile', { headers }));

  it('stays on the request origin in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect((await call({ 'x-forwarded-host': 'example.com' })).headers.get('location')).toBe('http://internal:3000/profile');
  });

  it('uses the proxy host, defaulting the scheme to https', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await call({ 'x-forwarded-host': '1think2win.com' })).headers.get('location')).toBe('https://1think2win.com/profile');
    expect((await call({ 'x-forwarded-host': 'box.local', 'x-forwarded-proto': 'http' })).headers.get('location')).toBe('http://box.local/profile');
  });
});

describe('leaderboard animation helpers', () => {
  it('picks rank colours, icons and glows', () => {
    expect([1, 2, 3, 7, 20, 99].map(anim.getRankGradient)).toEqual([
      'from-yellow-400 via-yellow-500 to-yellow-600',
      'from-gray-300 via-gray-400 to-gray-500',
      'from-amber-400 via-amber-500 to-amber-600',
      'from-emerald-400 via-emerald-500 to-teal-600',
      'from-cyan-400 via-cyan-500 to-blue-600',
      'from-blue-400 via-blue-500 to-indigo-600',
    ]);
    expect([1, 2, 3, 4].map(anim.getRankIcon)).toEqual(['👑', '🥈', '🥉', '🏆']);
    expect([1, 2, 3].every((r) => anim.getRankGlow(r).startsWith('0 0'))).toBe(true);
    expect(anim.getRankGlow(4)).toBe('none');
  });

  it('staggers the per-item variants by index', () => {
    const at = (v: unknown, i: number) => (v as (i: number) => { transition: { delay: number } })(i).transition.delay;
    expect(at(anim.letterReveal.visible, 2)).toBeCloseTo(0.08);
    expect(at(anim.podiumCardVariants.visible, 1)).toBeCloseTo(0.27);
    expect(at(anim.rowVariants.visible, 5)).toBeCloseTo(0.1);
    expect(anim.backToTopVariants.exit).toMatchObject({ transition: anim.fastTween });
    expect(anim.skeletonShimmer.backgroundSize).toBe('200% 100%');
  });
});
