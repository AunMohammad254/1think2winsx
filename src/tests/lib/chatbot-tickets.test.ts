// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupportTicket } from '@/lib/support-tickets';

const tickets = vi.hoisted(() => ({ create: vi.fn(), findForUser: vi.fn(), listForUser: vi.fn() }));
vi.mock('@/lib/supabase/db', () => ({ supportTicketDb: tickets }));

import { handleTicketRequests, ticketPrompt } from '@/lib/chatbot-tickets';
import { findTicketNumbers, isTicketStatus } from '@/lib/support-tickets';

const say = (...texts: string[]) => texts.map((text, i) => ({ role: i % 2 ? 'model' : 'user', parts: [{ text }] }));
const ticket = (overrides: Partial<SupportTicket> = {}): SupportTicket => ({
  id: 't1',
  ticketNumber: 'TKT-7KQ2XM',
  userId: 'user-1',
  subject: 'Deposit missing',
  message: 'I sent 200 PKR',
  status: 'in_progress',
  adminReply: null,
  repliedAt: null,
  repliedBy: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-21T19:30:00Z', // 22 Oct in Pakistan
  ...overrides,
});
// null: a guest
const run = (reply: string, history = say('help'), userId: string | null = 'user-1') => handleTicketRequests(reply, { userId: userId ?? undefined, history });

beforeEach(() => {
  for (const fn of Object.values(tickets)) fn.mockReset();
  tickets.findForUser.mockResolvedValue([]);
  tickets.listForUser.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('findTicketNumbers', () => {
  it('finds numbers in any case, with or without the dash, once each', () => {
    expect(findTicketNumbers('tkt-7kq2xm and TKT7KQ2XM, also TKT-ABCDEF')).toEqual(['TKT-7KQ2XM', 'TKT-ABCDEF']);
  });

  it('ignores look-alike characters, wrong lengths and words that run on', () => {
    expect(findTicketNumbers('TKT-AB0CDE TKT-ABCDEI TKT-ABCDE TKT-ABCDEFG XTKT-ABCDEF')).toEqual([]);
  });

  it('knows the statuses', () => {
    expect(isTicketStatus('in_progress')).toBe(true);
    expect(isTicketStatus('pending')).toBe(false);
  });
});

describe('ticketPrompt', () => {
  it('explains the markers to a signed-in player and asks a guest to sign in', () => {
    expect(ticketPrompt(true)).toContain('[TICKET_CREATE:');
    expect(ticketPrompt(true)).toContain('[TICKET_STATUS:ALL]');
    expect(ticketPrompt(false)).toContain('[REDIRECT:/login]');
    expect(ticketPrompt(false)).toContain('Never write TICKET markers.');
  });
});

describe('handleTicketRequests', () => {
  it('leaves an ordinary reply alone and touches no database', async () => {
    expect(await run('Hello!')).toEqual({ message: 'Hello!', redirects: [] });
    expect(await run('Hello!', say('hi'), null)).toEqual({ message: 'Hello!', redirects: [] });
    expect(Object.values(tickets).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    ['a create marker', '[TICKET_CREATE:x]'],
    ['a status marker', '[TICKET_STATUS:TKT-7KQ2XM]'],
    ['an ALL marker', '[ticket_status: all ]'],
  ])('asks a guest to sign in for %s, without any lookup', async (_label, marker) => {
    expect(await run(`OK. ${marker}`, say('help'), null)).toEqual({
      message: 'OK.\n\n🔒 Please sign in to send or check a support ticket. Tickets belong to your account, so only you can see yours.',
      redirects: ['/login'],
    });
    expect(Object.values(tickets).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("doesn't react to a ticket number a guest typed (the prompt has the model ask them to sign in)", async () => {
    expect(await run('Please sign in.', say('status of TKT-7KQ2XM?'), null)).toEqual({ message: 'Please sign in.', redirects: [] });
  });

  it("creates a ticket from the model's summary and the player's own words", async () => {
    tickets.create.mockResolvedValue({ success: true, ticket: ticket() });
    const history = say('My deposit is missing', 'Want me to send it to the team?', '  yes please  ');
    const out = await run('Sending this to our support team now. [TICKET_CREATE:  Deposit   not credited ]', history);
    expect(tickets.create).toHaveBeenCalledWith('user-1', 'Deposit not credited', 'My deposit is missing\n\nyes please');
    expect(out).toEqual({
      message:
        'Sending this to our support team now.\n\n🎫 Your ticket number is TKT-7KQ2XM. Our support team has it now.\n' +
        "Please save this number: ask me about TKT-7KQ2XM any time to see its status and our team's reply.",
      redirects: [],
      ticketNumber: 'TKT-7KQ2XM',
    });
  });

  it("creates only one ticket per reply, and uses the player's last message when the summary is empty", async () => {
    tickets.create.mockResolvedValue({ success: true, ticket: ticket() });
    await run('[TICKET_CREATE:] [TICKET_CREATE:second]', say('x'.repeat(130)));
    expect(tickets.create).toHaveBeenCalledTimes(1);
    expect(tickets.create.mock.calls[0][1]).toBe(`${'x'.repeat(119)}…`);
  });

  it("keeps the end of a long conversation as the ticket's description", async () => {
    tickets.create.mockResolvedValue({ success: true, ticket: ticket() });
    await run('[TICKET_CREATE:Long]', say('a'.repeat(1500), 'ok', 'b'.repeat(1500)));
    const description = tickets.create.mock.calls[0][2] as string;
    expect(description).toHaveLength(2000);
    expect(description.startsWith('…a')).toBe(true);
    expect(description.endsWith('b'.repeat(1500))).toBe(true);
  });

  it('passes on a refusal from the database (the rate limit)', async () => {
    tickets.create.mockResolvedValue({ success: false, code: 'rate_limited', error: 'You have sent 3 tickets in the last hour.' });
    expect(await run('[TICKET_CREATE:Again]')).toEqual({ message: '⚠️ You have sent 3 tickets in the last hour.', redirects: [] });
  });

  it("reports a ticket's status and reply, only from the player's own tickets", async () => {
    tickets.findForUser.mockResolvedValue([ticket({ adminReply: 'We found it, it is credited now.' })]);
    const out = await run('Let me check. [TICKET_STATUS:tkt-7kq2xm] [TICKET_STATUS:TKT-ZZZZZZ]');
    expect(tickets.findForUser).toHaveBeenCalledWith('user-1', ['TKT-7KQ2XM', 'TKT-ZZZZZZ']);
    expect(out.message).toBe(
      [
        'Let me check.',
        '🎫 TKT-7KQ2XM: "Deposit missing"\nStatus: In progress\nReply from our support team: We found it, it is credited now.\nSent 20 Oct 2026 · Last updated 22 Oct 2026',
        "I couldn't find ticket TKT-ZZZZZZ on your account. Please check the number (it looks like TKT-7KQ2XM).",
      ].join('\n\n'),
    );
  });

  it('looks up a number the player typed even when the model forgot to ask', async () => {
    tickets.findForUser.mockResolvedValue([ticket({ status: 'open' })]);
    const out = await run('Sure!', say('what about TKT-7KQ2XM?'));
    expect(tickets.findForUser).toHaveBeenCalledWith('user-1', ['TKT-7KQ2XM']);
    expect(out.message).toContain('Status: Open\nNo reply from our support team yet.');
  });

  it("lists the player's latest tickets for ALL", async () => {
    tickets.listForUser.mockResolvedValue([ticket(), ticket({ ticketNumber: 'TKT-ABCDEF', status: 'resolved', adminReply: 'Done' })]);
    const out = await run('[TICKET_STATUS:ALL]');
    expect(tickets.listForUser).toHaveBeenCalledWith('user-1', 5);
    expect(out.message).toMatch(/^Your latest support tickets:\n\n🎫 TKT-7KQ2XM: .*\n\n🎫 TKT-ABCDEF: "Deposit missing"\nStatus: Resolved\nReply from our support team: Done/s);
  });

  it('says so when the player has no tickets yet, or the history has no player turn', async () => {
    expect((await run('[TICKET_STATUS:ALL]', [])).message).toBe(
      "You haven't sent any support tickets yet. Tell me about the problem and I can send it to our support team.",
    );
  });

  it('apologises instead of failing when the database is down, keeping what already worked', async () => {
    tickets.create.mockResolvedValue({ success: true, ticket: ticket() });
    tickets.findForUser.mockRejectedValue(new Error('db down'));
    const out = await run('[TICKET_CREATE:New] [TICKET_STATUS:TKT-ABCDEF]');
    expect(out.ticketNumber).toBe('TKT-7KQ2XM');
    expect(out.message).toMatch(/^🎫 Your ticket number is TKT-7KQ2XM.*\n\n⚠️ Sorry, I couldn't reach our support ticket system just now/s);
    expect(console.error).toHaveBeenCalledWith('[Chatbot] Support ticket request failed:', expect.any(Error));
  });
});
