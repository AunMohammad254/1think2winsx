-- Test baseline: verbatim copy of the 2026-10-09 read-only dump of the live schema.
-- Do not edit by hand: see db-tests/README.md ("Updating the baseline").
-- 03c: functions 29-42. Generated read-only from production catalog.
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_quiz_attempt_avg_score()
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT COALESCE(AVG(score), 0) FROM "QuizAttempt" WHERE score IS NOT NULL; $function$
;

CREATE OR REPLACE FUNCTION public.get_quiz_attempt_counts_by_quiz(quiz_ids text[])
 RETURNS TABLE(quiz_id text, attempt_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT "quizId" AS quiz_id, COUNT(*) AS attempt_count FROM "QuizAttempt" WHERE "quizId" = ANY(quiz_ids) GROUP BY "quizId"; $function$
;

CREATE OR REPLACE FUNCTION public.get_quiz_stats(quiz_id_param text)
 RETURNS TABLE(quiz_id text, title text, status text, total_questions bigint, total_attempts bigint, completed_attempts bigint, average_score numeric, completion_rate numeric, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        q.id AS quiz_id,
        q.title,
        q.status,
        (SELECT COUNT(*) FROM "Question" WHERE "quizId" = q.id) AS total_questions,
        (SELECT COUNT(*) FROM "QuizAttempt" WHERE "quizId" = q.id) AS total_attempts,
        (SELECT COUNT(*) FROM "QuizAttempt" WHERE "quizId" = q.id AND "isCompleted" = true) AS completed_attempts,
        COALESCE(
            (SELECT AVG(score) FROM "QuizAttempt" WHERE "quizId" = q.id AND "isCompleted" = true),
            0
        ) AS average_score,
        CASE
            WHEN (SELECT COUNT(*) FROM "QuizAttempt" WHERE "quizId" = q.id) > 0
            THEN ROUND(
                (SELECT COUNT(*) FROM "QuizAttempt" WHERE "quizId" = q.id AND "isCompleted" = true)::NUMERIC /
                (SELECT COUNT(*) FROM "QuizAttempt" WHERE "quizId" = q.id)::NUMERIC * 100,
                2
            )
            ELSE 0
        END AS completion_rate,
        q."createdAt" AS created_at
    FROM "Quiz" q
    WHERE q.id = quiz_id_param;
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_activity(limit_count integer DEFAULT 10)
 RETURNS TABLE(activity_type text, activity_id text, user_id text, user_email text, user_name text, quiz_id text, quiz_title text, score integer, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    -- Recent Quiz Attempts
    SELECT
        'quiz_attempt'::TEXT AS activity_type,
        qa.id AS activity_id,
        u.id AS user_id,
        u.email AS user_email,
        u.name AS user_name,
        q.id AS quiz_id,
        q.title AS quiz_title,
        qa.score,
        qa."createdAt" AS created_at
    FROM "QuizAttempt" qa
    JOIN "User" u ON qa."userId" = u.id
    JOIN "Quiz" q ON qa."quizId" = q.id
    WHERE qa."isCompleted" = true

    UNION ALL

    -- New User Signups
    SELECT
        'user_signup'::TEXT AS activity_type,
        u.id AS activity_id,
        u.id AS user_id,
        u.email AS user_email,
        u.name AS user_name,
        NULL AS quiz_id,
        NULL AS quiz_title,
        NULL AS score,
        u."createdAt" AS created_at
    FROM "User" u
    WHERE u."createdAt" >= NOW() - INTERVAL '30 days'

    ORDER BY created_at DESC
    LIMIT limit_count;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_auth_providers(p_user_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    providers TEXT[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT provider ORDER BY provider)
    INTO providers
    FROM auth.identities
    WHERE user_id = p_user_id;

    RETURN COALESCE(providers, ARRAY[]::TEXT[]);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_redemptions()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_email text;
  v_user_id text;
  v_redemptions json;
BEGIN
  -- Get current user email from JWT
  v_user_email := (SELECT auth.jwt() ->> 'email');

  IF v_user_email IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Look up the user's CUID from the User table by email
  SELECT id INTO v_user_id
  FROM "public"."User"
  WHERE email = v_user_email;

  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', true, 'redemptions', '[]'::json);
  END IF;

  -- Get redemptions with prize details
  SELECT json_agg(
    json_build_object(
      'id', r.id,
      'pointsUsed', r."pointsUsed",
      'status', r.status,
      'requestedAt', r."requestedAt",
      'processedAt', r."processedAt",
      'notes', r.notes,
      'prize', json_build_object(
        'name', p.name,
        'description', p.description,
        'imageUrl', p."imageUrl",
        'type', p.type
      )
    )
    ORDER BY r."requestedAt" DESC
  ) INTO v_redemptions
  FROM "public"."PrizeRedemption" r
  JOIN "public"."Prize" p ON r."prizeId" = p.id
  WHERE r."userId" = v_user_id;

  RETURN json_build_object('success', true, 'redemptions', COALESCE(v_redemptions, '[]'::json));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_wallet_balance()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_email text;
  v_balance float;
BEGIN
  -- Get current user email from JWT
  v_user_email := (SELECT auth.jwt() ->> 'email');

  IF v_user_email IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Get wallet balance
  SELECT "walletBalance" INTO v_balance
  FROM "public"."User"
  WHERE email = v_user_email;

  IF v_balance IS NULL THEN
    RETURN json_build_object('success', true, 'balance', 0);
  END IF;

  RETURN json_build_object('success', true, 'balance', v_balance);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- First check if email already exists, if so update the ID
  IF EXISTS (SELECT 1 FROM public."User" WHERE email = new.email) THEN
    UPDATE public."User"
    SET id = new.id::text, "updatedAt" = NOW()
    WHERE email = new.email;
  ELSE
    -- Insert new user with UUID cast to TEXT
    INSERT INTO public."User" (id, email, name, "createdAt", "updatedAt")
    VALUES (
      new.id::text,
      new.email,
      COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name'),
      NOW(),
      NOW()
    );
  END IF;

  RETURN new;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user error: %', SQLERRM;
    RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_user_points(p_user_id text, p_delta integer)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE "User"
  SET
    points     = points + p_delta,
    "updatedAt" = now()
  WHERE id = p_user_id
  RETURNING points;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_user_wallet(p_user_id text, p_delta numeric)
 RETURNS numeric
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE "User"
  SET
    "walletBalance" = "walletBalance" + p_delta,
    "updatedAt"     = now()
  WHERE id = p_user_id
  RETURNING "walletBalance";
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT private_hardened.is_admin();
$function$
;

CREATE OR REPLACE FUNCTION public.is_oauth_only_user(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- User is OAuth-only if they have at least one identity but none with 'email' provider
    RETURN EXISTS (
        SELECT 1 FROM auth.identities WHERE user_id = p_user_id
    ) AND NOT EXISTS (
        SELECT 1 FROM auth.identities WHERE user_id = p_user_id AND provider = 'email'
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_quiz_access(p_quiz_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid()::text;
  v_price double precision;
  v_balance double precision;
  v_existing record;
  v_payment_id text := 'dp_' || gen_random_uuid()::text;
  v_expires timestamp := (now() AT TIME ZONE 'utc') + interval '24 hours';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Serialise per user so double-clicks can't double-charge.
  PERFORM pg_advisory_xact_lock(hashtext('pay:' || v_uid));

  SELECT id, "expiresAt" INTO v_existing FROM "DailyPayment"
   WHERE "userId" = v_uid AND status = 'completed' AND "expiresAt" > now()
   ORDER BY "expiresAt" DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'alreadyActive', true, 'paymentId', v_existing.id, 'expiresAt', v_existing."expiresAt");
  END IF;

  SELECT COALESCE(
           (SELECT "accessPrice" FROM "Quiz" WHERE id = p_quiz_id AND status = 'active'),
           (SELECT "accessPrice" FROM "Quiz" WHERE status = 'active' ORDER BY "createdAt" LIMIT 1),
           2.0)
    INTO v_price;

  SELECT "walletBalance" INTO v_balance FROM "User" WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  IF v_balance < v_price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient wallet balance', 'insufficientBalance', true,
                              'requiredAmount', v_price, 'currentBalance', v_balance);
  END IF;

  UPDATE "User" SET "walletBalance" = "walletBalance" - v_price, "updatedAt" = now() WHERE id = v_uid;

  INSERT INTO "WalletTransaction" (id, "userId", amount, "paymentMethod", "transactionId", status, type,
                                   "adminNotes", "processedAt", "createdAt", "updatedAt")
  VALUES ('wt_' || gen_random_uuid()::text, v_uid, -v_price, 'QuizAccess', 'quiz_access_' || v_payment_id,
          'approved', 'quiz_access',
          CASE WHEN p_quiz_id IS NULL THEN '24-hour quiz access payment' ELSE 'Quiz access payment for quiz: ' || p_quiz_id END,
          now(), now(), now());

  INSERT INTO "DailyPayment" (id, "userId", amount, status, "paymentMethod", "transactionId", "expiresAt", "createdAt", "updatedAt")
  VALUES (v_payment_id, v_uid, v_price, 'completed', 'wallet', 'wallet_' || v_payment_id, v_expires, now(), now());

  RETURN jsonb_build_object('success', true, 'paymentId', v_payment_id, 'amount', v_price,
                            'newBalance', v_balance - v_price, 'expiresAt', v_expires);
END $function$
;

CREATE OR REPLACE FUNCTION public.process_claim(p_claim_id text, p_action text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_claim RECORD;
    v_result JSONB;
BEGIN
    -- Get claim with lock
    SELECT * INTO v_claim
    FROM "PrizeRedemption"
    WHERE id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Claim not found');
    END IF;

    IF v_claim.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Claim is not pending');
    END IF;

    IF p_action = 'approve' THEN
        -- Update claim to approved
        UPDATE "PrizeRedemption"
        SET status = 'approved',
            notes = COALESCE(p_notes, notes),
            "processedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE id = p_claim_id;

        v_result := jsonb_build_object(
            'success', true,
            'claim_id', p_claim_id,
            'status', 'approved'
        );

    ELSIF p_action = 'reject' THEN
        -- Refund points to user
        UPDATE "User"
        SET points = points + v_claim."pointsUsed",
            "updatedAt" = NOW()
        WHERE id = v_claim."userId";

        -- Update claim to rejected
        UPDATE "PrizeRedemption"
        SET status = 'rejected',
            notes = COALESCE(p_notes, notes),
            "processedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE id = p_claim_id;

        v_result := jsonb_build_object(
            'success', true,
            'claim_id', p_claim_id,
            'status', 'rejected',
            'points_refunded', v_claim."pointsUsed"
        );
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Invalid action. Use approve or reject');
    END IF;

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;
