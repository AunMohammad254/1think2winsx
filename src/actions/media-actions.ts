'use server';

import { v2 as cloudinary } from 'cloudinary';
import { requireAdminSession } from '@/lib/admin-session';
import { getAdminDb } from '@/lib/supabase/db';
import { cloudinaryPublicIdFromUrl } from '@/lib/cloudinary';
import { isCloudinaryFolder } from '@/lib/cloudinary-server';
import { MEDIA_BUCKETS, MEDIA_FOLDERS, parseMediaUrl } from '@/lib/media/config';
import { storeImage } from '@/lib/media/storage.server';
import { fetchRemoteImage } from '@/lib/media/remote-image.server';
import { listMediaImages } from '@/actions/supabase-media-actions';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/** Cloudinary's delete_resources takes at most 100 public ids per call. */
const MAX_BULK = 100;

type AdminBucket = typeof MEDIA_BUCKETS.prize | typeof MEDIA_BUCKETS.site;
type Failure = { success: false; error: string };

export interface PickerImage {
  url: string;
  name: string;
  bucket: AdminBucket;
  size: number;
}

/** The parts of Cloudinary's usage report the media page shows (credit plans omit the limits). */
export interface CloudinaryUsage {
  plan?: string;
  storage?: { usage?: number; limit?: number };
  bandwidth?: { usage?: number; limit?: number };
  transformations?: { usage?: number; limit?: number };
  credits?: { usage?: number; limit?: number; used_percent?: number };
}

export interface CloudinaryAsset {
  public_id: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  created_at?: string;
}

/** The SDK rejects with plain objects as well as Errors; both carry `message`. */
function messageOf(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/**
 * Public ids a prize or a player's profile still shows, with who shows them. Deleting one of
 * these from Cloudinary would break that image, so the deletes below refuse them.
 */
async function cloudinaryIdsInUse(): Promise<Map<string, string>> {
  const db = getAdminDb();
  const cloudinaryLinks = 'https://res.cloudinary.com/%';
  const [prizes, users] = await Promise.all([
    db.from('Prize').select('name, imageUrl').like('imageUrl', cloudinaryLinks),
    db.from('User').select('id, profilePicture').like('profilePicture', cloudinaryLinks),
  ]);
  const error = prizes.error ?? users.error;
  if (error) throw error;

  const inUse = new Map<string, string>();
  for (const p of (prizes.data ?? []) as { name: string; imageUrl: string | null }[]) {
    const id = cloudinaryPublicIdFromUrl(p.imageUrl);
    if (id) inUse.set(id, `Used by prize "${p.name}"`);
  }
  for (const u of (users.data ?? []) as { profilePicture: string | null }[]) {
    const id = cloudinaryPublicIdFromUrl(u.profilePicture);
    if (id) inUse.set(id, "A player's profile picture");
  }
  return inUse;
}

export async function getCloudinaryUsage(): Promise<{ success: true; usage: CloudinaryUsage } | Failure> {
  await requireAdminSession();

  try {
    const usage: CloudinaryUsage = await cloudinary.api.usage();
    return { success: true, usage };
  } catch (error) {
    console.error('Failed to get Cloudinary usage:', error);
    return { success: false, error: messageOf(error, 'Could not read Cloudinary usage') };
  }
}

/** One page (100) of uploaded images, newest first as Cloudinary lists them. */
export async function getCloudinaryResources(
  cursor?: string,
): Promise<{ success: true; assets: CloudinaryAsset[]; nextCursor: string | null } | Failure> {
  await requireAdminSession();

  try {
    const options: { max_results: number; type: string; next_cursor?: string } = {
      max_results: 100,
      type: 'upload',
    };
    if (cursor) options.next_cursor = cursor;

    const page: { resources?: CloudinaryAsset[]; next_cursor?: string } = await cloudinary.api.resources(options);
    return { success: true, assets: page.resources ?? [], nextCursor: page.next_cursor ?? null };
  } catch (error) {
    console.error('Failed to get Cloudinary resources:', error);
    return { success: false, error: messageOf(error, 'Could not list Cloudinary files') };
  }
}

/** Deletes one asset, unless a prize or a player's profile still shows it. */
export async function deleteCloudinaryResource(publicId: string): Promise<{ success: true } | Failure> {
  await requireAdminSession();

  try {
    const reason = (await cloudinaryIdsInUse()).get(publicId);
    if (reason) return { success: false, error: `${reason}: change it there first` };
    await cloudinary.uploader.destroy(publicId);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete Cloudinary resource:', error);
    return { success: false, error: messageOf(error, 'Delete failed') };
  }
}

/**
 * Deletes up to 100 assets in one Cloudinary call. Assets a prize or a profile still shows are
 * skipped, with the reason, instead of failing the whole batch.
 */
export async function bulkDeleteCloudinaryResources(
  publicIds: string[],
): Promise<{ success: true; deleted: string[]; skipped: { publicId: string; reason: string }[] } | Failure> {
  await requireAdminSession();

  if (!Array.isArray(publicIds) || publicIds.length === 0) {
    return { success: false, error: 'No resources provided' };
  }
  if (publicIds.length > MAX_BULK) {
    return { success: false, error: `Select at most ${MAX_BULK} files at a time` };
  }

  try {
    const inUse = await cloudinaryIdsInUse();
    const skipped: { publicId: string; reason: string }[] = [];
    const toDelete: string[] = [];
    for (const id of publicIds) {
      const reason = typeof id === 'string' && id ? inUse.get(id) : 'Not a Cloudinary file';
      if (reason) skipped.push({ publicId: String(id), reason });
      else toDelete.push(id);
    }
    if (toDelete.length > 0) await cloudinary.api.delete_resources(toDelete);
    return { success: true, deleted: toDelete, skipped };
  } catch (error) {
    console.error('Failed to bulk delete Cloudinary resources:', error);
    return { success: false, error: messageOf(error, 'Bulk delete failed') };
  }
}

/** Copies an asset of this Cloudinary account into a Supabase Storage bucket. */
export async function transferCloudinaryToSupabase(
  publicId: string,
  targetBucket: AdminBucket = MEDIA_BUCKETS.prize,
): Promise<{ success: true; url: string } | Failure> {
  await requireAdminSession();

  if (targetBucket !== MEDIA_BUCKETS.prize && targetBucket !== MEDIA_BUCKETS.site) {
    return { success: false, error: 'Unknown media bucket' };
  }
  if (typeof publicId !== 'string' || !publicId || publicId.split('/').includes('..')) {
    return { success: false, error: 'Not a Cloudinary file' };
  }

  try {
    const image = await fetchRemoteImage(cloudinary.url(publicId, { secure: true }));
    const folder = targetBucket === MEDIA_BUCKETS.site ? MEDIA_FOLDERS.siteUploads : MEDIA_FOLDERS.prizes;
    const stored = await storeImage(getAdminDb(), targetBucket, folder, image);
    return { success: true, url: stored.url };
  } catch (error) {
    console.error('Failed to transfer from Cloudinary to Supabase:', error);
    return { success: false, error: messageOf(error, 'Transfer failed') };
  }
}

/**
 * Copies a site or prize image of this project's Supabase Storage into Cloudinary. Only those
 * links are accepted, so the Cloudinary account can't be used to fetch anything else.
 */
export async function transferSupabaseToCloudinary(
  supabaseUrl: string,
  folder = 'transfers',
): Promise<{ success: true; publicId: string } | Failure> {
  await requireAdminSession();

  const ref = parseMediaUrl(supabaseUrl);
  if (!ref || ref.bucket === MEDIA_BUCKETS.avatar) {
    return { success: false, error: "Only this site's prize and site images can be copied" };
  }
  if (!isCloudinaryFolder(folder)) {
    return { success: false, error: 'Folder names may use letters, digits, - and _ only' };
  }

  try {
    const result = await cloudinary.uploader.upload(supabaseUrl, { folder, resource_type: 'image' });
    return { success: true, publicId: result.public_id };
  } catch (error) {
    console.error('Failed to transfer from Supabase to Cloudinary:', error);
    return { success: false, error: messageOf(error, 'Transfer failed') };
  }
}

/**
 * The newest stored prize and site images: the Cloudinary page picks one to copy, the prize form
 * one to show on a prize.
 */
export async function getSupabaseMediaForPicker(): Promise<
  { success: true; images: PickerImage[] } | Failure
> {
  await requireAdminSession();

  const [prizeRes, siteRes] = await Promise.all([
    listMediaImages(MEDIA_BUCKETS.prize, 0),
    listMediaImages(MEDIA_BUCKETS.site, 0),
  ]);
  const images: PickerImage[] = [];
  for (const [bucket, res] of [[MEDIA_BUCKETS.prize, prizeRes], [MEDIA_BUCKETS.site, siteRes]] as const) {
    if (!res.success) return { success: false, error: res.error };
    for (const img of res.data.images) images.push({ url: img.url, name: img.name, bucket, size: img.size });
  }
  return { success: true, images };
}
