'use server';

import { userDb } from '@/lib/supabase/db';
import { z } from 'zod';

const phoneSchema = z.object({
    phone: z.string()
        .regex(/^(03\d{9}|\+92\d{10})$/, 'Please enter a valid phone number (e.g., 03123456789 or +923123456789)'),
});

// Mask email for privacy (e.g., "a***n@example.com")
function maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (localPart.length <= 2) {
        return `${localPart[0]}***@${domain}`;
    }
    return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
}

export async function lookupEmailByPhone(formData: FormData) {
    const phone = formData.get('phone') as string;

    // Validate input
    const result = phoneSchema.safeParse({ phone });
    if (!result.success) {
        return { error: result.error.errors[0].message };
    }

    try {
        // Normalize phone number (remove +92 prefix if present, add 0)
        let normalizedPhone = phone;
        if (phone.startsWith('+92')) {
            normalizedPhone = '0' + phone.slice(3);
        }

        // Search for user with this phone number using Supabase
        const user = await userDb.findByPhone(phone, normalizedPhone);

        if (!user) {
            // Don't reveal if phone doesn't exist for security
            return {
                error: 'No account found with this phone number. Please check the number or contact support.'
            };
        }

        return {
            success: true,
            maskedEmail: maskEmail(user.email),
            message: 'We found an account associated with this phone number.'
        };
    } catch (error) {
        console.error('Email lookup error:', error);
        return { error: 'An error occurred. Please try again.' };
    }
}
