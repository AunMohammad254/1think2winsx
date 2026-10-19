'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Database,
  Cloud,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Sparkles,
  Info,
} from 'lucide-react';
import {
  getStorageProviderStatus,
  setPrimaryStorageAction,
  migrateAllAssetsAction,
} from '@/actions/supabase-media-actions';
import type {
  StorageProvider,
  CloudinaryPendingStats,
  FullMigrationResult,
} from '@/lib/media/cloudinary-migration';

interface StorageProviderControlProps {
  initialProvider?: StorageProvider;
  pendingStats?: CloudinaryPendingStats;
  onRefresh?: () => unknown;
  className?: string;
}

export default function StorageProviderControl({
  initialProvider = 'supabase',
  pendingStats: initialStats,
  onRefresh,
  className = '',
}: StorageProviderControlProps) {
  const [provider, setProvider] = useState<StorageProvider>(initialProvider);
  const [stats, setStats] = useState<CloudinaryPendingStats | undefined>(initialStats);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [migrationResult, setMigrationResult] = useState<FullMigrationResult | null>(null);

  const refreshStatus = async () => {
    try {
      if (typeof getStorageProviderStatus !== 'function') return;
      const res = await getStorageProviderStatus();
      if (res?.success) {
        setProvider(res.data.provider);
        setStats(res.data.pendingStats);
      }
    } catch (err) {
      // safe fallback
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const handleSelectProvider = async (target: StorageProvider) => {
    if (target === provider) return;

    if (target === 'supabase') {
      // Opening confirmation modal to switch and migrate all assets
      setShowConfirmModal(true);
    } else {
      if (
        !confirm(
          'Switch primary storage to Cloudinary? New uploads and assets will be managed via Cloudinary.'
        )
      ) {
        return;
      }
      setIsSwitching(true);
      try {
        const res = await setPrimaryStorageAction('cloudinary');
        if (res.success) {
          setProvider('cloudinary');
          toast.success('Primary storage switched to Cloudinary');
          await onRefresh?.();
          await refreshStatus();
        } else {
          toast.error(res.error || 'Failed to switch primary storage');
        }
      } catch (err: any) {
        toast.error(err?.message || 'Failed to switch primary storage');
      } finally {
        setIsSwitching(false);
      }
    }
  };

  const handleConfirmMigrationToSupabase = async () => {
    setIsMigrating(true);
    setShowConfirmModal(false);
    const toastId = toast.loading('Moving all assets from Cloudinary to Supabase Storage...');

    try {
      const res = await migrateAllAssetsAction();
      if (res.success) {
        setProvider('supabase');
        setMigrationResult(res.data);
        toast.success(res.data.message || 'Assets successfully migrated to Supabase Storage!', {
          id: toastId,
        });
        await onRefresh?.();
        await refreshStatus();
      } else {
        toast.error(res.error || 'Asset migration failed', { id: toastId });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error occurred during migration', { id: toastId });
    } finally {
      setIsMigrating(false);
    }
  };

  const pendingCount = (stats?.prizes ?? 0) + (stats?.avatars ?? 0);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-gray-900 to-slate-950 p-6 shadow-xl ${className}`}
    >
      {/* Background glow accent */}
      <div
        className={`pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl transition-opacity duration-500 ${
          provider === 'supabase' ? 'bg-emerald-500/10' : 'bg-blue-500/10'
        }`}
      />

      <div className="relative space-y-6">
        {/* Header with Switcher Label */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Database className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-bold text-white">Primary Storage Service</h2>
              {provider === 'supabase' ? (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> Supabase Primary
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-blue-500/15 border border-blue-500/30 px-2.5 py-0.5 text-xs font-semibold text-blue-300">
                  <Cloud className="h-3 w-3" /> Cloudinary Primary
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              Select your primary media engine. When Supabase is selected, all assets are moved and
              served directly from Supabase Storage.
            </p>
          </div>

          {/* Direct Migrate Button if Cloudinary assets remain */}
          {provider === 'supabase' && pendingCount > 0 && (
            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              disabled={isMigrating}
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-900/30 transition-all hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50"
            >
              {isMigrating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Moving Assets...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Move {pendingCount} Cloudinary Asset{pendingCount === 1 ? '' : 's'} to Supabase
                </>
              )}
            </button>
          )}
        </div>

        {/* Storage Provider Selection Switch Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Option: Supabase Storage */}
          <div
            onClick={() => !isMigrating && !isSwitching && handleSelectProvider('supabase')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleSelectProvider('supabase')}
            className={`group relative cursor-pointer rounded-xl border p-4 transition-all duration-300 ${
              provider === 'supabase'
                ? 'border-emerald-500/50 bg-emerald-950/20 shadow-lg shadow-emerald-950/30'
                : 'border-white/5 bg-gray-900/40 hover:border-white/15 hover:bg-gray-800/40'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                    provider === 'supabase'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white text-sm">Supabase Storage</span>
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 border border-emerald-500/30">
                      Recommended
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Fast WebP CDN · Zero transformation cost
                  </p>
                </div>
              </div>
              <div
                className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  provider === 'supabase'
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-gray-600 bg-transparent'
                }`}
              >
                {provider === 'supabase' && <div className="h-2 w-2 rounded-full bg-white" />}
              </div>
            </div>

            <div className="mt-3 border-t border-white/5 pt-3">
              <ul className="space-y-1 text-xs text-gray-400">
                <li className="flex items-center gap-1.5 text-emerald-300/90">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                  Pre-converted fixed WebP sizes for site & prizes
                </li>
                <li className="flex items-center gap-1.5 text-gray-400">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                  Direct downloads from CDN with zero per-request fee
                </li>
              </ul>
            </div>
          </div>

          {/* Option: Cloudinary */}
          <div
            onClick={() => !isMigrating && !isSwitching && handleSelectProvider('cloudinary')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleSelectProvider('cloudinary')}
            className={`group relative cursor-pointer rounded-xl border p-4 transition-all duration-300 ${
              provider === 'cloudinary'
                ? 'border-blue-500/50 bg-blue-950/20 shadow-lg shadow-blue-950/30'
                : 'border-white/5 bg-gray-900/40 hover:border-white/15 hover:bg-gray-800/40'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                    provider === 'cloudinary'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  <Cloud className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white text-sm">Cloudinary</span>
                    <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-300">
                      Legacy
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Third-party media host & dynamic URLs
                  </p>
                </div>
              </div>
              <div
                className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  provider === 'cloudinary'
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-gray-600 bg-transparent'
                }`}
              >
                {provider === 'cloudinary' && <div className="h-2 w-2 rounded-full bg-white" />}
              </div>
            </div>

            <div className="mt-3 border-t border-white/5 pt-3">
              <ul className="space-y-1 text-xs text-gray-400">
                <li className="flex items-center gap-1.5 text-gray-400">
                  <Info className="h-3 w-3 text-blue-400 flex-shrink-0" />
                  Shared credit pool limits apply
                </li>
                <li className="flex items-center gap-1.5 text-gray-400">
                  <Info className="h-3 w-3 text-blue-400 flex-shrink-0" />
                  Links remain backward-compatible
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Informational Status Banner */}
        {provider === 'supabase' && pendingCount > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-yellow-400" />
              <span>
                <strong>{pendingCount} asset(s)</strong> still reference Cloudinary (
                {stats?.prizes ?? 0} prize(s), {stats?.avatars ?? 0} avatar(s)). Move them to
                Supabase to complete consolidation.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              disabled={isMigrating}
              className="flex-shrink-0 rounded-lg bg-yellow-400/20 px-3 py-1.5 font-semibold text-yellow-200 hover:bg-yellow-400/30 transition-colors"
            >
              Move Now
            </button>
          </div>
        ) : provider === 'supabase' ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
            <span>
              <strong>Supabase Storage is fully unified.</strong> All site assets, prize images, and
              player profile pictures are served directly from Supabase CDN.
            </span>
          </div>
        ) : null}

        {/* Migration Result Breakdown Modal / Callout */}
        {migrationResult && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs text-emerald-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-white text-sm">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                Migration Summary
              </div>
              <button
                type="button"
                onClick={() => setMigrationResult(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-gray-300">{migrationResult.message}</p>
            <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
              <div className="rounded bg-black/40 p-2 border border-white/5">
                <span className="text-gray-400 block">Prizes Moved</span>
                <span className="text-white font-bold text-sm">
                  {migrationResult.prizesMigrated}
                </span>
              </div>
              <div className="rounded bg-black/40 p-2 border border-white/5">
                <span className="text-gray-400 block">Avatars Moved</span>
                <span className="text-white font-bold text-sm">
                  {migrationResult.avatarsMigrated}
                </span>
              </div>
              <div className="rounded bg-black/40 p-2 border border-white/5">
                <span className="text-gray-400 block">Library Files</span>
                <span className="text-white font-bold text-sm">
                  {migrationResult.libraryMigrated}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Set Supabase as Primary Storage?
                </h3>
                <p className="text-xs text-gray-400">Consolidate all media assets into Supabase</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              When confirmed, the system will:
            </p>

            <ul className="space-y-2 text-xs text-gray-300 rounded-xl bg-slate-800/60 p-3 border border-white/5">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Move all Prize Images:</strong> Download Cloudinary prize images and store
                  optimized WebP variants in Supabase bucket.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Move Player Avatars:</strong> Transfer old Cloudinary user profile photos to
                  Supabase Storage.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Archive Cloudinary Library:</strong> Copy existing Cloudinary assets into
                  Supabase <code className="text-emerald-300">site-media</code>.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Update Database:</strong> Rewrite URLs so the platform delivers strictly
                  from Supabase Storage CDN.
                </span>
              </li>
            </ul>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isMigrating}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-gray-300 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmMigrationToSupabase}
                disabled={isMigrating}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-semibold text-white hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-900/30 transition-all"
              >
                {isMigrating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Migrating...
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    Confirm & Move All Assets
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
