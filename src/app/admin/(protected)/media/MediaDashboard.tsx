'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { CldImage } from 'next-cloudinary';
import { toast } from 'sonner';
import {
  Trash2,
  Image as ImageIcon,
  HardDrive,
  Zap,
  Loader2,
  Upload,
  ArrowRightLeft,
  Copy,
  Check,
  Search,
  ExternalLink,
  RefreshCw,
  X,
  Eye,
  ArrowUpRight,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  getCloudinaryUsage,
  getCloudinaryResources,
  deleteCloudinaryResource,
  bulkDeleteCloudinaryResources,
  uploadToCloudinary,
  transferCloudinaryToSupabase,
  transferSupabaseToCloudinary,
  getSupabaseMediaForPicker,
} from '@/actions/media-actions';
import { CLOUDINARY_CLOUD_NAME } from '@/lib/cloudinary';

export default function MediaDashboard() {
  const [usage, setUsage] = useState<any>(null);
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Search, filter & sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'largest' | 'smallest'>('newest');

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [isBulkTransferModalOpen, setIsBulkTransferModalOpen] = useState(false);
  const [bulkTransferBucket, setBulkTransferBucket] = useState<'prize-images' | 'site-media'>('prize-images');

  // Modals & Drawers
  const [previewAsset, setPreviewAsset] = useState<any | null>(null);
  const [transferTargetAsset, setTransferTargetAsset] = useState<any | null>(null);
  const [transferBucket, setTransferBucket] = useState<'prize-images' | 'site-media'>('prize-images');
  const [isTransferringToSupabase, setIsTransferringToSupabase] = useState(false);
  const [supabaseTransferredUrl, setSupabaseTransferredUrl] = useState<string | null>(null);

  // Supabase -> Cloudinary import modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [supabasePickerImages, setSupabasePickerImages] = useState<any[]>([]);
  const [loadingSupabaseImages, setLoadingSupabaseImages] = useState(false);
  const [customSupabaseUrl, setCustomSupabaseUrl] = useState('');
  const [importTargetFolder, setImportTargetFolder] = useState('prizes');
  const [importingUrl, setImportingUrl] = useState<string | null>(null);

  // Direct Upload to Cloudinary
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadFolder, setUploadFolder] = useState('prizes');
  const [isUploading, setIsUploading] = useState(false);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  // Copy URL state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function loadData(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const [usageRes, resourcesRes] = await Promise.all([
        getCloudinaryUsage(),
        getCloudinaryResources(),
      ]);

      if (usageRes.success && usageRes.usage) {
        setUsage(usageRes.usage);
      }
      if (resourcesRes.success && resourcesRes.resources?.resources) {
        setResources(resourcesRes.resources.resources);
      } else if (resourcesRes.success && Array.isArray(resourcesRes.resources)) {
        setResources(resourcesRes.resources);
      }
    } catch (error) {
      console.error('Failed to load media data', error);
      toast.error('Failed to load Cloudinary media data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const availableFormats = useMemo(() => {
    const set = new Set<string>();
    for (const r of resources) {
      if (r.format) set.add(r.format.toLowerCase());
    }
    return Array.from(set);
  }, [resources]);

  const filteredResources = useMemo(() => {
    let list = [...resources];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((r) => r.public_id.toLowerCase().includes(q));
    }

    if (selectedFormat !== 'all') {
      list = list.filter((r) => r.format?.toLowerCase() === selectedFormat);
    }

    list.sort((a, b) => {
      if (sortBy === 'newest') return (b.created_at || '').localeCompare(a.created_at || '');
      if (sortBy === 'oldest') return (a.created_at || '').localeCompare(b.created_at || '');
      if (sortBy === 'largest') return (b.bytes || 0) - (a.bytes || 0);
      if (sortBy === 'smallest') return (a.bytes || 0) - (b.bytes || 0);
      return 0;
    });

    return list;
  }, [resources, searchQuery, selectedFormat, sortBy]);

  // Bulk Selection Toggles
  const toggleSelect = (publicId: string) => {
    setSelectedIds((prev) =>
      prev.includes(publicId) ? prev.filter((id) => id !== publicId) : [...prev, publicId]
    );
  };

  const selectAll = () => {
    const allFiltered = filteredResources.map((r) => r.public_id);
    setSelectedIds(allFiltered);
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const handleBulkCopyUrls = async () => {
    if (selectedIds.length === 0) return;
    const urls = selectedIds.map((id) => {
      const res = resources.find((r) => r.public_id === id);
      return getCdnUrl(id, res?.format);
    });
    try {
      await navigator.clipboard.writeText(urls.join('\n'));
      toast.success(`Copied ${urls.length} URLs to clipboard`);
    } catch {
      toast.error('Failed to copy URLs to clipboard');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} assets from Cloudinary? This cannot be undone.`)) {
      return;
    }

    setIsBulkBusy(true);
    try {
      const res = await bulkDeleteCloudinaryResources(selectedIds);
      if (res.success) {
        setResources((prev) => prev.filter((r) => !selectedIds.includes(r.public_id)));
        toast.success(`Deleted ${selectedIds.length} assets from Cloudinary`);
        clearSelection();
      } else {
        alert('Failed to delete images: ' + (res.error || 'Bulk delete failed'));
      }
    } catch (err: any) {
      console.error(err);
      alert('An error occurred while deleting.');
    } finally {
      setIsBulkBusy(false);
    }
  };

  const handleBulkTransferToSupabase = async () => {
    if (selectedIds.length === 0) return;
    setIsBulkBusy(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedIds.length; i++) {
      const publicId = selectedIds[i];
      setBulkProgress(`Transferring ${i + 1} of ${selectedIds.length}...`);
      try {
        const res = await transferCloudinaryToSupabase(publicId, bulkTransferBucket);
        if (res.success) successCount++;
        else failCount++;
      } catch {
        failCount++;
      }
    }

    setIsBulkBusy(false);
    setBulkProgress(null);
    setIsBulkTransferModalOpen(false);

    if (successCount > 0) {
      toast.success(`Transferred ${successCount} assets to Supabase (${bulkTransferBucket})`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} transfers failed`);
    }
    clearSelection();
  };

  const handleDelete = async (publicId: string) => {
    if (!confirm('Are you sure you want to delete this image? This cannot be undone.')) return;

    setDeletingId(publicId);
    try {
      const res = await deleteCloudinaryResource(publicId);
      if (res.success) {
        setResources((prev) => prev.filter((r) => r.public_id !== publicId));
        setSelectedIds((prev) => prev.filter((id) => id !== publicId));
        if (previewAsset?.public_id === publicId) setPreviewAsset(null);
      } else {
        alert('Failed to delete image: ' + res.error);
      }
    } catch (error) {
      console.error(error);
      alert('An error occurred while deleting.');
    } finally {
      setDeletingId(null);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success('Copied URL to clipboard');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const getCdnUrl = (publicId: string, format = 'webp') => {
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/q_auto,f_auto/${publicId}.${format}`;
  };

  // Handle Transfer from Cloudinary -> Supabase (single)
  const handleTransferToSupabase = async () => {
    if (!transferTargetAsset) return;

    setIsTransferringToSupabase(true);
    setSupabaseTransferredUrl(null);

    try {
      const res = await transferCloudinaryToSupabase(transferTargetAsset.public_id, transferBucket);
      if (res.success && res.url) {
        setSupabaseTransferredUrl(res.url);
        toast.success(`Transferred to Supabase bucket "${transferBucket}"!`);
      } else {
        toast.error(res.error || 'Transfer failed');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error transferring to Supabase');
    } finally {
      setIsTransferringToSupabase(false);
    }
  };

  // Handle Transfer from Supabase -> Cloudinary
  const openImportModal = async () => {
    setIsImportModalOpen(true);
    setLoadingSupabaseImages(true);
    try {
      const res = await getSupabaseMediaForPicker();
      if (res.success) {
        setSupabasePickerImages(res.images || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSupabaseImages(false);
    }
  };

  const handleImportToCloudinary = async (url: string) => {
    if (!url) return;
    setImportingUrl(url);

    try {
      const res = await transferSupabaseToCloudinary(url, importTargetFolder);
      if (res.success && res.publicId) {
        toast.success(`Successfully imported to Cloudinary as "${res.publicId}"`);
        setIsImportModalOpen(false);
        setCustomSupabaseUrl('');
        loadData(true);
      } else {
        toast.error(res.error || 'Failed to import to Cloudinary');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error importing to Cloudinary');
    } finally {
      setImportingUrl(null);
    }
  };

  // Handle Direct Cloudinary Upload
  const handleDirectUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const files = uploadFileInputRef.current?.files;
    if (!files || files.length === 0) {
      toast.error('Please select an image file to upload');
      return;
    }

    const formData = new FormData();
    formData.append('file', files[0]);
    formData.append('folder', uploadFolder);

    setIsUploading(true);
    try {
      const res = await uploadToCloudinary(formData);
      if (res.success && res.resource) {
        toast.success(`Uploaded "${res.resource.public_id}" to Cloudinary!`);
        setIsUploadModalOpen(false);
        if (uploadFileInputRef.current) uploadFileInputRef.current.value = '';
        loadData(true);
      } else {
        toast.error(res.error || 'Upload failed');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error uploading file');
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const isAllSelected = filteredResources.length > 0 && selectedIds.length === filteredResources.length;

  return (
    <div className="space-y-6">
      {/* Header and Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Cloudinary Media Management
            {usage?.plan && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                {usage.plan} plan
              </span>
            )}
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Browse, upload, delete, and transfer media assets between Cloudinary and Supabase Storage buckets.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-sm font-medium border border-white/10 flex items-center gap-1.5 transition-colors"
            title="Refresh Cloudinary assets"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-blue-400' : ''}`} />
            Refresh
          </button>

          <button
            onClick={openImportModal}
            className="px-3.5 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg text-sm font-medium border border-purple-500/30 flex items-center gap-1.5 transition-colors"
          >
            <ArrowRightLeft className="h-4 w-4 text-purple-400" />
            Transfer from Supabase
          </button>

          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 shadow-lg shadow-blue-600/20 transition-colors"
          >
            <Upload className="h-4 w-4" />
            Upload to Cloudinary
          </button>
        </div>
      </div>

      {/* Usage Stats */}
      {usage && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900/60 border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <HardDrive className="h-5 w-5 text-blue-400" />
              <h3 className="text-gray-300 font-medium">Storage Used</h3>
            </div>
            <p className="text-2xl font-bold text-white">
              {(usage.storage?.usage ? usage.storage.usage / (1024 * 1024) : 0).toFixed(2)} MB
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {usage.storage?.limit
                ? `of ${(usage.storage.limit / (1024 * 1024 * 1024)).toFixed(2)} GB limit`
                : usage.credits?.limit != null
                ? `Credit plan (${usage.credits.limit} total credits)`
                : 'No limit set'}
            </p>
            <div className="w-full bg-gray-800 rounded-full h-2 mt-3">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    usage.storage?.limit && usage.storage?.usage
                      ? Math.min(100, Math.max(0, (usage.storage.usage / usage.storage.limit) * 100))
                      : 0
                  }%`,
                }}
              ></div>
            </div>
          </div>

          <div className="bg-gray-900/60 border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <Zap className="h-5 w-5 text-yellow-400" />
              <h3 className="text-gray-300 font-medium">Bandwidth (30 Days)</h3>
            </div>
            <p className="text-2xl font-bold text-white">
              {(usage.bandwidth?.usage ? usage.bandwidth.usage / (1024 * 1024) : 0).toFixed(2)} MB
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {usage.bandwidth?.limit
                ? `of ${(usage.bandwidth.limit / (1024 * 1024 * 1024)).toFixed(2)} GB limit`
                : usage.credits?.limit != null
                ? `Credit plan (${usage.credits.limit} total credits)`
                : 'No limit set'}
            </p>
            <div className="w-full bg-gray-800 rounded-full h-2 mt-3">
              <div
                className="bg-yellow-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    usage.bandwidth?.limit && usage.bandwidth?.usage
                      ? Math.min(100, Math.max(0, (usage.bandwidth.usage / usage.bandwidth.limit) * 100))
                      : 0
                  }%`,
                }}
              ></div>
            </div>
          </div>

          <div className="bg-gray-900/60 border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <ImageIcon className="h-5 w-5 text-emerald-400" />
              <h3 className="text-gray-300 font-medium">Transformations</h3>
            </div>
            <p className="text-2xl font-bold text-white">
              {usage.transformations?.usage ?? 0}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {usage.transformations?.limit != null
                ? `of ${usage.transformations.limit.toLocaleString()} credits limit`
                : usage.credits?.limit != null
                ? `of ${usage.credits.limit.toLocaleString()} credits limit`
                : 'No limit set'}
            </p>
            <div className="w-full bg-gray-800 rounded-full h-2 mt-3">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    usage.transformations?.limit && usage.transformations?.usage
                      ? Math.min(100, Math.max(0, (usage.transformations.usage / usage.transformations.limit) * 100))
                      : usage.credits?.percent_used != null
                      ? Math.min(100, Math.max(0, usage.credits.percent_used))
                      : 0
                  }%`,
                }}
              ></div>
            </div>
          </div>
        </div>
      )}

      {/* Search, Filter & Gallery Container */}
      <div className="bg-gray-900/60 border border-white/10 rounded-xl p-6 relative">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white">Asset Gallery</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
              {filteredResources.length} of {resources.length}
            </span>

            {/* Select All Toggle Button */}
            {filteredResources.length > 0 && (
              <button
                type="button"
                onClick={isAllSelected ? clearSelection : selectAll}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 ml-2 transition-colors"
              >
                {isAllSelected ? (
                  <>
                    <CheckSquare className="h-3.5 w-3.5 text-blue-400" /> Deselect All
                  </>
                ) : (
                  <>
                    <Square className="h-3.5 w-3.5" /> Select All ({filteredResources.length})
                  </>
                )}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search public ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 bg-gray-800/80 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-gray-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Format Filter */}
            {availableFormats.length > 0 && (
              <select
                value={selectedFormat}
                onChange={(e) => setSelectedFormat(e.target.value)}
                className="bg-gray-800/80 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Formats</option>
                {availableFormats.map((fmt) => (
                  <option key={fmt} value={fmt}>
                    .{fmt.toLowerCase()}
                  </option>
                ))}
              </select>
            )}

            {/* Sort Filter */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-gray-800/80 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="largest">Largest size</option>
              <option value="smallest">Smallest size</option>
            </select>
          </div>
        </div>

        {/* Assets Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filteredResources.map((resource) => {
            const cdnUrl = getCdnUrl(resource.public_id, resource.format);
            const isCopied = copiedId === resource.public_id;
            const isSelected = selectedIds.includes(resource.public_id);

            return (
              <div
                key={resource.public_id}
                className={`group relative rounded-lg overflow-hidden bg-gray-800/90 border aspect-square flex flex-col justify-end transition-all hover:shadow-lg ${
                  isSelected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-white/10 hover:border-blue-500/40'
                }`}
              >
                <CldImage
                  src={resource.public_id}
                  alt={resource.public_id}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  sizes="(max-width: 768px) 50vw, 20vw"
                />

                {/* Selection Checkbox */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(resource.public_id);
                  }}
                  className={`absolute top-2 left-2 z-30 p-1 rounded-md transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-black/60 backdrop-blur-sm text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-black/80'
                  }`}
                  title={isSelected ? 'Deselect asset' : 'Select asset'}
                >
                  {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                </button>

                {/* Badges on bottom corner */}
                <div className="absolute bottom-2 left-2 z-10 flex gap-1 pointer-events-none">
                  <span className="text-[10px] uppercase font-mono font-bold bg-black/60 backdrop-blur-sm text-gray-300 px-1.5 py-0.5 rounded border border-white/10">
                    {(resource.format || 'img').toUpperCase()}
                  </span>
                </div>

                <div className="absolute top-2 right-2 z-10 pointer-events-none">
                  <span className="text-[10px] font-mono bg-black/60 backdrop-blur-sm text-gray-300 px-1.5 py-0.5 rounded border border-white/10">
                    {((resource.bytes || 0) / 1024).toFixed(1)} KB
                  </span>
                </div>

                {/* Overlay with rich action controls */}
                <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-between p-3 z-20">
                  <p
                    className="text-xs text-gray-200 truncate w-full text-center font-mono select-all pl-7"
                    title={resource.public_id}
                  >
                    {resource.public_id}
                  </p>

                  <div className="flex items-center gap-1.5 my-auto flex-wrap justify-center">
                    {/* Copy Delivery URL */}
                    <button
                      onClick={() => copyToClipboard(cdnUrl, resource.public_id)}
                      className="bg-white/10 hover:bg-white/20 text-gray-200 p-2 rounded-lg transition-colors"
                      title="Copy Cloudinary CDN URL"
                    >
                      {isCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>

                    {/* Preview / Details */}
                    <button
                      onClick={() => setPreviewAsset(resource)}
                      className="bg-white/10 hover:bg-white/20 text-blue-400 p-2 rounded-lg transition-colors"
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>

                    {/* Transfer to Supabase */}
                    <button
                      onClick={() => {
                        setTransferTargetAsset(resource);
                        setSupabaseTransferredUrl(null);
                      }}
                      className="bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 p-2 rounded-lg transition-colors"
                      title="Transfer to Supabase Storage"
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(resource.public_id)}
                      disabled={deletingId === resource.public_id}
                      className="bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white p-2 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete Image"
                    >
                      {deletingId === resource.public_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      setTransferTargetAsset(resource);
                      setSupabaseTransferredUrl(null);
                    }}
                    className="text-[11px] text-purple-300 hover:text-purple-200 flex items-center gap-1 underline underline-offset-2"
                  >
                    Send to Supabase
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}

          {filteredResources.length === 0 && (
            <div className="col-span-full py-16 text-center text-gray-500">
              {searchQuery || selectedFormat !== 'all'
                ? 'No media matching your search or filters.'
                : 'No media found in your Cloudinary account.'}
            </div>
          )}
        </div>
      </div>

      {/* Floating Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-900/95 backdrop-blur-md border border-white/20 rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-4 text-sm animate-in fade-in slide-in-from-bottom-4">
          <span className="font-semibold text-white flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span>
            {selectedIds.length} asset{selectedIds.length > 1 ? 's' : ''} selected
          </span>

          <div className="h-4 w-px bg-white/20"></div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsBulkTransferModalOpen(true)}
              disabled={isBulkBusy}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Transfer to Supabase
            </button>

            <button
              onClick={handleBulkCopyUrls}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy URLs
            </button>

            <button
              onClick={handleBulkDelete}
              disabled={isBulkBusy}
              className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {isBulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete Selected
            </button>
          </div>

          <button
            onClick={clearSelection}
            className="text-gray-400 hover:text-white p-1 rounded-lg"
            title="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Modal: Bulk Transfer to Supabase */}
      {isBulkTransferModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/15 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsBulkTransferModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <ArrowRightLeft className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Bulk Transfer to Supabase</h3>
                <p className="text-xs text-gray-400">
                  Transfer {selectedIds.length} Cloudinary asset{selectedIds.length > 1 ? 's' : ''} to Supabase Storage.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-2">Target Storage Bucket</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBulkTransferBucket('prize-images')}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      bulkTransferBucket === 'prize-images'
                        ? 'border-purple-500 bg-purple-500/10 text-white'
                        : 'border-white/10 bg-gray-800/40 text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    <p className="text-sm font-medium">Prize Images</p>
                    <p className="text-xs opacity-75 mt-1">Bucket: prize-images</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBulkTransferBucket('site-media')}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      bulkTransferBucket === 'site-media'
                        ? 'border-purple-500 bg-purple-500/10 text-white'
                        : 'border-white/10 bg-gray-800/40 text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    <p className="text-sm font-medium">Site Media</p>
                    <p className="text-xs opacity-75 mt-1">Bucket: site-media</p>
                  </button>
                </div>
              </div>

              {bulkProgress && (
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 flex items-center gap-2 text-xs text-purple-300">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  <span>{bulkProgress}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBulkTransferModalOpen(false)}
                  disabled={isBulkBusy}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkTransferToSupabase}
                  disabled={isBulkBusy}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  {isBulkBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Transferring...
                    </>
                  ) : (
                    `Transfer ${selectedIds.length} Assets`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Transfer to Supabase Storage (single) */}
      {transferTargetAsset && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/15 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => {
                setTransferTargetAsset(null);
                setSupabaseTransferredUrl(null);
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <ArrowRightLeft className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Transfer to Supabase Storage</h3>
                <p className="text-xs text-gray-400">
                  Save this Cloudinary asset into your project&apos;s Supabase Storage buckets.
                </p>
              </div>
            </div>

            <div className="bg-gray-800/60 rounded-xl p-3 border border-white/5 mb-4 flex items-center gap-3">
              <div className="h-14 w-14 rounded-lg bg-gray-700/50 relative overflow-hidden shrink-0">
                <CldImage
                  src={transferTargetAsset.public_id}
                  alt={transferTargetAsset.public_id}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-mono text-white truncate">{transferTargetAsset.public_id}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {(transferTargetAsset.bytes / 1024).toFixed(1)} KB • {transferTargetAsset.format?.toUpperCase()}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-2">Target Storage Bucket</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTransferBucket('prize-images')}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      transferBucket === 'prize-images'
                        ? 'border-purple-500 bg-purple-500/10 text-white'
                        : 'border-white/10 bg-gray-800/40 text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    <p className="text-sm font-medium">Prize Images</p>
                    <p className="text-xs opacity-75 mt-1">Bucket: prize-images</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTransferBucket('site-media')}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      transferBucket === 'site-media'
                        ? 'border-purple-500 bg-purple-500/10 text-white'
                        : 'border-white/10 bg-gray-800/40 text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    <p className="text-sm font-medium">Site Media</p>
                    <p className="text-xs opacity-75 mt-1">Bucket: site-media</p>
                  </button>
                </div>
              </div>

              {supabaseTransferredUrl && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                  <p className="text-xs font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
                    <Check className="h-4 w-4" /> Transfer Completed!
                  </p>
                  <p className="text-xs text-gray-300 font-mono break-all select-all">{supabaseTransferredUrl}</p>
                  <button
                    onClick={() => copyToClipboard(supabaseTransferredUrl, 'supabase-transferred')}
                    className="mt-2 text-xs px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded font-medium flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" /> Copy Supabase URL
                  </button>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setTransferTargetAsset(null);
                    setSupabaseTransferredUrl(null);
                  }}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleTransferToSupabase}
                  disabled={isTransferringToSupabase}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  {isTransferringToSupabase ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Transferring...
                    </>
                  ) : (
                    'Transfer to Supabase'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Transfer / Import from Supabase -> Cloudinary */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/15 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[90vh] flex flex-col">
            <button
              onClick={() => setIsImportModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <ArrowRightLeft className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Import from Supabase to Cloudinary</h3>
                <p className="text-xs text-gray-400">
                  Select a stored Supabase image or enter its public URL to upload it to Cloudinary.
                </p>
              </div>
            </div>

            {/* Folder selection */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Destination Cloudinary Folder</label>
              <input
                type="text"
                value={importTargetFolder}
                onChange={(e) => setImportTargetFolder(e.target.value)}
                placeholder="e.g. prizes or site"
                className="w-full px-3 py-1.5 bg-gray-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500"
              />
            </div>

            {/* Custom URL Input */}
            <div className="mb-4 bg-gray-800/40 border border-white/5 p-3 rounded-xl">
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Or Enter Supabase Image URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={customSupabaseUrl}
                  onChange={(e) => setCustomSupabaseUrl(e.target.value)}
                  placeholder="https://...supabase.co/storage/v1/object/public/..."
                  className="flex-1 px-3 py-1.5 bg-gray-800 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500"
                />
                <button
                  type="button"
                  onClick={() => handleImportToCloudinary(customSupabaseUrl)}
                  disabled={!customSupabaseUrl || importingUrl === customSupabaseUrl}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                >
                  {importingUrl === customSupabaseUrl ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Import URL'}
                </button>
              </div>
            </div>

            {/* List of Supabase Images */}
            <div className="flex-1 overflow-y-auto pr-1">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Available Supabase Storage Images ({supabasePickerImages.length})
              </h4>

              {loadingSupabaseImages ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
                </div>
              ) : supabasePickerImages.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {supabasePickerImages.map((img) => (
                    <div
                      key={img.url}
                      className="p-2.5 bg-gray-800/60 hover:bg-gray-800 border border-white/5 rounded-xl flex items-center gap-3 transition-colors"
                    >
                      <div className="h-12 w-12 rounded-lg bg-gray-700/50 relative overflow-hidden shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-mono text-white truncate">{img.name}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {img.bucket} • {(img.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <button
                        onClick={() => handleImportToCloudinary(img.url)}
                        disabled={importingUrl === img.url}
                        className="px-2.5 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded text-xs font-medium flex items-center gap-1 disabled:opacity-50"
                      >
                        {importingUrl === img.url ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            Import
                            <ArrowUpRight className="h-3 w-3" />
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-sm text-gray-500">
                  No images found in Supabase buckets (or buckets are empty).
                </p>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-white/5 mt-4">
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Direct Upload to Cloudinary */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/15 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsUploadModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                <Upload className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Upload to Cloudinary</h3>
                <p className="text-xs text-gray-400">Upload a new image asset directly to your Cloudinary cloud.</p>
              </div>
            </div>

            <form onSubmit={handleDirectUpload} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Destination Folder</label>
                <select
                  value={uploadFolder}
                  onChange={(e) => setUploadFolder(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="prizes">prizes</option>
                  <option value="site">site</option>
                  <option value="banners">banners</option>
                  <option value="uploads">uploads</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Select Image File</label>
                <input
                  type="file"
                  ref={uploadFileInputRef}
                  accept="image/*"
                  required
                  className="w-full text-xs text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 file:cursor-pointer"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Uploading...
                    </>
                  ) : (
                    'Upload Image'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Asset Details / Preview */}
      {previewAsset && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/15 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setPreviewAsset(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4">Asset Preview & Details</h3>

            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black/60 border border-white/10 mb-4">
              <CldImage
                src={previewAsset.public_id}
                alt={previewAsset.public_id}
                fill
                className="object-contain"
              />
            </div>

            <div className="space-y-3 bg-gray-800/40 p-4 rounded-xl border border-white/5 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-gray-400">Public ID:</span>
                <span className="text-white select-all">{previewAsset.public_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-gray-400">Format:</span>
                <span className="text-white uppercase">{previewAsset.format}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-gray-400">Size:</span>
                <span className="text-white">{((previewAsset.bytes || 0) / 1024).toFixed(1)} KB</span>
              </div>
              {previewAsset.width && previewAsset.height && (
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-gray-400">Dimensions:</span>
                  <span className="text-white">
                    {previewAsset.width} × {previewAsset.height} px
                  </span>
                </div>
              )}
              {previewAsset.created_at && (
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-gray-400">Created At:</span>
                  <span className="text-white">{new Date(previewAsset.created_at).toLocaleString()}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 mt-5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(getCdnUrl(previewAsset.public_id, previewAsset.format), previewAsset.public_id)}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Delivery URL
                </button>
                <a
                  href={getCdnUrl(previewAsset.public_id, previewAsset.format)}
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
                  onClick={() => {
                    setTransferTargetAsset(previewAsset);
                    setPreviewAsset(null);
                  }}
                  className="px-3 py-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Transfer to Supabase
                </button>
                <button
                  onClick={() => handleDelete(previewAsset.public_id)}
                  className="px-3 py-2 bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
