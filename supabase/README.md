# Media storage (Supabase Storage)

New images are stored in Supabase Storage instead of Cloudinary. Older Cloudinary images keep
working: the app still recognises and resizes Cloudinary URLs.

| Bucket | What | Who can write | Stored sizes (WebP) |
| --- | --- | --- | --- |
| `site-media` | Site images (logos, banners) uploaded on /admin/media | server only, after the admin check | 640, 1280, 1920 px wide |
| `prize-images` | Prize pictures (prize form, /admin/media) | server only, after the admin check | 320, 640, 1280 px wide |
| `avatars` | Players' profile pictures, `avatars/<user id>/` | the player, own folder only (storage policy) | 256 × 256 crop |

All three buckets are public to read by URL, but nobody can list them. Only WebP is accepted, with
1 MB per avatar file and 5 MB per file in the others.

## How image optimisation works

- **Once, on upload.** The Next.js server uses `sharp`, which is already installed and already runs
  on Hostinger. It reads the real format from the bytes, turns the photo upright, strips
  EXIF/GPS data and writes the fixed sizes above as WebP (quality 80, never enlarged). The code is
  in `src/lib/media/image-processing.ts`.
- **On every page view, nothing is processed.** `<Image>` uses `mediaImageLoader`
  (`src/lib/media/config.ts`). It points the browser at the smallest stored size that covers the
  space on screen: a 48px table thumbnail loads the 320px file, and a prize card loads 640px. Files
  are served by Supabase's CDN, and their names never change, so they are cached for a year.
- Older Cloudinary URLs still go through Cloudinary's resizing (`cloudinaryLoader`).

### Cost

| Option | Extra cost | Why not |
| --- | --- | --- |
| **Resize on upload (chosen)** | None. Storage is a few KB per image, well inside Pro's 100 GB, and egress is inside 250 GB. | n/a |
| Supabase Image Transformations | Pro includes 100 origin images a month, then **$5 per 1,000**. Every distinct avatar shown counts. | Grows with players, so it bills as the site grows. |
| `next/image` default optimiser | No Supabase cost | Resizes on the Hostinger server on first view of each size, using CPU the site already runs short of. The cache is lost on every redeploy. |

Recommended: turn **off** "Enable Image Transformations" in the Supabase Dashboard
(Storage → Settings). The app never uses it, and with it on, anyone could request transformed copies
of the public images and use up the quota.

## Automatic deletion

- **Profile pictures are deleted immediately.** After the new picture is saved to the profile, every
  other file in the player's folder is deleted, along with an older Cloudinary avatar
  (`src/app/api/profile/upload-picture/route.ts`). "Remove picture" works the same way.
- **Prize images are deleted after a delay.** When a prize's image is replaced, or the prize is
  deleted, the old image goes into the `MediaDeletion` queue. The scheduler (`runScheduledJobs`,
  checked every 15 minutes) deletes it once it is older than **`prize_image_retention_days`**. That
  is an AppSettings value, 30 by default, 0 to 365, and can be changed on /admin/media. The delay is
  applied when the queue runs, so changing it also affects images already waiting. An image that a
  prize uses again by then is kept, and "Keep" on /admin/media cancels a deletion. Failures are
  retried up to 5 times and then marked `failed`.

## Admin pages

- `/admin/media`: usage per bucket, the prize and site image galleries (upload, copy link, delete;
  delete is blocked while a prize uses the image), the retention setting and the deletion queue.
- `/admin/media/profile-pictures`: players' pictures with name and email, on a separate page.
  Remove one for moderation.
- `/admin/media/cloudinary`: the previous Cloudinary view, for the older images.

## Applying it to production (in this order)

1. Apply `migrations/20261018120000_media_storage.sql` (for example with the Supabase MCP
   `apply_migration`). It creates the 3 buckets, 4 policies, the `MediaDeletion` table, the
   `prize_image_retention_days` AppSettings row and 2 read-only listing functions. It changes no
   existing rows, buckets or files, and it is safe to re-run.
2. Deploy the app.
3. Optional, after the deploy is checked: copy the prize images off Cloudinary.
   `bun supabase/scripts/migrate-cloudinary-images.ts` is a dry run that lists them. Adding
   `--apply` copies them and repoints the prizes. Cloudinary files are never deleted.
4. Optional: turn off Image Transformations (see above).

## Tests

- Unit tests: `bun run test:coverage` (`src/tests/lib/media-*.test.ts`,
  `src/tests/actions/supabase-media-actions.test.ts`, `src/tests/pages/admin-media-pages.test.tsx`
  and the route tests).
- Policy tests, run locally only (never against the real project): see the header of
  `tests/media_storage.test.sql`. They check that players write only their own avatar folder,
  nobody can list buckets, players and anon cannot write `site-media`/`prize-images`, the listing
  functions and the queue are server-only, and a re-run keeps an edited retention value.
