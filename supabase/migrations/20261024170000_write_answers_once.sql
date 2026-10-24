-- =============================================================================
-- Write each answer once, score from the answer key, rank by correct answers, count entries
--
-- NOT applied to production yet. Order: apply 20261024150000_atomic_quiz_saves first (this replaces its
-- save_quiz_result), DEPLOY PR #64's CODE, and only then apply this migration.
--   - From this migration on, new answers are written to "QuestionAttempt" only. Code from before PR #64
--     shows players' answers from "Answer" (results page, profile history, admin question stats), so
--     applied before that code is live it would show nothing for every answer given since.
--   - PR #64's code works on the database as it is before this migration: submit_quiz_attempt already
--     writes every answer to "QuestionAttempt" (checked on production on 2026-10-24: 15 answers, all with
--     an identical "QuestionAttempt" row), and nothing in it needs the objects added here.
--
-- 1. submit_quiz_attempt wrote every answer twice, to "QuestionAttempt" and "Answer". The staging
--    benchmark (load-test/PROJECT_HANDLING_REPORT.md, section 4) put the second write at 40-70% of a
--    submit. Answers now go to "QuestionAttempt" only; "Answer" keeps its older rows, which PR #64's code
--    no longer reads.
-- 2. Scores are computed from the answer key with one set-based statement, and saving a result stamps
--    "isCorrect" on one table in one UPDATE instead of two tables, question by question. Only active
--    questions count, as in the total: a correct answer to a question paused later used to count too,
--    which could put a score above 100.
-- 3. A score is round(100 * correct / questions), so above 100 questions two different numbers of
--    correct answers could share a score (and 1 of 201 rounded to 0, which took no place). Each attempt
--    now stores its "correctAnswers", and settle_quiz ranks by it. Up to 100 questions the order and
--    the ties are exactly as before.
-- 4. The entry limit counted every attempt of the quiz (count(*)) for each new player, under a per-quiz
--    lock, so admitting got slower with every entrant. A counter ("QuizEntryCount"), kept exact by
--    triggers on "QuizAttempt", makes the check constant-time.
--
-- Only the service role can call the functions. Not safe to re-run: the guard below stops a second run.
-- =============================================================================

-- ── 0. Refuse to run if a function replaced below changed since this migration was written ──────
-- Each is re-created from the copy in db-tests/schema, which matched production on 2026-10-24
-- (whitespace-insensitive md5 of the body). A change made to production since then would be silently
-- undone, so the migration stops instead: merge that change into this file and update the fingerprint.
DO $guard$
DECLARE
  v_expected constant jsonb := jsonb_build_object(
    'private_hardened.submit_quiz_attempt(text,text,jsonb,text)', 'cacd2202672253df10dcfa3d3fafb8c7',
    'public.evaluate_question(text,integer)', 'b242dd69971ffe85d753774c5a609cb0',
    'public.finalize_quiz_scores(text)', '5d0f4a8981ea5baa87c8685a6d04f55f',
    'public.compute_leaderboard(text,integer,text)', '7506a3fc2dd581471c10ed99b513bc2a',
    'public.settle_quiz(text,jsonb,text,text,text,boolean,numeric)', 'cf25d2d9ad96f806363d7f0385b2c962');
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
END $guard$;

-- ── 1. Every answer in "QuestionAttempt" ─────────────────────────────────────────────────────────
-- submit_quiz_attempt always wrote both rows, so this should find nothing; it makes sure.
INSERT INTO public."QuestionAttempt" (id, "userId", "questionId", "quizId", "selectedOption", "isCorrect", "attemptedAt", "createdAt")
SELECT 'qat_' || gen_random_uuid()::text, a."userId", a."questionId", q."quizId", a."selectedOption", a."isCorrect",
       a."createdAt", a."createdAt" AT TIME ZONE 'UTC'
  FROM public."Answer" a
  JOIN public."Question" q ON q.id = a."questionId"
 WHERE NOT EXISTS (SELECT 1 FROM public."QuestionAttempt" x WHERE x."userId" = a."userId" AND x."questionId" = a."questionId")
ON CONFLICT ("userId", "questionId") DO NOTHING;

-- The leaderboard counts each player's correct answers from here now (it used the same index on "Answer")
CREATE INDEX IF NOT EXISTS idx_questionattempt_user_correct ON public."QuestionAttempt" USING btree ("userId", "createdAt") WHERE "isCorrect";

-- ── 2. Correct answers per attempt ───────────────────────────────────────────────────────────────
ALTER TABLE public."QuizAttempt" ADD COLUMN IF NOT EXISTS "correctAnswers" integer NOT NULL DEFAULT 0;

-- Attempts already scored get their count; the others get it when they are scored
UPDATE public."QuizAttempt" t SET "correctAnswers" = s.correct
  FROM (SELECT qa."userId", qa."quizId",
               count(*) FILTER (WHERE q.status = 'active' AND q."hasCorrectAnswer" AND qa."selectedOption" = q."correctOption")::int AS correct
          FROM public."QuestionAttempt" qa JOIN public."Question" q ON q.id = qa."questionId"
         GROUP BY qa."userId", qa."quizId") s
 WHERE t."userId" = s."userId" AND t."quizId" = s."quizId" AND t."isEvaluated" AND t."correctAnswers" <> s.correct;

-- ── 3. Entry counter ─────────────────────────────────────────────────────────────────────────────
-- Its own table, not a column of "QuizAdminSettings": save_quiz writes that row while holding locks on
-- the quiz's questions, and a first entry holds this row while its answers reference those questions.
CREATE TABLE IF NOT EXISTS public."QuizEntryCount" (
  "quizId" text PRIMARY KEY REFERENCES public."Quiz"(id) ON DELETE CASCADE,
  entries integer NOT NULL DEFAULT 0 CHECK (entries >= 0)
);
ALTER TABLE public."QuizEntryCount" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."QuizEntryCount" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public."QuizEntryCount" TO service_role;

-- Every insert and delete of attempts, whoever makes it, moves the counter by the rows it touched
CREATE OR REPLACE FUNCTION private_hardened.count_quiz_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "QuizEntryCount" ("quizId", entries)
    SELECT "quizId", count(*) FROM new_rows GROUP BY "quizId"
    ON CONFLICT ("quizId") DO UPDATE SET entries = "QuizEntryCount".entries + EXCLUDED.entries;
  ELSE
    UPDATE "QuizEntryCount" c SET entries = GREATEST(0, c.entries - d.n)
      FROM (SELECT "quizId", count(*)::int AS n FROM old_rows GROUP BY "quizId") d
     WHERE c."quizId" = d."quizId";
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION private_hardened.count_quiz_entries() FROM PUBLIC;

DROP TRIGGER IF EXISTS count_quiz_entries_insert ON public."QuizAttempt";
CREATE TRIGGER count_quiz_entries_insert AFTER INSERT ON public."QuizAttempt"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private_hardened.count_quiz_entries();
DROP TRIGGER IF EXISTS count_quiz_entries_delete ON public."QuizAttempt";
CREATE TRIGGER count_quiz_entries_delete AFTER DELETE ON public."QuizAttempt"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private_hardened.count_quiz_entries();

-- Start from the real counts. The triggers above already hold "QuizAttempt" against inserts until this
-- migration commits, so no entry can slip between the count and the triggers.
INSERT INTO public."QuizEntryCount" ("quizId", entries)
SELECT "quizId", count(*) FROM public."QuizAttempt" GROUP BY "quizId"
ON CONFLICT ("quizId") DO UPDATE SET entries = EXCLUDED.entries;

-- ── 4. submit_quiz_attempt: one write per answer, and the counter for the entry limit ───────────
-- Same signature, checks and answers as before (CREATE OR REPLACE keeps the grants).
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
  v_entries int;
BEGIN
  IF v_uid IS NULL OR p_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'forbidden', 'error', 'Permission denied');
  END IF;
  IF jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) = 0 OR jsonb_array_length(p_answers) > 200 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid answers payload');
  END IF;

  -- KEY SHARE (which the attempt's foreign key takes anyway) taken first: deleting the quiz waits for
  -- this submit instead of locking the quiz and then waiting for the entry counter this submit holds
  SELECT id, status, duration, "pushedAt" INTO v_quiz FROM "Quiz" WHERE id = p_quiz_id FOR KEY SHARE;
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
    -- First come, first served. The quiz's entry counter row, locked (always after the per-player lock
    -- above, so the two can't deadlock), makes checking and inserting one step, so the limit holds in a
    -- herd. The attempt's insert trigger moves the counter.
    INSERT INTO "QuizEntryCount" ("quizId") VALUES (p_quiz_id) ON CONFLICT ("quizId") DO NOTHING;
    SELECT entries INTO v_entries FROM "QuizEntryCount" WHERE "quizId" = p_quiz_id FOR UPDATE;
    IF v_entries >= private_hardened.quiz_entry_limit(p_quiz_id) THEN
      RETURN jsonb_build_object('success', false, 'code', 'entries_closed', 'error', 'Entries for this quiz have closed.');
    END IF;
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
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

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
END $function$;

-- ── 5. Results and scores ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evaluate_question(p_question_id text, p_correct_option integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_qattempts int;
BEGIN
  UPDATE "Question" SET "correctOption" = p_correct_option, "hasCorrectAnswer" = true, "updatedAt" = now()
   WHERE id = p_question_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Question not found');
  END IF;

  UPDATE "QuestionAttempt" qa SET "isCorrect" = (qa."selectedOption" = p_correct_option)
   WHERE qa."questionId" = p_question_id
     AND qa."isCorrect" IS DISTINCT FROM (qa."selectedOption" = p_correct_option);
  GET DIAGNOSTICS v_qattempts = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'questionAttemptsUpdated', v_qattempts);
END $function$;

-- Scores every attempt of the quiz from the answer key in one statement: correct answers to active
-- questions, out of the active questions. (Before, correct answers to paused questions counted too.)
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
    SELECT qa."userId",
           count(*) FILTER (WHERE q.status = 'active' AND q."hasCorrectAnswer" AND qa."selectedOption" = q."correctOption")::int AS correct
      FROM "QuestionAttempt" qa JOIN "Question" q ON q.id = qa."questionId"
     WHERE qa."quizId" = p_quiz_id
     GROUP BY qa."userId")
  UPDATE "QuizAttempt" t
     SET score = round(100.0 * s.correct / v_total_questions)::int, "correctAnswers" = s.correct,
         "isEvaluated" = true, "updatedAt" = now()
    FROM s
   WHERE t."quizId" = p_quiz_id AND t."userId" = s."userId";
  GET DIAGNOSTICS v_evaluated = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'evaluatedAttempts', v_evaluated, 'totalQuestions', v_total_questions);
END $function$;

-- Replaces the 20261024150000 version: every key, every answer's "isCorrect" and the scores, each in
-- one statement instead of question by question. Still one transaction.
CREATE OR REPLACE FUNCTION public.save_quiz_result(p_quiz_id text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_active int;
  v_matched int;
  v_sent int;
BEGIN
  IF jsonb_typeof(p_answers) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'The result must give the correct option of every question');
  END IF;
  SELECT count(*) INTO v_active FROM "Question" WHERE "quizId" = p_quiz_id AND status = 'active';
  SELECT count(*) INTO v_sent FROM jsonb_object_keys(p_answers);
  SELECT count(*) INTO v_matched
    FROM jsonb_each_text(p_answers) a
    JOIN "Question" q ON q.id = a.key AND q."quizId" = p_quiz_id AND q.status = 'active';
  IF v_active = 0 OR v_matched <> v_active OR v_sent <> v_active THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'The result must give the correct option of every question');
  END IF;

  UPDATE "Question" q SET "correctOption" = a.value::int, "hasCorrectAnswer" = true, "updatedAt" = now()
    FROM jsonb_each_text(p_answers) a
   WHERE q.id = a.key AND q."quizId" = p_quiz_id;

  UPDATE "QuestionAttempt" qa SET "isCorrect" = (qa."selectedOption" = q."correctOption")
    FROM "Question" q
   WHERE qa."quizId" = p_quiz_id AND q.id = qa."questionId" AND q."hasCorrectAnswer"
     AND qa."isCorrect" IS DISTINCT FROM (qa."selectedOption" = q."correctOption");

  PERFORM public.finalize_quiz_scores(p_quiz_id);
  RETURN jsonb_build_object('success', true);
END $function$;
REVOKE ALL ON FUNCTION public.save_quiz_result(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_quiz_result(text, jsonb) TO service_role;

-- ── 6. Leaderboard: correct answers from "QuestionAttempt" ───────────────────────────────────────
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
         (SELECT count(*)::int FROM "QuestionAttempt" a, f
           WHERE a."userId" = t."userId" AND a."isCorrect" AND (f.since IS NULL OR a."createdAt" >= f.since)),
         t.total_score,
         ((SELECT count(*) FROM "Winning" w, f WHERE w."userId" = t."userId" AND (f.since IS NULL OR w."createdAt" >= f.since))
          + (SELECT count(*) FROM "PrizeRedemption" pr WHERE pr."userId" = t."userId" AND pr.status IN ('pending','approved','fulfilled')))::int,
         t.avg_score,
         (row_number() OVER (ORDER BY t.total_score DESC, t.avg_score DESC, t.quizzes_taken DESC))::int
    FROM top t JOIN "User" u ON u.id = t."userId"
   ORDER BY 9;
$function$;

-- ── 7. settle_quiz: rank by correct answers ──────────────────────────────────────────────────────
-- Same as the 20261022120000 version, except that placings, ties and the pool use "correctAnswers"
-- (filled by finalize_quiz_scores just before) instead of the rounded score, and each winner reports
-- its correct answers too. Up to 100 questions both orders are the same.
CREATE OR REPLACE FUNCTION public.settle_quiz(
  p_quiz_id text, p_rewards jsonb, p_tie_rule text, p_seed text, p_settled_by text,
  p_dry_run boolean DEFAULT false, p_pool_percent numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quiz record;
  v_total int;
  v_missing int;
  v_participants int;
  v_reward jsonb;
  v_rank int;
  v_points int;
  v_prize_id text;
  v_prize_name text;
  v_prize_category text;
  v_prize_active boolean;
  v_prize_stock int;
  v_winner record;
  v_method text;
  v_ranks int[] := '{}';
  v_winners jsonb := '[]'::jsonb;
  v_unfilled jsonb := '[]'::jsonb;
  v_result jsonb;
  v_pool_size int;
  v_pool_target int := 0;
  v_places int := 0;
  v_eligible int;
  v_pool jsonb;
BEGIN
  BEGIN
    IF p_tie_rule IS NULL OR p_tie_rule NOT IN ('random', 'earliest') THEN
      RAISE EXCEPTION '%', 'invalid:Unknown tie rule';
    END IF;
    IF p_seed IS NULL OR length(p_seed) < 16 THEN
      RAISE EXCEPTION '%', 'invalid:A draw seed of at least 16 characters is required';
    END IF;
    IF p_settled_by IS NULL OR p_settled_by = '' THEN
      RAISE EXCEPTION '%', 'invalid:Who settled the quiz is required';
    END IF;
    IF p_rewards IS NULL OR jsonb_typeof(p_rewards) <> 'array' OR jsonb_array_length(p_rewards) > 3 THEN
      RAISE EXCEPTION '%', 'invalid:Rewards must be a list of up to three places';
    END IF;
    IF p_pool_percent IS NULL OR p_pool_percent < 0 OR p_pool_percent > 100 OR p_pool_percent <> round(p_pool_percent, 2) THEN
      RAISE EXCEPTION '%', 'invalid:The pool percentage must be 0 to 100, with at most two decimals';
    END IF;

    SELECT id, title INTO v_quiz FROM "Quiz" WHERE id = p_quiz_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%', 'not_found:Quiz not found';
    END IF;
    IF EXISTS (SELECT 1 FROM "QuizSettlement" WHERE "quizId" = p_quiz_id) THEN
      RAISE EXCEPTION '%', 'already_settled:This quiz has already been settled';
    END IF;

    v_pool_size := coalesce((SELECT "pointsPool" FROM "QuizAdminSettings" WHERE "quizId" = p_quiz_id), 0);
    IF p_pool_percent > 0 AND v_pool_size = 0 THEN
      RAISE EXCEPTION '%', 'invalid:This quiz has no points pool. Set one on the quiz first';
    END IF;

    SELECT count(*), count(*) FILTER (WHERE NOT "hasCorrectAnswer") INTO v_total, v_missing
      FROM "Question" WHERE "quizId" = p_quiz_id AND status = 'active';
    IF v_total = 0 THEN
      RAISE EXCEPTION '%', 'invalid:This quiz has no active questions';
    END IF;
    IF v_missing > 0 THEN
      RAISE EXCEPTION '%', 'result_missing:Save the result for every question before settling';
    END IF;

    PERFORM public.finalize_quiz_scores(p_quiz_id);
    SELECT count(*), count(*) FILTER (WHERE "correctAnswers" > 0) INTO v_participants, v_eligible
      FROM "QuizAttempt" WHERE "quizId" = p_quiz_id AND "isCompleted";

    FOR v_reward IN
      SELECT value FROM jsonb_array_elements(p_rewards) ORDER BY (value->>'rank')::int NULLS FIRST
    LOOP
      v_rank := (v_reward->>'rank')::int;
      v_points := NULLIF(v_reward->>'points', '')::int;
      v_prize_id := NULLIF(v_reward->>'prizeId', '');
      v_prize_name := NULL;
      v_prize_category := NULL;
      IF v_rank IS NULL OR v_rank NOT BETWEEN 1 AND 3 OR v_rank = ANY (v_ranks) THEN
        RAISE EXCEPTION '%', 'invalid:Each place (1st, 2nd, 3rd) can have one reward';
      END IF;
      IF (v_points IS NULL) = (v_prize_id IS NULL) OR (v_points IS NOT NULL AND v_points NOT BETWEEN 1 AND 100000) THEN
        RAISE EXCEPTION '%', 'invalid:Each reward is either points (1 to 100,000) or one prize';
      END IF;
      v_ranks := v_ranks || v_rank;

      SELECT r.* INTO v_winner FROM (
        SELECT t.id AS attempt_id, t."userId" AS user_id, t.score, t."correctAnswers" AS correct,
               t."completedAt" AS completed_at, u.name, u.email,
               (count(*) OVER (PARTITION BY t."correctAnswers")) - 1 AS tied_with,
               row_number() OVER (
                 ORDER BY t."correctAnswers" DESC,
                          CASE WHEN p_tie_rule = 'earliest' THEN t."createdAt" END ASC,
                          CASE WHEN p_tie_rule = 'random' THEN md5(p_seed || ':' || t."userId") END ASC,
                          t.id ASC) AS place
          FROM "QuizAttempt" t
          JOIN "User" u ON u.id = t."userId"
         WHERE t."quizId" = p_quiz_id AND t."isCompleted" AND t."correctAnswers" > 0) r
       WHERE r.place = v_rank;
      IF NOT FOUND THEN
        -- Fewer players scored than there are rewarded places
        v_unfilled := v_unfilled || to_jsonb(v_rank);
        CONTINUE;
      END IF;

      v_method := CASE WHEN v_winner.tied_with > 0 THEN 'ranked_' || p_tie_rule || '_tiebreak' ELSE 'ranked' END;

      IF v_prize_id IS NOT NULL THEN
        SELECT name, category, "isActive", stock INTO v_prize_name, v_prize_category, v_prize_active, v_prize_stock
          FROM "Prize" WHERE id = v_prize_id FOR UPDATE;
        IF NOT FOUND OR NOT v_prize_active THEN
          RAISE EXCEPTION '%', 'invalid:A chosen prize is no longer available';
        END IF;
        IF v_prize_stock <= 0 THEN
          RAISE EXCEPTION '%', 'out_of_stock:' || v_prize_name || ' is out of stock';
        END IF;
        UPDATE "Prize" SET stock = stock - 1, "updatedAt" = now() WHERE id = v_prize_id;
      ELSE
        PERFORM public.increment_user_points(v_winner.user_id, v_points);
        UPDATE "QuizAttempt" SET points = v_points, "updatedAt" = now() WHERE id = v_winner.attempt_id;
      END IF;

      INSERT INTO "QuizWinner" (id, "quizId", "prizeId", "userId", score, "completedAt", "selectionMethod",
                                "selectedBy", seed, rank, "pointsAwarded")
      VALUES (gen_random_uuid()::text, p_quiz_id, v_prize_id, v_winner.user_id, v_winner.score,
              v_winner.completed_at AT TIME ZONE 'UTC', v_method, p_settled_by, p_seed, v_rank, coalesce(v_points, 0));

      v_winners := v_winners || jsonb_build_object(
        'rank', v_rank, 'userId', v_winner.user_id, 'name', v_winner.name, 'email', v_winner.email,
        'score', v_winner.score, 'correctAnswers', v_winner.correct, 'tiedWith', v_winner.tied_with,
        'selectionMethod', v_method, 'points', v_points, 'prizeId', v_prize_id, 'prizeName', v_prize_name,
        'prizeCategory', v_prize_category);
    END LOOP;

    -- The pool: the whole pointsPool, in random shares, for the earliest scorers filling the places
    IF p_pool_percent > 0 THEN
      v_places := ceil(v_participants * p_pool_percent / 100)::int;
      v_pool_target := v_pool_size;
      WITH eligible AS (
        SELECT e.id AS attempt_id, e."userId" AS user_id,
               (('x' || left(md5(p_seed || ':pool:' || e."userId"), 12))::bit(48)::bigint + 1)::numeric AS w,
               md5(p_seed || ':pool-order:' || e."userId") AS tiebreak
          FROM "QuizAttempt" e
         WHERE e."quizId" = p_quiz_id AND e."isCompleted" AND e."correctAnswers" > 0
         ORDER BY e."createdAt", e.id
         LIMIT v_places
      ), exact AS (
        SELECT *, v_pool_target * w / sum(w) OVER () AS share FROM eligible
      ), rounded AS (
        SELECT *, floor(share)::int AS base,
               v_pool_target - sum(floor(share)) OVER () AS leftover,
               row_number() OVER (ORDER BY share - floor(share) DESC, tiebreak) AS place
          FROM exact
      )
      INSERT INTO "QuizPoolShare" ("quizId", "userId", "attemptId", points)
      SELECT p_quiz_id, user_id, attempt_id, base + CASE WHEN place <= leftover THEN 1 ELSE 0 END
        FROM rounded
       WHERE base + CASE WHEN place <= leftover THEN 1 ELSE 0 END > 0;

      UPDATE "User" u SET points = u.points + s.points, "updatedAt" = now()
        FROM "QuizPoolShare" s WHERE s."quizId" = p_quiz_id AND u.id = s."userId";
      UPDATE "QuizAttempt" a SET points = a.points + s.points, "updatedAt" = now()
        FROM "QuizPoolShare" s WHERE s."quizId" = p_quiz_id AND a.id = s."attemptId";
    END IF;

    SELECT jsonb_build_object(
             'percent', p_pool_percent, 'poolSize', v_pool_size, 'target', v_pool_target, 'places', v_places,
             'paid', coalesce(sum(points), 0), 'eligible', v_eligible, 'recipients', count(*),
             'min', coalesce(min(points), 0), 'max', coalesce(max(points), 0),
             'recipientIds', coalesce(jsonb_agg("userId" ORDER BY "userId"), '[]'::jsonb))
      INTO v_pool FROM "QuizPoolShare" WHERE "quizId" = p_quiz_id;

    INSERT INTO "QuizSettlement" ("quizId", "settledBy", "tieRule", seed, rewards, "participantCount", "poolPercent", "poolPoints")
    VALUES (p_quiz_id, p_settled_by, p_tie_rule, p_seed, p_rewards, v_participants, p_pool_percent, (v_pool->>'paid')::int);

    v_result := jsonb_build_object(
      'success', true, 'quizId', p_quiz_id, 'quizTitle', v_quiz.title, 'participants', v_participants,
      'questions', v_total, 'tieRule', p_tie_rule, 'seed', p_seed, 'winners', v_winners, 'unfilled', v_unfilled,
      'pool', v_pool);

    IF p_dry_run THEN
      RAISE EXCEPTION '%', 'dry_run';
    END IF;
    RETURN v_result;
  EXCEPTION WHEN raise_exception THEN
    -- Every change above is rolled back. A dry run returns what it would have done.
    IF SQLERRM = 'dry_run' THEN
      RETURN v_result || jsonb_build_object('preview', true);
    END IF;
    RETURN jsonb_build_object('success', false,
      'code', split_part(SQLERRM, ':', 1),
      'error', substr(SQLERRM, strpos(SQLERRM, ':') + 1));
  END;
END $function$;
