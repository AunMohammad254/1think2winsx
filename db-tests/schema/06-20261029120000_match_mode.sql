-- =============================================================================
-- Match mode: a live cricket match as a quiz, two prediction questions per over
--
-- NOT applied to any database yet. Needs the owner's approval for production (eclivawqhdovsndlngfo).
-- The code live before it keeps working on the migrated database: submit_quiz_attempt behaves as
-- before for every quiz that is not a match and has no free entry, and nothing else it uses changes.
--
-- How a match runs (the rules are in src/lib/match-engine.ts; this stores what they decide):
--   - An admin creates a match (create_live_match): a draft prediction quiz with free entry, plus its
--     "LiveMatch" row. Free entry, because paid entry plus prizes for predicting a live match would be
--     a bet.
--   - The admin's scorer console records each ball ("BallEvent", per innings in "MatchInnings").
--   - Questions shown during over N are about over N+1: they open at its first ball, close after its
--     5th legal ball (or a fallback time, whichever comes first) and are settled from over N+1's balls.
--     So nobody can see the answer while answering.
--   - Overs that never happen (all out, target reached, innings ended early, match abandoned) are
--     voided: their questions are paused, which takes them out of every score.
--   - Every change goes through apply_match_change in one transaction, with a version number so two
--     consoles can't overwrite each other.
--
-- 1. "Quiz"."freeEntry": submit_quiz_attempt skips the day pass for such a quiz.
-- 2. "Question"."closesAt": submit_quiz_attempt refuses an answer to a question after it. Plus the over a
--    match question is about and its market (what it asks), which settle it.
-- 3. LiveMatch, MatchInnings, BallEvent: the server's only (players will read the match through the
--    server).
-- 4. submit_quiz_attempt: free entry, closesAt, and no quiz-wide answering window for a match (its
--    questions close one by one).
-- 5. A match can't be settled until it has finished or been abandoned.
--
-- Not safe to re-run: the guard below stops a second run.
-- =============================================================================

-- ── 0. Refuse to run if submit_quiz_attempt changed since this migration was written ─────────────
-- It is re-created from the 20261024170000_write_answers_once version (production 20261024195040),
-- by whitespace-insensitive md5 of the body. A second run finds this migration's version and stops.
DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc
   WHERE oid = to_regprocedure('private_hardened.submit_quiz_attempt(text,text,jsonb,text)');
  IF v_md5 IS DISTINCT FROM '0a95ecc2ead45aab9eb610b7804fead8' THEN
    RAISE EXCEPTION 'private_hardened.submit_quiz_attempt is not the version this migration was written against (body md5 %): merge the change into the migration first',
      coalesce(v_md5, 'missing');
  END IF;
END $guard$;

-- ── 1. Free entry ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."Quiz" ADD COLUMN IF NOT EXISTS "freeEntry" boolean NOT NULL DEFAULT false;

-- ── 2. Questions that close on their own, and what a match question is about ─────────────────────
ALTER TABLE public."Question"
  -- No more answers from then on (null: open until its result is saved, as before)
  ADD COLUMN IF NOT EXISTS "closesAt" timestamp with time zone,
  -- A match question: the innings and over it is about, and its market (src/lib/match-engine.ts)
  ADD COLUMN IF NOT EXISTS "matchInnings" smallint CHECK ("matchInnings" IN (1, 2)),
  ADD COLUMN IF NOT EXISTS "matchOver" smallint CHECK ("matchOver" BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS market text CHECK (market ~ '^[a-z_]{1,40}$'),
  ADD COLUMN IF NOT EXISTS "marketParams" jsonb;
ALTER TABLE public."Question" ADD CONSTRAINT "Question_match_fields_together"
  CHECK (("matchInnings" IS NULL) = ("matchOver" IS NULL) AND ("matchInnings" IS NULL) = (market IS NULL));
CREATE INDEX IF NOT EXISTS "Question_quiz_match_over_idx" ON public."Question" ("quizId", "matchInnings", "matchOver")
  WHERE "matchInnings" IS NOT NULL;

-- ── 3. The match, its innings and its balls ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."LiveMatch" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "quizId" text NOT NULL UNIQUE REFERENCES public."Quiz"(id) ON DELETE CASCADE,
  "teamA" text NOT NULL CHECK (length(btrim("teamA")) BETWEEN 2 AND 60),
  "teamB" text NOT NULL CHECK (length(btrim("teamB")) BETWEEN 2 AND 60),
  -- 20 for T20, 10 for T10
  "oversPerInnings" smallint NOT NULL CHECK ("oversPerInnings" BETWEEN 1 AND 50),
  "questionsPerOver" smallint NOT NULL DEFAULT 2 CHECK ("questionsPerOver" BETWEEN 1 AND 3),
  -- How long the first over's questions stay open after an innings starts
  "firstWindowSeconds" integer NOT NULL DEFAULT 120 CHECK ("firstWindowSeconds" BETWEEN 30 AND 900),
  -- The latest a question closes after it opens, if the 5th legal ball of the over before isn't recorded first
  "lockFallbackSeconds" integer NOT NULL DEFAULT 150 CHECK ("lockFallbackSeconds" BETWEEN 30 AND 900),
  status text NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'live', 'innings_break', 'completed', 'abandoned')),
  -- Moves on with every change; apply_match_change refuses a change made against an older one
  version integer NOT NULL DEFAULT 0,
  "createdBy" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CHECK (lower(btrim("teamA")) <> lower(btrim("teamB")))
);

CREATE TABLE IF NOT EXISTS public."MatchInnings" (
  "matchId" text NOT NULL REFERENCES public."LiveMatch"(id) ON DELETE CASCADE,
  innings smallint NOT NULL CHECK (innings IN (1, 2)),
  "battingTeam" text NOT NULL,
  "startedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "endedAt" timestamp with time zone,
  -- overs, all_out, target: the balls ended it (undoing the ball reopens it); admin: ended by hand
  "endReason" text CHECK ("endReason" IN ('overs', 'all_out', 'target', 'admin')),
  PRIMARY KEY ("matchId", innings),
  CHECK (("endedAt" IS NULL) = ("endReason" IS NULL))
);

CREATE TABLE IF NOT EXISTS public."BallEvent" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "matchId" text NOT NULL,
  innings smallint NOT NULL,
  -- Order within the innings, 1 up; an undone ball's number is used again by the next one
  seq integer NOT NULL CHECK (seq >= 1),
  -- Off the bat, or byes / leg byes for those extras
  runs smallint NOT NULL DEFAULT 0 CHECK (runs BETWEEN 0 AND 7),
  extra text NOT NULL DEFAULT 'none' CHECK (extra IN ('none', 'wide', 'no_ball', 'bye', 'leg_bye')),
  -- The 1-run penalty of a wide or no-ball
  "extraRuns" smallint NOT NULL DEFAULT 0 CHECK ("extraRuns" BETWEEN 0 AND 5),
  wicket boolean NOT NULL DEFAULT false,
  "createdBy" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "undoneAt" timestamp with time zone,
  "undoneBy" text,
  FOREIGN KEY ("matchId", innings) REFERENCES public."MatchInnings"("matchId", innings) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BallEvent_live_seq_key" ON public."BallEvent" ("matchId", innings, seq) WHERE "undoneAt" IS NULL;

ALTER TABLE public."LiveMatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MatchInnings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BallEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."LiveMatch", public."MatchInnings", public."BallEvent" FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public."LiveMatch", public."MatchInnings", public."BallEvent" TO service_role;

-- ── 4. submit_quiz_attempt: free entry, questions that close on their own, matches ────────────────
-- Same as the 20261024170000 version except:
--   - a quiz with "freeEntry" needs no day pass, whatever the wallet setting;
--   - a match has no quiz-wide answering window: each question closes at its own "closesAt";
--   - a question whose "closesAt" has passed takes no more answers, like one whose result is saved.
CREATE OR REPLACE FUNCTION private_hardened.submit_quiz_attempt(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid()::text;
  v_quiz record;
  v_is_match boolean;
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
  SELECT id, status, duration, "pushedAt", "freeEntry" INTO v_quiz FROM "Quiz" WHERE id = p_quiz_id FOR KEY SHARE;
  IF NOT FOUND OR v_quiz.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Quiz not found or inactive');
  END IF;
  v_is_match := EXISTS (SELECT 1 FROM "LiveMatch" WHERE "quizId" = p_quiz_id);

  -- Answering window over: duration minutes from pushedAt (+30 s grace for latency). A match's
  -- questions close one by one instead (below).
  IF NOT v_is_match AND v_quiz."pushedAt" IS NOT NULL AND v_quiz.duration IS NOT NULL
     AND now() > v_quiz."pushedAt" + make_interval(mins => v_quiz.duration) + interval '30 seconds' THEN
    RETURN jsonb_build_object('success', false, 'code', 'closed', 'error', 'This quiz has ended and no longer accepts answers.');
  END IF;

  SELECT (value IS DISTINCT FROM 'false') INTO v_wallet_enabled FROM "AppSettings" WHERE key = 'wallet_enabled';
  v_wallet_enabled := COALESCE(v_wallet_enabled, true);

  IF v_wallet_enabled AND NOT v_quiz."freeEntry" THEN
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
         AND (q."closesAt" IS NULL OR q."closesAt" > now())
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

-- ── 5. No settling a match that is still being played ─────────────────────────────────────────────
-- Mid-match, every question released so far can have its result, which settle_quiz would accept. It
-- inserts the "QuizSettlement" row (in a preview too, before rolling back), so this refuses there; its
-- 'code:message' becomes settle_quiz's refusal.
CREATE OR REPLACE FUNCTION private_hardened.refuse_unfinished_match_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM "LiveMatch" WHERE "quizId" = NEW."quizId" AND status NOT IN ('completed', 'abandoned')) THEN
    RAISE EXCEPTION '%', 'match_unfinished:This match is still being played. Settle it once it has finished.';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION private_hardened.refuse_unfinished_match_settlement() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER refuse_unfinished_match_settlement BEFORE INSERT ON public."QuizSettlement"
  FOR EACH ROW EXECUTE FUNCTION private_hardened.refuse_unfinished_match_settlement();

-- ── 6. Creating a match ───────────────────────────────────────────────────────────────────────────
-- A draft prediction quiz with free entry, titled "Team A vs Team B", and its match. Draft: players see
-- nothing until the match goes live.
CREATE OR REPLACE FUNCTION public.create_live_match(p_team_a text, p_team_b text, p_overs integer, p_questions_per_over integer, p_admin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_a text := btrim(coalesce(p_team_a, ''));
  v_b text := btrim(coalesce(p_team_b, ''));
  v_quiz_id text := 'quiz_' || replace(gen_random_uuid()::text, '-', '');
  v_match_id text := 'match_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF length(v_a) NOT BETWEEN 2 AND 60 OR length(v_b) NOT BETWEEN 2 AND 60 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Each team name needs 2 to 60 characters');
  END IF;
  IF lower(v_a) = lower(v_b) THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'The two teams need different names');
  END IF;
  IF p_overs IS NULL OR p_overs NOT BETWEEN 1 AND 50 OR p_questions_per_over IS NULL OR p_questions_per_over NOT BETWEEN 1 AND 3 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Overs must be 1 to 50, and questions per over 1 to 3');
  END IF;
  IF nullif(btrim(p_admin), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Who created the match is required');
  END IF;

  INSERT INTO "Quiz" (id, title, description, duration, status, "quizType", "freeEntry", "createdAt", "updatedAt")
  VALUES (v_quiz_id, v_a || ' vs ' || v_b, 'Live match: predict what happens in each over.',
          -- Not used for a match (its questions close one by one); long enough for a whole match anyway
          p_overs * 2 * 6, 'draft', 'predictable', true, now(), now());
  INSERT INTO "LiveMatch" (id, "quizId", "teamA", "teamB", "oversPerInnings", "questionsPerOver", "createdBy")
  VALUES (v_match_id, v_quiz_id, v_a, v_b, p_overs, p_questions_per_over, btrim(p_admin));
  RETURN jsonb_build_object('success', true, 'matchId', v_match_id, 'quizId', v_quiz_id);
END $function$;

-- ── 7. Applying one change to a match ─────────────────────────────────────────────────────────────
-- The server works out a change with src/lib/match-engine.ts and sends it here, with the version it
-- read. A different current version means another console changed the match first: nothing is applied
-- ('stale'), and the server reloads. Otherwise everything below is applied in this order, all or none:
--   startInnings { innings, battingTeam }     endInnings { innings, reason }     reopenInnings { innings }
--   ball { id, innings, seq, runs, extra, extraRuns, wicket }     undoBall: id of the last ball
--   release: [{ id, text, options, market, params, innings, over, closesInSeconds }]   new questions;
--            options is the JSON text of the option list, as the app stores every question's
--   lock: [question id], closeAll: true      no more answers, from now
--   resolve: [{ id, option }]   void: [question id]   pending: [question id]
--                                            a result, void (paused, out of every score), or neither again
--   status: the match's status after the change     admin: who made it
-- Only the match's own questions are touched. Answers' "isCorrect" follow the results; scores are
-- worked out at settlement.
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
  v_lock text[];
  v_void text[];
  v_pending text[];
  v_resolved text[];
BEGIN
  IF p_change IS NULL OR jsonb_typeof(p_change) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid match change');
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

    IF p_change ? 'ball' THEN
      v_item := p_change->'ball';
      INSERT INTO "BallEvent" (id, "matchId", innings, seq, runs, extra, "extraRuns", wicket, "createdBy")
      VALUES (v_item->>'id', p_match_id, (v_item->>'innings')::smallint, (v_item->>'seq')::int, (v_item->>'runs')::smallint,
              v_item->>'extra', (v_item->>'extraRuns')::smallint, (v_item->>'wicket')::boolean, v_admin);
    END IF;
    IF p_change ? 'undoBall' THEN
      UPDATE "BallEvent" SET "undoneAt" = now(), "undoneBy" = v_admin
       WHERE id = p_change->>'undoBall' AND "matchId" = p_match_id AND "undoneAt" IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%', 'invalid:That ball was already undone';
      END IF;
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_change->'release', '[]'::jsonb)) LOOP
      IF jsonb_typeof((v_item->>'options')::jsonb) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION '%', 'invalid:A question''s options must be a JSON list';
      END IF;
      INSERT INTO "Question" (id, "quizId", text, options, status, "hasCorrectAnswer", "closesAt",
                              "matchInnings", "matchOver", market, "marketParams", "createdAt", "updatedAt")
      VALUES (v_item->>'id', v_match."quizId", v_item->>'text', v_item->>'options', 'active', false,
              now() + make_interval(secs => (v_item->>'closesInSeconds')::int),
              (v_item->>'innings')::smallint, (v_item->>'over')::smallint, v_item->>'market',
              coalesce(v_item->'params', '{}'::jsonb), now(), now());
    END LOOP;

    v_lock := ARRAY(SELECT jsonb_array_elements_text(coalesce(p_change->'lock', '[]'::jsonb)));
    UPDATE "Question" SET "closesAt" = now(), "updatedAt" = now()
     WHERE "quizId" = v_match."quizId" AND "matchInnings" IS NOT NULL
       AND ("closesAt" IS NULL OR "closesAt" > now())
       AND (coalesce((p_change->>'closeAll')::boolean, false) OR id = ANY (v_lock));

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

    UPDATE "LiveMatch" SET status = coalesce(p_change->>'status', status), version = version + 1, "updatedAt" = now()
     WHERE id = p_match_id;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('success', false, 'code', split_part(SQLERRM, ':', 1), 'error', substr(SQLERRM, strpos(SQLERRM, ':') + 1));
    WHEN unique_violation OR check_violation OR foreign_key_violation OR not_null_violation OR invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Invalid match change: ' || SQLERRM);
  END;

  RETURN jsonb_build_object('success', true, 'version', v_match.version + 1);
END $function$;

REVOKE ALL ON FUNCTION public.create_live_match(text, text, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_match_change(text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_live_match(text, text, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_match_change(text, integer, jsonb) TO service_role;
