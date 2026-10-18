-- Test baseline: verbatim copy of the 2026-10-09 read-only dump of the live schema.
-- Do not edit by hand: see db-tests/README.md ("Updating the baseline").
-- 03a: functions 1-14 (private_hardened + public, alphabetical). Generated read-only from production catalog.
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS private_hardened;

CREATE OR REPLACE FUNCTION private_hardened.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM "AdminSession"
        WHERE email = (SELECT (SELECT auth.jwt()) ->> 'email')
        AND "expiresAt" > NOW()
    );
$function$
;

CREATE OR REPLACE FUNCTION private_hardened.redeem_prize(p_user_id text, p_prize_id text, p_full_name text DEFAULT NULL::text, p_whatsapp_number text DEFAULT NULL::text, p_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user RECORD;
    v_prize RECORD;
    v_redemption_id TEXT;
    v_points_required INTEGER;
BEGIN
    -- SECURITY CHECK: Ensure the caller is either an admin or the user themselves
    IF NOT (public.is_admin() OR p_user_id = auth.uid()::text) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Permission denied');
    END IF;

    -- Get user with current points
    SELECT id, points INTO v_user
    FROM "User"
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    -- Get prize details
    SELECT id, name, "pointsRequired", "isActive", stock INTO v_prize
    FROM "Prize"
    WHERE id = p_prize_id
    FOR UPDATE;

    IF NOT FOUND OR v_prize."isActive" = false THEN
        RETURN jsonb_build_object('success', false, 'error', 'Prize not found or not available');
    END IF;

    -- Check stock
    IF v_prize.stock IS NOT NULL AND v_prize.stock <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Prize is out of stock');
    END IF;

    -- Check points
    v_points_required := v_prize."pointsRequired";
    IF v_user.points < v_points_required THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient points',
            'required', v_points_required,
            'available', v_user.points
        );
    END IF;

    -- Generate redemption ID (cuid-like)
    v_redemption_id := 'c' || gen_random_uuid()::text;
    v_redemption_id := replace(v_redemption_id, '-', '');
    v_redemption_id := substring(v_redemption_id from 1 for 25);

    -- Deduct points from user
    UPDATE "User"
    SET points = points - v_points_required,
        "updatedAt" = NOW()
    WHERE id = p_user_id;

    -- Decrement stock if applicable
    IF v_prize.stock IS NOT NULL THEN
        UPDATE "Prize"
        SET stock = stock - 1,
            "updatedAt" = NOW()
        WHERE id = p_prize_id;
    END IF;

    -- Create redemption record
    INSERT INTO "PrizeRedemption" (
        id, "userId", "prizeId", "pointsUsed", status,
        "fullName", "whatsappNumber", address,
        "requestedAt", "createdAt", "updatedAt"
    ) VALUES (
        v_redemption_id, p_user_id, p_prize_id, v_points_required, 'pending',
        p_full_name, p_whatsapp_number, p_address,
        NOW(), NOW(), NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'redemption_id', v_redemption_id,
        'points_used', v_points_required,
        'new_balance', v_user.points - v_points_required
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION private_hardened.submit_quiz(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_attempt_id TEXT;
    v_answer JSONB;
    v_answer_id TEXT;
    v_question_attempt_id TEXT;
BEGIN
    -- SECURITY CHECK: Ensure the caller is either an admin or the user themselves
    IF NOT (public.is_admin() OR p_user_id = auth.uid()::text) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Permission denied');
    END IF;

    -- Generate attempt ID
    v_attempt_id := 'c' || replace(gen_random_uuid()::text, '-', '');
    v_attempt_id := substring(v_attempt_id from 1 for 25);

    -- Create quiz attempt
    INSERT INTO "QuizAttempt" (
        id, "userId", "quizId", score, points,
        "isCompleted", "isEvaluated", "completedAt",
        "dailyPaymentId", "createdAt", "updatedAt"
    ) VALUES (
        v_attempt_id, p_user_id, p_quiz_id, 0, 0,
        true, false, NOW(),
        p_daily_payment_id, NOW(), NOW()
    );

    -- Process each answer
    FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
    LOOP
        -- Generate IDs
        v_answer_id := 'c' || replace(gen_random_uuid()::text, '-', '');
        v_answer_id := substring(v_answer_id from 1 for 25);

        v_question_attempt_id := 'c' || replace(gen_random_uuid()::text, '-', '');
        v_question_attempt_id := substring(v_question_attempt_id from 1 for 25);

        -- Create answer
        INSERT INTO "Answer" (
            id, "userId", "questionId", "selectedOption",
            "quizAttemptId", "isCorrect", "createdAt"
        ) VALUES (
            v_answer_id,
            p_user_id,
            v_answer->>'questionId',
            (v_answer->>'selectedOption')::INTEGER,
            v_attempt_id,
            false,
            NOW()
        );

        -- Create question attempt
        INSERT INTO "QuestionAttempt" (
            id, "userId", "questionId", "quizId",
            "selectedOption", "isCorrect", "attemptedAt", "createdAt"
        ) VALUES (
            v_question_attempt_id,
            p_user_id,
            v_answer->>'questionId',
            p_quiz_id,
            (v_answer->>'selectedOption')::INTEGER,
            false,
            NOW(),
            NOW()
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'attempt_id', v_attempt_id,
        'answers_count', jsonb_array_length(p_answers)
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION private_hardened.submit_quiz_attempt(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid()::text;
  v_quiz record;
  v_payment_id text;
  v_attempt_id text;
  v_existing record;
  v_is_reattempt boolean := false;
  v_inserted int := 0;
  v_valid int;
  v_total int;
  v_wallet_enabled boolean;
BEGIN
  IF v_uid IS NULL OR p_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'forbidden', 'error', 'Permission denied');
  END IF;
  IF jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) = 0 OR jsonb_array_length(p_answers) > 200 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid answers payload');
  END IF;

  SELECT id, status, duration, "pushedAt" INTO v_quiz FROM "Quiz" WHERE id = p_quiz_id;
  IF NOT FOUND OR v_quiz.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Quiz not found or inactive');
  END IF;

  -- Answering window over: duration minutes from pushedAt (+30 s grace for latency)
  IF v_quiz."pushedAt" IS NOT NULL AND v_quiz.duration IS NOT NULL
     AND now() > v_quiz."pushedAt" + make_interval(mins => v_quiz.duration) + interval '30 seconds' THEN
    RETURN jsonb_build_object('success', false, 'code', 'closed', 'error', 'This quiz has ended and no longer accepts answers.');
  END IF;

  SELECT (value IS DISTINCT FROM 'false') INTO v_wallet_enabled FROM "AppSettings" WHERE key = 'wallet_enabled';
  v_wallet_enabled := COALESCE(v_wallet_enabled, true);

  IF v_wallet_enabled THEN
    SELECT id INTO v_payment_id FROM "DailyPayment"
     WHERE "userId" = v_uid AND status = 'completed' AND "expiresAt" > now()
     ORDER BY "expiresAt" DESC LIMIT 1;
    IF v_payment_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'payment_required', 'error', 'No active payment found. Please make a payment to access quizzes.');
    END IF;
  ELSE
    v_payment_id := NULL;
  END IF;

  SELECT count(*), count(q.id) INTO v_total, v_valid
    FROM jsonb_to_recordset(p_answers) AS a("questionId" text, "selectedOption" int)
    LEFT JOIN "Question" q ON q.id = a."questionId" AND q."quizId" = p_quiz_id
         AND q.status = 'active' AND q."hasCorrectAnswer" = false
         AND a."selectedOption" BETWEEN 0 AND 9;
  IF v_valid <> v_total OR v_total <> (SELECT count(DISTINCT e->>'questionId') FROM jsonb_array_elements(p_answers) e) THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid or closed question IDs in submission');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_uid || ':' || p_quiz_id));

  SELECT id INTO v_existing FROM "QuizAttempt" WHERE "userId" = v_uid AND "quizId" = p_quiz_id;
  IF FOUND THEN
    v_is_reattempt := true;
    v_attempt_id := v_existing.id;
  ELSE
    v_attempt_id := 'qa_' || gen_random_uuid()::text;
    INSERT INTO "QuizAttempt" (id, "userId", "quizId", score, points, "isCompleted", "isEvaluated",
                               "completedAt", "dailyPaymentId", "createdAt", "updatedAt")
    VALUES (v_attempt_id, v_uid, p_quiz_id, 0, 0, true, false, now(), v_payment_id, now(), now());
  END IF;

  WITH ins AS (
    INSERT INTO "QuestionAttempt" (id, "userId", "questionId", "quizId", "selectedOption", "isCorrect", "attemptedAt")
    SELECT 'qat_' || gen_random_uuid()::text, v_uid, a."questionId", p_quiz_id, a."selectedOption", false, now()
      FROM jsonb_to_recordset(p_answers) AS a("questionId" text, "selectedOption" int)
    ON CONFLICT ("userId", "questionId") DO NOTHING
    RETURNING "questionId", "selectedOption"
  ), ans AS (
    INSERT INTO "Answer" (id, "userId", "questionId", "quizAttemptId", "selectedOption", "isCorrect", "createdAt")
    SELECT 'ans_' || gen_random_uuid()::text, v_uid, "questionId", v_attempt_id, "selectedOption", false, now() FROM ins
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ans;

  IF v_is_reattempt AND v_inserted > 0 THEN
    UPDATE "QuizAttempt" SET "completedAt" = now(), "isEvaluated" = false, "updatedAt" = now() WHERE id = v_attempt_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'attemptId', v_attempt_id,
    'answersSubmitted', v_inserted,
    'isReattempt', v_is_reattempt,
    'totalQuestions', (SELECT count(*) FROM "Question" WHERE "quizId" = p_quiz_id AND status = 'active'));
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'submit_quiz_attempt failed: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'code', 'error', 'error', 'Failed to submit quiz');
END $function$
;

CREATE OR REPLACE FUNCTION public.allocate_points_to_winners(p_quiz_id text, p_winner_user_ids text[], p_points_per_winner integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id TEXT;
    v_updated_count INTEGER := 0;
BEGIN
    FOREACH v_user_id IN ARRAY p_winner_user_ids
    LOOP
        -- Update user points
        UPDATE "User"
        SET points = points + p_points_per_winner,
            "updatedAt" = NOW()
        WHERE id = v_user_id;

        -- Update quiz attempt with points
        UPDATE "QuizAttempt"
        SET points = p_points_per_winner,
            "updatedAt" = NOW()
        WHERE "userId" = v_user_id AND "quizId" = p_quiz_id;

        v_updated_count := v_updated_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'updated_count', v_updated_count,
        'total_points_distributed', v_updated_count * p_points_per_winner
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_claim RECORD;
BEGIN
    -- Verify caller is admin
    IF NOT is_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin access required');
    END IF;

    -- Get claim with lock
    SELECT id, "userId", "pointsUsed", status INTO v_claim
    FROM "PrizeRedemption"
    WHERE id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Claim not found');
    END IF;

    IF v_claim.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Claim is not pending (current status: ' || v_claim.status || ')');
    END IF;

    -- Update claim status to approved
    UPDATE "PrizeRedemption"
    SET status = 'approved',
        notes = COALESCE(p_notes, notes),
        "processedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE id = p_claim_id;

    RETURN jsonb_build_object(
        'success', true,
        'claim_id', p_claim_id,
        'status', 'approved',
        'message', 'Claim approved successfully'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_wallet_transaction(p_transaction_id text, p_processed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_transaction RECORD;
    v_new_balance DECIMAL(10, 2);
BEGIN
    -- Get transaction with lock
    SELECT id, "userId", amount, status INTO v_transaction
    FROM "WalletTransaction"
    WHERE id = p_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
    END IF;

    IF v_transaction.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transaction is not pending');
    END IF;

    -- Update user wallet balance
    UPDATE "User"
    SET "walletBalance" = "walletBalance" + v_transaction.amount,
        "updatedAt" = NOW()
    WHERE id = v_transaction."userId"
    RETURNING "walletBalance" INTO v_new_balance;

    -- Update transaction status
    UPDATE "WalletTransaction"
    SET status = 'approved',
        "processedBy" = p_processed_by,
        "processedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE id = p_transaction_id;

    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', p_transaction_id,
        'amount', v_transaction.amount,
        'new_balance', v_new_balance
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auth_uid()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT auth.uid()::text;
$function$
;

CREATE OR REPLACE FUNCTION public.can_user_change_password(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM auth.identities
        WHERE user_id = p_user_id
        AND provider = 'email'
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits(retention_minutes integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public."RateLimitEntry"
    WHERE "createdAt" < NOW() - (retention_minutes || ' minutes')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_leaderboard(p_timeframe text, p_limit integer, p_quiz_id text)
 RETURNS TABLE(id text, "userName" text, "profilePicture" text, "quizzesTaken" integer, "correctAnswers" integer, "totalScore" integer, "winCount" integer, "averageScore" integer, rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH f AS (
    SELECT CASE p_timeframe WHEN 'weekly' THEN now() - interval '7 days'
                            WHEN 'monthly' THEN now() - interval '30 days' END AS since
  ), ua AS (
    SELECT qa."userId", count(*)::int AS quizzes_taken, COALESCE(sum(qa.score), 0)::int AS total_score
      FROM "QuizAttempt" qa, f
     WHERE (p_quiz_id IS NULL OR qa."quizId" = p_quiz_id) AND (f.since IS NULL OR qa."createdAt" >= f.since)
     GROUP BY qa."userId"
  ), top AS (
    SELECT ua.*, CASE WHEN quizzes_taken > 0 THEN round(total_score::numeric / quizzes_taken)::int ELSE 0 END AS avg_score
      FROM ua ORDER BY total_score DESC, avg_score DESC, quizzes_taken DESC
     LIMIT p_limit
  )
  SELECT u.id, u.name, u."profilePicture", t.quizzes_taken,
         (SELECT count(*)::int FROM "Answer" a, f
           WHERE a."userId" = t."userId" AND a."isCorrect" AND (f.since IS NULL OR a."createdAt" >= f.since)),
         t.total_score,
         ((SELECT count(*) FROM "Winning" w, f WHERE w."userId" = t."userId" AND (f.since IS NULL OR w."createdAt" >= f.since))
          + (SELECT count(*) FROM "PrizeRedemption" pr WHERE pr."userId" = t."userId" AND pr.status IN ('pending','approved','fulfilled')))::int,
         t.avg_score,
         (row_number() OVER (ORDER BY t.total_score DESC, t.avg_score DESC, t.quizzes_taken DESC))::int
    FROM top t JOIN "User" u ON u.id = t."userId"
   ORDER BY 9;
$function$
;

CREATE OR REPLACE FUNCTION public.decrement_prize_stock(p_prize_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock integer;
BEGIN
  UPDATE "Prize"
  SET
    "stockQuantity" = "stockQuantity" - 1,
    "updatedAt"     = now()
  WHERE id = p_prize_id
    AND "stockQuantity" > 0
  RETURNING "stockQuantity" INTO v_stock;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize out of stock or not found: %', p_prize_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_stock;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.deduct_wallet_balance(p_user_id uuid, p_amount double precision)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_balance float;
BEGIN
  -- Lock the user row for update to prevent race conditions
  SELECT "walletBalance" INTO v_current_balance
  FROM "public"."User"
  WHERE id = p_user_id::text
  FOR UPDATE;

  IF v_current_balance IS NULL THEN
     RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  IF v_current_balance < p_amount THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient funds');
  END IF;

  UPDATE "public"."User"
  SET
    "walletBalance" = "walletBalance" - p_amount,
    "updatedAt" = now()
  WHERE id = p_user_id::text;

  RETURN json_build_object('success', true, 'new_balance', v_current_balance - p_amount);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_user_completely(p_email text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id TEXT;
    v_auth_user_id UUID;
    v_user_name TEXT;
    v_result JSON;

    del_security_logs INT := 0;
    del_question_attempts INT := 0;
    del_answers INT := 0;
    del_quiz_attempts INT := 0;
    del_wallet_transactions INT := 0;
    del_prize_redemptions INT := 0;
    del_winnings INT := 0;
    del_admin_sessions INT := 0;
    del_user INT := 0;
    del_auth_user INT := 0;
BEGIN
    -- Find user
    SELECT id, name INTO v_user_id, v_user_name
    FROM public."User"
    WHERE email = p_email;

    SELECT id INTO v_auth_user_id
    FROM auth.users
    WHERE email = p_email;

    IF v_user_id IS NULL AND v_auth_user_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'User not found with email: ' || p_email
        );
    END IF;

    -- Delete from all tables
    IF v_auth_user_id IS NOT NULL THEN
        DELETE FROM public.security_logs WHERE user_id = v_auth_user_id;
        GET DIAGNOSTICS del_security_logs = ROW_COUNT;
    END IF;

    IF v_user_id IS NOT NULL THEN
        DELETE FROM public."QuestionAttempt" WHERE "userId" = v_user_id;
        GET DIAGNOSTICS del_question_attempts = ROW_COUNT;

        DELETE FROM public."Answer" WHERE "userId" = v_user_id;
        GET DIAGNOSTICS del_answers = ROW_COUNT;

        DELETE FROM public."QuizAttempt" WHERE "userId" = v_user_id;
        GET DIAGNOSTICS del_quiz_attempts = ROW_COUNT;

        DELETE FROM public."WalletTransaction" WHERE "userId" = v_user_id;
        GET DIAGNOSTICS del_wallet_transactions = ROW_COUNT;

        DELETE FROM public."PrizeRedemption" WHERE "userId" = v_user_id;
        GET DIAGNOSTICS del_prize_redemptions = ROW_COUNT;

        DELETE FROM public."Winning" WHERE "userId" = v_user_id;
        GET DIAGNOSTICS del_winnings = ROW_COUNT;

        DELETE FROM public."User" WHERE id = v_user_id;
        GET DIAGNOSTICS del_user = ROW_COUNT;
    END IF;

    DELETE FROM public."AdminSession" WHERE email = p_email;
    GET DIAGNOSTICS del_admin_sessions = ROW_COUNT;

    IF v_auth_user_id IS NOT NULL THEN
        DELETE FROM auth.users WHERE id = v_auth_user_id;
        GET DIAGNOSTICS del_auth_user = ROW_COUNT;
    END IF;

    RETURN json_build_object(
        'success', true,
        'email', p_email,
        'userName', v_user_name,
        'deletedRecords', json_build_object(
            'securityLogs', del_security_logs,
            'questionAttempts', del_question_attempts,
            'answers', del_answers,
            'quizAttempts', del_quiz_attempts,
            'walletTransactions', del_wallet_transactions,
            'prizeRedemptions', del_prize_redemptions,
            'winnings', del_winnings,
            'adminSessions', del_admin_sessions,
            'user', del_user,
            'authUser', del_auth_user
        )
    );
END;
$function$
;
