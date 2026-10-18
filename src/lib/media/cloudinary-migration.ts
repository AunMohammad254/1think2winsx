import type { SupabaseClient } from '@supabase/supabase-js';
import { isCloudinaryUrl } from '@/lib/cloudinary';
import { MEDIA_BUCKETS, MEDIA_FOLDERS } from './config';
import { deleteStoredImage, storeImage } from './storage.server';

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

type Db = Pick<SupabaseClient, 'from' | 'storage'>;

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
