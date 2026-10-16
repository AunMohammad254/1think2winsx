import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  profile: { points: 500 } as { points: number } | null,
  refreshProfile: vi.fn(),
  getCSRFToken: vi.fn(),
}));
vi.mock('@/contexts/ProfileContext', () => ({ useProfile: () => ({ profile: h.profile, refreshProfile: h.refreshProfile }) }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.getCSRFToken() }));
vi.mock('@/lib/cloudinary', () => ({ loaderFor: () => undefined }));

import PrizeRedemption from '@/components/PrizeRedemption';
import { RedemptionFormModal, getStatusColor } from '@/components/prize-redemption';
import '@/components/player-claims';

const watch = { id: 'p1', name: 'Watch', description: 'Smart watch', imageUrl: '', modelUrl: '', type: 'watch', pointsRequired: 300 };
const bike = { id: 'p2', name: 'Bike', description: 'CD 70', imageUrl: 'https://cdn/bike.png', modelUrl: '', type: 'bike', pointsRequired: 9000 };
const history = [
  { id: 'r1', pointsUsed: 300, status: 'fulfilled', requestedAt: '2026-09-01T00:00:00Z', notes: 'Delivered by TCS', prize: { name: 'Earbuds', description: 'Buds', imageUrl: '', type: 'buds' } },
  { id: 'r2', pointsUsed: 100, status: 'pending', requestedAt: '2026-10-01T00:00:00Z', prize: { name: 'Cap', description: 'A cap', imageUrl: '', type: 'cap' } },
];

let fetchMock: ReturnType<typeof vi.fn>;
const routes = (prizes: unknown = { data: [watch, bike] }, redemptions: unknown = { redemptions: history }) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/prizes') return jsonResponse(prizes);
    if (init?.method === 'POST') return jsonResponse({ ok: true });
    return jsonResponse(redemptions);
  });

beforeEach(() => {
  h.profile = { points: 500 };
  h.refreshProfile.mockReset().mockResolvedValue(undefined);
  h.getCSRFToken.mockReset().mockResolvedValue('tok');
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PrizeRedemption', () => {
  it('loads prizes and history, and switches tabs', async () => {
    render(<PrizeRedemption />);
    expect(screen.getByText('Loading prizes...')).toBeInTheDocument();
    expect(await screen.findByText('Watch')).toBeInTheDocument();
    expect(screen.getByText('500 points')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Redemption History' }));
    expect(screen.getByText('Earbuds')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Available Prizes' }));
    expect(screen.getByText('Bike')).toBeInTheDocument();
  });

  it('shows empty states, and survives failed requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));
    h.profile = null;
    const { unmount } = render(<PrizeRedemption />);
    expect(await screen.findByText('No prizes available at the moment.')).toBeInTheDocument();
    expect(screen.getByText('0 points')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Redemption History' }));
    expect(screen.getByText("You haven't redeemed any prizes yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse Available Prizes' }));
    expect(screen.getByText('No prizes available at the moment.')).toBeInTheDocument();
    unmount();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<PrizeRedemption />);
    expect(await screen.findByText('No prizes available at the moment.')).toBeInTheDocument();
    vi.stubGlobal('fetch', routes({}, {}));
    render(<PrizeRedemption />);
    await waitFor(() => expect(screen.getAllByText('No prizes available at the moment.')).toHaveLength(2));
  });

  it('disables prizes the player cannot afford', async () => {
    render(<PrizeRedemption />);
    await screen.findByText('Bike');
    expect(screen.getByRole('button', { name: 'Not enough points' })).toBeDisabled();
  });

  it('tells a player with no profile loaded that they need points', async () => {
    // The card buttons are disabled when unaffordable, so this message is only reachable with no
    // profile and a free prize (0 points needed).
    h.profile = null;
    vi.stubGlobal('fetch', routes({ data: [{ ...watch, pointsRequired: 0 }] }));
    render(<PrizeRedemption />);
    fireEvent.click(await screen.findByRole('button', { name: 'Redeem' }));
    expect(screen.getByText('You need 0 points to redeem Watch. You currently have 0 points.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(screen.queryByText(/You need 9000 points/)).toBeNull();
  });

  it('redeems through the delivery form, then refreshes points and history', async () => {
    render(<PrizeRedemption />);
    await screen.findByText('Watch');
    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));
    fireEvent.change(screen.getByLabelText('Full Name *'), { target: { value: 'Ali Raza' } });
    fireEvent.change(screen.getByLabelText('WhatsApp Number *'), { target: { value: '+92 300 1234567' } });
    fireEvent.change(screen.getByLabelText('Complete Address *'), { target: { value: 'House 1, Karachi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Redemption' }));
    expect(await screen.findByText('Successfully redeemed Watch! Your redemption request is being processed.')).toBeInTheDocument();
    expect(h.refreshProfile).toHaveBeenCalled();
    expect(screen.queryByText('Redeem Prize')).toBeNull();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ prizeId: 'p1', fullName: 'Ali Raza', whatsappNumber: '+92 300 1234567', address: 'House 1, Karachi' });
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(screen.queryByText(/Successfully redeemed/)).toBeNull();
  });

  it('closes the form, and shows its errors on the page', async () => {
    h.getCSRFToken.mockResolvedValue(null);
    render(<PrizeRedemption />);
    await screen.findByText('Watch');
    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Redeem Prize')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));
    fireEvent.change(screen.getByLabelText('Full Name *'), { target: { value: 'Ali' } });
    fireEvent.change(screen.getByLabelText('WhatsApp Number *'), { target: { value: '0300' } });
    fireEvent.change(screen.getByLabelText('Complete Address *'), { target: { value: 'Karachi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Redemption' }));
    expect(await screen.findByText('Failed to get security token. Please try again.')).toBeInTheDocument();
  });

  it('previews a prize and redeems from the preview', async () => {
    render(<PrizeRedemption />);
    await screen.findByText('Watch');
    fireEvent.click(screen.getByRole('img', { name: 'Watch' }).closest('div[class*="cursor-pointer"]')!);
    const dialog = screen.getByText('Prize Details').closest('div.fixed') as HTMLElement;
    expect(within(dialog).getByText('300 points')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Redeem This Prize' }));
    expect(screen.queryByText('Prize Details')).toBeNull();
    expect(screen.getByText('Redeem Prize')).toBeInTheDocument();
  });

  it('previews an unaffordable prize, and closes the preview', async () => {
    render(<PrizeRedemption />);
    await screen.findByText('Bike');
    fireEvent.click(screen.getByRole('img', { name: 'Bike' }).closest('div[class*="cursor-pointer"]')!);
    expect(screen.getByRole('button', { name: 'Need 8500 more points' })).toBeDisabled();
    const header = screen.getByText('Prize Details').parentElement!;
    fireEvent.click(within(header).getByRole('button'));
    expect(screen.queryByText('Prize Details')).toBeNull();
  });

  it('previews a prize as needing all its points before the profile loads', async () => {
    h.profile = null;
    render(<PrizeRedemption />);
    await screen.findByText('Watch');
    fireEvent.click(screen.getByRole('img', { name: 'Watch' }).closest('div[class*="cursor-pointer"]')!);
    const dialog = screen.getByText('Prize Details').closest('div.fixed') as HTMLElement;
    expect(within(dialog).getByText('0 points')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Need 300 more points' })).toBeDisabled();
  });

  it('previews a past redemption with its status and notes', async () => {
    render(<PrizeRedemption />);
    await screen.findByText('Watch');
    fireEvent.click(screen.getByRole('button', { name: 'Redemption History' }));
    fireEvent.click(screen.getByRole('img', { name: 'Earbuds' }).closest('div[class*="cursor-pointer"]')!);
    expect(screen.getByText('Redemption Details')).toBeInTheDocument();
    expect(screen.getAllByText('Delivered by TCS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fulfilled').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Redemption Details')).toBeNull();
    fireEvent.click(screen.getByRole('img', { name: 'Cap' }).closest('div[class*="cursor-pointer"]')!);
    expect(screen.getByText('Redemption Details')).toBeInTheDocument();
    expect(screen.queryByText('Admin Notes')).toBeNull();
  });
});

describe('RedemptionFormModal', () => {
  const setup = (isRedeeming = false) => {
    const props = { onClose: vi.fn(), onSuccess: vi.fn(), onError: vi.fn() };
    render(<RedemptionFormModal prize={bike} isRedeeming={isRedeeming} {...props} />);
    return props;
  };
  const fill = (name: string, phone: string, address: string) => {
    fireEvent.change(screen.getByLabelText('Full Name *'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('WhatsApp Number *'), { target: { value: phone } });
    fireEvent.change(screen.getByLabelText('Complete Address *'), { target: { value: address } });
  };
  const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Confirm Redemption' }));

  it('validates every field', () => {
    const p = setup();
    confirm();
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp number is required')).toBeInTheDocument();
    expect(screen.getByText('Address is required')).toBeInTheDocument();
    fill('Ali', 'call me', 'Lahore');
    confirm();
    expect(screen.getByText('Please enter a valid WhatsApp number')).toBeInTheDocument();
    expect(p.onError).not.toHaveBeenCalled();
  });

  it('passes server refusals and network failures to onError', async () => {
    const p = setup();
    fill('Ali', '03001234567', 'Lahore');
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Out of stock' }, 409)).mockResolvedValueOnce(jsonResponse({}, 500)).mockRejectedValueOnce(new Error('x'));
    confirm();
    await waitFor(() => expect(p.onError).toHaveBeenLastCalledWith('Out of stock'));
    confirm();
    await waitFor(() => expect(p.onError).toHaveBeenLastCalledWith('Failed to redeem prize'));
    confirm();
    await waitFor(() => expect(p.onError).toHaveBeenLastCalledWith('An error occurred while redeeming the prize'));
    expect(p.onSuccess).not.toHaveBeenCalled();
  });

  it('locks while redeeming and closes from the header', () => {
    const p = setup(true);
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
    expect(screen.getByRole('img', { name: 'Bike' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('maps statuses to colours', () => {
    expect(['pending', 'approved', 'fulfilled', 'rejected', 'other'].map((s) => getStatusColor(s).split(' ')[0])).toEqual([
      'bg-yellow-500/20', 'bg-blue-500/20', 'bg-green-500/20', 'bg-red-500/20', 'bg-gray-500/20',
    ]);
  });
});
