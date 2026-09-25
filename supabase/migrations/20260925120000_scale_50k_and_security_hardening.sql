-- =============================================================================
-- 1Think2Win — scale to 50k users + security hardening
-- Generated 2026-09-25 from a read-only audit of project snhgaklxawthpihjiagh.
--
-- HOW TO APPLY
--   1. Take a backup (Dashboard -> Database -> Backups) or run on a branch first.
--   2. Run this whole file in the SQL editor (it is one transaction).
--   3. THEN deploy the application code from the same PR. The new code calls the
--      functions created here (pay_quiz_access, evaluate_quiz, ...).
--   4. Enable pg_cron's job (section 6) and switch Auth to asymmetric JWT signing
--      keys (Dashboard -> Authentication -> Signing Keys) so the app can verify
--      sessions locally without calling Supabase Auth on every request.
--
-- Tables are still small (<100 rows), so plain CREATE INDEX is instant. If you run
-- this later on a big database, run section 1 separately with CONCURRENTLY.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. INDEXES for the hot paths (quiz list, submit, payment check, leaderboard)
-- -----------------------------------------------------------------------------
-- Active-payment lookup runs on every quiz request.
CREATE INDEX IF NOT EXISTS idx_dailypayment_user_active
  ON public."DailyPayment" ("userId", "expiresAt" DESC) WHERE status = 'completed';
DROP INDEX IF EXISTS public."DailyPayment_userId_idx";              -- covered by the above + FK use

-- One attempt row per user per quiz (the submit RPC already assumes this).
-- Verified: 0 duplicates exist today. Also serves (userId) and (userId, quizId) lookups.
CREATE UNIQUE INDEX IF NOT EXISTS "QuizAttempt_userId_quizId_key"
  ON public."QuizAttempt" ("userId", "quizId");
DROP INDEX IF EXISTS public."QuizAttempt_userId_idx";               -- prefix of the unique index
CREATE INDEX IF NOT EXISTS idx_quizattempt_quiz_unevaluated
  ON public."QuizAttempt" ("quizId") WHERE "isEvaluated" = false;
CREATE INDEX IF NOT EXISTS idx_quizattempt_created ON public."QuizAttempt" ("createdAt");

CREATE INDEX IF NOT EXISTS idx_questionattempt_user_quiz ON public."QuestionAttempt" ("userId", "quizId");
CREATE INDEX IF NOT EXISTS idx_question_quiz_status ON public."Question" ("quizId", status);
CREATE INDEX IF NOT EXISTS idx_quiz_status_created ON public."Quiz" (status, "createdAt" DESC);

-- Evaluation marks answers per (question, selectedOption); leaderboard counts correct answers.
CREATE INDEX IF NOT EXISTS idx_answer_question_selected ON public."Answer" ("questionId", "selectedOption");
DROP INDEX IF EXISTS public."Answer_questionId_idx";                -- prefix of the above
CREATE INDEX IF NOT EXISTS idx_answer_user_correct ON public."Answer" ("userId", "createdAt") WHERE "isCorrect";

CREATE INDEX IF NOT EXISTS idx_wallettx_status_created ON public."WalletTransaction" (status, "createdAt");
CREATE INDEX IF NOT EXISTS idx_securityevent_created ON public."SecurityEvent" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_ratelimit_key_created ON public."RateLimitEntry" (key, "createdAt"); -- legacy table
-- Unindexed foreign keys flagged by the Supabase performance advisor
CREATE INDEX IF NOT EXISTS idx_quizwinner_redemption ON public."QuizWinner" ("prizeRedemptionId");
CREATE INDEX IF NOT EXISTS idx_streammetrics_config ON public."StreamMetrics" ("streamConfigurationId");
CREATE INDEX IF NOT EXISTS idx_streamsession_config ON public."StreamSession" ("streamConfigurationId");

-- -----------------------------------------------------------------------------
-- 2. LOCK DOWN DIRECT TABLE ACCESS (the anon key is public — anything granted to
--    `authenticated` can be done from the browser console by any signed-in user)
-- -----------------------------------------------------------------------------
-- TRUNCATE bypasses RLS entirely; no client role should ever have it.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- 2a. User: users could read EVERY user's email/phone/DOB and write their own
--     walletBalance/points. All writes now go through the server (service role).
DROP POLICY IF EXISTS "User_select_unified" ON public."User";
DROP POLICY IF EXISTS "User_update_unified" ON public."User";
DROP POLICY IF EXISTS "User_select_own" ON public."User";
CREATE POLICY "User_select_own" ON public."User" FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid())::text);
REVOKE INSERT, UPDATE, DELETE ON public."User" FROM anon, authenticated;

-- 2b. Question: hide the answer key (correctOption) from clients.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public."Question" FROM anon, authenticated;
GRANT SELECT (id, "quizId", text, options, "hasCorrectAnswer", status, "createdAt", "updatedAt")
  ON public."Question" TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public."Quiz", public."Prize" FROM anon, authenticated;

-- 2c. Attempts / answers: users could rewrite their own score, isCorrect, isEvaluated.
DROP POLICY IF EXISTS "Answer_insert_own" ON public."Answer";
DROP POLICY IF EXISTS "Answer_update_own" ON public."Answer";
DROP POLICY IF EXISTS "Answer_delete_own" ON public."Answer";
DROP POLICY IF EXISTS "QuizAttempt_insert_own" ON public."QuizAttempt";
DROP POLICY IF EXISTS "QuizAttempt_update_own" ON public."QuizAttempt";
DROP POLICY IF EXISTS "QuestionAttempt_insert_own" ON public."QuestionAttempt";
DROP POLICY IF EXISTS "QuestionAttempt_update_own" ON public."QuestionAttempt";
REVOKE INSERT, UPDATE, DELETE ON public."Answer", public."QuizAttempt", public."QuestionAttempt" FROM anon, authenticated;

-- 2d. Payments / wallet: users could insert a 'completed' DailyPayment (free access)
--     or an 'approved' WalletTransaction for themselves.
DROP POLICY IF EXISTS "DailyPayment_insert_own" ON public."DailyPayment";
DROP POLICY IF EXISTS "DailyPayment_update_own" ON public."DailyPayment";
DROP POLICY IF EXISTS "Payment_insert_own" ON public."Payment";
DROP POLICY IF EXISTS "Payment_update_own" ON public."Payment";
DROP POLICY IF EXISTS "Payment_delete_own" ON public."Payment";
DROP POLICY IF EXISTS "WalletTransaction_authenticated" ON public."WalletTransaction";
DROP POLICY IF EXISTS "WalletTransaction_select_own" ON public."WalletTransaction";
CREATE POLICY "WalletTransaction_select_own" ON public."WalletTransaction" FOR SELECT TO authenticated
  USING ("userId" = (SELECT auth.uid())::text);
REVOKE INSERT, UPDATE, DELETE ON public."DailyPayment", public."Payment", public."WalletTransaction" FROM anon, authenticated;

-- 2e. Misc
DROP POLICY IF EXISTS "RateLimitEntry_anyone_select" ON public."RateLimitEntry";   -- leaked user ids / IPs
REVOKE ALL ON public."RateLimitEntry", public."SecurityEvent", public."AdminSession" FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public."Winning", public."StreamConfiguration", public."StreamMetrics",
  public."StreamSession" FROM anon, authenticated;
-- PrizeRedemption: creation goes through redeem_prize(); users may only read their own.
DROP POLICY IF EXISTS "PrizeRedemption_insert_combined" ON public."PrizeRedemption";
DROP POLICY IF EXISTS "PrizeRedemption_update_combined" ON public."PrizeRedemption";
DROP POLICY IF EXISTS "PrizeRedemption_delete_combined" ON public."PrizeRedemption";
REVOKE INSERT, UPDATE, DELETE ON public."PrizeRedemption" FROM anon, authenticated;
-- QuizWinner policy re-evaluated auth.uid() per row (performance advisor)
DROP POLICY IF EXISTS "QuizWinner user read own" ON public."QuizWinner";
CREATE POLICY "QuizWinner user read own" ON public."QuizWinner" FOR SELECT TO authenticated
  USING ("userId" = (SELECT auth.uid())::text);

-- -----------------------------------------------------------------------------
-- 3. QUIZ SUBMISSION — single round-trip, enforces the rules server-side
-- -----------------------------------------------------------------------------
-- Old version trusted the caller: no payment check, no quiz-status check, allowed
-- answering questions that already had a published correct answer, allowed
-- CHANGING a previous prediction (ON CONFLICT DO UPDATE), and was callable
-- directly from the browser, bypassing every API check.
CREATE OR REPLACE FUNCTION private_hardened.submit_quiz_attempt(
  p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  IF v_uid IS NULL OR p_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'forbidden', 'error', 'Permission denied');
  END IF;
  IF jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) = 0 OR jsonb_array_length(p_answers) > 200 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid answers payload');
  END IF;

  SELECT id, status INTO v_quiz FROM "Quiz" WHERE id = p_quiz_id;
  IF NOT FOUND OR v_quiz.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Quiz not found or inactive');
  END IF;

  SELECT id INTO v_payment_id FROM "DailyPayment"
   WHERE "userId" = v_uid AND status = 'completed' AND "expiresAt" > now()
   ORDER BY "expiresAt" DESC LIMIT 1;
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'payment_required', 'error', 'No active payment found. Please make a payment to access quizzes.');
  END IF;

  -- Every answer must reference an active, not-yet-revealed question of this quiz,
  -- with a sane option index, and appear only once.
  SELECT count(*), count(q.id) INTO v_total, v_valid
    FROM jsonb_to_recordset(p_answers) AS a("questionId" text, "selectedOption" int)
    LEFT JOIN "Question" q ON q.id = a."questionId" AND q."quizId" = p_quiz_id
         AND q.status = 'active' AND q."hasCorrectAnswer" = false
         AND a."selectedOption" BETWEEN 0 AND 9;
  IF v_valid <> v_total OR v_total <> (SELECT count(DISTINCT e->>'questionId') FROM jsonb_array_elements(p_answers) e) THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid or closed question IDs in submission');
  END IF;

  -- Serialise concurrent submits from the same user for the same quiz.
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

  -- Predictions are final: only questions not answered before are recorded.
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
END $$;

-- The legacy loop-based submit_quiz() creates a NEW attempt per call; retire it.
REVOKE EXECUTE ON FUNCTION public.submit_quiz(text, text, jsonb, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION private_hardened.submit_quiz(text, text, jsonb, text) FROM authenticated;

-- -----------------------------------------------------------------------------
-- 4. PAYMENTS — atomic, price decided by the server
-- -----------------------------------------------------------------------------
-- Replaces deductForQuizAccess(), which took the amount FROM THE CLIENT (a user could
-- pay 0.01 PKR) and wrote balance / transaction / access in 3 separate requests.
CREATE OR REPLACE FUNCTION public.pay_quiz_access(p_quiz_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.pay_quiz_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_quiz_access(text) TO authenticated;

-- Deposit requests: the app calls this with 4 args (incl. p_proof_image) but only a
-- 3-arg SECURITY INVOKER version existed, so deposits failed. Always 'pending'.
DROP FUNCTION IF EXISTS public.submit_deposit_request(double precision, text, text);
CREATE OR REPLACE FUNCTION public.submit_deposit_request(
  p_amount double precision, p_payment_method text, p_transaction_id text, p_proof_image text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid text := auth.uid()::text;
  v_new_id text := gen_random_uuid()::text;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('success', false, 'error', 'Not authenticated'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid amount');
  END IF;
  IF coalesce(length(trim(p_transaction_id)), 0) < 4 OR length(p_transaction_id) > 100 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid transaction ID');
  END IF;
  IF (SELECT count(*) FROM "WalletTransaction" WHERE "userId" = v_uid AND status = 'pending') >= 5 THEN
    RETURN json_build_object('success', false, 'error', 'Too many pending deposit requests');
  END IF;
  INSERT INTO "WalletTransaction" (id, "userId", amount, "paymentMethod", "transactionId", status, type,
                                   "proofImage", "createdAt", "updatedAt")
  VALUES (v_new_id, v_uid, p_amount, left(p_payment_method, 50), trim(p_transaction_id), 'pending', 'deposit',
          p_proof_image, now(), now());
  RETURN json_build_object('success', true, 'id', v_new_id);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('success', false, 'error', 'Transaction ID already exists');
END $$;
REVOKE ALL ON FUNCTION public.submit_deposit_request(double precision, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_deposit_request(double precision, text, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. EVALUATION — set-based, one statement per step (was: 1 UPDATE per attempt
--    plus `IN (...)` lists of every answer id, which breaks past ~1,000 rows)
-- -----------------------------------------------------------------------------
-- Evaluation is split into small statements so that each API call stays well under
-- the statement timeout even with 50k+ attempts (measured locally: ~2-4 s per
-- question and ~2.4 s for the final scoring pass at 50k attempts / 1M answers).
CREATE OR REPLACE FUNCTION public.evaluate_question(p_question_id text, p_correct_option int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.finalize_quiz_scores(p_quiz_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

REVOKE ALL ON FUNCTION public.evaluate_question(text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_quiz_scores(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_question(text, int), public.finalize_quiz_scores(text) TO service_role;

-- Attempt counts for the quiz list (called with the service role; RLS would
-- otherwise make every user see "1 attempt").
GRANT EXECUTE ON FUNCTION public.get_quiz_attempt_counts_by_quiz(text[]) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. LEADERBOARD — precomputed; the live query scans every Answer row
--    (measured ~1.3 s per call with 50k users / 3.1M answers on a laptop)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_leaderboard(p_timeframe text, p_limit int, p_quiz_id text)
RETURNS TABLE(id text, "userName" text, "profilePicture" text, "quizzesTaken" integer, "correctAnswers" integer,
              "totalScore" integer, "winCount" integer, "averageScore" integer, rank integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE ALL ON FUNCTION public.compute_leaderboard(text, int, text) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public."LeaderboardCache" (
  timeframe text NOT NULL,
  rank int NOT NULL,
  row jsonb NOT NULL,
  "refreshedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (timeframe, rank)
);
ALTER TABLE public."LeaderboardCache" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."LeaderboardCache" FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_leaderboard_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tf text;
BEGIN
  FOREACH tf IN ARRAY ARRAY['allTime', 'weekly', 'monthly'] LOOP
    DELETE FROM "LeaderboardCache" WHERE timeframe = tf;
    INSERT INTO "LeaderboardCache" (timeframe, rank, row)
    SELECT tf, l.rank, to_jsonb(l) FROM public.compute_leaderboard(tf, 100, NULL) l;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.refresh_leaderboard_cache() FROM PUBLIC, anon, authenticated;

-- Same signature as before so existing callers keep working. Reads the cache for the
-- common case (no quiz filter, limit <= 100, cache younger than 10 minutes).
CREATE OR REPLACE FUNCTION public.get_leaderboard(p_timeframe text DEFAULT 'allTime', p_limit integer DEFAULT 10, p_quiz_id text DEFAULT NULL)
RETURNS TABLE(id text, "userName" text, "profilePicture" text, "quizzesTaken" integer, "correctAnswers" integer,
              "totalScore" integer, "winCount" integer, "averageScore" integer, rank integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tf text := CASE WHEN p_timeframe IN ('weekly', 'monthly') THEN p_timeframe ELSE 'allTime' END;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
BEGIN
  IF p_quiz_id IS NULL AND EXISTS (
       SELECT 1 FROM "LeaderboardCache" WHERE timeframe = v_tf AND "refreshedAt" > now() - interval '10 minutes') THEN
    RETURN QUERY
      SELECT (c.row->>'id'), (c.row->>'userName'), (c.row->>'profilePicture'), (c.row->>'quizzesTaken')::int,
             (c.row->>'correctAnswers')::int, (c.row->>'totalScore')::int, (c.row->>'winCount')::int,
             (c.row->>'averageScore')::int, c.rank
        FROM "LeaderboardCache" c WHERE c.timeframe = v_tf AND c.rank <= v_limit ORDER BY c.rank;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.compute_leaderboard(v_tf, v_limit, p_quiz_id);
END $$;
REVOKE ALL ON FUNCTION public.get_leaderboard(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(text, integer, text) TO service_role;

COMMIT;

-- -----------------------------------------------------------------------------
-- 7. SCHEDULE (run once, outside the transaction). Requires the pg_cron extension:
--    Dashboard -> Database -> Extensions -> pg_cron.
-- -----------------------------------------------------------------------------
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('refresh-leaderboard', '*/5 * * * *', $$SELECT public.refresh_leaderboard_cache()$$);
-- SELECT cron.schedule('purge-rate-limit-entries', '17 * * * *', $$DELETE FROM public."RateLimitEntry" WHERE "createdAt" < now() - interval '1 day'$$);
-- SELECT public.refresh_leaderboard_cache();
