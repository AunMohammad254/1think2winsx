/**
 * User Database Operations
 */

import { getDb, generateId } from './shared'
import type { Insertable, Updatable } from '../database.types'

export const userDb = {
    async findByEmail(email: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .select('*')
            .eq('email', email)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .select('*')
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async create(userData: Insertable<'User'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .insert({ id: generateId(), ...userData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async update(id: string, userData: Updatable<'User'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .update({ ...userData, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async updateByEmail(email: string, userData: Updatable<'User'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .update({ ...userData, updatedAt: new Date().toISOString() })
            .eq('email', email)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async delete(id: string) {
        const supabase = await getDb()
        const { error } = await supabase
            .from('User')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    async count() {
        const supabase = await getDb()
        const { count, error } = await supabase
            .from('User')
            .select('*', { count: 'exact', head: true })

        if (error) throw error
        return count || 0
    },

    async getLeaderboard(limit = 10) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .select('id, name, email, points, profilePicture')
            .order('points', { ascending: false })
            .limit(limit)

        if (error) throw error
        return data || []
    },

    async addPoints(id: string, points: number) {
        const supabase = await getDb()
        const { data: user, error: fetchError } = await supabase
            .from('User')
            .select('points')
            .eq('id', id)
            .single()

        if (fetchError) throw fetchError

        const { data, error } = await supabase
            .from('User')
            .update({
                points: (user?.points || 0) + points,
                updatedAt: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async updateWalletBalance(id: string, amount: number) {
        const supabase = await getDb()
        const { data: user, error: fetchError } = await supabase
            .from('User')
            .select('walletBalance')
            .eq('id', id)
            .single()

        if (fetchError) throw fetchError

        const { data, error } = await supabase
            .from('User')
            .update({
                walletBalance: (user?.walletBalance || 0) + amount,
                updatedAt: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async findByPhone(phone: string, normalizedPhone?: string) {
        const supabase = await getDb()

        // Build OR query for phone variations
        const phoneVariants = [phone]
        if (normalizedPhone && normalizedPhone !== phone) {
            phoneVariants.push(normalizedPhone)
        }
        if (phone.startsWith('0')) {
            phoneVariants.push('+92' + phone.slice(1))
        }
        if (phone.startsWith('+92')) {
            phoneVariants.push('0' + phone.slice(3))
        }

        const { data, error } = await supabase
            .from('User')
            .select('id, email, name')
            .in('phone', phoneVariants)
            .limit(1)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },
}
