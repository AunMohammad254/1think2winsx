import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdminTicket } from '@/lib/supabase/db-modules/support-ticket.db';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/actions/support-ticket-actions', () => ({
  listSupportTicketsAction: (...a: unknown[]) => h.list(...a),
  updateSupportTicketAction: (...a: unknown[]) => h.update(...a),
}));
vi.mock('sonner', () => ({ toast: h.toast }));

import SupportTicketsManager from '@/components/admin/SupportTicketsManager';

const ticket = (overrides: Partial<AdminTicket> = {}): AdminTicket => ({
  id: 't1',
  ticketNumber: 'TKT-7KQ2XM',
  userId: 'user-1',
  subject: 'Deposit missing',
  message: 'I sent 200 PKR\nbut nothing arrived',
  status: 'open',
  adminReply: null,
  repliedAt: null,
  repliedBy: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  user: { name: 'Ali', email: 'ali@example.test' },
  ...overrides,
});
const counts = { open: 2, in_progress: 1, resolved: 4, closed: 0 };
const page = (tickets: AdminTicket[], extra: Record<string, unknown> = {}) => ({ success: true, tickets, total: tickets.length, counts, page: 1, pageSize: 20, ...extra });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const lastListCall = () => h.list.mock.calls.at(-1)![0];

beforeEach(() => {
  for (const fn of [h.list, h.update, h.toast.success, h.toast.error]) fn.mockReset();
  h.list.mockResolvedValue(page([ticket(), ticket({ id: 't2', ticketNumber: 'TKT-ABCDEF', status: 'resolved', adminReply: 'Done', user: null })]));
});

describe('SupportTicketsManager', () => {
  it('lists the open tickets first, with totals per status', async () => {
    render(<SupportTicketsManager />);
    expect(screen.getByText('Loading tickets…')).toBeInTheDocument();
    expect(await screen.findByText('TKT-7KQ2XM')).toBeInTheDocument();
    expect(h.list).toHaveBeenCalledWith({ status: 'open', search: '', page: 1 });
    expect(screen.getByRole('button', { name: 'Open 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Resolved 4' })).toBeInTheDocument();
    expect(screen.getByText('ali@example.test')).toBeInTheDocument();
    expect(screen.getByText('Player account deleted')).toBeInTheDocument();
    expect(screen.getAllByText('Replied')).toHaveLength(1);
  });

  it('filters by status, back to page 1, and shows an empty list', async () => {
    render(<SupportTicketsManager />);
    await screen.findByText('TKT-7KQ2XM');
    h.list.mockResolvedValue(page([]));
    click('In progress 1');
    await screen.findByText('No tickets here.');
    expect(lastListCall()).toEqual({ status: 'in_progress', search: '', page: 1 });
    click('All');
    await waitFor(() => expect(lastListCall()).toEqual({ status: undefined, search: '', page: 1 }));
  });

  it('finds a ticket by number and refreshes on request', async () => {
    render(<SupportTicketsManager />);
    await screen.findByText('TKT-7KQ2XM');
    fireEvent.change(screen.getByPlaceholderText('Find a ticket number, e.g. TKT-7KQ2XM'), { target: { value: '  tkt-7kq2xm ' } });
    click('Find');
    await waitFor(() => expect(lastListCall()).toEqual({ status: 'open', search: 'tkt-7kq2xm', page: 1 }));
    const calls = h.list.mock.calls.length;
    click('Refresh');
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(calls + 1));
  });

  it('pages through long lists', async () => {
    h.list.mockImplementation(async ({ page: n }: { page: number }) => page([ticket({ id: `t${n}`, ticketNumber: `TKT-PAGE${'23456789'[n]}${'23456789'[n]}` })], { total: 45, page: n }));
    render(<SupportTicketsManager />);
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    click('Next');
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    click('Next');
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    click('Previous');
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(lastListCall().page).toBe(2);
  });

  it('shows load errors with a retry, keeping the last list', async () => {
    h.list.mockResolvedValueOnce({ success: false, error: 'Failed to load tickets' });
    render(<SupportTicketsManager />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load tickets');
    click('Try again');
    expect(await screen.findByText('TKT-7KQ2XM')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    h.list.mockRejectedValueOnce(new Error('offline'));
    click('Refresh');
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load tickets');
    expect(screen.getByText('TKT-7KQ2XM')).toBeInTheDocument();
  });

  it('opens a ticket, saves a new status and reply, and reloads', async () => {
    h.update.mockResolvedValue({ success: true, ticket: ticket(), notified: true });
    render(<SupportTicketsManager />);
    fireEvent.click(await screen.findByRole('button', { name: /TKT-7KQ2XM/ }));
    const dialog = screen.getByRole('dialog', { name: 'Ticket TKT-7KQ2XM' });
    expect(within(dialog).getByText('Ali · ali@example.test')).toBeInTheDocument();
    expect(within(dialog).getByText(/I sent 200 PKR/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'resolved' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/The player sees this/), { target: { value: 'Credited' } });
    expect(within(dialog).getByText('8/2000')).toBeInTheDocument();
    const calls = h.list.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.update).toHaveBeenCalledWith({ id: 't1', status: 'resolved', adminReply: 'Credited' });
    expect(h.toast.success).toHaveBeenCalledWith('Ticket updated. The player has been notified.');
    expect(h.list).toHaveBeenCalledTimes(calls + 1);
  });

  it("shows a ticket's existing reply and when it was written", async () => {
    h.update.mockResolvedValue({ success: true, ticket: ticket(), notified: false });
    h.list.mockResolvedValue(page([ticket({ adminReply: 'On it', repliedAt: '2026-10-20T12:00:00Z', user: { name: null, email: 'x@example.test' } })]));
    render(<SupportTicketsManager />);
    fireEvent.click(await screen.findByRole('button', { name: /TKT-7KQ2XM/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('No name · x@example.test')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('On it')).toBeInTheDocument();
    expect(within(dialog).getByText(/5\/2000 · last reply/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Ticket updated'));
  });

  it('keeps the ticket open when saving fails', async () => {
    h.update.mockResolvedValueOnce({ success: false, error: 'Ticket not found' }).mockRejectedValueOnce(new Error('offline'));
    render(<SupportTicketsManager />);
    fireEvent.click(await screen.findByRole('button', { name: /TKT-ABCDEF/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Player account deleted')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Ticket not found'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to update the ticket'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the ticket with Close, Cancel or a click outside, but not a click inside', async () => {
    render(<SupportTicketsManager />);
    const row = await screen.findByRole('button', { name: /TKT-7KQ2XM/ });
    for (const close of [() => click('Close'), () => click('Cancel'), () => fireEvent.click(screen.getByRole('dialog').parentElement!)]) {
      fireEvent.click(row);
      fireEvent.click(screen.getByRole('dialog'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      close();
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    expect(h.update).not.toHaveBeenCalled();
  });
});
