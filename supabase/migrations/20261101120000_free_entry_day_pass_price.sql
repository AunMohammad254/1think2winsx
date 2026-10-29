-- =============================================================================
-- Free-entry quizzes never set the day pass price
--
-- Not applied to production yet.
--
-- pay_quiz_access charges the price of the quiz it is given, or else of the OLDEST active quiz. A live
-- match's quiz (match mode, migration 20261029120000_match_mode) has free entry and the default price,
-- and stays active for hours while its match is played: taken live before the day's other quizzes, it
-- became the oldest active quiz, and the day pass cost its price instead of theirs. A free-entry quiz
-- needs no day pass, so its price never says what one costs: both lookups now skip it.
-- src/lib/wallet/service.ts (getQuizAccessPrice) and the chatbot quote the price the same way.
--
-- Everything else is unchanged, and so are its privileges (CREATE OR REPLACE keeps them).
-- Not safe to re-run: the guard below stops a second run.
-- =============================================================================

-- ── 0. Refuse to run if pay_quiz_access changed since this migration was written ─────────────────
-- It is re-created from production's version (db-tests/schema/03c-functions.sql), by whitespace-
-- insensitive md5 of the body. A second run finds this migration's version and stops.
DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc
   WHERE oid = to_regprocedure('public.pay_quiz_access(text)');
  IF v_md5 IS DISTINCT FROM 'd36b2e2016908b99caf1712923a47ece' THEN
    RAISE EXCEPTION 'public.pay_quiz_access is not the version this migration was written against (body md5 %): merge the change into the migration first',
      coalesce(v_md5, 'missing');
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.pay_quiz_access(p_quiz_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid()::text;
  v_price double precision;
  v_balance double precision;
  v_existing record;
  v_payment_id text := 'dp_' || gen_random_uuid()::text;
  v_expires timestamp := (now() AT TIME ZONE 'utc') + interval '24 hours';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Serialise per user so double-clicks can't double-charge.
  PERFORM pg_advisory_xact_lock(hashtext('pay:' || v_uid));

  SELECT id, "expiresAt" INTO v_existing FROM "DailyPayment"
   WHERE "userId" = v_uid AND status = 'completed' AND "expiresAt" > now()
   ORDER BY "expiresAt" DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'alreadyActive', true, 'paymentId', v_existing.id, 'expiresAt', v_existing."expiresAt");
  END IF;

  -- A free-entry quiz (a live match) needs no day pass, so its price never sets one
  SELECT COALESCE(
           (SELECT "accessPrice" FROM "Quiz" WHERE id = p_quiz_id AND status = 'active' AND NOT "freeEntry"),
           (SELECT "accessPrice" FROM "Quiz" WHERE status = 'active' AND NOT "freeEntry" ORDER BY "createdAt" LIMIT 1),
           2.0)
    INTO v_price;

  SELECT "walletBalance" INTO v_balance FROM "User" WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  IF v_balance < v_price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient wallet balance', 'insufficientBalance', true,
                              'requiredAmount', v_price, 'currentBalance', v_balance);
  END IF;

  UPDATE "User" SET "walletBalance" = "walletBalance" - v_price, "updatedAt" = now() WHERE id = v_uid;

  INSERT INTO "WalletTransaction" (id, "userId", amount, "paymentMethod", "transactionId", status, type,
                                   "adminNotes", "processedAt", "createdAt", "updatedAt")
  VALUES ('wt_' || gen_random_uuid()::text, v_uid, -v_price, 'QuizAccess', 'quiz_access_' || v_payment_id,
          'approved', 'quiz_access',
          CASE WHEN p_quiz_id IS NULL THEN '24-hour quiz access payment' ELSE 'Quiz access payment for quiz: ' || p_quiz_id END,
          now(), now(), now());

  INSERT INTO "DailyPayment" (id, "userId", amount, status, "paymentMethod", "transactionId", "expiresAt", "createdAt", "updatedAt")
  VALUES (v_payment_id, v_uid, v_price, 'completed', 'wallet', 'wallet_' || v_payment_id, v_expires, now(), now());

  RETURN jsonb_build_object('success', true, 'paymentId', v_payment_id, 'amount', v_price,
                            'newBalance', v_balance - v_price, 'expiresAt', v_expires);
END $function$;
