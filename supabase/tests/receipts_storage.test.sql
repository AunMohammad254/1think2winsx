-- Assertions for supabase/migrations/20261018160000_receipts_bucket.sql. Any failure raises.
-- LOCAL ONLY: run after storage-shim.sql and the migration, on a throwaway database
-- (same steps as the header of media_storage.test.sql, with this file and migration added).
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

select pg_temp.expect_rows($$select 1 from storage.buckets where id = 'receipts' and not public
  and file_size_limit = 5242880 and allowed_mime_types = array['image/jpeg','image/png','image/webp']$$, 1, 'receipts is private, images only, 5 MB');
select pg_temp.expect_rows($$select 1 from pg_policies where schemaname = 'storage' and policyname in ('Users can upload receipts', 'Public can view receipts')$$, 0, 'old open receipt policies absent');

-- Another player's receipt, stored through the server
set role service_role;
insert into storage.objects (bucket_id, name) values ('receipts', :'B' || '/b.png');
reset role;

-- Player A
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'A', 'role', 'authenticated')::text, false);
insert into storage.objects (bucket_id, name, owner) values ('receipts', :'A' || '/a.png', :'A');
\echo ok   player uploads a receipt into own folder
select pg_temp.expect_denied(format($$insert into storage.objects (bucket_id, name) values ('receipts', %L)$$, :'B' || '/fake.png'), 'player uploads into another player''s receipts');
select pg_temp.expect_denied($$insert into storage.objects (bucket_id, name) values ('receipts', 'loose.png')$$, 'player uploads to the receipts root');
select pg_temp.expect_rows($$select 1 from storage.objects where bucket_id = 'receipts'$$, 1, 'player sees only own receipt');
select pg_temp.expect_rows(format($$update storage.objects set metadata = '{}' where name = %L returning 1$$, :'A' || '/a.png'), 0, 'player cannot replace a sent receipt');
select pg_temp.expect_rows(format($$delete from storage.objects where name = %L returning 1$$, :'A' || '/a.png'), 0, 'player cannot delete a sent receipt');
select pg_temp.expect_rows(format($$delete from storage.objects where name = %L returning 1$$, :'B' || '/b.png'), 0, 'player cannot delete another receipt');
reset role;

-- Anonymous
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect_denied($$insert into storage.objects (bucket_id, name) values ('receipts', 'x/y.png')$$, 'anon uploads a receipt');
select pg_temp.expect_rows($$select 1 from storage.objects where bucket_id = 'receipts'$$, 0, 'anon reads no receipts');
reset role;

-- Server (admin page signs links with the service role)
set role service_role;
select pg_temp.expect_rows($$select 1 from storage.objects where bucket_id = 'receipts'$$, 2, 'service role reads every receipt');
reset role;
\echo ALL RECEIPTS TESTS PASSED
