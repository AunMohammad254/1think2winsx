'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  Check,
  CheckSquare,
  Copy,
  ExternalLink,
  Eye,
  HardDrive,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  IMAGE_PRESETS,
  MEDIA_BUCKETS,
  mediaImageLoader,
  mediaPublicUrl,
  mediaVariantPaths,
  parseMediaUrl,
  type MediaBucket,
} from '@/lib/media/config';
import { loaderFor } from '@/lib/cloudinary';
import {
  bulkDeleteMediaImages,
  deleteMediaImage,
  getMediaOverview,
  importMediaFromUrl,
  keepQueuedImage,
  listMediaImages,
  updatePrizeImageRetention,
  type MediaImage,
  type MediaImagePage,
  type MediaOverview,
} from '@/actions/supabase-media-actions';
import { transferSupabaseToCloudinary } from '@/actions/media-actions';
import StorageProviderControl from '@/components/admin/media/StorageProviderControl';
import { formatBytes, formatDate, Modal, Pager, plural } from './media-ui';

type AdminBucket = typeof MEDIA_BUCKETS.prize | typeof MEDIA_BUCKETS.site;
type UsageFilter = 'all' | 'used' | 'unused';
type SortKey = keyof typeof SORTS;

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

const SORTS = {
  newest: (a: MediaImage, b: MediaImage) => b.createdAt.localeCompare(a.createdAt),
  oldest: (a: MediaImage, b: MediaImage) => a.createdAt.localeCompare(b.createdAt),
  largest: (a: MediaImage, b: MediaImage) => b.size - a.size,
  smallest: (a: MediaImage, b: MediaImage) => a.size - b.size,
};

/** Every stored size of a listed image (listed URLs always parse: they are built from the bucket). */
function storedSizes(url: string) {
  const ref = parseMediaUrl(url)!;
  const widths = IMAGE_PRESETS[ref.bucket].widths;
  return mediaVariantPaths(ref).map((path, i) => ({ width: widths[i], path, url: mediaPublicUrl(ref.bucket, path) }));
}

/** /admin/media: admin-uploaded images (prize-images and site-media) and replaced-image cleanup. */
export default function SiteMediaManager() {
  const [overview, setOverview] = useState<MediaOverview | null>(null);
  const [bucket, setBucket] = useState<AdminBucket>(MEDIA_BUCKETS.prize);
  const [page, setPage] = useState(0);
  const [listing, setListing] = useState<MediaImagePage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [retention, setRetention] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [usageFilter, setUsageFilter] = useState<UsageFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('newest');

  const [previewImage, setPreviewImage] = useState<MediaImage | null>(null);
  const [transferringUrl, setTransferringUrl] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  // Copies to Cloudinary go to the folder matching the bucket
  const cloudFolder = bucket === MEDIA_BUCKETS.prize ? 'prizes' : 'site';

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

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadImages(), loadOverview()]);
    } finally {
      setRefreshing(false);
    }
  };

  const switchBucket = (next: AdminBucket) => {
    setBucket(next);
    setPage(0);
    setListing(null);
    setSearchQuery('');
    setUsageFilter('all');
    setSelectedUrls([]);
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

  const handleImportUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsImporting(true);
    try {
      const res = await importMediaFromUrl(importUrl.trim(), bucket);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Image imported into ${BUCKET_LABELS[bucket]}`);
      setImportUrl('');
      setIsImportModalOpen(false);
      await refresh();
    } finally {
      setIsImporting(false);
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
    if (previewImage?.url === image.url) setPreviewImage(null);
    await refresh();
  };

  const copyText = async (text: string, success: string, failure: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(success);
      return true;
    } catch {
      toast.error(failure);
      return false;
    }
  };

  const copyUrl = async (url: string) => {
    if (!(await copyText(url, 'Link copied', 'Could not copy the link'))) return;
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleTransferToCloudinary = async (image: MediaImage) => {
    setTransferringUrl(image.url);
    try {
      const res = await transferSupabaseToCloudinary(image.url, cloudFolder);
      if (res.success) toast.success(`Copied to Cloudinary as "${res.publicId}"`);
      else toast.error(res.error);
    } finally {
      setTransferringUrl(null);
    }
  };

  const toggleSelect = (url: string) => {
    setSelectedUrls((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]));
  };

  const clearSelection = () => setSelectedUrls([]);

  const handleBulkCopyUrls = () =>
    copyText(selectedUrls.join('\n'), `Copied ${plural(selectedUrls.length, 'link')} to clipboard`, 'Failed to copy links');

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${plural(selectedUrls.length, 'image')}? Images a prize still shows are kept.`)) return;
    setIsBulkBusy(true);
    try {
      const res = await bulkDeleteMediaImages(selectedUrls);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const { deletedCount, skipped } = res.data;
      if (deletedCount > 0) toast.success(`Deleted ${plural(deletedCount, 'image')}`);
      if (skipped.length > 0) {
        toast.error(`Skipped ${plural(skipped.length, 'image')}: ${[...new Set(skipped.map((s) => s.reason))].join('; ')}`);
      }
      clearSelection();
      await refresh();
    } finally {
      setIsBulkBusy(false);
    }
  };

  const handleBulkTransferToCloudinary = async () => {
    const urls = selectedUrls;
    setIsBulkBusy(true);
    let copied = 0;
    try {
      for (const [i, url] of urls.entries()) {
        setBulkProgress(`Copying ${i + 1} of ${urls.length}...`);
        if ((await transferSupabaseToCloudinary(url, cloudFolder)).success) copied++;
      }
    } finally {
      setIsBulkBusy(false);
      setBulkProgress(null);
    }
    if (copied > 0) toast.success(`Copied ${plural(copied, 'image')} to Cloudinary (${cloudFolder}/)`);
    if (copied < urls.length) toast.error(`Could not copy ${plural(urls.length - copied, 'image')}`);
    clearSelection();
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

  const displayedImages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (listing?.images ?? [])
      .filter((img) => !q || img.name.toLowerCase().includes(q) || img.usedBy.some((p) => p.name.toLowerCase().includes(q)))
      .filter((img) => usageFilter === 'all' || (usageFilter === 'used') === img.usedBy.length > 0)
      .sort(SORTS[sortBy]);
  }, [listing, searchQuery, usageFilter, sortBy]);

  const isAllSelected = displayedImages.length > 0 && selectedUrls.length === displayedImages.length;

  return (
    <div className="space-y-6">
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
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Image bucket">
            {([MEDIA_BUCKETS.prize, MEDIA_BUCKETS.site] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => switchBucket(b)}
                aria-pressed={bucket === b}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  bucket === b ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {BUCKET_LABELS[b]}
              </button>
            ))}
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-gray-800/80 px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-blue-400' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-600/20 px-3.5 py-2 text-sm font-medium text-purple-300 hover:bg-purple-600/30"
            >
              <Link2 className="h-4 w-4 text-purple-400" />
              Import from URL
            </button>
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
        </div>

        {/* Search, usage filter and sort */}
        {listing && listing.images.length > 0 && (
          <div className="mb-6 flex flex-col justify-between gap-3 border-t border-white/5 pt-2 md:flex-row md:items-center">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[200px]">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search filename or prize..."
                  aria-label="Search images"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-gray-800 py-1.5 pl-8 pr-7 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-2 text-gray-400 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {bucket === MEDIA_BUCKETS.prize && (
                <select
                  aria-label="Filter by use"
                  value={usageFilter}
                  onChange={(e) => setUsageFilter(e.target.value as UsageFilter)}
                  className="rounded-lg border border-white/10 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
                >
                  <option value="all">All Usage</option>
                  <option value="used">Used by Prize</option>
                  <option value="unused">Unused (Orphaned)</option>
                </select>
              )}
              <select
                aria-label="Sort images"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="rounded-lg border border-white/10 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="largest">Largest size</option>
                <option value="smallest">Smallest size</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={isAllSelected ? clearSelection : () => setSelectedUrls(displayedImages.map((img) => img.url))}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  isAllSelected
                    ? 'border-blue-500/40 bg-blue-600/20 text-blue-300 hover:bg-blue-600/30'
                    : 'border-white/10 bg-gray-800 text-gray-300 hover:text-white'
                }`}
              >
                {isAllSelected ? <CheckSquare className="h-3.5 w-3.5 text-blue-400" /> : <Square className="h-3.5 w-3.5" />}
                {isAllSelected ? 'Deselect All' : `Select All (${displayedImages.length})`}
              </button>
              <span className="text-xs text-gray-400">
                Showing {displayedImages.length} of {listing.images.length} images
              </span>
            </div>
          </div>
        )}

        {!listing ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-label="Loading images" />
          </div>
        ) : listing.images.length === 0 ? (
          <p className="py-12 text-center text-gray-500">No {BUCKET_LABELS[bucket].toLowerCase()} yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {displayedImages.map((image) => {
              const isSelected = selectedUrls.includes(image.url);
              const inUse = image.usedBy.length > 0;
              return (
                <div
                  key={image.url}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-lg border ${
                    isSelected ? 'border-blue-500 bg-blue-950/20 ring-2 ring-blue-500/30' : 'border-white/5 bg-gray-800 hover:border-blue-500/30'
                  }`}
                >
                  <div className="relative aspect-square overflow-hidden bg-gray-900/50">
                    <button
                      type="button"
                      onClick={() => toggleSelect(image.url)}
                      className={`absolute left-2 top-2 z-20 rounded-lg p-1.5 backdrop-blur-md ${
                        isSelected ? 'bg-blue-600 text-white' : 'bg-black/60 text-gray-400 opacity-0 hover:text-white group-hover:opacity-100'
                      }`}
                      aria-label={`${isSelected ? 'Deselect' : 'Select'} ${image.name}`}
                    >
                      {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                    <Image
                      src={image.url}
                      loader={mediaImageLoader}
                      alt={image.name}
                      fill
                      sizes="160px"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <button
                      type="button"
                      onClick={() => setPreviewImage(image)}
                      aria-label={`Inspect ${image.name}`}
                      className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <span className="rounded-full bg-black/60 p-2 hover:bg-blue-600">
                        <Eye className="h-4 w-4" />
                      </span>
                    </button>
                  </div>

                  <div className="space-y-1 p-2.5 text-xs">
                    <p className="truncate font-mono text-[11px] text-gray-300" title={image.name}>
                      {image.name.split('/').pop()}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {formatBytes(image.size)} · {formatDate(image.createdAt)}
                    </p>
                    {bucket === MEDIA_BUCKETS.prize && (
                      <p className={`truncate text-[11px] ${inUse ? 'text-emerald-300' : 'text-gray-500'}`}>
                        {inUse ? `Used by ${image.usedBy.map((p) => p.name).join(', ')}` : 'Not used by any prize'}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 border-t border-white/5 pt-1.5">
                      <button
                        type="button"
                        onClick={() => copyUrl(image.url)}
                        className="rounded bg-gray-700/80 p-1.5 text-gray-200 hover:bg-gray-600"
                        title="Copy link"
                        aria-label={`Copy link to ${image.name}`}
                      >
                        {copiedUrl === image.url ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTransferToCloudinary(image)}
                        disabled={transferringUrl === image.url}
                        className="rounded bg-purple-500/20 p-1.5 text-purple-300 hover:bg-purple-500 hover:text-white disabled:opacity-50"
                        title="Copy to Cloudinary"
                        aria-label={`Copy ${image.name} to Cloudinary`}
                      >
                        {transferringUrl === image.url ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(image)}
                        disabled={busy === image.url || inUse}
                        className="ml-auto rounded bg-red-500/20 p-1.5 text-red-300 hover:bg-red-500 hover:text-white disabled:opacity-40"
                        title={inUse ? 'Change the prize image first' : 'Delete image'}
                        aria-label={`Delete ${image.name}`}
                      >
                        {busy === image.url ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {listing && (
          <Pager
            page={page}
            total={listing.total}
            pageSize={listing.pageSize}
            onPage={(p) => {
              setPage(p);
              clearSelection();
            }}
          />
        )}
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

      {/* Image details and its stored WebP sizes */}
      {previewImage && (
        <Modal title="Image details" onClose={() => setPreviewImage(null)}>
          <div className="relative mb-4 aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black/60">
            <Image src={previewImage.url} loader={mediaImageLoader} alt={`Preview of ${previewImage.name}`} fill className="object-contain" />
          </div>
          <dl className="mb-4 space-y-2 rounded-xl border border-white/5 bg-gray-800/40 p-4 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-400">Object name</dt>
              <dd className="select-all text-white">{previewImage.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-400">Largest size</dt>
              <dd className="text-white">{formatBytes(previewImage.size)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-400">Bucket</dt>
              <dd className="text-white">{bucket}</dd>
            </div>
            {previewImage.usedBy.length > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-gray-400">Used by</dt>
                <dd className="text-emerald-300">{previewImage.usedBy.map((p) => p.name).join(', ')}</dd>
              </div>
            )}
          </dl>

          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Stored sizes</h4>
          <ul className="mb-5 space-y-2">
            {storedSizes(previewImage.url).map((v) => (
              <li key={v.width} className="flex items-center justify-between gap-2 rounded-lg bg-gray-800/60 p-2 font-mono text-xs">
                <span className="font-semibold text-blue-400">{v.width}px</span>
                <span className="max-w-[240px] truncate text-gray-400">{v.path}</span>
                <button
                  type="button"
                  onClick={() => copyUrl(v.url)}
                  aria-label={`Copy link to the ${v.width}px size`}
                  className="flex items-center gap-1 rounded bg-gray-700 px-2 py-1 text-gray-200 hover:bg-gray-600"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
            <a
              href={previewImage.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-700"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in new tab
            </a>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTransferToCloudinary(previewImage)}
                disabled={transferringUrl === previewImage.url}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600/30 px-3 py-2 text-xs font-medium text-purple-300 hover:bg-purple-600/50 disabled:opacity-50"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Copy to Cloudinary
              </button>
              <button
                type="button"
                onClick={() => handleDelete(previewImage)}
                disabled={previewImage.usedBy.length > 0}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500 hover:text-white disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Import an image from a link */}
      {isImportModalOpen && (
        <Modal title="Import from URL" onClose={() => setIsImportModalOpen(false)}>
          <form onSubmit={handleImportUrl} className="space-y-4">
            <label className="block text-xs font-medium text-gray-300">
              Image link (https)
              <input
                type="url"
                required
                placeholder="https://example.com/photo.jpg"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-2 font-mono text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
            </label>
            <p className="rounded-lg bg-gray-800/40 p-3 text-xs text-gray-400">
              Saved to {BUCKET_LABELS[bucket]} as {IMAGE_PRESETS[bucket].widths.join(' / ')}px WebP. JPEG, PNG, WebP,
              AVIF or GIF, up to 10 MB.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isImporting}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              >
                {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isImporting ? 'Importing...' : 'Import'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Bulk actions for the selected images */}
      {selectedUrls.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-white/20 bg-gray-900/95 px-5 py-3 text-sm shadow-2xl backdrop-blur-md">
          <span className="font-semibold text-white">{plural(selectedUrls.length, 'image')} selected</span>
          <button
            type="button"
            onClick={handleBulkTransferToCloudinary}
            disabled={isBulkBusy}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {bulkProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
            {bulkProgress ?? 'Copy to Cloudinary'}
          </button>
          <button
            type="button"
            onClick={handleBulkCopyUrls}
            className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy Links
          </button>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={isBulkBusy}
            className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500 hover:text-white disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Selected
          </button>
          <button type="button" onClick={clearSelection} className="rounded-lg p-1 text-gray-400 hover:text-white" aria-label="Clear selection">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
