-- Applied to production on 2026-10-19 (migration settle_quiz_points_first, version 20261019000425).
-- Fixes settle_quiz (06-20261019120000_quiz_settlement.sql) failing with 55000 'record "v_prize" is
-- not assigned yet' whenever the first place it pays gets points. v_prize was an untyped record,
-- filled in only for a prize reward, and the winners list read v_prize.name. PL/pgSQL needs that
-- field's type when it first plans the statement, even inside a CASE that never runs, so the preview
-- and the settle both failed on any connection that hadn't yet paid a prize first. (The tests
-- missed it: the first test in the file paid a prize first, which cached the plan on their connection.)
-- The prize's fields are now plain variables, cleared for every place. Same signature, arguments and
-- behaviour otherwise; CREATE OR REPLACE keeps the grants.
CREATE OR REPLACE FUNCTION public.settle_quiz(
  p_quiz_id text, p_rewards jsonb, p_tie_rule text, p_seed text, p_settled_by text, p_dry_run boolean DEFAULT false)
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

    SELECT id, title INTO v_quiz FROM "Quiz" WHERE id = p_quiz_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%', 'not_found:Quiz not found';
    END IF;
    IF EXISTS (SELECT 1 FROM "QuizSettlement" WHERE "quizId" = p_quiz_id) THEN
      RAISE EXCEPTION '%', 'already_settled:This quiz has already been settled';
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
    SELECT count(*) INTO v_participants FROM "QuizAttempt" WHERE "quizId" = p_quiz_id AND "isCompleted";

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

    INSERT INTO "QuizSettlement" ("quizId", "settledBy", "tieRule", seed, rewards, "participantCount")
    VALUES (p_quiz_id, p_settled_by, p_tie_rule, p_seed, p_rewards, v_participants);

    v_result := jsonb_build_object(
      'success', true, 'quizId', p_quiz_id, 'quizTitle', v_quiz.title, 'participants', v_participants,
      'questions', v_total, 'tieRule', p_tie_rule, 'seed', p_seed, 'winners', v_winners, 'unfilled', v_unfilled);

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
