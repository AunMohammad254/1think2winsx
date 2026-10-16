import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    auth: {
        getUser: vi.fn(),
        getSession: vi.fn(),
        updateUser: vi.fn(),
        signInWithPassword: vi.fn(),
        resetPasswordForEmail: vi.fn(),
    },
    updateUserById: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: h.auth }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: h.auth }) }));
vi.mock('@/lib/supabase/db-modules/shared', () => ({
    getAdminDb: () => ({ auth: { admin: { updateUserById: h.updateUserById } } }),
}));
vi.mock('@/lib/logger', () => ({ default: { log: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/rate-limiter', () => ({
    rateLimiters: { passwordChange: { checkLimit: vi.fn() } },
    applyRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/csrf-protection', () => ({ requireCSRFToken: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/security-logger', () => ({
    securityLogger: { logUnauthorizedAccess: vi.fn(), logInvalidInput: vi.fn(), logAuthFailure: vi.fn(), logSecurityEvent: vi.fn() },
}));
vi.mock('@/lib/security-monitoring', () => ({ recordSecurityEvent: vi.fn() }));

import { userHasPassword, HAS_PASSWORD_FLAG } from '@/lib/password-status';
import { isOAuthOnlyUser, getUserAuthMethods } from '@/lib/auth-helpers';
import { GET as canChangePassword } from '@/app/api/profile/can-change-password/route';
import { PUT as changePassword } from '@/app/api/profile/change-password/route';
import { updatePassword } from '@/app/update-password/actions';

// What the live project returned for a Google account that set a password: still only "google".
const googleOnly = { id: 'g1', email: 'fan@example.com', identities: [{ provider: 'google' }], app_metadata: { provider: 'google', providers: ['google'] } };
const googleWithPassword = { ...googleOnly, app_metadata: { ...googleOnly.app_metadata, [HAS_PASSWORD_FLAG]: true } };
const emailUser = { id: 'e1', email: 'fan@example.com', identities: [{ provider: 'email' }], app_metadata: { provider: 'email', providers: ['email'] } };

beforeEach(() => {
    vi.clearAllMocks();
    h.updateUserById.mockResolvedValue({ error: null });
    h.auth.getSession.mockResolvedValue({ data: { session: null } });
    h.auth.updateUser.mockResolvedValue({ error: null });
    h.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe('userHasPassword()', () => {
    it('is false for a Google-only account', () => expect(userHasPassword(googleOnly)).toBe(false));
    it('is true for a Google account that has set a password (the has_password flag)', () => expect(userHasPassword(googleWithPassword)).toBe(true));
    it('is true for an email/password account', () => expect(userHasPassword(emailUser)).toBe(true));
    it('is true when Supabase lists the email provider', () =>
        expect(userHasPassword({ identities: [{ provider: 'google' }], app_metadata: { providers: ['google', 'email'] } })).toBe(true));
    it('is false for no user, and ignores a non-true flag', () => {
        expect(userHasPassword(null)).toBe(false);
        expect(userHasPassword({ identities: [], app_metadata: { [HAS_PASSWORD_FLAG]: 'yes' } })).toBe(false);
    });
});

describe('client helpers follow it (what the Change Password dialog and page use)', () => {
    it('Google-only → "set a password" (OAuth-only)', () => {
        expect(isOAuthOnlyUser(googleOnly as never)).toBe(true);
        expect(getUserAuthMethods(googleOnly as never).canChangePassword).toBe(false);
    });
    it('Google + password → "change password"', () => {
        expect(isOAuthOnlyUser(googleWithPassword as never)).toBe(false);
        const m = getUserAuthMethods(googleWithPassword as never);
        expect(m.canChangePassword).toBe(true);
        expect(m.hasEmailPassword).toBe(true);
        expect(m.oAuthProviders).toEqual(['google']); // still shows Google is linked
    });
});

describe('GET /api/profile/can-change-password', () => {
    const get = async (user: unknown) => {
        h.auth.getUser.mockResolvedValue({ data: { user }, error: null });
        const res = await canChangePassword();
        return res.json();
    };

    it('Google-only: cannot change, can set one', async () => {
        const body = await get(googleOnly);
        expect(body.canChangePassword).toBe(false);
        expect(body.authMethod).toBe('oauth');
    });

    it('Google account that has a password, but signed in with GOOGLE: "Set up password" flow, not the change form', async () => {
        h.auth.getSession.mockResolvedValue({ data: { session: { access_token: `x.${Buffer.from(JSON.stringify({ amr: [{ method: 'oauth', timestamp: 1, provider: 'google' }] })).toString('base64url')}.y` } } });
        const body = await get(googleWithPassword);
        expect(body.canChangePassword).toBe(false); // a Google session does not know the current password
        expect(body.hasPassword).toBe(true); // but the account does have one (the copy says "set a new one")
        expect(body.currentMethod).toBe('google');
        expect(body.oAuthProviders).toEqual(['google']);
    });

    it('Google account that has a password, signed in WITH THE PASSWORD: "Change password"', async () => {
        h.auth.getSession.mockResolvedValue({ data: { session: { access_token: `x.${Buffer.from(JSON.stringify({ amr: [{ method: 'password', timestamp: 1 }] })).toString('base64url')}.y` } } });
        const body = await get(googleWithPassword);
        expect(body.canChangePassword).toBe(true);
        expect(body.hasPassword).toBe(true);
        expect(body.currentMethod).toBe('password');
    });

    it('email/password account: can change', async () => {
        expect((await get(emailUser)).canChangePassword).toBe(true);
    });
});

describe('an older Google account (password set before the flag existed) signed in with its password', () => {
    // 'password' is the exact method Supabase recorded for the live email+password sign-in
    const passwordSession = {
        data: { session: { access_token: `x.${Buffer.from(JSON.stringify({ amr: [{ method: 'password', timestamp: 5 }] })).toString('base64url')}.y` } },
    };
    const googleSession = {
        data: { session: { access_token: `x.${Buffer.from(JSON.stringify({ amr: [{ method: 'oauth', timestamp: 5, provider: 'google' }] })).toString('base64url')}.y` } },
    };

    it('is offered "Change a Password", and the flag is saved automatically', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleOnly }, error: null });
        h.auth.getSession.mockResolvedValue(passwordSession);

        const body = await (await canChangePassword()).json();

        expect(body.canChangePassword).toBe(true);
        expect(body.hasPassword).toBe(true);
        expect(h.updateUserById).toHaveBeenCalledWith('g1', { app_metadata: { [HAS_PASSWORD_FLAG]: true } });
    });

    it('does not mark anything for a Google session (that proves nothing about a password)', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleOnly }, error: null });
        h.auth.getSession.mockResolvedValue(googleSession);

        const body = await (await canChangePassword()).json();

        expect(body.canChangePassword).toBe(false);
        expect(h.updateUserById).not.toHaveBeenCalled();
    });

    it('does not re-save the flag when the account is already marked', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleWithPassword }, error: null });
        h.auth.getSession.mockResolvedValue(passwordSession);

        await canChangePassword();

        expect(h.updateUserById).not.toHaveBeenCalled();
    });
});

describe('PUT /api/profile/change-password for a Google account that has a password', () => {
    it('runs the normal change flow (verifies the current password) and does NOT send a set-password email', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleWithPassword }, error: null });
        h.auth.signInWithPassword
            .mockResolvedValueOnce({ error: null }) // current password is right
            .mockResolvedValueOnce({ error: { message: 'invalid' } }); // new one differs from current

        const res = await changePassword(
            new NextRequest('http://localhost/api/profile/change-password', {
                method: 'PUT',
                body: JSON.stringify({ currentPassword: 'Old!Passw0rd1', newPassword: 'New!Passw0rd2' }),
                headers: { 'content-type': 'application/json' },
            })
        );

        expect(res.status).toBe(200);
        expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();
        expect(h.auth.updateUser).toHaveBeenCalledWith({ password: 'New!Passw0rd2' });
    });
});

describe('setting a password from the emailed link records that the account now has one', () => {
    const form = () => {
        const f = new FormData();
        f.append('password', 'Str0ng!Passw0rd');
        f.append('confirmPassword', 'Str0ng!Passw0rd');
        return f;
    };

    it('stores has_password in the account\'s server-only app_metadata', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleOnly }, error: null });
        const result = await updatePassword(form());
        expect(result.success).toBe(true);
        expect(h.updateUserById).toHaveBeenCalledWith('g1', { app_metadata: { [HAS_PASSWORD_FLAG]: true } });
    });

    it('does not mark anything when the password update fails', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleOnly }, error: null });
        h.auth.updateUser.mockResolvedValue({ error: { message: 'nope' } });
        const result = await updatePassword(form());
        expect(result.error).toBeTruthy();
        expect(h.updateUserById).not.toHaveBeenCalled();
    });

    it('still reports success if saving the flag fails (the password itself was changed)', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleOnly }, error: null });
        h.updateUserById.mockResolvedValue({ error: { message: 'admin api down' } });
        const result = await updatePassword(form());
        expect(result.success).toBe(true);
    });
});
