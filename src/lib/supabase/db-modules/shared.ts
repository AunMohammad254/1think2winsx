/**
 * Shared database utilities
 */

import { createClient } from '../server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'
import { createId } from '@paralleldrive/cuid2'
import { createTimeoutFetch, SUPABASE_ADMIN_FETCH_TIMEOUT_MS } from '../timeout-fetch'

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
 * PostgREST silently truncates every response to its `db-max-rows` setting (1000 on this
 * project), so an un-paginated `select()` over a growing table quietly returns only the first
 * thousand rows — which is how pushes/newsletters ended up reaching at most 1,000 people.
 */
export const POSTGREST_PAGE_SIZE = 1000

/**
 * Read EVERY row of a query by walking it in primary-key order ("keyset" pagination).
 * Unlike offset/`range()` paging this stays fast on big tables and cannot skip or repeat rows
 * when rows are inserted mid-walk.
 *
 * `fetchPage(afterKey, limit)` must return rows ordered by the key ascending, strictly greater
 * than `afterKey` (or from the start when it is null), e.g.
 *   (after, limit) => { let q = db.from('T').select('id').order('id').limit(limit); if (after) q = q.gt('id', after); return q }
 *
 * Termination is on an EMPTY page rather than a short one, so it stays correct even if the
 * server's row cap is lower than `pageSize` (one cheap extra query at the end).
 */
export async function fetchAllByKeyset<T>(
    fetchPage: (afterKey: string | null, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
    keyOf: (row: T) => string,
    pageSize: number = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
    const all: T[] = []
    let after: string | null = null
    for (;;) {
        const { data, error } = await fetchPage(after, pageSize)
        if (error) throw error
        const rows = data ?? []
        if (rows.length === 0) break
        for (const row of rows) all.push(row)
        after = keyOf(rows[rows.length - 1])
    }
    return all
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length)
    let next = 0
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        for (;;) {
            const i = next++
            if (i >= items.length) return
            results[i] = await fn(items[i], i)
        }
    })
    await Promise.all(workers)
    return results
}

type ServerDbClient = Awaited<ReturnType<typeof createClient>>

let cachedAdminDb: ServerDbClient | null = null

/**
 * Get Supabase admin client with service_role key
 * This bypasses ALL RLS policies - use only for admin operations
 * Note: Uses loose typing to avoid TypeScript inference issues with table operations
 */
export function getAdminDb(): ServerDbClient {
    if (cachedAdminDb) {
        return cachedAdminDb
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Missing Supabase configuration for admin client')
    }

    // Create admin client - cast to any to avoid strict type inference issues
    // This is acceptable since admin operations bypass RLS and need flexibility
    cachedAdminDb = createAdminClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        },
        db: {
            schema: 'public'
        },
        // Hard timeout so a saturated PostgREST can't pile requests up in Node memory
        global: {
            fetch: createTimeoutFetch(SUPABASE_ADMIN_FETCH_TIMEOUT_MS)
        }
    }) as unknown as ServerDbClient

    return cachedAdminDb
}
