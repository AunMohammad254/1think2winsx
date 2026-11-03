-- =============================================================================
-- Email services: Cloudflare Email Service as a third service, after Amazon SES and Brevo
--
-- NOT applied yet: needs the owner's OK before it runs on production (eclivawqhdovsndlngfo).
-- Apply it before the code that can select Cloudflare is deployed. The live build keeps working with
-- it: it only widens a check and adds a setting, and email_quota_settings() gives the same limits
-- for ses and brevo as before.
--
-- 1. "EmailLog".provider also accepts 'cloudflare'. Without this every Cloudflare email would fail
--    to log (the app logs best effort, so nothing would say so).
-- 2. AppSettings email_daily_limit_cloudflare: the daily limit while email_provider is cloudflare.
--    99 a day keeps a month inside the 3,000 emails the Workers Paid plan includes; past them
--    Cloudflare charges $0.35 per 1,000. An admin can change it on the Email services page.
-- 3. email_quota_settings() returns that limit when Cloudflare is selected. Nothing else changes in
--    the daily-limit functions.
--
-- Only the service role can reach any of this. Safe to re-run.
-- =============================================================================

-- 0. Guard --------------------------------------------------------------------------------------
-- email_quota_settings() must be the 20261023120000 version (or this one, on a re-run). A different
-- body means someone changed it since: merge that change here first.
DO $guard$
DECLARE
  v_settings text;
BEGIN
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_settings FROM pg_proc
   WHERE oid = 'public.email_quota_settings()'::regprocedure;
  IF v_settings IS DISTINCT FROM '3fbb0ece5afff5010a7b71bbb007864c' AND v_settings IS DISTINCT FROM 'ea2d9d962accce46c887aa5368c88f92' THEN
    RAISE EXCEPTION 'public.email_quota_settings() is not the version this migration was written against (body md5 %): merge the change into the migration first', v_settings;
  END IF;
END
$guard$;

-- 1. The log ------------------------------------------------------------------------------------
ALTER TABLE public."EmailLog" DROP CONSTRAINT IF EXISTS "EmailLog_provider_check";
ALTER TABLE public."EmailLog" ADD CONSTRAINT "EmailLog_provider_check"
  CHECK (provider = ANY (ARRAY['ses'::text, 'brevo'::text, 'cloudflare'::text]));

-- 2. Settings -----------------------------------------------------------------------------------
INSERT INTO public."AppSettings" (key, value, description) VALUES
  ('email_daily_limit_cloudflare', '99',
   'Most emails the app sends in any 24 hours while email_provider is cloudflare. 99 a day stays inside the 3,000 a month the Workers Paid plan includes; keep it under the Cloudflare daily quota too.')
ON CONFLICT (key) DO NOTHING;

UPDATE public."AppSettings"
   SET description = 'The email service the app sends through: ses, brevo or cloudflare. Changed by an admin on the Email services page; never automatically.'
 WHERE key = 'email_provider';

-- 3. The limit of the selected service: email_daily_limit_ses (default 199) for ses,
-- email_daily_limit_cloudflare (default 99) for cloudflare, otherwise email_daily_limit (default 299).
-- The reserve is never more than the limit.
CREATE OR REPLACE FUNCTION public.email_quota_settings(OUT daily_limit integer, OUT essential_reserve integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT coalesce((SELECT btrim(value) FROM "AppSettings" WHERE key = 'email_provider'), 'brevo') AS provider
  ), s AS (
    SELECT CASE p.provider
             WHEN 'ses' THEN coalesce((SELECT value::integer FROM "AppSettings"
                             WHERE key = 'email_daily_limit_ses' AND btrim(value) ~ '^[0-9]{1,7}$'), 199)
             WHEN 'cloudflare' THEN coalesce((SELECT value::integer FROM "AppSettings"
                             WHERE key = 'email_daily_limit_cloudflare' AND btrim(value) ~ '^[0-9]{1,7}$'), 99)
             ELSE coalesce((SELECT value::integer FROM "AppSettings"
                             WHERE key = 'email_daily_limit' AND btrim(value) ~ '^[0-9]{1,7}$'), 299)
           END AS lim,
           coalesce((SELECT value::integer FROM "AppSettings"
                      WHERE key = 'email_essential_reserve' AND btrim(value) ~ '^[0-9]{1,7}$'), 20) AS res
      FROM p
  )
  SELECT lim, LEAST(res, lim) FROM s
$function$;
REVOKE ALL ON FUNCTION public.email_quota_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_quota_settings() TO service_role;
