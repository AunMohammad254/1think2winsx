import type { SupabaseClient } from '@supabase/supabase-js';
import { isCloudinaryUrl } from '@/lib/cloudinary';
import { MEDIA_BUCKETS, MEDIA_FOLDERS } from './config';
import { deleteStoredImage, storeImage } from './storage.server';

export const PRIMARY_STORAGE_KEY = 'primary_storage_provider';
export type StorageProvider = 'supabase' | 'cloudinary';
export const DEFAULT_PRIMARY_STORAGE: StorageProvider = 'supabase';

/**
 * One-off copy of prize images from Cloudinary into the prize-images bucket
 * (supabase/data-migrations/migrate-cloudinary-images.ts runs it).
 *
 * - Dry run unless `apply` is true: it only lists what would move.
 * - Copies the image AS SHOWN (the stored URL, with its named transformation), resized into the
 *   prize-images sizes, then points the prize at the new URL.
 * - The prize row is only changed if it still has the old URL, so an admin edit made meanwhile
 *   wins and the copy is removed again.
 * - Never deletes or queues anything on Cloudinary: the old URLs keep working, and putting an
 *   old URL back on the prize undoes the move.
 */
export interface PrizeImageMove {
  prizeId: string;
  name: string;
  from: string;
  to?: string;
  error?: string;
}

export interface UserAvatarMove {
  userId: string;
  name: string;
  from: string;
  to?: string;
  error?: string;
}

export interface CloudinaryLibraryMove {
  publicId: string;
  from: string;
  to?: string;
  format?: string;
  bytes?: number;
  error?: string;
}

export interface CloudinaryPendingStats {
  prizes: number;
  avatars: number;
  library: number;
  total: number;
}

export interface FullMigrationResult {
  success: boolean;
  provider: 'supabase';
  prizesMigrated: number;
  prizesFailed: number;
  avatarsMigrated: number;
  avatarsFailed: number;
  libraryMigrated: number;
  libraryFailed: number;
  totalMigrated: number;
  totalFailed: number;
  details: {
    prizes: PrizeImageMove[];
    avatars: UserAvatarMove[];
    library: CloudinaryLibraryMove[];
  };
  message: string;
}

type Db = Pick<SupabaseClient, 'from' | 'storage'>;

/** Migrate prize images pointing to Cloudinary into Supabase Storage. */
export async function migratePrizeImagesFromCloudinary(
  db: Db,
  { apply, fetchImpl = fetch }: { apply: boolean; fetchImpl?: typeof fetch },
): Promise<PrizeImageMove[]> {
  const { data, error } = await db.from('Prize').select('id, name, imageUrl').order('createdAt');
  if (error) throw error;
  const prizes = ((data ?? []) as { id: string; name: string; imageUrl: string | null }[])
    .filter((p): p is { id: string; name: string; imageUrl: string } => isCloudinaryUrl(p.imageUrl));

  const moves: PrizeImageMove[] = [];
  for (const prize of prizes) {
    const move: PrizeImageMove = { prizeId: prize.id, name: prize.name, from: prize.imageUrl };
    moves.push(move);
    if (!apply) continue;
    try {
      const res = await fetchImpl(prize.imageUrl);
      if (!res.ok) throw new Error(`Cloudinary answered ${res.status}`);
      const stored = await storeImage(db, MEDIA_BUCKETS.prize, MEDIA_FOLDERS.prizes, Buffer.from(await res.arrayBuffer()));
      const { data: updated, error: updateError } = await db
        .from('Prize')
        .update({ imageUrl: stored.url, updatedAt: new Date().toISOString() })
        .eq('id', prize.id)
        .eq('imageUrl', prize.imageUrl)
        .select('id');
      if (updateError || !updated || updated.length === 0) {
        await deleteStoredImage(db, stored.url).catch(() => undefined);
        throw updateError ?? new Error('The prize image was changed meanwhile, so it was left alone');
      }
      move.to = stored.url;
    } catch (err) {
      move.error = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
    }
  }
  return moves;
}

/** Migrate player profile avatars pointing to Cloudinary into Supabase Storage. */
export async function migrateUserAvatarsFromCloudinary(
  db: Db,
  { apply, fetchImpl = fetch }: { apply: boolean; fetchImpl?: typeof fetch },
): Promise<UserAvatarMove[]> {
  const { data, error } = await db.from('User').select('id, name, email, profilePicture');
  if (error) throw error;
  const users = ((data ?? []) as { id: string; name: string | null; email: string | null; profilePicture: string | null }[])
    .filter((u): u is { id: string; name: string | null; email: string | null; profilePicture: string } => isCloudinaryUrl(u.profilePicture));

  const moves: UserAvatarMove[] = [];
  for (const user of users) {
    const move: UserAvatarMove = {
      userId: user.id,
      name: user.name || user.email || user.id,
      from: user.profilePicture,
    };
    moves.push(move);
    if (!apply) continue;
    try {
      const res = await fetchImpl(user.profilePicture);
      if (!res.ok) throw new Error(`Cloudinary answered ${res.status}`);
      const stored = await storeImage(db, MEDIA_BUCKETS.avatar, user.id, Buffer.from(await res.arrayBuffer()));
      const { data: updated, error: updateError } = await db
        .from('User')
        .update({ profilePicture: stored.url, updatedAt: new Date().toISOString() })
        .eq('id', user.id)
        .eq('profilePicture', user.profilePicture)
        .select('id');
      if (updateError || !updated || updated.length === 0) {
        await deleteStoredImage(db, stored.url).catch(() => undefined);
        throw updateError ?? new Error('The profile picture was changed meanwhile, so it was left alone');
      }
      move.to = stored.url;
    } catch (err) {
      move.error = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
    }
  }
  return moves;
}

/** Copy uploaded assets from the Cloudinary library into the Supabase site-media bucket. */
export async function migrateCloudinaryLibraryToSupabase(
  db: Db,
  {
    apply,
    fetchImpl = fetch,
    resources,
  }: {
    apply: boolean;
    fetchImpl?: typeof fetch;
    resources?: Array<{ public_id: string; secure_url?: string; url?: string; format?: string; bytes?: number }>;
  },
): Promise<CloudinaryLibraryMove[]> {
  let items = resources;
  if (!items) {
    try {
      const { v2: cloudinary } = await import('cloudinary');
      cloudinary.config({
        cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      const cloudRes = await cloudinary.api.resources({ max_results: 100, type: 'upload' });
      items = cloudRes?.resources || [];
    } catch (err) {
      console.warn('Could not list Cloudinary library resources:', err);
      items = [];
    }
  }

  const moves: CloudinaryLibraryMove[] = [];
  for (const item of items ?? []) {
    const src = item.secure_url || item.url;
    if (!src) continue;
    const move: CloudinaryLibraryMove = {
      publicId: item.public_id,
      from: src,
      format: item.format,
      bytes: item.bytes,
    };
    moves.push(move);
    if (!apply) continue;
    try {
      const res = await fetchImpl(src);
      if (!res.ok) throw new Error(`Cloudinary answered ${res.status}`);
      const stored = await storeImage(db, MEDIA_BUCKETS.site, MEDIA_FOLDERS.siteUploads, Buffer.from(await res.arrayBuffer()));
      move.to = stored.url;
    } catch (err) {
      move.error = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
    }
  }
  return moves;
}

/** Get the configured primary storage provider from AppSettings. */
export async function getPrimaryStorageProvider(db: Db): Promise<StorageProvider> {
  try {
    const { data, error } = await db
      .from('AppSettings')
      .select('value')
      .eq('key', PRIMARY_STORAGE_KEY)
      .maybeSingle();
    if (error || !data?.value) return DEFAULT_PRIMARY_STORAGE;
    return data.value === 'cloudinary' ? 'cloudinary' : 'supabase';
  } catch {
    return DEFAULT_PRIMARY_STORAGE;
  }
}

/** Set the primary storage provider in AppSettings. */
export async function setPrimaryStorageProvider(
  db: Db,
  provider: StorageProvider,
  updatedBy: string,
): Promise<void> {
  const { error } = await db.from('AppSettings').upsert(
    {
      key: PRIMARY_STORAGE_KEY,
      value: provider,
      description: 'Primary media storage provider (supabase or cloudinary)',
      updatedAt: new Date().toISOString(),
      updatedBy,
    },
    { onConflict: 'key' },
  );
  if (error) throw error;
}

/** Get counts of remaining assets referencing Cloudinary. */
export async function getCloudinaryPendingStats(
  db: Db,
  cloudinaryCount?: number,
): Promise<CloudinaryPendingStats> {
  let prizes = 0;
  let avatars = 0;
  try {
    const { data: prizeData } = await db.from('Prize').select('imageUrl');
    prizes = (prizeData ?? []).filter((p: { imageUrl: string | null }) => isCloudinaryUrl(p.imageUrl)).length;
  } catch {}

  try {
    const { data: userData } = await db.from('User').select('profilePicture');
    avatars = (userData ?? []).filter((u: { profilePicture: string | null }) => isCloudinaryUrl(u.profilePicture)).length;
  } catch {}

  const library = typeof cloudinaryCount === 'number' ? cloudinaryCount : 0;
  return {
    prizes,
    avatars,
    library,
    total: prizes + avatars + library,
  };
}

/**
 * Move all Cloudinary assets to Supabase Storage:
 * 1. Copies all prize images from Cloudinary into prize-images bucket and updates Prize table.
 * 2. Copies all user avatars from Cloudinary into avatars bucket and updates User table.
 * 3. Copies uploaded assets from Cloudinary library into site-media bucket.
 * 4. Sets Supabase as the primary storage provider in AppSettings.
 */
export async function migrateAllCloudinaryAssetsToSupabase(
  db: Db,
  adminEmail: string,
  options?: { fetchImpl?: typeof fetch; resources?: any[] },
): Promise<FullMigrationResult> {
  const fetchImpl = options?.fetchImpl || fetch;

  // 1. Move prize images
  const prizeMoves = await migratePrizeImagesFromCloudinary(db, { apply: true, fetchImpl });
  const prizesMigrated = prizeMoves.filter((m) => !!m.to).length;
  const prizesFailed = prizeMoves.filter((m) => !!m.error).length;

  // 2. Move player profile avatars
  const avatarMoves = await migrateUserAvatarsFromCloudinary(db, { apply: true, fetchImpl });
  const avatarsMigrated = avatarMoves.filter((m) => !!m.to).length;
  const avatarsFailed = avatarMoves.filter((m) => !!m.error).length;

  // 3. Move Cloudinary library resources
  const libraryMoves = await migrateCloudinaryLibraryToSupabase(db, {
    apply: true,
    fetchImpl,
    resources: options?.resources,
  });
  const libraryMigrated = libraryMoves.filter((m) => !!m.to).length;
  const libraryFailed = libraryMoves.filter((m) => !!m.error).length;

  // 4. Set Supabase as primary storage provider
  await setPrimaryStorageProvider(db, 'supabase', adminEmail);

  const totalMigrated = prizesMigrated + avatarsMigrated + libraryMigrated;
  const totalFailed = prizesFailed + avatarsFailed + libraryFailed;

  return {
    success: totalFailed === 0 || totalMigrated > 0,
    provider: 'supabase',
    prizesMigrated,
    prizesFailed,
    avatarsMigrated,
    avatarsFailed,
    libraryMigrated,
    libraryFailed,
    totalMigrated,
    totalFailed,
    details: {
      prizes: prizeMoves,
      avatars: avatarMoves,
      library: libraryMoves,
    },
    message:
      totalMigrated > 0
        ? `Successfully moved ${totalMigrated} asset(s) to Supabase Storage. Supabase is now the primary storage service.`
        : `Supabase Storage is now set as the primary storage service. (No pending Cloudinary assets needed migration).`,
  };
}
