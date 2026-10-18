import { createId } from '@paralleldrive/cuid2';
import { getAdminDb } from '@/lib/supabase/db';
import { cloudinaryPublicIdFromUrl } from '@/lib/cloudinary';
import { deleteCloudinaryImageByUrl } from '@/lib/cloudinary-server';
import { MEDIA_BUCKETS, mediaImageKey, parseMediaUrl } from './config';
import { deleteStoredImage } from './storage.server';

/**
 * Delayed deletion of replaced prize images.
 *
 * When an admin replaces or deletes a prize's image, the old URL is queued in "MediaDeletion"
 * instead of being deleted at once. The scheduler deletes it once it has waited
 * `prize_image_retention_days` (AppSettings, default 30, 0 = next run). The delay is applied
 * when the queue is processed, so changing the setting also moves images already waiting.
 * An image a prize uses again by then is kept, never deleted.
 */
export const PRIZE_IMAGE_RETENTION_KEY = 'prize_image_retention_days';
export const DEFAULT_PRIZE_IMAGE_RETENTION_DAYS = 30;
export const MAX_PRIZE_IMAGE_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
// The queue only needs checking a few times an hour, not on every scheduler tick
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export type MediaDeletionReason = 'prize_image_replaced' | 'prize_deleted';
export type MediaDeletionStatus = 'pending' | 'deleted' | 'kept' | 'cancelled' | 'failed';

export interface MediaDeletion {
  id: string;
  url: string;
  reason: MediaDeletionReason;
  prizeId: string | null;
  status: MediaDeletionStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

/** Whole number of days in 0..365, from a setting value or form input; null otherwise. */
export function parseRetentionDays(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,3}$/.test(text)) return null;
  const days = Number(text);
  return days <= MAX_PRIZE_IMAGE_RETENTION_DAYS ? days : null;
}

export async function getPrizeImageRetentionDays(): Promise<number> {
  const { data, error } = await getAdminDb()
    .from('AppSettings')
    .select('value')
    .eq('key', PRIZE_IMAGE_RETENTION_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseRetentionDays(data?.value) ?? DEFAULT_PRIZE_IMAGE_RETENTION_DAYS;
}

export async function setPrizeImageRetentionDays(days: number, updatedBy: string): Promise<void> {
  if (parseRetentionDays(days) === null) {
    throw new RangeError(`Retention must be a whole number of days from 0 to ${MAX_PRIZE_IMAGE_RETENTION_DAYS}`);
  }
  const { error } = await getAdminDb().from('AppSettings').upsert({
    key: PRIZE_IMAGE_RETENTION_KEY,
    value: String(days),
    updatedAt: new Date().toISOString(),
    updatedBy,
  });
  if (error) throw error;
}

/**
 * Identity of a prize image this app may delete, the same for every size or transformation of
 * it: prize-images bucket files, and Cloudinary images outside "assets/" (shared site assets).
 * Null for everything else (site-media, data URIs, /public files, other hosts).
 */
export function deletablePrizeImageKey(url: string | null | undefined): string | null {
  const ref = parseMediaUrl(url);
  if (ref) return ref.bucket === MEDIA_BUCKETS.prize ? mediaImageKey(ref) : null;
  const publicId = cloudinaryPublicIdFromUrl(url);
  return publicId && !publicId.startsWith('assets/') ? `cloudinary/${publicId}` : null;
}

/** Queues a prize's old image for deletion after the retention period. */
export async function schedulePrizeImageDeletion(
  url: string | null | undefined,
  reason: MediaDeletionReason,
  prizeId: string,
): Promise<boolean> {
  if (!url || !deletablePrizeImageKey(url)) return false;
  const { error } = await getAdminDb()
    .from('MediaDeletion')
    .insert({ id: createId(), url, reason, prizeId });
  if (error) throw error;
  return true;
}

export async function listMediaDeletions(limit = 100): Promise<MediaDeletion[]> {
  const { data, error } = await getAdminDb()
    .from('MediaDeletion')
    .select('id, url, reason, prizeId, status, attempts, lastError, createdAt, processedAt')
    .order('createdAt', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MediaDeletion[];
}

/** Keeps a queued image (admin "Keep"). False when it was no longer pending. */
export async function cancelMediaDeletion(id: string): Promise<boolean> {
  const { data, error } = await getAdminDb()
    .from('MediaDeletion')
    .update({ status: 'cancelled', processedAt: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export interface MediaDeletionRun {
  deleted: string[];
  kept: string[];
  failed: string[];
}

/** Deletes queued images whose retention period is over. */
export async function processDueMediaDeletions(now: number = Date.now()): Promise<MediaDeletionRun> {
  const db = getAdminDb();
  const run: MediaDeletionRun = { deleted: [], kept: [], failed: [] };
  const days = await getPrizeImageRetentionDays();
  const cutoff = new Date(now - days * DAY_MS).toISOString();

  const { data: due, error } = await db
    .from('MediaDeletion')
    .select('id, url, attempts')
    .eq('status', 'pending')
    .lte('createdAt', cutoff)
    .order('createdAt', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;
  if (!due || due.length === 0) return run;

  // An image a prize shows again (e.g. the admin switched back to it) is kept
  const { data: prizes, error: prizeError } = await db.from('Prize').select('imageUrl');
  if (prizeError) throw prizeError;
  const inUse = new Set((prizes ?? []).map((p: { imageUrl: string | null }) => deletablePrizeImageKey(p.imageUrl)));

  const processedAt = new Date(now).toISOString();
  const finish = (id: string, patch: Record<string, unknown>) =>
    db.from('MediaDeletion').update(patch).eq('id', id).eq('status', 'pending');

  for (const row of due as { id: string; url: string; attempts: number }[]) {
    const key = deletablePrizeImageKey(row.url);
    if (!key || inUse.has(key)) {
      await finish(row.id, { status: 'kept', processedAt });
      run.kept.push(row.id);
      continue;
    }
    try {
      const confirmed = parseMediaUrl(row.url)
        ? await deleteStoredImage(db, row.url)
        : await deleteCloudinaryImageByUrl(row.url);
      if (!confirmed) throw new Error('Storage did not confirm the delete (already removed?)');
      await finish(row.id, { status: 'deleted', processedAt });
      run.deleted.push(row.id);
    } catch (err) {
      const attempts = row.attempts + 1;
      const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await finish(row.id, attempts >= MAX_ATTEMPTS
        ? { attempts, lastError, status: 'failed', processedAt }
        : { attempts, lastError });
      run.failed.push(row.id);
    }
  }
  return run;
}

let lastCleanupAt = 0;

/** processDueMediaDeletions at most every 15 minutes per server process; null when skipped. */
export async function runMediaCleanupIfDue(now: number = Date.now()): Promise<MediaDeletionRun | null> {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return null;
  lastCleanupAt = now;
  return processDueMediaDeletions(now);
}

/** Test hook: lets the next runMediaCleanupIfDue run immediately. */
export function resetMediaCleanupSchedule(): void {
  lastCleanupAt = 0;
}
