-- =============================================================================
-- Match mode: Auto / Manual quizzes, the quiz language, how much Gemini a match asks for, and Gemini's
-- wording kept beside the drafts
--
-- Applied to production (eclivawqhdovsndlngfo) on 2026-11-06 as migration 20261106032344, owner-approved, BEFORE
-- the code that uses it was deployed. Checked after: the three columns exist with their defaults on all 6
-- matches, update_match_extras is SECURITY DEFINER and callable only by the service role, and
-- apply_match_change was untouched (md5 db7793e7a9570d0c68e0d3063134c269). The code live before it keeps working
-- on the migrated database: it never reads or writes them.
--
-- Each over's quiz is now prepared an over ahead and goes out on a ball the admin picks (or Auto's ball 1),
-- with Gemini wording it after the scorer's ball is saved (src/lib/match-service.ts). So:
--
-- 1. "LiveMatch".language: how players see the questions: 'both' (Roman Urdu, English under it), 'en' or 'ur'.
--    "LiveMatch"."aiLevel": how much Gemini words: 'full' (every over), 'half' (every other over) or 'off'.
--    "LiveMatch".wordings: Gemini's wording of the drafts, by draft id: { "<id>": { "text", "textRomanUrdu" } }
--    or { "<id>": { "failed": true } }. Kept apart from drafts, which apply_match_change replaces whole:
--    Gemini answers after the ball is saved, so the scorer's next ball must neither wait for it nor overwrite it.
-- 2. public.update_match_extras(p_match_id, p_change) saves those three WITHOUT changing the match's version:
--    they change neither the score nor its questions, so a scorer's next ball is never refused for them.
--      language: 'both' | 'en' | 'ur'      aiLevel: 'full' | 'half' | 'off'
--      wordings: { id: wording }, merged into the match's; only those of drafts it still has are kept
--    Returns { success, code?, error? } like apply_match_change. Service role only.
--
-- apply_match_change is untouched. Safe to re-run.
-- =============================================================================

-- ── 1. The columns ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."LiveMatch"
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'both' CHECK (language IN ('both', 'en', 'ur')),
  ADD COLUMN IF NOT EXISTS "aiLevel" text NOT NULL DEFAULT 'full' CHECK ("aiLevel" IN ('full', 'half', 'off')),
  ADD COLUMN IF NOT EXISTS wordings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(wordings) = 'object');

-- ── 2. Saving them ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_match_extras(p_match_id text, p_change jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF jsonb_typeof(p_change) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'A match change must be a JSON object');
  END IF;
  IF p_change ? 'language' AND NOT coalesce(p_change->>'language' IN ('both', 'en', 'ur'), false) THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'The language must be both, en or ur');
  END IF;
  IF p_change ? 'aiLevel' AND NOT coalesce(p_change->>'aiLevel' IN ('full', 'half', 'off'), false) THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'The AI level must be full, half or off');
  END IF;
  IF p_change ? 'wordings' AND jsonb_typeof(p_change->'wordings') IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Wordings must be a JSON object');
  END IF;

  UPDATE "LiveMatch" m
     SET language = coalesce(p_change->>'language', m.language),
         "aiLevel" = coalesce(p_change->>'aiLevel', m."aiLevel"),
         -- Merged, then only the wordings of drafts the match still has (sent ones are on their questions)
         wordings = CASE WHEN p_change ? 'wordings' THEN (
           SELECT coalesce(jsonb_object_agg(w.key, w.value), '{}'::jsonb)
             FROM jsonb_each(m.wordings || (p_change->'wordings')) AS w
            WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(m.drafts) AS d WHERE d->>'id' = w.key)
         ) ELSE m.wordings END,
         "updatedAt" = now()
   WHERE m.id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Match not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END $function$;

REVOKE ALL ON FUNCTION public.update_match_extras(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_extras(text, jsonb) TO service_role;
