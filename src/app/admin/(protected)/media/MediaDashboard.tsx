'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CldImage } from 'next-cloudinary';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  CheckSquare,
  Copy,
  ExternalLink,
  Eye,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  bulkDeleteCloudinaryResources,
  deleteCloudinaryResource,
  getCloudinaryResources,
  getCloudinaryUsage,
  getSupabaseMediaForPicker,
  transferCloudinaryToSupabase,
  transferSupabaseToCloudinary,
  type CloudinaryAsset,
  type CloudinaryUsage,
  type PickerImage,
} from '@/actions/media-actions';
import { CLOUDINARY_CLOUD_NAME } from '@/lib/cloudinary';
import { MEDIA_BUCKETS } from '@/lib/media/config';
import StorageProviderControl from '@/components/admin/media/StorageProviderControl';
import { formatBytes, Modal, plural } from './media-ui';

type AdminBucket = typeof MEDIA_BUCKETS.prize | typeof MEDIA_BUCKETS.site;
type SortKey = keyof typeof SORTS;

const UPLOAD_FOLDERS = ['prizes', 'site', 'banners', 'uploads'];

const SORTS = {
  newest: (a: CloudinaryAsset, b: CloudinaryAsset) => (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  oldest: (a: CloudinaryAsset, b: CloudinaryAsset) => (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  largest: (a: CloudinaryAsset, b: CloudinaryAsset) => (b.bytes ?? 0) - (a.bytes ?? 0),
  smallest: (a: CloudinaryAsset, b: CloudinaryAsset) => (a.bytes ?? 0) - (b.bytes ?? 0),
};

const cdnUrl = (asset: CloudinaryAsset) =>
  `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/q_auto,f_auto/${asset.public_id}.${asset.format ?? 'webp'}`;

/**
 * The three usage tiles. Plans with fixed limits report a limit per metric; credit plans report
 * only a shared credit pool, so a tile without its own limit shows the pool and no bar.
 */
function usageTiles(usage: CloudinaryUsage) {
  const mb = (bytes = 0) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  const percent = (metric?: { usage?: number; limit?: number }) =>
    metric?.limit ? Math.min(100, ((metric.usage ?? 0) / metric.limit) * 100) : null;
  const pool = usage.credits?.limit ? `shared pool of ${usage.credits.limit.toLocaleString()} credits` : 'no fixed limit';
  const gbLimit = (metric?: { limit?: number }) =>
    metric?.limit ? `of ${(metric.limit / (1024 * 1024 * 1024)).toFixed(2)} GB limit` : pool;
  return [
    { label: 'Storage used', icon: HardDrive, bar: 'bg-blue-500', value: mb(usage.storage?.usage), detail: gbLimit(usage.storage), percent: percent(usage.storage) },
    { label: 'Bandwidth (30 days)', icon: Zap, bar: 'bg-yellow-500', value: mb(usage.bandwidth?.usage), detail: gbLimit(usage.bandwidth), percent: percent(usage.bandwidth) },
    {
      label: 'Transformations',
      icon: ImageIcon,
      bar: 'bg-emerald-500',
      value: (usage.transformations?.usage ?? 0).toLocaleString(),
      detail: usage.transformations?.limit ? `of ${usage.transformations.limit.toLocaleString()} limit` : pool,
      percent: percent(usage.transformations) ?? usage.credits?.used_percent ?? null,
    },
  ];
}

/** /admin/media/cloudinary: images uploaded to Cloudinary, and copies to and from Supabase Storage. */
export default function MediaDashboard() {
  const [usage, setUsage] = useState<CloudinaryUsage | null>(null);
  const [assets, setAssets] = useState<CloudinaryAsset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [format, setFormat] = useState('all');
  const [sortBy, setSortBy] = useState<SortKey>('newest');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [previewAsset, setPreviewAsset] = useState<CloudinaryAsset | null>(null);

  // Copy to Supabase, for one asset or the selection
  const [transferIds, setTransferIds] = useState<string[] | null>(null);
  const [transferBucket, setTransferBucket] = useState<AdminBucket>(MEDIA_BUCKETS.prize);
  const [transferProgress, setTransferProgress] = useState<string | null>(null);
  const [transferredUrls, setTransferredUrls] = useState<string[]>([]);

  // Copy from Supabase
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [pickerImages, setPickerImages] = useState<PickerImage[] | null>(null);
  const [importFolder, setImportFolder] = useState('prizes');
  const [customUrl, setCustomUrl] = useState('');
  const [importingUrl, setImportingUrl] = useState<string | null>(null);

  // Upload straight to Cloudinary
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFolder, setUploadFolder] = useState('prizes');
  const [isUploading, setIsUploading] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const [usageRes, assetsRes] = await Promise.all([getCloudinaryUsage(), getCloudinaryResources()]);
    if (usageRes.success) setUsage(usageRes.usage);
    if (assetsRes.success) {
      setAssets(assetsRes.assets);
      setNextCursor(assetsRes.nextCursor);
    }
    const failure = !usageRes.success ? usageRes.error : !assetsRes.success ? assetsRes.error : null;
    setError(failure);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const loadMore = async () => {
    const res = await getCloudinaryResources(nextCursor!);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setAssets((prev) => [...prev, ...res.assets]);
    setNextCursor(res.nextCursor);
  };

  const formats = useMemo(() => [...new Set(assets.flatMap((a) => (a.format ? [a.format.toLowerCase()] : [])))], [assets]);

  const shown = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assets
      .filter((a) => !q || a.public_id.toLowerCase().includes(q))
      .filter((a) => format === 'all' || a.format?.toLowerCase() === format)
      .sort(SORTS[sortBy]);
  }, [assets, searchQuery, format, sortBy]);

  const isAllSelected = shown.length > 0 && selectedIds.length === shown.length;
  const removeAssets = (ids: string[]) => {
    setAssets((prev) => prev.filter((a) => !ids.includes(a.public_id)));
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
  };

  const copyText = async (text: string, success: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(success);
      return true;
    } catch {
      toast.error('Could not copy to the clipboard');
      return false;
    }
  };

  const copyAssetUrl = async (asset: CloudinaryAsset) => {
    if (!(await copyText(cdnUrl(asset), 'Link copied'))) return;
    setCopiedId(asset.public_id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (publicId: string) => {
    if (!confirm('Delete this image from Cloudinary? This cannot be undone.')) return;
    setDeletingId(publicId);
    try {
      const res = await deleteCloudinaryResource(publicId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success('Image deleted from Cloudinary');
      removeAssets([publicId]);
      if (previewAsset?.public_id === publicId) setPreviewAsset(null);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${plural(selectedIds.length, 'image')} from Cloudinary? This cannot be undone.`)) return;
    const res = await bulkDeleteCloudinaryResources(selectedIds);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    removeAssets(res.deleted);
    if (res.deleted.length > 0) toast.success(`Deleted ${plural(res.deleted.length, 'image')} from Cloudinary`);
    if (res.skipped.length > 0) {
      toast.error(`Kept ${plural(res.skipped.length, 'image')}: ${[...new Set(res.skipped.map((s) => s.reason))].join('; ')}`);
    }
  };

  const openTransfer = (ids: string[]) => {
    setTransferIds(ids);
    setTransferredUrls([]);
  };

  const runTransfer = async (ids: string[]) => {
    const urls: string[] = [];
    try {
      for (const [i, id] of ids.entries()) {
        setTransferProgress(`Copying ${i + 1} of ${ids.length}...`);
        const res = await transferCloudinaryToSupabase(id, transferBucket);
        if (res.success) urls.push(res.url);
      }
    } finally {
      setTransferProgress(null);
    }
    setTransferredUrls(urls);
    if (urls.length > 0) toast.success(`Copied ${plural(urls.length, 'image')} to Supabase (${transferBucket})`);
    if (urls.length < ids.length) toast.error(`Could not copy ${plural(ids.length - urls.length, 'image')}`);
    setSelectedIds([]);
  };

  const openImport = async () => {
    setIsImportOpen(true);
    setPickerImages(null);
    const res = await getSupabaseMediaForPicker();
    if (res.success) setPickerImages(res.images);
    else {
      toast.error(res.error);
      setPickerImages([]);
    }
  };

  const importToCloudinary = async (url: string) => {
    setImportingUrl(url);
    try {
      const res = await transferSupabaseToCloudinary(url, importFolder.trim());
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Copied to Cloudinary as "${res.publicId}"`);
      setIsImportOpen(false);
      setCustomUrl('');
      await refresh();
    } finally {
      setImportingUrl(null);
    }
  };

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const file = uploadInput.current?.files?.[0];
    if (!file) {
      toast.error('Choose an image to upload');
      return;
    }
    const body = new FormData();
    body.append('file', file);
    body.append('target', 'cloudinary');
    body.append('folder', uploadFolder);
    setIsUploading(true);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast.success(`Uploaded "${data.resource.publicId}" to Cloudinary`);
      setIsUploadOpen(false);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-label="Loading Cloudinary images" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            Cloudinary (old uploads)
            {usage?.plan && (
              <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                {usage.plan} plan
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            Images uploaded before the move to Supabase Storage. Their links keep working; new uploads go to Supabase.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-300 hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-blue-400' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openImport}
            className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-600/20 px-3.5 py-2 text-sm font-medium text-purple-300 hover:bg-purple-600/30"
          >
            <ArrowRightLeft className="h-4 w-4" />
            Copy from Supabase
          </button>
          <button
            type="button"
            onClick={() => setIsUploadOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            <Upload className="h-4 w-4" />
            Upload to Cloudinary
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/15 p-4 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <StorageProviderControl onRefresh={refresh} />

      {usage && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {usageTiles(usage).map((tile) => (
            <div key={tile.label} className="rounded-xl border border-white/10 bg-gray-900/60 p-5">
              <div className="mb-2 flex items-center gap-3">
                <tile.icon className="h-5 w-5 text-gray-300" />
                <h3 className="font-medium text-gray-300">{tile.label}</h3>
              </div>
              <p className="text-2xl font-bold text-white">{tile.value}</p>
              <p className="mt-1 text-xs text-gray-500">{tile.detail}</p>
              {tile.percent !== null && (
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-800">
                  <div
                    role="meter"
                    aria-label={`${tile.label} of limit`}
                    aria-valuenow={Math.round(tile.percent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className={`h-2 rounded-full ${tile.bar}`}
                    style={{ width: `${tile.percent.toFixed(1)}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Gallery */}
      <div className="rounded-xl border border-white/10 bg-gray-900/60 p-6">
        <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white">Images</h3>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-400">
              {shown.length} of {assets.length}
            </span>
            {shown.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(isAllSelected ? [] : shown.map((a) => a.public_id))}
                className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300"
              >
                {isAllSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                {isAllSelected ? 'Deselect All' : `Select All (${shown.length})`}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search public ID..."
                aria-label="Search public ID"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-gray-800/80 py-1.5 pl-9 pr-8 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-2.5 text-gray-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {formats.length > 0 && (
              <select
                aria-label="Filter by format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="rounded-lg border border-white/10 bg-gray-800/80 px-3 py-1.5 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All formats</option>
                {formats.map((f) => (
                  <option key={f} value={f}>
                    .{f}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Sort images"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-lg border border-white/10 bg-gray-800/80 px-3 py-1.5 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="largest">Largest size</option>
              <option value="smallest">Smallest size</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          {shown.map((asset) => {
            const id = asset.public_id;
            const isSelected = selectedIds.includes(id);
            return (
              <div
                key={id}
                className={`group relative flex aspect-square flex-col justify-end overflow-hidden rounded-lg border bg-gray-800/90 ${
                  isSelected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-white/10 hover:border-blue-500/40'
                }`}
              >
                <CldImage src={id} alt={id} fill className="object-cover" sizes="(max-width: 768px) 50vw, 20vw" />
                <button
                  type="button"
                  onClick={() => setSelectedIds((prev) => (isSelected ? prev.filter((x) => x !== id) : [...prev, id]))}
                  aria-label={`${isSelected ? 'Deselect' : 'Select'} ${id}`}
                  className={`absolute left-2 top-2 z-30 rounded-md p-1 ${
                    isSelected ? 'bg-blue-600 text-white' : 'bg-black/60 text-gray-300 opacity-0 group-hover:opacity-100'
                  }`}
                >
                  {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                </button>
                <span className="pointer-events-none absolute right-2 top-2 z-10 rounded border border-white/10 bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">
                  {(asset.format ?? 'img').toUpperCase()} · {formatBytes(asset.bytes ?? 0)}
                </span>
                <div className="absolute inset-0 z-20 flex items-center justify-center gap-1.5 bg-black/75 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => copyAssetUrl(asset)}
                    aria-label={`Copy link to ${id}`}
                    className="rounded-lg bg-white/10 p-2 text-gray-200 hover:bg-white/20"
                  >
                    {copiedId === id ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewAsset(asset)}
                    aria-label={`Details of ${id}`}
                    className="rounded-lg bg-white/10 p-2 text-blue-400 hover:bg-white/20"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openTransfer([id])}
                    aria-label={`Copy ${id} to Supabase`}
                    className="rounded-lg bg-purple-500/20 p-2 text-purple-300 hover:bg-purple-500/30"
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(id)}
                    disabled={deletingId === id}
                    aria-label={`Delete ${id}`}
                    className="rounded-lg bg-red-500/20 p-2 text-red-400 hover:bg-red-500 hover:text-white disabled:opacity-50"
                  >
                    {deletingId === id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            );
          })}
          {shown.length === 0 && (
            <p className="col-span-full py-16 text-center text-gray-500">
              {assets.length > 0 ? 'No images match the search or format.' : 'No images in Cloudinary.'}
            </p>
          )}
        </div>
        {nextCursor && (
          <div className="mt-6 flex justify-center">
            <button type="button" onClick={loadMore} className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">
              Load more
            </button>
          </div>
        )}
      </div>

      {/* Bulk actions for the selected images */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-white/20 bg-gray-900/95 px-5 py-3 text-sm shadow-2xl backdrop-blur-md">
          <span className="font-semibold text-white">{plural(selectedIds.length, 'image')} selected</span>
          <button
            type="button"
            onClick={() => openTransfer(selectedIds)}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Copy to Supabase
          </button>
          <button
            type="button"
            onClick={() =>
              copyText(
                selectedIds.map((id) => cdnUrl(assets.find((a) => a.public_id === id)!)).join('\n'),
                `Copied ${plural(selectedIds.length, 'link')}`,
              )
            }
            className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy Links
          </button>
          <button
            type="button"
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500 hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Selected
          </button>
          <button type="button" onClick={() => setSelectedIds([])} aria-label="Clear selection" className="rounded-lg p-1 text-gray-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Copy to Supabase Storage */}
      {transferIds && (
        <Modal title={`Copy ${plural(transferIds.length, 'image')} to Supabase Storage`} onClose={() => setTransferIds(null)}>
          <p className="mb-4 text-xs text-gray-400">
            Each image is stored as WebP in the chosen bucket. Cloudinary keeps its copy, and nothing on the site changes
            until you use the new link.
          </p>
          <fieldset className="mb-4 grid grid-cols-2 gap-3">
            <legend className="mb-2 text-xs font-medium text-gray-300">Bucket</legend>
            {([MEDIA_BUCKETS.prize, MEDIA_BUCKETS.site] as const).map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={transferBucket === b}
                onClick={() => setTransferBucket(b)}
                className={`rounded-xl border p-3 text-left text-sm ${
                  transferBucket === b ? 'border-purple-500 bg-purple-500/10 text-white' : 'border-white/10 bg-gray-800/40 text-gray-400'
                }`}
              >
                {b}
              </button>
            ))}
          </fieldset>
          {transferredUrls.length > 0 && (
            <ul className="mb-4 space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs">
              {transferredUrls.map((url) => (
                <li key={url} className="flex items-center gap-2">
                  <span className="flex-1 break-all font-mono text-gray-300">{url}</span>
                  <button
                    type="button"
                    onClick={() => copyText(url, 'Link copied')}
                    aria-label={`Copy ${url}`}
                    className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-300 hover:bg-emerald-500/30"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTransferIds(null)} className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">
              Done
            </button>
            <button
              type="button"
              onClick={() => runTransfer(transferIds)}
              disabled={transferProgress !== null}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {transferProgress && <Loader2 className="h-4 w-4 animate-spin" />}
              {transferProgress ?? 'Copy'}
            </button>
          </div>
        </Modal>
      )}

      {/* Copy a Supabase image into Cloudinary */}
      {isImportOpen && (
        <Modal title="Copy from Supabase to Cloudinary" onClose={() => setIsImportOpen(false)} wide>
          <label className="mb-4 block text-xs font-medium text-gray-300">
            Cloudinary folder
            <input
              type="text"
              value={importFolder}
              onChange={(e) => setImportFolder(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-1.5 text-sm text-white"
            />
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              importToCloudinary(customUrl.trim());
            }}
            className="mb-4 flex items-end gap-2 rounded-xl border border-white/5 bg-gray-800/40 p-3"
          >
            <label className="flex-1 text-xs font-medium text-gray-300">
              Or paste a link to one of this site&apos;s Supabase images
              <input
                type="url"
                required
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://...supabase.co/storage/v1/object/public/..."
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-1.5 text-xs text-white placeholder-gray-500"
              />
            </label>
            <button
              type="submit"
              disabled={importingUrl !== null}
              className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              Copy link
            </button>
          </form>
          {pickerImages === null ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-purple-400" aria-label="Loading Supabase images" />
            </div>
          ) : pickerImages.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No prize or site images in Supabase Storage.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {pickerImages.map((img) => (
                <li key={img.url} className="flex items-center gap-3 rounded-xl border border-white/5 bg-gray-800/60 p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-white">{img.name}</p>
                    <p className="mt-0.5 text-[10px] text-gray-400">
                      {img.bucket} · {formatBytes(img.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => importToCloudinary(img.url)}
                    disabled={importingUrl !== null}
                    aria-label={`Copy ${img.name} to Cloudinary`}
                    className="flex items-center gap-1 rounded bg-purple-600/30 px-2.5 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-600/50 disabled:opacity-50"
                  >
                    {importingUrl === img.url ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Copy'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {/* Upload straight to Cloudinary */}
      {isUploadOpen && (
        <Modal title="Upload to Cloudinary" onClose={() => setIsUploadOpen(false)}>
          <form onSubmit={handleUpload} className="space-y-4">
            <label className="block text-xs font-medium text-gray-300">
              Folder
              <select
                value={uploadFolder}
                onChange={(e) => setUploadFolder(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                {UPLOAD_FOLDERS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-300">
              Image (JPEG, PNG, WebP, AVIF or GIF, up to 10 MB)
              <input
                type="file"
                ref={uploadInput}
                accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                className="mt-1.5 w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsUploadOpen(false)} className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">
                Cancel
              </button>
              <button
                type="submit"
                disabled={isUploading}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Image details */}
      {previewAsset && (
        <Modal title="Image details" onClose={() => setPreviewAsset(null)}>
          <div className="relative mb-4 aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black/60">
            <CldImage src={previewAsset.public_id} alt={`Preview of ${previewAsset.public_id}`} fill className="object-contain" />
          </div>
          <dl className="space-y-2 rounded-xl border border-white/5 bg-gray-800/40 p-4 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-400">Public ID</dt>
              <dd className="select-all text-white">{previewAsset.public_id}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-400">Format</dt>
              <dd className="uppercase text-white">{previewAsset.format ?? 'unknown'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-400">Size</dt>
              <dd className="text-white">{formatBytes(previewAsset.bytes ?? 0)}</dd>
            </div>
            {previewAsset.width && previewAsset.height && (
              <div className="flex justify-between gap-3">
                <dt className="text-gray-400">Dimensions</dt>
                <dd className="text-white">
                  {previewAsset.width} × {previewAsset.height} px
                </dd>
              </div>
            )}
            {previewAsset.created_at && (
              <div className="flex justify-between gap-3">
                <dt className="text-gray-400">Uploaded</dt>
                <dd className="text-white">{new Date(previewAsset.created_at).toLocaleString('en-GB')}</dd>
              </div>
            )}
          </dl>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <a
              href={cdnUrl(previewAsset)}
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
                onClick={() => {
                  openTransfer([previewAsset.public_id]);
                  setPreviewAsset(null);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600/30 px-3 py-2 text-xs font-medium text-purple-300 hover:bg-purple-600/50"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Copy to Supabase
              </button>
              <button
                type="button"
                onClick={() => handleDelete(previewAsset.public_id)}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500 hover:text-white"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
