CREATE FUNCTION private_hardened.submit_quiz_attempt(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_quiz_attempt_id TEXT; v_existing_attempt RECORD; v_answer RECORD; v_answer_count INTEGER := 0; v_new_id TEXT; v_is_reattempt BOOLEAN := false;
BEGIN
    IF NOT (public.is_admin() OR p_user_id = auth.uid()::text) THEN RETURN jsonb_build_object('success', false, 'error', 'Permission denied'); END IF;
    SELECT id, "isCompleted" INTO v_existing_attempt FROM "QuizAttempt" WHERE "userId" = p_user_id AND "quizId" = p_quiz_id LIMIT 1;
    IF v_existing_attempt.id IS NOT NULL AND v_existing_attempt."isCompleted" = true THEN
        v_is_reattempt := true; v_quiz_attempt_id := v_existing_attempt.id;
        UPDATE "QuizAttempt" SET "completedAt" = NOW(), "isEvaluated" = false, "updatedAt" = NOW() WHERE id = v_quiz_attempt_id;
    ELSE
        v_quiz_attempt_id := 'qa_' || gen_random_uuid()::TEXT;
        INSERT INTO "QuizAttempt" (id, "userId", "quizId", score, points, "isCompleted", "isEvaluated", "completedAt", "dailyPaymentId", "createdAt", "updatedAt")
        VALUES (v_quiz_attempt_id, p_user_id, p_quiz_id, 0, 0, true, false, NOW(), p_daily_payment_id, NOW(), NOW());
    END IF;
    FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
        v_new_id := 'ans_' || gen_random_uuid()::TEXT;
        INSERT INTO "QuestionAttempt" (id, "userId", "questionId", "quizId", "selectedOption", "isCorrect", "attemptedAt")
        VALUES ('qat_' || gen_random_uuid()::TEXT, p_user_id, v_answer.value->>'questionId', p_quiz_id, (v_answer.value->>'selectedOption')::INTEGER, false, NOW())
        ON CONFLICT ("userId", "questionId") DO UPDATE SET "selectedOption" = (v_answer.value->>'selectedOption')::INTEGER, "attemptedAt" = NOW();
        INSERT INTO "Answer" (id, "userId", "questionId", "quizAttemptId", "selectedOption", "isCorrect", "createdAt")
        VALUES (v_new_id, p_user_id, v_answer.value->>'questionId', v_quiz_attempt_id, (v_answer.value->>'selectedOption')::INTEGER, false, NOW());
        v_answer_count := v_answer_count + 1;
    END LOOP;
    RETURN jsonb_build_object('success', true, 'attemptId', v_quiz_attempt_id, 'answersSubmitted', v_answer_count, 'isReattempt', v_is_reattempt);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
CREATE FUNCTION public.submit_quiz_attempt(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $$ BEGIN RETURN private_hardened.submit_quiz_attempt(p_user_id := p_user_id, p_quiz_id := p_quiz_id, p_answers := p_answers, p_daily_payment_id := p_daily_payment_id); END; $$;

CREATE FUNCTION public.get_leaderboard(p_timeframe text DEFAULT 'allTime'::text, p_limit integer DEFAULT 10, p_quiz_id text DEFAULT NULL::text)
 RETURNS TABLE(id text, "userName" text, "profilePicture" text, "quizzesTaken" integer, "correctAnswers" integer, "totalScore" integer, "winCount" integer, "averageScore" integer, rank integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_date_filter TIMESTAMP;
BEGIN
    IF p_timeframe = 'weekly' THEN v_date_filter := NOW() - INTERVAL '7 days';
    ELSIF p_timeframe = 'monthly' THEN v_date_filter := NOW() - INTERVAL '30 days';
    ELSE v_date_filter := NULL; END IF;
    RETURN QUERY
    WITH user_attempts AS (
        SELECT qa."userId", COUNT(qa.id)::integer as quizzes_taken, COALESCE(SUM(qa.score), 0)::integer as total_score
        FROM "QuizAttempt" qa WHERE (p_quiz_id IS NULL OR qa."quizId" = p_quiz_id) AND (v_date_filter IS NULL OR qa."createdAt" >= v_date_filter)
        GROUP BY qa."userId"),
    user_correct AS (
        SELECT ans."userId", COUNT(ans.id)::integer as correct_answers FROM "Answer" ans
        WHERE ans."isCorrect" = true AND (v_date_filter IS NULL OR ans."createdAt" >= v_date_filter) GROUP BY ans."userId"),
    user_winnings AS (SELECT w."userId", COUNT(w.id)::integer as winnings_count FROM "Winning" w WHERE (v_date_filter IS NULL OR w."createdAt" >= v_date_filter) GROUP BY w."userId"),
    user_redemptions AS (SELECT pr."userId", COUNT(pr.id)::integer as redemptions_count FROM "PrizeRedemption" pr WHERE pr.status IN ('pending', 'approved', 'fulfilled') GROUP BY pr."userId")
    SELECT u.id, u.name as "userName", u."profilePicture", COALESCE(ua.quizzes_taken, 0)::integer, COALESCE(uc.correct_answers, 0)::integer,
        COALESCE(ua.total_score, 0)::integer, (COALESCE(uw.winnings_count, 0) + COALESCE(ur.redemptions_count, 0))::integer,
        CASE WHEN COALESCE(ua.quizzes_taken, 0) > 0 THEN ROUND(ua.total_score::numeric / ua.quizzes_taken)::integer ELSE 0 END,
        ROW_NUMBER() OVER (ORDER BY COALESCE(ua.total_score, 0) DESC,
            CASE WHEN COALESCE(ua.quizzes_taken, 0) > 0 THEN ROUND(ua.total_score::numeric / ua.quizzes_taken)::integer ELSE 0 END DESC,
            COALESCE(ua.quizzes_taken, 0) DESC)::integer as rank
    FROM user_attempts ua JOIN "User" u ON u.id = ua."userId"
    LEFT JOIN user_correct uc ON uc."userId" = ua."userId" LEFT JOIN user_winnings uw ON uw."userId" = ua."userId" LEFT JOIN user_redemptions ur ON ur."userId" = ua."userId"
    ORDER BY rank ASC LIMIT p_limit;
END; $function$;

CREATE FUNCTION public.deduct_wallet_balance(p_user_id uuid, p_amount double precision) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_current_balance float;
BEGIN
  SELECT "walletBalance" INTO v_current_balance FROM "User" WHERE id = p_user_id::text FOR UPDATE;
  IF v_current_balance IS NULL THEN RETURN json_build_object('success', false, 'error', 'User not found'); END IF;
  IF v_current_balance < p_amount THEN RETURN json_build_object('success', false, 'error', 'Insufficient funds'); END IF;
  UPDATE "User" SET "walletBalance" = "walletBalance" - p_amount, "updatedAt" = now() WHERE id = p_user_id::text;
  RETURN json_build_object('success', true, 'new_balance', v_current_balance - p_amount);
END; $$;
CREATE FUNCTION public.get_quiz_attempt_counts_by_quiz(quiz_ids text[]) RETURNS TABLE("quizId" text, count bigint) LANGUAGE sql SET search_path=public AS $$
  SELECT "quizId", count(*) FROM "QuizAttempt" WHERE "quizId" = ANY(quiz_ids) GROUP BY "quizId" $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_uid(), public.is_admin(), public.submit_quiz_attempt(text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(text,integer,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private_hardened.submit_quiz_attempt(text,text,jsonb,text), private_hardened.is_admin() TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
