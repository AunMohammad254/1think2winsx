import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  csrf: vi.fn(async (): Promise<Record<string, string>> => ({ 'x-csrf-token': 'tok' })),
  deleteResult: { error: null as unknown },
  eq: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: h.csrf }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ delete: () => ({ eq: async (...args: unknown[]) => { h.eq(...args); return h.deleteResult; } }) }),
  }),
}));

import AdminNotificationPage from '@/app/admin/(protected)/notifications/page';

const notif = (id: string, over: Record<string, unknown> = {}) => ({
  id, userId: 'u', title: `Title ${id}`, message: `Message ${id}`, type: 'general', read: false, link: null, createdAt: '2026-10-01T10:00:00Z', User: null, ...over,
});
const history = [
  notif('n1', { type: 'live_stream', link: '/live', User: { name: 'Ali', email: 'ali@x.com' }, read: true }),
  notif('n2', { type: 'mystery', User: { name: null, email: 'sara@x.com' } }),
  notif('n3'),
];

let fetchMock: ReturnType<typeof vi.fn>;
const routes = (over: { list?: () => Response | Promise<Response>; send?: () => Response } = {}) =>
  vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return over.send?.() ?? jsonResponse({ message: 'Sent to 120 users' });
    return over.list?.() ?? jsonResponse({ notifications: history });
  });

beforeEach(() => {
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.csrf.mockClear();
  h.eq.mockReset();
  h.deleteResult = { error: null };
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const field = (label: RegExp) => screen.getByLabelText(label);
const type = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const submit = () => fireEvent.submit(field(/Notification Title/).closest('form')!);
const sentBody = () => JSON.parse(fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST').at(-1)![1].body);
const openHistory = () => fireEvent.click(screen.getByRole('button', { name: 'Notification History' }));

describe('admin notifications page', () => {
  it('validates the form before sending', () => {
    render(<AdminNotificationPage />);
    submit();
    expect(h.toast.error).toHaveBeenLastCalledWith('Title and message are required');
    type(/Notification Title/, 'Hi');
    type(/Message Content/, '   ');
    submit();
    expect(h.toast.error).toHaveBeenLastCalledWith('Title and message are required');
    type(/Message Content/, 'Body');
    fireEvent.click(screen.getByRole('button', { name: /Target Single User/ }));
    submit();
    expect(h.toast.error).toHaveBeenLastCalledWith('Recipient email is required for user targeted notifications');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('broadcasts a notification and clears the form', async () => {
    render(<AdminNotificationPage />);
    expect(screen.getByRole('button', { name: /Broadcast/ }).className).toContain('border-purple-500');
    type(/Notification Title/, '  Live now ');
    type(/Message Content/, ' Join the stream ');
    type(/Action Link/, '   ');
    fireEvent.click(screen.getByRole('button', { name: 'Live Stream' }));
    expect(screen.getByRole('button', { name: 'Live Stream' }).className).toContain('border-purple-500');
    submit();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Sent to 120 users'));
    expect(sentBody()).toEqual({ title: 'Live now', message: 'Join the stream', type: 'live_stream', targetType: 'broadcast' });
    expect(fetchMock.mock.calls[0][1].headers['x-csrf-token']).toBe('tok');
    expect(field(/Notification Title/)).toHaveValue('');
    expect(field(/Message Content/)).toHaveValue('');
  });

  it('targets one user with a link and a schedule', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ send: () => jsonResponse({}) })));
    render(<AdminNotificationPage />);
    fireEvent.click(screen.getByRole('button', { name: /Target Single User/ }));
    type(/User Email Address/, ' Ali@X.com ');
    type(/Notification Title/, 'Streak');
    type(/Message Content/, 'Keep it up');
    type(/Action Link/, ' /quizzes ');
    type(/Schedule Delivery/, '2026-12-01T10:00');
    submit();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Notification processed successfully'));
    expect(sentBody()).toEqual({
      title: 'Streak', message: 'Keep it up', type: 'general', link: '/quizzes', targetType: 'user', targetEmail: 'ali@x.com', scheduledAt: '2026-12-01T10:00',
    });
    expect(field(/User Email Address/)).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Broadcast/ }));
    expect(screen.queryByLabelText(/User Email Address/)).toBeNull();
  });

  it('reports send failures and shows progress', async () => {
    const results = [jsonResponse({ message: 'User not found' }, 404), jsonResponse({}, 500)];
    vi.stubGlobal('fetch', (fetchMock = routes({ send: () => results.shift()! })));
    render(<AdminNotificationPage />);
    type(/Notification Title/, 'Hi');
    type(/Message Content/, 'Body');
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('User not found'));
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to send notification'));
    h.csrf.mockRejectedValueOnce('no token');
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Something went wrong'));
    h.csrf.mockReturnValueOnce(new Promise(() => {}));
    submit();
    expect(await screen.findByRole('button', { name: /Dispatching/ })).toBeDisabled();
  });

  it('shows the history log with recipients, links and read status', async () => {
    render(<AdminNotificationPage />);
    openHistory();
    expect(screen.getByText('Loading history...')).toBeInTheDocument();
    expect(await screen.findByText('Title n1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notification History' }).className).toContain('border-purple-500');
    expect(screen.getByText('Recipient: ali@x.com')).toBeInTheDocument();
    expect(screen.getByText('Link: /live')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Unread')).toBeInTheDocument(); // n2 has a user but isn't read
    expect(screen.getByText('Recipient: Global Broadcast')).toBeInTheDocument();
    expect(screen.getAllByText(/^Status:/)).toHaveLength(2); // broadcasts have no read status

    // Refreshing keeps the list on screen while it reloads.
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { release = r; })));
    const refresh = screen.getByText('Sent Notifications Log').parentElement!.querySelector('button')!;
    fireEvent.click(refresh);
    await waitFor(() => expect(refresh).toBeDisabled());
    expect(screen.getByText('Title n1')).toBeInTheDocument();
    release(jsonResponse({}));
    expect(await screen.findByText('No sent notifications found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Notification' }));
    expect(screen.getByText('Send New Notification')).toBeInTheDocument();
  });

  it('reports history load failures', async () => {
    const results = [jsonResponse({ message: 'Forbidden' }, 403), jsonResponse({}, 500)];
    vi.stubGlobal('fetch', routes({ list: () => results.shift() ?? Promise.reject(new Error('offline')) }));
    render(<AdminNotificationPage />);
    for (let i = 0; i < 3; i++) {
      openHistory();
      await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(i + 1));
      fireEvent.click(screen.getByRole('button', { name: 'Create Notification' }));
    }
    expect(h.toast.error).toHaveBeenCalledWith('Failed to load notification history');
    expect(console.error).toHaveBeenCalledWith('Failed to fetch history:', new Error('Forbidden'));
    expect(console.error).toHaveBeenCalledWith('Failed to fetch history:', new Error('Failed to load history'));
  });

  it('deletes history records after confirmation', async () => {
    render(<AdminNotificationPage />);
    openHistory();
    await screen.findByText('Title n1');
    const remove = () => fireEvent.click(screen.getAllByTitle('Delete notification')[0]);
    vi.mocked(confirm).mockReturnValueOnce(false);
    remove();
    expect(h.eq).not.toHaveBeenCalled();
    h.deleteResult = { error: { message: 'RLS' } };
    remove();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to delete notification'));
    h.deleteResult = { error: null };
    remove();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Notification deleted'));
    expect(h.eq).toHaveBeenLastCalledWith('id', 'n1');
    expect(screen.queryByText('Title n1')).toBeNull();
    expect(screen.getByText('Title n2')).toBeInTheDocument();
  });
});
