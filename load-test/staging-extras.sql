-- =============================================================================
-- Extras for a STAGING Supabase project cloned from production with pg_dump.
-- Run this in the STAGING project's SQL editor AFTER restoring the schema dump
-- (see RUNBOOK.md, step 3). NEVER run it against production.
--
-- A schema-only dump of the `public` and `private_hardened` schemas does not carry:
--   * extensions,
--   * the trigger on auth.users that creates the public."User" row for every new account,
--   * which tables the Realtime publication streams,
--   * pg_cron jobs (they live in the `cron` schema).
-- The list below was read from the live production catalog on 2026-10-08.
-- =============================================================================

-- 1. Extensions used by production (hypopg/index_advisor are dashboard advisors; optional)
CREATE EXTENSION IF NOT EXISTS pgcrypto      WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron       WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- 2. New auth user -> public."User" row (without this, seeded users have no profile row)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Realtime publication: production streams these two tables
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'Notification') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."Notification";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'Quiz') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."Quiz";
  END IF;
END $$;

-- 4. Leaderboard cache refresh (same as the Phase 1 migration)
SELECT cron.schedule('refresh-leaderboard', '*/5 * * * *', $cron$SELECT public.refresh_leaderboard_cache()$cron$);
SELECT public.refresh_leaderboard_cache();

-- 5. Sanity checks — compare with production (27 tables, 2 views, 52 + 4 functions)
SELECT
  (SELECT count(*) FROM information_schema.tables  WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS public_tables,
  (SELECT count(*) FROM information_schema.views   WHERE table_schema = 'public')                               AS public_views,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f')            AS public_functions,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private_hardened' AND p.prokind = 'f') AS private_functions,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'on_auth_user_created')                                       AS auth_trigger,
  (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-leaderboard')                                         AS cron_job;
