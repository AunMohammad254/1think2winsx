-- 00: the parts of a Supabase project that the app's schema depends on, for a plain
-- Postgres 17 test database. NOT applied to Supabase: a real project already has all of this.
--
-- * API roles: PostgREST runs each request as `anon` (no JWT), `authenticated` (signed-in
--   user) or `service_role` (server key, bypasses RLS).
-- * auth.uid() / auth.role() / auth.jwt(): same definitions as Supabase, reading the JWT
--   claims PostgREST puts in the `request.jwt.claims` setting. Tests set that setting
--   themselves (see db-tests/helpers.ts), exactly as PostgREST does per request.
-- * auth.users / auth.identities: only the columns the public schema references.

DO $x$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $x$;
DO $x$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $x$;
DO $x$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $x$;

-- Schema public as production has it (ACL read on 2026-10-20:
-- {postgres=UC/postgres,=UC/postgres,authenticated=U/postgres}): owned by postgres, USAGE and
-- CREATE for PUBLIC, and USAGE by name for authenticated only, so anon and service_role reach it
-- through PUBLIC. Postgres 17 creates the schema without CREATE for PUBLIC, so it is put back here,
-- and 06-20261020120000_revoke_public_create_on_public_schema.sql then removes it as in production.
ALTER SCHEMA public OWNER TO postgres;
GRANT USAGE, CREATE ON SCHEMA public TO PUBLIC;
GRANT USAGE ON SCHEMA public TO authenticated;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
 LANGUAGE sql STABLE
AS $function$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
 LANGUAGE sql STABLE
AS $function$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
 LANGUAGE sql STABLE
AS $function$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$function$;
