'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { siteUrl } from '@/lib/site-url';
import { sendPasswordSetupEmail } from '@/lib/password-setup';

// Types for form data
export interface LoginFormData {
    email: string;
    password: string;
}

export interface RegisterFormData {
    name: string;
    email: string;
    password: string;
    phone?: string;
    dateOfBirth?: string;
}

export interface AuthResult {
    success: boolean;
    error?: string;
    redirectTo?: string;
}

// Helper to create Supabase client for server actions
async function createSupabaseClient() {
    const cookieStore = await cookies();

    return createServerClient(
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
}

/**
 * Server Action: Login with email and password
 */
import { z } from 'zod';

// ... (keep existing imports)

// Validation Schemas
const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
});

// ... (keep existing interfaces)

/**
 * Server Action: Login with email and password
 */
export async function loginAction(formData: LoginFormData): Promise<AuthResult> {
    try {
        const validation = LoginSchema.safeParse(formData);
        if (!validation.success) {
            return { success: false, error: 'Invalid input format' };
        }

        const supabase = await createSupabaseClient();

        const { error } = await supabase.auth.signInWithPassword({
            email: formData.email,
            password: formData.password,
        });

        if (error) {
            if (error.message.includes('Invalid login credentials')) {
                return { success: false, error: 'Invalid email or password' };
            } else if (error.message.includes('Email not confirmed')) {
                return { success: false, error: 'Please verify your email before logging in' };
            }
            return { success: false, error: error.message };
        }

        return { success: true, redirectTo: '/quizzes' };
    } catch (error) {
        console.error('[loginAction] Error:', error);
        return { success: false, error: 'An unexpected error occurred during login' };
    }
}

/**
 * Server Action: Register a new user
 */
export async function registerAction(formData: RegisterFormData): Promise<AuthResult> {
    try {
        const supabase = await createSupabaseClient();

        // Get the origin for email redirect
        const origin = siteUrl();

        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: formData.email,
            password: formData.password,
            options: {
                data: {
                    name: formData.name,
                    phone: formData.phone || null,
                    date_of_birth: formData.dateOfBirth || null,
                },
                emailRedirectTo: `${origin}/auth/callback?next=/quizzes`,
            },
        });

        if (signUpError) {
            if (signUpError.message.includes('already registered')) {
                return { success: false, error: 'This email is already registered. Please sign in instead.' };
            } else if (signUpError.message.includes('email') || signUpError.status === 500) {
                console.error('[registerAction] Email error:', signUpError);
                return { success: false, error: 'Unable to send confirmation email. Please try again or contact support.' };
            }
            return { success: false, error: signUpError.message };
        }

        // With email confirmation on, Supabase answers a sign-up for an address that already has an
        // account (e.g. one created with Google) with an obfuscated user (no identities) and sends NO
        // email, so the person would wait for a message that never comes. Instead email them a link to
        // set a password. The answer is the same as for a brand-new sign-up ("check your email"), so
        // this does not reveal whether an address is registered. Sends are limited per address.
        if (signUpData.user && (signUpData.user.identities?.length ?? 0) === 0) {
            try {
                const { headers } = await import('next/headers');
                const { rateLimiters } = await import('@/lib/rate-limiter');
                const limit = await rateLimiters.auth.checkLimit(
                    { headers: await headers() } as never,
                    `register-existing:${formData.email.trim().toLowerCase()}`,
                    '/register'
                );
                if (limit.success) {
                    await sendPasswordSetupEmail(supabase, formData.email);
                }
            } catch (err) {
                console.error('[registerAction] Could not send the password setup email:', err);
            }
            return { success: true, redirectTo: '/auth?registered=true' };
        }

        // Also create user in public.User table with hashed password
        // This ensures the password is stored for password change detection
        if (signUpData.user) {
            try {
                // The on_auth_user_created trigger has already inserted public.User with the auth id,
                // so fill in the remaining profile fields on that row instead of inserting a second one.
                // An existing email returns an obfuscated user with no identities: never touch that row.
                if (signUpData.user.identities && signUpData.user.identities.length > 0) {
                    const { userDb } = await import('@/lib/supabase/db');
                    const bcrypt = await import('bcryptjs');
                    const hashedPassword = await bcrypt.hash(formData.password, 12);

                    await userDb.update(signUpData.user.id, {
                        name: formData.name,
                        password: hashedPassword,
                        authProvider: 'email',
                        ...(formData.phone ? { phone: formData.phone } : {}),
                        ...(formData.dateOfBirth ? { dateOfBirth: new Date(formData.dateOfBirth).toISOString() } : {}),
                    });
                }
            } catch (err) {
                console.error('[registerAction] Error creating public.User:', err);
                // Continue anyway - the Supabase auth user was created successfully
            }
        }

        return {
            success: true,
            redirectTo: '/auth?registered=true'
        };
    } catch (error) {
        console.error('[registerAction] Error:', error);
        return { success: false, error: 'An unexpected error occurred during registration' };
    }
}

/**
 * Server Action: Sign out the current user
 */
export async function signOutAction(): Promise<void> {
    const supabase = await createSupabaseClient();
    await supabase.auth.signOut();
    redirect('/auth');
}

/**
 * Server Action: Initiate Google OAuth sign in
 * Note: This returns the URL to redirect to, actual redirect happens on client
 */
export async function getGoogleOAuthUrl(redirectTo: string = '/quizzes'): Promise<string | null> {
    try {
        const supabase = await createSupabaseClient();
        const origin = siteUrl();

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${origin}/auth/callback?next=${redirectTo}`,
                skipBrowserRedirect: true,
            },
        });

        if (error) {
            console.error('[getGoogleOAuthUrl] Error:', error);
            return null;
        }

        return data.url;
    } catch (error) {
        console.error('[getGoogleOAuthUrl] Error:', error);
        return null;
    }
}
