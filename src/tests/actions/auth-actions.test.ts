// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, mockArg, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let sb: SupabaseMock;
let ssr: { getAll: () => unknown; setAll: (c: { name: string; value: string; options?: unknown }[]) => void } | undefined;
const cookieStore = { getAll: vi.fn(() => [{ name: 'sb', value: 'v' }]), set: vi.fn() };
const redirect = vi.fn();
const sendPasswordSetupEmail = vi.fn();
const checkLimit = vi.fn();
const userUpdate = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => cookieStore, headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }));
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a) }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: typeof ssr }) => {
    ssr = opts.cookies;
    return sb.client;
  },
}));
vi.mock('@/lib/password-setup', () => ({ sendPasswordSetupEmail: (...a: unknown[]) => sendPasswordSetupEmail(...a) }));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiters: { auth: { checkLimit: (...a: unknown[]) => checkLimit(...a) } } }));
const adminDb = { service: 'role' };
vi.mock('@/lib/supabase/db', () => ({ userDb: { update: (...a: unknown[]) => userUpdate(...a) }, getAdminDb: () => adminDb }));

const actions = await import('@/actions/auth-actions');

const newUser = { id: 'new-1', email: 'new@example.test', identities: [{ provider: 'email' }] };
const form = { name: 'Ali', email: 'new@example.test', password: 'hunter22!', captchaToken: 'tok' };
const login = { email: 'a@b.co', password: 'pw', captchaToken: 'tok' };

beforeEach(() => {
  sb = createSupabaseMock({ user: newUser });
  ssr = undefined;
  for (const fn of [cookieStore.set, redirect, sendPasswordSetupEmail, checkLimit, userUpdate]) fn.mockReset();
  checkLimit.mockResolvedValue({ success: true });
  userUpdate.mockResolvedValue({});
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.test/');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('loginAction', () => {
  it('signs in and sends the player to the quizzes', async () => {
    expect(await actions.loginAction(login)).toEqual({ success: true, redirectTo: '/quizzes' });
    expect(sb.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw', options: { captchaToken: 'tok' } });
  });

  it('validates the input before calling Supabase', async () => {
    expect(await actions.loginAction({ ...login, email: 'not-an-email' })).toEqual({ success: false, error: 'Invalid input format' });
    expect(await actions.loginAction({ ...login, password: '' })).toEqual({ success: false, error: 'Invalid input format' });
    expect(await actions.loginAction({ ...login, captchaToken: '' })).toEqual({ success: false, error: 'Please complete the security check.' });
    expect(sb.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    ['Invalid login credentials', 'Invalid email or password'],
    ['Email not confirmed', 'Please verify your email before logging in'],
    ['Too many requests', 'Too many requests'],
    ['captcha protection: request disallowed (timeout-or-duplicate)', 'The security check failed or expired. Please try again.'],
  ])('maps "%s" to a friendly message', async (message, error) => {
    sb.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message } } as never);
    expect(await actions.loginAction(login)).toEqual({ success: false, error });
  });

  it('catches unexpected errors', async () => {
    sb.auth.signInWithPassword.mockRejectedValueOnce(new Error('network'));
    expect(await actions.loginAction(login)).toEqual({ success: false, error: 'An unexpected error occurred during login' });
  });

  it('keeps Supabase cookies in sync, even when cookies are read-only', async () => {
    await actions.loginAction(login);
    expect(ssr!.getAll()).toEqual([{ name: 'sb', value: 'v' }]);
    ssr!.setAll([{ name: 'sb', value: 'new', options: { path: '/' } }]);
    expect(cookieStore.set).toHaveBeenCalledWith('sb', 'new', { path: '/' });
    cookieStore.set.mockImplementationOnce(() => { throw new Error('read-only'); });
    expect(() => ssr!.setAll([{ name: 'x', value: 'y' }])).not.toThrow();
  });
});

describe('registerAction', () => {
  it('signs up with a confirmation link and stores the profile on the trigger-created row', async () => {
    const res = await actions.registerAction({ ...form, phone: '03001234567', dateOfBirth: '2000-01-02' });

    expect(res).toEqual({ success: true, redirectTo: '/auth?registered=true' });
    expect(sb.auth.signUp).toHaveBeenCalledWith({
      email: 'new@example.test',
      password: 'hunter22!',
      options: {
        data: { name: 'Ali', phone: '03001234567', date_of_birth: '2000-01-02' },
        emailRedirectTo: 'https://site.example.test/auth/callback?next=/quizzes',
        captchaToken: 'tok',
      },
    });
    const [id, fields] = userUpdate.mock.calls[0];
    expect(id).toBe('new-1');
    expect(fields).toMatchObject({ name: 'Ali', authProvider: 'email', phone: '03001234567', dateOfBirth: '2000-01-02T00:00:00.000Z' });
    expect(fields.password).toMatch(/^\$2[aby]\$12\$/);
    expect(fields.password).not.toContain('hunter22');
  });

  it('leaves optional fields out and sends nulls to Supabase', async () => {
    await actions.registerAction(form);
    expect(mockArg(sb.auth.signUp).options.data).toEqual({ name: 'Ali', phone: null, date_of_birth: null });
    expect(Object.keys(userUpdate.mock.calls[0][1]).sort()).toEqual(['authProvider', 'name', 'password']);
  });

  it('still succeeds when the profile update fails (the auth user exists)', async () => {
    userUpdate.mockRejectedValueOnce(new Error('rls'));
    expect(await actions.registerAction(form)).toEqual({ success: true, redirectTo: '/auth?registered=true' });
    // an invalid date makes toISOString() throw inside the same guarded block
    expect(await actions.registerAction({ ...form, dateOfBirth: 'not a date' })).toMatchObject({ success: true });
  });

  it('succeeds without touching the profile when Supabase returns no user', async () => {
    sb.setUser(null);
    expect(await actions.registerAction(form)).toEqual({ success: true, redirectTo: '/auth?registered=true' });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  describe('an email that already has an account (no identities returned)', () => {
    beforeEach(() => sb.setUser({ id: 'obfuscated', email: 'new@example.test', identities: [] }));

    it('emails a set-password link with the service-role client and answers like a new sign-up', async () => {
      expect(await actions.registerAction({ ...form, email: ' New@Example.test ' })).toEqual({ success: true, redirectTo: '/auth?registered=true' });
      expect(checkLimit).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.any(Headers) }), 'register-existing:new@example.test', '/register');
      // the sign-up used up the Turnstile token; the service-role client needs none
      expect(sendPasswordSetupEmail).toHaveBeenCalledWith(adminDb, ' New@Example.test ');
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('stays quiet once the per-address limit is reached, or when sending fails', async () => {
      checkLimit.mockResolvedValueOnce({ success: false });
      expect((await actions.registerAction(form)).success).toBe(true);
      expect(sendPasswordSetupEmail).not.toHaveBeenCalled();

      sendPasswordSetupEmail.mockRejectedValueOnce(new Error('smtp'));
      expect((await actions.registerAction(form)).success).toBe(true);
    });

    it('treats a missing identities list the same way', async () => {
      sb.setUser({ id: 'obfuscated', email: 'new@example.test' });
      await actions.registerAction(form);
      expect(sendPasswordSetupEmail).toHaveBeenCalled();
    });
  });

  it.each([
    [{ message: 'User already registered' }, 'This email is already registered. Please sign in instead.'],
    [{ message: 'Error sending confirmation email' }, 'Unable to send confirmation email. Please try again or contact support.'],
    [{ message: 'Database error', status: 500 }, 'Unable to send confirmation email. Please try again or contact support.'],
    [{ message: 'Password should be at least 6 characters' }, 'Password should be at least 6 characters'],
    [{ message: 'captcha protection: request disallowed (no captcha_token found)', code: 'captcha_failed' }, 'The security check failed or expired. Please try again.'],
  ])('maps sign-up error %o', async (signUpError, error) => {
    sb.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: signUpError } as never);
    expect(await actions.registerAction(form)).toEqual({ success: false, error });
  });

  it('asks for the security check before calling Supabase', async () => {
    expect(await actions.registerAction({ ...form, captchaToken: '' })).toEqual({ success: false, error: 'Please complete the security check.' });
    expect(sb.auth.signUp).not.toHaveBeenCalled();
  });

  it('catches unexpected errors', async () => {
    sb.auth.signUp.mockRejectedValueOnce(new Error('network'));
    expect(await actions.registerAction(form)).toEqual({ success: false, error: 'An unexpected error occurred during registration' });
  });

  it('falls back to localhost when no site URL is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    await actions.registerAction(form);
    expect(mockArg(sb.auth.signUp).options.emailRedirectTo).toBe('http://localhost:3000/auth/callback?next=/quizzes');
  });
});

describe('signOutAction', () => {
  it('signs out and redirects to /auth', async () => {
    await actions.signOutAction();
    expect(sb.auth.signOut).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/auth');
  });
});

describe('getGoogleOAuthUrl', () => {
  it('returns the provider URL without redirecting the browser itself', async () => {
    expect(await actions.getGoogleOAuthUrl('/profile')).toBe('https://accounts.example.test/oauth');
    expect(sb.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://site.example.test/auth/callback?next=/profile', skipBrowserRedirect: true },
    });
    await actions.getGoogleOAuthUrl();
    expect(mockArg(sb.auth.signInWithOAuth, 1).options.redirectTo).toMatch(/next=\/quizzes$/);
  });

  it('returns null on errors', async () => {
    sb.auth.signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: { message: 'provider disabled' } } as never);
    expect(await actions.getGoogleOAuthUrl()).toBeNull();
    sb.auth.signInWithOAuth.mockRejectedValueOnce(new Error('network'));
    expect(await actions.getGoogleOAuthUrl()).toBeNull();
  });
});
