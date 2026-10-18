-- Minimal stand-in for what a Supabase project provides (roles, auth.uid(), storage schema),
-- modelled on Supabase's own definitions. LOCAL TEST ONLY: run on a throwaway database, before the
-- migration (see the header of media_storage.test.sql).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to postgres;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role'))::text $$;
grant usage on schema auth to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, owner uuid, created_at timestamptz default now(),
  updated_at timestamptz default now(), public boolean default false,
  avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[], owner_id text);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored, version text, owner_id text,
  unique (bucket_id, name));
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Supabase's default privileges: new public tables/functions are granted to the API roles
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public."AppSettings" (key text primary key, value text not null, description text,
  "updatedAt" timestamptz not null default now(), "updatedBy" text);
insert into public."AppSettings" (key, value) values ('wallet_enabled', 'false');

-- What production has today on the old 'uploads' bucket (to prove it doesn't leak into new buckets)
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', true);
create policy "Authenticated users can upload" on storage.objects for insert to public
  with check (bucket_id = 'uploads' and auth.role() = 'authenticated');
create policy "Users can update own files" on storage.objects for update to public
  using (bucket_id = 'uploads' and auth.uid() = owner);
create policy "Users can delete own files" on storage.objects for delete to public
  using (bucket_id = 'uploads' and auth.uid() = owner);
