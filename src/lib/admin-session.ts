import { cookies } from 'next/headers';
import { securityLogger } from './security-logger';
import prisma from './prisma';

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
        await prisma.adminSession.deleteMany({
            where: {
                expiresAt: {
                    lt: new Date(),
                },
            },
        });
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
    await prisma.adminSession.create({
        data: {
            token,
            email: email.toLowerCase(),
            expiresAt,
        },
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
            console.log('[Admin Session] No admin session cookie found');
            return { valid: false };
        }

        console.log('[Admin Session] Cookie found, validating token...');

        // Look up session in database
        const session = await prisma.adminSession.findUnique({
            where: { token },
        });

        if (!session) {
            console.log('[Admin Session] Token not found in database');
            return { valid: false };
        }

        if (session.expiresAt < new Date()) {
            // Session expired, delete it
            console.log('[Admin Session] Session expired, deleting...');
            await prisma.adminSession.delete({
                where: { token },
            });
            return { valid: false };
        }

        console.log('[Admin Session] Valid session for:', session.email);
        return { valid: true, email: session.email };
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
            await prisma.adminSession.delete({
                where: { token },
            }).catch(() => {
                // Ignore if session doesn't exist in DB
            });
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
