-- =============================================================================
-- Points pool: a fixed number of points for each player, as well as random shares
--
-- NOT applied to production yet. Apply it BEFORE deploying the code that offers "points each" on the
-- Settle screen. The live code keeps working with it: its settle call (seven named arguments) reaches
-- settle_quiz, whose new eighth argument has a default that keeps the random split. The new code sends
-- p_pool_each only for a fixed amount, so it settles the old way on a database without this migration.
--
-- Why: settlement could pay a quiz's points pool only as the whole pool in random amounts. The admin
-- wants to give each selected player the same amount instead: "the first 20% get 1 point each". The
-- players are chosen as before (the earliest p_pool_percent of the entrants, filled by the earliest
-- who scored above 0), and the pool still caps the total: the places are never more than
-- floor(pointsPool / p_pool_each). A 100-point pool at 1 point each pays at most 100 players, however
-- many 20% of the entrants is.
--
-- Not safe to re-run: the guard below stops a second run.
-- =============================================================================

-- ── 0. Refuse to run if settle_quiz changed since this migration was written ─────────────────────
-- It is re-created from the 20261024170000_write_answers_once version (applied to production on
-- 2026-10-24 as 20261024195040), by whitespace-insensitive md5 of the body. A change made to production
-- since then would be silently undone, so the migration stops instead: merge that change into this file
-- and update the fingerprint.
DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc
   WHERE oid = to_regprocedure('public.settle_quiz(text,jsonb,text,text,text,boolean,numeric)');
  IF v_md5 IS DISTINCT FROM 'aaa55592b53e1692d34da66011a8ab28' THEN
    RAISE EXCEPTION 'public.settle_quiz(7 arguments) is not the version this migration was written against (body md5 %): merge the change into the migration first',
      coalesce(v_md5, 'missing');
  END IF;
END $guard$;

-- ── 1. What each player got, when the pool was paid in fixed amounts ─────────────────────────────
-- 0: random shares (every settlement before this one)
ALTER TABLE public."QuizSettlement" ADD COLUMN IF NOT EXISTS "poolEach" integer NOT NULL DEFAULT 0 CHECK ("poolEach" >= 0);

-- ── 2. settle_quiz: p_pool_each points for each place, as many places as the pool covers ────────
-- An eighth argument means a new signature: drop the old one so there is a single overload (two
-- overloads that both match a call make PostgREST answer HTTP 300). Older calls still work through
-- the defaults.
DROP FUNCTION IF EXISTS public.settle_quiz(text, jsonb, text, text, text, boolean, numeric);

-- Same as the 20261024170000 version, except for the pool. p_pool_each 0 shares the whole pool at
-- random, exactly as before. p_pool_each above 0 (at most the pool) gives that many points to each of
-- the places, which are least(ceil(entrants × p_pool_percent / 100), floor(pointsPool / p_pool_each)),
-- filled by the earliest entrants who scored above 0. Points the places don't use stay unpaid.
CREATE OR REPLACE FUNCTION public.settle_quiz(
  p_quiz_id text, p_rewards jsonb, p_tie_rule text, p_seed text, p_settled_by text,
  p_dry_run boolean DEFAULT false, p_pool_percent numeric DEFAULT 0, p_pool_each integer DEFAULT 0)
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
    IF p_pool_each IS NULL OR p_pool_each < 0 THEN
      RAISE EXCEPTION '%', 'invalid:The points each player gets must be 0 or more';
    END IF;
    IF p_pool_each > 0 AND p_pool_percent = 0 THEN
      RAISE EXCEPTION '%', 'invalid:Choose which players get the points each';
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
    IF p_pool_each > v_pool_size THEN
      RAISE EXCEPTION '%', 'invalid:The points each player gets can''t be more than the whole pool (' || v_pool_size || ')';
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

    -- The pool, for the earliest scorers filling the places: p_pool_each points each, or the whole
    -- pointsPool in random shares
    IF p_pool_percent > 0 THEN
      v_places := ceil(v_participants * p_pool_percent / 100)::int;
      IF p_pool_each > 0 THEN
        -- The pool caps the places: never more points than it holds
        v_places := least(v_places, v_pool_size / p_pool_each);
        v_pool_target := v_places * p_pool_each;
        INSERT INTO "QuizPoolShare" ("quizId", "userId", "attemptId", points)
        SELECT p_quiz_id, e."userId", e.id, p_pool_each
          FROM "QuizAttempt" e
         WHERE e."quizId" = p_quiz_id AND e."isCompleted" AND e."correctAnswers" > 0
         ORDER BY e."createdAt", e.id
         LIMIT v_places;
      ELSE
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
      END IF;

      UPDATE "User" u SET points = u.points + s.points, "updatedAt" = now()
        FROM "QuizPoolShare" s WHERE s."quizId" = p_quiz_id AND u.id = s."userId";
      UPDATE "QuizAttempt" a SET points = a.points + s.points, "updatedAt" = now()
        FROM "QuizPoolShare" s WHERE s."quizId" = p_quiz_id AND a.id = s."attemptId";
    END IF;

    SELECT jsonb_build_object(
             'percent', p_pool_percent, 'each', p_pool_each, 'poolSize', v_pool_size, 'target', v_pool_target,
             'places', v_places, 'paid', coalesce(sum(points), 0), 'eligible', v_eligible, 'recipients', count(*),
             'min', coalesce(min(points), 0), 'max', coalesce(max(points), 0),
             'recipientIds', coalesce(jsonb_agg("userId" ORDER BY "userId"), '[]'::jsonb))
      INTO v_pool FROM "QuizPoolShare" WHERE "quizId" = p_quiz_id;

    INSERT INTO "QuizSettlement" ("quizId", "settledBy", "tieRule", seed, rewards, "participantCount", "poolPercent", "poolPoints", "poolEach")
    VALUES (p_quiz_id, p_settled_by, p_tie_rule, p_seed, p_rewards, v_participants, p_pool_percent, (v_pool->>'paid')::int, p_pool_each);

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
REVOKE ALL ON FUNCTION public.settle_quiz(text, jsonb, text, text, text, boolean, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_quiz(text, jsonb, text, text, text, boolean, numeric, integer) TO service_role;
