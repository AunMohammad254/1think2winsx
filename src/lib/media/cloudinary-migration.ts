import type { SupabaseClient } from '@supabase/supabase-js';
import { isCloudinaryUrl } from '@/lib/cloudinary';
import { MEDIA_BUCKETS, MEDIA_FOLDERS, type MediaBucket } from './config';
import { deleteStoredImage, storeImage } from './storage.server';

/**
 * Copies of images still served from Cloudinary into Supabase Storage: prize images
 * (supabase/data-migrations/migrate-cloudinary-images.ts runs that part on its own) and players'
 * profile pictures (the admin media pages run both).
 *
 * - Dry run unless `apply` is true: it only lists what would move.
 * - Copies the image AS SHOWN (the stored URL, with its named transformation), resized into the
 *   bucket's sizes, then points the row at the new URL.
 * - The row is only changed if it still has the old URL, so an edit made meanwhile wins and the
 *   copy is removed again.
 * - Never deletes or queues anything on Cloudinary: the old URLs keep working, and putting an
 *   old URL back on the row undoes the move. Running it again only finds rows still on Cloudinary.
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

export interface CloudinaryPendingStats {
  prizes: number;
  avatars: number;
  total: number;
}

export interface FullMigrationResult {
  prizesMigrated: number;
  prizesFailed: number;
  avatarsMigrated: number;
  avatarsFailed: number;
  totalMigrated: number;
  totalFailed: number;
  details: { prizes: PrizeImageMove[]; avatars: UserAvatarMove[] };
  message: string;
}

type Db = Pick<SupabaseClient, 'from' | 'storage'>;
type Options = { apply: boolean; fetchImpl?: typeof fetch };

/** Stored Cloudinary links all start like this; filtering on it keeps queries under the row cap. */
const CLOUDINARY_LINKS = 'https://res.cloudinary.com/%';

interface Target {
  table: 'Prize' | 'User';
  column: 'imageUrl' | 'profilePicture';
  bucket: MediaBucket;
  changedMeanwhile: string;
}

/** Copies one row's image and points the row at the copy; returns the new URL. */
async function moveImage(db: Db, target: Target, id: string, from: string, folder: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl(from);
  if (!res.ok) throw new Error(`Cloudinary answered ${res.status}`);
  const stored = await storeImage(db, target.bucket, folder, Buffer.from(await res.arrayBuffer()));
  const { data: updated, error: updateError } = await db
    .from(target.table)
    .update({ [target.column]: stored.url, updatedAt: new Date().toISOString() })
    .eq('id', id)
    .eq(target.column, from)
    .select('id');
  if (updateError || !updated || updated.length === 0) {
    await deleteStoredImage(db, stored.url).catch(() => undefined);
    throw updateError ?? new Error(target.changedMeanwhile);
  }
  return stored.url;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
}

export async function migratePrizeImagesFromCloudinary(
  db: Db,
  { apply, fetchImpl = fetch }: Options,
): Promise<PrizeImageMove[]> {
  const { data, error } = await db.from('Prize').select('id, name, imageUrl').order('createdAt');
  if (error) throw error;
  const prizes = ((data ?? []) as { id: string; name: string; imageUrl: string | null }[])
    .filter((p): p is { id: string; name: string; imageUrl: string } => isCloudinaryUrl(p.imageUrl));
  const target: Target = {
    table: 'Prize',
    column: 'imageUrl',
    bucket: MEDIA_BUCKETS.prize,
    changedMeanwhile: 'The prize image was changed meanwhile, so it was left alone',
  };

  const moves: PrizeImageMove[] = [];
  for (const prize of prizes) {
    const move: PrizeImageMove = { prizeId: prize.id, name: prize.name, from: prize.imageUrl };
    moves.push(move);
    if (!apply) continue;
    try {
      move.to = await moveImage(db, target, prize.id, prize.imageUrl, MEDIA_FOLDERS.prizes, fetchImpl);
    } catch (err) {
      move.error = errorText(err);
    }
  }
  return moves;
}

/** Players' profile pictures still on Cloudinary, copied into avatars/<their id>/. */
export async function migrateUserAvatarsFromCloudinary(
  db: Db,
  { apply, fetchImpl = fetch }: Options,
): Promise<UserAvatarMove[]> {
  const { data, error } = await db
    .from('User')
    .select('id, name, email, profilePicture')
    .like('profilePicture', CLOUDINARY_LINKS);
  if (error) throw error;
  const users = ((data ?? []) as { id: string; name: string | null; email: string | null; profilePicture: string | null }[])
    .filter((u): u is { id: string; name: string | null; email: string | null; profilePicture: string } => isCloudinaryUrl(u.profilePicture));
  const target: Target = {
    table: 'User',
    column: 'profilePicture',
    bucket: MEDIA_BUCKETS.avatar,
    changedMeanwhile: 'The profile picture was changed meanwhile, so it was left alone',
  };

  const moves: UserAvatarMove[] = [];
  for (const user of users) {
    const move: UserAvatarMove = { userId: user.id, name: user.name || user.email || user.id, from: user.profilePicture };
    moves.push(move);
    if (!apply) continue;
    try {
      move.to = await moveImage(db, target, user.id, user.profilePicture, user.id, fetchImpl);
    } catch (err) {
      move.error = errorText(err);
    }
  }
  return moves;
}

/** How many prize images and profile pictures still load from Cloudinary. */
export async function getCloudinaryPendingStats(db: Db): Promise<CloudinaryPendingStats> {
  const [prizes, avatars] = await Promise.all([
    migratePrizeImagesFromCloudinary(db, { apply: false }),
    migrateUserAvatarsFromCloudinary(db, { apply: false }),
  ]);
  return { prizes: prizes.length, avatars: avatars.length, total: prizes.length + avatars.length };
}

/** Copies every prize image and profile picture still on Cloudinary into Supabase Storage. */
export async function migrateAllCloudinaryAssetsToSupabase(
  db: Db,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<FullMigrationResult> {
  const prizes = await migratePrizeImagesFromCloudinary(db, { apply: true, fetchImpl: options.fetchImpl });
  const avatars = await migrateUserAvatarsFromCloudinary(db, { apply: true, fetchImpl: options.fetchImpl });
  const moved = (moves: { to?: string }[]) => moves.filter((m) => m.to).length;
  const result = {
    prizesMigrated: moved(prizes),
    prizesFailed: prizes.length - moved(prizes),
    avatarsMigrated: moved(avatars),
    avatarsFailed: avatars.length - moved(avatars),
  };
  const totalMigrated = result.prizesMigrated + result.avatarsMigrated;
  const totalFailed = result.prizesFailed + result.avatarsFailed;
  const message = totalFailed > 0
    ? `Moved ${totalMigrated} image(s); ${totalFailed} could not be moved and still load from Cloudinary.`
    : totalMigrated > 0
      ? `Moved ${totalMigrated} image(s) to Supabase Storage.`
      : 'Nothing to move: no prize image or profile picture loads from Cloudinary.';
  return { ...result, totalMigrated, totalFailed, details: { prizes, avatars }, message };
}
