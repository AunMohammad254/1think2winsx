-- =============================================================================
-- All-or-nothing quiz saves: a quiz with its questions and settings, and a quiz's result
--
-- Applied to production (eclivawqhdovsndlngfo) on 2026-10-24 as migration 20261024190121, owner-approved,
-- before the code that calls these functions (PR #63) was deployed with main f1007ec. They were new, so
-- the code that was live then was unaffected.
--
-- 1. save_quiz: the admin quiz form saved a quiz, then each question, then the entry limit and points
--    pool, one request at a time. A failure part-way (a question players answered that may not be
--    removed, a dropped connection) left a half-saved quiz: some questions changed or deleted, others
--    not. Now the quiz row, every question insert/update/delete and the settings are one transaction.
-- 2. save_quiz_result: saving a quiz's result ran evaluate_question once per question and then
--    finalize_quiz_scores, so a failure part-way closed only some questions. Now it is one transaction.
--
-- Only the service role can call them. Safe to re-run.
-- =============================================================================

-- ── 1. save_quiz ─────────────────────────────────────────────────────────────────────────────────
-- p_quiz:      title, description, duration, timeUpDuration, passingScore, status, startsAt (ISO UTC or
--              null), prizeId, isBumperPrize, quizType
-- p_questions: [{ id, isNew, text, status, correctOption, options? }] in display order. "options" (a JSON
--              string of the option texts) is sent for new questions and for existing ones whose options
--              changed; unchanged options are left alone (the protect_answered_question trigger refuses
--              any options write to an answered question). An existing question's answer key is kept
--              once its result is saved.
-- p_settings:  maxEntries, pointsPool
-- Questions of an edited quiz missing from p_questions are deleted.
CREATE OR REPLACE FUNCTION public.save_quiz(p_quiz_id text, p_create boolean, p_quiz jsonb, p_questions jsonb, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q jsonb;
  v_i int := 0;
BEGIN
  IF p_quiz_id IS NULL OR p_quiz_id = '' OR jsonb_typeof(p_quiz) <> 'object' OR jsonb_typeof(p_settings) <> 'object'
     OR jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'A quiz needs at least one question');
  END IF;

  BEGIN
    IF p_create THEN
      INSERT INTO "Quiz" (id, title, description, duration, "timeUpDuration", "passingScore", status, "startsAt",
                          "prizeId", "isBumperPrize", "quizType", "createdAt", "updatedAt")
      VALUES (p_quiz_id, p_quiz->>'title', p_quiz->>'description', (p_quiz->>'duration')::int,
              (p_quiz->>'timeUpDuration')::int, (p_quiz->>'passingScore')::int, p_quiz->>'status',
              (p_quiz->>'startsAt')::timestamptz, NULLIF(p_quiz->>'prizeId', ''),
              coalesce((p_quiz->>'isBumperPrize')::boolean, false), coalesce(p_quiz->>'quizType', 'normal'), now(), now());
    ELSE
      UPDATE "Quiz" SET
        title = p_quiz->>'title',
        description = p_quiz->>'description',
        duration = (p_quiz->>'duration')::int,
        "timeUpDuration" = (p_quiz->>'timeUpDuration')::int,
        "passingScore" = (p_quiz->>'passingScore')::int,
        status = p_quiz->>'status',
        "startsAt" = (p_quiz->>'startsAt')::timestamptz,
        "prizeId" = NULLIF(p_quiz->>'prizeId', ''),
        "isBumperPrize" = coalesce((p_quiz->>'isBumperPrize')::boolean, false),
        "quizType" = coalesce(p_quiz->>'quizType', 'normal'),
        "updatedAt" = now()
      WHERE id = p_quiz_id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Quiz not found');
      END IF;

      -- Questions the edit leaves out (protect_answered_question refuses answered ones: all is undone)
      DELETE FROM "Question" q
       WHERE q."quizId" = p_quiz_id
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_questions) e
                          WHERE e->>'id' = q.id AND NOT coalesce((e->>'isNew')::boolean, false));
    END IF;

    FOR v_q IN SELECT value FROM jsonb_array_elements(p_questions) LOOP
      v_i := v_i + 1;
      IF coalesce((v_q->>'isNew')::boolean, false) THEN
        -- One millisecond apart in display order: questions are listed by createdAt
        INSERT INTO "Question" (id, "quizId", text, options, "correctOption", "hasCorrectAnswer", status, "createdAt", "updatedAt")
        VALUES (v_q->>'id', p_quiz_id, v_q->>'text', v_q->>'options', (v_q->>'correctOption')::int, false,
                v_q->>'status', clock_timestamp() + v_i * interval '1 millisecond', now());
      ELSE
        UPDATE "Question" SET
          text = v_q->>'text',
          status = v_q->>'status',
          options = CASE WHEN v_q ? 'options' THEN v_q->>'options' ELSE options END,
          "correctOption" = CASE WHEN "hasCorrectAnswer" THEN "correctOption" ELSE (v_q->>'correctOption')::int END,
          "updatedAt" = now()
        WHERE id = v_q->>'id' AND "quizId" = p_quiz_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION '%', 'stale:A question of this quiz was removed in the meantime. Reload the quiz and try again.';
        END IF;
      END IF;
    END LOOP;

    INSERT INTO "QuizAdminSettings" ("quizId", "maxEntries", "pointsPool", "updatedAt")
    VALUES (p_quiz_id, (p_settings->>'maxEntries')::int, (p_settings->>'pointsPool')::int, now())
    ON CONFLICT ("quizId") DO UPDATE
      SET "maxEntries" = EXCLUDED."maxEntries", "pointsPool" = EXCLUDED."pointsPool", "updatedAt" = now();
  EXCEPTION
    -- Everything above is undone
    WHEN restrict_violation THEN
      RETURN jsonb_build_object('success', false, 'code', 'question_answered', 'error', SQLERRM);
    WHEN raise_exception THEN
      RETURN jsonb_build_object('success', false, 'code', split_part(SQLERRM, ':', 1), 'error', substr(SQLERRM, strpos(SQLERRM, ':') + 1));
  END;

  RETURN jsonb_build_object('success', true, 'quizId', p_quiz_id);
END $function$;
REVOKE ALL ON FUNCTION public.save_quiz(text, boolean, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_quiz(text, boolean, jsonb, jsonb, jsonb) TO service_role;

-- ── 2. save_quiz_result ──────────────────────────────────────────────────────────────────────────
-- p_answers: { "<question id>": <correct option>, ... } for every active question of the quiz, and nothing else.
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
  v_answer record;
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

  FOR v_answer IN SELECT key, value FROM jsonb_each_text(p_answers) LOOP
    PERFORM public.evaluate_question(v_answer.key, v_answer.value::int);
  END LOOP;
  PERFORM public.finalize_quiz_scores(p_quiz_id);
  RETURN jsonb_build_object('success', true);
END $function$;
REVOKE ALL ON FUNCTION public.save_quiz_result(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_quiz_result(text, jsonb) TO service_role;
