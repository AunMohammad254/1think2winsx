'use client';

import { useState, useEffect, useCallback } from 'react';
import { CldImage } from 'next-cloudinary';
import { Trash2, Image as ImageIcon, HardDrive, Zap, Loader2, AlertCircle } from 'lucide-react';
import { getCloudinaryUsage, getCloudinaryResources, deleteCloudinaryResource } from '@/actions/media-actions';
import StorageProviderControl from '@/components/admin/media/StorageProviderControl';

export default function MediaDashboard() {
  const [usage, setUsage] = useState<any>(null);
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [usageRes, resourcesRes] = await Promise.all([
        getCloudinaryUsage(),
        getCloudinaryResources()
      ]);
      if (usageRes.success) {
        setUsage(usageRes.usage);
      } else if (usageRes.error) {
        setError(usageRes.error);
      }

      if (resourcesRes.success) {
        const raw = resourcesRes.resources;
        const list = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.resources)
          ? raw.resources
          : [];
        setResources(list);
      } else if (resourcesRes.error && !usageRes.error) {
        setError(resourcesRes.error);
      }
    } catch (err: any) {
      console.error('Failed to load media data', err);
      setError(err?.message || 'Failed to connect to Cloudinary');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = async (publicId: string) => {
    if (!confirm('Are you sure you want to delete this image? This cannot be undone.')) return;
    
    setDeletingId(publicId);
    try {
      const res = await deleteCloudinaryResource(publicId);
      if (res.success) {
        setResources(prev => prev.filter(r => r.public_id !== publicId));
      } else {
        alert('Failed to delete image: ' + res.error);
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while deleting.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Storage calculations
  const storageUsageBytes = usage?.storage?.usage ?? 0;
  const storageLimitBytes = usage?.storage?.limit ?? null;
  const storageUsageMB = (storageUsageBytes / (1024 * 1024)).toFixed(2);
  const storageLimitGB = storageLimitBytes ? (storageLimitBytes / (1024 * 1024 * 1024)).toFixed(2) : null;
  const storagePercent = storageLimitBytes
    ? Math.min(100, Math.max(0, (storageUsageBytes / storageLimitBytes) * 100))
    : null;

  // Bandwidth calculations
  const bandwidthUsageBytes = usage?.bandwidth?.usage ?? 0;
  const bandwidthLimitBytes = usage?.bandwidth?.limit ?? null;
  const bandwidthUsageMB = (bandwidthUsageBytes / (1024 * 1024)).toFixed(2);
  const bandwidthLimitGB = bandwidthLimitBytes ? (bandwidthLimitBytes / (1024 * 1024 * 1024)).toFixed(2) : null;
  const bandwidthPercent = bandwidthLimitBytes
    ? Math.min(100, Math.max(0, (bandwidthUsageBytes / bandwidthLimitBytes) * 100))
    : null;

  // Transformations / Credits calculations
  const transformationsUsage = usage?.transformations?.usage ?? 0;
  const transformationsLimit = usage?.transformations?.limit ?? null;
  const creditsLimit = usage?.credits?.limit ?? null;
  const creditsUsage = usage?.credits?.usage ?? null;
  const creditsPercent = typeof usage?.credits?.percent_used === 'number'
    ? usage.credits.percent_used
    : (creditsLimit && creditsUsage != null ? (creditsUsage / creditsLimit) * 100 : null);
  const transformationsPercent = transformationsLimit
    ? Math.min(100, Math.max(0, (transformationsUsage / transformationsLimit) * 100))
    : (creditsPercent != null ? Math.min(100, Math.max(0, creditsPercent)) : null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Cloudinary (old uploads)</h2>
          <p className="text-gray-400 text-sm mt-1">
            Images uploaded before the move to Supabase Storage. Their links keep working; new uploads go to Supabase.
          </p>
        </div>
        {usage?.plan && (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
            {usage.plan} Plan
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-500/15 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Primary Storage Switch & Consolidation */}
      <StorageProviderControl onRefresh={loadData} />

      {/* Usage Stats */}
      {usage && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900/60 border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <HardDrive className="h-5 w-5 text-blue-400" />
              <h3 className="text-gray-300 font-medium">Storage Used</h3>
            </div>
            <p className="text-2xl font-bold text-white">
              {storageUsageMB} MB
            </p>
            {storageLimitGB ? (
              <p className="text-xs text-gray-500 mt-1">
                of {storageLimitGB} GB limit
              </p>
            ) : creditsLimit ? (
              <p className="text-xs text-gray-500 mt-1">
                shared credits pool ({creditsLimit.toLocaleString()} credits)
              </p>
            ) : null}
            {storagePercent !== null && (
              <div className="w-full bg-gray-800 rounded-full h-2 mt-3 overflow-hidden">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${storagePercent.toFixed(1)}%` }}
                ></div>
              </div>
            )}
          </div>

          <div className="bg-gray-900/60 border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <Zap className="h-5 w-5 text-yellow-400" />
              <h3 className="text-gray-300 font-medium">Bandwidth (30 Days)</h3>
            </div>
            <p className="text-2xl font-bold text-white">
              {bandwidthUsageMB} MB
            </p>
            {bandwidthLimitGB ? (
              <p className="text-xs text-gray-500 mt-1">
                of {bandwidthLimitGB} GB limit
              </p>
            ) : creditsLimit ? (
              <p className="text-xs text-gray-500 mt-1">
                shared credits pool ({creditsLimit.toLocaleString()} credits)
              </p>
            ) : null}
            {bandwidthPercent !== null && (
              <div className="w-full bg-gray-800 rounded-full h-2 mt-3 overflow-hidden">
                <div 
                  className="bg-yellow-500 h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${bandwidthPercent.toFixed(1)}%` }}
                ></div>
              </div>
            )}
          </div>

          <div className="bg-gray-900/60 border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <ImageIcon className="h-5 w-5 text-emerald-400" />
              <h3 className="text-gray-300 font-medium">Transformations</h3>
            </div>
            <p className="text-2xl font-bold text-white">
              {transformationsUsage.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {transformationsLimit != null
                ? `of ${transformationsLimit.toLocaleString()} credits limit`
                : creditsLimit != null
                ? `of ${creditsLimit.toLocaleString()} credits pool${creditsUsage != null ? ` (${creditsUsage.toFixed(1)} used)` : ''}`
                : 'Total transformations performed'}
            </p>
            {transformationsPercent !== null && (
              <div className="w-full bg-gray-800 rounded-full h-2 mt-3 overflow-hidden">
                <div 
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${transformationsPercent.toFixed(1)}%` }}
                ></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gallery */}
      <div className="bg-gray-900/60 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Asset Gallery</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {resources.map((resource) => (
            <div key={resource.public_id} className="group relative rounded-lg overflow-hidden bg-gray-800 border border-white/5 aspect-square">
              <CldImage
                src={resource.public_id}
                alt={resource.public_id}
                fill
                className="object-cover transition-transform duration-300 group-hover:scale-110"
                sizes="(max-width: 768px) 50vw, 20vw"
              />
              
              {/* Overlay with details and delete button */}
              <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2">
                <p className="text-xs text-gray-300 mb-1 truncate w-full text-center">
                  {typeof resource.bytes === 'number' ? (resource.bytes / 1024).toFixed(1) : '0'} KB
                </p>
                <p className="text-[10px] text-gray-500 mb-3 truncate w-full text-center font-mono">
                  {(resource.format || 'img').toUpperCase()}
                </p>
                <button
                  onClick={() => handleDelete(resource.public_id)}
                  disabled={deletingId === resource.public_id}
                  className="bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white p-2 rounded-full transition-colors disabled:opacity-50"
                  title="Delete Image"
                >
                  {deletingId === resource.public_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
          {resources.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-500">
              No media found in your Cloudinary account.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
