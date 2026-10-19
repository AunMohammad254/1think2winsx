-- Applied to production on 2026-10-18 (migration grant_service_role_quizwinner_payment).
-- "QuizWinner" and "Payment" were created without grants, and the project grants nothing on new public
-- tables by default, so the server's service-role client got 42501 "permission denied" on them.
-- Least privilege: winners are never deleted, payments are only read.
GRANT SELECT, INSERT, UPDATE ON public."QuizWinner" TO service_role;
GRANT SELECT ON public."Payment" TO service_role;
