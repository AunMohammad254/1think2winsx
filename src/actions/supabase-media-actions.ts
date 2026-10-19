'use server';

import { assertAdmin } from '@/lib/admin-guard';
import { getAdminDb, userDb } from '@/lib/supabase/db';
import { MEDIA_BUCKETS, mediaPublicUrl, mediaImageKey, parseMediaUrl } from '@/lib/media/config';
import {
  canonicalSuffix,
  deleteStoredImage,
  getBucketUsage,
  listStoredObjects,
  removeFolderExcept,
  type BucketUsage,
} from '@/lib/media/storage.server';
import {
  cancelMediaDeletion,
  deletablePrizeImageKey,
  getPrizeImageRetentionDays,
  listMediaDeletions,
  setPrizeImageRetentionDays,
  type MediaDeletion,
} from '@/lib/media/deletion-queue';
import {
  getPrimaryStorageProvider,
  setPrimaryStorageProvider,
  getCloudinaryPendingStats,
  migrateAllCloudinaryAssetsToSupabase,
  type StorageProvider,
  type CloudinaryPendingStats,
  type FullMigrationResult,
} from '@/lib/media/cloudinary-migration';

/**
 * Admin actions for the Supabase Storage media pages (/admin/media and
 * /admin/media/profile-pictures). Every action checks the admin session first: Server
 * Actions are public endpoints.
 */
type Result<T> = { success: true; data: T } | { success: false; error: string };

const PAGE_SIZE = 48;

async function adminAction<T>(fn: (adminEmail: string) => Promise<T>): Promise<Result<T>> {
  let adminEmail: string;
  try {
    adminEmail = await assertAdmin();
  } catch {
    return { success: false, error: 'Unauthorized: admin session required' };
  }
  try {
    return { success: true, data: await fn(adminEmail) };
  } catch (error) {
    console.error('[media] admin action failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Something went wrong' };
  }
}

export interface MediaOverview {
  usage: BucketUsage[];
  retentionDays: number;
  deletions: MediaDeletion[];
}

export async function getMediaOverview(): Promise<Result<MediaOverview>> {
  return adminAction(async () => {
    const [usage, retentionDays, deletions] = await Promise.all([
      getBucketUsage(getAdminDb()),
      getPrizeImageRetentionDays(),
      listMediaDeletions(),
    ]);
    return { usage, retentionDays, deletions };
  });
}

export interface MediaImage {
  /** Canonical (largest size) URL, the value a prize stores */
  url: string;
  name: string;
  /** Size of the largest stored size in bytes */
  size: number;
  createdAt: string;
  /** Prizes showing this image (prize-images only) */
  usedBy: { id: string; name: string }[];
}

export interface MediaImagePage {
  images: MediaImage[];
  total: number;
  pageSize: number;
}

/** One page of admin images (site-media or prize-images), newest first. */
export async function listMediaImages(
  bucket: typeof MEDIA_BUCKETS.site | typeof MEDIA_BUCKETS.prize,
  page = 0,
): Promise<Result<MediaImagePage>> {
  return adminAction(async () => {
    if (bucket !== MEDIA_BUCKETS.site && bucket !== MEDIA_BUCKETS.prize) throw new Error('Unknown media bucket');
    const db = getAdminDb();
    const { objects, total } = await listStoredObjects(db, bucket, {
      suffix: canonicalSuffix(bucket),
      limit: PAGE_SIZE,
      offset: Math.max(0, Math.floor(page)) * PAGE_SIZE,
    });

    let prizes: { id: string; name: string; imageUrl: string | null }[] = [];
    if (bucket === MEDIA_BUCKETS.prize) {
      const { data, error } = await db.from('Prize').select('id, name, imageUrl');
      if (error) throw error;
      prizes = data ?? [];
    }

    const images = objects.map((o) => {
      const key = mediaImageKey({ bucket, path: o.name });
      return {
        url: mediaPublicUrl(bucket, o.name),
        name: o.name,
        size: o.size,
        createdAt: o.createdAt,
        usedBy: prizes
          .filter((p) => deletablePrizeImageKey(p.imageUrl) === key)
          .map((p) => ({ id: p.id, name: p.name })),
      };
    });
    return { images, total, pageSize: PAGE_SIZE };
  });
}

/**
 * Deletes an admin image (every stored size) right away. A prize image a prize still shows is
 * refused: replace it on the prize first. Player avatars are managed separately.
 */
export async function deleteMediaImage(url: string): Promise<Result<{ deleted: true }>> {
  return adminAction(async () => {
    const ref = parseMediaUrl(url);
    if (!ref || ref.bucket === MEDIA_BUCKETS.avatar) throw new Error('Not an admin media image');
    if (ref.bucket === MEDIA_BUCKETS.prize) {
      const { data, error } = await getAdminDb().from('Prize').select('name, imageUrl');
      if (error) throw error;
      const key = mediaImageKey(ref);
      const user = (data ?? []).find((p: { imageUrl: string | null }) => deletablePrizeImageKey(p.imageUrl) === key);
      if (user) throw new Error(`"${user.name}" still uses this image. Change the prize's image first.`);
    }
    await deleteStoredImage(getAdminDb(), url);
    return { deleted: true as const };
  });
}

export interface ProfilePicture {
  userId: string;
  userName: string | null;
  email: string | null;
  url: string;
  size: number;
  createdAt: string;
  /** False for a file the player's profile no longer points to (should not normally exist) */
  isCurrent: boolean;
}

export interface ProfilePicturePage {
  pictures: ProfilePicture[];
  total: number;
  pageSize: number;
}

/** One page of player profile pictures stored in the avatars bucket, newest first. */
export async function listProfilePictures(page = 0): Promise<Result<ProfilePicturePage>> {
  return adminAction(async () => {
    const db = getAdminDb();
    const { objects, total } = await listStoredObjects(db, MEDIA_BUCKETS.avatar, {
      limit: PAGE_SIZE,
      offset: Math.max(0, Math.floor(page)) * PAGE_SIZE,
    });
    const userIds = [...new Set(objects.map((o) => o.name.split('/')[0]))];
    let users: { id: string; name: string | null; email: string | null; profilePicture: string | null }[] = [];
    if (userIds.length > 0) {
      const { data, error } = await db.from('User').select('id, name, email, profilePicture').in('id', userIds);
      if (error) throw error;
      users = data ?? [];
    }
    const pictures = objects.map((o) => {
      const userId = o.name.split('/')[0];
      const user = users.find((u) => u.id === userId);
      const url = mediaPublicUrl(MEDIA_BUCKETS.avatar, o.name);
      return {
        userId,
        userName: user?.name ?? null,
        email: user?.email ?? null,
        url,
        size: o.size,
        createdAt: o.createdAt,
        isCurrent: user?.profilePicture === url,
      };
    });
    return { pictures, total, pageSize: PAGE_SIZE };
  });
}

/**
 * Moderation: removes a player's profile picture. Deletes every file in avatars/<userId>/ and
 * clears the profile if it pointed there (a Google or other external picture is left alone).
 */
export async function removeProfilePicture(userId: string): Promise<Result<{ removed: number }>> {
  return adminAction(async () => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error('Invalid user id');
    const db = getAdminDb();
    const { data: user, error } = await db.from('User').select('profilePicture').eq('id', userId).maybeSingle();
    if (error) throw error;
    const current = parseMediaUrl(user?.profilePicture);
    if (current?.bucket === MEDIA_BUCKETS.avatar && current.path.startsWith(`${userId}/`)) {
      await userDb.update(userId, { profilePicture: null });
    }
    const removed = await removeFolderExcept(db, MEDIA_BUCKETS.avatar, userId);
    return { removed: removed.length };
  });
}

/** Keep a queued prize image instead of deleting it. */
export async function keepQueuedImage(id: string): Promise<Result<{ kept: boolean }>> {
  return adminAction(async () => ({ kept: await cancelMediaDeletion(id) }));
}

export async function updatePrizeImageRetention(days: number): Promise<Result<{ days: number }>> {
  return adminAction(async (adminEmail) => {
    await setPrizeImageRetentionDays(days, adminEmail);
    return { days };
  });
}

/** Get current primary storage provider and pending Cloudinary asset counts. */
export async function getStorageProviderStatus(): Promise<Result<{ provider: StorageProvider; pendingStats: CloudinaryPendingStats }>> {
  return adminAction(async () => {
    const db = getAdminDb();
    const [provider, pendingStats] = await Promise.all([
      getPrimaryStorageProvider(db),
      getCloudinaryPendingStats(db),
    ]);
    return { provider, pendingStats };
  });
}

/** Switch primary storage provider (supabase or cloudinary). */
export async function setPrimaryStorageAction(provider: StorageProvider): Promise<Result<{ provider: StorageProvider }>> {
  return adminAction(async (adminEmail) => {
    const db = getAdminDb();
    await setPrimaryStorageProvider(db, provider, adminEmail);
    return { provider };
  });
}

/** Move all Cloudinary assets to Supabase Storage and set Supabase as primary. */
export async function migrateAllAssetsAction(): Promise<Result<FullMigrationResult>> {
  return adminAction(async (adminEmail) => {
    const db = getAdminDb();
    const result = await migrateAllCloudinaryAssetsToSupabase(db, adminEmail);
    return result;
  });
}
