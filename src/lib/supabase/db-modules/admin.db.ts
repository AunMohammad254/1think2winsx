/**
 * Admin Session, Rate Limit, and Security Event Database Operations
 */

import { getAdminDb, generateId } from './shared'
import type { Insertable } from '../database.types'

// ============================================================================
// ADMIN SESSION OPERATIONS (Uses service_role client for admin privileges)
// ============================================================================

export const adminSessionDb = {
    async findByToken(token: string) {
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('AdminSession')
            .select('*')
            .eq('token', token)
            .gt('expiresAt', new Date().toISOString())
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async create(sessionData: Insertable<'AdminSession'>) {
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('AdminSession')
            .insert({ id: generateId(), ...sessionData } as any)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async delete(token: string) {
        const supabase = getAdminDb()
        const { error } = await supabase
            .from('AdminSession')
            .delete()
            .eq('token', token)

        if (error) throw error
    },

    async deleteExpired() {
        const supabase = getAdminDb()
        const { error } = await supabase
            .from('AdminSession')
            .delete()
            .lt('expiresAt', new Date().toISOString())

        if (error) throw error
    },
}

// ============================================================================
// RATE LIMIT OPERATIONS
// ============================================================================

export const rateLimitDb = {
    async count(key: string, windowMs: number) {
        const supabase = getAdminDb()
        const windowStart = new Date(Date.now() - windowMs).toISOString()

        const { count, error } = await supabase
            .from('RateLimitEntry')
            .select('*', { count: 'exact', head: true })
            .eq('key', key)
            .gte('createdAt', windowStart)

        if (error) throw error
        return count || 0
    },

    async add(key: string) {
        const supabase = getAdminDb()
        await supabase
            .from('RateLimitEntry')
            .insert({ id: generateId(), key } as any)
    },

    async cleanup(key: string, windowMs: number) {
        const supabase = getAdminDb()
        const windowStart = new Date(Date.now() - windowMs).toISOString()

        await supabase
            .from('RateLimitEntry')
            .delete()
            .eq('key', key)
            .lt('createdAt', windowStart)
    },
}

// ============================================================================
// SECURITY EVENT OPERATIONS
// ============================================================================

export const securityEventDb = {
    async create(eventData: Insertable<'SecurityEvent'>) {
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('SecurityEvent')
            .insert({ id: generateId(), ...eventData } as any)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async findRecent(limit = 100) {
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('SecurityEvent')
            .select('*')
            .order('createdAt', { ascending: false })
            .limit(limit)

        if (error) throw error
        return data || []
    },

    async countByType(type: string, since: Date) {
        const supabase = getAdminDb()
        const { count, error } = await supabase
            .from('SecurityEvent')
            .select('*', { count: 'exact', head: true })
            .eq('type', type)
            .gte('createdAt', since.toISOString())

        if (error) throw error
        return count || 0
    },
}
