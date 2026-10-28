-- =============================================================================
-- Prize claim tracking: a tracking ID on every claim, a timeline, risk flags and a handover code
--
-- Applied to production (eclivawqhdovsndlngfo) on 2026-10-28 as migration 20261028101658, owner-approved,
-- BEFORE the code that uses it (PR #79) was deployed. Checked after: all 10 claims got a unique tracking
-- ID with a valid check character, their history was rebuilt (10 submitted, 4 approved, 5 rejected),
-- only the service role can reach the new functions and the timeline, and the live code's
-- three-argument get_admin_claims call answered with tracking IDs and risk. Keep that order for any
-- other database: the profile, redemption history and admin Claims screen read the new columns and
-- call the new functions. The code live before it keeps working on the migrated database:
-- get_admin_claims still answers the three-argument call, update_claim_status is unchanged, and the
-- new columns fill themselves. 20261028130000_claim_tracking_search_path follows it.
--
-- Why: a winner had nothing to quote when they contacted us or we contacted them, so anyone could
-- claim to be them on WhatsApp, and nothing recorded what happened to a claim. Now:
--   1. Every claim gets a tracking ID such as 1T2W-7K3M-QX97: 7 random characters (Crockford base32,
--      without I, L, O or U) and a check character that catches a mistyped character. The winner
--      sees it on their profile and every message from us quotes it, so a winner can tell our
--      messages from a scammer's.
--   2. Every claim keeps a timeline ("PrizeClaimEvent"): submitted (with the IP it came from),
--      approved, rejected, delivered, sent again, and failed handover codes. Triggers write the
--      status changes, so every path that changes a claim is recorded.
--   3. claim_risk() flags a claim whose WhatsApp number or address belongs to other accounts, that
--      came from another claimant's IP, from an account under 7 days old, and so on. A high-risk
--      claim can only be approved with a written reason (decide_claim).
--   4. A handover code: 6 digits the winner gives the person who hands over the prize. The server
--      derives it from the claim and a secret (src/lib/claim-tracking.ts), so the database never
--      holds it; the database keeps its version and the failed tries. decide_claim marks a claim
--      delivered only with the code (checked by the server) or a written reason. Five wrong codes
--      lock it until an admin resets it, and sending a claim again for re-delivery changes it.
--
-- Not safe to re-run: the guard below stops a second run.
-- =============================================================================

-- ── 0. Refuse to run if a function this builds on changed since this migration was written ───────
-- get_admin_claims is re-created from 20261024190000_quiz_prize_claims, and decide_claim relies on
-- update_claim_status from 20261021180000_update_claim_status_single (its codes and its single
-- overload). Fingerprints: whitespace-insensitive md5 of each body, as in db-tests/schema.
DO $guard$
DECLARE
  v_expected constant jsonb := jsonb_build_object(
    'public.get_admin_claims(text,integer,integer)', '2ba9e5a47e792b101c567b80f7489e7b',
    'public.update_claim_status(text,text,text,text)', 'f2a965fbcdaffd662f39b715ccf331da');
  v_fn text;
  v_md5 text;
BEGIN
  FOR v_fn IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure(v_fn);
    IF v_md5 IS DISTINCT FROM v_expected->>v_fn THEN
      RAISE EXCEPTION '% is not the version this migration was written against (body md5 %): merge the change into the migration first',
        v_fn, coalesce(v_md5, 'missing');
    END IF;
  END LOOP;
  IF to_regprocedure('public.update_claim_status(text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'public.update_claim_status still has its three-argument overload: apply 20261021180000_update_claim_status_single first';
  END IF;
END $guard$;

-- ── 1. Tracking IDs ──────────────────────────────────────────────────────────────────────────────
-- The check character: Luhn mod 32 over the body, in the same alphabet. Catches any one wrong
-- character and most swaps of two neighbours. Mirrored in src/lib/claim-tracking-shared.ts.
CREATE OR REPLACE FUNCTION private_hardened.claim_tracking_check_char(p_body text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
AS $function$
DECLARE
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_sum int := 0;
  v_factor int := 2;
  v_code int;
  v_addend int;
BEGIN
  FOR i IN REVERSE length(p_body)..1 LOOP
    v_code := strpos(v_alphabet, substr(p_body, i, 1)) - 1;
    IF v_code < 0 THEN
      RETURN NULL;
    END IF;
    v_addend := v_factor * v_code;
    v_sum := v_sum + v_addend / 32 + v_addend % 32;
    v_factor := 3 - v_factor;
  END LOOP;
  RETURN substr(v_alphabet, (32 - v_sum % 32) % 32 + 1, 1);
END $function$;

-- 35 random bits from a v4 UUID's first 5 bytes (all random; the version bits come later), so about
-- 34 billion IDs: guessing one is hopeless, and a clash is retried.
CREATE OR REPLACE FUNCTION private_hardened.new_claim_tracking_id()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_bits bigint;
  v_body text;
  v_id text;
BEGIN
  LOOP
    v_bytes := decode(left(replace(gen_random_uuid()::text, '-', ''), 10), 'hex');
    v_bits := 0;
    FOR i IN 0..4 LOOP
      v_bits := v_bits * 256 + get_byte(v_bytes, i);
    END LOOP;
    v_bits := v_bits >> 5;
    v_body := '';
    FOR i IN 1..7 LOOP
      v_body := substr(v_alphabet, (v_bits % 32)::int + 1, 1) || v_body;
      v_bits := v_bits / 32;
    END LOOP;
    v_id := '1T2W-' || left(v_body, 4) || '-' || right(v_body, 3) || private_hardened.claim_tracking_check_char(v_body);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "PrizeRedemption" WHERE "trackingId" = v_id);
  END LOOP;
  RETURN v_id;
END $function$;

ALTER TABLE public."PrizeRedemption"
  ADD COLUMN IF NOT EXISTS "trackingId" text,
  -- Which handover code is current: a reset or a re-delivery moves it on, so an old code stops working
  ADD COLUMN IF NOT EXISTS "handoverVersion" integer NOT NULL DEFAULT 1 CHECK ("handoverVersion" >= 1),
  -- Wrong codes entered for the current version; five lock it until an admin resets it
  ADD COLUMN IF NOT EXISTS "handoverFailures" integer NOT NULL DEFAULT 0 CHECK ("handoverFailures" >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS "PrizeRedemption_trackingId_key" ON public."PrizeRedemption" ("trackingId");

-- One row at a time, so each new ID is checked against the ones given before it
DO $backfill$
DECLARE
  v_id text;
BEGIN
  FOR v_id IN SELECT id FROM public."PrizeRedemption" WHERE "trackingId" IS NULL ORDER BY "requestedAt", id LOOP
    UPDATE public."PrizeRedemption" SET "trackingId" = private_hardened.new_claim_tracking_id() WHERE id = v_id;
  END LOOP;
END $backfill$;

ALTER TABLE public."PrizeRedemption" ALTER COLUMN "trackingId" SET NOT NULL;
ALTER TABLE public."PrizeRedemption" ADD CONSTRAINT "PrizeRedemption_trackingId_format"
  CHECK ("trackingId" ~ '^1T2W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$');

-- ── 2. The claim timeline ─────────────────────────────────────────────────────────────────────────
-- Written only by the triggers and functions below; the app reads it with the service role. Players
-- see their own claim's timeline through the server, without the IP, the admins or the risk details.
CREATE TABLE IF NOT EXISTS public."PrizeClaimEvent" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "claimId" text NOT NULL REFERENCES public."PrizeRedemption"(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('submitted', 'approved', 'rejected', 'delivered', 'reopened', 'handover_failed', 'code_reset')),
  -- 'player', or the admin's email
  actor text NOT NULL,
  note text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "PrizeClaimEvent_claimId_createdAt_idx" ON public."PrizeClaimEvent" ("claimId", "createdAt");
CREATE INDEX IF NOT EXISTS "PrizeClaimEvent_submitted_ip_idx" ON public."PrizeClaimEvent" ((details->'origin'->>'ip')) WHERE event = 'submitted';

ALTER TABLE public."PrizeClaimEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."PrizeClaimEvent" FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public."PrizeClaimEvent" TO service_role;

-- What existing claims went through, as far as the claim rows tell: when each was sent and its decision
INSERT INTO public."PrizeClaimEvent" ("claimId", event, actor, details, "createdAt")
SELECT id, 'submitted', 'player', '{"backfilled": true}'::jsonb, "requestedAt" AT TIME ZONE 'UTC'
  FROM public."PrizeRedemption";
INSERT INTO public."PrizeClaimEvent" ("claimId", event, actor, note, details, "createdAt")
SELECT id,
       CASE status WHEN 'fulfilled' THEN 'delivered' ELSE status END,
       coalesce("processedBy", 'admin'),
       CASE WHEN status = 'rejected' THEN notes END,
       '{"backfilled": true}'::jsonb,
       coalesce("processedAt", "updatedAt") AT TIME ZONE 'UTC'
  FROM public."PrizeRedemption"
 WHERE status IN ('approved', 'rejected', 'fulfilled');

-- ── 3. Triggers: every claim gets an ID, and every status change goes on the timeline ────────────
CREATE OR REPLACE FUNCTION private_hardened.prize_claim_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Always made here, never taken from the insert
  NEW."trackingId" := private_hardened.new_claim_tracking_id();
  NEW."handoverVersion" := 1;
  NEW."handoverFailures" := 0;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private_hardened.prize_claim_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW."trackingId" IS DISTINCT FROM OLD."trackingId" THEN
    RAISE EXCEPTION 'A claim''s tracking ID never changes';
  END IF;
  -- Sent again for delivery: a code the old courier saw must not work for the new delivery
  IF NEW.status = 'pending' AND OLD.status IN ('approved', 'fulfilled') THEN
    NEW."handoverVersion" := OLD."handoverVersion" + 1;
    NEW."handoverFailures" := 0;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private_hardened.prize_claim_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO "PrizeClaimEvent" ("claimId", event, actor) VALUES (NEW.id, 'submitted', 'player');
  RETURN NULL;
END $function$;

-- decide_claim passes what the admin's decision rested on (the handover code, an override reason)
-- in the transaction-local setting app.claim_event_details; any other path leaves it empty.
CREATE OR REPLACE FUNCTION private_hardened.prize_claim_after_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  v_event := CASE NEW.status
    WHEN 'approved' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'fulfilled' THEN 'delivered'
    WHEN 'pending' THEN 'reopened'
  END;
  IF v_event IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO "PrizeClaimEvent" ("claimId", event, actor, note, details)
  VALUES (NEW.id, v_event, coalesce(NEW."processedBy", 'admin'),
          CASE WHEN NEW.notes IS DISTINCT FROM OLD.notes THEN NEW.notes END,
          coalesce(nullif(current_setting('app.claim_event_details', true), ''), '{}')::jsonb);
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION private_hardened.claim_tracking_check_char(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_hardened.new_claim_tracking_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_hardened.prize_claim_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_hardened.prize_claim_before_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_hardened.prize_claim_after_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_hardened.prize_claim_after_status() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER prize_claim_before_insert BEFORE INSERT ON public."PrizeRedemption"
  FOR EACH ROW EXECUTE FUNCTION private_hardened.prize_claim_before_insert();
CREATE TRIGGER prize_claim_before_update BEFORE UPDATE ON public."PrizeRedemption"
  FOR EACH ROW EXECUTE FUNCTION private_hardened.prize_claim_before_update();
CREATE TRIGGER prize_claim_after_insert AFTER INSERT ON public."PrizeRedemption"
  FOR EACH ROW EXECUTE FUNCTION private_hardened.prize_claim_after_insert();
CREATE TRIGGER prize_claim_after_status AFTER UPDATE OF status ON public."PrizeRedemption"
  FOR EACH ROW EXECUTE FUNCTION private_hardened.prize_claim_after_status();

-- ── 4. Risk flags ─────────────────────────────────────────────────────────────────────────────────
-- Pakistani mobile numbers compared as 92XXXXXXXXXX, whichever way they were typed
CREATE OR REPLACE FUNCTION private_hardened.normalize_pk_phone(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
           WHEN d = '' THEN NULL
           WHEN d ~ '^03[0-9]{9}$' THEN '92' || substr(d, 2)
           WHEN d ~ '^3[0-9]{9}$' THEN '92' || d
           WHEN d ~ '^0092[0-9]{10}$' THEN substr(d, 3)
           ELSE d
         END
    FROM (SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') AS d) s
$function$;

-- Addresses compared without case, spaces or punctuation ("House 12, St. 4" = "house 12 st 4")
CREATE OR REPLACE FUNCTION private_hardened.claim_address_key(p_address text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT nullif(regexp_replace(lower(coalesce(p_address, '')), '[^[:alnum:]]+', '', 'g'), '')
$function$;

-- Executable by everyone: the indexes below call them on every write to "User" and "PrizeRedemption",
-- as whichever role writes (a player editing their profile, the server). They read no data.
GRANT EXECUTE ON FUNCTION private_hardened.normalize_pk_phone(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION private_hardened.claim_address_key(text) TO PUBLIC;

CREATE INDEX IF NOT EXISTS "PrizeRedemption_phone_key_idx" ON public."PrizeRedemption" (private_hardened.normalize_pk_phone("whatsappNumber"));
CREATE INDEX IF NOT EXISTS "PrizeRedemption_address_key_idx" ON public."PrizeRedemption" (private_hardened.claim_address_key(address));
CREATE INDEX IF NOT EXISTS "User_phone_key_idx" ON public."User" (private_hardened.normalize_pk_phone(phone));

-- { score, level: low | medium | high, flags: [{ code, weight, count?, accounts? }] }, or null for an
-- unknown claim. Worked out when asked, so a later claim with the same number flags the earlier one
-- too. Weights add up; 50 or more is high (decide_claim then wants a reason to approve), 20 or more
-- medium. Shared IPs weigh little: Pakistani mobile networks put many people behind one address.
-- Mirrored for display in src/lib/claim-tracking-shared.ts (RISK_FLAG_LABELS).
CREATE OR REPLACE FUNCTION private_hardened.claim_risk(p_claim_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim record;
  v_phone text;
  v_address text;
  v_ip text;
  v_count int;
  v_accounts text[];
  v_flags jsonb := '[]'::jsonb;
  v_score int := 0;
BEGIN
  SELECT r.id, r."userId", r."whatsappNumber", r.address, r."requestedAt", u."createdAt" AS "accountCreatedAt", u.phone AS "profilePhone"
    INTO v_claim
    FROM "PrizeRedemption" r JOIN "User" u ON u.id = r."userId"
   WHERE r.id = p_claim_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_phone := private_hardened.normalize_pk_phone(v_claim."whatsappNumber");
  v_address := private_hardened.claim_address_key(v_claim.address);
  SELECT details->'origin'->>'ip' INTO v_ip FROM "PrizeClaimEvent"
   WHERE "claimId" = p_claim_id AND event = 'submitted' ORDER BY "createdAt" LIMIT 1;

  -- The WhatsApp number is on another account's claim or profile
  IF v_phone IS NOT NULL THEN
    SELECT count(*), (array_agg(u.email ORDER BY u.email))[1:5] INTO v_count, v_accounts
      FROM "User" u
     WHERE u.id <> v_claim."userId"
       AND (u.id IN (SELECT r."userId" FROM "PrizeRedemption" r WHERE private_hardened.normalize_pk_phone(r."whatsappNumber") = v_phone)
            OR private_hardened.normalize_pk_phone(u.phone) = v_phone);
    IF v_count > 0 THEN
      v_flags := v_flags || jsonb_build_object('code', 'shared_phone', 'weight', 40, 'count', v_count, 'accounts', to_jsonb(v_accounts));
      v_score := v_score + 40;
    END IF;
  END IF;

  -- The delivery address is on another account's claim
  IF v_address IS NOT NULL THEN
    SELECT count(DISTINCT u.id), (array_agg(DISTINCT u.email ORDER BY u.email))[1:5] INTO v_count, v_accounts
      FROM "PrizeRedemption" r JOIN "User" u ON u.id = r."userId"
     WHERE r."userId" <> v_claim."userId" AND private_hardened.claim_address_key(r.address) = v_address;
    IF v_count > 0 THEN
      v_flags := v_flags || jsonb_build_object('code', 'shared_address', 'weight', 30, 'count', v_count, 'accounts', to_jsonb(v_accounts));
      v_score := v_score + 30;
    END IF;
  END IF;

  -- Sent from the same IP as another account's claim
  IF v_ip IS NOT NULL THEN
    SELECT count(DISTINCT u.id), (array_agg(DISTINCT u.email ORDER BY u.email))[1:5] INTO v_count, v_accounts
      FROM "PrizeClaimEvent" e
      JOIN "PrizeRedemption" r ON r.id = e."claimId"
      JOIN "User" u ON u.id = r."userId"
     WHERE e.event = 'submitted' AND e.details->'origin'->>'ip' = v_ip AND r."userId" <> v_claim."userId";
    IF v_count > 0 THEN
      v_flags := v_flags || jsonb_build_object('code', 'shared_ip', 'weight', 15, 'count', v_count, 'accounts', to_jsonb(v_accounts));
      v_score := v_score + 15;
    END IF;
  END IF;

  -- The account was made less than 7 days before the claim
  IF v_claim."accountCreatedAt" > v_claim."requestedAt" - interval '7 days' THEN
    v_flags := v_flags || jsonb_build_object('code', 'new_account', 'weight', 15);
    v_score := v_score + 15;
  END IF;

  -- Three or more other claims from this account in the 30 days before
  SELECT count(*) INTO v_count FROM "PrizeRedemption"
   WHERE "userId" = v_claim."userId" AND id <> v_claim.id
     AND "requestedAt" BETWEEN v_claim."requestedAt" - interval '30 days' AND v_claim."requestedAt";
  IF v_count >= 3 THEN
    v_flags := v_flags || jsonb_build_object('code', 'many_claims', 'weight', 10, 'count', v_count);
    v_score := v_score + 10;
  END IF;

  -- The WhatsApp number isn't the one on the player's profile
  IF v_phone IS NOT NULL AND private_hardened.normalize_pk_phone(v_claim."profilePhone") IS DISTINCT FROM v_phone
     AND private_hardened.normalize_pk_phone(v_claim."profilePhone") IS NOT NULL THEN
    v_flags := v_flags || jsonb_build_object('code', 'phone_not_on_profile', 'weight', 5);
    v_score := v_score + 5;
  END IF;

  RETURN jsonb_build_object(
    'score', v_score,
    'level', CASE WHEN v_score >= 50 THEN 'high' WHEN v_score >= 20 THEN 'medium' ELSE 'low' END,
    'flags', v_flags);
END $function$;
REVOKE ALL ON FUNCTION private_hardened.claim_risk(text) FROM PUBLIC, anon, authenticated;

-- ── 5. What the server calls ──────────────────────────────────────────────────────────────────────
-- The admin's decision, through update_claim_status, plus two rules:
--   approved:  a high-risk claim needs p_details.overrideReason (10+ characters). The risk at that
--              moment is kept on the timeline.
--   fulfilled: p_details.handover is 'code' (the server checked the winner's code for
--              p_details.handoverVersion, which must still be current and not locked) or 'override'
--              with p_details.reason (10+ characters).
-- p_details goes on the timeline entry the status change makes.
CREATE OR REPLACE FUNCTION public.decide_claim(p_claim_id text, p_status text, p_notes text DEFAULT NULL::text,
  p_admin_email text DEFAULT NULL::text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_claim record;
  v_risk jsonb;
  v_result jsonb;
BEGIN
  IF jsonb_typeof(v_details) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid decision details');
  END IF;

  IF p_status = 'approved' THEN
    v_risk := private_hardened.claim_risk(p_claim_id);
    IF v_risk->>'level' = 'high' AND length(btrim(coalesce(v_details->>'overrideReason', ''))) < 10 THEN
      RETURN jsonb_build_object('success', false, 'code', 'risk_override_required', 'risk', v_risk,
        'error', 'This claim is high risk. Check its flags, then write why you approve it (10 characters or more).');
    END IF;
    IF v_risk IS NOT NULL THEN
      v_details := v_details || jsonb_build_object('risk', v_risk);
    END IF;
  ELSIF p_status = 'fulfilled' THEN
    SELECT "handoverVersion", "handoverFailures" INTO v_claim FROM "PrizeRedemption" WHERE id = p_claim_id;
    IF v_details->>'handover' = 'code' THEN
      IF FOUND AND (v_details->>'handoverVersion') IS DISTINCT FROM v_claim."handoverVersion"::text THEN
        RETURN jsonb_build_object('success', false, 'code', 'code_changed', 'error', 'The handover code changed. Ask the winner for the new one.');
      END IF;
      IF FOUND AND v_claim."handoverFailures" >= 5 THEN
        RETURN jsonb_build_object('success', false, 'code', 'code_locked', 'error', 'Too many wrong codes. Reset the code first.');
      END IF;
    ELSIF NOT (v_details->>'handover' = 'override' AND length(btrim(coalesce(v_details->>'reason', ''))) >= 10) THEN
      RETURN jsonb_build_object('success', false, 'code', 'handover_required',
        'error', 'Enter the winner''s handover code, or write why it was delivered without one (10 characters or more).');
    END IF;
  END IF;

  PERFORM set_config('app.claim_event_details', v_details::text, true);
  v_result := public.update_claim_status(p_claim_id, p_status, p_notes, p_admin_email)::jsonb;
  PERFORM set_config('app.claim_event_details', '', true);
  RETURN v_result;
END $function$;

-- Where a claim was sent from ({ origin: { ip, userAgent } } on its "submitted" entry), recorded by the
-- server right after the claim is made. Only once, and only for the claim's own player.
CREATE OR REPLACE FUNCTION public.record_claim_origin(p_claim_id text, p_user_id text, p_ip text, p_user_agent text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE "PrizeClaimEvent" e
     SET details = e.details || jsonb_build_object('origin', jsonb_strip_nulls(jsonb_build_object(
           'ip', left(nullif(nullif(btrim(p_ip), ''), 'unknown'), 64),
           'userAgent', left(nullif(btrim(p_user_agent), ''), 300))))
   WHERE e."claimId" = p_claim_id AND e.event = 'submitted' AND NOT (e.details ? 'origin')
     AND EXISTS (SELECT 1 FROM "PrizeRedemption" r WHERE r.id = p_claim_id AND r."userId" = p_user_id);
  RETURN FOUND;
END $function$;

-- A wrong handover code for an approved claim: counted, and on the timeline
CREATE OR REPLACE FUNCTION public.record_handover_failure(p_claim_id text, p_admin_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_failures int;
BEGIN
  UPDATE "PrizeRedemption" SET "handoverFailures" = "handoverFailures" + 1, "updatedAt" = now()
   WHERE id = p_claim_id AND status = 'approved'
  RETURNING "handoverFailures" INTO v_failures;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_status', 'error', 'Only an approved claim takes a handover code');
  END IF;
  INSERT INTO "PrizeClaimEvent" ("claimId", event, actor, details)
  VALUES (p_claim_id, 'handover_failed', coalesce(p_admin_email, 'admin'), jsonb_build_object('failures', v_failures));
  RETURN jsonb_build_object('success', true, 'failures', v_failures, 'locked', v_failures >= 5);
END $function$;

-- A new handover code for a claim not delivered yet: the old one stops working, and wrong tries reset
CREATE OR REPLACE FUNCTION public.reset_handover_code(p_claim_id text, p_admin_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_version int;
BEGIN
  UPDATE "PrizeRedemption" SET "handoverVersion" = "handoverVersion" + 1, "handoverFailures" = 0, "updatedAt" = now()
   WHERE id = p_claim_id AND status IN ('pending', 'approved')
  RETURNING "handoverVersion" INTO v_version;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_status', 'error', 'Only a claim not delivered yet gets a new handover code');
  END IF;
  INSERT INTO "PrizeClaimEvent" ("claimId", event, actor, details)
  VALUES (p_claim_id, 'code_reset', coalesce(p_admin_email, 'admin'), jsonb_build_object('handoverVersion', v_version));
  RETURN jsonb_build_object('success', true, 'handoverVersion', v_version);
END $function$;

REVOKE ALL ON FUNCTION public.decide_claim(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_claim_origin(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_handover_failure(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_handover_code(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_claim(text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_claim_origin(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_handover_failure(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_handover_code(text, text) TO service_role;

-- ── 6. The Claims screen: tracking ID, risk and handover state, and lookup by tracking ID ─────────
-- A fourth argument means a new signature: the three-argument one is dropped so there is a single
-- overload, and the older three-argument call still reaches this one through the default.
DROP FUNCTION IF EXISTS public.get_admin_claims(text, integer, integer);

-- Same as the 20261024190000 version, plus "trackingId", "risk" (claim_risk) and "handover"
-- ({ version, failures }). p_tracking_id finds that one claim, whatever its status.
CREATE OR REPLACE FUNCTION public.get_admin_claims(p_status text DEFAULT NULL::text, p_page integer DEFAULT 1, p_limit integer DEFAULT 20,
  p_tracking_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offset integer;
  v_total integer;
  v_total_pages integer;
  v_claims json;
BEGIN
  v_offset := (p_page - 1) * p_limit;

  SELECT COUNT(*) INTO v_total
  FROM "public"."PrizeRedemption" r
  WHERE CASE WHEN p_tracking_id IS NOT NULL THEN r."trackingId" = p_tracking_id
             ELSE (p_status IS NULL OR p_status = 'all' OR r."status" = p_status) END;

  v_total_pages := CEIL(v_total::float / p_limit);

  SELECT json_agg(claim_data ORDER BY claim_data."requestedAt" DESC) INTO v_claims
  FROM (
    SELECT
      r.id,
      r."trackingId",
      r."pointsUsed",
      r.status,
      r."fullName",
      r."whatsappNumber",
      r.address,
      r."requestedAt",
      r."processedAt",
      r.notes,
      json_build_object(
        'id', u.id,
        'name', u.name,
        'email', u.email,
        'phone', u.phone,
        'points', u.points
      ) AS "user",
      json_build_object(
        'id', p.id,
        'name', p.name,
        'description', p.description,
        'imageUrl', p."imageUrl",
        'type', p.type,
        'pointsRequired', p."pointsRequired"
      ) AS prize,
      (SELECT json_build_object('id', z.id, 'title', z.title)
         FROM "public"."QuizWinner" w JOIN "public"."Quiz" z ON z.id = w."quizId"
        WHERE w."prizeRedemptionId" = r.id
        LIMIT 1) AS quiz,
      private_hardened.claim_risk(r.id) AS risk,
      json_build_object('version', r."handoverVersion", 'failures', r."handoverFailures") AS handover
    FROM "public"."PrizeRedemption" r
    JOIN "public"."User" u ON r."userId" = u.id
    JOIN "public"."Prize" p ON r."prizeId" = p.id
    WHERE CASE WHEN p_tracking_id IS NOT NULL THEN r."trackingId" = p_tracking_id
               ELSE (p_status IS NULL OR p_status = 'all' OR r."status" = p_status) END
    ORDER BY r."requestedAt" DESC
    LIMIT p_limit OFFSET v_offset
  ) AS claim_data;

  RETURN json_build_object(
    'success', true,
    'claims', COALESCE(v_claims, '[]'::json),
    'pagination', json_build_object(
      'page', p_page,
      'limit', p_limit,
      'total', v_total,
      'totalPages', v_total_pages
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_admin_claims(text, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_claims(text, integer, integer, text) TO service_role;
