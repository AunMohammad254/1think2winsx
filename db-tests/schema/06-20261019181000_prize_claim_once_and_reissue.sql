-- NOT YET APPLIED TO PRODUCTION. Apply before deploying the app code that calls reissue_claim
-- (PUT /api/admin/claims with action "reissue").
-- Prize claims: each player may claim a prize once, enforced by redeem_prize itself, and the admin's
-- "Reissue" runs in one locked transaction instead of read-then-write calls from the server.

-- ── 1. One claim per player per prize ────────────────────────────────────────────────────────────
-- A player has claimed a prize when they have a live redemption of it (pending, approved or
-- fulfilled; a rejected one was refunded) or won it in a quiz (legacy "Winning", or "QuizWinner" from
-- settle_quiz). It locks the player's row first: two redemptions sent at once then run one after the
-- other, and the second sees the first (private_hardened.redeem_prize takes the same lock, in the same
-- transaction). SECURITY DEFINER because players can't read "QuizWinner"; it answers only for the
-- caller themselves (or an admin), as redeem_prize refuses anyone else anyway.
CREATE OR REPLACE FUNCTION private_hardened.prize_claimed_by(p_user_id text, p_prize_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR p_user_id = auth.uid()::text) THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM "User" WHERE id = p_user_id FOR UPDATE;
  RETURN EXISTS (SELECT 1 FROM "PrizeRedemption" WHERE "userId" = p_user_id AND "prizeId" = p_prize_id
                   AND status IN ('pending', 'approved', 'fulfilled'))
      OR EXISTS (SELECT 1 FROM "Winning" WHERE "userId" = p_user_id AND "prizeId" = p_prize_id)
      OR EXISTS (SELECT 1 FROM "QuizWinner" WHERE "userId" = p_user_id AND "prizeId" = p_prize_id);
END;
$function$;
REVOKE ALL ON FUNCTION private_hardened.prize_claimed_by(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_hardened.prize_claimed_by(text, text) TO authenticated, service_role;

-- Same signature and body as in 06-20261019120000_quiz_settlement.sql, plus the check
-- (CREATE OR REPLACE keeps the existing grants).
CREATE OR REPLACE FUNCTION public.redeem_prize(p_user_id text, p_prize_id text, p_full_name text DEFAULT NULL::text, p_whatsapp_number text DEFAULT NULL::text, p_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF private_hardened.prize_is_bumper(p_prize_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Prize not found or not available');
    END IF;
    IF private_hardened.prize_claimed_by(p_user_id, p_prize_id) THEN
        RETURN jsonb_build_object('success', false, 'code', 'already_claimed',
            'error', 'You have already claimed this prize. Each prize can only be claimed once per account.');
    END IF;
    RETURN private_hardened.redeem_prize(
        p_user_id := p_user_id,
        p_prize_id := p_prize_id,
        p_full_name := p_full_name,
        p_whatsapp_number := p_whatsapp_number,
        p_address := p_address
    );
END;
$function$;

-- ── 2. Admin "Reissue" of an approved or delivered claim ──────────────────────────────────────────
-- 'redelivery': send the item again (lost or damaged in delivery). The claim goes back to pending;
--               the player stays charged, since they still get one item.
-- 'reclaim':    cancel it instead. The points are refunded, the item goes back in stock, and the
--               claim is rejected, so the player may claim the prize again.
-- Only approved or fulfilled claims qualify: a pending claim is still being handled, and a rejected
-- one was already refunded (re-sending it would ship a prize nobody paid for).
CREATE OR REPLACE FUNCTION public.reissue_claim(p_claim_id text, p_mode text, p_notes text DEFAULT NULL::text, p_admin_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim record;
  v_reason text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('redelivery', 'reclaim') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Unknown reissue mode');
  END IF;

  SELECT id, "userId", "prizeId", "pointsUsed", status INTO v_claim
    FROM "PrizeRedemption" WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Claim not found');
  END IF;
  IF v_claim.status NOT IN ('approved', 'fulfilled') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_status',
      'error', 'Only approved or fulfilled claims can be reissued (this one is ' || v_claim.status || ')');
  END IF;
  v_reason := coalesce(nullif(btrim(p_notes), ''), 'Previous status: ' || v_claim.status);

  IF p_mode = 'redelivery' THEN
    UPDATE "PrizeRedemption"
       SET status = 'pending', notes = '[REISSUED FOR REDELIVERY] ' || v_reason, "processedAt" = NULL,
           "processedBy" = coalesce(p_admin_email, "processedBy"), "updatedAt" = now()
     WHERE id = p_claim_id;
    RETURN jsonb_build_object('success', true, 'status', 'pending', 'previousStatus', v_claim.status, 'pointsRefunded', 0);
  END IF;

  UPDATE "User" SET points = points + v_claim."pointsUsed", "updatedAt" = now() WHERE id = v_claim."userId";
  UPDATE "Prize" SET stock = stock + 1, "updatedAt" = now() WHERE id = v_claim."prizeId" AND stock IS NOT NULL;
  UPDATE "PrizeRedemption"
     SET status = 'rejected', notes = '[REISSUED - PLAYER MAY RE-CLAIM] ' || v_reason, "processedAt" = now(),
         "processedBy" = coalesce(p_admin_email, "processedBy"), "updatedAt" = now()
   WHERE id = p_claim_id;
  RETURN jsonb_build_object('success', true, 'status', 'rejected', 'previousStatus', v_claim.status,
    'pointsRefunded', v_claim."pointsUsed");
END;
$function$;
REVOKE ALL ON FUNCTION public.reissue_claim(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reissue_claim(text, text, text, text) TO service_role;
