-- =============================================================================
-- Player reviews, shown on the home page once an admin approves them
--
-- NOT APPLIED YET. Apply it to production before deploying the code that uses it (src/lib/reviews.ts,
-- /api/reviews, /admin/reviews). The code live before it never touches this table. A database without
-- it: the home page's reviews section shows its "no reviews yet" state, sending a review fails with
-- "Could not save your review", and /admin/reviews shows a load error. Nothing else is affected.
--
-- A signed-in player writes one review (stars, a comment, the name to show and optionally a city) in
-- the Review modal. It starts as pending; an admin approves or rejects it on /admin/reviews, and the
-- player gets a notification. Only approved reviews are public. Editing a review sends it back to
-- pending, so an approved text can't be swapped for something else without another look.
--
-- Only the service role reads or writes this table: the server takes the player's id from the session
-- and the public list is served by /api/reviews, so RLS is on with no policies and anon /
-- authenticated get no privileges. A review goes with its player (ON DELETE CASCADE) and follows an id
-- change like every other foreign key to "User" (migration 20261025120000_cascade_user_id_changes).
--
-- Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public."Review" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One review per player: writing again edits it
  "userId" text NOT NULL UNIQUE REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 10 AND 500),
  -- What the home page shows instead of the account name (players choose it)
  "displayName" text NOT NULL CHECK (char_length(btrim("displayName")) BETWEEN 2 AND 40),
  city text CHECK (city IS NULL OR char_length(btrim(city)) BETWEEN 2 AND 40),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  -- Shown to the player with a rejection; "moderatedBy" (the admin's email) is not
  "moderationNote" text CHECK ("moderationNote" IS NULL OR char_length("moderationNote") <= 300),
  "moderatedAt" timestamp with time zone,
  "moderatedBy" text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."Review" IS
  'Player reviews of 1Think 2Win. Public only once approved on /admin/reviews. Service role only.';

-- The admin list (by status, newest first) and the public list (approved, newest first)
CREATE INDEX IF NOT EXISTS "Review_status_createdAt_idx"
  ON public."Review" USING btree (status, "createdAt" DESC);

ALTER TABLE public."Review" ENABLE ROW LEVEL SECURITY;
-- New public tables get no grants on this project. Revoking from anon/authenticated as well covers a
-- project whose default privileges do grant them.
REVOKE ALL ON public."Review" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Review" TO service_role;
