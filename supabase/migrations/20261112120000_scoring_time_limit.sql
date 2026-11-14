-- =============================================================================
-- A time limit of their own for the three functions that update every answer of a quiz
--
-- NOT applied to production yet (written 2026-11-12). It needs the owner's OK, and one read-only check
-- first: which statement_timeout production's roles carry today,
--   SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('authenticator', 'service_role');
-- If service_role already has one above 25 s there, this migration would shorten these three calls: stop
-- and decide which limit should win.
--
-- Why. The server calls these three with the service-role key through the Data API. On Supabase's
-- defaults that role has no limit of its own and falls back to authenticator's 8 seconds
-- (https://supabase.com/docs/guides/database/postgres/timeouts, read 2026-11-12). Each of them runs one
-- UPDATE over every "QuestionAttempt" row of an over, or of a whole quiz:
--   apply_match_change  the ball that ends an over marks every answer to that over's questions
--   save_quiz_result    marks every answer of the quiz
--   settle_quiz         counts and ranks every attempt, then pays
-- With 50,000 players that is 100,000 rows for an over and up to 1,000,000 for a 20-question quiz. The
-- one measurement there is (0.23 s for 40,000 rows on the smallest instance, nothing else running) puts a
-- million rows near 6 s in a calm database and past 8 s in a busy one. Past the limit the statement is
-- cancelled and nothing is saved: the scorer's ball or the admin's Settle fails, and trying again meets
-- the same limit.
--
-- Why 25 seconds. It is under the 30 s the server waits for a service-role call
-- (SUPABASE_ADMIN_FETCH_TIMEOUT_MS, src/lib/supabase/timeout-fetch.ts), so the database answers before
-- the app stops waiting. The other way round, the app would report a failure for a settlement that then
-- goes through. Supabase caps what a Data API call can be given at 60 s (same page).
--
-- How it takes effect. PostgREST reads a function's statement_timeout and applies it to the call's
-- transaction ("hoisting", https://docs.postgrest.org/en/stable/references/transactions.html, read
-- 2026-11-12). Plain SQL callers (psql, the tests) keep their session's limit: Postgres starts the timer
-- when the statement starts, before the function's setting is read.
--
-- Keep it. CREATE OR REPLACE FUNCTION replaces a function's settings with those in the new definition,
-- so a later migration that re-creates one of these three must carry SET statement_timeout TO '25s'
-- next to its search_path. db-tests/scoring-time-limit.test.ts fails when one loses it.
--
-- Changes no function body (the md5 guards of other migrations still match) and no privileges.
-- Safe to re-run.
-- =============================================================================

ALTER FUNCTION public.apply_match_change(text, integer, jsonb)
  SET statement_timeout TO '25s';

ALTER FUNCTION public.save_quiz_result(text, jsonb)
  SET statement_timeout TO '25s';

ALTER FUNCTION public.settle_quiz(text, jsonb, text, text, text, boolean, numeric, integer)
  SET statement_timeout TO '25s';
