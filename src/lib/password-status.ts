/**
 * Does this Supabase account have a password it can sign in with?
 *
 * Do NOT infer this from `identities` alone. When someone who signed up with Google later sets a
 * password, Supabase stores the password but does not add an "email" identity, so such an account
 * still shows only ["google"] (checked against the live project). The app therefore records a
 * server-only `app_metadata.has_password = true` when a password is set through it (see
 * markPasswordSet in ./password-flag), and this helper honours both signals.
 *
 * Safe for client and server code (no imports with side effects).
 */

/** Key in `app_metadata`. Only the service role can write app_metadata, so users can't forge it. */
export const HAS_PASSWORD_FLAG = 'has_password';

interface UserLike {
    identities?: Array<{ provider: string }> | null;
    app_metadata?: Record<string, unknown> | null;
}

export function userHasPassword(user: UserLike | null | undefined): boolean {
    if (!user) return false;

    // Signed up with email + password
    if ((user.identities || []).some((identity) => identity.provider === 'email')) return true;

    const meta = user.app_metadata || {};
    const providers = meta.providers as string[] | undefined;
    if (Array.isArray(providers) && providers.includes('email')) return true;

    // Google (or other OAuth) account that later set a password
    return meta[HAS_PASSWORD_FLAG] === true;
}
