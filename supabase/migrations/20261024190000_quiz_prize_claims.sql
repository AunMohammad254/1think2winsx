-- =============================================================================
-- Delivery claims for prizes won in a quiz
--
-- NOT applied to production yet. Apply it BEFORE deploying the code that calls claim_quiz_prize (the
-- profile's "Prizes you won" section). The live code keeps working with it: get_admin_claims only gains
-- a "quiz" field. Production on 2026-10-24: 2 prizes won in quizzes, neither with a claim yet; both
-- winners can claim once this is live.
--
-- Why (F1 in the quiz deep dive): settle_quiz takes a won prize out of stock and tells the winner "our
-- team will contact you", but creates no claim. "QuizWinner"."prizeRedemptionId" existed and was never
-- set, so nothing showed which prizes still had to be delivered, or where to.
--
-- Now the winner gives their name, WhatsApp number and address, which creates a pending claim
-- ("PrizeRedemption", 0 points used) linked from their "QuizWinner" row. Admins handle it on the Claims
-- screen like any other: approve, reject, fulfil, reissue. Settlement already took the item out of
-- stock, so a first claim takes nothing more. A rejection puts the item back in stock (update_claim_status
-- does that for every claim), so a winner who sends their details again after one takes it again, if
-- any is left.
--
-- Not safe to re-run: the guard stops a second run.
-- =============================================================================

-- ── 0. Refuse to run if get_admin_claims changed since this migration was written ───────────────
-- It is re-created from the copy in db-tests/schema, which matched production on 2026-10-24
-- (whitespace-insensitive md5 of the body).
DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc
   WHERE oid = to_regprocedure('public.get_admin_claims(text,integer,integer)');
  IF v_md5 IS DISTINCT FROM 'a47257b9195c100e9020c2070c902196' THEN
    RAISE EXCEPTION 'public.get_admin_claims is not the version this migration was written against (body md5 %): merge the change into the migration first',
      coalesce(v_md5, 'missing');
  END IF;
END $guard$;

-- ── 1. The winner's claim ────────────────────────────────────────────────────────────────────────
-- Server only: the API checks the signed-in player and passes their id as p_user_id. The details are
-- checked here too, with the same rules as the form.
CREATE OR REPLACE FUNCTION public.claim_quiz_prize(p_winner_id text, p_user_id text, p_full_name text, p_whatsapp_number text, p_address text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := btrim(coalesce(p_whatsapp_number, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_win record;
  v_previous text;
  v_claim_id text;
BEGIN
  IF length(v_name) NOT BETWEEN 2 AND 100 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Enter your full name (2 to 100 characters)');
  END IF;
  IF v_phone !~ '^\+?[0-9 ()-]{10,15}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Enter a valid WhatsApp number');
  END IF;
  IF length(v_address) NOT BETWEEN 10 AND 500 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Enter your full delivery address (10 to 500 characters)');
  END IF;

  -- Locked: the same winner sending the form twice at once makes one claim
  SELECT w.id, w."userId", w."prizeId", w."prizeRedemptionId", q.title
    INTO v_win
    FROM "QuizWinner" w JOIN "Quiz" q ON q.id = w."quizId"
   WHERE w.id = p_winner_id
     FOR UPDATE OF w;
  IF NOT FOUND OR v_win."userId" IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Prize not found');
  END IF;
  IF v_win."prizeId" IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'This place was paid in points: there is nothing to deliver');
  END IF;

  IF v_win."prizeRedemptionId" IS NOT NULL THEN
    SELECT status INTO v_previous FROM "PrizeRedemption" WHERE id = v_win."prizeRedemptionId" FOR UPDATE;
    IF v_previous IN ('pending', 'approved', 'fulfilled') THEN
      RETURN jsonb_build_object('success', false, 'code', 'already_claimed', 'error', 'Your delivery details for this prize are already with us');
    END IF;
    -- The previous claim was rejected, which put the item back in stock: take it again
    UPDATE "Prize" SET stock = stock - 1, "updatedAt" = now() WHERE id = v_win."prizeId" AND stock > 0;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'code', 'out_of_stock', 'error', 'This prize is out of stock. Please contact support');
    END IF;
  END IF;

  v_claim_id := 'pr_' || gen_random_uuid()::text;
  INSERT INTO "PrizeRedemption" (id, "userId", "prizeId", "pointsUsed", status, "fullName", "whatsappNumber", address,
                                 "requestedAt", notes, "createdAt", "updatedAt")
  VALUES (v_claim_id, p_user_id, v_win."prizeId", 0, 'pending', v_name, v_phone, v_address,
          now(), 'Won in quiz: ' || v_win.title, now(), now());
  UPDATE "QuizWinner" SET "prizeRedemptionId" = v_claim_id, "updatedAt" = now() WHERE id = v_win.id;

  RETURN jsonb_build_object('success', true, 'claimId', v_claim_id);
END $function$;
REVOKE ALL ON FUNCTION public.claim_quiz_prize(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_quiz_prize(text, text, text, text, text) TO service_role;

-- ── 2. The Claims screen shows which quiz a claim's prize was won in ───────────────────────────
-- Same as before, plus "quiz" ({ id, title }, or null for a prize bought with points).
CREATE OR REPLACE FUNCTION public.get_admin_claims(p_status text DEFAULT NULL::text, p_page integer DEFAULT 1, p_limit integer DEFAULT 20)
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

  -- Count total claims
  SELECT COUNT(*) INTO v_total
  FROM "public"."PrizeRedemption" r
  WHERE (p_status IS NULL OR p_status = 'all' OR r."status" = p_status);

  v_total_pages := CEIL(v_total::float / p_limit);

  -- Get claims with user, prize and quiz data
  SELECT json_agg(claim_data ORDER BY claim_data."requestedAt" DESC) INTO v_claims
  FROM (
    SELECT
      r.id,
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
        LIMIT 1) AS quiz
    FROM "public"."PrizeRedemption" r
    JOIN "public"."User" u ON r."userId" = u.id
    JOIN "public"."Prize" p ON r."prizeId" = p.id
    WHERE (p_status IS NULL OR p_status = 'all' OR r."status" = p_status)
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
