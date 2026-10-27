-- =============================================================================
-- A returning player's sign-up takes over their old "User" row again
--
-- Applied to production (eclivawqhdovsndlngfo) on 2026-10-25 as migration 20261025111518, owner-approved.
-- No code goes with it. Checked after: every foreign key to "User" cascades, the account has its row
-- (with its 55 notifications), and a lock-in as that player, rolled back, returned success.
--
-- Why: a player whose auth account had been deleted signed up again with Google (2026-10-19), and
-- every "Lock in answer" since failed with "Failed to submit quiz". The database log said
-- QuizAttempt_userId_fkey: the account had no "User" row. The on_auth_user_created trigger
-- (public.handle_new_user) hands the "User" row that already has the email to the new auth id by
-- changing that row's id. Six foreign keys to "User"(id) did not cascade id changes, so the change
-- failed as soon as the old row had any of their rows (this player had 55 notifications). The trigger
-- turns the error into a warning and lets the sign-up through, which left the account with no row,
-- and every write that needs one (an attempt, a payment, ...) failed.
--
-- 1. Those six foreign keys now cascade id changes, as the other seven already did.
-- 2. Repairs the accounts already caught (one on 2026-10-25): an auth user with no "User" row takes over
--    the row with its email when no auth user has that row's id any more, or else gets a new row, as
--    the trigger would have made.
--
-- Safe to re-run.
-- =============================================================================

-- ── 1. Foreign keys to "User"(id) follow an id change ────────────────────────────────────────────
-- Same ON DELETE CASCADE as before
ALTER TABLE public."Notification" DROP CONSTRAINT IF EXISTS "Notification_userId_fkey",
  ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."PushSubscription" DROP CONSTRAINT IF EXISTS "PushSubscription_userId_fkey",
  ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."QuizWinner" DROP CONSTRAINT IF EXISTS "QuizWinner_userId_fkey",
  ADD CONSTRAINT "QuizWinner_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."ScheduledNotification" DROP CONSTRAINT IF EXISTS "ScheduledNotification_targetUserId_fkey",
  ADD CONSTRAINT "ScheduledNotification_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."SupportTicket" DROP CONSTRAINT IF EXISTS "SupportTicket_userId_fkey",
  ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."QuizPoolShare" DROP CONSTRAINT IF EXISTS "QuizPoolShare_userId_fkey",
  ADD CONSTRAINT "QuizPoolShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- ── 2. Accounts already left without a "User" row ────────────────────────────────────────────────
-- The row with their email, when its own auth user is gone (what the trigger meant to do)
UPDATE public."User" u SET id = au.id::text, "updatedAt" = now()
  FROM auth.users au
 WHERE u.email = au.email
   AND NOT EXISTS (SELECT 1 FROM public."User" x WHERE x.id = au.id::text)
   AND NOT EXISTS (SELECT 1 FROM auth.users o WHERE o.id::text = u.id);

-- Otherwise a new row, as the trigger inserts one. An email another row still holds is left alone.
INSERT INTO public."User" (id, email, name, "createdAt", "updatedAt")
SELECT au.id::text, au.email, COALESCE(au.raw_user_meta_data->>'name', au.raw_user_meta_data->>'full_name'), now(), now()
  FROM auth.users au
 WHERE NOT EXISTS (SELECT 1 FROM public."User" x WHERE x.id = au.id::text)
ON CONFLICT DO NOTHING;
