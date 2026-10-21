-- Quiz settlement: rank rewards (points or a prize for 1st-3rd place), paid once per quiz, and
-- admin-only bumper prizes. Replaces the separate evaluate -> allocate-points -> lucky-draw steps.

-- ── 1. Bumper prizes are a secret, admin-only catalogue category ─────────────────────────────────
-- Players (anon/authenticated) can no longer read them through the API or directly.
DROP POLICY IF EXISTS "Prize_public_select" ON public."Prize";
CREATE POLICY "Prize_public_select" ON public."Prize" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING ((("isActive" = true) AND (status = 'published'::text) AND (category <> 'bumper'::text)));

-- SECURITY DEFINER so it sees the prize even when RLS hides it from the caller
CREATE OR REPLACE FUNCTION private_hardened.prize_is_bumper(p_prize_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM "Prize" WHERE id = p_prize_id AND category = 'bumper');
$function$;
REVOKE ALL ON FUNCTION private_hardened.prize_is_bumper(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_hardened.prize_is_bumper(text) TO authenticated, service_role;

-- Bumper prizes are won in quizzes, never redeemed with points. Same signature and body as before,
-- plus the check (CREATE OR REPLACE keeps the existing grants).
CREATE OR REPLACE FUNCTION public.redeem_prize(p_user_id text, p_prize_id text, p_full_name text DEFAULT NULL::text, p_whatsapp_number text DEFAULT NULL::text, p_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF private_hardened.prize_is_bumper(p_prize_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Prize not found or not available');
    END IF;
    RETURN private_hardened.redeem_prize(
        p_user_id := p_user_id,
        p_prize_id := p_prize_id,
        p_full_name := p_full_name,
        p_whatsapp_number := p_whatsapp_number,
        p_address := p_address
    );
END;
$function$;

-- ── 2. Up to three ranked winners per quiz, each with points or a prize ───────────────────────────
ALTER TABLE public."QuizWinner" ADD COLUMN IF NOT EXISTS rank integer;
ALTER TABLE public."QuizWinner" ADD COLUMN IF NOT EXISTS "pointsAwarded" integer NOT NULL DEFAULT 0;
-- The winners recorded by the old one-per-quiz lucky draw are 1st place
UPDATE public."QuizWinner" SET rank = 1 WHERE rank IS NULL;
ALTER TABLE public."QuizWinner" ALTER COLUMN rank SET NOT NULL;
ALTER TABLE public."QuizWinner" ALTER COLUMN "prizeId" DROP NOT NULL;
ALTER TABLE public."QuizWinner" DROP CONSTRAINT IF EXISTS "QuizWinner_rank_check";
ALTER TABLE public."QuizWinner" ADD CONSTRAINT "QuizWinner_rank_check" CHECK (rank BETWEEN 1 AND 3);
ALTER TABLE public."QuizWinner" DROP CONSTRAINT IF EXISTS "QuizWinner_reward_check";
ALTER TABLE public."QuizWinner" ADD CONSTRAINT "QuizWinner_reward_check" CHECK ("prizeId" IS NOT NULL OR "pointsAwarded" > 0);
ALTER TABLE public."QuizWinner" DROP CONSTRAINT IF EXISTS "QuizWinner_selectionMethod_check";
ALTER TABLE public."QuizWinner" ADD CONSTRAINT "QuizWinner_selectionMethod_check" CHECK (("selectionMethod" = ANY (ARRAY[
  'random_draw'::text, 'auto_single_winner'::text, 'ranked'::text, 'ranked_random_tiebreak'::text, 'ranked_earliest_tiebreak'::text])));
DROP INDEX IF EXISTS public."QuizWinner_quizId_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "QuizWinner_quiz_rank_unique" ON public."QuizWinner" USING btree ("quizId", rank);
CREATE UNIQUE INDEX IF NOT EXISTS "QuizWinner_quiz_user_unique" ON public."QuizWinner" USING btree ("quizId", "userId");

-- ── 3. One settlement per quiz: the row is the "already paid" guard and the audit record ───────────
CREATE TABLE IF NOT EXISTS public."QuizSettlement" (
  "quizId" text PRIMARY KEY REFERENCES public."Quiz"(id) ON DELETE CASCADE,
  "settledAt" timestamp with time zone NOT NULL DEFAULT now(),
  "settledBy" text NOT NULL,
  "tieRule" text NOT NULL CHECK ("tieRule" = ANY (ARRAY['random'::text, 'earliest'::text, 'legacy'::text])),
  seed text NOT NULL,
  rewards jsonb NOT NULL DEFAULT '[]'::jsonb,
  "participantCount" integer NOT NULL DEFAULT 0
);
ALTER TABLE public."QuizSettlement" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."QuizSettlement" FROM anon, authenticated;
GRANT SELECT ON public."QuizSettlement" TO service_role;

-- Quizzes already rewarded the old way (a lucky-draw winner, or points on an attempt) count as
-- settled, so they can't be paid a second time
INSERT INTO public."QuizSettlement" ("quizId", "settledAt", "settledBy", "tieRule", seed, rewards, "participantCount")
SELECT w."quizId", min(w."selectedAt"), coalesce(min(w."selectedBy"), 'admin'), 'legacy', min(w.seed),
       jsonb_agg(jsonb_build_object('rank', w.rank, 'prizeId', w."prizeId") ORDER BY w.rank), 0
  FROM public."QuizWinner" w
 GROUP BY w."quizId"
ON CONFLICT ("quizId") DO NOTHING;
INSERT INTO public."QuizSettlement" ("quizId", "settledAt", "settledBy", "tieRule", seed, rewards, "participantCount")
SELECT a."quizId", max(a."updatedAt") AT TIME ZONE 'UTC', 'admin', 'legacy', '', '[]'::jsonb, count(*)::int
  FROM public."QuizAttempt" a
 WHERE a.points > 0
 GROUP BY a."quizId"
ON CONFLICT ("quizId") DO NOTHING;

-- ── 4. settle_quiz: everything in one transaction, or nothing ─────────────────────────────────────
-- p_rewards: [{"rank": 1, "points": 500} | {"rank": 2, "prizeId": "..."}], at most one per place 1-3.
-- Players ranked by score (only completed attempts that scored above 0); ties broken by p_tie_rule:
-- 'random' orders tied players by md5(seed:userId), reproducible from the stored seed; 'earliest' by
-- first submission. p_dry_run runs the same code and rolls it back: the preview is exactly what a
-- real settle would do with the same seed.
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
  v_prize record;
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
        SELECT id, name, category, "isActive", stock INTO v_prize FROM "Prize" WHERE id = v_prize_id FOR UPDATE;
        IF NOT FOUND OR NOT v_prize."isActive" THEN
          RAISE EXCEPTION '%', 'invalid:A chosen prize is no longer available';
        END IF;
        IF v_prize.stock <= 0 THEN
          RAISE EXCEPTION '%', 'out_of_stock:' || v_prize.name || ' is out of stock';
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
        'points', v_points, 'prizeId', v_prize_id,
        'prizeName', CASE WHEN v_prize_id IS NOT NULL THEN v_prize.name END,
        'prizeCategory', CASE WHEN v_prize_id IS NOT NULL THEN v_prize.category END);
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
REVOKE ALL ON FUNCTION public.settle_quiz(text, jsonb, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_quiz(text, jsonb, text, text, text, boolean) TO service_role;
