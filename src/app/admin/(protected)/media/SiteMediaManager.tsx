'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import {
  Copy,
  HardDrive,
  Loader2,
  Trash2,
  Upload,
  ArrowRightLeft,
  Search,
  X,
  Eye,
  ExternalLink,
  RefreshCw,
  Check,
  Link2,
} from 'lucide-react';
import { IMAGE_PRESETS, MEDIA_BUCKETS, mediaImageLoader, type MediaBucket, parseMediaUrl, mediaPublicUrl } from '@/lib/media/config';
import { loaderFor } from '@/lib/cloudinary';
import {
  deleteMediaImage,
  getMediaOverview,
  keepQueuedImage,
  listMediaImages,
  updatePrizeImageRetention,
  importMediaFromUrl,
  type MediaImage,
  type MediaImagePage,
  type MediaOverview,
} from '@/actions/supabase-media-actions';
import { transferSupabaseToCloudinary } from '@/actions/media-actions';
import { formatBytes, formatDate, Pager } from './media-ui';

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
  const [refreshing, setRefreshing] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [usageFilter, setUsageFilter] = useState<'all' | 'used' | 'unused'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'largest' | 'smallest'>('newest');

  // Preview / Details Modal
  const [previewImage, setPreviewImage] = useState<MediaImage | null>(null);

  // Transfer to Cloudinary State
  const [transferringUrl, setTransferringUrl] = useState<string | null>(null);

  // Import from URL modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // Copy URL state
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

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
    if (!importUrl.trim()) return;

    setIsImporting(true);
    try {
      const res = await importMediaFromUrl(importUrl.trim(), bucket);
      if (res.success) {
        toast.success(`Image imported successfully into ${BUCKET_LABELS[bucket]}!`);
        setImportUrl('');
        setIsImportModalOpen(false);
        await refresh();
      } else {
        toast.error(res.error || 'Import failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to import image');
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

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      toast.success('Link copied');
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const handleTransferToCloudinary = async (image: MediaImage) => {
    setTransferringUrl(image.url);
    try {
      const folder = bucket === MEDIA_BUCKETS.prize ? 'prizes' : 'site';
      const res = await transferSupabaseToCloudinary(image.url, folder);
      if (res.success && res.publicId) {
        toast.success(`Transferred to Cloudinary as "${res.publicId}"!`);
      } else {
        toast.error(res.error || 'Transfer failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error transferring to Cloudinary');
    } finally {
      setTransferringUrl(null);
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

  // Filtered & Sorted Images
  const displayedImages = useMemo(() => {
    if (!listing?.images) return [];
    let list = [...listing.images];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((img) => {
        const matchesName = img.name.toLowerCase().includes(q);
        const matchesPrize = img.usedBy?.some((p) => p.name.toLowerCase().includes(q));
        return matchesName || matchesPrize;
      });
    }

    if (usageFilter === 'used') {
      list = list.filter((img) => img.usedBy && img.usedBy.length > 0);
    } else if (usageFilter === 'unused') {
      list = list.filter((img) => !img.usedBy || img.usedBy.length === 0);
    }

    list.sort((a, b) => {
      if (sortBy === 'newest') return (b.createdAt || '').localeCompare(a.createdAt || '');
      if (sortBy === 'oldest') return (a.createdAt || '').localeCompare(b.createdAt || '');
      if (sortBy === 'largest') return (b.size || 0) - (a.size || 0);
      if (sortBy === 'smallest') return (a.size || 0) - (b.size || 0);
      return 0;
    });

    return list;
  }, [listing?.images, searchQuery, usageFilter, sortBy]);

  // Compute preset variant paths for preview modal
  const getVariants = (url: string) => {
    const ref = parseMediaUrl(url);
    if (!ref) return [];
    const preset = IMAGE_PRESETS[ref.bucket];
    const base = ref.path.replace(/-\d+\.webp$/, '');
    return preset.widths.map((w) => ({
      width: w,
      path: `${base}-${w}.webp`,
      url: mediaPublicUrl(ref.bucket, `${base}-${w}.webp`),
    }));
  };

  return (
    <div className="space-y-6">
      {/* Usage per bucket */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(overview?.usage ?? []).map((u) => (
          <div key={u.bucket} className="rounded-xl border border-white/10 bg-gray-900/60 p-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HardDrive className="h-5 w-5 text-blue-400" />
                <h3 className="font-medium text-gray-300">{BUCKET_LABELS[u.bucket]}</h3>
              </div>
            </div>
            <p className="text-2xl font-bold text-white">{formatBytes(u.bytes)}</p>
            <p className="mt-1 text-xs text-gray-500">
              {u.objects} files · stored as {IMAGE_PRESETS[u.bucket].widths.join(' / ')}px WebP
            </p>
          </div>
        ))}
      </div>

      {/* Gallery Header and Controls */}
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
              className="rounded-lg border border-white/10 bg-gray-800/80 px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 flex items-center gap-1.5"
              title="Refresh images"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-blue-400' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-600/20 px-3.5 py-2 text-sm font-medium text-purple-300 hover:bg-purple-600/30 transition-colors"
            >
              <Link2 className="h-4 w-4 text-purple-400" />
              Import from URL
            </button>

            <label
              className={`flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors ${
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

        {/* Search, Usage Filter, and Sort Toolbar */}
        {listing && listing.images.length > 0 && (
          <div className="mb-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2 border-t border-white/5">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[200px]">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search filename or prize..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-gray-800 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2 text-gray-400 hover:text-white">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {bucket === MEDIA_BUCKETS.prize && (
                <select
                  value={usageFilter}
                  onChange={(e) => setUsageFilter(e.target.value as any)}
                  className="bg-gray-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Usage</option>
                  <option value="used">Used by Prize</option>
                  <option value="unused">Unused (Orphaned)</option>
                </select>
              )}

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-gray-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="largest">Largest size</option>
                <option value="smallest">Smallest size</option>
              </select>
            </div>

            <div className="text-xs text-gray-400 flex items-center gap-1.5">
              <span>Showing {displayedImages.length} of {listing.images.length} images</span>
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
              const isCopied = copiedUrl === image.url;
              const isTransferring = transferringUrl === image.url;

              return (
                <div
                  key={image.url}
                  className="group relative overflow-hidden rounded-lg border border-white/5 bg-gray-800 transition-all hover:border-blue-500/30 hover:shadow-lg flex flex-col justify-between"
                >
                  <div className="relative aspect-square overflow-hidden bg-gray-900/50">
                    <Image
                      src={image.url}
                      loader={mediaImageLoader}
                      alt={image.name}
                      fill
                      sizes="160px"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />

                    {/* Quick Preview Button */}
                    <button
                      type="button"
                      onClick={() => setPreviewImage(image)}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                      title="Inspect Image & Variants"
                    >
                      <span className="p-2 bg-black/60 rounded-full hover:bg-blue-600 transition-colors">
                        <Eye className="h-4 w-4" />
                      </span>
                    </button>
                  </div>

                  <div className="space-y-1 p-2.5 text-xs">
                    <p className="text-gray-300 truncate font-mono text-[11px]" title={image.name}>
                      {image.name.split('/').pop()}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {formatBytes(image.size)} · {formatDate(image.createdAt)}
                    </p>
                    {bucket === MEDIA_BUCKETS.prize && (
                      <p className={`text-[11px] truncate ${image.usedBy.length > 0 ? 'text-emerald-300' : 'text-gray-500'}`}>
                        {image.usedBy.length > 0 ? `Used by ${image.usedBy.map((p) => p.name).join(', ')}` : 'Not used by any prize'}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 pt-1.5 border-t border-white/5">
                      <button
                        type="button"
                        onClick={() => copyUrl(image.url)}
                        className="rounded bg-gray-700/80 p-1.5 text-gray-200 hover:bg-gray-600 transition-colors"
                        title="Copy link"
                        aria-label={`Copy link to ${image.name}`}
                      >
                        {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>

                      {/* Transfer to Cloudinary */}
                      <button
                        type="button"
                        onClick={() => handleTransferToCloudinary(image)}
                        disabled={isTransferring}
                        className="rounded bg-purple-500/20 p-1.5 text-purple-300 hover:bg-purple-500 hover:text-white transition-colors disabled:opacity-50"
                        title="Transfer to Cloudinary"
                        aria-label={`Transfer ${image.name} to Cloudinary`}
                      >
                        {isTransferring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(image)}
                        disabled={busy === image.url || image.usedBy.length > 0}
                        className="rounded bg-red-500/20 p-1.5 text-red-300 hover:bg-red-500 hover:text-white disabled:opacity-40 transition-colors ml-auto"
                        title={image.usedBy.length > 0 ? 'Change the prize image first' : 'Delete image'}
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
          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors">
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
                          className="rounded bg-emerald-600/20 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-600 hover:text-white transition-colors"
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

      {/* Modal: High-Res Preview & WebP Variants Inspector */}
      {previewImage && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/15 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4">Supabase Media Inspector</h3>

            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black/60 border border-white/10 mb-4">
              <Image
                src={previewImage.url}
                loader={mediaImageLoader}
                alt={previewImage.name}
                fill
                className="object-contain"
              />
            </div>

            <div className="space-y-3 bg-gray-800/40 p-4 rounded-xl border border-white/5 text-xs font-mono mb-4">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-gray-400">Object Name:</span>
                <span className="text-white select-all">{previewImage.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-gray-400">Canonical Size:</span>
                <span className="text-white">{formatBytes(previewImage.size)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-gray-400">Bucket:</span>
                <span className="text-white">{bucket}</span>
              </div>
              {previewImage.usedBy && previewImage.usedBy.length > 0 && (
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-gray-400">Associated Prizes:</span>
                  <span className="text-emerald-300">{previewImage.usedBy.map((p) => p.name).join(', ')}</span>
                </div>
              )}
            </div>

            {/* Stored WebP Variants */}
            <div className="mb-5">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Stored WebP Width Variants ({IMAGE_PRESETS[bucket].widths.join(', ')} px)
              </h4>
              <div className="space-y-2">
                {getVariants(previewImage.url).map((v) => (
                  <div key={v.width} className="flex items-center justify-between p-2 bg-gray-800/60 rounded-lg text-xs font-mono">
                    <span className="text-blue-400 font-semibold">{v.width}px</span>
                    <span className="text-gray-400 truncate max-w-[240px] select-all">{v.path}</span>
                    <button
                      onClick={() => copyUrl(v.url)}
                      className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded flex items-center gap-1"
                    >
                      <Copy className="h-3 w-3" />
                      Copy
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyUrl(previewImage.url)}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Canonical URL
                </button>
                <a
                  href={previewImage.url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in New Tab
                </a>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTransferToCloudinary(previewImage)}
                  disabled={transferringUrl === previewImage.url}
                  className="px-3 py-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  {transferringUrl === previewImage.url ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  )}
                  Transfer to Cloudinary
                </button>
                <button
                  onClick={() => handleDelete(previewImage)}
                  disabled={previewImage.usedBy && previewImage.usedBy.length > 0}
                  className="px-3 py-2 bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Import from URL into Supabase */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/15 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsImportModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <Link2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Import from URL</h3>
                <p className="text-xs text-gray-400">
                  Download an image from the web or Cloudinary into {BUCKET_LABELS[bucket]}.
                </p>
              </div>
            </div>

            <form onSubmit={handleImportUrl} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Image URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://...jpg or https://res.cloudinary.com/..."
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              <div className="bg-gray-800/40 p-3 rounded-lg text-xs text-gray-400">
                <p>
                  Target bucket: <span className="text-white font-medium">{BUCKET_LABELS[bucket]}</span>
                </p>
                <p className="mt-1">
                  Preset WebP widths: {IMAGE_PRESETS[bucket].widths.join(', ')} px
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isImporting || !importUrl.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Importing...
                    </>
                  ) : (
                    'Import & Process'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
