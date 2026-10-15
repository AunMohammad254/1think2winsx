import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  profile: { points: 1500 } as { points: number } | null,
  refreshProfile: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  getPublicPrizes: vi.fn(),
  redeemPrize: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/contexts/ProfileContext', () => ({ useProfile: () => ({ profile: h.profile, refreshProfile: h.refreshProfile }) }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/prizes', () => ({
  getPublicPrizes: (...a: unknown[]) => h.getPublicPrizes(...a),
  redeemPrize: (...a: unknown[]) => h.redeemPrize(...a),
}));
// eslint-disable-next-line @next/next/no-img-element -- stand-in for CldImage
vi.mock('next-cloudinary', () => ({ CldImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  ...(await import('@/tests/helpers/motion-mock')).motionPassthrough,
}));

import PrizesPage from '@/app/prizes/page';

const prize = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Prize ${id}`, description: 'desc', imageUrl: null, modelUrl: null, type: 'phone', pointsRequired: 1000, isActive: true,
  category: 'electronics', stock: 5, status: 'published', value: 0, createdAt: new Date(), updatedAt: new Date(), ...over,
});

beforeEach(() => {
  h.user = { id: 'u1' };
  h.profile = { points: 1500 };
  h.refreshProfile.mockReset();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.getPublicPrizes.mockReset().mockResolvedValue({ success: true, data: [prize('a'), prize('b', { pointsRequired: 5000 })] });
  h.redeemPrize.mockReset().mockResolvedValue({ success: true });
});
afterEach(() => vi.restoreAllMocks());

const fillAndSubmit = () => {
  fireEvent.change(screen.getByPlaceholderText('Enter your full name'), { target: { value: 'Ali Raza' } });
  fireEvent.change(screen.getByPlaceholderText('03XX-XXXXXXX'), { target: { value: '03001234567' } });
  fireEvent.change(screen.getByPlaceholderText('Enter your complete address with city'), { target: { value: 'Karachi' } });
  fireEvent.submit(screen.getByRole('button', { name: /Confirm Redemption|Processing/ }).closest('form')!);
};

describe('prizes page', () => {
  it('loads prizes, shows the player points, and refilters', async () => {
    render(<PrizesPage />);
    expect(await screen.findByText('Prize a')).toBeInTheDocument();
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(h.getPublicPrizes).toHaveBeenCalledWith('all', 'points-asc');
    fireEvent.click(screen.getByRole('button', { name: /Vehicles/ }));
    await waitFor(() => expect(h.getPublicPrizes).toHaveBeenLastCalledWith('vehicles', 'points-asc'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'newest' } });
    await waitFor(() => expect(h.getPublicPrizes).toHaveBeenLastCalledWith('vehicles', 'newest'));
  });

  it('explains an empty list per category, and load failures', async () => {
    h.getPublicPrizes.mockResolvedValue({ success: true, data: [] });
    render(<PrizesPage />);
    expect(await screen.findByText('Check back later for new prizes!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Vehicles/ }));
    expect(await screen.findByText('Try selecting a different category')).toBeInTheDocument();
    h.getPublicPrizes.mockResolvedValueOnce({ success: false, error: 'DB down' });
    fireEvent.click(screen.getByRole('button', { name: /Accessories/ }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('DB down'));
    h.getPublicPrizes.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByRole('button', { name: /General/ }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to load prizes'));
    h.getPublicPrizes.mockRejectedValueOnce(new Error('x'));
    fireEvent.click(screen.getByRole('button', { name: /All Prizes/ }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
  });

  it('asks visitors to log in before redeeming', async () => {
    h.user = null;
    h.profile = null;
    h.getPublicPrizes.mockResolvedValue({ success: true, data: [prize('free', { pointsRequired: 0 })] });
    render(<PrizesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Redeem Now/ }));
    expect(h.toast.error).toHaveBeenCalledWith('Please log in to redeem prizes');
    expect(screen.queryByText('Redeem Prize')).toBeNull();
  });

  it('redeems a prize and refreshes points and stock', async () => {
    render(<PrizesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Redeem Now/ }));
    expect(screen.getByText('Redeem Prize')).toBeInTheDocument();
    fillAndSubmit();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('🎉 Prize redeemed successfully! We will contact you soon.'));
    expect(h.redeemPrize).toHaveBeenCalledWith('u1', { prizeId: 'a', fullName: 'Ali Raza', whatsappNumber: '03001234567', address: 'Karachi' });
    expect(h.refreshProfile).toHaveBeenCalled();
    expect(screen.queryByText('Redeem Prize')).toBeNull();
    expect(h.getPublicPrizes).toHaveBeenCalledTimes(2);
  });

  it('rolls back the stock when redemption fails', async () => {
    h.redeemPrize.mockResolvedValueOnce({ success: false, error: 'Not enough points' }).mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error('x'));
    render(<PrizesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Redeem Now/ }));
    fillAndSubmit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Not enough points'));
    fillAndSubmit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to redeem prize'));
    fillAndSubmit();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('Only 4 left!')).toBeNull();
  });

  it('closes the modal from the backdrop and the close button, and shows progress', async () => {
    h.redeemPrize.mockReturnValueOnce(new Promise(() => {}));
    const { container } = render(<PrizesPage />);
    const open = async () => fireEvent.click(await screen.findByRole('button', { name: /Redeem Now/ }));
    await open();
    fireEvent.click(screen.getByText('Redeem Prize'));
    expect(screen.getByText('Redeem Prize')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Redeem Prize').closest('.fixed')!);
    expect(screen.queryByText('Redeem Prize')).toBeNull();
    await open();
    fireEvent.click(screen.getByText('Redeem Prize').closest('.fixed')!.querySelector('button')!);
    expect(screen.queryByText('Redeem Prize')).toBeNull();
    await open();
    fillAndSubmit();
    // both the prize card and the modal's submit show the busy state
    const busy = await screen.findAllByRole('button', { name: /Processing/ });
    expect(busy).toHaveLength(2);
    busy.forEach((b) => expect(b).toBeDisabled());
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});
