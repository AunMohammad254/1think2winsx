'use server';

import { createClient } from '@/lib/supabase/server';
import { sendPasswordSetupEmail } from '@/lib/password-setup';

/**
 * For a signed-in person whose account has no password yet (created with Google): email them a link
 * to set one. The link goes to their own address, so only the mailbox owner can use it.
 */
export async function requestPasswordSetupEmail(): Promise<{ success?: boolean; email?: string; error?: string }> {
    try {
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

        const sent = await sendPasswordSetupEmail(supabase, user.email);
        if (!sent.ok) {
            return { error: "We couldn't send the email right now. Please try again in a minute." };
        }
        return { success: true, email: user.email };
    } catch (error) {
        console.error('requestPasswordSetupEmail error:', error);
        return { error: 'An error occurred. Please try again.' };
    }
}
