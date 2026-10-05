import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ auth: { getUser: vi.fn(), getSession: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: h.auth }) }));

import { decodeAmr, detectAuth, passwordDialogTitle } from '@/lib/auth-detection';
import { HAS_PASSWORD_FLAG } from '@/lib/password-status';
import { GET as authMethod } from '@/app/api/profile/auth-method/route';

/** Build an unsigned JWT-shaped token with the given payload (the detector only reads the payload). */
const token = (payload: object) => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
};

// Shapes taken from the live project: a Google-created account keeps identities ["google"] even after
// it sets a password (we record has_password in app_metadata).
const googleIdentity = { provider: 'google', identity_data: { email_verified: true } };
const googleOnly = {
    email_confirmed_at: '2026-10-05T11:48:58Z',
    identities: [googleIdentity],
    app_metadata: { provider: 'google', providers: ['google'] },
};
const googleWithPassword = { ...googleOnly, app_metadata: { ...googleOnly.app_metadata, [HAS_PASSWORD_FLAG]: true } };
const emailAccount = {
    email_confirmed_at: '2026-10-05T11:00:00Z',
    identities: [{ provider: 'email', identity_data: { email_verified: true } }],
    app_metadata: { provider: 'email', providers: ['email'] },
};

describe('decodeAmr()', () => {
    it('reads how the session signed in from the access token', () => {
        expect(decodeAmr(token({ amr: [{ method: 'password', timestamp: 5 }] }))).toEqual([{ method: 'password', timestamp: 5 }]);
    });
    it('returns [] for missing, malformed or amr-less tokens instead of throwing', () => {
        expect(decodeAmr(undefined)).toEqual([]);
        expect(decodeAmr('not-a-token')).toEqual([]);
        expect(decodeAmr('a.%%%.c')).toEqual([]);
        expect(decodeAmr(token({ sub: 'x' }))).toEqual([]);
    });
});

describe('detectAuth() - requirement 1: a Google sign-in shows as verified Google', () => {
    it('Google session on a verified Google account', () => {
        const d = detectAuth(googleOnly, [{ method: 'oauth', timestamp: 1, provider: 'google' }]);
        expect(d.currentMethod).toBe('google');
        expect(d.verifiedGoogle).toBe(true);
        expect(d.label).toBe('Verified Google sign-in');
        expect(d.hasPassword).toBe(false); // → the dialog will say "Set a Password"
    });

    it('does not claim "verified" when the email is not verified', () => {
        const d = detectAuth(
            { identities: [{ provider: 'google', identity_data: { email_verified: false } }], app_metadata: { provider: 'google' } },
            [{ method: 'oauth', timestamp: 1 }]
        );
        expect(d.currentMethod).toBe('google');
        expect(d.verifiedGoogle).toBe(false);
        expect(d.label).toBe('Google sign-in');
    });
});

describe('detectAuth() - requirement 3: after setting a password and signing in with it', () => {
    it('recognises email & password even though the account was created with Google', () => {
        const d = detectAuth(googleWithPassword, [{ method: 'password', timestamp: 9 }]);
        expect(d.currentMethod).toBe('password');
        expect(d.label).toBe('Email & password');
        expect(d.hasPassword).toBe(true); // → "Change a Password"
        expect(d.linkedProviders).toEqual(['google']); // still reports Google is linked
        expect(d.verifiedGoogle).toBe(false);
    });

    it('treats a password sign-in as proof of a password, even before the account is marked (older accounts)', () => {
        const d = detectAuth(googleOnly, [{ method: 'password', timestamp: 9 }]); // identities still ["google"], no flag
        expect(d.currentMethod).toBe('password');
        expect(d.hasPassword).toBe(true); // → "Change a Password", not "Set a Password"
    });

    it('the same account signing in with Google again is still recognised as Google, with a password set', () => {
        const d = detectAuth(googleWithPassword, [{ method: 'oauth', timestamp: 9, provider: 'google' }]);
        expect(d.currentMethod).toBe('google');
        expect(d.hasPassword).toBe(true);
    });

    it('a plain email account signing in with its password', () => {
        const d = detectAuth(emailAccount, [{ method: 'password', timestamp: 1 }]);
        expect(d.currentMethod).toBe('password');
        expect(d.hasPassword).toBe(true);
        expect(d.linkedProviders).toEqual([]);
    });
});

describe('detectAuth() - other cases', () => {
    it('a session started from an emailed link (set/reset password) is an "email link" sign-in', () => {
        expect(detectAuth(googleOnly, [{ method: 'recovery', timestamp: 1 }]).currentMethod).toBe('email_link');
        expect(detectAuth(googleOnly, [{ method: 'otp', timestamp: 1 }]).label).toBe('Email link sign-in');
    });

    it('ignores token_refresh housekeeping entries', () => {
        const d = detectAuth(googleWithPassword, [
            { method: 'password', timestamp: 1 },
            { method: 'token_refresh', timestamp: 99 },
        ]);
        expect(d.currentMethod).toBe('password');
    });

    it('uses the most recent meaningful method', () => {
        const d = detectAuth(googleWithPassword, [
            { method: 'oauth', timestamp: 1, provider: 'google' },
            { method: 'password', timestamp: 2 },
        ]);
        expect(d.currentMethod).toBe('password');
    });

    it('falls back to how the account was created when the token has no amr', () => {
        expect(detectAuth(googleOnly, []).currentMethod).toBe('google');
        expect(detectAuth(emailAccount, []).currentMethod).toBe('password');
        expect(detectAuth(null, []).currentMethod).toBe('unknown');
    });

    it('labels other OAuth providers instead of calling them Google', () => {
        const d = detectAuth(
            { identities: [{ provider: 'github' }], app_metadata: { provider: 'github' } },
            [{ method: 'oauth', timestamp: 1, provider: 'github' }]
        );
        expect(d.currentMethod).toBe('other_oauth');
        expect(d.label).toBe('GitHub sign-in');
    });
});

describe('passwordDialogTitle()', () => {
    it('says "Set up password" unless the session signed in with a password, then "Change password"', () => {
        expect(passwordDialogTitle(false)).toBe('Set up password');
        expect(passwordDialogTitle(true)).toBe('Change password');
    });
    it('stays neutral while the answer is still loading', () => {
        expect(passwordDialogTitle(null)).toBe('Password');
        expect(passwordDialogTitle(undefined)).toBe('Password');
    });
});

describe('GET /api/profile/auth-method', () => {
    beforeEach(() => vi.clearAllMocks());

    it('combines the fresh user with the session token\'s amr', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: googleWithPassword }, error: null });
        h.auth.getSession.mockResolvedValue({ data: { session: { access_token: token({ amr: [{ method: 'password', timestamp: 3 }] }) } } });

        const res = await authMethod();
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(body).toMatchObject({ currentMethod: 'password', label: 'Email & password', hasPassword: true, linkedProviders: ['google'] });
    });

    it('requires a signed-in user', async () => {
        h.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
        const res = await authMethod();
        expect(res.status).toBe(401);
    });
});
