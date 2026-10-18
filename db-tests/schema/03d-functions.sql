-- Test baseline: verbatim copy of the 2026-10-09 read-only dump of the live schema.
-- Do not edit by hand: see db-tests/README.md ("Updating the baseline").
-- 03d: functions 43-56. Generated read-only from production catalog.
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.process_deposit_request(p_transaction_db_id text, p_action text, p_admin_email text, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transaction record;
  v_new_balance float;
BEGIN
  -- Fetch transaction
  SELECT * INTO v_transaction
  FROM "public"."WalletTransaction"
  WHERE "id" = p_transaction_db_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Transaction not found');
  END IF;

  IF v_transaction."status" != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Transaction is already processed');
  END IF;

  IF p_action = 'approve' THEN
    -- Update transaction status
    UPDATE "public"."WalletTransaction"
    SET
      "status" = 'approved',
      "processedAt" = now(),
      "processedBy" = p_admin_email,
      "updatedAt" = now()
    WHERE "id" = p_transaction_db_id;

    -- Update user balance using the userId (CUID) from the transaction
    UPDATE "public"."User"
    SET
      "walletBalance" = COALESCE("walletBalance", 0) + v_transaction."amount",
      "updatedAt" = now()
    WHERE "id" = v_transaction."userId"
    RETURNING "walletBalance" INTO v_new_balance;

    IF v_new_balance IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'User not found for balance update');
    END IF;

    RETURN json_build_object(
      'success', true,
      'status', 'approved',
      'new_balance', v_new_balance
    );

  ELSIF p_action = 'reject' THEN
    -- Update transaction status only
    UPDATE "public"."WalletTransaction"
    SET
      "status" = 'rejected',
      "processedAt" = now(),
      "processedBy" = p_admin_email,
      "adminNotes" = p_notes,
      "updatedAt" = now()
    WHERE "id" = p_transaction_db_id;

    RETURN json_build_object('success', true, 'status', 'rejected');

  ELSE
    RETURN json_build_object('success', false, 'error', 'Invalid action. Use approve or reject.');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', 'An error occurred: ' || SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_wallet_transaction(p_transaction_id text, p_action text, p_admin_email text, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transaction record;
  v_new_balance float;
  v_user_email text;
BEGIN
  -- Fetch the transaction
  SELECT w.*, u.email as user_email
  INTO v_transaction
  FROM "public"."WalletTransaction" w
  JOIN "public"."User" u ON w."userId" = u.id
  WHERE w.id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Transaction not found');
  END IF;

  IF v_transaction.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Transaction is already processed');
  END IF;

  v_user_email := v_transaction.user_email;

  IF p_action = 'approve' THEN
    -- Update transaction status
    UPDATE "public"."WalletTransaction"
    SET
      status = 'approved',
      "processedAt" = CURRENT_TIMESTAMP,
      "processedBy" = p_admin_email,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = p_transaction_id;

    -- Update user wallet balance
    UPDATE "public"."User"
    SET
      "walletBalance" = "walletBalance" + v_transaction.amount,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = v_transaction."userId"
    RETURNING "walletBalance" INTO v_new_balance;

    RETURN json_build_object(
      'success', true,
      'status', 'approved',
      'newBalance', v_new_balance,
      'amount', v_transaction.amount,
      'userEmail', v_user_email
    );

  ELSIF p_action = 'reject' THEN
    -- Update transaction status only
    UPDATE "public"."WalletTransaction"
    SET
      status = 'rejected',
      "processedAt" = CURRENT_TIMESTAMP,
      "processedBy" = p_admin_email,
      "adminNotes" = p_notes,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = p_transaction_id;

    RETURN json_build_object(
      'success', true,
      'status', 'rejected',
      'userEmail', v_user_email
    );

  ELSE
    RETURN json_build_object('success', false, 'error', 'Invalid action. Use "approve" or "reject"');
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.redeem_prize(p_user_id text, p_prize_id text, p_full_name text DEFAULT NULL::text, p_whatsapp_number text DEFAULT NULL::text, p_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN private_hardened.redeem_prize(
        p_user_id := p_user_id,
        p_prize_id := p_prize_id,
        p_full_name := p_full_name,
        p_whatsapp_number := p_whatsapp_number,
        p_address := p_address
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_leaderboard_cache()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE tf text;
BEGIN
  FOREACH tf IN ARRAY ARRAY['allTime', 'weekly', 'monthly'] LOOP
    DELETE FROM "LeaderboardCache" WHERE timeframe = tf;
    INSERT INTO "LeaderboardCache" (timeframe, rank, row)
    SELECT tf, l.rank, to_jsonb(l) FROM public.compute_leaderboard(tf, 100, NULL) l;
  END LOOP;
END $function$
;

CREATE OR REPLACE FUNCTION public.reject_claim_with_refund(p_claim_id text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_claim RECORD;
BEGIN
    -- Verify caller is admin
    IF NOT is_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin access required');
    END IF;

    -- Get claim with lock
    SELECT id, "userId", "pointsUsed", status INTO v_claim
    FROM "PrizeRedemption"
    WHERE id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Claim not found');
    END IF;

    IF v_claim.status = 'rejected' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Claim already rejected');
    END IF;

    -- Refund points to user
    UPDATE "User"
    SET points = points + v_claim."pointsUsed",
        "updatedAt" = NOW()
    WHERE id = v_claim."userId";

    -- Update claim status
    UPDATE "PrizeRedemption"
    SET status = 'rejected',
        notes = COALESCE(p_notes, notes),
        "processedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE id = p_claim_id;

    RETURN jsonb_build_object(
        'success', true,
        'claim_id', p_claim_id,
        'status', 'rejected',
        'points_refunded', v_claim."pointsUsed"
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_wallet_transaction(p_transaction_id text, p_processed_by text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_transaction RECORD;
BEGIN
    -- Get transaction with lock
    SELECT id, status INTO v_transaction
    FROM "WalletTransaction"
    WHERE id = p_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
    END IF;

    IF v_transaction.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transaction is not pending');
    END IF;

    -- Update transaction status with notes
    UPDATE "WalletTransaction"
    SET status = 'rejected',
        "processedBy" = p_processed_by,
        "processedAt" = NOW(),
        "adminNotes" = COALESCE(p_reason, "adminNotes"),
        "updatedAt" = NOW()
    WHERE id = p_transaction_id;

    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', p_transaction_id
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_deposit_request(p_amount double precision, p_payment_method text, p_transaction_id text, p_proof_image text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid()::text;
  v_new_id text := gen_random_uuid()::text;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('success', false, 'error', 'Not authenticated'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid amount');
  END IF;
  IF coalesce(length(trim(p_transaction_id)), 0) < 4 OR length(p_transaction_id) > 100 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid transaction ID');
  END IF;
  IF (SELECT count(*) FROM "WalletTransaction" WHERE "userId" = v_uid AND status = 'pending') >= 5 THEN
    RETURN json_build_object('success', false, 'error', 'Too many pending deposit requests');
  END IF;
  INSERT INTO "WalletTransaction" (id, "userId", amount, "paymentMethod", "transactionId", status, type,
                                   "proofImage", "createdAt", "updatedAt")
  VALUES (v_new_id, v_uid, p_amount, left(p_payment_method, 50), trim(p_transaction_id), 'pending', 'deposit',
          p_proof_image, now(), now());
  RETURN json_build_object('success', true, 'id', v_new_id);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('success', false, 'error', 'Transaction ID already exists');
END $function$
;

CREATE OR REPLACE FUNCTION public.submit_quiz(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN private_hardened.submit_quiz(
        p_user_id := p_user_id,
        p_quiz_id := p_quiz_id,
        p_answers := p_answers,
        p_daily_payment_id := p_daily_payment_id
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN private_hardened.submit_quiz_attempt(
        p_user_id := p_user_id,
        p_quiz_id := p_quiz_id,
        p_answers := p_answers,
        p_daily_payment_id := p_daily_payment_id
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.toggle_stream_status(p_is_active boolean, p_admin_email text DEFAULT 'admin'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    UPDATE "StreamEmbed"
    SET
        "isActive" = p_is_active,
        "updatedBy" = p_admin_email,
        "updatedAt" = NOW()
    WHERE "id" = 'default';

    RETURN jsonb_build_object(
        'success', true,
        'isActive', p_is_active,
        'message', CASE WHEN p_is_active THEN 'Stream activated' ELSE 'Stream deactivated' END
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_claim_status(p_claim_id text, p_status text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Verify caller is admin
    IF NOT is_admin() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin access required');
    END IF;

    -- Route to appropriate function
    CASE p_status
        WHEN 'approved' THEN
            RETURN approve_claim(p_claim_id, p_notes);
        WHEN 'rejected' THEN
            RETURN reject_claim_with_refund(p_claim_id, p_notes);
        WHEN 'fulfilled' THEN
            RETURN fulfill_claim(p_claim_id, p_notes);
        ELSE
            -- Direct update for other statuses
            UPDATE "PrizeRedemption"
            SET status = p_status,
                notes = COALESCE(p_notes, notes),
                "processedAt" = NOW(),
                "updatedAt" = NOW()
            WHERE id = p_claim_id;

            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', 'Claim not found');
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'claim_id', p_claim_id,
                'status', p_status
            );
    END CASE;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_claim_status(p_claim_id text, p_status text, p_notes text DEFAULT NULL::text, p_admin_email text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim record;
  v_user_id text;
  v_points_used integer;
BEGIN
  -- Fetch the claim
  SELECT * INTO v_claim
  FROM "public"."PrizeRedemption"
  WHERE id = p_claim_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Claim not found');
  END IF;

  -- Validate status transition
  IF v_claim.status = 'fulfilled' THEN
    RETURN json_build_object('success', false, 'error', 'Cannot modify a fulfilled claim');
  END IF;

  IF v_claim.status = 'rejected' AND p_status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Rejected claims can only be reopened');
  END IF;

  -- Handle rejection - refund points
  IF p_status = 'rejected' AND v_claim.status != 'rejected' THEN
    -- Refund points to user
    UPDATE "public"."User"
    SET
      points = points + v_claim."pointsUsed",
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = v_claim."userId";
  END IF;

  -- Update the claim
  UPDATE "public"."PrizeRedemption"
  SET
    status = p_status,
    notes = COALESCE(p_notes, notes),
    "processedAt" = CASE WHEN p_status IN ('approved', 'rejected', 'fulfilled') THEN CURRENT_TIMESTAMP ELSE "processedAt" END,
    "processedBy" = COALESCE(p_admin_email, "processedBy"),
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = p_claim_id;

  RETURN json_build_object(
    'success', true,
    'status', p_status,
    'message', 'Claim status updated successfully'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_live_stream_config(p_embed_html text DEFAULT NULL::text, p_embed_url text DEFAULT NULL::text, p_title text DEFAULT 'Livestream'::text, p_platform text DEFAULT 'custom'::text, p_is_active boolean DEFAULT true, p_admin_email text DEFAULT 'admin'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_result RECORD;
BEGIN
    -- Upsert the stream configuration
    INSERT INTO "StreamEmbed" (
        "id",
        "embedHtml",
        "embedUrl",
        "title",
        "platform",
        "isActive",
        "updatedBy",
        "updatedAt",
        "createdAt"
    )
    VALUES (
        'default',
        COALESCE(p_embed_html, ''),
        p_embed_url,
        COALESCE(p_title, 'Livestream'),
        COALESCE(p_platform, 'custom'),
        p_is_active,
        p_admin_email,
        NOW(),
        NOW()
    )
    ON CONFLICT ("id") DO UPDATE SET
        "embedHtml" = COALESCE(EXCLUDED."embedHtml", "StreamEmbed"."embedHtml"),
        "embedUrl" = COALESCE(EXCLUDED."embedUrl", "StreamEmbed"."embedUrl"),
        "title" = COALESCE(EXCLUDED."title", "StreamEmbed"."title"),
        "platform" = COALESCE(EXCLUDED."platform", "StreamEmbed"."platform"),
        "isActive" = EXCLUDED."isActive",
        "updatedBy" = EXCLUDED."updatedBy",
        "updatedAt" = NOW()
    RETURNING * INTO v_result;

    RETURN jsonb_build_object(
        'success', true,
        'embedHtml', v_result."embedHtml",
        'embedUrl', v_result."embedUrl",
        'title', v_result."title",
        'platform', v_result."platform",
        'isActive', v_result."isActive",
        'updatedAt', v_result."updatedAt",
        'updatedBy', v_result."updatedBy",
        'message', 'Stream configuration updated successfully'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_quiz_submission_time(p_quiz_id text, p_attempt_id text)
 RETURNS TABLE(is_valid boolean, time_remaining_seconds integer, message text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_duration_minutes INTEGER;
    v_started_at TIMESTAMP WITH TIME ZONE;
    v_deadline TIMESTAMP WITH TIME ZONE;
    v_now TIMESTAMP WITH TIME ZONE := NOW();
    v_remaining INTEGER;
BEGIN
    -- Get quiz duration
    SELECT duration INTO v_duration_minutes
    FROM "Quiz"
    WHERE id = p_quiz_id;

    -- Get attempt start time
    SELECT "startedAt" INTO v_started_at
    FROM "QuizAttempt"
    WHERE id = p_attempt_id;

    -- If no start time recorded, allow submission
    IF v_started_at IS NULL THEN
        RETURN QUERY SELECT TRUE, v_duration_minutes * 60, 'No start time recorded'::TEXT;
        RETURN;
    END IF;

    -- Calculate deadline
    v_deadline := v_started_at + (v_duration_minutes * INTERVAL '1 minute');
    v_remaining := GREATEST(0, EXTRACT(EPOCH FROM (v_deadline - v_now))::INTEGER);

    IF v_now > v_deadline THEN
        RETURN QUERY SELECT FALSE, 0, 'Time limit exceeded'::TEXT;
    ELSE
        RETURN QUERY SELECT TRUE, v_remaining, 'Within time limit'::TEXT;
    END IF;
END $function$
;
