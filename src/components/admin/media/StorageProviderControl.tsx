'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRightLeft, CheckCircle2, Cloud, Database, Loader2 } from 'lucide-react';
import { getCloudinaryLeftovers, migrateAllAssetsAction } from '@/actions/supabase-media-actions';
import type { CloudinaryPendingStats, FullMigrationResult } from '@/lib/media/cloudinary-migration';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Primary storage panel of the media pages. Every upload goes to Supabase Storage; Cloudinary
 * only serves images saved before the move. The panel counts the prize images and profile
 * pictures that still load from Cloudinary and moves them all on request.
 */
export default function StorageProviderControl({ onRefresh }: { onRefresh?: () => unknown }) {
  const [stats, setStats] = useState<CloudinaryPendingStats | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [result, setResult] = useState<FullMigrationResult | null>(null);

  const refresh = useCallback(async () => {
    const res = await getCloudinaryLeftovers();
    if (res.success) setStats(res.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const moveAll = async () => {
    setConfirming(false);
    setMoving(true);
    const id = toast.loading('Moving images from Cloudinary to Supabase Storage...');
    try {
      const res = await migrateAllAssetsAction();
      if (!res.success) {
        toast.error(res.error, { id });
        return;
      }
      setResult(res.data);
      if (res.data.totalFailed > 0) toast.warning(res.data.message, { id });
      else toast.success(res.data.message, { id });
      await onRefresh?.();
      await refresh();
    } catch {
      toast.error('Could not reach the server. Nothing was changed on this page; try again.', { id });
    } finally {
      setMoving(false);
    }
  };

  const pending = stats?.total ?? 0;
  const failures = result ? [...result.details.prizes, ...result.details.avatars].filter((m) => m.error) : [];

  return (
    <section aria-labelledby="primary-storage" className="rounded-2xl border border-white/10 bg-gray-900/60 p-6 space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <h2 id="primary-storage" className="text-lg font-bold text-white">Primary storage</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-300">
              <Database className="h-3.5 w-3.5" /> Supabase Storage · primary
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-gray-300">
              <Cloud className="h-3.5 w-3.5" /> Cloudinary · older images only
            </span>
          </div>
          <p className="text-xs text-gray-400">
            New uploads always go to Supabase Storage. Images saved on Cloudinary before the move keep working
            until they are moved.
          </p>
        </div>
        {pending > 0 && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={moving}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
            {moving ? 'Moving images...' : `Move ${plural(pending, 'image')} to Supabase`}
          </button>
        )}
      </div>

      <p role="status" className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-gray-300">
        {pending === 0 && stats && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
        {!stats
          ? 'Checking for images on Cloudinary...'
          : pending > 0
            ? `${plural(stats.prizes, 'prize image')} and ${plural(stats.avatars, 'profile picture')} still load from Cloudinary.`
            : 'Every prize image and profile picture loads from Supabase Storage.'}
      </p>

      {result && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs text-emerald-100 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-white">{result.message}</p>
            <button type="button" onClick={() => setResult(null)} className="text-gray-400 hover:text-white" aria-label="Close summary">
              ✕
            </button>
          </div>
          <p>
            Prize images moved: {result.prizesMigrated} · Profile pictures moved: {result.avatarsMigrated}
          </p>
          {failures.length > 0 && (
            <ul className="list-disc pl-5 text-amber-200">
              {failures.map((m, i) => (
                <li key={i}>
                  {m.name}: {m.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="move-all-title" className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-slate-900 p-6">
            <h3 id="move-all-title" className="text-base font-bold text-white">Move {plural(pending, 'image')} to Supabase Storage?</h3>
            <p className="text-xs leading-relaxed text-gray-300">
              Each prize image and profile picture still on Cloudinary is copied into Supabase Storage as WebP, and the
              prize or profile is pointed at the copy. Nothing is deleted from Cloudinary, so the old links keep working.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs text-gray-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={moveAll}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Move them
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
