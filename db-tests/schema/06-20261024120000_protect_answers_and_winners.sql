-- =============================================================================
-- Protect players' answers and quiz winners from admin edits and deletes
--
-- NOT applied to production yet. The app already refuses the same changes on its own
-- (src/lib/question-guard.ts and deletePrize in src/actions/prizes.ts), so the code can deploy first;
-- this is the safety net under every path, the SQL editor and future code included.
--
-- 1. A question that players answered can't be deleted, and its options can't change. Answers are
--    stored as option numbers and cascade with their question, so either change silently deleted or
--    re-mapped players' predictions. The wording and the status can still change. Deleting a whole quiz
--    still works: the cascade from "Quiz" reaches its questions after the quiz row is gone.
-- 2. A prize that was won in a quiz can't be deleted. "QuizWinner"."prizeId" was ON DELETE CASCADE, so
--    deleting the prize deleted the record of who won it. Deactivate the prize instead.
--
-- Safe to re-run.
-- =============================================================================

-- ── 1. Answered questions ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private_hardened.protect_answered_question()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The whole quiz is being deleted (its row is already gone): a separate decision, not blocked here
    IF NOT EXISTS (SELECT 1 FROM "Quiz" WHERE id = OLD."quizId") THEN
      RETURN OLD;
    END IF;
  ELSIF NEW.options IS NOT DISTINCT FROM OLD.options THEN
    RETURN NEW;
  END IF;
  -- Both tables: submit_quiz_attempt writes each answer to both, and older rows may be in only one
  IF EXISTS (SELECT 1 FROM "QuestionAttempt" WHERE "questionId" = OLD.id)
     OR EXISTS (SELECT 1 FROM "Answer" WHERE "questionId" = OLD.id) THEN
    RAISE EXCEPTION 'Players have already answered question %: it can''t be deleted and its options can''t change', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION private_hardened.protect_answered_question() FROM PUBLIC;

DROP TRIGGER IF EXISTS protect_answered_question ON public."Question";
CREATE TRIGGER protect_answered_question
  BEFORE DELETE OR UPDATE OF options ON public."Question"
  FOR EACH ROW EXECUTE FUNCTION private_hardened.protect_answered_question();

-- ── 2. Prizes won in a quiz ──────────────────────────────────────────────────────────────────────
ALTER TABLE public."QuizWinner" DROP CONSTRAINT IF EXISTS "QuizWinner_prizeId_fkey";
ALTER TABLE public."QuizWinner" ADD CONSTRAINT "QuizWinner_prizeId_fkey"
  FOREIGN KEY ("prizeId") REFERENCES public."Prize"(id) ON DELETE RESTRICT;
