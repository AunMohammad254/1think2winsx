import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- shared fakes -------------------------------------------------------------------------------
const h = vi.hoisted(() => {
    const auth = {
        signUp: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        getUser: vi.fn(),
        getSession: vi.fn(),
        updateUser: vi.fn(),
        signInWithPassword: vi.fn(),
    };
    return {
        auth,
        // the service-role client: Supabase asks it for no CAPTCHA token
        adminAuth: { resetPasswordForEmail: vi.fn() },
        authLimit: vi.fn(),
        pwLimit: vi.fn(),
        userUpdate: vi.fn(),
        reserveEmails: vi.fn(),
        releaseEmails: vi.fn(),
    };
});

// registerAction builds its own client with @supabase/ssr
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: h.auth }) }));
// everything else uses the shared server client
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: h.auth }) }));
vi.mock('next/headers', () => ({
    cookies: async () => ({ getAll: () => [], set: () => undefined }),
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/db', () => ({ userDb: { update: h.userUpdate }, getAdminDb: () => ({ auth: h.adminAuth }) }));
// updatePassword records has_password through the admin client; keep it out of the real project
vi.mock('@/lib/supabase/db-modules/shared', () => ({
    getAdminDb: () => ({ auth: { admin: { updateUserById: vi.fn().mockResolvedValue({ error: null }) } } }),
}));
vi.mock('@/lib/rate-limiter', () => ({
    rateLimiters: {
        auth: { checkLimit: h.authLimit },
        passwordChange: { checkLimit: h.pwLimit },
    },
    applyRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/security-logger', () => ({
    securityLogger: { logUnauthorizedAccess: vi.fn(), logInvalidInput: vi.fn(), logAuthFailure: vi.fn() },
}));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: vi.fn() }));
// The daily email limit: the real messages, a stand-in counter
vi.mock('@/lib/email-quota', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/email-quota')>()),
    reserveEmails: h.reserveEmails,
    releaseEmails: h.releaseEmails,
}));

import { registerAction } from '@/actions/auth-actions';
import { updatePassword } from '@/app/update-password/actions';
import { requestPasswordSetupEmail } from '@/actions/password-setup-actions';
import { PUT as changePassword } from '@/app/api/profile/change-password/route';

const EXPECTED_REDIRECT = 'https://1think2win.com/auth/callback?next=/update-password';
const googleUser = { id: 'g1', email: 'fan@example.com', identities: [{ provider: 'google' }] };
const emailUser = { id: 'e1', email: 'fan@example.com', identities: [{ provider: 'email' }] };

const registerForm = {
    name: 'Fan',
    email: 'fan@example.com',
    password: 'Str0ng!Passw0rd',
    captchaToken: 'tok',
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://1think2win.com/'); // trailing slash on purpose
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    h.authLimit.mockResolvedValue({ success: true });
    h.pwLimit.mockResolvedValue({ success: true });
    h.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    h.adminAuth.resetPasswordForEmail.mockResolvedValue({ error: null });
    h.auth.getSession.mockResolvedValue({ data: { session: null } });
    h.auth.updateUser.mockResolvedValue({ error: null });
    h.auth.getUser.mockResolvedValue({ data: { user: googleUser }, error: null });
    h.reserveEmails.mockResolvedValue({ ok: true, id: 9 });
});

const LIMIT_REACHED = { ok: false, used: 299, cap: 299, remaining: 0, retryAt: null };
const LIMIT_MESSAGE = "Today's email limit has been reached, so we can't send this email right now. Please try again tomorrow.";

describe('registering with an email that already has an account (e.g. created with Google)', () => {
    it('emails a "set your password" link and answers exactly like a new sign-up', async () => {
        // Supabase's reply for an existing address: a user with NO identities
        h.auth.signUp.mockResolvedValue({ data: { user: { id: 'g1', identities: [] } }, error: null });

        const result = await registerAction(registerForm);

        // the sign-up used up the Turnstile token, so the email goes through the service-role client
        expect(h.auth.signUp.mock.calls[0][0].options.captchaToken).toBe('tok');
        expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();
        expect(h.adminAuth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
        expect(h.adminAuth.resetPasswordForEmail).toHaveBeenCalledWith('fan@example.com', { redirectTo: EXPECTED_REDIRECT });
        expect(result).toEqual({ success: true, redirectTo: '/auth?registered=true' }); // no "already exists" error
        expect(h.userUpdate).not.toHaveBeenCalled(); // never touches the existing user's row
    });

    it('stays quiet (no email, same answer) once the per-address limit is hit', async () => {
        h.auth.signUp.mockResolvedValue({ data: { user: { id: 'g1', identities: [] } }, error: null });
        h.authLimit.mockResolvedValue({ success: false });

        const result = await registerAction(registerForm);

        expect(h.authLimit.mock.calls[0][1]).toBe('register-existing:fan@example.com');
        expect(h.adminAuth.resetPasswordForEmail).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it('does not send a reset email for a genuinely new sign-up', async () => {
        h.auth.signUp.mockResolvedValue({
            data: { user: { id: 'n1', identities: [{ provider: 'email' }] } },
            error: null,
        });

        const result = await registerAction(registerForm);

        expect(h.adminAuth.resetPasswordForEmail).not.toHaveBeenCalled();
        expect(h.userUpdate).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ success: true, redirectTo: '/auth?registered=true' });
    });
});

describe('setting a password from the emailed link', () => {
    const form = (pw: string) => {
        const f = new FormData();
        f.append('password', pw);
        f.append('confirmPassword', pw);
        return f;
    };

    it('now works for an account created with Google', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleUser }, error: null });
        const result = await updatePassword(form('Str0ng!Passw0rd'));
        expect(h.auth.updateUser).toHaveBeenCalledWith({ password: 'Str0ng!Passw0rd' });
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('still needs a valid session', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
        const result = await updatePassword(form('Str0ng!Passw0rd'));
        expect(result.error).toMatch(/Session expired/);
        expect(h.auth.updateUser).not.toHaveBeenCalled();
    });
});

describe('profile: "Email me a link to set a password" (Google-only account)', () => {
    it('emails the signed-in person at their own address, with the Turnstile token', async () => {
        const result = await requestPasswordSetupEmail('tok');
        expect(h.auth.resetPasswordForEmail).toHaveBeenCalledWith('fan@example.com', { redirectTo: EXPECTED_REDIRECT, captchaToken: 'tok' });
        expect(result).toEqual({ success: true, email: 'fan@example.com' });
        expect(h.pwLimit.mock.calls[0][1]).toBe('g1'); // limited per user
    });

    it('refuses without a session', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const result = await requestPasswordSetupEmail('tok');
        expect(result.error).toMatch(/sign in again/i);
        expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('is rate limited per user', async () => {
        h.pwLimit.mockResolvedValue({ success: false });
        const result = await requestPasswordSetupEmail('tok');
        expect(result.error).toMatch(/Too many/);
        expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('reports a failed send instead of claiming success', async () => {
        h.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'smtp down' } });
        const result = await requestPasswordSetupEmail('tok');
        expect(result.success).toBeUndefined();
        expect(result.error).toMatch(/couldn't send/i);
    });

    it('asks for the security check again when Supabase rejects the token', async () => {
        h.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'captcha protection: request disallowed', code: 'captcha_failed' } });
        expect(await requestPasswordSetupEmail('used')).toEqual({ error: 'The security check failed or expired. Please try again.' });
        expect(await requestPasswordSetupEmail('')).toEqual({ error: 'Please complete the security check.' });
    });

    it("counts the email against today's limit, and gives it back when Supabase doesn't send it", async () => {
        await requestPasswordSetupEmail('tok');
        expect(h.reserveEmails).toHaveBeenCalledWith('password');
        expect(h.releaseEmails).not.toHaveBeenCalled();

        h.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'smtp down' } });
        await requestPasswordSetupEmail('tok');
        expect(h.releaseEmails).toHaveBeenCalledExactlyOnceWith(9);
    });

    it("sends nothing once today's email limit is reached, and says so", async () => {
        h.reserveEmails.mockResolvedValue(LIMIT_REACHED);
        expect(await requestPasswordSetupEmail('tok')).toEqual({ error: LIMIT_MESSAGE });
        expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });
});

describe('API: PUT /api/profile/change-password', () => {
    const put = (body: unknown) =>
        changePassword(
            new NextRequest('http://localhost/api/profile/change-password', {
                method: 'PUT',
                body: JSON.stringify(body),
                headers: { 'content-type': 'application/json' },
            })
        );

    it('for a Google-only account, emails a set-password link instead of the old "manage it with your provider" error', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleUser }, error: null });

        const res = await put({ captchaToken: 'tok' }); // no currentPassword needed
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.resetEmailSent).toBe(true);
        expect(body.message).not.toMatch(/OAuth provider/i);
        expect(h.auth.resetPasswordForEmail).toHaveBeenCalledWith('fan@example.com', { redirectTo: EXPECTED_REDIRECT, captchaToken: 'tok' });
        expect(h.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it("answers 429 with the reason once today's email limit is reached", async () => {
        h.reserveEmails.mockResolvedValue(LIMIT_REACHED);
        const res = await put({ captchaToken: 'tok' });
        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({ message: LIMIT_MESSAGE });
        expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('leaves the normal change-password flow alone for email/password accounts', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: emailUser }, error: null });
        h.auth.signInWithPassword.mockResolvedValue({ error: { message: 'bad password' } });

        const res = await put({ currentPassword: 'wrong', newPassword: 'Str0ng!Passw0rd', captchaToken: 'tok' });

        expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();
        expect(h.auth.signInWithPassword).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(400);
    });
});
