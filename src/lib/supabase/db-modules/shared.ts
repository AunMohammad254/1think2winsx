/**
 * Shared database utilities
 */

import { createClient } from '../server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'
import { createId } from '@paralleldrive/cuid2'

// Generate CUID for new records (matching Prisma's default)
export const generateId = () => createId()

/**
 * Get Supabase client for database operations
 * This is the main entry point for all database queries
 */
export async function getDb() {
    return await createClient()
}

/**
 * Get Supabase admin client with service_role key
 * This bypasses ALL RLS policies - use only for admin operations
 * Returns the same type as the regular client for type compatibility
 */
export function getAdminDb() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Missing Supabase configuration for admin client')
    }

    // Create admin client with Database type for proper typing
    return createAdminClient<Database>(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        },
        db: {
            schema: 'public'
        }
    })
}
