import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  user: { id: 'u1', email: 'fan@example.com', app_metadata: { provider: 'email', providers: ['email'] }, identities: [{ provider: 'email' }], user_metadata: {} } as Record<string, unknown> | null,
  toast: { success: vi.fn(), error: vi.fn() },
  checkAuthMethodsClient: vi.fn(),
  requestPasswordSetupEmail: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/password-setup-actions', () => ({ requestPasswordSetupEmail: () => h.requestPasswordSetupEmail() }));
vi.mock('@/lib/auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-helpers')>()),
  checkAuthMethodsClient: () => h.checkAuthMethodsClient(),
}));

import ChangePasswordModal from '@/components/profile/ChangePasswordModal';

let fetchMock: ReturnType<typeof vi.fn>;
const status = (over: Record<string, unknown> = {}) => jsonResponse({ canChangePassword: true, hasPassword: true, authMethod: 'email', oAuthProviders: [], ...over });
const routes = (over: { status?: () => Response | Promise<Response>; csrf?: () => Response; change?: () => Response } = {}) =>
  vi.fn(async (url: string) => {
    if (url === '/api/profile/can-change-password') return over.status ? over.status() : status();
    if (url === '/api/csrf-token') return over.csrf?.() ?? jsonResponse({ csrfToken: 'tok' });
    return over.change?.() ?? jsonResponse({ ok: true });
  });

beforeEach(() => {
  h.user = { id: 'u1', email: 'fan@example.com', app_metadata: { provider: 'email', providers: ['email'] }, identities: [{ provider: 'email' }], user_metadata: {} };
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.submit(screen.getByRole('button', { name: /Change Password|Changing/ }).closest('form')!);
const ready = () => screen.findByLabelText('Current Password');

describe('ChangePasswordModal', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<ChangePasswordModal isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the account, then changes the password', async () => {
    const onClose = vi.fn();
    render(<ChangePasswordModal isOpen onClose={onClose} />);
    expect(screen.getByText('Checking account status...')).toBeInTheDocument();
    await ready();
    type('Current Password', 'Old@1234');
    type('New Password', 'New@5678x');
    type('Confirm New Password', 'New@5678x');
    submit();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Password changed successfully!', expect.anything()));
    const put = fetchMock.mock.calls.find(([u]) => u === '/api/profile/change-password')!;
    expect(put[1].headers['X-CSRF-Token']).toBe('tok');
    expect(JSON.parse(put[1].body)).toEqual({ currentPassword: 'Old@1234', newPassword: 'New@5678x' });
    expect(onClose).toHaveBeenCalled();
  });

  it('validates the new password and its confirmation', async () => {
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    await ready();
    submit();
    expect(await screen.findByText('Current password is required')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
    type('New Password', 'Abcdefg1!');
    type('Confirm New Password', 'different');
    submit();
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
  });

  it('rates the new password as it is typed', async () => {
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    await ready();
    const cases: [string, string][] = [['a', 'Very Weak'], ['aB', 'Weak'], ['aB1', 'Fair'], ['aB1!', 'Good'], ['aB1!aaaa', 'Strong']];
    for (const [pw, label] of cases) {
      type('New Password', pw);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('One special character').parentElement!.querySelector('svg')!.getAttribute('class')).toContain('opacity-100');
  });

  it('reveals each password field on demand', async () => {
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    await ready();
    for (const label of ['Current Password', 'New Password', 'Confirm New Password']) {
      const input = screen.getByLabelText(label);
      const toggle = input.parentElement!.querySelector('button')!;
      fireEvent.click(toggle);
      expect(input).toHaveAttribute('type', 'text');
      fireEvent.click(toggle);
      expect(input).toHaveAttribute('type', 'password');
    }
  });

  it('reports a refused change and CSRF failures', async () => {
    vi.stubGlobal('fetch', (fetchMock = routes({ change: () => jsonResponse({ message: 'Current password is incorrect' }, 400) })));
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    await ready();
    type('Current Password', 'wrong');
    type('New Password', 'New@5678x');
    type('Confirm New Password', 'New@5678x');
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to change password', expect.objectContaining({ description: 'Current password is incorrect' })));

    fetchMock.mockImplementation(async (url: string) => (url === '/api/csrf-token' ? jsonResponse({}, 500) : jsonResponse({})));
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to change password', expect.objectContaining({ description: 'Failed to get CSRF token' })));
    fetchMock.mockImplementation(async (url: string) => (url === '/api/csrf-token' ? jsonResponse({ csrfToken: 't' }) : jsonResponse({}, 500)));
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to change password', expect.objectContaining({ description: 'Failed to change password' })));
    fetchMock.mockImplementation(async () => { throw 'odd'; });
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to change password', expect.objectContaining({ description: 'An unexpected error occurred' })));
  });

  it('shows a busy button while changing', async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', (fetchMock = routes({ change: () => new Promise<Response>((r) => (release = r)) as unknown as Response })));
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    await ready();
    type('Current Password', 'Old@1234');
    type('New Password', 'New@5678x');
    type('Confirm New Password', 'New@5678x');
    submit();
    expect(await screen.findByRole('button', { name: /Changing/ })).toBeDisabled();
    release(jsonResponse({}));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
  });

  it('closes from the X, the backdrop, Cancel and Escape, and resets when closed', async () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<ChangePasswordModal isOpen onClose={onClose} />);
    await ready();
    type('Current Password', 'typed');
    fireEvent.click(screen.getByRole('button', { name: 'Close change password dialog' }));
    fireEvent.click(container.querySelector('[aria-hidden="true"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(4);
    rerender(<ChangePasswordModal isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(4);
    rerender(<ChangePasswordModal isOpen onClose={onClose} />);
    expect(await ready()).toHaveValue('');
  });

  it('offers a set-password email to Google-only accounts', async () => {
    vi.stubGlobal('fetch', routes({ status: () => status({ canChangePassword: false, hasPassword: false, authMethod: 'oauth', oAuthProviders: ['google', 'github'] }) }));
    h.requestPasswordSetupEmail.mockResolvedValueOnce({ error: 'Too many requests' }).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ email: 'fan@example.com' });
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    expect(await screen.findByText(/Google and GitHub/)).toBeInTheDocument();
    const send = () => fireEvent.click(screen.getByRole('button', { name: /Email me a link|Send/ }));
    send();
    expect(await screen.findByText('Too many requests')).toBeInTheDocument();
    send();
    expect(await screen.findByText('An error occurred. Please try again.')).toBeInTheDocument();
    send();
    expect(await screen.findByText(/fan@example\.com/)).toBeInTheDocument();
  });

  it('assumes Google when an OAuth account reports no providers', async () => {
    vi.stubGlobal('fetch', routes({ status: () => status({ canChangePassword: false, hasPassword: false, authMethod: 'oauth', oAuthProviders: undefined }) }));
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    expect((await screen.findAllByText(/Google/)).length).toBeGreaterThan(0);
  });

  it('falls back to "Google" when there is no provider at all', async () => {
    vi.stubGlobal('fetch', routes({ status: () => status({ canChangePassword: false, hasPassword: true, authMethod: 'unknown', oAuthProviders: [] }) }));
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    expect((await screen.findAllByText(/Google/)).length).toBeGreaterThan(0);
  });

  it('falls back to a client-side check when the status API fails', async () => {
    vi.stubGlobal('fetch', routes({ status: () => jsonResponse({}, 500) }));
    h.checkAuthMethodsClient.mockResolvedValueOnce({ hasEmailPassword: true, hasOAuth: false, oAuthProviders: [], canChangePassword: true, primaryAuthMethod: 'email' });
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    expect(await ready()).toBeInTheDocument();
    expect(h.checkAuthMethodsClient).toHaveBeenCalled();
  });

  it('falls back to the session user when the status request throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', routes({ status: () => Promise.reject(new Error('offline')) }));
    h.user = { id: 'u1', email: 'g@example.com', app_metadata: { provider: 'google', providers: ['google'] }, identities: [{ provider: 'google' }], user_metadata: {} };
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    expect((await screen.findAllByText(/Google/)).length).toBeGreaterThan(0);
    expect(console.error).toHaveBeenCalledWith('Error checking auth methods:', expect.any(Error));
  });

  it('waits without a signed-in user', () => {
    h.user = null;
    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Checking account status...')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
