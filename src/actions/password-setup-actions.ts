'use server';

import { createClient } from '@/lib/supabase/server';
import { sendPasswordSetupEmail } from '@/lib/password-setup';
import { CAPTCHA_FAILED_MESSAGE, CAPTCHA_REQUIRED_MESSAGE } from '@/lib/captcha';

/**
 * For a signed-in person whose account has no password yet (created with Google): email them a link
 * to set one. The link goes to their own address, so only the mailbox owner can use it.
 * `captchaToken` is the Turnstile token Supabase requires for the reset email.
 */
export async function requestPasswordSetupEmail(captchaToken: string): Promise<{ success?: boolean; email?: string; error?: string }> {
    try {
        if (!captchaToken) {
            return { error: CAPTCHA_REQUIRED_MESSAGE };
        }

        const supabase = await createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user?.email) {
            return { error: 'Your session has expired. Please sign in again.' };
        }

        const { headers } = await import('next/headers');
        const { rateLimiters } = await import('@/lib/rate-limiter');
        const limit = await rateLimiters.passwordChange.checkLimit(
            { headers: await headers() } as never,
            user.id,
            '/profile/password-setup'
        );
        if (!limit.success) {
            return { error: 'Too many requests. Please wait a few minutes and try again.' };
        }

        const sent = await sendPasswordSetupEmail(supabase, user.email, captchaToken);
        if (!sent.ok) {
            if (sent.limited) return { error: sent.error };
            return { error: sent.captchaFailed ? CAPTCHA_FAILED_MESSAGE : "We couldn't send the email right now. Please try again in a minute." };
        }
        return { success: true, email: user.email };
    } catch (error) {
        console.error('requestPasswordSetupEmail error:', error);
        return { error: 'An error occurred. Please try again.' };
    }
}
