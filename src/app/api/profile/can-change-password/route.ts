import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { userDb } from '@/lib/supabase/db';

/**
 * GET /api/profile/can-change-password
 * 
 * Returns whether the current user can change their password.
 * OAuth-only users (those without a password set) cannot change passwords.
 */
export async function GET() {
    try {
        const session = await auth();

        if (!session || !session.user) {
            return NextResponse.json(
                { message: 'Unauthorized' },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // Get current user data from database
        const currentUser = await userDb.findById(userId);

        if (!currentUser) {
            return NextResponse.json(
                { message: 'User not found' },
                { status: 404 }
            );
        }

        // Check if user has a password set in the database
        const hasPassword = !!currentUser.password && currentUser.password.length > 0;
        const authProvider = currentUser.authProvider || (hasPassword ? 'email' : 'oauth');

        return NextResponse.json({
            canChangePassword: hasPassword,
            hasPassword: hasPassword,
            // Return actual auth provider from database
            authProvider: authProvider,
            authMethod: hasPassword ? 'email' : 'oauth'
        }, { status: 200 });

    } catch (error) {
        console.error('Error checking password status:', error);
        return NextResponse.json(
            { message: 'Internal server error' },
            { status: 500 }
        );
    }
}
