'use server';

import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const forgotPasswordSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
});

export async function resetPassword(formData: FormData) {
    const email = formData.get('email') as string;

    // Validate input
    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
        return { error: result.error.errors[0].message };
    }

    const supabase = await createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/update-password`,
    });

    if (error) {
        console.error('Password reset error:', error);
        // Don't reveal if email exists or not for security
        return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
    }

    return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
}
