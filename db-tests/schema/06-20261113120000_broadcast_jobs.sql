-- =============================================================================
-- "Send to all" as a resumable job (audit findings B-01 and D-06)
--
-- NOT applied to production yet (written 2026-11-13). Needs the owner's OK. The app keeps working
-- before it is applied: createBroadcast falls back to the old path while broadcast_create is missing.
--
-- Before: createBroadcast read every user id into the web process, inserted 500 notices per request,
-- then pushed to every device in a detached loop. A restart part-way left some players told and the
-- rest not, with nothing to resume; a double click sent everything twice; and all pushes left in one
-- go, so the taps on them arrived as one herd.
--
-- Now: one "Broadcast" row is the job and its progress.
--   broadcast_create      writes it, or returns the one already made in the last 15 minutes with the
--                         same type, link, title and message (a double click, a scheduler re-run)
--   broadcast_claim       hands the next due broadcast to one caller for 5 minutes (a lease)
--   broadcast_insert_users  adds the next players' notices in one statement and moves the cursor in
--                         the same transaction, so a re-run can never insert anyone twice
--   broadcast_wave_done   records a wave of pushes and when the next one is due
--   broadcast_release     gives the lease back early
-- The app runs it from the minute cron (src/lib/scheduled-jobs.ts). Pushes go in waves (2,000 a
-- minute by default), so the taps spread out. A wave cut off by a restart is sent again after the
-- lease runs out: a device can get that push twice, and the same tag makes the second replace the
-- first. Notices in the bell are never doubled.
--
-- One notice row per player is kept on purpose: the bell, unread counts and "mark all read" read
-- them, and they stay unchanged.
--
-- Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public."Broadcast" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "dedupeKey" text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  type text NOT NULL CHECK (length(type) BETWEEN 1 AND 60),
  link text CHECK (link IS NULL OR length(link) <= 500),
  status text NOT NULL DEFAULT 'inserting' CHECK (status IN ('inserting', 'pushing', 'done')),
  "userCursor" text,
  inserted integer NOT NULL DEFAULT 0,
  "pushCursor" text,
  pushed integer NOT NULL DEFAULT 0,
  waves integer NOT NULL DEFAULT 0,
  "leaseToken" text,
  "leaseUntil" timestamptz,
  "nextWaveAt" timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "doneAt" timestamptz
);
CREATE INDEX IF NOT EXISTS "Broadcast_dedupeKey_createdAt_idx" ON public."Broadcast" ("dedupeKey", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Broadcast_open_idx" ON public."Broadcast" ("nextWaveAt") WHERE status <> 'done';

ALTER TABLE public."Broadcast" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Broadcast" FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public."Broadcast" TO service_role;

-- ── broadcast_create ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.broadcast_create(p_title text, p_message text, p_type text, p_link text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := md5(concat_ws(chr(31), p_type, coalesce(p_link, ''), p_title, p_message));
  v_id text;
BEGIN
  IF coalesce(btrim(p_title), '') = '' OR coalesce(btrim(p_message), '') = '' OR coalesce(btrim(p_type), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'A broadcast needs a title, a message and a type');
  END IF;
  -- Two requests for the same broadcast at once: the second waits here, then finds the first
  PERFORM pg_advisory_xact_lock(hashtextextended('broadcast:' || v_key, 0));
  SELECT id INTO v_id FROM "Broadcast"
   WHERE "dedupeKey" = v_key AND "createdAt" > now() - interval '15 minutes'
   ORDER BY "createdAt" DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'id', v_id, 'duplicate', true);
  END IF;
  INSERT INTO "Broadcast" ("dedupeKey", title, message, type, link)
  VALUES (v_key, p_title, p_message, p_type, nullif(p_link, ''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'duplicate', false);
END;
$function$;

-- ── broadcast_claim ─────────────────────────────────────────────────────────────────────────────
-- The oldest due broadcast nobody holds, leased to the caller. Broadcasts older than 6 hours are no
-- longer worth finishing (a quiz they announced is over) and are left as they are.
CREATE OR REPLACE FUNCTION public.broadcast_claim(p_lease_seconds integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row "Broadcast";
BEGIN
  UPDATE "Broadcast" b
     SET "leaseToken" = gen_random_uuid()::text,
         "leaseUntil" = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
         attempts = attempts + 1,
         "updatedAt" = now()
   WHERE b.id = (
     SELECT id FROM "Broadcast"
      WHERE status <> 'done' AND "nextWaveAt" <= now()
        AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
        AND "createdAt" > now() - interval '6 hours'
      ORDER BY "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED)
  RETURNING b.* INTO v_row;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', v_row.id, 'token', v_row."leaseToken", 'status', v_row.status,
    'title', v_row.title, 'message', v_row.message, 'type', v_row.type, 'link', v_row.link,
    'pushCursor', v_row."pushCursor", 'inserted', v_row.inserted, 'pushed', v_row.pushed);
END;
$function$;

-- ── broadcast_insert_users ──────────────────────────────────────────────────────────────────────
-- The next p_limit players (by id) get the notice; the cursor moves in the same transaction. The row
-- lock makes two callers take turns, and each one starts after the other's cursor.
CREATE OR REPLACE FUNCTION public.broadcast_insert_users(p_id text, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b "Broadcast";
  v_n integer;
  v_last text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 5000), 20000));
BEGIN
  SELECT * INTO v_b FROM "Broadcast" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found');
  END IF;
  IF v_b.status <> 'inserting' THEN
    RETURN jsonb_build_object('success', true, 'inserted', 0, 'done', true);
  END IF;

  WITH next_users AS (
    SELECT u.id FROM "User" u
     WHERE v_b."userCursor" IS NULL OR u.id > v_b."userCursor"
     ORDER BY u.id
     LIMIT v_limit
  ), added AS (
    INSERT INTO "Notification" (id, "userId", title, message, type, link, read, "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, n.id, v_b.title, v_b.message, v_b.type, v_b.link, false,
           now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
      FROM next_users n
    RETURNING "userId"
  )
  SELECT count(*)::int, max("userId") INTO v_n, v_last FROM added;

  UPDATE "Broadcast"
     SET "userCursor" = coalesce(v_last, "userCursor"),
         inserted = inserted + v_n,
         status = CASE WHEN v_n < v_limit THEN 'pushing' ELSE status END,
         "updatedAt" = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'inserted', v_n, 'done', v_n < v_limit);
END;
$function$;

-- ── broadcast_wave_done ─────────────────────────────────────────────────────────────────────────
-- Records a wave of pushes, only for the caller that still holds the lease.
CREATE OR REPLACE FUNCTION public.broadcast_wave_done(
  p_id text, p_token text, p_cursor text, p_sent integer, p_last boolean, p_next_wave_seconds integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE "Broadcast"
     SET "pushCursor" = coalesce(p_cursor, "pushCursor"),
         pushed = pushed + greatest(coalesce(p_sent, 0), 0),
         waves = waves + 1,
         status = CASE WHEN p_last THEN 'done' ELSE status END,
         "doneAt" = CASE WHEN p_last THEN now() ELSE "doneAt" END,
         "nextWaveAt" = now() + make_interval(secs => greatest(0, least(coalesce(p_next_wave_seconds, 60), 3600))),
         "leaseToken" = NULL,
         "leaseUntil" = NULL,
         "updatedAt" = now()
   WHERE id = p_id AND status = 'pushing' AND "leaseToken" = p_token;
  RETURN jsonb_build_object('success', FOUND);
END;
$function$;

-- ── broadcast_release ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.broadcast_release(p_id text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE "Broadcast" SET "leaseToken" = NULL, "leaseUntil" = NULL, "updatedAt" = now()
   WHERE id = p_id AND "leaseToken" = p_token;
  RETURN jsonb_build_object('success', FOUND);
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_create(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_insert_users(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_wave_done(text, text, text, integer, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_release(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_create(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_insert_users(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_wave_done(text, text, text, integer, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_release(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
