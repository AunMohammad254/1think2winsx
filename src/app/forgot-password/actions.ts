'use server';

import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { siteUrl } from '@/lib/site-url';
import { CAPTCHA_FAILED_MESSAGE, CAPTCHA_REQUIRED_MESSAGE, isCaptchaError } from '@/lib/captcha';

const forgotPasswordSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
});

export async function resetPassword(formData: FormData) {
    const email = formData.get('email') as string;
    const captchaToken = formData.get('captchaToken');

    // Validate input
    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
        return { error: result.error.issues[0].message };
    }
    if (typeof captchaToken !== 'string' || !captchaToken) {
        return { error: CAPTCHA_REQUIRED_MESSAGE };
    }

    const supabase = await createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl()}/auth/callback?next=/update-password`,
        captchaToken,
    });

    // A failed check says nothing about the account, so it is safe (and necessary) to report
    if (isCaptchaError(error)) {
        return { error: CAPTCHA_FAILED_MESSAGE };
    }

    if (error) {
        console.error('Password reset error:', error);
        // Don't reveal if email exists or not for security
        return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
    }

    return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
}
