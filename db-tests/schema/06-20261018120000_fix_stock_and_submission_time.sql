-- Migration fix_stock_and_submission_time (2026-10-18). Applied to production (Mumbai,
-- eclivawqhdovsndlngfo) on 2026-10-21 as 20261021113229. Two functions failed on every call because they named columns that
-- don't exist. Tests: db-tests/decrement-prize-stock.test.ts, db-tests/removed-functions.test.ts.

-- decrement_prize_stock: the column is Prize.stock, not "stockQuantity". Same signature, so
-- CREATE OR REPLACE keeps its grants (service_role only). Still raises P0001 when the prize is out
-- of stock or missing; prizeDb.decrementStock maps that code to 'Prize out of stock'.
CREATE OR REPLACE FUNCTION public.decrement_prize_stock(p_prize_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock integer;
BEGIN
  UPDATE "Prize"
  SET
    stock       = stock - 1,
    "updatedAt" = now()
  WHERE id = p_prize_id
    AND stock > 0
  RETURNING stock INTO v_stock;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize out of stock or not found: %', p_prize_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_stock;
END;
$function$;

-- validate_quiz_submission_time read QuizAttempt."startedAt", which doesn't exist. Nothing calls
-- it, and submit_quiz_attempt already enforces the answering window, so drop it rather than fix it.
-- No CASCADE: fail instead of silently dropping anything that depends on it.
DROP FUNCTION IF EXISTS public.validate_quiz_submission_time(p_quiz_id text, p_attempt_id text);
