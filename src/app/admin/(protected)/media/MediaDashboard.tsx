'use client';

import { useState, useEffect } from 'react';
import { CldImage } from 'next-cloudinary';
import { Trash2, Image as ImageIcon, HardDrive, Zap, Loader2 } from 'lucide-react';
import { getCloudinaryUsage, getCloudinaryResources, deleteCloudinaryResource } from '@/actions/media-actions';

export default function MediaDashboard() {
  const [usage, setUsage] = useState<any>(null);
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [usageRes, resourcesRes] = await Promise.all([
          getCloudinaryUsage(),
          getCloudinaryResources()
        ]);
        if (usageRes.success) setUsage(usageRes.usage);
        if (resourcesRes.success) setResources(resourcesRes.resources.resources);
      } catch (error) {
        console.error('Failed to load media data', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

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
    } catch (error) {
      console.error(error);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Media Management</h2>
          <p className="text-gray-400 text-sm mt-1">Manage your Cloudinary assets and monitor usage</p>
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
              {(usage.storage.usage / (1024 * 1024)).toFixed(2)} MB
            </p>
            <p className="text-xs text-gray-500 mt-1">
              of {(usage.storage.limit / (1024 * 1024 * 1024)).toFixed(2)} GB limit
            </p>
            <div className="w-full bg-gray-800 rounded-full h-2 mt-3">
              <div 
                className="bg-blue-500 h-2 rounded-full" 
                style={{ width: `${(usage.storage.usage / usage.storage.limit) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-gray-900/60 border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <Zap className="h-5 w-5 text-yellow-400" />
              <h3 className="text-gray-300 font-medium">Bandwidth (30 Days)</h3>
            </div>
            <p className="text-2xl font-bold text-white">
              {(usage.bandwidth.usage / (1024 * 1024)).toFixed(2)} MB
            </p>
            <p className="text-xs text-gray-500 mt-1">
              of {(usage.bandwidth.limit / (1024 * 1024 * 1024)).toFixed(2)} GB limit
            </p>
            <div className="w-full bg-gray-800 rounded-full h-2 mt-3">
              <div 
                className="bg-yellow-500 h-2 rounded-full" 
                style={{ width: `${(usage.bandwidth.usage / usage.bandwidth.limit) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-gray-900/60 border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <ImageIcon className="h-5 w-5 text-emerald-400" />
              <h3 className="text-gray-300 font-medium">Transformations</h3>
            </div>
            <p className="text-2xl font-bold text-white">
              {usage.transformations.usage}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              of {usage.transformations.limit.toLocaleString()} credits limit
            </p>
            <div className="w-full bg-gray-800 rounded-full h-2 mt-3">
              <div 
                className="bg-emerald-500 h-2 rounded-full" 
                style={{ width: `${(usage.transformations.usage / usage.transformations.limit) * 100}%` }}
              ></div>
            </div>
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
                  {(resource.bytes / 1024).toFixed(1)} KB
                </p>
                <p className="text-[10px] text-gray-500 mb-3 truncate w-full text-center font-mono">
                  {resource.format.toUpperCase()}
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
