import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1', email: 'ali@x.com', email_confirmed_at: '2026-01-01', app_metadata: { provider: 'email' } } as Record<string, unknown> | null, isLoading: false },
  profileState: {} as Record<string, unknown>,
  refreshProfile: vi.fn(),
  router: { push: vi.fn() },
  dynamics: [] as { loader: () => Promise<unknown>; opts: { loading: () => React.ReactNode } }[],
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/contexts/ProfileContext', () => ({ useProfile: () => ({ ...h.profileState, refreshProfile: h.refreshProfile }) }));
vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/profile', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>, opts: { loading: () => React.ReactNode }) => {
    h.dynamics.push({ loader, opts });
    return () => <div>prize redemption</div>;
  },
}));
vi.mock('@/components/PrizeRedemption', () => ({ default: () => null }));
vi.mock('@/components/profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/profile')>()),
  ChangePasswordModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (isOpen ? <div>password dialog<button onClick={onClose}>close password</button></div> : null),
  SignInMethodBadge: () => null,
}));

import ProfilePage from '@/app/profile/page';

const prize = (id: string, status?: string) => ({ id, name: `Prize ${id}`, image: `/prizes/${id}.svg`, dateWon: 'd', type: 't', status });
const attempt = (id: string, score: number, questions: number, winnings?: unknown[]) => ({
  id, score, createdAt: '2026-10-01T00:00:00Z', winnings, quiz: { title: `Quiz ${id}`, _count: { questions } },
});
const fullProfile = {
  id: 'abcdef123456', name: 'Ali Raza', email: 'ali@x.com', profilePicture: null, points: 120, walletBalance: 50, quizzesTaken: 7, correctAnswers: 30, winCount: 2,
  createdAt: '2026-01-15T00:00:00Z',
  prizes: [prize('p1', 'pending'), prize('p2', 'approved'), prize('p3', 'FULFILLED'), prize('p4', 'rejected'), prize('p5', 'lost')],
  quizHistory: [attempt('a1', 8, 10, [{}]), attempt('a2', 3, 0), attempt('a3', 1, 5, []), attempt('a4', 1, 5), attempt('a5', 1, 5), attempt('a6', 1, 5), attempt('a7', 1, 5)],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  h.auth = { user: { id: 'u1', email: 'ali@x.com', email_confirmed_at: '2026-01-01', app_metadata: { provider: 'email' } }, isLoading: false };
  h.profileState = { profile: fullProfile, loading: false, error: null };
  h.refreshProfile.mockReset().mockResolvedValue(undefined);
  h.router.push.mockReset();
  fetchMock = vi.fn(async (url: string) => (url.includes('wallet-enabled') ? jsonResponse({ walletEnabled: true }) : jsonResponse({ imageUrl: 'x' })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('profile page', () => {
  it('sends signed-out visitors to login', () => {
    h.auth = { user: null, isLoading: false };
    h.profileState = { profile: null, loading: false, error: null };
    render(<ProfilePage />);
    expect(h.router.push).toHaveBeenCalledWith('/login');
  });

  it('shows loading, error and empty states', () => {
    h.auth = { ...h.auth, isLoading: true };
    const { rerender } = render(<ProfilePage />);
    expect(screen.getByRole('status', { name: 'Loading profile' })).toBeInTheDocument();
    h.auth = { ...h.auth, isLoading: false };
    h.profileState = { profile: null, loading: false, error: 'Profile failed to load' };
    rerender(<ProfilePage />);
    expect(screen.getByText('Profile failed to load')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    h.profileState = { profile: null, loading: false, error: null };
    rerender(<ProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Profile' }));
    expect(h.refreshProfile).toHaveBeenCalledTimes(2);
  });

  it('shows identity, balance, stats, prizes and history', async () => {
    render(<ProfilePage />);
    expect(screen.getAllByText('Ali Raza').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Email verified')).toHaveTextContent('Verified');
    expect(screen.getByText('Jan 2026')).toBeInTheDocument();
    expect(screen.getByText('ID: abcdef123456')).toBeInTheDocument();
    expect(screen.getByText('50.00')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Total Points: 120' })).toBeInTheDocument();
    expect(screen.getByLabelText('5 prizes')).toBeInTheDocument();
    for (const label of ['Pending', 'Approved', 'Fulfilled', 'Rejected']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all 5 prizes →' })).toHaveAttribute('href', '/prizes');
    expect(screen.getByLabelText('7 attempts')).toBeInTheDocument();
    expect(screen.getByText('🏆 Winner')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Quiz a2, score 3 of 0' }).querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('link', { name: 'View all history →' })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/settings/wallet-enabled'));
  });

  it('shows the unknown prize status, missing dates and unverified accounts', () => {
    h.auth = { user: { id: 'u1', provider: 'google' }, isLoading: false };
    h.profileState = { profile: { ...fullProfile, createdAt: undefined, prizes: [prize('p9')] }, loading: false, error: null };
    render(<ProfilePage />);
    expect(screen.getByLabelText('Email not verified yet')).toHaveTextContent('Unverified');
    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    h.profileState = { profile: { ...fullProfile, prizes: [prize('p8', 'lost')] }, loading: false, error: null };
    render(<ProfilePage />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('shows empty prize and history sections, and hides the wallet when it is off', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ walletEnabled: false }));
    h.profileState = { profile: { ...fullProfile, prizes: [], quizHistory: undefined, points: 0, walletBalance: null, quizzesTaken: 0, correctAnswers: 0, winCount: 0 }, loading: false, error: null };
    render(<ProfilePage />);
    expect(screen.getByText('No Prizes Yet')).toBeInTheDocument();
    expect(screen.getByText('No Quiz History')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Total Balance')).toBeNull());
    expect(screen.queryByRole('link', { name: 'Deposit' })).toBeNull();
  });

  it('keeps the wallet visible when the flag cannot be read', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('down'); });
    render(<ProfilePage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText('Total Balance')).toBeInTheDocument();
  });

  it('opens the password dialog from quick actions', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Password' }));
    expect(screen.getByText('password dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'close password' }));
    expect(screen.queryByText('password dialog')).toBeNull();
  });

  it('uploads a new profile picture', async () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Update profile picture' }));
    expect(screen.getByRole('dialog', { name: 'Update Profile Picture' })).toBeInTheDocument();
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
    await waitFor(() => expect(h.refreshProfile).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/profile/upload-picture')!;
    expect((init.body as FormData).get('profilePicture')).toBeInstanceOf(File);
  });

  it('KNOWN BUG: the profile-page upload sends no CSRF token, which the upload route requires', async () => {
    // /api/profile/upload-picture calls requireCSRFToken; ProfileContext.uploadProfilePicture sends
    // the header, but this page posts directly without it, so real uploads from /profile get a 403.
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Update profile picture' }));
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/profile/upload-picture')).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/profile/upload-picture')!;
    expect(init.headers).toBeUndefined();
  });

  it('keeps the upload dialog open when the upload fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementation(async (url: string) => (url.includes('upload') ? jsonResponse({ message: 'Forbidden' }, 403) : jsonResponse({ walletEnabled: true })));
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Update profile picture' }));
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Upload error:', expect.objectContaining({ message: 'Forbidden' })));
    fetchMock.mockImplementation(async (url: string) => (url.includes('upload') ? jsonResponse({}, 500) : jsonResponse({ walletEnabled: true })));
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Upload error:', expect.objectContaining({ message: 'Upload failed' })));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close update profile picture dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lazy-loads prize redemption with a skeleton', async () => {
    render(<ProfilePage />);
    expect(screen.getByText('prize redemption')).toBeInTheDocument();
    const d = h.dynamics.at(-1)!;
    await expect(d.loader()).resolves.toBeTruthy();
    render(<>{d.opts.loading()}</>);
    expect(screen.getByRole('status', { name: 'Loading prizes' })).toBeInTheDocument();
  });
});
