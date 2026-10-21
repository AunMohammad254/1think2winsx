import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(() => 't1') },
  getCloudinaryLeftovers: vi.fn(),
  migrateAllAssetsAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/supabase-media-actions', () => ({
  getCloudinaryLeftovers: (...a: unknown[]) => h.getCloudinaryLeftovers(...a),
  migrateAllAssetsAction: (...a: unknown[]) => h.migrateAllAssetsAction(...a),
}));

import StorageProviderControl from '@/components/admin/media/StorageProviderControl';

const stats = (prizes: number, avatars: number) => ({ success: true, data: { prizes, avatars, total: prizes + avatars } });
const moved = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    prizesMigrated: 2,
    prizesFailed: 0,
    avatarsMigrated: 1,
    avatarsFailed: 0,
    totalMigrated: 3,
    totalFailed: 0,
    details: { prizes: [], avatars: [] },
    message: 'Moved 3 image(s) to Supabase Storage.',
    ...over,
  },
});

beforeEach(() => {
  for (const fn of [h.getCloudinaryLeftovers, h.migrateAllAssetsAction, ...Object.values(h.toast)]) fn.mockClear();
  h.getCloudinaryLeftovers.mockReset().mockResolvedValue(stats(2, 1));
  h.migrateAllAssetsAction.mockReset();
});

describe('StorageProviderControl', () => {
  it('says Supabase is primary and counts what still loads from Cloudinary', async () => {
    h.getCloudinaryLeftovers.mockResolvedValueOnce(stats(1, 0));
    render(<StorageProviderControl />);
    expect(screen.getByRole('heading', { name: 'Primary storage' })).toBeInTheDocument();
    expect(screen.getByText(/Supabase Storage · primary/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking for images on Cloudinary...');
    expect(await screen.findByText('1 prize image and 0 profile pictures still load from Cloudinary.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move 1 image to Supabase' })).toBeInTheDocument();
  });

  it('shows nothing to move once everything is on Supabase, and keeps checking on a failed count', async () => {
    h.getCloudinaryLeftovers.mockResolvedValueOnce(stats(0, 0));
    const { unmount } = render(<StorageProviderControl />);
    expect(await screen.findByText('Every prize image and profile picture loads from Supabase Storage.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move/ })).toBeNull();
    unmount();

    h.getCloudinaryLeftovers.mockResolvedValueOnce({ success: false, error: 'Unauthorized' });
    render(<StorageProviderControl />);
    await waitFor(() => expect(h.getCloudinaryLeftovers).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('Checking for images on Cloudinary...');
  });

  it('asks first, then moves everything, refreshes the page and the count', async () => {
    const onRefresh = vi.fn();
    h.migrateAllAssetsAction.mockResolvedValue(moved());
    render(<StorageProviderControl onRefresh={onRefresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move 3 images to Supabase' }));
    expect(screen.getByRole('dialog', { name: 'Move 3 images to Supabase Storage?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.migrateAllAssetsAction).not.toHaveBeenCalled();

    h.getCloudinaryLeftovers.mockResolvedValue(stats(0, 0));
    fireEvent.click(screen.getByRole('button', { name: 'Move 3 images to Supabase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move them' }));
    expect(h.toast.loading).toHaveBeenCalledWith('Moving images from Cloudinary to Supabase Storage...');
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Moved 3 image(s) to Supabase Storage.', { id: 't1' }));
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText('Prize images moved: 2 · Profile pictures moved: 1')).toBeInTheDocument();
    expect(await screen.findByText('Every prize image and profile picture loads from Supabase Storage.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close summary' }));
    expect(screen.queryByText(/Prize images moved/)).toBeNull();
  });

  it('lists what could not be moved', async () => {
    h.migrateAllAssetsAction.mockResolvedValue(moved({
      prizesMigrated: 1,
      prizesFailed: 1,
      avatarsMigrated: 0,
      avatarsFailed: 1,
      totalMigrated: 1,
      totalFailed: 2,
      details: {
        prizes: [{ prizeId: 'p1', name: 'Bike', from: 'a', to: 'b' }, { prizeId: 'p2', name: 'Phone', from: 'c', error: 'Cloudinary answered 404' }],
        avatars: [{ userId: 'u1', name: 'Ali', from: 'd', error: 'The profile picture was changed meanwhile, so it was left alone' }],
      },
      message: 'Moved 1 image(s); 2 could not be moved and still load from Cloudinary.',
    }));
    render(<StorageProviderControl />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move 3 images to Supabase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move them' }));
    await waitFor(() => expect(h.toast.warning).toHaveBeenCalledWith('Moved 1 image(s); 2 could not be moved and still load from Cloudinary.', { id: 't1' }));
    expect(screen.getByText('Phone: Cloudinary answered 404')).toBeInTheDocument();
    expect(screen.getByText('Ali: The profile picture was changed meanwhile, so it was left alone')).toBeInTheDocument();
    expect(screen.queryByText(/Bike:/)).toBeNull();
  });

  it('reports a refused move and a lost connection, and shows progress meanwhile', async () => {
    render(<StorageProviderControl />);
    const move = await screen.findByRole('button', { name: 'Move 3 images to Supabase' });

    h.migrateAllAssetsAction.mockResolvedValueOnce({ success: false, error: 'Unauthorized: admin session required' });
    fireEvent.click(move);
    fireEvent.click(screen.getByRole('button', { name: 'Move them' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Unauthorized: admin session required', { id: 't1' }));

    h.migrateAllAssetsAction.mockRejectedValueOnce(new Error('Failed to fetch'));
    fireEvent.click(move);
    fireEvent.click(screen.getByRole('button', { name: 'Move them' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Could not reach the server. Nothing was changed on this page; try again.', { id: 't1' }));

    h.migrateAllAssetsAction.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(move);
    fireEvent.click(screen.getByRole('button', { name: 'Move them' }));
    expect(await screen.findByRole('button', { name: 'Moving images...' })).toBeDisabled();
  });
});
