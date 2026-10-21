-- Step 2.5, loaded first (same transaction as roles.sql and schema.sql), on the NEW project only.
--
-- Production has no default grants in schema public: a new table, function or sequence there is private until
-- it is granted on purpose. A new Supabase project starts with default grants of everything in public to anon,
-- authenticated and service_role, and schema.sql only adds grants, never removes these. Without this file the
-- 2026-10-20 rehearsal gave the API roles extra rights on 88 of 95 objects, including EXECUTE on admin-only
-- functions such as approve_claim and allocate_points_to_winners.
alter default privileges for role postgres in schema public revoke all on tables from postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from postgres, anon, authenticated, service_role;

-- Production grants USAGE on schema public to PUBLIC (everyone) and explicitly only to authenticated; a new
-- project also names anon and service_role. Same effect today; removed so the permission check matches exactly.
revoke usage on schema public from anon, service_role;

-- Marks this database as the move's target: truncate.sql (written by dump-all.sh data) refuses to run anywhere
-- without it, so it can never empty the old project. Dropped after the move (step 5).
create schema if not exists _move_target;
