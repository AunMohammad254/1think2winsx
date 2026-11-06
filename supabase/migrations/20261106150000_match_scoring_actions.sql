-- =============================================================================
-- Match mode: every scoring action of the Laws of Cricket
--
-- Applied to production (eclivawqhdovsndlngfo) on 2026-11-06 as migration 20261106035051, owner-approved, BEFORE
-- the code that uses it was deployed. Checked after: both columns and the four checks exist, the 40 balls there
-- keep NULL in the new columns, apply_match_change's body md5 is 2296c99a60ff3c3151b8d562fc5511d1 and it is still
-- SECURITY DEFINER with search_path public and callable only by the service role. The code live before it keeps
-- working on the migrated database: it never sends the new keys or kinds.
--
-- The scorer console records each entry as the Laws score it (src/lib/match-engine.ts deliveryProblem):
--
-- 1. "BallEvent".extra takes three more kinds:
--      no_ball_bye, no_ball_leg_bye   a no-ball whose runs are byes / leg byes, not off the bat (Law 21.7)
--      penalty                        5 penalty runs to the batting side, not a ball of the over (Law 41)
--      no_delivery                    a dismissal with no ball at all: retired out, timed out (Laws 25.4, 40)
-- 2. "BallEvent"."wicketKind": how the batter was out: bowled, caught, lbw, stumped, hit_wicket, run_out,
--    obstructing, hit_twice, retired_out, timed_out. NULL for a ball that isn't a wicket, and for wickets
--    recorded before this (counted, kind unknown).
-- 3. "BallEvent".boundary: the ball reached the boundary (a four or a six). NULL before this: a 4 or 6 off the
--    bat counted as one. An all-run four or overthrows are false, so "a four or a six?" settles right.
-- 4. apply_match_change saves both on a new ball and a corrected one (ball and replaceBall take wicketKind
--    and boundary). Everything else it does is unchanged.
--
-- Not safe to re-run: the guard below stops a second run.
-- =============================================================================

-- ── 0. Refuse to run if apply_match_change changed since this migration was written ──────────────
-- It is re-created from the 20261031120000_match_question_review version (production 20261029113514), by
-- whitespace-insensitive md5 of the body. A second run finds this migration's version and stops.
DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc
   WHERE oid = to_regprocedure('public.apply_match_change(text,integer,jsonb)');
  IF v_md5 IS DISTINCT FROM 'db7793e7a9570d0c68e0d3063134c269' THEN
    RAISE EXCEPTION 'public.apply_match_change is not the version this migration was written against (body md5 %): merge the change into the migration first',
      coalesce(v_md5, 'missing');
  END IF;
END $guard$;

-- ── 1-3. The ball's new kinds and columns ─────────────────────────────────────────────────────────
ALTER TABLE public."BallEvent" DROP CONSTRAINT IF EXISTS "BallEvent_extra_check";
ALTER TABLE public."BallEvent" ADD CONSTRAINT "BallEvent_extra_check"
  CHECK (extra IN ('none', 'wide', 'no_ball', 'no_ball_bye', 'no_ball_leg_bye', 'bye', 'leg_bye', 'penalty', 'no_delivery'));
ALTER TABLE public."BallEvent"
  ADD COLUMN IF NOT EXISTS "wicketKind" text CHECK ("wicketKind" IN (
    'bowled', 'caught', 'lbw', 'stumped', 'hit_wicket', 'run_out', 'obstructing', 'hit_twice', 'retired_out', 'timed_out')),
  ADD COLUMN IF NOT EXISTS boundary boolean;
-- A dismissal is a wicket; a boundary is a four or a six
ALTER TABLE public."BallEvent" ADD CONSTRAINT "BallEvent_wicketKind_wicket_check" CHECK ("wicketKind" IS NULL OR wicket);
ALTER TABLE public."BallEvent" ADD CONSTRAINT "BallEvent_boundary_runs_check" CHECK (boundary IS NOT TRUE OR runs IN (4, 6));

-- ── 4. apply_match_change, saving wicketKind and boundary ─────────────────────────────────────────
-- Same as the 20261031120000 version, plus wicketKind and boundary on ball and replaceBall:
--   ball { id, innings, seq, runs, extra, extraRuns, wicket, wicketKind?, boundary? }
--   replaceBall { replaces, id, innings, seq, runs, extra, extraRuns, wicket, wicketKind?, boundary? }
CREATE OR REPLACE FUNCTION public.apply_match_change(p_match_id text, p_version integer, p_change jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match record;
  v_admin text := coalesce(nullif(btrim(p_change->>'admin'), ''), 'admin');
  v_item jsonb;
  v_innings smallint;
  v_lock text[];
  v_void text[];
  v_pending text[];
  v_resolved text[];
BEGIN
  IF p_change IS NULL OR jsonb_typeof(p_change) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid match change');
  END IF;
  IF p_change ? 'drafts' AND jsonb_typeof(p_change->'drafts') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'A match''s drafts must be a JSON list');
  END IF;
  SELECT id, "quizId", version INTO v_match FROM "LiveMatch" WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Match not found');
  END IF;
  IF v_match.version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('success', false, 'code', 'stale', 'version', v_match.version,
      'error', 'Someone else changed this match first. It has been reloaded: check it and try again.');
  END IF;

  BEGIN
    IF p_change ? 'startInnings' THEN
      INSERT INTO "MatchInnings" ("matchId", innings, "battingTeam")
      VALUES (p_match_id, (p_change->'startInnings'->>'innings')::smallint, btrim(p_change->'startInnings'->>'battingTeam'));
    END IF;
    IF p_change ? 'endInnings' THEN
      UPDATE "MatchInnings" SET "endedAt" = now(), "endReason" = p_change->'endInnings'->>'reason'
       WHERE "matchId" = p_match_id AND innings = (p_change->'endInnings'->>'innings')::smallint AND "endedAt" IS NULL;
    END IF;
    IF p_change ? 'reopenInnings' THEN
      UPDATE "MatchInnings" SET "endedAt" = NULL, "endReason" = NULL
       WHERE "matchId" = p_match_id AND innings = (p_change->'reopenInnings'->>'innings')::smallint AND "endReason" <> 'admin';
    END IF;
    IF p_change ? 'resumeInnings' THEN
      UPDATE "MatchInnings" SET "endedAt" = NULL, "endReason" = NULL
       WHERE "matchId" = p_match_id AND innings = (p_change->'resumeInnings'->>'innings')::smallint AND "endReason" = 'admin';
      IF NOT FOUND THEN
        RAISE EXCEPTION '%', 'invalid:That innings was not ended by hand';
      END IF;
    END IF;
    IF p_change ? 'removeInnings' THEN
      v_innings := (p_change->'removeInnings'->>'innings')::smallint;
      IF EXISTS (SELECT 1 FROM "BallEvent" WHERE "matchId" = p_match_id AND innings = v_innings AND "undoneAt" IS NULL) THEN
        RAISE EXCEPTION '%', 'invalid:An innings with balls recorded can''t be removed';
      END IF;
      -- A question players answered can't be deleted (protect_answered_question): it stays, voided and no
      -- longer part of the match, so it is out of every score and a fresh innings gets fresh questions.
      -- The rest go.
      WITH answered AS (
        SELECT q.id FROM "Question" q
         WHERE q."quizId" = v_match."quizId" AND q."matchInnings" = v_innings
           AND (EXISTS (SELECT 1 FROM "QuestionAttempt" qa WHERE qa."questionId" = q.id)
                OR EXISTS (SELECT 1 FROM "Answer" a WHERE a."questionId" = q.id))
      ), detached AS (
        UPDATE "Question" q SET status = 'paused', "hasCorrectAnswer" = false, "correctOption" = NULL,
               "closesAt" = least(coalesce(q."closesAt", now()), now()),
               "matchInnings" = NULL, "matchOver" = NULL, market = NULL, "marketParams" = NULL, "updatedAt" = now()
          FROM answered WHERE q.id = answered.id
        RETURNING q.id
      )
      UPDATE "QuestionAttempt" qa SET "isCorrect" = false FROM detached WHERE qa."questionId" = detached.id AND qa."isCorrect";
      DELETE FROM "Question" WHERE "quizId" = v_match."quizId" AND "matchInnings" = v_innings;
      -- Undone balls (history) go with it (ON DELETE CASCADE)
      DELETE FROM "MatchInnings" WHERE "matchId" = p_match_id AND innings = v_innings;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%', 'invalid:There is no such innings';
      END IF;
    END IF;

    IF p_change ? 'ball' THEN
      v_item := p_change->'ball';
      INSERT INTO "BallEvent" (id, "matchId", innings, seq, runs, extra, "extraRuns", wicket, "wicketKind", boundary, "createdBy")
      VALUES (v_item->>'id', p_match_id, (v_item->>'innings')::smallint, (v_item->>'seq')::int, (v_item->>'runs')::smallint,
              v_item->>'extra', (v_item->>'extraRuns')::smallint, (v_item->>'wicket')::boolean,
              nullif(v_item->>'wicketKind', ''), (v_item->>'boundary')::boolean, v_admin);
    END IF;
    IF p_change ? 'undoBall' THEN
      UPDATE "BallEvent" SET "undoneAt" = now(), "undoneBy" = v_admin
       WHERE id = p_change->>'undoBall' AND "matchId" = p_match_id AND "undoneAt" IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%', 'invalid:That ball was already undone';
      END IF;
    END IF;
    IF p_change ? 'replaceBall' THEN
      v_item := p_change->'replaceBall';
      -- The old ball first, so the new one can take its number
      UPDATE "BallEvent" SET "undoneAt" = now(), "undoneBy" = v_admin, "replacedBy" = v_item->>'id'
       WHERE id = v_item->>'replaces' AND "matchId" = p_match_id AND "undoneAt" IS NULL
         AND innings = (v_item->>'innings')::smallint AND seq = (v_item->>'seq')::int;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%', 'invalid:That ball was undone or changed meanwhile';
      END IF;
      INSERT INTO "BallEvent" (id, "matchId", innings, seq, runs, extra, "extraRuns", wicket, "wicketKind", boundary, "createdBy")
      VALUES (v_item->>'id', p_match_id, (v_item->>'innings')::smallint, (v_item->>'seq')::int, (v_item->>'runs')::smallint,
              v_item->>'extra', (v_item->>'extraRuns')::smallint, (v_item->>'wicket')::boolean,
              nullif(v_item->>'wicketKind', ''), (v_item->>'boundary')::boolean, v_admin);
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_change->'release', '[]'::jsonb)) LOOP
      IF jsonb_typeof((v_item->>'options')::jsonb) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION '%', 'invalid:A question''s options must be a JSON list';
      END IF;
      INSERT INTO "Question" (id, "quizId", text, "textRomanUrdu", options, status, "hasCorrectAnswer", "closesAt",
                              "matchInnings", "matchOver", market, "marketParams", "createdAt", "updatedAt")
      VALUES (v_item->>'id', v_match."quizId", v_item->>'text', nullif(btrim(v_item->>'textRomanUrdu'), ''), v_item->>'options', 'active', false,
              now() + make_interval(secs => (v_item->>'closesInSeconds')::int),
              (v_item->>'innings')::smallint, (v_item->>'over')::smallint, v_item->>'market',
              coalesce(v_item->'params', '{}'::jsonb), now(), now());
    END LOOP;

    v_lock := ARRAY(SELECT jsonb_array_elements_text(coalesce(p_change->'lock', '[]'::jsonb)));
    UPDATE "Question" SET "closesAt" = now(), "updatedAt" = now()
     WHERE "quizId" = v_match."quizId" AND "matchInnings" IS NOT NULL
       AND ("closesAt" IS NULL OR "closesAt" > now())
       AND (coalesce((p_change->>'closeAll')::boolean, false) OR id = ANY (v_lock));

    UPDATE "Question" q SET "closesAt" = now() + make_interval(secs => r."closesInSeconds"), "updatedAt" = now()
      FROM jsonb_to_recordset(coalesce(p_change->'reopen', '[]'::jsonb)) AS r(id text, "closesInSeconds" int)
     WHERE q.id = r.id AND q."quizId" = v_match."quizId" AND q."matchInnings" IS NOT NULL
       AND q.status = 'active' AND q."hasCorrectAnswer" = false;

    UPDATE "Question" q SET "correctOption" = r.option, "hasCorrectAnswer" = true, status = 'active', "updatedAt" = now()
      FROM jsonb_to_recordset(coalesce(p_change->'resolve', '[]'::jsonb)) AS r(id text, option int)
     WHERE q.id = r.id AND q."quizId" = v_match."quizId";
    v_resolved := ARRAY(SELECT r.id FROM jsonb_to_recordset(coalesce(p_change->'resolve', '[]'::jsonb)) AS r(id text, option int));
    v_void := ARRAY(SELECT jsonb_array_elements_text(coalesce(p_change->'void', '[]'::jsonb)));
    UPDATE "Question" SET status = 'paused', "hasCorrectAnswer" = false, "correctOption" = NULL, "updatedAt" = now()
     WHERE "quizId" = v_match."quizId" AND id = ANY (v_void);
    v_pending := ARRAY(SELECT jsonb_array_elements_text(coalesce(p_change->'pending', '[]'::jsonb)));
    UPDATE "Question" SET status = 'active', "hasCorrectAnswer" = false, "correctOption" = NULL, "updatedAt" = now()
     WHERE "quizId" = v_match."quizId" AND id = ANY (v_pending);

    -- Answers follow their question's result (or lose it)
    UPDATE "QuestionAttempt" qa SET "isCorrect" = (q."hasCorrectAnswer" AND qa."selectedOption" = q."correctOption")
      FROM "Question" q
     WHERE q.id = qa."questionId" AND qa."quizId" = v_match."quizId"
       AND q.id = ANY (v_resolved || v_void || v_pending)
       AND qa."isCorrect" IS DISTINCT FROM (q."hasCorrectAnswer" AND qa."selectedOption" = q."correctOption");

    UPDATE "LiveMatch" SET status = coalesce(p_change->>'status', status),
           drafts = CASE WHEN p_change ? 'drafts' THEN p_change->'drafts' ELSE drafts END,
           "autoSend" = coalesce((p_change->>'autoSend')::boolean, "autoSend"),
           version = version + 1, "updatedAt" = now()
     WHERE id = p_match_id;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('success', false, 'code', split_part(SQLERRM, ':', 1), 'error', substr(SQLERRM, strpos(SQLERRM, ':') + 1));
    WHEN unique_violation OR check_violation OR foreign_key_violation OR not_null_violation OR invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid match change: ' || SQLERRM);
  END;

  RETURN jsonb_build_object('success', true, 'version', v_match.version + 1);
END $function$;

-- CREATE OR REPLACE keeps the privileges; stated again so this file says who may call it
REVOKE ALL ON FUNCTION public.apply_match_change(text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_match_change(text, integer, jsonb) TO service_role;
