import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import logger from '@/lib/logger';
import { detectForUser } from '@/lib/auth-detection-server';

/**
 * GET /api/profile/can-change-password
 * 
 * Returns whether the current user can change their password.
 * OAuth-only users (those without email/password identity) cannot change passwords.
 * 
 * Uses Supabase Auth identities as the source of truth, not public.User.password
 */
export async function GET() {
    try {
        const supabase = await createClient();

        // Get current user from Supabase Auth
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { message: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Check the user's identities - this is the source of truth for auth method
        // Email/password users have an 'email' provider identity
        // OAuth users have 'google', 'facebook', etc. provider identities
        const identities = user.identities || [];

        const hasEmailIdentity = identities.some(identity => identity.provider === 'email');
        const oAuthProviders = identities
            .filter(identity => identity.provider !== 'email')
            .map(identity => identity.provider);

        // hasPassword = a fact about the ACCOUNT (it can sign in with a password; see lib/password-status).
        // The "Change password" form asks for the current password, so it is only offered to a session that
        // signed in WITH a password. Anyone signed in another way (Google, or an emailed link) gets the
        // "Set up password" flow instead: an emailed link, which works whether or not a password exists yet.
        const { hasPassword, currentMethod } = await detectForUser(supabase, user);
        const canChangePassword = hasPassword && currentMethod === 'password';

        // Determine the primary auth provider
        let authProvider = 'unknown';
        if (hasPassword) {
            authProvider = 'email';
        } else if (oAuthProviders.length > 0) {
            authProvider = oAuthProviders[0]; // Use first OAuth provider
        }

        logger.log('[can-change-password] Identity check:', {
            userId: user.id,
            email: user.email,
            hasEmailIdentity,
            oAuthProviders,
            canChangePassword,
            identityCount: identities.length
        });

        return NextResponse.json({
            canChangePassword: canChangePassword,
            hasPassword,
            currentMethod,
            authProvider: authProvider,
            authMethod: hasPassword ? 'email' : 'oauth',
            // Include OAuth providers for display purposes
            oAuthProviders: oAuthProviders
        }, { status: 200 });

    } catch (error) {
        console.error('Error checking password status:', error);
        return NextResponse.json(
            { message: 'Internal server error' },
            { status: 500 }
        );
    }
}
