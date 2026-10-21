// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminTicket } from '@/lib/supabase/db-modules/support-ticket.db';

const h = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  tickets: { list: vi.fn(), countByStatus: vi.fn(), findById: vi.fn(), update: vi.fn() },
  notify: vi.fn(),
}));
vi.mock('@/lib/admin-session', () => ({ requireAdminSession: () => h.requireAdminSession() }));
vi.mock('@/lib/supabase/db', () => ({ supportTicketDb: h.tickets, notificationDb: { create: (...a: unknown[]) => h.notify(...a) } }));

import { listSupportTicketsAction, updateSupportTicketAction } from '@/actions/support-ticket-actions';

const ID = '7f1c2a9e-3b4d-4c5e-8f6a-1b2c3d4e5f60';
const counts = { open: 2, in_progress: 1, resolved: 0, closed: 0 };
const ticket = (overrides: Partial<AdminTicket> = {}): AdminTicket => ({
  id: ID,
  ticketNumber: 'TKT-7KQ2XM',
  userId: 'user-1',
  subject: 'Deposit missing',
  message: 'I sent 200 PKR',
  status: 'open',
  adminReply: null,
  repliedAt: null,
  repliedBy: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  user: { name: 'Ali', email: 'ali@example.test' },
  ...overrides,
});
const update = (status: AdminTicket['status'], adminReply: string) => updateSupportTicketAction({ id: ID, status, adminReply });

beforeEach(() => {
  h.requireAdminSession.mockReset().mockResolvedValue('boss@example.test');
  for (const fn of [...Object.values(h.tickets), h.notify]) fn.mockReset();
  h.tickets.list.mockResolvedValue({ tickets: [ticket()], total: 1 });
  h.tickets.countByStatus.mockResolvedValue(counts);
  h.tickets.findById.mockResolvedValue(ticket());
  h.tickets.update.mockImplementation(async (_id: string, changes: Partial<AdminTicket>) => ticket(changes));
  h.notify.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('support ticket actions need an admin session', () => {
  it.each([
    ['listSupportTicketsAction', () => listSupportTicketsAction({})],
    ['updateSupportTicketAction', () => update('resolved', '')],
  ])('%s lets the login redirect through and touches nothing', async (_name, call) => {
    h.requireAdminSession.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(call()).rejects.toThrow('NEXT_REDIRECT');
    expect(Object.values(h.tickets).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });
});

describe('listSupportTicketsAction', () => {
  it('returns one page of tickets with the totals per status', async () => {
    expect(await listSupportTicketsAction({ status: 'open', page: 2 })).toEqual({ success: true, tickets: [ticket()], total: 1, counts, page: 2, pageSize: 20 });
    expect(h.tickets.list).toHaveBeenCalledWith({ status: 'open', ticketNumber: undefined, page: 2, limit: 20 });
  });

  it('finds a ticket by the number a player quotes, however they typed it', async () => {
    await listSupportTicketsAction({ search: ' tkt-7kq2xm ' });
    expect(h.tickets.list).toHaveBeenCalledWith({ status: undefined, ticketNumber: 'TKT-7KQ2XM', page: 1, limit: 20 });
    expect(await listSupportTicketsAction({ search: 'ali@example.test' })).toEqual({ success: false, error: 'Enter a ticket number like TKT-7KQ2XM' });
  });

  it.each([
    ['an unknown status', { status: 'pending' }],
    ['a page below 1', { page: 0 }],
    ['an overlong search', { search: 'x'.repeat(41) }],
  ])('rejects %s', async (_label, input) => {
    expect(await listSupportTicketsAction(input as never)).toEqual({ success: false, error: 'Invalid filter' });
  });

  it('reports a database failure', async () => {
    h.tickets.countByStatus.mockRejectedValue(new Error('db down'));
    expect(await listSupportTicketsAction({})).toEqual({ success: false, error: 'Failed to load tickets' });
    expect(console.error).toHaveBeenCalledWith('[support-tickets] list failed:', expect.any(Error));
  });
});

describe('updateSupportTicketAction', () => {
  it('saves a new status and reply, signs the reply and notifies the player', async () => {
    const result = await update('resolved', '  We credited your deposit.  ');
    expect(h.tickets.update).toHaveBeenCalledWith(ID, {
      status: 'resolved',
      adminReply: 'We credited your deposit.',
      repliedAt: expect.any(String),
      repliedBy: 'boss@example.test',
    });
    expect(result).toMatchObject({ success: true, notified: true, ticket: { status: 'resolved' } });
    expect(h.notify).toHaveBeenCalledWith('user-1', {
      title: 'Support ticket TKT-7KQ2XM: Resolved',
      message: 'Our support team replied: "We credited your deposit." Ask the chat assistant about TKT-7KQ2XM to see the full reply.',
      type: 'support_ticket',
    });
  });

  it('shortens a long reply in the notification', async () => {
    await update('open', 'y'.repeat(300));
    expect(h.notify.mock.calls[0][1].message).toContain(`"${'y'.repeat(157)}..."`);
  });

  it('notifies a status change on its own, leaving the reply as it was', async () => {
    h.tickets.findById.mockResolvedValue(ticket({ adminReply: 'Looking into it', repliedBy: 'ops@example.test' }));
    await update('in_progress', 'Looking into it');
    expect(h.tickets.update).toHaveBeenCalledWith(ID, { status: 'in_progress', adminReply: 'Looking into it' });
    expect(h.notify.mock.calls[0][1]).toMatchObject({
      title: 'Support ticket TKT-7KQ2XM: In progress',
      message: 'Your ticket is now in progress. Ask the chat assistant about TKT-7KQ2XM for details.',
    });
  });

  it('clears a removed reply without notifying the player', async () => {
    h.tickets.findById.mockResolvedValue(ticket({ adminReply: 'Wrong ticket', repliedAt: '2026-10-20T11:00:00Z', repliedBy: 'ops@example.test' }));
    expect(await update('open', '   ')).toMatchObject({ success: true, notified: false });
    expect(h.tickets.update).toHaveBeenCalledWith(ID, { status: 'open', adminReply: null, repliedAt: null, repliedBy: null });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('writes nothing when nothing changed', async () => {
    expect(await update('open', '')).toEqual({ success: true, ticket: ticket(), notified: false });
    expect(h.tickets.update).not.toHaveBeenCalled();
  });

  it('keeps the saved change when the notification fails', async () => {
    h.notify.mockRejectedValue(new Error('push down'));
    expect(await update('closed', '')).toMatchObject({ success: true, notified: false, ticket: { status: 'closed' } });
    expect(console.error).toHaveBeenCalledWith('[support-tickets] notification failed:', expect.any(Error));
  });

  it.each([
    ['an id that is not a uuid', { id: 'TKT-7KQ2XM', status: 'open', adminReply: '' }, 'Invalid UUID'],
    ['an unknown status', { id: ID, status: 'pending', adminReply: '' }, expect.stringContaining('Invalid option')],
    ['a reply over 2000 characters', { id: ID, status: 'open', adminReply: 'x'.repeat(2001) }, 'The reply can be at most 2000 characters'],
  ])('rejects %s', async (_label, input, error) => {
    expect(await updateSupportTicketAction(input as never)).toEqual({ success: false, error });
    expect(h.tickets.findById).not.toHaveBeenCalled();
  });

  it('reports a missing ticket and a database failure', async () => {
    h.tickets.findById.mockResolvedValueOnce(null);
    expect(await update('closed', '')).toEqual({ success: false, error: 'Ticket not found' });
    h.tickets.update.mockRejectedValue(new Error('db down'));
    expect(await update('closed', '')).toEqual({ success: false, error: 'Failed to update the ticket' });
    expect(console.error).toHaveBeenCalledWith('[support-tickets] update failed:', expect.any(Error));
  });
});
