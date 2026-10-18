-- Assertions for supabase/migrations/20261018150000_media_storage.sql. Any failure raises.
-- LOCAL ONLY: run against a throwaway Postgres 17, never the real project, e.g.
--   docker run -d --rm --name t2w-media-test -p 127.0.0.1:54339:5432 -e POSTGRES_PASSWORD=postgres postgres:17-alpine
--   psql postgres://postgres:postgres@127.0.0.1:54339/postgres -v ON_ERROR_STOP=1
--     -f supabase/tests/storage-shim.sql -f supabase/migrations/20261018150000_media_storage.sql
--     -f supabase/tests/media_storage.test.sql
--   docker stop t2w-media-test
\set ON_ERROR_STOP on
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'

create or replace function pg_temp.expect_denied(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when insufficient_privilege or check_violation then
    raise notice 'ok   denied: %', label; return;
  end;
  raise exception 'FAIL expected denial: %', label;
end $$;
create or replace function pg_temp.expect_rows(sql text, expected int, label text) returns void language plpgsql as $$
declare n int;
begin
  execute 'with t as (' || sql || ') select count(*) from t' into n;
  if n <> expected then raise exception 'FAIL %: expected % rows, got %', label, expected, n; end if;
  raise notice 'ok   %: % rows', label, n;
end $$;
grant execute on function pg_temp.expect_denied(text, text), pg_temp.expect_rows(text, int, text) to anon, authenticated, service_role;

-- Buckets
select pg_temp.expect_rows($$select 1 from storage.buckets where id in ('site-media','prize-images','avatars') and public and allowed_mime_types = array['image/webp']$$, 3, 'three public webp-only buckets');
select pg_temp.expect_rows($$select 1 from storage.buckets where id = 'avatars' and file_size_limit = 1048576$$, 1, 'avatars 1 MB limit');
select pg_temp.expect_rows($$select 1 from public."AppSettings" where key = 'prize_image_retention_days' and value = '30'$$, 1, 'retention setting seeded at 30');
select pg_temp.expect_rows($$select 1 from pg_policies where schemaname = 'storage' and policyname like 'Users can%'$$, 2, 'old uploads policies untouched');

-- Seed objects as the service role (server code path)
set role service_role;
insert into storage.objects (bucket_id, name, metadata) values
  ('prize-images', 'prizes/p1-320.webp',  '{"size": 1000}'),
  ('prize-images', 'prizes/p1-640.webp',  '{"size": 3000}'),
  ('prize-images', 'prizes/p1-1280.webp', '{"size": 9000}'),
  ('site-media',   'uploads/s1-1920.webp', '{"size": 20000}'),
  ('avatars',      :'B' || '/b1-256.webp', '{"size": 500}');
reset role;

-- Player A
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'A', 'role', 'authenticated')::text, false);
insert into storage.objects (bucket_id, name, owner) values ('avatars', :'A' || '/a1-256.webp', :'A');
\echo ok   player inserts into own avatar folder
select pg_temp.expect_denied(format($$insert into storage.objects (bucket_id, name) values ('avatars', %L)$$, :'B' || '/evil-256.webp'), 'player writes another player''s folder');
select pg_temp.expect_denied($$insert into storage.objects (bucket_id, name) values ('avatars', 'a1-256.webp')$$, 'player writes avatars bucket root');
select pg_temp.expect_denied($$insert into storage.objects (bucket_id, name) values ('prize-images', 'prizes/evil-1280.webp')$$, 'player writes prize-images');
select pg_temp.expect_denied($$insert into storage.objects (bucket_id, name) values ('site-media', 'uploads/evil-1920.webp')$$, 'player writes site-media');
select pg_temp.expect_rows($$select 1 from storage.objects$$, 1, 'player sees only own avatar');
select pg_temp.expect_rows(format($$update storage.objects set metadata = '{}' where name = %L returning 1$$, :'B' || '/b1-256.webp'), 0, 'player updates another player''s avatar');
select pg_temp.expect_denied(format($$update storage.objects set name = %L where name = %L$$, :'B' || '/moved-256.webp', :'A' || '/a1-256.webp'), 'player moves own file into another folder');
select pg_temp.expect_rows(format($$delete from storage.objects where name = %L returning 1$$, :'B' || '/b1-256.webp'), 0, 'player deletes another player''s avatar');
select pg_temp.expect_rows($$delete from storage.objects where bucket_id = 'prize-images' returning 1$$, 0, 'player deletes prize images');
select pg_temp.expect_rows(format($$delete from storage.objects where name = %L returning 1$$, :'A' || '/a1-256.webp'), 1, 'player deletes own avatar');
select pg_temp.expect_denied($$select * from public.media_storage_usage()$$, 'player calls media_storage_usage');
select pg_temp.expect_denied($$select * from public.media_storage_objects('avatars')$$, 'player calls media_storage_objects');
select pg_temp.expect_denied($$select * from public."MediaDeletion"$$, 'player reads MediaDeletion');
reset role;

-- Anonymous
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect_denied($$insert into storage.objects (bucket_id, name) values ('avatars', 'x/y-256.webp')$$, 'anon writes avatars');
select pg_temp.expect_rows($$select 1 from storage.objects$$, 0, 'anon cannot list any bucket');
select pg_temp.expect_denied($$select * from public.media_storage_usage()$$, 'anon calls media_storage_usage');
select pg_temp.expect_denied($$insert into public."MediaDeletion" (id, url, reason) values ('x', 'u', 'prize_deleted')$$, 'anon writes MediaDeletion');
reset role;

-- Old 'uploads' INSERT policy (auth.role() = authenticated) must not open the new buckets
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'A', 'role', 'authenticated')::text, false);
select pg_temp.expect_denied($$insert into storage.objects (bucket_id, name) values ('site-media', 'assets/x-1920.webp')$$, 'uploads policy does not reach site-media');
reset role;

-- Service role: listings and queue
set role service_role;
select pg_temp.expect_rows($$select 1 from public.media_storage_usage() where bucket_id = 'prize-images' and object_count = 3 and total_bytes = 13000$$, 1, 'usage per bucket');
select pg_temp.expect_rows($$select 1 from public.media_storage_usage()$$, 3, 'usage covers the three media buckets only');
select pg_temp.expect_rows($$select 1 from public.media_storage_objects('prize-images', 'prizes/', '-1280.webp')$$, 1, 'suffix filter: one row per image');
select pg_temp.expect_rows($$select 1 from public.media_storage_objects('prize-images', 'prizes/', '', 2, 0) where total_count = 3$$, 2, 'limit + total_count');
select pg_temp.expect_rows($$select 1 from public.media_storage_objects('prize-images', 'prizes/', '', 2, 2)$$, 1, 'offset');
select pg_temp.expect_rows($$select 1 from public.media_storage_objects('prize-images', '%', '')$$, 0, 'prefix is literal, not a wildcard');
select pg_temp.expect_rows($$select 1 from public.media_storage_objects('uploads')$$, 0, 'other buckets are not listable');
select pg_temp.expect_rows($$select 1 from public.media_storage_objects('prize-images', null, null, null, null)$$, 3, 'null arguments fall back to defaults');
insert into public."MediaDeletion" (id, url, reason, "prizeId") values ('d1', 'https://x/p1-1280.webp', 'prize_image_replaced', 'prize1');
select pg_temp.expect_rows($$select 1 from public."MediaDeletion" where status = 'pending' and attempts = 0$$, 1, 'queue row defaults');
select pg_temp.expect_denied($$insert into public."MediaDeletion" (id, url, reason) values ('d2', 'u', 'whatever')$$, 'reason check constraint');
select pg_temp.expect_denied($$update public."MediaDeletion" set status = 'gone' where id = 'd1'$$, 'status check constraint');
reset role;
\echo ALL MEDIA STORAGE TESTS PASSED
