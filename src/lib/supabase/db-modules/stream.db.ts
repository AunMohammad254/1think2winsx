/**
 * Stream Configuration Database Operations
 */

import { getDb, generateId } from './shared'
import type { Insertable, Updatable } from '../database.types'

export const streamConfigDb = {
    async findDefault() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .select('*')
            .eq('isDefault', true)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findActive() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .select('*')
            .eq('isActive', true)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findAll() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .select('*')
            .order('createdAt', { ascending: false })

        if (error) throw error
        return data || []
    },

    async create(configData: Insertable<'StreamConfiguration'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .insert({ id: generateId(), ...configData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async update(id: string, configData: Updatable<'StreamConfiguration'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .update({ ...configData, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },
}
