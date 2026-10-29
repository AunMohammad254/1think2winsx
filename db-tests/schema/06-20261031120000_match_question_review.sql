-- =============================================================================
-- Match mode: questions reviewed before players see them, and worded in Roman Urdu too
--
-- Applied to production (eclivawqhdovsndlngfo) on 2026-10-29 as migration 20261029113514, owner-approved,
-- BEFORE the code that uses it (PR #86) was deployed. Checked after: apply_match_change's body md5 is
-- db7793e7a9570d0c68e0d3063134c269 (this file's), it is still SECURITY DEFINER with search_path public
-- and callable only by the service role, the three new columns exist with their defaults, and the one
-- match there was unchanged (abandoned, version 14) with drafts [] and autoSend off.
-- private_hardened.submit_quiz_attempt was untouched (fc6332cd7da3b8fc892722d4d41cb369). The code live
-- before it keeps working on the migrated database: it never sends the new keys, and new questions just
-- have no Roman Urdu.
--
-- An over's questions are worded by Gemini (src/lib/match-wording.ts) or the built-in templates, and AI can
-- get things wrong. So unless a match sends them automatically, they wait as drafts: an admin edits or
-- sends each one in the scorer console, or skips it, before the over they are about would close them.
-- The rules (when a draft can still be sent, what an edit must keep) stay in src/lib/match-engine.ts and
-- src/lib/match-service.ts; this stores them.
--
-- 1. "LiveMatch".drafts: the over questions waiting for review, as the server writes them (a JSON list).
--    "LiveMatch"."autoSend": skip the review and send them as they are written (off by default).
-- 2. "Question"."textRomanUrdu": the question in Roman Urdu, which players see first, English under it.
-- 3. apply_match_change takes drafts (the new list) and autoSend, and release items carry textRomanUrdu.
--    Everything else it does is unchanged.
--
-- Not safe to re-run: the guard below stops a second run.
-- =============================================================================

-- ── 0. Refuse to run if apply_match_change changed since this migration was written ──────────────
-- It is re-created from the 20261030120000_match_corrections version (production 20261029101649), by
-- whitespace-insensitive md5 of the body. A second run finds this migration's version and stops.
DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc
   WHERE oid = to_regprocedure('public.apply_match_change(text,integer,jsonb)');
  IF v_md5 IS DISTINCT FROM 'b8e0d413211e54d301e4dbb2804801b6' THEN
    RAISE EXCEPTION 'public.apply_match_change is not the version this migration was written against (body md5 %): merge the change into the migration first',
      coalesce(v_md5, 'missing');
  END IF;
END $guard$;

-- ── 1. Drafts and the auto-send switch ────────────────────────────────────────────────────────────
ALTER TABLE public."LiveMatch"
  ADD COLUMN IF NOT EXISTS drafts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(drafts) = 'array'),
  ADD COLUMN IF NOT EXISTS "autoSend" boolean NOT NULL DEFAULT false;

-- ── 2. Roman Urdu wording ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public."Question"
  ADD COLUMN IF NOT EXISTS "textRomanUrdu" text CHECK ("textRomanUrdu" IS NULL OR length("textRomanUrdu") BETWEEN 1 AND 300);

-- ── 3. apply_match_change, with drafts, autoSend and Roman Urdu ──────────────────────────────────
-- Same as the 20261030120000 version, plus: drafts (replaces the match's list), autoSend, and each
-- release item's textRomanUrdu. Applied in this order, all or none:
--   startInnings { innings, battingTeam }     endInnings { innings, reason }     reopenInnings { innings }
--   resumeInnings { innings }     removeInnings { innings }
--   ball { id, innings, seq, runs, extra, extraRuns, wicket }     undoBall: id of the last ball
--   replaceBall { replaces, id, innings, seq, runs, extra, extraRuns, wicket }
--   release: [{ id, text, textRomanUrdu, options, market, params, innings, over, closesInSeconds }]
--            new questions; options is the JSON text of the option list, as the app stores every question's
--   lock: [question id], closeAll: true      no more answers, from now
--   reopen: [{ id, closesInSeconds }]         answers again, until then
--   resolve: [{ id, option }]   void: [question id]   pending: [question id]
--                                            a result, void (paused, out of every score), or neither again
--   drafts: [...]   autoSend: true | false    the match's drafts and its switch, as given
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
    IF p_change ? 'replaceBall' THEN
      v_item := p_change->'replaceBall';
      -- The old ball first, so the new one can take its number
      UPDATE "BallEvent" SET "undoneAt" = now(), "undoneBy" = v_admin, "replacedBy" = v_item->>'id'
       WHERE id = v_item->>'replaces' AND "matchId" = p_match_id AND "undoneAt" IS NULL
         AND innings = (v_item->>'innings')::smallint AND seq = (v_item->>'seq')::int;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%', 'invalid:That ball was undone or changed meanwhile';
      END IF;
      INSERT INTO "BallEvent" (id, "matchId", innings, seq, runs, extra, "extraRuns", wicket, "createdBy")
      VALUES (v_item->>'id', p_match_id, (v_item->>'innings')::smallint, (v_item->>'seq')::int, (v_item->>'runs')::smallint,
              v_item->>'extra', (v_item->>'extraRuns')::smallint, (v_item->>'wicket')::boolean, v_admin);
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
