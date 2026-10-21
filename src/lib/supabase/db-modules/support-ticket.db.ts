/**
 * Support Ticket Database Operations
 *
 * "SupportTicket" is service-role only (RLS on, no policies), so everything here uses the admin
 * client. Player-facing reads take the player's id from the signed-in session and filter on it:
 * a ticket number alone never reveals someone else's ticket.
 */

import { getAdminDb } from './shared'
import { TICKET_STATUSES, type SupportTicket, type TicketStatus } from '@/lib/support-tickets'

export type CreateTicketResult =
    | { success: true; ticket: SupportTicket }
    | { success: false; code: 'invalid' | 'no_user' | 'rate_limited' | 'too_many_open'; error: string }

/** A ticket with the player's name and email, for the admin page */
export interface AdminTicket extends SupportTicket {
    user: { name: string | null; email: string } | null
}

const ADMIN_SELECT = '*, user:User(name, email)'

export const supportTicketDb = {
    // create_support_ticket() applies the rate limit and picks a free ticket number in one locked call
    async create(userId: string, subject: string, message: string): Promise<CreateTicketResult> {
        const { data, error } = await getAdminDb().rpc('create_support_ticket', {
            p_user_id: userId,
            p_subject: subject,
            p_message: message,
        })
        if (error) throw error
        return data as CreateTicketResult
    },

    async findForUser(userId: string, ticketNumbers: string[]): Promise<SupportTicket[]> {
        const { data, error } = await getAdminDb()
            .from('SupportTicket')
            .select('*')
            .eq('userId', userId)
            .in('ticketNumber', ticketNumbers)
        if (error) throw error
        return (data || []) as SupportTicket[]
    },

    async listForUser(userId: string, limit = 5): Promise<SupportTicket[]> {
        const { data, error } = await getAdminDb()
            .from('SupportTicket')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })
            .limit(limit)
        if (error) throw error
        return (data || []) as SupportTicket[]
    },

    /** One page of tickets, newest first, optionally only one status or one ticket number */
    async list(options: { status?: TicketStatus; ticketNumber?: string; page: number; limit: number }): Promise<{ tickets: AdminTicket[]; total: number }> {
        let query = getAdminDb().from('SupportTicket').select(ADMIN_SELECT, { count: 'exact' })
        if (options.status) query = query.eq('status', options.status)
        if (options.ticketNumber) query = query.eq('ticketNumber', options.ticketNumber)
        const from = (options.page - 1) * options.limit
        const { data, error, count } = await query
            .order('createdAt', { ascending: false })
            .range(from, from + options.limit - 1)
        if (error) throw error
        return { tickets: (data || []) as AdminTicket[], total: count || 0 }
    },

    async countByStatus(): Promise<Record<TicketStatus, number>> {
        const adminDb = getAdminDb()
        const counts = await Promise.all(
            TICKET_STATUSES.map(async (status) => {
                const { count, error } = await adminDb
                    .from('SupportTicket')
                    .select('id', { count: 'exact', head: true })
                    .eq('status', status)
                if (error) throw error
                return [status, count || 0] as const
            })
        )
        return Object.fromEntries(counts) as Record<TicketStatus, number>
    },

    async findById(id: string): Promise<AdminTicket | null> {
        const { data, error } = await getAdminDb()
            .from('SupportTicket')
            .select(ADMIN_SELECT)
            .eq('id', id)
            .maybeSingle()
        if (error) throw error
        return data as AdminTicket | null
    },

    async update(
        id: string,
        changes: { status: TicketStatus; adminReply: string | null; repliedAt?: string | null; repliedBy?: string | null }
    ): Promise<AdminTicket> {
        const { data, error } = await getAdminDb()
            .from('SupportTicket')
            .update({ ...changes, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select(ADMIN_SELECT)
            .single()
        if (error) throw error
        return data as AdminTicket
    },
}
