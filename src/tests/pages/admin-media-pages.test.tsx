import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() },
  actions: {
    getMediaOverview: vi.fn(),
    listMediaImages: vi.fn(),
    deleteMediaImage: vi.fn(),
    bulkDeleteMediaImages: vi.fn(),
    keepQueuedImage: vi.fn(),
    updatePrizeImageRetention: vi.fn(),
    listProfilePictures: vi.fn(),
    removeProfilePicture: vi.fn(),
    importMediaFromUrl: vi.fn(),
    getCloudinaryLeftovers: vi.fn(),
    migrateAllAssetsAction: vi.fn(),
    transferSupabaseToCloudinary: vi.fn(),
  },
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/supabase-media-actions', () => ({
  getMediaOverview: (...a: unknown[]) => h.actions.getMediaOverview(...a),
  listMediaImages: (...a: unknown[]) => h.actions.listMediaImages(...a),
  deleteMediaImage: (...a: unknown[]) => h.actions.deleteMediaImage(...a),
  bulkDeleteMediaImages: (...a: unknown[]) => h.actions.bulkDeleteMediaImages(...a),
  keepQueuedImage: (...a: unknown[]) => h.actions.keepQueuedImage(...a),
  updatePrizeImageRetention: (...a: unknown[]) => h.actions.updatePrizeImageRetention(...a),
  listProfilePictures: (...a: unknown[]) => h.actions.listProfilePictures(...a),
  removeProfilePicture: (...a: unknown[]) => h.actions.removeProfilePicture(...a),
  importMediaFromUrl: (...a: unknown[]) => h.actions.importMediaFromUrl(...a),
  getCloudinaryLeftovers: (...a: unknown[]) => h.actions.getCloudinaryLeftovers(...a),
  migrateAllAssetsAction: (...a: unknown[]) => h.actions.migrateAllAssetsAction(...a),
}));
vi.mock('@/actions/media-actions', () => ({
  transferSupabaseToCloudinary: (...a: unknown[]) => h.actions.transferSupabaseToCloudinary(...a),
}));

import MediaPage, { metadata } from '@/app/admin/(protected)/media/page';
import ProfilePicturesPage, { metadata as pictureMeta } from '@/app/admin/(protected)/media/profile-pictures/page';
import { formatBytes, Pager } from '@/app/admin/(protected)/media/media-ui';

const PUB = 'https://proj.supabase.co/storage/v1/object/public';
const prizeImage = (name: string, usedBy: { id: string; name: string }[] = []) => ({
  url: `${PUB}/prize-images/prizes/${name}-1280.webp`,
  name: `prizes/${name}-1280.webp`,
  size: 2048,
  createdAt: '2026-10-01T10:00:00Z',
  usedBy,
});
const overview = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    usage: [
      { bucket: 'site-media', objects: 0, bytes: 0 },
      { bucket: 'prize-images', objects: 6, bytes: 3 * 1024 * 1024 },
      { bucket: 'avatars', objects: 2, bytes: 500 },
    ],
    retentionDays: 30,
    deletions: [
      { id: 'd1', url: `${PUB}/prize-images/prizes/old-1280.webp`, reason: 'prize_image_replaced', prizeId: 'p1', status: 'pending', attempts: 0, lastError: null, createdAt: '2026-10-01T00:00:00Z', processedAt: null },
      { id: 'd2', url: 'https://res.cloudinary.com/dszrz6s6u/image/upload/v1/prizes/x.jpg', reason: 'prize_deleted', prizeId: 'p2', status: 'failed', attempts: 5, lastError: 'Storage did not confirm the delete', createdAt: '2026-08-01T00:00:00Z', processedAt: '2026-09-01T00:00:00Z' },
    ],
    ...over,
  },
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
  for (const fn of [...Object.values(h.actions), ...Object.values(h.toast)]) fn.mockReset();
  h.actions.getCloudinaryLeftovers.mockResolvedValue({ success: true, data: { prizes: 0, avatars: 0, total: 0 } });
  h.actions.getMediaOverview.mockResolvedValue(overview());
  h.actions.listMediaImages.mockResolvedValue({ success: true, data: { images: [prizeImage('a', [{ id: 'p1', name: 'Bike' }]), prizeImage('b')], total: 2, pageSize: 48 } });
  h.actions.deleteMediaImage.mockResolvedValue({ success: true, data: { deleted: true } });
  h.actions.keepQueuedImage.mockResolvedValue({ success: true, data: { kept: true } });
  h.actions.updatePrizeImageRetention.mockResolvedValue({ success: true, data: { days: 7 } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('/admin/media (site & prize images)', () => {
  it('shows bucket usage, the prize gallery with usage, and the cleanup queue', async () => {
    render(<MediaPage />);
    expect(metadata.title).toBe('Media Management | Admin Dashboard');
    expect(screen.getByRole('link', { name: 'Site & prize images' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Player profile pictures' })).toHaveAttribute('href', '/admin/media/profile-pictures');
    expect(screen.getByLabelText('Loading images')).toBeInTheDocument();

    expect(await screen.findByText('3.00 MB')).toBeInTheDocument();
    expect(screen.getByText('500 B')).toBeInTheDocument();
    expect(screen.getByText(/6 files · stored as 320 \/ 640 \/ 1280px WebP/)).toBeInTheDocument();
    expect(await screen.findByText('Used by Bike')).toBeInTheDocument();
    expect(screen.getByText('Not used by any prize')).toBeInTheDocument();
    expect(h.actions.listMediaImages).toHaveBeenCalledWith('prize-images', 0);
    // The browser picks small stored sizes from srcset for the 160px thumbnail, not the 1280px original
    const srcset = screen.getByRole('img', { name: 'prizes/a-1280.webp' }).getAttribute('srcset')!;
    expect(srcset).toContain(`${PUB}/prize-images/prizes/a-320.webp 128w`);
    expect(srcset).toContain(`${PUB}/prize-images/prizes/a-640.webp 384w`);
    expect(screen.getByRole('button', { name: 'Delete prizes/a-1280.webp' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete prizes/a-1280.webp' })).toHaveAttribute('title', 'Change the prize image first');

    expect(screen.getByLabelText(/Keep replaced prize images for/)).toHaveValue(30);
    expect(screen.getByText('Replaced on a prize')).toBeInTheDocument();
    expect(screen.getByText('Deletes after 31 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('Storage did not confirm the delete')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Keep' })).toHaveLength(1);
  });

  it('switches to site images, which show no prize usage, and pages through them', async () => {
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    h.actions.listMediaImages.mockResolvedValue({ success: true, data: { images: [], total: 0, pageSize: 48 } });
    fireEvent.click(screen.getByRole('button', { name: 'Site images' }));
    expect(await screen.findByText('No site images yet.')).toBeInTheDocument();
    expect(h.actions.listMediaImages).toHaveBeenLastCalledWith('site-media', 0);
    expect(screen.getByRole('button', { name: 'Site images' })).toHaveAttribute('aria-pressed', 'true');

    h.actions.listMediaImages.mockResolvedValue({ success: true, data: { images: [{ ...prizeImage('s'), url: `${PUB}/site-media/uploads/s-1920.webp`, name: 'uploads/s-1920.webp' }], total: 100, pageSize: 48 } });
    fireEvent.click(screen.getByRole('button', { name: 'Prize images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Site images' }));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.queryByText('Not used by any prize')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(h.actions.listMediaImages).toHaveBeenLastCalledWith('site-media', 1));
  });

  it('uploads to the selected bucket and reports failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ url: 'x' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Image must be 10 MB or smaller' }, 400))
      .mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    const input = () => screen.getByLabelText(/^Upload to/) as HTMLInputElement;
    const pick = () => fireEvent.change(input(), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });

    pick();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Image uploaded'));
    expect((fetchMock.mock.calls[0][1].body as FormData).get('target')).toBe('prize');
    expect(h.actions.listMediaImages).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Site images' }));
    await waitFor(() => expect(h.actions.listMediaImages).toHaveBeenLastCalledWith('site-media', 0));
    pick();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Image must be 10 MB or smaller'));
    expect((fetchMock.mock.calls[1][1].body as FormData).get('target')).toBe('site');
    pick();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Upload failed'));
    fireEvent.change(input(), { target: { files: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shows the upload in progress', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    fireEvent.change(screen.getByLabelText(/^Upload to/), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getByText(/^Upload to/).closest('label')).toHaveClass('pointer-events-none'));
  });

  it('deletes an unused image after confirmation, copies links, and reports errors', async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    const del = () => fireEvent.click(screen.getByRole('button', { name: 'Delete prizes/b-1280.webp' }));

    del();
    expect(h.actions.deleteMediaImage).not.toHaveBeenCalled();
    del();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Image deleted'));
    expect(h.actions.deleteMediaImage).toHaveBeenCalledWith(`${PUB}/prize-images/prizes/b-1280.webp`);
    h.actions.deleteMediaImage.mockResolvedValueOnce({ success: false, error: '"Bike" still uses this image.' });
    del();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('"Bike" still uses this image.'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy link to prizes/b-1280.webp' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Link copied'));
    expect(writeText).toHaveBeenCalledWith(`${PUB}/prize-images/prizes/b-1280.webp`);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to prizes/b-1280.webp' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Could not copy the link'));
  });

  it('shows a spinner on the image being deleted', async () => {
    vi.stubGlobal('confirm', () => true);
    h.actions.deleteMediaImage.mockReturnValueOnce(new Promise(() => {}));
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    fireEvent.click(screen.getByRole('button', { name: 'Delete prizes/b-1280.webp' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete prizes/b-1280.webp' })).toBeDisabled());
  });

  it('saves the retention setting and keeps a queued image', async () => {
    render(<MediaPage />);
    const days = await screen.findByLabelText(/Keep replaced prize images for/);
    await waitFor(() => expect(days).toHaveValue(30));
    fireEvent.change(days, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Replaced prize images are now kept for 7 days'));
    expect(h.actions.updatePrizeImageRetention).toHaveBeenCalledWith(7);
    h.actions.updatePrizeImageRetention.mockResolvedValueOnce({ success: false, error: 'Retention must be a whole number of days from 0 to 365' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Retention must be a whole number of days from 0 to 365'));

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('The image will be kept'));
    expect(h.actions.keepQueuedImage).toHaveBeenCalledWith('d1');
    h.actions.keepQueuedImage.mockResolvedValueOnce({ success: true, data: { kept: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('That image was already processed'));
    h.actions.keepQueuedImage.mockResolvedValueOnce({ success: false, error: 'Unauthorized: admin session required' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Unauthorized: admin session required'));
  });

  it('supports bulk selection, select all, deselect, copy links, and bulk delete', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    h.actions.bulkDeleteMediaImages.mockResolvedValue({
      success: true,
      data: {
        deletedCount: 1,
        skipped: [{ url: `${PUB}/prize-images/prizes/a-1280.webp`, reason: 'Used by prize "Bike"' }],
      },
    });

    render(<MediaPage />);
    await screen.findByText('Used by Bike');

    // Click "Select All"
    fireEvent.click(screen.getByRole('button', { name: /Select All/ }));
    expect(await screen.findByText('2 images selected')).toBeInTheDocument();

    // Copy links
    fireEvent.click(screen.getByRole('button', { name: 'Copy Links' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Copied 2 links to clipboard'));

    // Deselect All
    fireEvent.click(screen.getByRole('button', { name: 'Deselect All' }));
    expect(screen.queryByText(/images selected/)).toBeNull();

    // Select single image using checkbox
    fireEvent.click(screen.getByRole('button', { name: 'Select prizes/b-1280.webp' }));
    expect(await screen.findByText('1 image selected')).toBeInTheDocument();

    // Bulk Delete
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(h.actions.bulkDeleteMediaImages).toHaveBeenCalledWith([`${PUB}/prize-images/prizes/b-1280.webp`]));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Deleted 1 image'));
    expect(h.toast.error).toHaveBeenCalledWith('Skipped 1 image: Used by prize "Bike"');

    // Nothing skipped: no warning
    h.toast.error.mockClear();
    h.actions.bulkDeleteMediaImages.mockResolvedValueOnce({ success: true, data: { deletedCount: 1, skipped: [] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Select prizes/b-1280.webp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(h.actions.bulkDeleteMediaImages).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.toast.success.mock.calls.filter(([m]) => m === 'Deleted 1 image')).toHaveLength(2));
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it('reports loading failures and an empty cleanup queue', async () => {
    h.actions.getMediaOverview.mockResolvedValueOnce({ success: false, error: 'function media_storage_usage does not exist' });
    h.actions.listMediaImages.mockResolvedValueOnce({ success: false, error: 'storage down' });
    const { unmount } = render(<MediaPage />);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('function media_storage_usage does not exist'));
    expect(h.toast.error).toHaveBeenCalledWith('storage down');
    expect(screen.queryByText('No replaced prize images yet.')).toBeNull();
    unmount();

    h.actions.getMediaOverview.mockResolvedValueOnce(overview({ deletions: [] }));
    render(<MediaPage />);
    expect(await screen.findByText('No replaced prize images yet.')).toBeInTheDocument();
  });
});

describe('/admin/media gallery tools', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  };
  const three = () => [
    { ...prizeImage('a', [{ id: 'p1', name: 'Bike' }]), size: 2048, createdAt: '2026-10-01T10:00:00Z' },
    { ...prizeImage('b'), size: 5000, createdAt: '2026-10-03T10:00:00Z' },
    { ...prizeImage('c'), size: 100, createdAt: '2026-09-01T10:00:00Z' },
  ];
  const order = () => screen.getAllByRole('img').map((i) => i.getAttribute('alt')).filter((a) => a?.startsWith('prizes/')).map((a) => a!.slice(7, 8));
  const writeText = vi.fn();

  beforeEach(() => {
    h.actions.listMediaImages.mockResolvedValue({ success: true, data: { images: three(), total: 3, pageSize: 48 } });
    writeText.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('searches by file or prize name, filters by use and sorts', async () => {
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    expect(order()).toEqual(['b', 'a', 'c']);
    const sort = screen.getByLabelText('Sort images');
    fireEvent.change(sort, { target: { value: 'oldest' } });
    expect(order()).toEqual(['c', 'a', 'b']);
    fireEvent.change(sort, { target: { value: 'largest' } });
    expect(order()).toEqual(['b', 'a', 'c']);
    fireEvent.change(sort, { target: { value: 'smallest' } });
    expect(order()).toEqual(['c', 'a', 'b']);

    const search = screen.getByLabelText('Search images');
    fireEvent.change(search, { target: { value: ' BIKE ' } });
    expect(order()).toEqual(['a']);
    expect(screen.getByText('Showing 1 of 3 images')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'prizes/c' } });
    expect(order()).toEqual(['c']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(order()).toHaveLength(3);

    const use = screen.getByLabelText('Filter by use');
    fireEvent.change(use, { target: { value: 'used' } });
    expect(order()).toEqual(['a']);
    fireEvent.change(use, { target: { value: 'unused' } });
    expect(order()).toEqual(['c', 'b']);
    fireEvent.change(use, { target: { value: 'all' } });
    expect(order()).toHaveLength(3);
  });

  it('inspects an image: its stored sizes, links, a copy to Cloudinary and delete', async () => {
    h.actions.transferSupabaseToCloudinary.mockResolvedValue({ success: true, publicId: 'prizes/a-1280' });
    render(<MediaPage />);
    await screen.findByText('Used by Bike');

    fireEvent.click(screen.getByRole('button', { name: 'Inspect prizes/a-1280.webp' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Image details' }));
    expect(dialog.getByText('Bike')).toBeInTheDocument();
    expect(dialog.getByText('prizes/a-320.webp')).toBeInTheDocument();
    expect(dialog.getByText('prizes/a-640.webp')).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Copy link to the 640px size' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${PUB}/prize-images/prizes/a-640.webp`));
    expect(dialog.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('href', `${PUB}/prize-images/prizes/a-1280.webp`);
    fireEvent.click(dialog.getByRole('button', { name: 'Copy to Cloudinary' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Copied to Cloudinary as "prizes/a-1280"'));
    expect(h.actions.transferSupabaseToCloudinary).toHaveBeenCalledWith(`${PUB}/prize-images/prizes/a-1280.webp`, 'prizes');
    expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Deleting from the dialog closes it
    fireEvent.click(screen.getByRole('button', { name: 'Inspect prizes/b-1280.webp' }));
    expect(screen.queryByText('Used by', { selector: 'dt' })).toBeNull();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Image deleted'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('copies one image to Cloudinary from its card, into the folder of the bucket shown', async () => {
    const pending = deferred<unknown>();
    h.actions.transferSupabaseToCloudinary.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ success: false, error: 'quota' });
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    const copy = () => screen.getByRole('button', { name: 'Copy prizes/b-1280.webp to Cloudinary' });
    fireEvent.click(copy());
    await waitFor(() => expect(copy()).toBeDisabled());
    await act(async () => pending.resolve({ success: true, publicId: 'prizes/b' }));
    expect(h.toast.success).toHaveBeenCalledWith('Copied to Cloudinary as "prizes/b"');
    expect(copy()).toBeEnabled();
    fireEvent.click(copy());
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('quota'));

    fireEvent.click(screen.getByRole('button', { name: 'Site images' }));
    await waitFor(() => expect(h.actions.listMediaImages).toHaveBeenLastCalledWith('site-media', 0));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy prizes/b-1280.webp to Cloudinary' }));
    await waitFor(() => expect(h.actions.transferSupabaseToCloudinary).toHaveBeenLastCalledWith(`${PUB}/prize-images/prizes/b-1280.webp`, 'site'));
  });

  it('imports an image from a link into the bucket shown', async () => {
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Import from URL' }));

    open();
    fireEvent.change(screen.getByLabelText('Image link (https)'), { target: { value: ' https://example.com/a.png ' } });
    h.actions.importMediaFromUrl.mockResolvedValueOnce({ success: false, error: 'That link is not an image' });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('That link is not an image'));
    expect(h.actions.importMediaFromUrl).toHaveBeenCalledWith('https://example.com/a.png', 'prize-images');
    expect(screen.getByRole('dialog', { name: 'Import from URL' })).toBeInTheDocument();

    const pending = deferred<unknown>();
    h.actions.importMediaFromUrl.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('button', { name: 'Importing...' })).toBeDisabled();
    await act(async () => pending.resolve({ success: true, data: { url: 'x', paths: [], bytes: 1 } }));
    expect(h.toast.success).toHaveBeenCalledWith('Image imported into Prize images');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(h.actions.listMediaImages).toHaveBeenCalledTimes(2));

    open();
    expect(screen.getByLabelText('Image link (https)')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bulk copies to Cloudinary with progress, and reports what was not copied', async () => {
    const pending = deferred<unknown>();
    h.actions.transferSupabaseToCloudinary.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ success: true, publicId: 'x' }).mockResolvedValueOnce({ success: false, error: 'quota' });
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    fireEvent.click(screen.getByRole('button', { name: /Select All/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy to Cloudinary' }));
    expect(await screen.findByText('Copying 1 of 3...')).toBeInTheDocument();
    await act(async () => pending.resolve({ success: false, error: 'quota' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Copied 1 image to Cloudinary (prizes/)'));
    expect(h.toast.error).toHaveBeenCalledWith('Could not copy 2 images');
    expect(screen.queryByText(/selected/)).toBeNull();

    // Everything copied: no failure toast
    h.toast.error.mockClear();
    h.actions.transferSupabaseToCloudinary.mockResolvedValueOnce({ success: true, publicId: 'c' });
    fireEvent.click(screen.getByRole('button', { name: 'Select prizes/c-1280.webp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy to Cloudinary' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Copied 1 image to Cloudinary (prizes/)'));
    expect(h.toast.error).not.toHaveBeenCalled();

    // Nothing copied: only the failure is reported
    h.toast.success.mockClear();
    h.actions.transferSupabaseToCloudinary.mockResolvedValue({ success: false, error: 'quota' });
    fireEvent.click(screen.getByRole('button', { name: 'Select prizes/c-1280.webp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy to Cloudinary' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Could not copy 1 image'));
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it('selects and deselects, and handles refused, partial and cancelled bulk deletes', async () => {
    render(<MediaPage />);
    await screen.findByText('Used by Bike');
    fireEvent.click(screen.getByRole('button', { name: 'Select prizes/a-1280.webp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select prizes/b-1280.webp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deselect prizes/a-1280.webp' }));
    expect(screen.getByText('1 image selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select All (3)' }));
    expect(screen.getByText('3 images selected')).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Links' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to copy links'));

    vi.stubGlobal('confirm', vi.fn(() => false));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    expect(h.actions.bulkDeleteMediaImages).not.toHaveBeenCalled();

    vi.stubGlobal('confirm', vi.fn(() => true));
    h.actions.bulkDeleteMediaImages.mockResolvedValueOnce({ success: false, error: 'Select at most 100 images at a time' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Select at most 100 images at a time'));
    expect(screen.getByText('3 images selected')).toBeInTheDocument();

    h.actions.bulkDeleteMediaImages.mockResolvedValueOnce({
      success: true,
      data: { deletedCount: 0, skipped: [{ url: 'a', reason: 'Used by prize "Bike"' }, { url: 'b', reason: 'Used by prize "Bike"' }] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Skipped 2 images: Used by prize "Bike"'));
    expect(h.toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/^Deleted/));
    expect(screen.queryByText(/selected/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Select prizes/c-1280.webp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('refreshes, resets the copied tick, and clears the selection when paging', async () => {
    h.actions.listMediaImages.mockResolvedValue({ success: true, data: { images: three(), total: 100, pageSize: 48 } });
    const timers = vi.spyOn(globalThis, 'setTimeout');
    render(<MediaPage />);
    await screen.findByText('Used by Bike');

    fireEvent.click(screen.getByRole('button', { name: 'Copy link to prizes/c-1280.webp' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Link copied'));
    const reset = timers.mock.calls.find(([, ms]) => ms === 2000)![0] as () => void;
    act(() => reset());
    timers.mockRestore();

    const pending = deferred<unknown>();
    h.actions.listMediaImages.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled());
    await act(async () => pending.resolve({ success: true, data: { images: three(), total: 100, pageSize: 48 } }));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(h.actions.getMediaOverview).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Select prizes/c-1280.webp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(h.actions.listMediaImages).toHaveBeenLastCalledWith('prize-images', 1));
    expect(screen.queryByText(/selected/)).toBeNull();
  });
});

describe('/admin/media/profile-pictures', () => {
  const picture = (over: Record<string, unknown> = {}) => ({
    userId: 'u1', userName: 'Ali', email: 'ali@example.test', url: `${PUB}/avatars/u1/a-256.webp`,
    size: 12_000, createdAt: '2026-10-02T00:00:00Z', isCurrent: true, ...over,
  });

  beforeEach(() => {
    h.actions.listProfilePictures.mockResolvedValue({
      success: true,
      data: {
        pictures: [picture(), picture({ userId: 'u2', userName: null, email: null, url: `${PUB}/avatars/u2/b-256.webp`, isCurrent: false })],
        total: 2,
        pageSize: 48,
      },
    });
    h.actions.removeProfilePicture.mockResolvedValue({ success: true, data: { removed: 1 } });
  });

  it('lists players\' pictures on their own page', async () => {
    render(<ProfilePicturesPage />);
    expect(pictureMeta.title).toBe('Player Profile Pictures | Admin Dashboard');
    expect(screen.getByRole('link', { name: 'Player profile pictures' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Loading profile pictures')).toBeInTheDocument();
    expect(await screen.findByText('Ali')).toBeInTheDocument();
    expect(screen.getByText('ali@example.test')).toBeInTheDocument();
    expect(screen.getByText('Unknown player')).toBeInTheDocument();
    expect(screen.getByText('u2')).toBeInTheDocument();
    expect(screen.getAllByText(/11\.7 KB/)).toHaveLength(2);
    expect(screen.getAllByText('not on profile')).toHaveLength(1);
    expect(screen.getByRole('img', { name: "Ali's profile picture" }).getAttribute('src')).toBe(`${PUB}/avatars/u1/a-256.webp`);
    expect(screen.getByRole('img', { name: "Player's profile picture" })).toBeInTheDocument();
  });

  it('removes a picture after confirmation and reports failures', async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    render(<ProfilePicturesPage />);
    await screen.findByText('Ali');

    fireEvent.click(screen.getByRole('button', { name: "Remove Ali's profile picture" }));
    expect(confirm).toHaveBeenCalledWith("Remove Ali's profile picture? They can upload a new one later.");
    expect(h.actions.removeProfilePicture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: "Remove Ali's profile picture" }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Profile picture removed'));
    expect(h.actions.removeProfilePicture).toHaveBeenCalledWith('u1');
    expect(h.actions.listProfilePictures).toHaveBeenCalledTimes(2);

    h.actions.removeProfilePicture.mockResolvedValueOnce({ success: false, error: 'Invalid user id' });
    fireEvent.click(screen.getByRole('button', { name: "Remove u2's profile picture" }));
    expect(confirm).toHaveBeenLastCalledWith("Remove this player's profile picture? They can upload a new one later.");
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Invalid user id'));
  });

  it('uses the email when there is no name, shows the busy state, and pages', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    h.actions.listProfilePictures.mockResolvedValue({
      success: true,
      data: { pictures: [picture({ userName: null })], total: 60, pageSize: 48 },
    });
    h.actions.removeProfilePicture.mockReturnValueOnce(new Promise(() => {}));
    render(<ProfilePicturesPage />);
    const button = await screen.findByRole('button', { name: "Remove u1's profile picture" });
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith("Remove ali@example.test's profile picture? They can upload a new one later.");
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(h.actions.listProfilePictures).toHaveBeenLastCalledWith(1));
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(h.actions.listProfilePictures).toHaveBeenLastCalledWith(0));
  });

  it('shows an empty state and loading errors', async () => {
    h.actions.listProfilePictures.mockResolvedValueOnce({ success: true, data: { pictures: [], total: 0, pageSize: 48 } });
    const { unmount } = render(<ProfilePicturesPage />);
    expect(await screen.findByText('No player has uploaded a profile picture yet.')).toBeInTheDocument();
    unmount();
    h.actions.listProfilePictures.mockResolvedValueOnce({ success: false, error: 'Unauthorized: admin session required' });
    render(<ProfilePicturesPage />);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Unauthorized: admin session required'));
  });
});

describe('media-ui', () => {
  it('formats sizes and hides the pager for a single page', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    const onPage = vi.fn();
    const { container, rerender } = render(<Pager page={0} total={10} pageSize={48} onPage={onPage} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Pager page={1} total={100} pageSize={48} onPage={onPage} />);
    const pager = within(container);
    act(() => fireEvent.click(pager.getByRole('button', { name: 'Previous' })));
    expect(onPage).toHaveBeenCalledWith(0);
    expect(pager.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});
