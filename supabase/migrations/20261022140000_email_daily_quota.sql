-- =============================================================================
-- Daily email limit (Brevo free plan: 300 emails a day)
--
-- Applied to production (eclivawqhdovsndlngfo) on 2026-10-22 as migration 20261022113445, owner-approved,
-- before the code that counts emails was deployed. The live build doesn't call these functions, so it
-- keeps sending as before until the new code is deployed.
--
-- Every email the app sends goes through Brevo: the Supabase Auth emails (registration confirmation,
-- "set / reset your password") through Brevo SMTP, and the app's own emails through the Brevo API.
-- Once the day's 300 are used, Brevo silently drops the rest, so a new player never gets the link.
-- The app now counts every email here first and stops at the limit, telling the person when to try
-- again instead of pretending the email went out.
--
-- The count is over a rolling 24 hours (Brevo doesn't say when its day resets). The numbers are
-- AppSettings rows, so a bigger plan (or another email service) only needs new values:
--   email_daily_limit        299   all emails together
--   email_essential_reserve   20   kept for password, account and support emails, so registrations
--                                  and newsletters stop at 299 - 20 = 279
--
-- Only the service role can reach any of this (the server calls it after its own checks). A
-- database without this migration still sends email: the app lets an email go when it can't count.
--
-- Safe to re-run.
-- =============================================================================

-- 1. Table ---------------------------------------------------------------------------------------
-- One row per reservation: an email (or a whole newsletter) the app is about to send. Rows older than
-- 3 days are pruned by reserve_email_quota(); only the last 24 hours count.
CREATE TABLE IF NOT EXISTS public."EmailSend" (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind = ANY (ARRAY['registration'::text, 'newsletter_signup'::text,
    'newsletter'::text, 'password'::text, 'account'::text, 'support'::text])),
  emails integer NOT NULL CHECK (emails > 0),
  "sentAt" timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."EmailSend" IS
  'Emails the app sent (or is sending), counted against the daily limit. Service role only; see reserve_email_quota().';

CREATE INDEX IF NOT EXISTS "EmailSend_sentAt_idx" ON public."EmailSend" USING btree ("sentAt");

ALTER TABLE public."EmailSend" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EmailSend" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public."EmailSend_id_seq" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."EmailSend" TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public."EmailSend_id_seq" TO service_role;

-- 2. Settings ------------------------------------------------------------------------------------
INSERT INTO public."AppSettings" (key, value, description) VALUES
  ('email_daily_limit', '299',
   'Most emails the app sends in any 24 hours (Brevo free plan: 300 a day). Raise it after upgrading the email plan.'),
  ('email_essential_reserve', '20',
   'Emails kept for password, account and support emails: registrations and newsletters stop this many below email_daily_limit.')
ON CONFLICT (key) DO NOTHING;

-- The two settings, falling back to 299 / 20 when a row is missing or not a whole number. The reserve
-- is never more than the limit.
CREATE OR REPLACE FUNCTION public.email_quota_settings(OUT daily_limit integer, OUT essential_reserve integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT coalesce((SELECT value::integer FROM "AppSettings"
                      WHERE key = 'email_daily_limit' AND btrim(value) ~ '^[0-9]{1,7}$'), 299) AS lim,
           coalesce((SELECT value::integer FROM "AppSettings"
                      WHERE key = 'email_essential_reserve' AND btrim(value) ~ '^[0-9]{1,7}$'), 20) AS res
  )
  SELECT lim, LEAST(res, lim) FROM s
$function$;
REVOKE ALL ON FUNCTION public.email_quota_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_quota_settings() TO service_role;

-- 3. Reserving emails ----------------------------------------------------------------------------
-- Call before sending. p_emails is how many emails the send needs (a newsletter needs one per
-- subscriber). Password, account and support emails may use the whole limit; the others stop at the
-- limit minus the reserve.
--
-- Returns {ok: true, id, used, cap, remaining} when the emails fit (the row is written, so they
-- count), or {ok: false, used, cap, remaining, retryAt} when they don't. retryAt is the moment
-- enough of the oldest emails leave the 24-hour window for this request to fit; it is null when the
-- request is bigger than the cap and will never fit.
--
-- One lock for all callers: two registrations at the same moment are counted one after the other,
-- so the limit can't be overshot.
CREATE OR REPLACE FUNCTION public.reserve_email_quota(p_kind text, p_emails integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings record;
  v_cap integer;
  v_used integer;
  v_id bigint;
  v_retry timestamp with time zone;
BEGIN
  IF p_kind IS NULL OR NOT (p_kind = ANY (ARRAY['registration', 'newsletter_signup', 'newsletter', 'password', 'account', 'support'])) THEN
    RAISE EXCEPTION 'reserve_email_quota: unknown kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_emails IS NULL OR p_emails < 1 THEN
    RAISE EXCEPTION 'reserve_email_quota: p_emails must be at least 1' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('email-quota'));

  SELECT * INTO v_settings FROM email_quota_settings();
  v_cap := CASE WHEN p_kind = ANY (ARRAY['password', 'account', 'support'])
                THEN v_settings.daily_limit
                ELSE v_settings.daily_limit - v_settings.essential_reserve END;

  DELETE FROM "EmailSend" WHERE "sentAt" < now() - interval '3 days';

  SELECT coalesce(sum(emails), 0)::integer INTO v_used
    FROM "EmailSend" WHERE "sentAt" > now() - interval '24 hours';

  IF v_used + p_emails <= v_cap THEN
    INSERT INTO "EmailSend" (kind, emails) VALUES (p_kind, p_emails) RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'used', v_used + p_emails, 'cap', v_cap,
      'remaining', v_cap - v_used - p_emails);
  END IF;

  -- An email sent at T stops counting at T + 24 hours. Walk the window oldest first until the
  -- emails that have left it make room for this request.
  IF p_emails <= v_cap THEN
    SELECT w."sentAt" + interval '24 hours' INTO v_retry
      FROM (SELECT "sentAt", id, sum(emails) OVER (ORDER BY "sentAt", id) AS freed
              FROM "EmailSend" WHERE "sentAt" > now() - interval '24 hours') w
     WHERE w.freed >= v_used + p_emails - v_cap
     ORDER BY w."sentAt", w.id
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object('ok', false, 'used', v_used, 'cap', v_cap,
    'remaining', GREATEST(v_cap - v_used, 0), 'retryAt', v_retry);
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_email_quota(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_email_quota(text, integer) TO service_role;

-- 4. Giving emails back --------------------------------------------------------------------------
-- When a reserved send didn't happen (Supabase or Brevo refused it), or only part of a newsletter was
-- accepted: p_keep = 0 removes the reservation, otherwise it keeps p_keep emails of it. It never
-- raises a reservation.
CREATE OR REPLACE FUNCTION public.release_email_quota(p_id bigint, p_keep integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(p_keep, 0) <= 0 THEN
    DELETE FROM "EmailSend" WHERE id = p_id;
  ELSE
    UPDATE "EmailSend" SET emails = LEAST(emails, p_keep) WHERE id = p_id;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.release_email_quota(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_email_quota(bigint, integer) TO service_role;

-- 5. Status for the admin screen -----------------------------------------------------------------
-- {used, limit, reserve, cap, remaining, capRemaining, nextFreeAt}: emails in the last 24 hours, the
-- limit, the reserve, the cap for registrations and newsletters, what is left of each, and when the
-- oldest counted email leaves the window (null when none is counted).
CREATE OR REPLACE FUNCTION public.email_quota_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH s AS (SELECT * FROM email_quota_settings()),
       w AS (SELECT coalesce(sum(emails), 0)::integer AS used, min("sentAt") AS oldest
               FROM "EmailSend" WHERE "sentAt" > now() - interval '24 hours')
  SELECT jsonb_build_object(
    'used', w.used,
    'limit', s.daily_limit,
    'reserve', s.essential_reserve,
    'cap', s.daily_limit - s.essential_reserve,
    'remaining', GREATEST(s.daily_limit - w.used, 0),
    'capRemaining', GREATEST(s.daily_limit - s.essential_reserve - w.used, 0),
    'nextFreeAt', w.oldest + interval '24 hours')
  FROM s, w
$function$;
REVOKE ALL ON FUNCTION public.email_quota_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_quota_status() TO service_role;
