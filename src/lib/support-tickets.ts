/**
 * Support tickets: values shared by the chatbot (server), the admin actions and the admin UI.
 * Safe to import in client components (no server-only imports).
 * Table and rate limits: supabase/migrations/20261021120000_support_tickets.sql.
 */
import type { SupportTicket } from '@/lib/supabase/database.types';

export type { SupportTicket };
export type TicketStatus = SupportTicket['status'];

export const TICKET_STATUSES: readonly TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

// Column limits (CHECK constraints on "SupportTicket")
export const TICKET_SUBJECT_MAX = 120;
export const TICKET_MESSAGE_MAX = 2000;
export const TICKET_REPLY_MAX = 2000;

export function isTicketStatus(value: unknown): value is TicketStatus {
  return TICKET_STATUSES.includes(value as TicketStatus);
}

// 'TKT-' plus 6 characters from an alphabet without look-alikes (no I, O, 0 or 1). Players may
// type it in lower case or leave the dash out.
const TICKET_NUMBER_IN_TEXT = /\bTKT-?([A-HJ-NP-Z2-9]{6})\b/gi;

/** The ticket numbers mentioned in `text`, upper-cased as stored ('TKT-7KQ2XM'), without repeats. */
export function findTicketNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(TICKET_NUMBER_IN_TEXT)) found.add(`TKT-${match[1].toUpperCase()}`);
  return [...found];
}
