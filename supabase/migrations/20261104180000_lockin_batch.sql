-- =============================================================================
-- Lock-ins saved in batches from the edge queue
--
-- NOT applied yet: needs the owner's OK before it runs on production (eclivawqhdovsndlngfo). Nothing calls it
-- until the edge-shield Worker's LOCKIN_EDGE switch is on, so the live build works the same with or without it.
--
-- For a crowd of 50,000 players, lock-ins never reach Hostinger: the edge-shield Worker checks the player's
-- session, stamps the time it received the lock-in, and puts it on a Cloudflare Queue. The queue's consumer
-- calls submit_lockin_batch with up to 100 lock-ins of one quiz (load-tested locally: 50,000 players in 72 s on a
-- Micro-sized database, 4 consumers).
--
-- 1. "LockinDrain": per quiz, how many queued lock-ins the database has processed, whatever their outcome.
--    Results and settlement wait until it reaches the number the edge received.
-- 2. private_hardened.submit_lockin_batch, and public.submit_lockin_batch for PostgREST. Service role only: the
--    Worker vouches for each player id (it verified the JWT). submit_quiz_attempt's rules, judged at the time
--    the edge received each lock-in ("t"), not when the batch arrives:
--    - the answering window, pushedAt + duration + 30 s. The scheduler pauses a quiz as its grace ends, so a
--      paused quiz still takes lock-ins received before its window ended and before it was paused ("updatedAt")
--    - a day pass valid at "t" when the wallet is on and the quiz isn't free
--    - every answer to an open question of this quiz (no saved result, "closesAt" after "t"), once, option 0-9
--    - the entry limit, first come first served by "t". The quiz's counter row is locked once per batch, and
--      before existing attempts are looked up, so two batches holding the same new player (a lock-in and its
--      retry) run one after the other
--    - a player's earliest pick wins: in a batch, and across batches (an earlier-received pick replaces a later
--      one saved first, while the question has no result)
--    - each refused player gets a bell notice (type quiz_attempt)
-- Times stored without a time zone ("completedAt", "attemptedAt", "expiresAt", "updatedAt") hold UTC, as the
-- app writes them, and are compared as UTC here. Safe to re-run.
-- =============================================================================

-- 1. Drain counter --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."LockinDrain" (
  "quizId" text PRIMARY KEY REFERENCES public."Quiz"(id) ON DELETE CASCADE,
  processed integer NOT NULL DEFAULT 0 CHECK (processed >= 0),
  "lastBatchAt" timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public."LockinDrain" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."LockinDrain" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public."LockinDrain" TO service_role;

-- 2. The batch save -------------------------------------------------------------------------------
--   p_items: [{ "u": userId, "t": receivedAt (ISO, from Date.toISOString()), "a": [{ "q": questionId, "o": option }] }]
--   returns: [{ "u": userId, "s": status, "n": answers saved }] in the order sent
--   status:  saved | reattempt | duplicate | closed | entries_closed | invalid | payment_required | not_found
CREATE OR REPLACE FUNCTION private_hardened.submit_lockin_batch(p_quiz_id text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quiz record;
  v_is_match boolean;
  v_wallet boolean;
  v_entries int;
  v_free int;
  v_cutoff timestamptz;
  v_open boolean;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid batch: 1 to 500 lock-ins' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS lockin_batch (
    n int PRIMARY KEY, uid text, at timestamptz, answers jsonb,
    status text, existing text, attempt_id text, payment_id text, inserted int NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE lockin_batch;
  -- Nothing here can throw on a bad item: a bad "u", "t" or "a" makes that lock-in invalid, not the batch
  INSERT INTO lockin_batch (n, uid, at, answers)
  SELECT x.ord,
         CASE WHEN jsonb_typeof(x.e->'u') = 'string' AND length(x.e->>'u') BETWEEN 1 AND 100 THEN x.e->>'u' END,
         CASE WHEN x.e->>'t' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' THEN (x.e->>'t')::timestamptz END,
         x.e->'a'
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(e, ord);

  SELECT id, title, status, duration, "pushedAt", "freeEntry", "updatedAt" INTO v_quiz
    FROM "Quiz" WHERE id = p_quiz_id FOR KEY SHARE;
  IF NOT FOUND THEN
    UPDATE lockin_batch SET status = 'not_found';
    RETURN (SELECT jsonb_agg(jsonb_build_object('u', uid, 's', status, 'n', 0) ORDER BY n) FROM lockin_batch);
  END IF;
  v_is_match := EXISTS (SELECT 1 FROM "LiveMatch" WHERE "quizId" = p_quiz_id);

  -- Taking answers: active, or paused once its window was set (the scheduler pauses as the grace ends)
  v_open := v_quiz.status = 'active'
    OR (v_quiz.status = 'paused' AND NOT v_is_match AND v_quiz."pushedAt" IS NOT NULL AND v_quiz.duration IS NOT NULL);
  IF NOT v_open THEN
    UPDATE lockin_batch SET status = 'not_found';
  END IF;

  -- A player's later copies in this batch (a retry, a second tab): the earliest received counts
  UPDATE lockin_batch l SET status = 'duplicate'
    FROM (SELECT n, row_number() OVER (PARTITION BY uid ORDER BY at, n) AS rn FROM lockin_batch WHERE uid IS NOT NULL) d
   WHERE d.n = l.n AND d.rn > 1 AND l.status IS NULL;

  -- The shape of each lock-in, before anything casts it
  UPDATE lockin_batch l SET status = 'invalid'
   WHERE l.status IS NULL AND (
     l.uid IS NULL OR l.at IS NULL
     OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = l.uid)
     OR jsonb_typeof(l.answers) IS DISTINCT FROM 'array'
     OR jsonb_array_length(l.answers) NOT BETWEEN 1 AND 200
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(l.answers) e
                 WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'q') IS DISTINCT FROM 'string'
                    OR length(e->>'q') NOT BETWEEN 1 AND 100 OR (e->>'o') !~ '^[0-9]$')
     OR (SELECT count(DISTINCT e->>'q') FROM jsonb_array_elements(l.answers) e) <> jsonb_array_length(l.answers));

  -- Answering window at "t"
  IF NOT v_is_match AND v_quiz."pushedAt" IS NOT NULL AND v_quiz.duration IS NOT NULL THEN
    v_cutoff := v_quiz."pushedAt" + make_interval(mins => v_quiz.duration) + interval '30 seconds';
    IF v_quiz.status = 'paused' THEN
      v_cutoff := LEAST(v_cutoff, v_quiz."updatedAt" AT TIME ZONE 'UTC');
    END IF;
    UPDATE lockin_batch SET status = 'closed' WHERE status IS NULL AND at > v_cutoff;
  END IF;

  -- Day pass valid at "t", when the wallet is on and the quiz isn't free
  SELECT (value IS DISTINCT FROM 'false') INTO v_wallet FROM "AppSettings" WHERE key = 'wallet_enabled';
  IF COALESCE(v_wallet, true) AND NOT v_quiz."freeEntry" THEN
    UPDATE lockin_batch l SET payment_id = (
      SELECT p.id FROM "DailyPayment" p
       WHERE p."userId" = l.uid AND p.status = 'completed' AND p."expiresAt" > (l.at AT TIME ZONE 'UTC')
       ORDER BY p."expiresAt" DESC LIMIT 1)
     WHERE l.status IS NULL;
    UPDATE lockin_batch SET status = 'payment_required' WHERE status IS NULL AND payment_id IS NULL;
  END IF;

  -- Every answer to an open question of this quiz (all or nothing per lock-in, as submit_quiz_attempt does)
  UPDATE lockin_batch l SET status = 'invalid'
   WHERE l.status IS NULL AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(l.answers) e
     LEFT JOIN "Question" q ON q.id = e->>'q' AND q."quizId" = p_quiz_id AND q.status = 'active'
          AND q."hasCorrectAnswer" = false AND (q."closesAt" IS NULL OR q."closesAt" > l.at)
     WHERE q.id IS NULL);

  -- One lock on the quiz's counter row for the whole batch, taken BEFORE looking for existing attempts
  INSERT INTO "QuizEntryCount" ("quizId") VALUES (p_quiz_id) ON CONFLICT ("quizId") DO NOTHING;
  SELECT entries INTO v_entries FROM "QuizEntryCount" WHERE "quizId" = p_quiz_id FOR UPDATE;

  UPDATE lockin_batch l SET existing = a.id
    FROM "QuizAttempt" a WHERE l.status IS NULL AND a."userId" = l.uid AND a."quizId" = p_quiz_id;

  -- New players: first come (by "t"), first served, up to the entry limit
  IF EXISTS (SELECT 1 FROM lockin_batch WHERE status IS NULL AND existing IS NULL) THEN
    v_free := GREATEST(0, private_hardened.quiz_entry_limit(p_quiz_id) - v_entries);
    UPDATE lockin_batch l SET status = 'entries_closed'
      FROM (SELECT n, row_number() OVER (ORDER BY at, n) AS rn FROM lockin_batch WHERE status IS NULL AND existing IS NULL) r
     WHERE r.n = l.n AND r.rn > v_free;
    UPDATE lockin_batch SET attempt_id = 'qa_' || gen_random_uuid()::text WHERE status IS NULL AND existing IS NULL;
    -- One statement: the counter trigger (count_quiz_entries) moves the count once for the batch
    INSERT INTO "QuizAttempt" (id, "userId", "quizId", score, points, "isCompleted", "isEvaluated",
                               "completedAt", "dailyPaymentId", "createdAt", "updatedAt")
    SELECT attempt_id, uid, p_quiz_id, 0, 0, true, false, at AT TIME ZONE 'UTC', payment_id, now(), now()
      FROM lockin_batch WHERE attempt_id IS NOT NULL;
  END IF;

  -- The answers. An earlier-received pick replaces a later one saved first (the question has no result yet:
  -- checked above), so a second tab's picks never win over the first tab's
  WITH ins AS (
    INSERT INTO "QuestionAttempt" (id, "userId", "questionId", "quizId", "selectedOption", "isCorrect", "attemptedAt")
    SELECT 'qat_' || gen_random_uuid()::text, l.uid, e->>'q', p_quiz_id, (e->>'o')::int, false, l.at AT TIME ZONE 'UTC'
      FROM lockin_batch l, jsonb_array_elements(l.answers) e
     WHERE l.status IS NULL
    ON CONFLICT ("userId", "questionId") DO UPDATE
       SET "selectedOption" = EXCLUDED."selectedOption", "attemptedAt" = EXCLUDED."attemptedAt"
     WHERE "QuestionAttempt"."attemptedAt" > EXCLUDED."attemptedAt"
    RETURNING "userId"
  )
  UPDATE lockin_batch l SET inserted = c.k
    FROM (SELECT "userId", count(*)::int AS k FROM ins GROUP BY 1) c
   WHERE c."userId" = l.uid AND l.status IS NULL;

  -- A re-attempt that saved answers moves its attempt's time, as submit_quiz_attempt does
  UPDATE "QuizAttempt" a SET "completedAt" = l.at AT TIME ZONE 'UTC', "isEvaluated" = false, "updatedAt" = now()
    FROM lockin_batch l WHERE l.existing = a.id AND l.status IS NULL AND l.inserted > 0;

  UPDATE lockin_batch SET status = CASE WHEN existing IS NULL THEN 'saved' ELSE 'reattempt' END WHERE status IS NULL;

  -- A bell notice for each refused player (one per player; copies of a lock-in get none)
  INSERT INTO "Notification" (id, "userId", title, message, type, link)
  SELECT 'ntf_' || gen_random_uuid()::text, l.uid, 'Answers not saved',
         CASE l.status
           WHEN 'closed' THEN format('Your answers to "%s" arrived after the quiz closed, so they were not saved.', v_quiz.title)
           WHEN 'entries_closed' THEN format('Entries for "%s" had closed before your answers arrived, so they were not saved.', v_quiz.title)
           WHEN 'payment_required' THEN format('Your answers to "%s" were not saved: this quiz needs a day pass.', v_quiz.title)
           WHEN 'not_found' THEN format('Your answers to "%s" were not saved: the quiz had stopped taking answers.', v_quiz.title)
           ELSE format('Your answers to "%s" were not saved: a question had closed. Open the quiz to answer again.', v_quiz.title)
         END,
         'quiz_attempt', '/quizzes'
    FROM (SELECT DISTINCT ON (uid) uid, status FROM lockin_batch
           WHERE status IN ('closed', 'entries_closed', 'payment_required', 'not_found', 'invalid') AND uid IS NOT NULL
           ORDER BY uid, n) l
   WHERE EXISTS (SELECT 1 FROM "User" u WHERE u.id = l.uid);

  -- Every lock-in of the batch counts as processed, whatever its outcome
  INSERT INTO "LockinDrain" ("quizId", processed, "lastBatchAt") VALUES (p_quiz_id, jsonb_array_length(p_items), now())
  ON CONFLICT ("quizId") DO UPDATE SET processed = "LockinDrain".processed + EXCLUDED.processed, "lastBatchAt" = now();

  RETURN (SELECT jsonb_agg(jsonb_build_object('u', uid, 's', status, 'n', inserted) ORDER BY n) FROM lockin_batch);
END $function$;
REVOKE ALL ON FUNCTION private_hardened.submit_lockin_batch(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_hardened.submit_lockin_batch(text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_lockin_batch(p_quiz_id text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN private_hardened.submit_lockin_batch(p_quiz_id := p_quiz_id, p_items := p_items);
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_lockin_batch(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_lockin_batch(text, jsonb) TO service_role;
