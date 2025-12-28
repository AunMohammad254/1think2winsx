/**
 * Authentication Helper Functions
 * 
 * Utilities for checking authentication methods and OAuth status
 * This file is client-safe and can be imported in 'use client' components
 */

import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

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

    // Check identities array for authentication methods
    const identities = user.identities || [];

    // Find if there's an 'email' provider identity (email/password signup)
    const hasEmailIdentity = identities.some(
        (identity) => identity.provider === 'email'
    );

    // If no email identity exists, user is OAuth-only
    if (!hasEmailIdentity && identities.length > 0) {
        return true;
    }

    // Check app_metadata for primary provider
    const primaryProvider = user.app_metadata?.provider;
    const providers = user.app_metadata?.providers as string[] | undefined;

    // If primary provider is not 'email' and no email in providers list
    if (primaryProvider && primaryProvider !== 'email') {
        if (!providers?.includes('email')) {
            return true;
        }
    }

    return false;
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
        hasEmailPassword: hasEmailIdentity,
        hasOAuth,
        oAuthProviders,
        canChangePassword: hasEmailIdentity,
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

