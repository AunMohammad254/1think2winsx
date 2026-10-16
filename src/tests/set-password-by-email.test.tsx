import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const requestPasswordSetupEmail = vi.fn();
vi.mock('@/actions/password-setup-actions', () => ({
    requestPasswordSetupEmail: (...a: unknown[]) => requestPasswordSetupEmail(...a),
}));

import SetPasswordByEmail from '@/components/profile/SetPasswordByEmail';

beforeEach(() => {
    vi.clearAllMocks();
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
        expect(screen.queryByRole('button', { name: /email me a link/i })).toBeNull(); // no double-send
    });

    it('shows the error and keeps the button when sending fails', async () => {
        requestPasswordSetupEmail.mockResolvedValue({ error: "We couldn't send the email right now." });
        render(<SetPasswordByEmail providerLabel="Google" />);

        fireEvent.click(screen.getByRole('button', { name: /email me a link/i }));

        await waitFor(() => expect(screen.getByText(/couldn't send the email/i)).toBeTruthy());
        expect(screen.getByRole('button', { name: /email me a link/i })).toBeTruthy(); // can retry
    });
});
