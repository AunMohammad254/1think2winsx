import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  media: {
    getCloudinaryUsage: vi.fn(),
    getCloudinaryResources: vi.fn(),
    deleteCloudinaryResource: vi.fn(),
    bulkDeleteCloudinaryResources: vi.fn(),
    transferCloudinaryToSupabase: vi.fn(),
    transferSupabaseToCloudinary: vi.fn(),
    getSupabaseMediaForPicker: vi.fn(),
  },
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/media-actions', () => ({
  getCloudinaryUsage: (...a: unknown[]) => h.media.getCloudinaryUsage(...a),
  getCloudinaryResources: (...a: unknown[]) => h.media.getCloudinaryResources(...a),
  deleteCloudinaryResource: (...a: unknown[]) => h.media.deleteCloudinaryResource(...a),
  bulkDeleteCloudinaryResources: (...a: unknown[]) => h.media.bulkDeleteCloudinaryResources(...a),
  transferCloudinaryToSupabase: (...a: unknown[]) => h.media.transferCloudinaryToSupabase(...a),
  transferSupabaseToCloudinary: (...a: unknown[]) => h.media.transferSupabaseToCloudinary(...a),
  getSupabaseMediaForPicker: (...a: unknown[]) => h.media.getSupabaseMediaForPicker(...a),
}));
// eslint-disable-next-line @next/next/no-img-element -- stand-in for CldImage
vi.mock('next-cloudinary', () => ({ CldImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));
// The storage panel has its own tests; here it only needs to ask the page to reload
vi.mock('@/components/admin/media/StorageProviderControl', () => ({
  default: ({ onRefresh }: { onRefresh: () => void }) => <button onClick={onRefresh}>Recount</button>,
}));

import CloudinaryPage, { metadata } from '@/app/admin/(protected)/media/cloudinary/page';

const CDN = 'https://res.cloudinary.com/dszrz6s6u/image/upload/q_auto,f_auto';
const SUPA = 'https://proj.supabase.co/storage/v1/object/public';
const limited = {
  plan: 'Plus',
  storage: { usage: 5 * 1024 * 1024, limit: 25 * 1024 ** 3 },
  bandwidth: { usage: 10 * 1024 * 1024, limit: 25 * 1024 ** 3 },
  transformations: { usage: 12, limit: 25000 },
};
const assets = () => [
  { public_id: 'prizes/watch', bytes: 2048, format: 'png', width: 800, height: 600, created_at: '2026-10-02T10:00:00Z' },
  { public_id: 'prizes/bike', bytes: 4096, format: 'JPG', created_at: '2026-10-01T10:00:00Z' },
  { public_id: 'misc/x' },
];
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
const order = () => screen.getAllByRole('img').map((i) => i.getAttribute('alt')).filter((a) => !a?.startsWith('Preview'));
const writeText = vi.fn();

beforeEach(() => {
  for (const fn of [...Object.values(h.media), ...Object.values(h.toast)]) fn.mockReset();
  h.media.getCloudinaryUsage.mockResolvedValue({ success: true, usage: limited });
  h.media.getCloudinaryResources.mockResolvedValue({ success: true, assets: assets(), nextCursor: null });
  h.media.deleteCloudinaryResource.mockResolvedValue({ success: true });
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

const loaded = async () => {
  render(<CloudinaryPage />);
  await screen.findByRole('img', { name: 'prizes/watch' });
};

describe('/admin/media/cloudinary', () => {
  it('shows the plan, usage against the limits, and the images', async () => {
    render(<CloudinaryPage />);
    expect(metadata.title).toBe('Cloudinary Media | Admin Dashboard');
    expect(screen.getByRole('link', { name: 'Cloudinary (old uploads)' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Loading Cloudinary images')).toBeInTheDocument();

    expect(await screen.findByText('Plus plan')).toBeInTheDocument();
    expect(screen.getByText('5.00 MB')).toBeInTheDocument();
    expect(screen.getByText('10.00 MB')).toBeInTheDocument();
    expect(screen.getAllByText('of 25.00 GB limit')).toHaveLength(2);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('of 25,000 limit')).toBeInTheDocument();
    expect(screen.getAllByRole('meter')).toHaveLength(3);
    expect(screen.getByRole('meter', { name: 'Transformations of limit' })).toHaveAttribute('aria-valuenow', '0');

    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    expect(screen.getByText('PNG · 2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('IMG · 0 B')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('credit plans show the shared pool instead of per-metric limits', async () => {
    h.media.getCloudinaryUsage.mockResolvedValueOnce({
      success: true,
      usage: { storage: { usage: 1024 * 1024 }, transformations: { usage: 5 }, credits: { limit: 25, used_percent: 4 } },
    });
    const { unmount } = render(<CloudinaryPage />);
    expect(await screen.findByText('1.00 MB')).toBeInTheDocument();
    expect(screen.getByText('0.00 MB')).toBeInTheDocument();
    expect(screen.getAllByText('shared pool of 25 credits')).toHaveLength(3);
    expect(screen.getAllByRole('meter')).toHaveLength(1);
    expect(screen.getByRole('meter', { name: 'Transformations of limit' })).toHaveAttribute('aria-valuenow', '4');
    expect(screen.queryByText(/plan$/)).toBeNull();
    unmount();

    h.media.getCloudinaryUsage.mockResolvedValueOnce({ success: true, usage: {} });
    const { unmount: unmount2 } = render(<CloudinaryPage />);
    expect(await screen.findAllByText('no fixed limit')).toHaveLength(3);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
    unmount2();

    // A limit with no usage reported yet counts as none used
    h.media.getCloudinaryUsage.mockResolvedValueOnce({ success: true, usage: { bandwidth: { limit: 1024 ** 3 } } });
    render(<CloudinaryPage />);
    expect(await screen.findByText('of 1.00 GB limit')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Bandwidth (30 days) of limit' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('shows why loading failed and an empty gallery', async () => {
    h.media.getCloudinaryUsage.mockResolvedValueOnce({ success: false, error: 'Invalid API key' });
    h.media.getCloudinaryResources.mockResolvedValueOnce({ success: true, assets: [], nextCursor: null });
    const { unmount } = render(<CloudinaryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid API key');
    expect(screen.getByText('No images in Cloudinary.')).toBeInTheDocument();
    expect(screen.queryByText('Storage used')).toBeNull();
    expect(screen.queryByRole('button', { name: /Select All/ })).toBeNull();
    expect(screen.queryByLabelText('Filter by format')).toBeNull();
    unmount();

    h.media.getCloudinaryResources.mockResolvedValueOnce({ success: false, error: 'Rate limited' });
    render(<CloudinaryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Rate limited');
    expect(screen.getByText('Storage used')).toBeInTheDocument();
  });

  it('searches, filters by format and sorts', async () => {
    // Two images without a date or size, so every comparator meets missing values on both sides
    h.media.getCloudinaryResources.mockResolvedValueOnce({ success: true, assets: [...assets(), { public_id: 'misc/y' }], nextCursor: null });
    await loaded();
    expect(order()).toEqual(['prizes/watch', 'prizes/bike', 'misc/x', 'misc/y']);
    const sort = screen.getByLabelText('Sort images');
    fireEvent.change(sort, { target: { value: 'oldest' } });
    expect(order()).toEqual(['misc/x', 'misc/y', 'prizes/bike', 'prizes/watch']);
    fireEvent.change(sort, { target: { value: 'largest' } });
    expect(order()).toEqual(['prizes/bike', 'prizes/watch', 'misc/x', 'misc/y']);
    fireEvent.change(sort, { target: { value: 'smallest' } });
    expect(order()).toEqual(['misc/x', 'misc/y', 'prizes/watch', 'prizes/bike']);
    fireEvent.change(sort, { target: { value: 'newest' } });

    const format = screen.getByLabelText('Filter by format');
    expect(within(format).getAllByRole('option').map((o) => o.textContent)).toEqual(['All formats', '.png', '.jpg']);
    fireEvent.change(format, { target: { value: 'jpg' } });
    expect(order()).toEqual(['prizes/bike']);
    fireEvent.change(format, { target: { value: 'all' } });

    const search = screen.getByLabelText('Search public ID');
    fireEvent.change(search, { target: { value: ' WATCH ' } });
    expect(order()).toEqual(['prizes/watch']);
    fireEvent.change(search, { target: { value: 'nothing' } });
    expect(screen.getByText('No images match the search or format.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(order()).toHaveLength(4);
  });

  it('copies links, and shows the details of an image', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to prizes/watch' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Link copied'));
    expect(writeText).toHaveBeenCalledWith(`${CDN}/prizes/watch.png`);
    act(() => (timers.mock.calls.find(([, ms]) => ms === 2000)![0] as () => void)());
    timers.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to misc/x' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${CDN}/misc/x.webp`));
    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to misc/x' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Could not copy to the clipboard'));

    fireEvent.click(screen.getByRole('button', { name: 'Details of prizes/watch' }));
    let dialog = within(screen.getByRole('dialog', { name: 'Image details' }));
    expect(dialog.getByText('800 × 600 px')).toBeInTheDocument();
    expect(dialog.getByText('2.0 KB')).toBeInTheDocument();
    expect(dialog.getByText(/2026/)).toBeInTheDocument();
    expect(dialog.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('href', `${CDN}/prizes/watch.png`);
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Details of misc/x' }));
    dialog = within(screen.getByRole('dialog', { name: 'Image details' }));
    expect(dialog.getByText('unknown')).toBeInTheDocument();
    expect(dialog.queryByText('Dimensions')).toBeNull();
    expect(dialog.queryByText('Uploaded')).toBeNull();
  });

  it('deletes from a card or the details, after confirmation, and reports refusals', async () => {
    await loaded();
    const del = (id: string) => fireEvent.click(screen.getByRole('button', { name: `Delete ${id}` }));
    vi.stubGlobal('confirm', vi.fn(() => false));
    del('prizes/watch');
    expect(h.media.deleteCloudinaryResource).not.toHaveBeenCalled();

    vi.stubGlobal('confirm', vi.fn(() => true));
    h.media.deleteCloudinaryResource.mockResolvedValueOnce({ success: false, error: 'Used by prize "Watch": change it there first' });
    del('prizes/watch');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Used by prize "Watch": change it there first'));

    const pending = deferred<unknown>();
    h.media.deleteCloudinaryResource.mockReturnValueOnce(pending.promise);
    del('prizes/watch');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete prizes/watch' })).toBeDisabled());
    await act(async () => pending.resolve({ success: true }));
    expect(h.toast.success).toHaveBeenCalledWith('Image deleted from Cloudinary');
    expect(screen.queryByRole('img', { name: 'prizes/watch' })).toBeNull();

    // With another image's details open, they stay open
    fireEvent.click(screen.getByRole('button', { name: 'Details of misc/x' }));
    del('prizes/bike');
    await waitFor(() => expect(screen.queryByRole('img', { name: 'prizes/bike' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Image details' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.media.deleteCloudinaryResource).toHaveBeenLastCalledWith('misc/x');
  });

  it('copies one image or a selection to Supabase, into the chosen bucket', async () => {
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Copy prizes/watch to Supabase' }));
    let dialog = within(screen.getByRole('dialog', { name: 'Copy 1 image to Supabase Storage' }));
    fireEvent.click(dialog.getByRole('button', { name: 'site-media' }));
    expect(dialog.getByRole('button', { name: 'site-media' })).toHaveAttribute('aria-pressed', 'true');
    const pending = deferred<unknown>();
    h.media.transferCloudinaryToSupabase.mockReturnValueOnce(pending.promise);
    fireEvent.click(dialog.getByRole('button', { name: 'Copy' }));
    expect(await dialog.findByRole('button', { name: 'Copying 1 of 1...' })).toBeDisabled();
    await act(async () => pending.resolve({ success: true, url: `${SUPA}/site-media/uploads/w-1920.webp` }));
    expect(h.media.transferCloudinaryToSupabase).toHaveBeenCalledWith('prizes/watch', 'site-media');
    expect(h.toast.success).toHaveBeenCalledWith('Copied 1 image to Supabase (site-media)');
    expect(h.toast.error).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: `Copy ${SUPA}/site-media/uploads/w-1920.webp` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${SUPA}/site-media/uploads/w-1920.webp`));
    fireEvent.click(dialog.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy prizes/bike to Supabase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // The selection, with one failure
    fireEvent.click(screen.getByRole('button', { name: 'Select All (3)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy to Supabase' }));
    dialog = within(screen.getByRole('dialog', { name: 'Copy 3 images to Supabase Storage' }));
    fireEvent.click(dialog.getByRole('button', { name: 'prize-images' }));
    h.media.transferCloudinaryToSupabase
      .mockResolvedValueOnce({ success: true, url: 'u1' })
      .mockResolvedValueOnce({ success: false, error: 'The image link answered 404' })
      .mockResolvedValueOnce({ success: true, url: 'u3' });
    fireEvent.click(dialog.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Copied 2 images to Supabase (prize-images)'));
    expect(h.toast.error).toHaveBeenCalledWith('Could not copy 1 image');
    expect(screen.queryByText(/selected/)).toBeNull();

    // None copied: only the failure, and the details dialog hands over to this one
    h.toast.success.mockClear();
    fireEvent.click(dialog.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Details of prizes/bike' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Copy to Supabase' }));
    dialog = within(screen.getByRole('dialog', { name: 'Copy 1 image to Supabase Storage' }));
    h.media.transferCloudinaryToSupabase.mockResolvedValueOnce({ success: false, error: 'quota' });
    fireEvent.click(dialog.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Could not copy 1 image'));
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it('bulk copies links and deletes, keeping images still in use', async () => {
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Select prizes/watch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select prizes/bike' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deselect prizes/watch' }));
    expect(screen.getByText('1 image selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select All (3)' }));
    expect(screen.getByText('3 images selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deselect All' }));
    expect(screen.queryByText(/selected/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select All (3)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Copy Links' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Copied 3 links'));
    expect(writeText).toHaveBeenCalledWith([`${CDN}/prizes/watch.png`, `${CDN}/prizes/bike.JPG`, `${CDN}/misc/x.webp`].join('\n'));

    vi.stubGlobal('confirm', vi.fn(() => false));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    expect(h.media.bulkDeleteCloudinaryResources).not.toHaveBeenCalled();
    vi.stubGlobal('confirm', vi.fn(() => true));
    h.media.bulkDeleteCloudinaryResources.mockResolvedValueOnce({ success: false, error: 'Select at most 100 files at a time' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Select at most 100 files at a time'));

    h.media.bulkDeleteCloudinaryResources.mockResolvedValueOnce({
      success: true,
      deleted: ['prizes/watch'],
      skipped: [{ publicId: 'prizes/bike', reason: 'Used by prize "Bike"' }, { publicId: 'misc/x', reason: 'Used by prize "Bike"' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Deleted 1 image from Cloudinary'));
    expect(h.toast.error).toHaveBeenCalledWith('Kept 2 images: Used by prize "Bike"');
    expect(screen.queryByRole('img', { name: 'prizes/watch' })).toBeNull();
    expect(screen.getByText('2 images selected')).toBeInTheDocument();

    h.toast.success.mockClear();
    h.toast.error.mockClear();
    h.media.bulkDeleteCloudinaryResources.mockResolvedValueOnce({ success: true, deleted: [], skipped: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(h.media.bulkDeleteCloudinaryResources).toHaveBeenCalledTimes(3));
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.toast.error).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('copies a Supabase image into Cloudinary from the list or a pasted link', async () => {
    await loaded();
    const picker = deferred<unknown>();
    h.media.getSupabaseMediaForPicker.mockReturnValueOnce(picker.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Copy from Supabase' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Copy from Supabase to Cloudinary' }));
    expect(dialog.getByLabelText('Loading Supabase images')).toBeInTheDocument();
    await act(async () => picker.resolve({ success: true, images: [{ url: `${SUPA}/prize-images/prizes/p1-1280.webp`, name: 'prizes/p1-1280.webp', bucket: 'prize-images', size: 2048 }] }));
    expect(dialog.getByText('prize-images · 2.0 KB')).toBeInTheDocument();

    fireEvent.change(dialog.getByLabelText('Cloudinary folder'), { target: { value: ' banners ' } });
    const pending = deferred<unknown>();
    h.media.transferSupabaseToCloudinary.mockReturnValueOnce(pending.promise);
    fireEvent.click(dialog.getByRole('button', { name: 'Copy prizes/p1-1280.webp to Cloudinary' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Copy prizes/p1-1280.webp to Cloudinary' })).toBeDisabled());
    expect(dialog.getByRole('button', { name: 'Copy link' })).toBeDisabled();
    await act(async () => pending.resolve({ success: true, publicId: 'banners/p1' }));
    expect(h.media.transferSupabaseToCloudinary).toHaveBeenCalledWith(`${SUPA}/prize-images/prizes/p1-1280.webp`, 'banners');
    expect(h.toast.success).toHaveBeenCalledWith('Copied to Cloudinary as "banners/p1"');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(h.media.getCloudinaryResources).toHaveBeenCalledTimes(2));

    // A failed list, then a pasted link that is refused
    h.media.getSupabaseMediaForPicker.mockResolvedValueOnce({ success: false, error: 'storage down' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy from Supabase' }));
    expect(await screen.findByText('No prize or site images in Supabase Storage.')).toBeInTheDocument();
    expect(h.toast.error).toHaveBeenCalledWith('storage down');
    h.media.transferSupabaseToCloudinary.mockResolvedValueOnce({ success: false, error: "Only this site's prize and site images can be copied" });
    fireEvent.change(screen.getByLabelText(/Or paste a link/), { target: { value: ' https://evil.example/a.png ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Only this site's prize and site images can be copied"));
    expect(h.media.transferSupabaseToCloudinary).toHaveBeenLastCalledWith('https://evil.example/a.png', 'banners');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uploads straight to Cloudinary through the upload route', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await loaded();
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Upload to Cloudinary' }));
    const pick = () => fireEvent.change(screen.getByLabelText(/^Image/), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    open();
    submit();
    expect(h.toast.error).toHaveBeenCalledWith('Choose an image to upload');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'banners' } });
    pick();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Image must be 10 MB or smaller' }, 400));
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Image must be 10 MB or smaller'));
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect([body.get('target'), body.get('folder'), (body.get('file') as File).name]).toEqual(['cloudinary', 'banners', 'a.png']);

    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));
    submit();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Upload failed'));

    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    submit();
    expect(await screen.findByRole('button', { name: 'Uploading...' })).toBeDisabled();
    await act(async () => pending.resolve(jsonResponse({ url: 'x', resource: { publicId: 'banners/a' } })));
    expect(h.toast.success).toHaveBeenCalledWith('Uploaded "banners/a" to Cloudinary');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(h.media.getCloudinaryResources).toHaveBeenCalledTimes(2));

    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reloads from the button and the storage panel, and loads more images', async () => {
    h.media.getCloudinaryResources.mockResolvedValueOnce({ success: true, assets: assets(), nextCursor: 'c2' });
    await loaded();

    h.media.getCloudinaryResources.mockResolvedValueOnce({ success: false, error: 'Rate limited' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Rate limited'));
    expect(h.media.getCloudinaryResources).toHaveBeenLastCalledWith('c2');

    h.media.getCloudinaryResources.mockResolvedValueOnce({ success: true, assets: [{ public_id: 'old/one', format: 'gif' }], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('img', { name: 'old/one' })).toBeInTheDocument();
    expect(screen.getByText('4 of 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    const pending = deferred<unknown>();
    h.media.getCloudinaryUsage.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled());
    await act(async () => pending.resolve({ success: true, usage: limited }));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(screen.queryByRole('img', { name: 'old/one' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Recount' }));
    await waitFor(() => expect(h.media.getCloudinaryUsage).toHaveBeenCalledTimes(3));
  });
});
