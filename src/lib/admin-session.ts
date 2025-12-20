import { cookies } from 'next/headers';
import { securityLogger } from './security-logger';

// Admin session configuration
const ADMIN_SESSION_COOKIE = 'admin-session';
const ADMIN_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Simple token generation using crypto
function generateToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// In-memory store for admin sessions (in production, use Redis or database)
const adminSessions = new Map<string, { email: string; expiresAt: number }>();

// Clean expired sessions periodically
function cleanExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (session.expiresAt < now) {
            adminSessions.delete(token);
        }
    }
}

// Run cleanup every 5 minutes
setInterval(cleanExpiredSessions, 5 * 60 * 1000);

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

    console.log('Normalized email:', normalizedEmail);
    console.log('Is email valid:', isEmailValid);
    console.log('Is password valid:', isPasswordValid);
    console.log('========================');

    return isEmailValid && isPasswordValid;
}

/**
 * Create an admin session
 */
export async function createAdminSession(email: string): Promise<string> {
    const token = generateToken();
    const expiresAt = Date.now() + ADMIN_SESSION_DURATION;

    adminSessions.set(token, {
        email: email.toLowerCase(),
        expiresAt,
    });

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
 * Validate admin session from cookie
 */
export async function validateAdminSession(): Promise<{ valid: boolean; email?: string }> {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

    if (!token) {
        return { valid: false };
    }

    const session = adminSessions.get(token);

    if (!session) {
        return { valid: false };
    }

    if (session.expiresAt < Date.now()) {
        adminSessions.delete(token);
        return { valid: false };
    }

    return { valid: true, email: session.email };
}

/**
 * Clear admin session
 */
export async function clearAdminSession(): Promise<void> {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

    if (token) {
        adminSessions.delete(token);
    }

    cookieStore.delete(ADMIN_SESSION_COOKIE);
}

/**
 * Check if admin session cookie exists (for middleware - synchronous check)
 */
export function getAdminSessionCookieName(): string {
    return ADMIN_SESSION_COOKIE;
}
