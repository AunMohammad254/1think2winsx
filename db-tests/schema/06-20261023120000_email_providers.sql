-- =============================================================================
-- Email services: Amazon SES or Brevo, switched by an admin, with a log of every email
--
-- NOT applied to any database yet. Needs the owner's approval for production (eclivawqhdovsndlngfo).
-- It needs 20261022140000_email_daily_quota first (applied 2026-10-22 as 20261022113445). The live
-- build keeps working with it: nothing reads "EmailLog" yet, and email_provider defaults to Brevo,
-- so the daily limit stays 299.
--
-- 1. "EmailLog": one row per email the app sends (time, type, recipient, provider, result), so the
--    admin "Email services" page can list them. Bounce and complaint notices from SES and Brevo update
--    the row through record_email_event(). Rows older than 90 days are pruned as new ones arrive.
-- 2. AppSettings email_provider ('brevo' or 'ses') picks the service. Only an admin changes it; the
--    app never switches by itself. email_daily_limit_ses is the SES limit (199 while the SES account
--    is in the sandbox, which allows 200 a day); email_daily_limit stays the Brevo limit (299).
-- 3. email_quota_settings() now returns the limit of the selected service. Nothing else changes in
--    the daily-limit functions.
--
-- Only the service role can reach any of this. Safe to re-run.
-- =============================================================================

-- 0. Guard --------------------------------------------------------------------------------------
-- email_quota_settings() must be the 20261022140000 version (or this one, on a re-run). A different
-- body means someone changed it since: merge that change here first.
DO $guard$
DECLARE
  v_settings text;
BEGIN
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_settings FROM pg_proc
   WHERE oid = 'public.email_quota_settings()'::regprocedure;
  IF v_settings IS DISTINCT FROM '856596f8ef47b2cb1a080a80e8aa3af2' AND v_settings IS DISTINCT FROM '3fbb0ece5afff5010a7b71bbb007864c' THEN
    RAISE EXCEPTION 'public.email_quota_settings() is not the version this migration was written against (body md5 %): merge the change into the migration first', v_settings;
  END IF;
END
$guard$;

-- 1. The log ------------------------------------------------------------------------------------
-- kind: the same types as "EmailSend". status: accepted (the service took it), failed (it refused or
-- couldn't be reached), then delivered / bounced / complained from the service's notices.
CREATE TABLE IF NOT EXISTS public."EmailLog" (
  id bigserial PRIMARY KEY,
  "sentAt" timestamp with time zone NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind = ANY (ARRAY['registration'::text, 'newsletter_signup'::text,
    'newsletter'::text, 'password'::text, 'account'::text, 'support'::text])),
  recipient text NOT NULL CHECK (char_length(recipient) BETWEEN 3 AND 320),
  subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
  provider text NOT NULL CHECK (provider = ANY (ARRAY['ses'::text, 'brevo'::text])),
  status text NOT NULL CHECK (status = ANY (ARRAY['accepted'::text, 'failed'::text, 'delivered'::text,
    'bounced'::text, 'complained'::text])),
  "providerMessageId" text CHECK ("providerMessageId" IS NULL OR char_length("providerMessageId") <= 300),
  error text CHECK (error IS NULL OR char_length(error) <= 1000),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."EmailLog" IS
  'Every email the app sent, for the admin Email services page. Service role only; pruned after 90 days.';

CREATE INDEX IF NOT EXISTS "EmailLog_sentAt_idx" ON public."EmailLog" USING btree ("sentAt" DESC);
CREATE INDEX IF NOT EXISTS "EmailLog_message_idx" ON public."EmailLog" USING btree (provider, "providerMessageId")
  WHERE "providerMessageId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "EmailLog_recipient_idx" ON public."EmailLog" USING btree (lower(recipient));

ALTER TABLE public."EmailLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EmailLog" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public."EmailLog_id_seq" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."EmailLog" TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public."EmailLog_id_seq" TO service_role;

-- Rows older than 90 days go when new ones are written (once per insert statement, by index)
CREATE OR REPLACE FUNCTION public.email_log_prune()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM "EmailLog" WHERE "sentAt" < now() - interval '90 days';
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.email_log_prune() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS "EmailLog_prune" ON public."EmailLog";
CREATE TRIGGER "EmailLog_prune" AFTER INSERT ON public."EmailLog"
  FOR EACH STATEMENT EXECUTE FUNCTION public.email_log_prune();

-- 2. Notices from the services ------------------------------------------------------------------
-- Sets the result of the email the service knows by p_message_id. A later notice never takes a
-- result back: delivered replaces accepted, and bounced or complained replace either. A failed email
-- never reached the service, so it has no notices. Returns how many rows changed (0 for an unknown
-- message or an older notice).
CREATE OR REPLACE FUNCTION public.record_email_event(p_provider text, p_message_id text, p_status text, p_error text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_status IS NULL OR NOT (p_status = ANY (ARRAY['delivered', 'bounced', 'complained'])) THEN
    RAISE EXCEPTION 'record_email_event: unknown status %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE "EmailLog"
     SET status = p_status,
         error = coalesce(left(p_error, 1000), error),
         "updatedAt" = now()
   WHERE provider = p_provider
     AND "providerMessageId" = p_message_id
     AND (CASE status WHEN 'accepted' THEN 1 WHEN 'delivered' THEN 2 ELSE 3 END)
       < (CASE p_status WHEN 'delivered' THEN 2 ELSE 3 END)
     AND status <> 'failed';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_email_event(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_event(text, text, text, text) TO service_role;

-- Counts by service and result for the last 24 hours and the last 30 days:
-- [{provider, period: '24h' | '30d', status, count}]
CREATE OR REPLACE FUNCTION public.email_log_totals()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'period', period, 'status', status, 'count', n)
                            ORDER BY period, provider, status), '[]'::jsonb)
    FROM (SELECT provider, '24h' AS period, status, count(*)::integer AS n
            FROM "EmailLog" WHERE "sentAt" > now() - interval '24 hours' GROUP BY provider, status
          UNION ALL
          SELECT provider, '30d', status, count(*)::integer
            FROM "EmailLog" WHERE "sentAt" > now() - interval '30 days' GROUP BY provider, status) t
$function$;
REVOKE ALL ON FUNCTION public.email_log_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_log_totals() TO service_role;

-- 3. Settings -----------------------------------------------------------------------------------
INSERT INTO public."AppSettings" (key, value, description) VALUES
  ('email_provider', 'brevo',
   'The email service the app sends through: brevo or ses. Changed by an admin on the Email services page; never automatically.'),
  ('email_daily_limit_ses', '199',
   'Most emails the app sends in any 24 hours while email_provider is ses. Raise it to about 90% of the SES sending quota once SES production access is granted.')
ON CONFLICT (key) DO NOTHING;

-- The limit of the selected service: email_daily_limit_ses (default 199) for ses, otherwise
-- email_daily_limit (default 299). The reserve is never more than the limit.
CREATE OR REPLACE FUNCTION public.email_quota_settings(OUT daily_limit integer, OUT essential_reserve integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT coalesce((SELECT btrim(value) FROM "AppSettings" WHERE key = 'email_provider'), 'brevo') = 'ses' AS ses
  ), s AS (
    SELECT CASE WHEN p.ses
             THEN coalesce((SELECT value::integer FROM "AppSettings"
                             WHERE key = 'email_daily_limit_ses' AND btrim(value) ~ '^[0-9]{1,7}$'), 199)
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
