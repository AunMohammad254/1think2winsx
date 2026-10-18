-- Test baseline: verbatim copy of the 2026-10-09 read-only dump of the live schema.
-- Do not edit by hand: see db-tests/README.md ("Updating the baseline").
-- 05: privileges. Generated read-only from production catalog.
-- A fresh Supabase project grants broad default privileges; production was locked down, so wipe and re-grant exactly.
CREATE SCHEMA IF NOT EXISTS private_hardened;
GRANT USAGE ON SCHEMA private_hardened TO authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."AdminSession" TO service_role;
GRANT MAINTAIN, SELECT ON public."Answer" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."Answer" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."AppSettings" TO service_role;
GRANT MAINTAIN ON public."DailyPayment" TO anon;
GRANT MAINTAIN, SELECT ON public."DailyPayment" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."DailyPayment" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON public."NewsletterSubscription" TO anon;
GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON public."NewsletterSubscription" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."NewsletterSubscription" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON public."Notification" TO anon;
GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON public."Notification" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."Notification" TO service_role;
GRANT SELECT ON public."Prize" TO anon;
GRANT MAINTAIN, SELECT ON public."Prize" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."Prize" TO service_role;
GRANT MAINTAIN, SELECT ON public."PrizeRedemption" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."PrizeRedemption" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON public."PushSubscription" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."PushSubscription" TO service_role;
GRANT MAINTAIN ON public."Question" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."Question" TO service_role;
GRANT MAINTAIN, SELECT ON public."QuestionAttempt" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."QuestionAttempt" TO service_role;
GRANT SELECT ON public."Quiz" TO anon;
GRANT MAINTAIN, SELECT ON public."Quiz" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."Quiz" TO service_role;
GRANT MAINTAIN, SELECT ON public."QuizAttempt" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."QuizAttempt" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."RateLimitEntry" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON public."ScheduledNotification" TO anon;
GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON public."ScheduledNotification" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."ScheduledNotification" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."SecurityEvent" TO service_role;
GRANT MAINTAIN, SELECT ON public."StreamConfiguration" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."StreamConfiguration" TO service_role;
GRANT SELECT ON public."StreamEmbed" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."StreamEmbed" TO service_role;
GRANT MAINTAIN ON public."StreamMetrics" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."StreamMetrics" TO service_role;
GRANT MAINTAIN ON public."StreamSession" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."StreamSession" TO service_role;
GRANT MAINTAIN, SELECT ON public."User" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."User" TO service_role;
GRANT MAINTAIN, SELECT ON public."WalletTransaction" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."WalletTransaction" TO service_role;
GRANT MAINTAIN, SELECT ON public."Winning" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public."Winning" TO service_role;
GRANT SELECT ON public.user_auth_status TO service_role;
-- QuizWinner, Payment, LeaderboardCache, security_logs, admin_dashboard_stats: no grants to anon/authenticated/service_role (as in production)

-- Question: authenticated may read every column except "correctOption" (answer key stays hidden)
GRANT SELECT (id, "quizId", text, options, "hasCorrectAnswer", status, "createdAt", "updatedAt") ON public."Question" TO authenticated;

-- Functions: wipe default grants, then re-grant exactly as production
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private_hardened FROM PUBLIC, anon, authenticated, service_role;

-- public.auth_uid() has no explicit ACL in production (default: PUBLIC can execute). RLS policies call it, so this is required.
GRANT EXECUTE ON FUNCTION public.auth_uid() TO PUBLIC;

GRANT EXECUTE ON FUNCTION private_hardened.is_admin() TO PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_hardened.redeem_prize(p_user_id text, p_prize_id text, p_full_name text, p_whatsapp_number text, p_address text) TO PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_hardened.submit_quiz(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text) TO PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION private_hardened.submit_quiz_attempt(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text) TO PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.allocate_points_to_winners(p_quiz_id text, p_winner_user_ids text[], p_points_per_winner integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_claim(p_claim_id text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_wallet_transaction(p_transaction_id text, p_processed_by text) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_user_change_password(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits(retention_minutes integer) TO service_role;
-- compute_leaderboard, handle_new_user, refresh_leaderboard_cache: owner only (as in production)
GRANT EXECUTE ON FUNCTION public.decrement_prize_stock(p_prize_id text) TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_wallet_balance(p_user_id uuid, p_amount double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_completely(p_email text) TO service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_question(p_question_id text, p_correct_option integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_quiz_scores(p_quiz_id text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfill_claim(p_claim_id text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_claims(p_status text, p_page integer, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_manager_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_wallet_transactions(p_status text, p_page integer, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_all_claims() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_available_prizes() TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(p_timeframe text, p_limit integer, p_quiz_id text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_live_stream_config() TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_prize_distribution() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_quiz_attempt_avg_score() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_quiz_attempt_counts_by_quiz(quiz_ids text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_quiz_stats(quiz_id_param text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_recent_activity(limit_count integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_auth_providers(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_redemptions() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_wallet_balance() TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_user_points(p_user_id text, p_delta integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_user_wallet(p_user_id text, p_delta numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.is_oauth_only_user(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay_quiz_access(p_quiz_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_claim(p_claim_id text, p_action text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_deposit_request(p_transaction_db_id text, p_action text, p_admin_email text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_wallet_transaction(p_transaction_id text, p_action text, p_admin_email text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_prize(p_user_id text, p_prize_id text, p_full_name text, p_whatsapp_number text, p_address text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_claim_with_refund(p_claim_id text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_wallet_transaction(p_transaction_id text, p_processed_by text, p_reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_deposit_request(p_amount double precision, p_payment_method text, p_transaction_id text, p_proof_image text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(p_user_id text, p_quiz_id text, p_answers jsonb, p_daily_payment_id text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_stream_status(p_is_active boolean, p_admin_email text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_claim_status(p_claim_id text, p_status text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_claim_status(p_claim_id text, p_status text, p_notes text, p_admin_email text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_live_stream_config(p_embed_html text, p_embed_url text, p_title text, p_platform text, p_is_active boolean, p_admin_email text) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_quiz_submission_time(p_quiz_id text, p_attempt_id text) TO authenticated, service_role;
