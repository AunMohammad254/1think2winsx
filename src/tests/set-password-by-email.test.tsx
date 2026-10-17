import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const requestPasswordSetupEmail = vi.fn();
vi.mock('@/actions/password-setup-actions', () => ({
    requestPasswordSetupEmail: (...a: unknown[]) => requestPasswordSetupEmail(...a),
}));
vi.mock('@/components/auth/TurnstileWidget', async () => ({ default: (await import('@/tests/helpers/turnstile-mock')).TurnstileMock }));

import SetPasswordByEmail from '@/components/profile/SetPasswordByEmail';
import { turnstile, resetTurnstileMock } from '@/tests/helpers/turnstile-mock';

beforeEach(() => {
    vi.clearAllMocks();
    resetTurnstileMock();
});

describe('<SetPasswordByEmail /> (Google-only accounts)', () => {
    it('offers to set a password and never shows the old dead-end wording', () => {
        render(<SetPasswordByEmail providerLabel="Google" />);

        expect(screen.getByText('Google')).toBeTruthy();
        expect(screen.getByRole('button', { name: /email me a link to set up a password/i })).toBeTruthy();
        expect(screen.queryByText(/Password Change Not Available/i)).toBeNull();
        expect(screen.queryByText(/manage your password through/i)).toBeNull();
    });

    it('explains the situation when the account already has a password but the session is Google', () => {
        render(<SetPasswordByEmail providerLabel="Google" hasPassword />);
        expect(screen.getByText(/we can.t check your current password/i)).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    });

    it('sends the email when the button is clicked and confirms where it went', async () => {
        requestPasswordSetupEmail.mockResolvedValue({ success: true, email: 'fan@example.com' });
        render(<SetPasswordByEmail providerLabel="Google" />);

        fireEvent.click(screen.getByRole('button', { name: /email me a link/i }));

        await waitFor(() => expect(screen.getByText('fan@example.com')).toBeTruthy());
        expect(requestPasswordSetupEmail).toHaveBeenCalledTimes(1);
        expect(requestPasswordSetupEmail).toHaveBeenCalledWith('captcha-token');
        expect(screen.queryByRole('button', { name: /email me a link/i })).toBeNull(); // no double-send
    });

    it('shows the error and keeps the button when sending fails', async () => {
        requestPasswordSetupEmail.mockResolvedValue({ error: "We couldn't send the email right now." });
        render(<SetPasswordByEmail providerLabel="Google" />);

        fireEvent.click(screen.getByRole('button', { name: /email me a link/i }));

        await waitFor(() => expect(screen.getByText(/couldn't send the email/i)).toBeTruthy());
        expect(screen.getByRole('button', { name: /email me a link/i })).toBeTruthy(); // can retry
        expect(turnstile.resets).toBe(1); // with a fresh token
    });

    it('keeps the button disabled until the security check passes', () => {
        turnstile.token = null;
        render(<SetPasswordByEmail providerLabel="Google" />);
        expect(screen.getByTestId('turnstile-password_setup')).toBeTruthy();
        expect((screen.getByRole('button', { name: /email me a link/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows a thrown error and still replaces the used token', async () => {
        requestPasswordSetupEmail.mockRejectedValue(new Error('network'));
        render(<SetPasswordByEmail providerLabel="Google" />);
        fireEvent.click(screen.getByRole('button', { name: /email me a link/i }));
        await waitFor(() => expect(screen.getByText('An error occurred. Please try again.')).toBeTruthy());
        expect(turnstile.resets).toBe(1);
    });
});
