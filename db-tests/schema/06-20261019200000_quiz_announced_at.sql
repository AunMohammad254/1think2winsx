-- NOT YET APPLIED TO PRODUCTION. The app works before and after it: the quiz catalogue reads
-- `select *`, so until the column exists announced quizzes just don't show on the stream, and
-- setting it on announcement only logs an error.
--
-- When the admin announces a scheduled quiz ("Notify upcoming") or the 10-minute warning goes out,
-- the server sets Quiz."announcedAt". The public quiz snapshot (GET /api/live) then lists that
-- quiz as "upcoming" with its title and start time only (never its questions), and players
-- watching the stream get the upcoming-quiz pop-up. A new value (a forced re-announcement, or the
-- 10-minute warning after the admin's notice) pops it up again.
--
-- Nullable, no default, no backfill: quizzes announced before this column existed simply stay
-- hidden until they go live, as they did before. Safe to re-run.
ALTER TABLE public."Quiz" ADD COLUMN IF NOT EXISTS "announcedAt" timestamp with time zone;

COMMENT ON COLUMN public."Quiz"."announcedAt" IS
  'When players were last told this scheduled quiz is coming up; lists it as upcoming on the stream.';
