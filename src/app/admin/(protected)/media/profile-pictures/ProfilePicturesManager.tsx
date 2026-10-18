'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { mediaImageLoader } from '@/lib/media/config';
import {
  listProfilePictures,
  removeProfilePicture,
  type ProfilePicture,
  type ProfilePicturePage,
} from '@/actions/supabase-media-actions';
import { formatBytes, formatDate, Pager } from '../media-ui';

/** /admin/media/profile-pictures: players' own pictures, kept apart from the site's images. */
export default function ProfilePicturesManager() {
  const [page, setPage] = useState(0);
  const [listing, setListing] = useState<ProfilePicturePage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listProfilePictures(page);
    if (res.success) setListing(res.data);
    else toast.error(res.error);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (picture: ProfilePicture) => {
    const who = picture.userName || picture.email || 'this player';
    if (!confirm(`Remove ${who}'s profile picture? They can upload a new one later.`)) return;
    setBusy(picture.userId);
    const res = await removeProfilePicture(picture.userId);
    setBusy(null);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success('Profile picture removed');
    await load();
  };

  return (
    <div className="rounded-xl border border-white/10 bg-gray-900/60 p-6">
      <p className="mb-6 text-sm text-gray-400">
        Players upload these from their profile. Each picture is cropped to a 256px WebP square, and a player&apos;s
        previous picture is deleted as soon as they change it. Remove a picture here if it breaks the rules.
      </p>

      {!listing ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-label="Loading profile pictures" />
        </div>
      ) : listing.pictures.length === 0 ? (
        <p className="py-12 text-center text-gray-500">No player has uploaded a profile picture yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listing.pictures.map((picture) => (
            <div key={picture.url} className="flex items-center gap-4 rounded-lg border border-white/5 bg-gray-800 p-3">
              <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-gray-700">
                <Image
                  src={picture.url}
                  loader={mediaImageLoader}
                  alt={`${picture.userName || 'Player'}'s profile picture`}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium text-white">{picture.userName || 'Unknown player'}</p>
                <p className="truncate text-xs text-gray-400">{picture.email || picture.userId}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {formatBytes(picture.size)} · {formatDate(picture.createdAt)}
                  {!picture.isCurrent && <span className="ml-2 text-yellow-300">not on profile</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(picture)}
                disabled={busy === picture.userId}
                className="rounded bg-red-500/20 p-2 text-red-300 hover:bg-red-500 hover:text-white disabled:opacity-40"
                aria-label={`Remove ${picture.userName || picture.userId}'s profile picture`}
              >
                {busy === picture.userId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
      {listing && <Pager page={page} total={listing.total} pageSize={listing.pageSize} onPage={setPage} />}
    </div>
  );
}
