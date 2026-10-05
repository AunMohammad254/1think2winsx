import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'fan@example.com' } }) }));
vi.mock('@/actions/password-setup-actions', () => ({ requestPasswordSetupEmail: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: async () => 'csrf' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SignInMethodBadge from '@/components/profile/SignInMethodBadge';
import ChangePasswordModal from '@/components/profile/ChangePasswordModal';

const respond = (url: string, body: unknown) => (u: string) =>
    Promise.resolve(
        u.includes(url)
            ? ({ ok: true, json: async () => body } as Response)
            : ({ ok: false, json: async () => ({}) } as Response)
    );

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('<SignInMethodBadge /> on the profile', () => {
    const mount = (detection: unknown) => {
        (fetch as ReturnType<typeof vi.fn>).mockImplementation(respond('/api/profile/auth-method', detection));
        return render(<SignInMethodBadge />);
    };

    it('shows "Verified Google sign-in" for a Google session', async () => {
        mount({ currentMethod: 'google', label: 'Verified Google sign-in', verifiedGoogle: true, hasPassword: false, linkedProviders: ['google'] });
        await waitFor(() => expect(screen.getByTestId('signin-method').textContent).toContain('Verified Google sign-in'));
        expect(screen.queryByText(/Password also set/)).toBeNull();
    });

    it('notes when a Google account also has a password', async () => {
        mount({ currentMethod: 'google', label: 'Verified Google sign-in', verifiedGoogle: true, hasPassword: true, linkedProviders: ['google'] });
        await waitFor(() => expect(screen.getByText('Password also set')).toBeTruthy());
    });

    it('shows "Email & password" after signing in with the password (and that Google is linked)', async () => {
        mount({ currentMethod: 'password', label: 'Email & password', verifiedGoogle: false, hasPassword: true, linkedProviders: ['google'] });
        await waitFor(() => expect(screen.getByTestId('signin-method').textContent).toContain('Email & password'));
        expect(screen.getByText('Google linked')).toBeTruthy();
        expect(screen.getByTestId('signin-method').textContent).not.toContain('Google sign-in');
    });

    it('shows nothing (and does not crash) when detection is unavailable', async () => {
        (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
        render(<SignInMethodBadge />);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(screen.queryByTestId('signin-method')).toBeNull();
    });
});

describe('<ChangePasswordModal /> title - requirements 2 and 4', () => {
    const open = (canChangePassword: boolean, hasPassword = canChangePassword) => {
        (fetch as ReturnType<typeof vi.fn>).mockImplementation(
            respond('/api/profile/can-change-password', {
                canChangePassword,
                hasPassword,
                authMethod: hasPassword ? 'email' : 'oauth',
                oAuthProviders: ['google'],
            })
        );
        return render(<ChangePasswordModal isOpen onClose={() => undefined} />);
    };

    it('says "Set up password" for a Google account without a password', async () => {
        open(false);
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Set up password' })).toBeTruthy());
        expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull();
        expect(screen.getByRole('button', { name: /email me a link to set up a password/i })).toBeTruthy();
    });

    it('says "Set up password" for a GOOGLE session even when the account already has a password', async () => {
        open(false, true); // server: signed in with Google, so the current password is unknown; the account has one
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Set up password' })).toBeTruthy());
        expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull();
        expect(screen.getByText(/we can.t check your current password/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /email me a link to set up a password/i })).toBeTruthy();
    });

    it('says "Change password" for a session that signed in with the password', async () => {
        open(true);
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy());
        expect(screen.queryByRole('heading', { name: 'Set up password' })).toBeNull();
        expect(screen.queryByRole('button', { name: /email me a link/i })).toBeNull();
    });
});
