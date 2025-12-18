import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCredentials, createAdminSession, clearAdminSession, validateAdminSession } from '@/lib/admin-session';
import { securityLogger } from '@/lib/security-logger';

/**
 * POST /api/admin/auth - Admin login
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { email, password } = body;

        if (!email || !password) {
            return NextResponse.json(
                { success: false, error: 'Email and password are required' },
                { status: 400 }
            );
        }

        // Verify admin credentials
        const isValid = verifyAdminCredentials(email, password);

        if (!isValid) {
            securityLogger.logAuthFailure(
                undefined,
                '/api/admin/auth',
                `Failed admin login attempt for email: ${email}`
            );

            return NextResponse.json(
                { success: false, error: 'Invalid email or password' },
                { status: 401 }
            );
        }

        // Create admin session
        await createAdminSession(email);

        return NextResponse.json({
            success: true,
            message: 'Admin login successful',
        });
    } catch (error) {
        console.error('Admin auth error:', error);
        return NextResponse.json(
            { success: false, error: 'Authentication failed' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/admin/auth - Admin logout
 */
export async function DELETE() {
    try {
        await clearAdminSession();

        return NextResponse.json({
            success: true,
            message: 'Admin logged out successfully',
        });
    } catch (error) {
        console.error('Admin logout error:', error);
        return NextResponse.json(
            { success: false, error: 'Logout failed' },
            { status: 500 }
        );
    }
}

/**
 * GET /api/admin/auth - Check admin session status
 */
export async function GET() {
    try {
        const session = await validateAdminSession();

        return NextResponse.json({
            success: true,
            authenticated: session.valid,
            email: session.email || null,
        });
    } catch (error) {
        console.error('Admin session check error:', error);
        return NextResponse.json(
            { success: false, error: 'Session check failed' },
            { status: 500 }
        );
    }
}
