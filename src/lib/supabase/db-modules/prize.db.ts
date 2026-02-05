/**
 * Prize and Prize Redemption Database Operations
 */

import { getDb, generateId } from './shared'
import type { Insertable, Updatable } from '../database.types'

// ============================================================================
// PRIZE OPERATIONS
// ============================================================================

export const prizeDb = {
    async findMany(options?: { isActive?: boolean, status?: string }) {
        const supabase = await getDb()
        let query = supabase.from('Prize').select('*')

        if (options?.isActive !== undefined) {
            query = query.eq('isActive', options.isActive)
        }
        if (options?.status) {
            query = query.eq('status', options.status)
        }

        query = query.order('pointsRequired', { ascending: true })

        const { data, error } = await query
        if (error) throw error
        return data || []
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Prize')
            .select('*')
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async create(prizeData: Insertable<'Prize'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Prize')
            .insert({ id: generateId(), ...prizeData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async update(id: string, prizeData: Updatable<'Prize'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Prize')
            .update({ ...prizeData, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async delete(id: string) {
        const supabase = await getDb()
        const { error } = await supabase
            .from('Prize')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    async decrementStock(id: string) {
        const supabase = await getDb()

        // Fetch current stock
        const { data: prize, error: fetchError } = await supabase
            .from('Prize')
            .select('stockQuantity')
            .eq('id', id)
            .single()

        if (fetchError) throw fetchError
        if (!prize || prize.stockQuantity <= 0) {
            throw new Error('Prize out of stock')
        }

        // Decrement stock
        const { data, error } = await supabase
            .from('Prize')
            .update({
                stockQuantity: prize.stockQuantity - 1,
                updatedAt: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },
}

// ============================================================================
// PRIZE REDEMPTION OPERATIONS
// ============================================================================

export const prizeRedemptionDb = {
    async findByUserId(userId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })

        if (error) throw error
        return data || []
    },

    async findPending() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .select('*')
            .eq('status', 'pending')
            .order('createdAt', { ascending: true })

        if (error) throw error
        return data || []
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .select(`
                *,
                prize:prizeId (*)
            `)
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findAllAdmin(options?: { status?: string, page?: number, limit?: number }) {
        const supabase = await getDb()
        const page = options?.page || 1
        const limit = options?.limit || 20
        const offset = (page - 1) * limit

        let query = supabase
            .from('PrizeRedemption')
            .select(`
                *,
                prize:prizeId (*),
                user:userId (id, name, email, phone)
            `, { count: 'exact' })

        if (options?.status) {
            query = query.eq('status', options.status)
        }

        query = query
            .order('createdAt', { ascending: false })
            .range(offset, offset + limit - 1)

        const { data, error, count } = await query

        if (error) throw error
        return { data: data || [], count: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) }
    },

    async create(redemptionData: Insertable<'PrizeRedemption'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .insert({ id: generateId(), ...redemptionData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async updateStatus(id: string, status: string, notes?: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .update({
                status,
                adminNotes: notes,
                updatedAt: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },
}
