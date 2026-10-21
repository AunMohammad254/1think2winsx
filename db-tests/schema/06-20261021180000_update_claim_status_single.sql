-- =============================================================================
-- Admin claim decisions: one update_claim_status, run in one locked transaction
--
-- NOT applied to any database yet. Needs the owner's approval for production (eclivawqhdovsndlngfo).
-- The app works before and after it: PUT /api/admin/claims names all four arguments, which only the
-- four-argument function below has.
--
-- Why: production had two overloads, update_claim_status(id, status, notes) and
-- update_claim_status(id, status, notes, admin_email DEFAULT NULL). A call naming the first three
-- arguments matches both, so PostgREST answered HTTP 300 ("could not choose the best candidate"),
-- and the route's fallback, approve_claim, checks is_admin(), which a service-role call can never
-- pass: every Approve and Reject failed with "Unauthorized: Admin access required" (no claim was
-- processed after 2026-02-11). The three-argument overload has the same is_admin() check, so it
-- could never have worked for the server either; it is dropped. With it gone, the old route (live
-- build 0f046f3) also reaches the function below.
--
-- The four-argument body is replaced because it read the claim without locking it (two admins
-- rejecting at once refunded twice), never put the item back in stock on a rejection although
-- redeem_prize took it out, and let a refunded (rejected) claim be reopened and then approved, which
-- shipped a prize nobody paid for. Now only the steps the admin screen offers are allowed:
--   pending  -> approved | rejected   (rejected: points refunded, item back in stock)
--   approved -> fulfilled
-- Anything else (a decided claim sent back to pending, an approved claim cancelled) goes through
-- reissue_claim, which already handles it (06-20261019181000_prize_claim_once_and_reissue.sql).
--
-- The admin's note replaces the stored one when given. The server tells the player about the
-- decision, note included (src/lib/claim-notifications.ts).
--
-- Safe to re-run.
-- =============================================================================

DROP FUNCTION IF EXISTS public.update_claim_status(text, text, text);

-- Same signature and return type as before, so CREATE OR REPLACE keeps working on a re-run
CREATE OR REPLACE FUNCTION public.update_claim_status(p_claim_id text, p_status text, p_notes text DEFAULT NULL::text, p_admin_email text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim record;
  v_refund integer := 0;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected', 'fulfilled') THEN
    RETURN json_build_object('success', false, 'code', 'invalid', 'error', 'Unknown claim status');
  END IF;

  SELECT id, "userId", "prizeId", "pointsUsed", status INTO v_claim
    FROM "PrizeRedemption" WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'code', 'not_found', 'error', 'Claim not found');
  END IF;

  IF NOT ((v_claim.status = 'pending' AND p_status IN ('approved', 'rejected'))
          OR (v_claim.status = 'approved' AND p_status = 'fulfilled')) THEN
    RETURN json_build_object('success', false, 'code', 'invalid_status',
      'error', 'This claim is ' || v_claim.status || ', so it can''t be marked ' || p_status);
  END IF;

  IF p_status = 'rejected' THEN
    v_refund := v_claim."pointsUsed";
    UPDATE "User" SET points = points + v_refund, "updatedAt" = now() WHERE id = v_claim."userId";
    UPDATE "Prize" SET stock = stock + 1, "updatedAt" = now() WHERE id = v_claim."prizeId" AND stock IS NOT NULL;
  END IF;

  UPDATE "PrizeRedemption"
     SET status = p_status, notes = coalesce(nullif(btrim(p_notes), ''), notes), "processedAt" = now(),
         "processedBy" = coalesce(p_admin_email, "processedBy"), "updatedAt" = now()
   WHERE id = p_claim_id;

  RETURN json_build_object('success', true, 'status', p_status, 'previousStatus', v_claim.status,
    'pointsRefunded', v_refund);
END;
$function$;
REVOKE ALL ON FUNCTION public.update_claim_status(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_claim_status(text, text, text, text) TO service_role;
