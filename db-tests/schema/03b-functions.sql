-- Test baseline: verbatim copy of the 2026-10-09 read-only dump of the live schema.
-- Do not edit by hand: see db-tests/README.md ("Updating the baseline").
-- 03b: functions 15-28. Generated read-only from production catalog.
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.evaluate_question(p_question_id text, p_correct_option integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_answers int; v_qattempts int;
BEGIN
  UPDATE "Question" SET "correctOption" = p_correct_option, "hasCorrectAnswer" = true, "updatedAt" = now()
   WHERE id = p_question_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Question not found');
  END IF;

  UPDATE "Answer" a SET "isCorrect" = (a."selectedOption" = p_correct_option)
   WHERE a."questionId" = p_question_id
     AND a."isCorrect" IS DISTINCT FROM (a."selectedOption" = p_correct_option);
  GET DIAGNOSTICS v_answers = ROW_COUNT;

  UPDATE "QuestionAttempt" qa SET "isCorrect" = (qa."selectedOption" = p_correct_option)
   WHERE qa."questionId" = p_question_id
     AND qa."isCorrect" IS DISTINCT FROM (qa."selectedOption" = p_correct_option);
  GET DIAGNOSTICS v_qattempts = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'answersUpdated', v_answers, 'questionAttemptsUpdated', v_qattempts);
END $function$
;

CREATE OR REPLACE FUNCTION public.finalize_quiz_scores(p_quiz_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_total_questions int; v_evaluated int;
BEGIN
  SELECT count(*) INTO v_total_questions FROM "Question" WHERE "quizId" = p_quiz_id AND status = 'active';
  IF v_total_questions = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quiz has no active questions');
  END IF;

  WITH s AS (
    SELECT a."quizAttemptId" AS id, count(*) FILTER (WHERE a."isCorrect") AS correct
      FROM "Answer" a JOIN "QuizAttempt" t ON t.id = a."quizAttemptId"
     WHERE t."quizId" = p_quiz_id
     GROUP BY a."quizAttemptId")
  UPDATE "QuizAttempt" t
     SET score = round(100.0 * s.correct / v_total_questions)::int, "isEvaluated" = true, "updatedAt" = now()
    FROM s
   WHERE t.id = s.id;
  GET DIAGNOSTICS v_evaluated = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'evaluatedAttempts', v_evaluated, 'totalQuestions', v_total_questions);
END $function$
;

CREATE OR REPLACE FUNCTION public.fulfill_claim(p_claim_id text, p_notes text DEFAULT NULL::text)
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

    IF v_claim.status != 'approved' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Claim must be approved before fulfillment');
    END IF;

    -- Update claim status to fulfilled
    UPDATE "PrizeRedemption"
    SET status = 'fulfilled',
        notes = COALESCE(p_notes, notes),
        "processedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE id = p_claim_id;

    RETURN jsonb_build_object(
        'success', true,
        'claim_id', p_claim_id,
        'status', 'fulfilled',
        'message', 'Claim fulfilled successfully'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_admin_analytics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_30d timestamptz := v_now - interval '30 days';
  v_7d timestamptz := v_now - interval '7 days';
  v_1d timestamptz := v_now - interval '1 day';
  v_revenue jsonb;
  v_funnel jsonb;
  v_cohorts jsonb;
  v_redemptions_by_status jsonb;
  v_stock_by_category jsonb;
  v_total_claimed_value numeric;
  v_dau int;
  v_wau int;
  v_mau int;
  v_total_attempts int;
  v_completed_attempts int;
  v_passed_attempts int;
BEGIN
  -- Revenue: daily sum of completed payments, last 30 days, zero-filled so the
  -- chart always has exactly 30 points (matches the old JS pre-fill behaviour).
  SELECT jsonb_agg(jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'amount', COALESCE(p.amount_sum, 0)) ORDER BY d)
    INTO v_revenue
    FROM generate_series(date_trunc('day', v_now) - interval '29 days', date_trunc('day', v_now), interval '1 day') AS d
    LEFT JOIN (
      SELECT date_trunc('day', "createdAt") AS day, SUM(amount) AS amount_sum
        FROM "Payment" WHERE status = 'completed' AND "createdAt" >= v_30d
        GROUP BY 1
    ) p ON p.day = d;

  -- Funnel: started / completed / passed, last 30 days.
  SELECT count(*),
         count(*) FILTER (WHERE qa."isCompleted"),
         count(*) FILTER (WHERE qa."isCompleted" AND qa.score >= COALESCE(q."passingScore", 80))
    INTO v_total_attempts, v_completed_attempts, v_passed_attempts
    FROM "QuizAttempt" qa
    LEFT JOIN "Quiz" q ON q.id = qa."quizId"
    WHERE qa."createdAt" >= v_30d;

  v_funnel := jsonb_build_array(
    jsonb_build_object('stage', 'Quiz Started', 'count', v_total_attempts, 'percentage', 100),
    jsonb_build_object('stage', 'Completed', 'count', v_completed_attempts, 'percentage',
      CASE WHEN v_total_attempts > 0 THEN round(v_completed_attempts::numeric / v_total_attempts * 100) ELSE 0 END),
    jsonb_build_object('stage', 'Passed Quiz', 'count', v_passed_attempts, 'percentage',
      CASE WHEN v_total_attempts > 0 THEN round(v_passed_attempts::numeric / v_total_attempts * 100) ELSE 0 END)
  );

  -- DAU / WAU / MAU: distinct users with an attempt in the window (MAU window
  -- is 30 days, matching the old code's `attempts` array which was itself
  -- already scoped to the last 30 days before it computed MAU from it).
  SELECT count(DISTINCT "userId") FILTER (WHERE "createdAt" >= v_1d),
         count(DISTINCT "userId") FILTER (WHERE "createdAt" >= v_7d),
         count(DISTINCT "userId")
    INTO v_dau, v_wau, v_mau
    FROM "QuizAttempt"
    WHERE "createdAt" >= v_30d;

  -- Cohorts: last 4 weeks of registrations vs. whether they've played (any
  -- attempt in the last 30 days), same as the old code.
  SELECT jsonb_agg(jsonb_build_object(
           'cohortName', 'Week -' || (w + 1),
           'registered', registered,
           'active', active,
           'rate', CASE WHEN registered > 0 THEN round(active::numeric / registered * 100) ELSE 0 END
         ) ORDER BY w)
    INTO v_cohorts
    FROM (
      SELECT w,
        (SELECT count(*) FROM "User" u
          WHERE u."createdAt" >= v_now - ((w + 1) || ' weeks')::interval
            AND u."createdAt" <  v_now - (w || ' weeks')::interval) AS registered,
        (SELECT count(*) FROM "User" u
          WHERE u."createdAt" >= v_now - ((w + 1) || ' weeks')::interval
            AND u."createdAt" <  v_now - (w || ' weeks')::interval
            AND EXISTS (SELECT 1 FROM "QuizAttempt" qa WHERE qa."userId" = u.id AND qa."createdAt" >= v_30d)) AS active
      FROM generate_series(0, 3) AS w
    ) s;

  -- Prizes & redemptions.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', cnt)), '[]'::jsonb)
    INTO v_redemptions_by_status
    FROM (SELECT status, count(*) AS cnt FROM "PrizeRedemption" GROUP BY status) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'stock', stock_sum)), '[]'::jsonb)
    INTO v_stock_by_category
    FROM (SELECT COALESCE(category, 'General') AS category, SUM(stock) AS stock_sum
            FROM "Prize" GROUP BY 1) s;

  SELECT COALESCE(SUM(p.value), 0) INTO v_total_claimed_value
    FROM "PrizeRedemption" r JOIN "Prize" p ON p.id = r."prizeId"
    WHERE r.status = 'approved';

  RETURN jsonb_build_object(
    'revenue', COALESCE(v_revenue, '[]'::jsonb),
    'funnel', v_funnel,
    'retention', jsonb_build_object(
      'dau', v_dau, 'wau', v_wau, 'mau', v_mau,
      'stickiness', CASE WHEN v_mau > 0 THEN round((v_dau::numeric / v_mau * 100), 1) ELSE 0 END,
      'cohorts', COALESCE(v_cohorts, '[]'::jsonb)
    ),
    'prizes', jsonb_build_object(
      'redemptionsByStatus', v_redemptions_by_status,
      'stockByCategory', v_stock_by_category,
      'totalClaimedValue', v_total_claimed_value
    )
  );
END;
$function$
;

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

  -- Get claims with user and prize data
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
      ) AS prize
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_admin_manager_stats()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claims_stats json;
  v_wallet_stats json;
  v_stream_active boolean;
BEGIN
  -- Claims statistics
  SELECT json_build_object(
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'approved', COUNT(*) FILTER (WHERE status = 'approved'),
    'fulfilled', COUNT(*) FILTER (WHERE status = 'fulfilled'),
    'rejected', COUNT(*) FILTER (WHERE status = 'rejected'),
    'total', COUNT(*)
  ) INTO v_claims_stats
  FROM "public"."PrizeRedemption";

  -- Wallet transaction statistics
  SELECT json_build_object(
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'approved', COUNT(*) FILTER (WHERE status = 'approved'),
    'rejected', COUNT(*) FILTER (WHERE status = 'rejected'),
    'totalApprovedAmount', COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0),
    'todayPending', COUNT(*) FILTER (WHERE status = 'pending' AND DATE("createdAt") = CURRENT_DATE),
    'total', COUNT(*)
  ) INTO v_wallet_stats
  FROM "public"."WalletTransaction";

  -- Stream status
  SELECT "isActive" INTO v_stream_active
  FROM "public"."StreamEmbed"
  WHERE id = 'default';

  RETURN json_build_object(
    'success', true,
    'claims', v_claims_stats,
    'wallet', v_wallet_stats,
    'stream', json_build_object(
      'isActive', COALESCE(v_stream_active, false)
    ),
    'generatedAt', CURRENT_TIMESTAMP
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_admin_stats()
 RETURNS TABLE(total_users bigint, recent_users bigint, monthly_users bigint, total_quizzes bigint, active_quizzes bigint, draft_quizzes bigint, paused_quizzes bigint, total_attempts bigint, completed_attempts bigint, recent_attempts bigint, average_score numeric, total_revenue numeric, total_payments bigint, completed_payments bigint, completion_rate numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT * FROM admin_dashboard_stats;
$function$
;

CREATE OR REPLACE FUNCTION public.get_admin_wallet_transactions(p_status text DEFAULT NULL::text, p_page integer DEFAULT 1, p_limit integer DEFAULT 50)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offset integer;
  v_total integer;
  v_total_pages integer;
  v_transactions json;
BEGIN
  v_offset := (p_page - 1) * p_limit;

  -- Count total transactions
  SELECT COUNT(*) INTO v_total
  FROM "public"."WalletTransaction" w
  WHERE (p_status IS NULL OR p_status = 'all' OR w.status = p_status);

  v_total_pages := CEIL(v_total::float / p_limit);

  -- Get transactions with user data
  SELECT json_agg(tx_data ORDER BY tx_data."createdAt" DESC) INTO v_transactions
  FROM (
    SELECT
      w.id,
      w."userId",
      w.amount,
      w."paymentMethod",
      w."transactionId",
      w.status,
      w."proofImage",
      w."adminNotes",
      w."processedAt",
      w."processedBy",
      w."createdAt",
      json_build_object(
        'id', u.id,
        'name', u.name,
        'email', u.email,
        'walletBalance', u."walletBalance"
      ) AS "user"
    FROM "public"."WalletTransaction" w
    JOIN "public"."User" u ON w."userId" = u.id
    WHERE (p_status IS NULL OR p_status = 'all' OR w.status = p_status)
    ORDER BY w."createdAt" DESC
    LIMIT p_limit OFFSET v_offset
  ) AS tx_data;

  RETURN json_build_object(
    'success', true,
    'transactions', COALESCE(v_transactions, '[]'::json),
    'pagination', json_build_object(
      'page', p_page,
      'limit', p_limit,
      'total', v_total,
      'totalPages', v_total_pages
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_all_claims()
 RETURNS TABLE(id text, "userId" text, "prizeId" text, "pointsUsed" integer, status text, "fullName" text, "whatsappNumber" text, address text, "requestedAt" timestamp without time zone, "processedAt" timestamp without time zone, notes text, "prizeName" text, "prizeImageUrl" text, "userName" text, "userEmail" text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        r.id,
        r."userId",
        r."prizeId",
        r."pointsUsed",
        r.status,
        r."fullName",
        r."whatsappNumber",
        r.address,
        r."requestedAt",
        r."processedAt",
        r.notes,
        p.name AS "prizeName",
        p."imageUrl" AS "prizeImageUrl",
        u.name AS "userName",
        u.email AS "userEmail"
    FROM "PrizeRedemption" r
    LEFT JOIN "Prize" p ON r."prizeId" = p.id
    LEFT JOIN "User" u ON r."userId" = u.id
    ORDER BY r."requestedAt" DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_available_prizes()
 RETURNS SETOF "Prize"
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM "public"."Prize"
  WHERE "isActive" = true
    AND "status" = 'published'
    AND ("stock" IS NULL OR "stock" > 0)
  ORDER BY "pointsRequired" ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_current_user_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT id FROM "User" WHERE email = (SELECT (SELECT auth.jwt()) ->> 'email') LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_leaderboard(p_timeframe text DEFAULT 'allTime'::text, p_limit integer DEFAULT 10, p_quiz_id text DEFAULT NULL::text)
 RETURNS TABLE(id text, "userName" text, "profilePicture" text, "quizzesTaken" integer, "correctAnswers" integer, "totalScore" integer, "winCount" integer, "averageScore" integer, rank integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tf text := CASE WHEN p_timeframe IN ('weekly', 'monthly') THEN p_timeframe ELSE 'allTime' END;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
BEGIN
  IF p_quiz_id IS NULL AND EXISTS (
       SELECT 1 FROM "LeaderboardCache" WHERE timeframe = v_tf AND "refreshedAt" > now() - interval '6 hours') THEN
    RETURN QUERY
      SELECT (c.row->>'id'), (c.row->>'userName'), (c.row->>'profilePicture'), (c.row->>'quizzesTaken')::int,
             (c.row->>'correctAnswers')::int, (c.row->>'totalScore')::int, (c.row->>'winCount')::int,
             (c.row->>'averageScore')::int, c.rank
        FROM "LeaderboardCache" c WHERE c.timeframe = v_tf AND c.rank <= v_limit ORDER BY c.rank;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.compute_leaderboard(v_tf, v_limit, p_quiz_id);
END $function$
;

CREATE OR REPLACE FUNCTION public.get_live_stream_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_config RECORD;
BEGIN
    SELECT
        "id",
        "embedHtml",
        "embedUrl",
        "title",
        "platform",
        "isActive",
        "updatedAt",
        COALESCE("updatedBy", "lastUpdatedBy") as updated_by
    INTO v_config
    FROM "StreamEmbed"
    WHERE "id" = 'default'
    LIMIT 1;

    IF v_config IS NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'isActive', false,
            'embedHtml', '',
            'embedUrl', '',
            'title', 'Livestream',
            'platform', 'custom',
            'message', 'No stream configured'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'isActive', v_config."isActive",
        'embedHtml', COALESCE(v_config."embedHtml", ''),
        'embedUrl', COALESCE(v_config."embedUrl", ''),
        'title', COALESCE(v_config."title", 'Livestream'),
        'platform', COALESCE(v_config."platform", 'custom'),
        'updatedAt', v_config."updatedAt",
        'updatedBy', v_config.updated_by
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_prize_distribution()
 RETURNS TABLE(prize_id text, prize_name text, prize_type text, win_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT w."prizeId" AS prize_id, p.name AS prize_name, p.type AS prize_type, COUNT(*) AS win_count FROM "Winning" w JOIN "Prize" p ON p.id = w."prizeId" GROUP BY w."prizeId", p.name, p.type ORDER BY win_count DESC; $function$
;
