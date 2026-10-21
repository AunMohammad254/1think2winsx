import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({ 'x-csrf-token': 'tok' }) }));

import AdminNewsletterPage from '@/app/admin/(protected)/newsletter/page';

let fetchMock: ReturnType<typeof vi.fn>;
let confirmMock: ReturnType<typeof vi.fn>;
const routes = (over: { list?: () => Response | Promise<Response>; del?: () => Response; send?: () => Response | Promise<Response> } = {}) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/send')) return over.send?.() ?? jsonResponse({ success: true, message: 'Sent to 2 subscribers' });
    if (init?.method === 'DELETE') return over.del?.() ?? jsonResponse({ success: true });
    return over.list?.() ?? jsonResponse({ subscribers: ['ali@x.com', 'sara@x.com'] });
  });

beforeEach(() => {
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
  confirmMock = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const loaded = () => screen.findByText('ali@x.com');
const fill = (subject: string, content: string, sender = '') => {
  fireEvent.change(screen.getByLabelText('Sender Email Address'), { target: { value: sender } });
  fireEvent.change(screen.getByLabelText('Email Subject'), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText(/Email Description/), { target: { value: content } });
};
const send = () => fireEvent.submit(screen.getByLabelText('Email Subject').closest('form')!);

describe('admin newsletter page', () => {
  it('lists subscribers, searches and refreshes', async () => {
    render(<AdminNewsletterPage />);
    expect(screen.getByText('Loading subscribers list...')).toBeInTheDocument();
    await loaded();
    expect(fetchMock.mock.calls[0][1].headers['x-csrf-token']).toBe('tok');
    expect(screen.getByRole('button', { name: /Dispatch to 2 Subscriber/ })).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText('Search email...'), { target: { value: 'sara' } });
    expect(screen.queryByText('ali@x.com')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search email...'), { target: { value: 'nobody' } });
    expect(screen.getByText('Try another search query')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refresh list/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('handles an empty list, an expired session and load failures', async () => {
    vi.stubGlobal('fetch', routes({ list: () => jsonResponse({}) }));
    const { unmount } = render(<AdminNewsletterPage />);
    expect(await screen.findByText('No subscribers found')).toBeInTheDocument();
    expect(screen.queryByText('Try another search query')).toBeNull();
    expect(screen.getByRole('button', { name: /Dispatch to 0 Subscriber/ })).toBeDisabled();
    unmount();
    vi.stubGlobal('fetch', routes({ list: () => jsonResponse({}, 401) }));
    const second = render(<AdminNewsletterPage />);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Session expired. Please log in again.'));
    second.unmount();
    vi.stubGlobal('fetch', routes({ list: () => jsonResponse({}, 500) }));
    render(<AdminNewsletterPage />);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to load subscribers list'));
  });

  it('removes a subscriber after confirmation, and reports failures', async () => {
    const results = [jsonResponse({ success: false, message: 'Not found' }), jsonResponse({}, 500)];
    vi.stubGlobal('fetch', (fetchMock = routes({ del: () => results.shift() ?? jsonResponse({ success: true }) })));
    render(<AdminNewsletterPage />);
    await loaded();
    const remove = () => fireEvent.click(screen.getAllByTitle('Remove subscriber')[0]);
    confirmMock.mockReturnValueOnce(false);
    remove();
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'DELETE')).toHaveLength(0);
    remove();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Not found'));
    remove();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to remove subscriber'));
    remove();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Subscriber successfully removed.'));
    expect(screen.queryByText('ali@x.com')).toBeNull();
    const del = fetchMock.mock.calls.filter(([, i]) => i?.method === 'DELETE').at(-1)!;
    expect(JSON.parse(del[1].body)).toEqual({ email: 'ali@x.com' });
  });

  it('reports a network failure while removing', async () => {
    vi.stubGlobal('fetch', routes({ del: () => { throw new Error('offline'); } }));
    render(<AdminNewsletterPage />);
    await loaded();
    fireEvent.click(screen.getAllByTitle('Remove subscriber')[0]);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('An error occurred. Please try again.'));
  });

  it('validates the newsletter before sending', async () => {
    render(<AdminNewsletterPage />);
    await loaded();
    fill('', '');
    send();
    expect(h.toast.error).toHaveBeenLastCalledWith('Subject and content are required.');
    fill('Weekly update', 'Hello everyone!', 'not-an-email');
    send();
    expect(h.toast.error).toHaveBeenLastCalledWith('Please enter a valid sender email.');
    fill('Weekly update', 'Too short');
    send();
    expect(h.toast.error).toHaveBeenLastCalledWith('Newsletter description should be at least 10 characters.');
    confirmMock.mockReturnValueOnce(false);
    fill('Weekly update', 'Hello everyone, new quizzes!');
    send();
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith('/send'))).toBe(false);
  });

  it('refuses to send without subscribers', async () => {
    vi.stubGlobal('fetch', routes({ list: () => jsonResponse({ subscribers: [] }) }));
    render(<AdminNewsletterPage />);
    await screen.findByText('No subscribers found');
    fill('Weekly update', 'Hello everyone, new quizzes!');
    send();
    expect(h.toast.error).toHaveBeenLastCalledWith('There are no subscribers to send emails to.');
  });

  it('sends the newsletter, and reports send failures', async () => {
    const results = [jsonResponse({ success: false, message: 'Sender not verified' }, 400), jsonResponse({}, 500), jsonResponse({ success: true })];
    vi.stubGlobal('fetch', (fetchMock = routes({ send: () => results.shift() ?? jsonResponse({ success: true, message: 'Sent to 2 subscribers' }) })));
    render(<AdminNewsletterPage />);
    await loaded();
    fill('  Weekly update ', '  Hello everyone, new quizzes!  ', ' news@x.com ');
    send();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Sender not verified'));
    expect(JSON.parse(fetchMock.mock.calls.find(([u]) => u.endsWith('/send'))![1].body)).toEqual({ senderEmail: 'news@x.com', subject: 'Weekly update', content: 'Hello everyone, new quizzes!' });
    send();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to send newsletter'));
    send();
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Newsletter sent successfully!'));
    expect(screen.getByText('Newsletter Dispatched')).toBeInTheDocument();
    expect(screen.getByLabelText('Email Subject')).toHaveValue('');
    fill('Again', 'Hello everyone, round two!');
    send();
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Sent to 2 subscribers'));
  });

  it('sends a test to one address without asking to email the subscribers', async () => {
    const results: Array<() => Response | Promise<Response>> = [
      () => jsonResponse({ success: true, test: true, message: 'Brevo accepted the test email to me@x.com.' }),
      () => jsonResponse({ success: true, test: true }),
      () => jsonResponse({ success: false, message: 'Newsletters can only be sent from an @1think2win.com address' }, 400),
      () => jsonResponse({}, 500),
      () => { throw new Error('offline'); },
      () => new Promise(() => {}) as Promise<Response>,
    ];
    vi.stubGlobal('fetch', (fetchMock = routes({ send: () => results.shift()!() })));
    render(<AdminNewsletterPage />);
    await loaded();
    const sendTest = () => fireEvent.click(screen.getByRole('button', { name: 'Send test' }));

    fill('', '');
    sendTest();
    expect(h.toast.error).toHaveBeenLastCalledWith('Subject and content are required.');
    fill('Weekly update', 'Hello everyone, new quizzes!');
    sendTest();
    expect(h.toast.error).toHaveBeenLastCalledWith('Enter the address to send the test to.');
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith('/send'))).toBe(false);

    fireEvent.change(screen.getByLabelText('Send a test first'), { target: { value: ' me@x.com ' } });
    sendTest();
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Brevo accepted the test email to me@x.com.'));
    expect(confirmMock).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls.find(([u]) => u.endsWith('/send'))![1].body)).toEqual({ senderEmail: '', subject: 'Weekly update', content: 'Hello everyone, new quizzes!', testEmail: 'me@x.com' });
    // The message stays, ready for the real dispatch
    expect(screen.getByLabelText('Email Subject')).toHaveValue('Weekly update');
    expect(screen.queryByText('Newsletter Dispatched')).toBeNull();

    sendTest();
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Test email sent.'));
    sendTest();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Newsletters can only be sent from an @1think2win.com address'));
    sendTest();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to send the test email'));
    sendTest();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('An error occurred. Please try again.'));
    sendTest();
    expect(await screen.findByRole('button', { name: 'Sending test…' })).toBeDisabled();
  });

  it('reports a network failure while sending, and shows progress', async () => {
    let fail = true;
    vi.stubGlobal('fetch', routes({ send: () => { if (fail) { fail = false; throw new Error('offline'); } return new Promise(() => {}) as Promise<Response>; } }));
    render(<AdminNewsletterPage />);
    await loaded();
    fill('Weekly update', 'Hello everyone, new quizzes!');
    send();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('An error occurred. Please try again.'));
    send();
    expect(await screen.findByRole('button', { name: /Dispatching Newsletter/ })).toBeDisabled();
  });
});
