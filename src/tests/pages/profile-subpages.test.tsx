import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1', email: 'ali@x.com' } as Record<string, unknown> | null, isLoading: false },
  profile: { name: 'Ali Raza', email: 'ali@x.com' } as Record<string, unknown> | null,
  updateProfile: vi.fn(),
  router: { push: vi.fn() },
  getCSRFToken: vi.fn(),
  wallet: { submitDepositRequest: vi.fn(), getWalletBalance: vi.fn(), getTransactionHistory: vi.fn() },
  requestPasswordSetupEmail: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/contexts/ProfileContext', () => ({ useProfile: () => ({ profile: h.profile, updateProfile: h.updateProfile, loading: false, error: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/profile', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.getCSRFToken() }));
vi.mock('@/app/profile/wallet/actions', () => ({
  submitDepositRequest: (...a: unknown[]) => h.wallet.submitDepositRequest(...a),
  getWalletBalance: () => h.wallet.getWalletBalance(),
  getTransactionHistory: () => h.wallet.getTransactionHistory(),
}));
vi.mock('@/actions/password-setup-actions', () => ({ requestPasswordSetupEmail: () => h.requestPasswordSetupEmail() }));

import EditProfilePage from '@/app/profile/edit/page';
import WalletPage from '@/app/profile/wallet/page';
import ChangePasswordPage from '@/app/profile/change-password/page';

let fetchMock: ReturnType<typeof vi.fn>;
let timers: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.auth = { user: { id: 'u1', email: 'ali@x.com' }, isLoading: false };
  h.profile = { name: 'Ali Raza', email: 'ali@x.com' };
  h.updateProfile.mockReset().mockResolvedValue(undefined);
  h.router.push.mockReset();
  h.getCSRFToken.mockReset().mockResolvedValue('tok');
  for (const f of Object.values(h.wallet)) f.mockReset();
  fetchMock = vi.fn(async () => jsonResponse({}));
  vi.stubGlobal('fetch', fetchMock);
  timers = vi.spyOn(window, 'setTimeout');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const runTimer = (ms: number) => act(() => { (timers.mock.calls.find(([, d]: unknown[]) => d === ms)![0] as () => void)(); });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('edit profile page', () => {
  it('sends signed-out visitors to login, and waits for auth', () => {
    h.auth = { user: null, isLoading: true };
    const { container, rerender } = render(<EditProfilePage />);
    expect(container.querySelector('.border-purple-400')).not.toBeNull();
    h.auth = { user: null, isLoading: false };
    rerender(<EditProfilePage />);
    expect(h.router.push).toHaveBeenCalledWith('/login');
  });

  it('prefills, validates and saves the profile', async () => {
    render(<EditProfilePage />);
    expect(screen.getByLabelText('Full Name')).toHaveValue('Ali Raza');
    type('Full Name', 'A');
    fireEvent.submit(screen.getByRole('button', { name: 'Update Profile' }).closest('form')!);
    expect(await screen.findByText('Name must be at least 2 characters long')).toBeInTheDocument();
    type('Full Name', '  Ali   Khan  ');
    expect(screen.queryByText(/Name must be/)).toBeNull();
    fireEvent.submit(screen.getByRole('button', { name: 'Update Profile' }).closest('form')!);
    expect(await screen.findByText('Profile updated successfully!')).toBeInTheDocument();
    expect(h.updateProfile).toHaveBeenCalledWith({ name: 'Ali Khan', email: 'ali@x.com' });
    type('Email Address', 'ali.raza@x.com'); // a real change (same value fires no change event)
    expect(screen.queryByText('Profile updated successfully!')).toBeNull();
    runTimer(2000);
    expect(h.router.push).toHaveBeenCalledWith('/profile');
  });

  it('reports save failures and copes with missing profile fields', async () => {
    h.profile = { name: null, email: null };
    h.updateProfile.mockRejectedValueOnce(new Error('Email already in use')).mockRejectedValueOnce('odd');
    render(<EditProfilePage />);
    expect(screen.getByLabelText('Full Name')).toHaveValue('');
    type('Full Name', 'Sara Khan');
    type('Email Address', 'sara@x.com');
    fireEvent.submit(screen.getByRole('button', { name: 'Update Profile' }).closest('form')!);
    expect(await screen.findByText('Email already in use')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('button', { name: 'Update Profile' }).closest('form')!);
    expect(await screen.findByText('Failed to update profile')).toBeInTheDocument();
  });

  it('shows a busy button, and renders before the profile loads', async () => {
    h.updateProfile.mockReturnValueOnce(new Promise(() => {}));
    h.profile = null;
    render(<EditProfilePage />);
    type('Full Name', 'Sara Khan');
    type('Email Address', 'sara@x.com');
    fireEvent.submit(screen.getByRole('button', { name: 'Update Profile' }).closest('form')!);
    expect(await screen.findByRole('button', { name: /Updating/ })).toBeDisabled();
  });
});

describe('wallet page', () => {
  const tx = (id: string, over: Record<string, unknown>) => ({ id, userId: 'u', amount: 100, paymentMethod: 'Easypaisa', transactionId: `T${id}`, status: 'pending', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...over });

  beforeEach(() => {
    fetchMock.mockImplementation(async () => jsonResponse({ walletEnabled: true }));
    h.wallet.getWalletBalance.mockResolvedValue({ success: true, balance: 250 });
    h.wallet.getTransactionHistory.mockResolvedValue({ success: true, transactions: [tx('1', {}), tx('2', { amount: -2, paymentMethod: 'QuizAccess' }), tx('3', { status: 'approved' })] });
  });

  it('waits for auth, then sends signed-out visitors to login', () => {
    h.auth = { user: null, isLoading: true };
    const { rerender } = render(<WalletPage />);
    expect(h.router.push).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    h.auth = { user: null, isLoading: false };
    rerender(<WalletPage />);
    expect(h.router.push).toHaveBeenCalledWith('/login');
  });

  it('loads the balance and summarises pending items', async () => {
    render(<WalletPage />);
    expect(screen.getByRole('status', { name: 'Loading wallet' })).toBeInTheDocument();
    expect(await screen.findByText('1 deposit · 1 deduction')).toBeInTheDocument();
    expect(screen.getByText('Available balance: 250.00 PKR.')).toBeInTheDocument();
    expect(screen.getByText('· 102 PKR')).toBeInTheDocument();
    expect(screen.getByLabelText('3 total transactions')).toBeInTheDocument();
  });

  it('shows plural counts, no pending items, and survives failed loads', async () => {
    h.wallet.getTransactionHistory.mockResolvedValueOnce({ success: true, transactions: [tx('1', {}), tx('4', {}), tx('5', { amount: -1 }), tx('6', { amount: -1 })] });
    const { unmount } = render(<WalletPage />);
    expect(await screen.findByText('2 deposits · 2 deductions')).toBeInTheDocument();
    unmount();
    h.wallet.getWalletBalance.mockResolvedValueOnce({ success: false });
    h.wallet.getTransactionHistory.mockResolvedValueOnce({ success: false });
    const second = render(<WalletPage />);
    expect(await screen.findByText('No pending items')).toBeInTheDocument();
    expect(screen.getByText('Available balance: 0.00 PKR.')).toBeInTheDocument();
    second.unmount();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.wallet.getWalletBalance.mockRejectedValueOnce(new Error('db'));
    render(<WalletPage />);
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Error loading wallet data:', expect.any(Error)));
  });

  it('defaults missing balances and histories to empty', async () => {
    h.wallet.getWalletBalance.mockResolvedValueOnce({ success: true });
    h.wallet.getTransactionHistory.mockResolvedValueOnce({ success: true });
    render(<WalletPage />);
    expect(await screen.findByText('No pending items')).toBeInTheDocument();
  });

  it('shows "unavailable" when the wallet is switched off, and assumes on if the flag fails', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ walletEnabled: false }));
    const { unmount } = render(<WalletPage />);
    expect(await screen.findByText('Service Unavailable')).toBeInTheDocument();
    unmount();
    fetchMock.mockImplementationOnce(async () => { throw new Error('down'); });
    render(<WalletPage />);
    expect(await screen.findByText('1 deposit · 1 deduction')).toBeInTheDocument();
  });

  it('submits a deposit and reloads the wallet', async () => {
    h.wallet.submitDepositRequest.mockResolvedValueOnce({ success: false, error: 'Duplicate ID' }).mockResolvedValueOnce({ success: true });
    render(<WalletPage />);
    await screen.findByText('1 deposit · 1 deduction');
    fireEvent.change(screen.getByLabelText('Amount (PKR)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Transaction ID / Reference Number'), { target: { value: 'TX9' } });
    fireEvent.change(screen.getByLabelText(/Proof of Payment/), { target: { files: [new File(['x'], 'p.png')] } });
    fireEvent.submit(screen.getByRole('form', { name: 'Deposit form' }));
    expect(await screen.findByText('Duplicate ID')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: 'Deposit form' }));
    expect(await screen.findByText('Deposit request submitted successfully!')).toBeInTheDocument();
    expect(h.wallet.getWalletBalance).toHaveBeenCalledTimes(2);
  });
});

describe('change password page', () => {
  const canChange = (over: Record<string, unknown> = {}) =>
    fetchMock.mockImplementation(async (url: string) => (url === '/api/profile/can-change-password'
      ? jsonResponse({ canChangePassword: true, hasPassword: true, authMethod: 'email', oAuthProviders: [], ...over })
      : jsonResponse({ ok: true })));
  const fill = (current: string, next: string, confirm = next) => {
    type('Current Password', current);
    type('New Password', next);
    type('Confirm New Password', confirm);
  };
  const submit = () => fireEvent.submit(screen.getByRole('button', { name: /Change Password/ }).closest('form')!);

  it('sends signed-out visitors to login with a return path', () => {
    h.auth = { user: null, isLoading: false };
    render(<ChangePasswordPage />);
    expect(h.router.push).toHaveBeenCalledWith('/login?callbackUrl=/profile/change-password');
  });

  it('waits for auth before showing anything', () => {
    h.auth = { user: null, isLoading: true };
    const { container } = render(<ChangePasswordPage />);
    expect(container.querySelector('.border-purple-400')).not.toBeNull();
  });

  it('changes the password for a password session', async () => {
    canChange();
    render(<ChangePasswordPage />);
    expect(await screen.findByText('Change password')).toBeInTheDocument();
    fill('Old@1234', 'New@5678');
    submit();
    expect(await screen.findByText('Password changed successfully!')).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/profile/change-password')!;
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(JSON.parse(init.body)).toEqual({ currentPassword: 'Old@1234', newPassword: 'New@5678' });
    expect(screen.getByLabelText('Current Password')).toHaveValue('');
    type('Current Password', 'x');
    expect(screen.queryByText('Password changed successfully!')).toBeNull();
    runTimer(2000);
    expect(h.router.push).toHaveBeenCalledWith('/profile');
  });

  it('validates, and reports server and network failures', async () => {
    canChange();
    render(<ChangePasswordPage />);
    await screen.findByText('Change password');
    fill('Old@1234', 'weak');
    submit();
    expect(await screen.findByText(/New password must be at least 8 characters long/)).toBeInTheDocument();
    type('New Password', 'New@5678');
    expect(screen.queryByText(/New password must be at least 8/)).toBeNull();
    type('Confirm New Password', 'New@5678');
    fetchMock.mockImplementationOnce(async () => jsonResponse({ message: 'Current password is incorrect' }, 400));
    h.getCSRFToken.mockResolvedValueOnce(null);
    submit();
    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(fetchMock.mock.calls.at(-1)![1].headers['X-CSRF-Token']).toBe('');
    fetchMock.mockImplementationOnce(async () => jsonResponse({}, 500));
    submit();
    expect(await screen.findByText('Failed to change password')).toBeInTheDocument();
    fetchMock.mockImplementationOnce(async () => { throw 'odd'; });
    submit();
    expect(await screen.findByText('An unexpected error occurred')).toBeInTheDocument();
  });

  it('sends passwords exactly as typed, keeping outer and inner spaces', async () => {
    canChange();
    render(<ChangePasswordPage />);
    await screen.findByText('Change password');
    fill(' Old@1234', ' My  Pass@1 ');
    submit();
    expect(await screen.findByText('Password changed successfully!')).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/profile/change-password')!;
    expect(JSON.parse(init.body)).toEqual({ currentPassword: ' Old@1234', newPassword: ' My  Pass@1 ' });
  });

  it('compares the confirmation as typed, so a stray space no longer matches', async () => {
    canChange();
    render(<ChangePasswordPage />);
    await screen.findByText('Change password');
    fill('Old@1234', 'New@5678', 'New@5678 ');
    submit();
    expect(await screen.findByText('New password and confirmation do not match')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/profile/change-password')).toBe(false);
  });

  it('reveals each password field', async () => {
    canChange();
    render(<ChangePasswordPage />);
    await screen.findByText('Change password');
    for (const label of ['Current Password', 'New Password', 'Confirm New Password']) {
      const input = screen.getByLabelText(label);
      const toggle = input.parentElement!.querySelector('button')!;
      fireEvent.click(toggle);
      expect(input).toHaveAttribute('type', 'text');
      fireEvent.click(toggle);
      expect(input).toHaveAttribute('type', 'password');
    }
  });

  it('shows a busy button while changing', async () => {
    canChange();
    render(<ChangePasswordPage />);
    await screen.findByText('Change password');
    fill('Old@1234', 'New@5678');
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    submit();
    expect(await screen.findByRole('button', { name: /Changing Password/ })).toBeDisabled();
  });

  it('offers the set-password email to Google sessions', async () => {
    canChange({ canChangePassword: false, hasPassword: false, authMethod: 'oauth', oAuthProviders: ['google'] });
    render(<ChangePasswordPage />);
    expect(await screen.findByText('Set up password')).toBeInTheDocument();
    expect(screen.getAllByText(/Google/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Current Password')).toBeNull();
  });

  it('falls back to the session user when the status check fails', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}, 500));
    h.auth = { user: { id: 'u1', email: 'g@x.com', app_metadata: { provider: 'google', providers: ['google'] }, identities: [{ provider: 'google' }], user_metadata: {} }, isLoading: false };
    const { unmount } = render(<ChangePasswordPage />);
    expect(await screen.findByText('Set up password')).toBeInTheDocument();
    unmount();
    fetchMock.mockImplementation(async () => { throw new Error('offline'); });
    canChange({ canChangePassword: false, hasPassword: true, authMethod: 'oauth', oAuthProviders: 'not-a-list' });
    render(<ChangePasswordPage />);
    expect((await screen.findAllByText(/Google/)).length).toBeGreaterThan(0);
  });
});
