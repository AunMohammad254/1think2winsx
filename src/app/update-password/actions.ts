'use server';

import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const updatePasswordSchema = z.object({
    password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])/, 'Password must contain uppercase, lowercase, number, and special character'),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
});

/**
 * Check if a user is OAuth-only (cannot change password)
 */
function isOAuthOnlyUser(user: { identities?: Array<{ provider: string }> | null }): boolean {
    const identities = user.identities || [];

    // User is OAuth-only if they have identities but none are 'email' provider
    if (identities.length === 0) return false;

    return !identities.some(identity => identity.provider === 'email');
}

export async function updatePassword(formData: FormData) {
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    // Validate input
    const result = updatePasswordSchema.safeParse({ password, confirmPassword });
    if (!result.success) {
        return { error: result.error.errors[0].message };
    }

    const supabase = await createClient();

    // Get current user to check authentication method
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        return { error: 'Session expired. Please try the password reset link again.' };
    }

    // Check if user is OAuth-only
    if (isOAuthOnlyUser(user)) {
        const providers = user.identities
            ?.filter(i => i.provider !== 'email')
            .map(i => i.provider)
            .join(', ') || 'social login';
        return {
            error: `Cannot set password for accounts created with ${providers}. Please manage your password through your OAuth provider.`
        };
    }

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

    return { success: true, message: 'Password updated successfully!' };
}

