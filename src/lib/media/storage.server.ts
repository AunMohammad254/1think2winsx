import { createId } from '@paralleldrive/cuid2';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IMAGE_PRESETS,
  mediaPublicUrl,
  mediaVariantPaths,
  parseMediaUrl,
  type MediaBucket,
} from './config';
import { toWebpVariants } from './image-processing';

/**
 * Server-side Supabase Storage operations for the media buckets.
 *
 * Callers pass the client that decides what is allowed: the service-role client (getAdminDb)
 * for admin uploads to site-media / prize-images, or the player's own session client
 * (getDb) for avatars, so the storage policies limit them to avatars/<their id>/.
 */
type StorageClient = Pick<SupabaseClient, 'storage'>;
type RpcClient = Pick<SupabaseClient, 'rpc'>;

// File names are never reused (a new id per upload), so browsers and the CDN may keep them a year
const CACHE_CONTROL_SECONDS = '31536000';

export interface StoredImage {
  /** URL of the largest size: the value saved in the database */
  url: string;
  paths: string[];
  bytes: number;
}

/** Resizes an upload into the bucket's preset sizes and stores them under `folder/`. */
export async function storeImage(
  client: StorageClient,
  bucket: MediaBucket,
  folder: string,
  input: Buffer,
): Promise<StoredImage> {
  const variants = await toWebpVariants(input, IMAGE_PRESETS[bucket]);
  const id = createId();
  const store = client.storage.from(bucket);
  const paths = variants.map((v) => `${folder}/${id}-${v.width}.webp`);

  const results = await Promise.all(
    variants.map((v, i) =>
      store.upload(paths[i], v.data, {
        contentType: 'image/webp',
        cacheControl: CACHE_CONTROL_SECONDS,
        upsert: false,
      }),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed) {
    // Don't leave half an image behind
    const stored = paths.filter((_, i) => !results[i].error);
    if (stored.length > 0) await store.remove(stored).catch(() => undefined);
    throw failed.error;
  }

  return {
    url: mediaPublicUrl(bucket, paths[paths.length - 1]),
    paths,
    bytes: variants.reduce((sum, v) => sum + v.data.length, 0),
  };
}

/** Deletes every stored size of the image a media URL points to. False for non-media URLs. */
export async function deleteStoredImage(client: StorageClient, url: string): Promise<boolean> {
  const ref = parseMediaUrl(url);
  if (!ref) return false;
  const { error } = await client.storage.from(ref.bucket).remove(mediaVariantPaths(ref));
  if (error) throw error;
  return true;
}

/**
 * Deletes every file directly inside `folder/` except `keep`. Used to clear a player's old
 * profile pictures, including any left behind by an earlier failed delete. Returns the
 * deleted object names.
 */
export async function removeFolderExcept(
  client: StorageClient,
  bucket: MediaBucket,
  folder: string,
  keep: readonly string[] = [],
): Promise<string[]> {
  const store = client.storage.from(bucket);
  const { data, error } = await store.list(folder, { limit: 1000 });
  if (error) throw error;
  const stale = (data ?? [])
    .filter((entry) => entry.id !== null) // null id = sub-folder
    .map((entry) => `${folder}/${entry.name}`)
    .filter((path) => !keep.includes(path));
  if (stale.length === 0) return [];
  const { error: removeError } = await store.remove(stale);
  if (removeError) throw removeError;
  return stale;
}

export interface BucketUsage {
  bucket: MediaBucket;
  objects: number;
  bytes: number;
}

/** Object count and total size per media bucket (needs the service-role client). */
export async function getBucketUsage(client: RpcClient): Promise<BucketUsage[]> {
  const { data, error } = await client.rpc('media_storage_usage');
  if (error) throw error;
  const rows = (data ?? []) as { bucket_id: MediaBucket; object_count: number; total_bytes: number }[];
  return (Object.keys(IMAGE_PRESETS) as MediaBucket[]).map((bucket) => {
    const row = rows.find((r) => r.bucket_id === bucket);
    return { bucket, objects: Number(row?.object_count ?? 0), bytes: Number(row?.total_bytes ?? 0) };
  });
}

export interface StoredObject {
  name: string;
  size: number;
  createdAt: string;
}

/**
 * One page of objects in a media bucket, newest first (needs the service-role client).
 * `suffix` set to the largest preset size lists one row per image instead of one per size.
 */
export async function listStoredObjects(
  client: RpcClient,
  bucket: MediaBucket,
  options: { prefix?: string; suffix?: string; limit?: number; offset?: number } = {},
): Promise<{ objects: StoredObject[]; total: number }> {
  const { data, error } = await client.rpc('media_storage_objects', {
    p_bucket: bucket,
    p_prefix: options.prefix ?? '',
    p_suffix: options.suffix ?? '',
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as { name: string; size: number; created_at: string; total_count: number }[];
  return {
    objects: rows.map((r) => ({ name: r.name, size: Number(r.size), createdAt: r.created_at })),
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
  };
}

/** Name suffix of an image's largest (canonical) size in a bucket, e.g. "-1280.webp". */
export function canonicalSuffix(bucket: MediaBucket): string {
  const widths = IMAGE_PRESETS[bucket].widths;
  return `-${widths[widths.length - 1]}.webp`;
}
