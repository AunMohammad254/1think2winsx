'use server';

import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { markPasswordSet } from '@/lib/password-flag';

const updatePasswordSchema = z.object({
    password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])/, 'Password must contain uppercase, lowercase, number, and special character'),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
});

export async function updatePassword(formData: FormData) {
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    // Validate input
    const result = updatePasswordSchema.safeParse({ password, confirmPassword });
    if (!result.success) {
        return { error: result.error.issues[0].message };
    }

    const supabase = await createClient();

    // Get current user to check authentication method
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        return { error: 'Session expired. Please try the password reset link again.' };
    }

    // Accounts created with Google (no password yet) may set one here too. The person got to this
    // page through the link we emailed to their address, which is what proves they own the account;
    // it adds email + password sign-in alongside Google.
    const { error } = await supabase.auth.updateUser({
        password: password,
    });

    if (error) {
        console.error('Password update error:', error);
        if (error.message.includes('should be different')) {
            return { error: 'New password must be different from your current password' };
        }
        return { error: 'Failed to update password. Please try again.' };
    }

    // Supabase adds no 'email' sign-in method when a Google account sets a password, so record it;
    // the profile then offers "Change password" instead of "Set a password".
    await markPasswordSet(user.id);

    return { success: true, message: 'Password updated successfully!' };
}

