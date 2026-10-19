'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Copy, HardDrive, Loader2, Trash2, Upload } from 'lucide-react';
import { IMAGE_PRESETS, MEDIA_BUCKETS, mediaImageLoader, type MediaBucket } from '@/lib/media/config';
import { loaderFor } from '@/lib/cloudinary';
import {
  deleteMediaImage,
  getMediaOverview,
  keepQueuedImage,
  listMediaImages,
  updatePrizeImageRetention,
  type MediaImage,
  type MediaImagePage,
  type MediaOverview,
} from '@/actions/supabase-media-actions';
import { formatBytes, formatDate, Pager } from './media-ui';
import StorageProviderControl from '@/components/admin/media/StorageProviderControl';

type AdminBucket = typeof MEDIA_BUCKETS.prize | typeof MEDIA_BUCKETS.site;

const DAY_MS = 24 * 60 * 60 * 1000;

const BUCKET_LABELS: Record<MediaBucket, string> = {
  'prize-images': 'Prize images',
  'site-media': 'Site images',
  avatars: 'Player profile pictures',
};

const REASON_LABELS = { prize_image_replaced: 'Replaced on a prize', prize_deleted: 'Prize deleted' } as const;

const STATUS_STYLES = {
  pending: 'bg-yellow-500/15 text-yellow-300',
  deleted: 'bg-gray-500/15 text-gray-300',
  kept: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
} as const;

/** /admin/media: admin-uploaded images (prize-images and site-media) and replaced-image cleanup. */
export default function SiteMediaManager() {
  const [overview, setOverview] = useState<MediaOverview | null>(null);
  const [bucket, setBucket] = useState<AdminBucket>(MEDIA_BUCKETS.prize);
  const [page, setPage] = useState(0);
  const [listing, setListing] = useState<MediaImagePage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [retention, setRetention] = useState('');

  const loadOverview = useCallback(async () => {
    const res = await getMediaOverview();
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setOverview(res.data);
    setRetention(String(res.data.retentionDays));
  }, []);

  const loadImages = useCallback(async () => {
    const res = await listMediaImages(bucket, page);
    if (res.success) setListing(res.data);
    else toast.error(res.error);
  }, [bucket, page]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  const refresh = () => Promise.all([loadImages(), loadOverview()]);

  const switchBucket = (next: AdminBucket) => {
    setBucket(next);
    setPage(0);
    setListing(null);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('upload');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('target', bucket === MEDIA_BUCKETS.site ? 'site' : 'prize');
      const res = await fetch('/api/upload', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast.success('Image uploaded');
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (image: MediaImage) => {
    if (!confirm('Delete this image (every stored size)? This cannot be undone.')) return;
    setBusy(image.url);
    const res = await deleteMediaImage(image.url);
    setBusy(null);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success('Image deleted');
    await refresh();
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const saveRetention = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await updatePrizeImageRetention(Number(retention));
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(`Replaced prize images are now kept for ${res.data.days} days`);
    await loadOverview();
  };

  const keep = async (id: string) => {
    const res = await keepQueuedImage(id);
    if (!res.success) toast.error(res.error);
    else toast.success(res.data.kept ? 'The image will be kept' : 'That image was already processed');
    await loadOverview();
  };

  return (
    <div className="space-y-6">
      {/* Primary Storage Switch & Consolidation */}
      <StorageProviderControl onRefresh={refresh} />

      {/* Usage per bucket */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(overview?.usage ?? []).map((u) => (
          <div key={u.bucket} className="rounded-xl border border-white/10 bg-gray-900/60 p-5">
            <div className="mb-2 flex items-center gap-3">
              <HardDrive className="h-5 w-5 text-blue-400" />
              <h3 className="font-medium text-gray-300">{BUCKET_LABELS[u.bucket]}</h3>
            </div>
            <p className="text-2xl font-bold text-white">{formatBytes(u.bytes)}</p>
            <p className="mt-1 text-xs text-gray-500">
              {u.objects} files · stored as {IMAGE_PRESETS[u.bucket].widths.join(' / ')}px WebP
            </p>
          </div>
        ))}
      </div>

      {/* Gallery */}
      <div className="rounded-xl border border-white/10 bg-gray-900/60 p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2" role="group" aria-label="Image bucket">
            {([MEDIA_BUCKETS.prize, MEDIA_BUCKETS.site] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => switchBucket(b)}
                aria-pressed={bucket === b}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  bucket === b ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {BUCKET_LABELS[b]}
              </button>
            ))}
          </div>
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 ${
              busy === 'upload' ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload to {BUCKET_LABELS[bucket]}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
              className="hidden"
              onChange={handleUpload}
              aria-label={`Upload to ${BUCKET_LABELS[bucket]}`}
            />
          </label>
        </div>

        {!listing ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-label="Loading images" />
          </div>
        ) : listing.images.length === 0 ? (
          <p className="py-12 text-center text-gray-500">No {BUCKET_LABELS[bucket].toLowerCase()} yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {listing.images.map((image) => (
              <div key={image.url} className="overflow-hidden rounded-lg border border-white/5 bg-gray-800">
                <div className="relative aspect-square">
                  <Image src={image.url} loader={mediaImageLoader} alt={image.name} fill sizes="160px" className="object-cover" />
                </div>
                <div className="space-y-1 p-2 text-xs">
                  <p className="text-gray-300">
                    {formatBytes(image.size)} · {formatDate(image.createdAt)}
                  </p>
                  {bucket === MEDIA_BUCKETS.prize && (
                    <p className={image.usedBy.length > 0 ? 'text-emerald-300' : 'text-gray-500'}>
                      {image.usedBy.length > 0 ? `Used by ${image.usedBy.map((p) => p.name).join(', ')}` : 'Not used by any prize'}
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => copyUrl(image.url)}
                      className="rounded bg-gray-700 p-1.5 text-gray-200 hover:bg-gray-600"
                      title="Copy link"
                      aria-label={`Copy link to ${image.name}`}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(image)}
                      disabled={busy === image.url || image.usedBy.length > 0}
                      className="rounded bg-red-500/20 p-1.5 text-red-300 hover:bg-red-500 hover:text-white disabled:opacity-40"
                      title={image.usedBy.length > 0 ? 'Change the prize image first' : 'Delete image'}
                      aria-label={`Delete ${image.name}`}
                    >
                      {busy === image.url ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {listing && <Pager page={page} total={listing.total} pageSize={listing.pageSize} onPage={setPage} />}
      </div>

      {/* Replaced prize images */}
      <div className="rounded-xl border border-white/10 bg-gray-900/60 p-6">
        <h3 className="text-lg font-semibold text-white">Replaced prize images</h3>
        <p className="mt-1 text-sm text-gray-400">
          When a prize image is changed or a prize is deleted, the old image is kept for a while (so a mistake can be
          undone) and then deleted automatically. Profile pictures are not kept: a player&apos;s old picture is deleted
          as soon as they change it.
        </p>
        <form onSubmit={saveRetention} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm text-gray-300">
            Keep replaced prize images for (days)
            <input
              type="number"
              min={0}
              max={365}
              step={1}
              required
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              className="mt-1 block w-32 rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-white"
            />
          </label>
          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
            Save
          </button>
        </form>

        {overview && overview.deletions.length === 0 && (
          <p className="mt-6 text-sm text-gray-500">No replaced prize images yet.</p>
        )}
        {overview && overview.deletions.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-400">
                <tr>
                  <th className="py-2 pr-4">Image</th>
                  <th className="py-2 pr-4">Why</th>
                  <th className="py-2 pr-4">Queued</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {overview.deletions.map((d) => (
                  <tr key={d.id} className="border-t border-white/5 text-gray-300">
                    <td className="py-2 pr-4">
                      <div className="relative h-10 w-10 overflow-hidden rounded bg-gray-800">
                        <Image src={d.url} loader={loaderFor(d.url)} alt="Queued prize image" fill sizes="40px" className="object-cover" />
                      </div>
                    </td>
                    <td className="py-2 pr-4">{REASON_LABELS[d.reason]}</td>
                    <td className="py-2 pr-4">{formatDate(d.createdAt)}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[d.status]}`}>
                        {d.status === 'pending'
                          ? `Deletes after ${formatDate(Date.parse(d.createdAt) + overview.retentionDays * DAY_MS)}`
                          : d.status}
                      </span>
                      {d.lastError && <p className="mt-1 text-xs text-red-300">{d.lastError}</p>}
                    </td>
                    <td className="py-2 text-right">
                      {d.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => keep(d.id)}
                          className="rounded bg-emerald-600/20 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-600 hover:text-white"
                        >
                          Keep
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
