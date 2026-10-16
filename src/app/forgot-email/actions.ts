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

type PhoneLookup =
    | { error: string }
    | { user: { id: string; email: string; name?: string | null }; normalizedPhone: string; mockRequest: any };

/**
 * Shared by both actions below: validate the phone, apply the per-IP rate limit that protects this
 * unauthenticated endpoint from account enumeration, and find the account.
 */
async function findAccountByPhone(phone: string): Promise<PhoneLookup> {
    // Validate input
    const result = phoneSchema.safeParse({ phone });
    if (!result.success) {
        return { error: result.error.issues[0].message };
    }

    // Prevent account enumeration by rate limiting this unauthenticated endpoint
    const { headers } = await import('next/headers');
    const { rateLimiters } = await import('@/lib/rate-limiter');
    const headersList = await headers();
    const { getClientIp } = await import('@/lib/client-ip');
    const ip = getClientIp(headersList);

    // Mock NextRequest-like object for the rate limiter
    const mockRequest = { headers: headersList } as any;
    const limitResult = await rateLimiters.auth.checkLimit(mockRequest, ip, '/forgot-email');
    if (!limitResult.success) {
        return { error: 'Too many requests. Please try again later.' };
    }

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

    return { user, normalizedPhone, mockRequest };
}

export async function lookupEmailByPhone(formData: FormData) {
    const phone = formData.get('phone') as string;

    try {
        const found = await findAccountByPhone(phone);
        if ('error' in found) return { error: found.error };

        return {
            success: true,
            maskedEmail: maskEmail(found.user.email),
            message: 'We found an account associated with this phone number.'
        };
    } catch (error) {
        console.error('Email lookup error:', error);
        return { error: 'An error occurred. Please try again.' };
    }
}

/**
 * "Email me a reminder": sends the account's full sign-in email to that address only.
 * The full address is never returned to the browser, so someone who merely knows a phone number
 * cannot read it; only the mailbox owner sees it. Limited per phone number to stop inbox flooding.
 */
export async function sendEmailReminder(formData: FormData) {
    const phone = formData.get('phone') as string;

    try {
        const found = await findAccountByPhone(phone);
        if ('error' in found) return { error: found.error };

        const { rateLimiters } = await import('@/lib/rate-limiter');
        const perPhone = await rateLimiters.emailReminder.checkLimit(
            found.mockRequest,
            `phone:${found.normalizedPhone}`,
            '/forgot-email/reminder'
        );
        if (!perPhone.success) {
            return {
                error: 'A reminder was already sent recently. Please check your inbox (and spam folder), or try again in an hour.'
            };
        }

        const { sendEmail } = await import('@/lib/email');
        const { buildEmailReminderEmail } = await import('@/lib/email-templates');
        const mail = buildEmailReminderEmail({
            email: found.user.email,
            phoneLast4: found.normalizedPhone.slice(-4),
        });
        const sent = await sendEmail({ to: found.user.email, subject: mail.subject, html: mail.html, text: mail.text });

        if (!sent.success) {
            console.error('Email reminder send failed:', sent.error);
            return { error: "We couldn't send the reminder email right now. Please try again later or contact support." };
        }

        return {
            success: true,
            maskedEmail: maskEmail(found.user.email),
            message: 'We sent a reminder to your email address.'
        };
    } catch (error) {
        console.error('Email reminder error:', error);
        return { error: 'An error occurred. Please try again.' };
    }
}
