// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, argOf, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
vi.mock('@/lib/supabase/db-modules/shared', () => ({ getAdminDb: () => adminDb.client }));

const { supportTicketDb } = await import('@/lib/supabase/db-modules/support-ticket.db');

const ops = (i = 0) => adminDb.callsTo('SupportTicket')[i].ops;
const failure = { message: 'db down' };

beforeEach(() => {
  adminDb = createSupabaseMock();
});

describe('supportTicketDb', () => {
  it('creates a ticket through create_support_ticket and passes its answer on', async () => {
    adminDb.setRpc('create_support_ticket', { data: { success: false, code: 'rate_limited', error: 'Too many' } });
    expect(await supportTicketDb.create('u1', 'Subject', 'Message')).toEqual({ success: false, code: 'rate_limited', error: 'Too many' });
    expect(adminDb.rpcCalls).toEqual([{ fn: 'create_support_ticket', args: { p_user_id: 'u1', p_subject: 'Subject', p_message: 'Message' } }]);
  });

  it("finds tickets by number among the player's own only", async () => {
    adminDb.setTable('SupportTicket', { data: [{ ticketNumber: 'TKT-7KQ2XM' }] });
    expect(await supportTicketDb.findForUser('u1', ['TKT-7KQ2XM'])).toEqual([{ ticketNumber: 'TKT-7KQ2XM' }]);
    const call = adminDb.callsTo('SupportTicket')[0];
    expect(eqValue(call, 'userId')).toBe('u1');
    expect(ops()).toContainEqual({ op: 'in', args: ['ticketNumber', ['TKT-7KQ2XM']] });

    adminDb.setTable('SupportTicket', { data: null });
    expect(await supportTicketDb.findForUser('u1', ['TKT-ABCDEF'])).toEqual([]);
  });

  it("lists a player's newest tickets", async () => {
    adminDb.setTable('SupportTicket', { data: null });
    expect(await supportTicketDb.listForUser('u1')).toEqual([]);
    expect(ops()).toEqual(expect.arrayContaining([
      { op: 'eq', args: ['userId', 'u1'] },
      { op: 'order', args: ['createdAt', { ascending: false }] },
      { op: 'limit', args: [5] },
    ]));
  });

  it('pages through all tickets with the player attached, optionally by status and number', async () => {
    adminDb.setTable('SupportTicket', { data: [{ id: 't1' }], count: 41 });
    expect(await supportTicketDb.list({ status: 'open', ticketNumber: 'TKT-7KQ2XM', page: 3, limit: 20 })).toEqual({ tickets: [{ id: 't1' }], total: 41 });
    expect(ops()).toEqual([
      { op: 'select', args: ['*, user:User(name, email)', { count: 'exact' }] },
      { op: 'eq', args: ['status', 'open'] },
      { op: 'eq', args: ['ticketNumber', 'TKT-7KQ2XM'] },
      { op: 'order', args: ['createdAt', { ascending: false }] },
      { op: 'range', args: [40, 59] },
    ]);

    adminDb.setTable('SupportTicket', { data: null, count: null });
    expect(await supportTicketDb.list({ page: 1, limit: 20 })).toEqual({ tickets: [], total: 0 });
    expect(ops(1).filter((o) => o.op === 'eq')).toEqual([]);
  });

  it('counts tickets per status', async () => {
    adminDb.setTable('SupportTicket', (call) => ({ count: eqValue(call, 'status') === 'open' ? 4 : null }));
    expect(await supportTicketDb.countByStatus()).toEqual({ open: 4, in_progress: 0, resolved: 0, closed: 0 });
    expect(adminDb.callsTo('SupportTicket').map((c) => eqValue(c, 'status'))).toEqual(['open', 'in_progress', 'resolved', 'closed']);
  });

  it('finds one ticket by id and updates it, stamping "updatedAt"', async () => {
    adminDb.setTable('SupportTicket', { data: { id: 't1', status: 'resolved' } });
    expect(await supportTicketDb.findById('t1')).toEqual({ id: 't1', status: 'resolved' });
    expect(eqValue(adminDb.callsTo('SupportTicket')[0], 'id')).toBe('t1');

    expect(await supportTicketDb.update('t1', { status: 'resolved', adminReply: 'Fixed' })).toEqual({ id: 't1', status: 'resolved' });
    const update = adminDb.callsTo('SupportTicket', 'update')[0];
    expect(argOf(update, 'update')).toEqual({ status: 'resolved', adminReply: 'Fixed', updatedAt: expect.any(String) });
    expect(eqValue(update, 'id')).toBe('t1');
  });

  it.each([
    ['create', () => supportTicketDb.create('u1', 's', 'm')],
    ['findForUser', () => supportTicketDb.findForUser('u1', ['TKT-7KQ2XM'])],
    ['listForUser', () => supportTicketDb.listForUser('u1')],
    ['list', () => supportTicketDb.list({ page: 1, limit: 20 })],
    ['countByStatus', () => supportTicketDb.countByStatus()],
    ['findById', () => supportTicketDb.findById('t1')],
    ['update', () => supportTicketDb.update('t1', { status: 'open', adminReply: null })],
  ])('%s throws database errors', async (_name, call) => {
    adminDb.setTable('SupportTicket', { error: failure });
    adminDb.setRpc('create_support_ticket', { error: failure });
    await expect(call()).rejects.toEqual(failure);
  });
});
