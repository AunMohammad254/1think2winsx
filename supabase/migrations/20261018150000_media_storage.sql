-- =============================================================================
-- Media storage on Supabase (replaces Cloudinary for new uploads)
--
--   site-media    admin/site images (logos, banners, general uploads)   admin write only
--   prize-images  prize pictures                                       admin write only
--   avatars       player profile pictures, one folder per player        player writes own folder
--
-- The app resizes every image ONCE on upload (sharp, in the Next.js server) and stores fixed
-- WebP sizes, e.g. prizes/<id>-320.webp, -640.webp, -1280.webp. Pages link straight to those
-- files, so Supabase Image Transformations (billed per origin image beyond 100/month on Pro)
-- are never used.
--
-- Also adds:
--   "MediaDeletion"              queue of replaced/deleted prize images, removed after a delay
--   AppSettings 'prize_image_retention_days' (default 30) that sets the delay
--   media_storage_usage(), media_storage_objects()   read-only listings for /admin/media
--
-- Safe to re-run. Touches no existing rows, buckets or files (the old 'uploads' bucket and its
-- policies are left as they are).
-- =============================================================================

-- 1. Buckets ------------------------------------------------------------------
-- public = true: files are readable by their /storage/v1/object/public/... URL without a SELECT
-- policy. No public SELECT policy is added, so nobody can LIST a bucket (lint 0025).
-- Only WebP is accepted: the server converts every upload before storing it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('site-media',   'site-media',   true, 5242880, array['image/webp']),  -- 5 MB per file
  ('prize-images', 'prize-images', true, 5242880, array['image/webp']),  -- 5 MB per file
  ('avatars',      'avatars',      true, 1048576, array['image/webp'])   -- 1 MB per file
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Storage policies ------------------------------------------------------------
-- site-media and prize-images get NO policies for anon/authenticated: only the service role
-- (server code, after its admin-session check) can write or delete there.
--
-- avatars: a signed-in player may read, add, replace and delete files only inside
-- avatars/<their auth uid>/. SELECT is needed for remove() and list() of their own folder.
drop policy if exists "avatars_owner_select" on storage.objects;
create policy "avatars_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 3. Delayed deletion queue ----------------------------------------------------------
-- A replaced (or deleted) prize image is queued here instead of being deleted at once.
-- The scheduler deletes it once createdAt is older than prize_image_retention_days, unless a
-- prize uses that image again. Server-only (service role): RLS on, no policies, no grants.
create table if not exists public."MediaDeletion" (
  id            text primary key,
  url           text not null,
  reason        text not null check (reason in ('prize_image_replaced', 'prize_deleted')),
  "prizeId"     text,
  status        text not null default 'pending'
                check (status in ('pending', 'deleted', 'kept', 'cancelled', 'failed')),
  attempts      integer not null default 0,
  "lastError"   text,
  "createdAt"   timestamptz not null default now(),
  "processedAt" timestamptz
);
create index if not exists "MediaDeletion_pending_createdAt_idx"
  on public."MediaDeletion" ("createdAt") where status = 'pending';

alter table public."MediaDeletion" enable row level security;
revoke all on table public."MediaDeletion" from anon, authenticated;
-- This project's default privileges do not grant new tables to service_role, so grant it here
-- (the server's admin client reads and writes the queue).
grant select, insert, update, delete on table public."MediaDeletion" to service_role;

-- 4. Retention setting (admin-editable on /admin/media) ----------------------------------
insert into public."AppSettings" (key, value, description)
values ('prize_image_retention_days', '30',
        'Days a replaced or deleted prize image is kept before it is deleted from storage (0-365).')
on conflict (key) do nothing;

-- 5. Read-only listings for the admin media pages (service role only) ---------------------
-- storage.objects is not exposed through the API, so the admin pages read it through these.
create or replace function public.media_storage_usage()
returns table (bucket_id text, object_count bigint, total_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id,
         count(*)::bigint,
         coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id in ('site-media', 'prize-images', 'avatars')
  group by o.bucket_id
$$;

-- Newest first. p_prefix / p_suffix match the start / end of the object name exactly (no
-- wildcards), e.g. suffix '-1280.webp' lists one row per prize image instead of one per size.
create or replace function public.media_storage_objects(
  p_bucket text,
  p_prefix text default '',
  p_suffix text default '',
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (name text, size bigint, created_at timestamptz, total_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name,
         coalesce((o.metadata ->> 'size')::bigint, 0)::bigint,
         o.created_at,
         count(*) over ()::bigint
  from storage.objects o
  where o.bucket_id = p_bucket
    and p_bucket in ('site-media', 'prize-images', 'avatars')
    and left(o.name, length(coalesce(p_prefix, ''))) = coalesce(p_prefix, '')
    and right(o.name, length(coalesce(p_suffix, ''))) = coalesce(p_suffix, '')
  order by o.created_at desc, o.name
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke execute on function public.media_storage_usage() from public, anon, authenticated;
revoke execute on function public.media_storage_objects(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.media_storage_usage() to service_role;
grant execute on function public.media_storage_objects(text, text, text, integer, integer) to service_role;
