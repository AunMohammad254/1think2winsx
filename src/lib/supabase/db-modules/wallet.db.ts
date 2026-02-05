/**
 * Wallet Transaction and Daily Payment Database Operations
 */

import { getDb, generateId } from './shared'
import type { Insertable, Updatable } from '../database.types'

// ============================================================================
// WALLET TRANSACTION OPERATIONS
// ============================================================================

export const walletTransactionDb = {
    async findByUserId(userId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })

        if (error) throw error
        return data || []
    },

    async findPending() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('status', 'pending')
            .order('createdAt', { ascending: true })

        if (error) throw error
        return data || []
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async create(transactionData: Insertable<'WalletTransaction'>) {
        const supabase = await getDb()
        const now = new Date().toISOString()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .insert({
                id: generateId(),
                createdAt: now,
                updatedAt: now,
                ...transactionData
            })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async approve(id: string, processedBy: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .update({
                status: 'approved',
                processedAt: new Date().toISOString(),
                processedBy,
                updatedAt: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async reject(id: string, processedBy: string, adminNotes?: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .update({
                status: 'rejected',
                processedAt: new Date().toISOString(),
                processedBy,
                adminNotes,
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
// DAILY PAYMENT OPERATIONS
// ============================================================================

export const dailyPaymentDb = {
    async findActiveByUserId(userId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('DailyPayment')
            .select('*')
            .eq('userId', userId)
            .eq('isActive', true)
            .order('createdAt', { ascending: false })

        if (error) throw error
        return data || []
    },

    async findFirstActive(userId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('DailyPayment')
            .select('*')
            .eq('userId', userId)
            .eq('isActive', true)
            .order('createdAt', { ascending: false })
            .limit(1)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findMany(userId: string, limit = 10) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('DailyPayment')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })
            .limit(limit)

        if (error) throw error
        return data || []
    },

    async create(paymentData: Insertable<'DailyPayment'>) {
        const supabase = await getDb()
        const now = new Date().toISOString()
        const { data, error } = await supabase
            .from('DailyPayment')
            .insert({
                id: generateId(),
                createdAt: now,
                updatedAt: now,
                ...paymentData
            })
            .select()
            .single()

        if (error) throw error
        return data
    },
}
