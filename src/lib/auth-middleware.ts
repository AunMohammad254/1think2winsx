import { NextResponse } from 'next/server';
import { auth } from './auth';
import { securityLogger } from './security-logger';
import type { Session } from 'next-auth';

// Admin status cache to avoid repeated environment variable parsing
const adminCache = new Map<string, { isAdmin: boolean; timestamp: number }>();
const ADMIN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Session cache to reduce auth() calls
const sessionCache = new Map<string, { session: Session | null; timestamp: number }>();
const SESSION_CACHE_TTL = 30 * 1000; // 30 seconds cache

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

  // Log authentication attempt for debugging
  console.log(`Auth attempt for ${context}:`, {
    adminOnly,
    nodeEnv: process.env.NODE_ENV,
    hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
    hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET
  });

  // Retry authentication in case of temporary session issues
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check session cache first
      const sessionCacheKey = `session_${Date.now().toString().slice(0, -4)}`; // Cache key changes every 10 seconds
      const cachedSession = sessionCache.get(sessionCacheKey);
      
      let session;
      if (cachedSession && (Date.now() - cachedSession.timestamp) < SESSION_CACHE_TTL) {
        session = cachedSession.session;
      } else {
        session = await auth();
        // Cache the session
        sessionCache.set(sessionCacheKey, { session, timestamp: Date.now() });
        // Clean old cache entries
        const sessionEntries = Array.from(sessionCache.entries());
        for (const [key, value] of sessionEntries) {
          if (Date.now() - value.timestamp > SESSION_CACHE_TTL) {
            sessionCache.delete(key);
          }
        }
      }
      
      if (!session || !session.user) {
        const error = new Error('No valid session found');
        console.error(`Authentication failed (attempt ${attempt}/${maxRetries}):`, {
          hasSession: !!session,
          hasUser: session?.user ? true : false,
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
                hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
                hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
                nodeEnv: process.env.NODE_ENV
              } : undefined
            },
            { status: 401 }
          );
        }
        
        lastError = error;
        continue;
      }

      // Check session expiration
      const sessionExpiry = new Date(session.expires);
      const now = new Date();
      const timeUntilExpiry = sessionExpiry.getTime() - now.getTime();
      
      // If session expires in less than 5 minutes, log a warning
      if (timeUntilExpiry < 5 * 60 * 1000 && timeUntilExpiry > 0) {
        securityLogger.logAuthFailure(
          session.user.id,
          context,
          `Session expiring soon: ${Math.round(timeUntilExpiry / 1000)}s remaining`
        );
      }
      
      // If session has expired, reject
      if (timeUntilExpiry <= 0) {
        securityLogger.logAuthFailure(
          session.user.id,
          context,
          'Session has expired'
        );
        
        return NextResponse.json(
          { 
            success: false,
            error: 'Unauthorized',
            message: 'Session has expired. Please log in again.',
            code: 'SESSION_EXPIRED'
          },
          { status: 401 }
        );
      }

      // Check admin access if required
      if (adminOnly) {
        const userEmail = session.user.email || '';
        
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
            session.user.id,
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
      return { session, user: session.user };
      
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
  const session = await auth();
  
  if (!session || !session.user) {
    return false;
  }

  const userEmail = session.user.email || '';
  
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
 * Get current authenticated user session
 */
export async function getCurrentUser() {
  const session = await auth();
  return session?.user || null;
}