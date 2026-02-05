import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { securityLogger } from './security-logger';
import type { User } from '@supabase/supabase-js';

// Admin status cache to avoid repeated environment variable parsing
const adminCache = new Map<string, { isAdmin: boolean; timestamp: number }>();
const ADMIN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Session cache to reduce auth() calls
const sessionCache = new Map<string, { user: User | null; timestamp: number }>();
const SESSION_CACHE_TTL = 30 * 1000; // 30 seconds cache

/**
 * Get Supabase server client
 */
async function getSupabaseServerClient() {
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
 * Enhanced authentication middleware for API routes with session expiration handling
 * Optimized with caching and reduced retry attempts for better performance
 */
export async function requireAuth(
  options: {
    adminOnly?: boolean;
    maxRetries?: number;
    context?: string;
  } = {}
) {
  const { adminOnly = false, maxRetries = 1, context = 'api_request' } = options;
  let lastError: Error | null = null;

  // Retry authentication in case of temporary session issues
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check session cache first
      const sessionCacheKey = `session_${Date.now().toString().slice(0, -4)}`; // Cache key changes every 10 seconds
      const cachedSession = sessionCache.get(sessionCacheKey);

      let user: User | null = null;

      if (cachedSession && (Date.now() - cachedSession.timestamp) < SESSION_CACHE_TTL) {
        user = cachedSession.user;
      } else {
        const supabase = await getSupabaseServerClient();
        const { data: { user: supabaseUser }, error } = await supabase.auth.getUser();

        if (error) {
          console.error('Supabase auth error:', error);
        }

        user = supabaseUser;

        // Cache the session
        sessionCache.set(sessionCacheKey, { user, timestamp: Date.now() });

        // Clean old cache entries
        const sessionEntries = Array.from(sessionCache.entries());
        for (const [key, value] of sessionEntries) {
          if (Date.now() - value.timestamp > SESSION_CACHE_TTL) {
            sessionCache.delete(key);
          }
        }
      }

      if (!user) {
        const error = new Error('No valid session found');
        console.error(`Authentication failed (attempt ${attempt}/${maxRetries}):`, {
          hasUser: false,
          context
        });

        securityLogger.logAuthFailure(
          undefined,
          context,
          `Authentication failed (attempt ${attempt}/${maxRetries}): No session`
        );

        if (attempt === maxRetries) {
          return NextResponse.json(
            {
              success: false,
              error: 'Unauthorized',
              message: 'Authentication required',
              code: 'SESSION_EXPIRED',
              debug: process.env.NODE_ENV === 'development' ? {
                hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
                hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
                nodeEnv: process.env.NODE_ENV
              } : undefined
            },
            { status: 401 }
          );
        }

        lastError = error;
        continue;
      }

      // Check admin access if required
      if (adminOnly) {
        const userEmail = user.email || '';

        // Check admin cache first
        const cachedAdmin = adminCache.get(userEmail);
        let isAdmin: boolean;

        if (cachedAdmin && (Date.now() - cachedAdmin.timestamp) < ADMIN_CACHE_TTL) {
          isAdmin = cachedAdmin.isAdmin;
        } else {
          const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];
          isAdmin = adminEmails.includes(userEmail);

          // Cache the admin status
          adminCache.set(userEmail, { isAdmin, timestamp: Date.now() });

          // Clean old cache entries
          const adminEntries = Array.from(adminCache.entries());
          for (const [key, value] of adminEntries) {
            if (Date.now() - value.timestamp > ADMIN_CACHE_TTL) {
              adminCache.delete(key);
            }
          }
        }

        if (!isAdmin) {
          securityLogger.logUnauthorizedAccess(
            user.id,
            context
          );

          return NextResponse.json(
            {
              success: false,
              error: 'Forbidden',
              message: 'Admin access required',
              code: 'INSUFFICIENT_PERMISSIONS'
            },
            { status: 403 }
          );
        }
      }

      // Authentication successful
      return {
        session: { user, expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
        user: {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0],
          image: user.user_metadata?.avatar_url
        }
      };

    } catch (error) {
      lastError = error as Error;

      securityLogger.logAuthFailure(
        undefined,
        context,
        `Authentication error (attempt ${attempt}/${maxRetries}): ${error}`
      );

      // If it's the last attempt, return error
      if (attempt === maxRetries) {
        return NextResponse.json(
          {
            success: false,
            error: 'Authentication Error',
            message: 'Unable to verify authentication. Please try again.',
            code: 'AUTH_SERVICE_ERROR'
          },
          { status: 500 }
        );
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }

  // This should never be reached, but just in case
  throw lastError || new Error('Authentication failed after all retries');
}

/**
 * Helper function to check if current user is admin (with caching)
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const userEmail = user.email || '';

  // Check admin cache first
  const cachedAdmin = adminCache.get(userEmail);

  if (cachedAdmin && (Date.now() - cachedAdmin.timestamp) < ADMIN_CACHE_TTL) {
    return cachedAdmin.isAdmin;
  }

  const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];
  const isAdmin = adminEmails.includes(userEmail);

  // Cache the admin status
  adminCache.set(userEmail, { isAdmin, timestamp: Date.now() });

  return isAdmin;
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0],
    image: user.user_metadata?.avatar_url
  };
}