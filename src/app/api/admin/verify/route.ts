import { NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';

/**
 * GET /api/admin/verify - Verify admin access for protected routes
 * Used by the admin layout to check if user has valid admin session
 */
export async function GET() {
    try {
        const session = await validateAdminSession();

        if (session.valid) {
            return NextResponse.json({
                isAdmin: true,
                email: session.email,
            });
        }

        return NextResponse.json(
            { isAdmin: false, error: 'Not authenticated as admin' },
            { status: 401 }
        );
    } catch (error) {
        console.error('Admin verify error:', error);
        return NextResponse.json(
            { isAdmin: false, error: 'Verification failed' },
            { status: 500 }
        );
    }
}
