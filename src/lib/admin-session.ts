import { cookies } from 'next/headers';
import { securityLogger } from './security-logger';
import { adminSessionDb } from './supabase/db';

// Admin session configuration
const ADMIN_SESSION_COOKIE = 'admin-session';
const ADMIN_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Simple token generation using crypto
function generateToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Clean expired sessions from database (run periodically)
 */
async function cleanExpiredSessions() {
    try {
        await adminSessionDb.deleteExpired();
    } catch (error) {
        console.error('Error cleaning expired admin sessions:', error);
    }
}

/**
 * Verify admin credentials against environment variables
 */
export function verifyAdminCredentials(email: string, password: string): boolean {
    const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
        console.error('ADMIN_PASSWORD is not set in environment variables');
        return false;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const isEmailValid = adminEmails.includes(normalizedEmail);
    const isPasswordValid = password === adminPassword;

    return isEmailValid && isPasswordValid;
}

/**
 * Create an admin session (stored in database for persistence)
 */
export async function createAdminSession(email: string): Promise<string> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_DURATION);

    // Store session in database
    await adminSessionDb.create({
        token,
        email: email.toLowerCase(),
        expiresAt: expiresAt.toISOString(),
    });

    // Clean up old expired sessions
    cleanExpiredSessions();

    // Set the session cookie
    const cookieStore = await cookies();
    cookieStore.set(ADMIN_SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: ADMIN_SESSION_DURATION / 1000, // Convert to seconds
        path: '/',
    });

    securityLogger.logSecurityEvent({
        type: 'QUIZ_ACCESS',
        userId: undefined,
        endpoint: '/admin/login',
        details: { action: 'admin_session_created', email },
    });

    return token;
}

/**
 * Validate admin session from cookie (reads from database)
 */
export async function validateAdminSession(): Promise<{ valid: boolean; email?: string }> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

        if (!token) {
            return { valid: false };
        }


        // Look up session in database (findByToken already filters expired)
        const session = await adminSessionDb.findByToken(token);

        if (!session) {
            return { valid: false };
        }

        const sessionEmail = (session as { email: string }).email;
        return { valid: true, email: sessionEmail };
    } catch (error) {
        console.error('Error validating admin session:', error);
        return { valid: false };
    }
}

/**
 * Clear admin session
 */
export async function clearAdminSession(): Promise<void> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

        if (token) {
            // Delete from database
            try {
                await adminSessionDb.delete(token);
            } catch {
                // Ignore if session doesn't exist in DB
            }
        }

        cookieStore.delete(ADMIN_SESSION_COOKIE);
    } catch (error) {
        console.error('Error clearing admin session:', error);
    }
}

/**
 * Check if admin session cookie exists (for middleware - synchronous check)
 */
export function getAdminSessionCookieName(): string {
    return ADMIN_SESSION_COOKIE;
}

/**
 * Require valid admin session for server-side page protection.
 * Validates the admin session token against the database.
 * If not valid, throws a redirect to the admin login page.
 * 
 * Usage in admin pages:
 * ```ts
 * import { requireAdminSession } from '@/lib/admin-session';
 * 
 * export default async function AdminPage() {
 *   const adminEmail = await requireAdminSession();
 *   // Page content here...
 * }
 * ```
 */
export async function requireAdminSession(): Promise<string> {
    const session = await validateAdminSession();

    if (!session.valid || !session.email) {
        // Dynamic import to avoid circular dependencies
        const { redirect } = await import('next/navigation');
        redirect('/admin/login');
        // redirect() throws, but TypeScript doesn't know that
        // This line is unreachable but helps TypeScript understand the flow
        throw new Error('Redirect to admin login');
    }

    return session.email;
}
