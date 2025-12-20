/**
 * Authentication utility for API routes
 * Uses Supabase Auth for session management
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

interface Session {
    user: {
        id: string;
        email?: string;
        name?: string;
        image?: string;
        isAdmin?: boolean;
    };
    expires: string;
}

/**
 * Get the current authentication session from Supabase
 * Compatible replacement for NextAuth's auth() function
 */
export async function auth(): Promise<Session | null> {
    try {
        const cookieStore = await cookies();

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll();
                    },
                    setAll(cookiesToSet) {
                        try {
                            cookiesToSet.forEach(({ name, value, options }) =>
                                cookieStore.set(name, value, options)
                            );
                        } catch {
                            // The `setAll` method was called from a Server Component.
                            // This can be ignored if you have middleware refreshing sessions.
                        }
                    },
                },
            }
        );

        const { data: { user }, error } = await supabase.auth.getUser();

        if (error || !user) {
            return null;
        }

        // Check if user is admin
        const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];
        const isAdmin = user.email ? adminEmails.includes(user.email) : false;

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0],
                image: user.user_metadata?.avatar_url,
                isAdmin,
            },
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
        };
    } catch (error) {
        console.error('Auth error:', error);
        return null;
    }
}

/**
 * Get the current user from the session
 */
export async function getCurrentUser() {
    const session = await auth();
    return session?.user || null;
}

/**
 * Check if the current user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
    const session = await auth();
    return session !== null;
}

/**
 * Check if the current user is an admin
 */
export async function isAdmin(): Promise<boolean> {
    const session = await auth();
    return session?.user?.isAdmin || false;
}
