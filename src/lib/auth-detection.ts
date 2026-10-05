/**
 * Sign-in method detector for the profile.
 *
 * Two different questions, which must not be confused:
 *  - HOW DID THIS SESSION SIGN IN?  (Google today, or email + password?)  -> the access token's `amr`
 *    claim ("authentication methods reference") says how the current session was authenticated.
 *  - WHAT CAN THIS ACCOUNT DO?  (has a password? which providers are linked?)  -> the user object.
 *
 * `app_metadata.provider` is neither: it only records how the account was FIRST created and never
 * changes, so reading it made a password sign-in still look like "Google".
 *
 * Pure functions, safe for client and server.
 */
import { userHasPassword } from './password-status';

export type SignInMethod = 'google' | 'password' | 'email_link' | 'other_oauth' | 'unknown';

export interface AmrEntry {
    method: string;
    timestamp?: number;
    provider?: string;
}

export interface AuthDetection {
    /** How the current session signed in */
    currentMethod: SignInMethod;
    /** Badge text for the profile */
    label: string;
    /** Signed in with Google AND Google says the email is verified */
    verifiedGoogle: boolean;
    emailVerified: boolean;
    /** The account can sign in with email + password (the account has one; the dialog also depends on how the session signed in) */
    hasPassword: boolean;
    /** OAuth providers linked to the account, e.g. ["google"] */
    linkedProviders: string[];
}

interface UserLike {
    email_confirmed_at?: string | null;
    identities?: Array<{ provider: string; identity_data?: Record<string, unknown> | null }> | null;
    app_metadata?: Record<string, unknown> | null;
}

/** Read the `amr` claim from an access token (display only; the token was already validated by Supabase). */
export function decodeAmr(accessToken: string | null | undefined): AmrEntry[] {
    if (!accessToken) return [];
    try {
        const payload = accessToken.split('.')[1];
        if (!payload) return [];
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const json =
            typeof atob === 'function'
                ? decodeURIComponent(
                      Array.from(atob(base64), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
                  )
                : Buffer.from(base64, 'base64').toString('utf8');
        const amr = JSON.parse(json)?.amr;
        return Array.isArray(amr) ? (amr as AmrEntry[]).filter((e) => e && typeof e.method === 'string') : [];
    } catch {
        return [];
    }
}

// amr entries that describe housekeeping, not how the person signed in
const IGNORED_METHODS = new Set(['token_refresh', 'anonymous']);

export const PROVIDER_LABELS: Record<string, string> = { google: 'Google', github: 'GitHub', facebook: 'Facebook', apple: 'Apple' };
const providerLabel = (p: string) => PROVIDER_LABELS[p] || p.charAt(0).toUpperCase() + p.slice(1);

export function detectAuth(user: UserLike | null | undefined, amr: AmrEntry[] = []): AuthDetection {
    const identities = user?.identities || [];
    const linkedProviders = identities.map((i) => i.provider).filter((p) => p && p !== 'email');

    const emailVerified =
        Boolean(user?.email_confirmed_at) || identities.some((i) => i.identity_data?.email_verified === true);

    // The method of the current session = the most recent meaningful amr entry
    const meaningful = amr.filter((e) => !IGNORED_METHODS.has(e.method));
    const latest = meaningful.length
        ? meaningful.reduce((a, b) => ((b.timestamp ?? 0) >= (a.timestamp ?? 0) ? b : a))
        : undefined;

    let currentMethod: SignInMethod = 'unknown';
    let oauthProvider: string | undefined;

    if (latest) {
        if (latest.method === 'password') {
            currentMethod = 'password';
        } else if (latest.method === 'oauth') {
            oauthProvider = latest.provider || (linkedProviders.length === 1 ? linkedProviders[0] : undefined);
            currentMethod = oauthProvider && oauthProvider !== 'google' ? 'other_oauth' : 'google';
        } else if (['otp', 'magiclink', 'recovery', 'email/signup', 'invite', 'email_change'].includes(latest.method)) {
            currentMethod = 'email_link';
        }
    } else {
        // No token details available: fall back to how the account was created
        const created = user?.app_metadata?.provider as string | undefined;
        if (created === 'google') currentMethod = 'google';
        else if (created === 'email') currentMethod = 'password';
        else if (created) {
            currentMethod = 'other_oauth';
            oauthProvider = created;
        }
    }

    // Signing in with a password proves the account has one, even if it isn't marked yet
    const hasPassword = userHasPassword(user) || currentMethod === 'password';

    const verifiedGoogle = currentMethod === 'google' && emailVerified;

    const label =
        currentMethod === 'google'
            ? verifiedGoogle
                ? 'Verified Google sign-in'
                : 'Google sign-in'
            : currentMethod === 'password'
              ? 'Email & password'
              : currentMethod === 'email_link'
                ? 'Email link sign-in'
                : currentMethod === 'other_oauth'
                  ? `${providerLabel(oauthProvider || linkedProviders[0] || 'social')} sign-in`
                  : 'Signed in';

    return { currentMethod, label, verifiedGoogle, emailVerified, hasPassword, linkedProviders };
}

/**
 * Title of the password dialog/page. "Change password" only for a session that signed in with a password
 * (it asks for the current one); every other session (Google, emailed link) gets "Set up password".
 */
export function passwordDialogTitle(canChangeWithCurrentPassword: boolean | null | undefined): string {
    if (canChangeWithCurrentPassword === null || canChangeWithCurrentPassword === undefined) return 'Password';
    return canChangeWithCurrentPassword ? 'Change password' : 'Set up password';
}
