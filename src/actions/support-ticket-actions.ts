'use server';

import { z } from 'zod';
import { requireAdminSession } from '@/lib/admin-session';
import { notificationDb, supportTicketDb } from '@/lib/supabase/db';
import type { AdminTicket } from '@/lib/supabase/db-modules/support-ticket.db';
import {
    TICKET_REPLY_MAX,
    TICKET_STATUS_LABELS,
    TICKET_STATUSES,
    findTicketNumbers,
    type TicketStatus,
} from '@/lib/support-tickets';

/**
 * Admin actions for /admin/tickets. Each one checks the admin session first: requireAdminSession()
 * redirects a signed-out caller to /admin/login, and that redirect is left to propagate.
 */

const PAGE_SIZE = 20;
const statusSchema = z.enum(TICKET_STATUSES as [TicketStatus, ...TicketStatus[]]);

const listSchema = z.object({
    status: statusSchema.optional(),
    search: z.string().max(40).optional(),
    page: z.number().int().min(1).max(10_000).default(1),
});

const updateSchema = z.object({
    id: z.uuid(),
    status: statusSchema,
    adminReply: z.string().trim().max(TICKET_REPLY_MAX, `The reply can be at most ${TICKET_REPLY_MAX} characters`),
});

export type ListTicketsResult =
    | { success: true; tickets: AdminTicket[]; total: number; counts: Record<TicketStatus, number>; page: number; pageSize: number }
    | { success: false; error: string };

export async function listSupportTicketsAction(input: { status?: TicketStatus; search?: string; page?: number }): Promise<ListTicketsResult> {
    await requireAdminSession();
    const parsed = listSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Invalid filter' };
    const { status, search, page } = parsed.data;

    // The search box finds one ticket by its number (what a player quotes)
    let ticketNumber: string | undefined;
    if (search?.trim()) {
        ticketNumber = findTicketNumbers(search)[0];
        if (!ticketNumber) return { success: false, error: 'Enter a ticket number like TKT-7KQ2XM' };
    }

    try {
        const [{ tickets, total }, counts] = await Promise.all([
            supportTicketDb.list({ status, ticketNumber, page, limit: PAGE_SIZE }),
            supportTicketDb.countByStatus(),
        ]);
        return { success: true, tickets, total, counts, page, pageSize: PAGE_SIZE };
    } catch (err) {
        console.error('[support-tickets] list failed:', err);
        return { success: false, error: 'Failed to load tickets' };
    }
}

export type UpdateTicketResult =
    | { success: true; ticket: AdminTicket; notified: boolean }
    | { success: false; error: string };

/**
 * Sets a ticket's status and the reply the player sees through the chatbot. When the status
 * changes or a new reply is written, the player also gets an in-app notification.
 */
export async function updateSupportTicketAction(input: { id: string; status: TicketStatus; adminReply: string }): Promise<UpdateTicketResult> {
    const adminEmail = await requireAdminSession();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    const { id, status } = parsed.data;
    const reply = parsed.data.adminReply || null;

    try {
        const current = await supportTicketDb.findById(id);
        if (!current) return { success: false, error: 'Ticket not found' };

        const statusChanged = current.status !== status;
        const replyChanged = current.adminReply !== reply;
        if (!statusChanged && !replyChanged) return { success: true, ticket: current, notified: false };

        const ticket = await supportTicketDb.update(id, {
            status,
            adminReply: reply,
            // Who wrote the reply, and when (cleared along with the reply)
            ...(replyChanged ? { repliedAt: reply ? new Date().toISOString() : null, repliedBy: reply ? adminEmail : null } : {}),
        });

        let notified = false;
        if (statusChanged || (replyChanged && reply)) {
            try {
                await notificationDb.create(ticket.userId, ticketNotification(ticket, replyChanged ? reply : null));
                notified = true;
            } catch (err) {
                // The ticket is saved; the player still sees the change when they ask the chatbot
                console.error('[support-tickets] notification failed:', err);
            }
        }
        return { success: true, ticket, notified };
    } catch (err) {
        console.error('[support-tickets] update failed:', err);
        return { success: false, error: 'Failed to update the ticket' };
    }
}

function ticketNotification(ticket: AdminTicket, newReply: string | null) {
    const status = TICKET_STATUS_LABELS[ticket.status];
    const preview = newReply && newReply.length > 160 ? `${newReply.slice(0, 157)}...` : newReply;
    return {
        title: `Support ticket ${ticket.ticketNumber}: ${status}`,
        message: preview
            ? `Our support team replied: "${preview}" Ask the chat assistant about ${ticket.ticketNumber} to see the full reply.`
            : `Your ticket is now ${status.toLowerCase()}. Ask the chat assistant about ${ticket.ticketNumber} for details.`,
        type: 'support_ticket',
    };
}
