import { siteUrl } from './site-url';
import { isCaptchaError } from './captcha';

/** The slice of the Supabase client this helper needs (keeps it easy to test). */
interface RecoveryCapableClient {
    auth: {
        resetPasswordForEmail: (
            email: string,
            options?: { redirectTo?: string; captchaToken?: string }
        ) => Promise<{ error: { message: string; code?: string } | null }>;
    };
}

/**
 * Sends the "set / reset your password" email. Used for:
 *  - someone who signed up with Google (no password yet) and now wants one,
 *  - someone who tries to register with an email that already has an account.
 *
 * The link signs the person in through /auth/callback and lands on /update-password.
 * It only ever goes to the mailbox that owns the address.
 *
 * Supabase requires a Turnstile token for this unless the client uses the service-role key.
 */
export async function sendPasswordSetupEmail(
    supabase: RecoveryCapableClient,
    email: string,
    captchaToken?: string
): Promise<{ ok: boolean; error?: string; captchaFailed?: boolean }> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl()}/auth/callback?next=/update-password`,
        captchaToken,
    });
    if (error) {
        console.error('Password setup email failed:', error);
        return { ok: false, error: error.message, captchaFailed: isCaptchaError(error) };
    }
    return { ok: true };
}
