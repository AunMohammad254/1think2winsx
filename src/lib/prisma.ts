/**
 * PRISMA COMPATIBILITY SHIM
 * 
 * This file redirects Prisma imports to Supabase.
 * Remaining files still using direct Prisma imports should be migrated over time.
 * 
 * @deprecated Use imports from '@/lib/supabase/db' instead
 */

// Re-export Supabase database client as default
export { getDb as default } from '@/lib/supabase/db';

// Re-export all db operations for compatibility
export * from '@/lib/supabase/db';

// Log deprecation warning in development
if (process.env.NODE_ENV === 'development') {
    console.warn(
        '[DEPRECATED] Importing from @/lib/prisma is deprecated. ' +
        'Please update imports to use @/lib/supabase/db directly.'
    );
}
