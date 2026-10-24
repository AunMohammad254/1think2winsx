-- =============================================================================
-- Admin action log for quizzes
--
-- Applied to production (eclivawqhdovsndlngfo) on 2026-10-24 as migration 20261024191149, owner-approved,
-- before the code that writes to it (PR #66) was deployed with main f1007ec. The code copes without the
-- table all the same: a failed log write is only reported in the server log, never shown to the admin
-- as a failed action.
--
-- Why (F5 in the quiz deep dive): nothing stored who pushed, paused, edited, saved the result of or
-- deleted a quiz; only settlement kept "settledBy". Each of those admin actions now adds a row here,
-- shown on the admin quiz page's History tab.
--
-- Append-only for the app: the service role can add and read rows, never change or delete them. No
-- foreign key to "Quiz": the record of a deleted quiz is the one most worth keeping.
--
-- Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public."AdminActionLog" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "quizId" text,
  "quizTitle" text,
  action text NOT NULL CHECK (action ~ '^[a-z_]{1,40}$'),
  "adminEmail" text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "AdminActionLog_quizId_createdAt_idx" ON public."AdminActionLog" ("quizId", "createdAt" DESC);

ALTER TABLE public."AdminActionLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."AdminActionLog" FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public."AdminActionLog" TO service_role;
