import { siteUrl } from './site-url';

/** The slice of the Supabase client this helper needs (keeps it easy to test). */
interface RecoveryCapableClient {
    auth: {
        resetPasswordForEmail: (
            email: string,
            options?: { redirectTo?: string }
        ) => Promise<{ error: { message: string } | null }>;
    };
}

/**
 * Sends the "set / reset your password" email. Used for:
 *  - someone who signed up with Google (no password yet) and now wants one,
 *  - someone who tries to register with an email that already has an account.
 *
 * The link signs the person in through /auth/callback and lands on /update-password.
 * It only ever goes to the mailbox that owns the address.
 */
export async function sendPasswordSetupEmail(
    supabase: RecoveryCapableClient,
    email: string
): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl()}/auth/callback?next=/update-password`,
    });
    if (error) {
        console.error('Password setup email failed:', error);
        return { ok: false, error: error.message };
    }
    return { ok: true };
}
