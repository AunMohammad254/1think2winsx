/**
 * Authentication Helper Functions
 * 
 * Utilities for checking authentication methods and OAuth status
 * This file is client-safe and can be imported in 'use client' components
 */

import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { userHasPassword } from '@/lib/password-status';

/**
 * Represents the authentication methods available for a user
 */
export interface AuthMethods {
    /** Whether the user has email/password authentication enabled */
    hasEmailPassword: boolean;
    /** Whether the user signed up via OAuth (Google, GitHub, etc.) */
    hasOAuth: boolean;
    /** List of OAuth providers the user has connected */
    oAuthProviders: string[];
    /** Whether the user can change their password */
    canChangePassword: boolean;
    /** The primary authentication method */
    primaryAuthMethod: 'email' | 'oauth' | 'unknown';
}

/**
 * Check if a Supabase User object represents an OAuth-only account
 * 
 * OAuth users in Supabase have specific characteristics:
 * - Their identities array contains OAuth provider entries
 * - They may not have an 'email' provider identity
 * - Their app_metadata.provider indicates the sign-up method
 * 
 * @param user - The Supabase User object
 * @returns true if the user is OAuth-only (cannot change password)
 */
export function isOAuthOnlyUser(user: User | null): boolean {
    if (!user) return false;

    // An email identity, "email" in the providers list, or a password set later (e.g. on a
    // Google account) all mean the user has a password and can change it.
    if (userHasPassword(user)) return false;

    // No password: any linked identity, or a primary provider other than email, is OAuth
    if ((user.identities || []).length > 0) return true;
    const primaryProvider = user.app_metadata?.provider;
    return !!primaryProvider && primaryProvider !== 'email';
}

/**
 * Get detailed authentication methods for a user
 * 
 * @param user - The Supabase User object
 * @returns AuthMethods object with detailed authentication info
 */
export function getUserAuthMethods(user: User | null): AuthMethods {
    if (!user) {
        return {
            hasEmailPassword: false,
            hasOAuth: false,
            oAuthProviders: [],
            canChangePassword: false,
            primaryAuthMethod: 'unknown',
        };
    }

    const identities = user.identities || [];
    const oAuthProviders: string[] = [];
    let hasEmailIdentity = false;

    // Analyze all identities
    for (const identity of identities) {
        if (identity.provider === 'email') {
            hasEmailIdentity = true;
        } else if (identity.provider) {
            oAuthProviders.push(identity.provider);
        }
    }

    const hasOAuth = oAuthProviders.length > 0;
    const hasPassword = userHasPassword(user);
    const primaryProvider = user.app_metadata?.provider as string | undefined;

    // Determine primary auth method
    let primaryAuthMethod: 'email' | 'oauth' | 'unknown' = 'unknown';
    if (primaryProvider === 'email') {
        primaryAuthMethod = 'email';
    } else if (primaryProvider && primaryProvider !== 'email') {
        primaryAuthMethod = 'oauth';
    } else if (hasEmailIdentity) {
        primaryAuthMethod = 'email';
    } else if (hasOAuth) {
        primaryAuthMethod = 'oauth';
    }

    return {
        hasEmailPassword: hasPassword,
        hasOAuth,
        oAuthProviders,
        canChangePassword: hasPassword,
        primaryAuthMethod,
    };
}

/**
 * Get the display name for an OAuth provider
 * 
 * @param provider - The OAuth provider identifier
 * @returns Human-readable provider name
 */
export function getProviderDisplayName(provider: string): string {
    const providerNames: Record<string, string> = {
        google: 'Google',
        github: 'GitHub',
        facebook: 'Facebook',
        twitter: 'Twitter',
        discord: 'Discord',
        apple: 'Apple',
        azure: 'Azure',
        bitbucket: 'Bitbucket',
        gitlab: 'GitLab',
        linkedin: 'LinkedIn',
        slack: 'Slack',
        spotify: 'Spotify',
        twitch: 'Twitch',
        notion: 'Notion',
        zoom: 'Zoom',
    };

    return providerNames[provider.toLowerCase()] || provider;
}

/**
 * Check authentication methods using the client-side Supabase client
 * Use this in client components
 * 
 * @returns Promise<AuthMethods>
 */
export async function checkAuthMethodsClient(): Promise<AuthMethods> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return getUserAuthMethods(user);
}

