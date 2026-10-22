-- =============================================================================
-- Quiz entry limit (first come, first served) and a points pool shared at settlement
--
-- NOT applied to any database yet. Needs the owner's approval for production (eclivawqhdovsndlngfo).
-- Apply it BEFORE deploying the code that reads QuizAdminSettings. The live build keeps working with
-- it: quizzes without settings get the default limit, and its settle call (six named arguments) still
-- reaches settle_quiz, whose new seventh argument has a default.
--
-- Why: the 2026-10-21 load test put a live quiz at about 2,000 players before Hostinger's site-wide
-- block. Each quiz now admits its first "maxEntries" players (default 2,000); later players are told
-- "Entries for this quiz have closed." Only those entrants can place, win a prize or get pool points.
-- The limit and the pool live in an admin-only table: signed-in players can read every column of
-- "Quiz" through the API (policy Quiz_select_auth is USING (true)), so they must not be columns there.
--
-- Settlement can also pay out the quiz's points pool, on top of the 1st-3rd place rewards: the whole
-- pool, in random amounts, to the earliest p_pool_percent of the entrants (first come, first served,
-- counting only entrants who scored above 0). The amounts come from the stored draw seed, so a
-- preview and the settle that follows pay exactly the same.
-- =============================================================================

-- ── 0. Refuse to run if a function replaced below changed since this migration was written ──────
-- submit_quiz_attempt and settle_quiz are re-created from the copies in db-tests/schema, which matched
-- production on 2026-10-22 (whitespace-insensitive md5 of the body). A change made to production since
-- then would be silently undone, so the migration stops instead: merge that change into this file and
-- update the fingerprint. Running the migration a second time stops here too.
DO $guard$
DECLARE
  v_submit text;
  v_settle text;
BEGIN
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_submit FROM pg_proc
   WHERE oid = to_regprocedure('private_hardened.submit_quiz_attempt(text,text,jsonb,text)');
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_settle FROM pg_proc
   WHERE oid = to_regprocedure('public.settle_quiz(text,jsonb,text,text,text,boolean)');
  IF v_submit IS DISTINCT FROM '3a93527bd73b98f71f7a7e7b91651621' THEN
    RAISE EXCEPTION 'private_hardened.submit_quiz_attempt is not the version this migration was written against (body md5 %): merge the change into the migration first', coalesce(v_submit, 'missing');
  END IF;
  IF v_settle IS DISTINCT FROM 'ae6ed12f7deed19d8b2384e9653bf0cc' THEN
    RAISE EXCEPTION 'public.settle_quiz(6 arguments) is not the version this migration was written against (body md5 %): merge the change into the migration first', coalesce(v_settle, 'missing');
  END IF;
END $guard$;

-- ── 1. Admin-only settings per quiz ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."QuizAdminSettings" (
  "quizId" text PRIMARY KEY REFERENCES public."Quiz"(id) ON DELETE CASCADE,
  "maxEntries" integer NOT NULL DEFAULT 2000 CHECK ("maxEntries" BETWEEN 1 AND 100000),
  "pointsPool" integer NOT NULL DEFAULT 0 CHECK ("pointsPool" BETWEEN 0 AND 10000000),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public."QuizAdminSettings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."QuizAdminSettings" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."QuizAdminSettings" TO service_role;

-- Every quiz that exists now gets its limit written down, so admins see it on the quiz form and the
-- Settle screen. No quiz starts out over its limit: one that already has more players keeps that many.
INSERT INTO public."QuizAdminSettings" ("quizId", "maxEntries")
SELECT q.id, LEAST(100000, GREATEST(2000, (SELECT count(*) FROM public."QuizAttempt" a WHERE a."quizId" = q.id)))::int
  FROM public."Quiz" q
ON CONFLICT ("quizId") DO NOTHING;

-- The limit for a quiz: its setting, or 2,000 when none was saved (every quiz made before this)
CREATE OR REPLACE FUNCTION private_hardened.quiz_entry_limit(p_quiz_id text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT "maxEntries" FROM "QuizAdminSettings" WHERE "quizId" = p_quiz_id), 2000);
$function$;
REVOKE ALL ON FUNCTION private_hardened.quiz_entry_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_hardened.quiz_entry_limit(text) TO service_role;

-- ── 2. Pool shares paid at settlement, and what the settlement used ─────────────────────────────
CREATE TABLE IF NOT EXISTS public."QuizPoolShare" (
  "quizId" text NOT NULL REFERENCES public."Quiz"(id) ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  "attemptId" text NOT NULL REFERENCES public."QuizAttempt"(id) ON DELETE CASCADE,
  points integer NOT NULL CHECK (points > 0),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("quizId", "userId")
);
ALTER TABLE public."QuizPoolShare" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."QuizPoolShare" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public."QuizPoolShare" TO service_role;

ALTER TABLE public."QuizSettlement" ADD COLUMN IF NOT EXISTS "poolPercent" numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public."QuizSettlement" ADD COLUMN IF NOT EXISTS "poolPoints" integer NOT NULL DEFAULT 0;

-- ── 3. submit_quiz_attempt: admit a new player only while the quiz has room ─────────────────────
-- Same signature, checks and writes as before (CREATE OR REPLACE keeps the grants). A player who
-- already entered can still answer questions added later, even once the quiz is full.
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
    -- First come, first served. The per-quiz lock (always taken after the per-player one above, so
    -- the two can't deadlock) makes counting and inserting one step, so the limit holds in a herd.
    PERFORM pg_advisory_xact_lock(hashtext('quiz-entries:' || p_quiz_id));
    IF (SELECT count(*) FROM "QuizAttempt" WHERE "quizId" = p_quiz_id) >= private_hardened.quiz_entry_limit(p_quiz_id) THEN
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
END $function$;

-- ── 4. settle_quiz: plus an optional random share of the points pool ────────────────────────────
-- A seventh argument means a new signature: drop the old one so there is a single overload (two
-- overloads that both match a call make PostgREST answer HTTP 300). Old six-argument calls still
-- work through the default.
DROP FUNCTION IF EXISTS public.settle_quiz(text, jsonb, text, text, text, boolean);

-- Entrants are every player submit_quiz_attempt admitted: the limit only turns new players away, so
-- lowering it later never takes a place, a prize or pool points from someone who was told their answer
-- was locked in. Placings consider only entrants who scored above 0. The pool goes to "places" = p_pool_percent (0 to 100,
-- two decimals) of the entrants, rounded up so any percentage above 0 pays someone; the places are
-- filled by the earliest entrants who scored above 0 (a zero score takes no place). The quiz's whole
-- pointsPool is split among them by random weights from md5(seed:pool:userId); each share is rounded
-- down and the points left over go one each to the largest remainders, so the shares add up exactly.
-- The pool is paid after the placings, so a placed player's attempt keeps both.
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
    SELECT count(*), count(*) FILTER (WHERE score > 0) INTO v_participants, v_eligible
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
        SELECT t.id AS attempt_id, t."userId" AS user_id, t.score, t."completedAt" AS completed_at,
               u.name, u.email,
               (count(*) OVER (PARTITION BY t.score)) - 1 AS tied_with,
               row_number() OVER (
                 ORDER BY t.score DESC,
                          CASE WHEN p_tie_rule = 'earliest' THEN t."createdAt" END ASC,
                          CASE WHEN p_tie_rule = 'random' THEN md5(p_seed || ':' || t."userId") END ASC,
                          t.id ASC) AS place
          FROM "QuizAttempt" t
          JOIN "User" u ON u.id = t."userId"
         WHERE t."quizId" = p_quiz_id AND t."isCompleted" AND t.score > 0) r
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
        'score', v_winner.score, 'tiedWith', v_winner.tied_with, 'selectionMethod', v_method,
        'points', v_points, 'prizeId', v_prize_id, 'prizeName', v_prize_name, 'prizeCategory', v_prize_category);
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
         WHERE e."quizId" = p_quiz_id AND e."isCompleted" AND e.score > 0
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
REVOKE ALL ON FUNCTION public.settle_quiz(text, jsonb, text, text, text, boolean, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_quiz(text, jsonb, text, text, text, boolean, numeric) TO service_role;
