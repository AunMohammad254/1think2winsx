-- Test baseline: verbatim copy of the 2026-10-09 read-only dump of the live schema.
-- Do not edit by hand: see db-tests/README.md ("Updating the baseline").
-- 04: views, RLS enable, policies. Generated read-only from production catalog.
CREATE OR REPLACE VIEW public.admin_dashboard_stats  AS
 SELECT ( SELECT count(*) AS count
           FROM "User") AS total_users,
    ( SELECT count(*) AS count
           FROM "User"
          WHERE "User"."createdAt" >= (now() - '7 days'::interval)) AS recent_users,
    ( SELECT count(*) AS count
           FROM "User"
          WHERE "User"."createdAt" >= (now() - '30 days'::interval)) AS monthly_users,
    ( SELECT count(*) AS count
           FROM "Quiz") AS total_quizzes,
    ( SELECT count(*) AS count
           FROM "Quiz"
          WHERE "Quiz".status = 'active'::text) AS active_quizzes,
    ( SELECT count(*) AS count
           FROM "Quiz"
          WHERE "Quiz".status = 'draft'::text) AS draft_quizzes,
    ( SELECT count(*) AS count
           FROM "Quiz"
          WHERE "Quiz".status = 'paused'::text) AS paused_quizzes,
    ( SELECT count(*) AS count
           FROM "QuizAttempt") AS total_attempts,
    ( SELECT count(*) AS count
           FROM "QuizAttempt"
          WHERE "QuizAttempt"."isCompleted" = true) AS completed_attempts,
    ( SELECT count(*) AS count
           FROM "QuizAttempt"
          WHERE "QuizAttempt"."createdAt" >= (now() - '7 days'::interval)) AS recent_attempts,
    ( SELECT COALESCE(avg("QuizAttempt".score), 0::numeric) AS "coalesce"
           FROM "QuizAttempt"
          WHERE "QuizAttempt"."isCompleted" = true) AS average_score,
    ( SELECT COALESCE(sum("Payment".amount), 0::double precision) AS "coalesce"
           FROM "Payment"
          WHERE "Payment".status = 'completed'::text) AS total_revenue,
    ( SELECT count(*) AS count
           FROM "Payment") AS total_payments,
    ( SELECT count(*) AS count
           FROM "Payment"
          WHERE "Payment".status = 'completed'::text) AS completed_payments,
        CASE
            WHEN (( SELECT count(*) AS count
               FROM "QuizAttempt")) > 0 THEN round((( SELECT count(*) AS count
               FROM "QuizAttempt"
              WHERE "QuizAttempt"."isCompleted" = true))::numeric / (( SELECT count(*) AS count
               FROM "QuizAttempt"))::numeric * 100::numeric, 2)
            ELSE 0::numeric
        END AS completion_rate;

CREATE OR REPLACE VIEW public.user_auth_status  AS
 SELECT id AS user_id,
    email,
    created_at AS signup_date,
    last_sign_in_at,
    raw_app_meta_data ->> 'provider'::text AS primary_provider,
    COALESCE(( SELECT array_agg(DISTINCT i.provider ORDER BY i.provider) AS array_agg
           FROM auth.identities i
          WHERE i.user_id = u.id), ARRAY[]::text[]) AS all_providers,
    (EXISTS ( SELECT 1
           FROM auth.identities i
          WHERE i.user_id = u.id AND i.provider = 'email'::text)) AS can_change_password,
    NOT (EXISTS ( SELECT 1
           FROM auth.identities i
          WHERE i.user_id = u.id AND i.provider = 'email'::text)) AND (EXISTS ( SELECT 1
           FROM auth.identities i
          WHERE i.user_id = u.id)) AS is_oauth_only
   FROM auth.users u;

ALTER TABLE public."AdminSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Answer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AppSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DailyPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LeaderboardCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."NewsletterSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Prize" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PrizeRedemption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Question" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."QuestionAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Quiz" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."QuizAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."QuizWinner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RateLimitEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ScheduledNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SecurityEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StreamConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StreamEmbed" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StreamMetrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StreamSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WalletTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Winning" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "AdminSession_authenticated_select" ON public."AdminSession"; CREATE POLICY "AdminSession_authenticated_select" ON public."AdminSession" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((email = ( SELECT (( SELECT auth.jwt() AS jwt) ->> 'email'::text))));
DROP POLICY IF EXISTS "AdminSession_service_role" ON public."AdminSession"; CREATE POLICY "AdminSession_service_role" ON public."AdminSession" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "Answer_select_own" ON public."Answer"; CREATE POLICY "Answer_select_own" ON public."Answer" AS PERMISSIVE FOR SELECT TO authenticated
  USING (("userId" = ( SELECT auth_uid() AS auth_uid)));
DROP POLICY IF EXISTS "Answer_service_role" ON public."Answer"; CREATE POLICY "Answer_service_role" ON public."Answer" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "AppSettings admin read" ON public."AppSettings"; CREATE POLICY "AppSettings admin read" ON public."AppSettings" AS PERMISSIVE FOR SELECT TO public
  USING (false);
DROP POLICY IF EXISTS "AppSettings admin write" ON public."AppSettings"; CREATE POLICY "AppSettings admin write" ON public."AppSettings" AS PERMISSIVE FOR ALL TO public
  USING (false);
DROP POLICY IF EXISTS "DailyPayment_select_own" ON public."DailyPayment"; CREATE POLICY "DailyPayment_select_own" ON public."DailyPayment" AS PERMISSIVE FOR SELECT TO authenticated
  USING (("userId" = auth_uid()));
DROP POLICY IF EXISTS "DailyPayment_service_role" ON public."DailyPayment"; CREATE POLICY "DailyPayment_service_role" ON public."DailyPayment" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can delete subscriptions" ON public."NewsletterSubscription"; CREATE POLICY "Admins can delete subscriptions" ON public."NewsletterSubscription" AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT is_admin() AS is_admin));
DROP POLICY IF EXISTS "Admins can view subscriptions" ON public."NewsletterSubscription"; CREATE POLICY "Admins can view subscriptions" ON public."NewsletterSubscription" AS PERMISSIVE FOR SELECT TO authenticated
  USING (( SELECT is_admin() AS is_admin));
DROP POLICY IF EXISTS "Anyone can insert subscriptions" ON public."NewsletterSubscription"; CREATE POLICY "Anyone can insert subscriptions" ON public."NewsletterSubscription" AS PERMISSIVE FOR INSERT TO anon, authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can manage all notifications" ON public."Notification"; CREATE POLICY "Admins can manage all notifications" ON public."Notification" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT is_admin() AS is_admin));
DROP POLICY IF EXISTS "Users can delete own notifications" ON public."Notification"; CREATE POLICY "Users can delete own notifications" ON public."Notification" AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_admin() AS is_admin) OR ("userId" = ( SELECT auth_uid() AS auth_uid))));
DROP POLICY IF EXISTS "Users can update own notifications" ON public."Notification"; CREATE POLICY "Users can update own notifications" ON public."Notification" AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_admin() AS is_admin) OR ("userId" = ( SELECT auth_uid() AS auth_uid))))
  WITH CHECK ((( SELECT is_admin() AS is_admin) OR ("userId" = ( SELECT auth_uid() AS auth_uid))));
DROP POLICY IF EXISTS "Users can view own notifications" ON public."Notification"; CREATE POLICY "Users can view own notifications" ON public."Notification" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((( SELECT is_admin() AS is_admin) OR ("userId" = ( SELECT auth_uid() AS auth_uid))));
DROP POLICY IF EXISTS "Payment_select_own" ON public."Payment"; CREATE POLICY "Payment_select_own" ON public."Payment" AS PERMISSIVE FOR SELECT TO authenticated
  USING (("userId" = auth_uid()));
DROP POLICY IF EXISTS "Prize_public_select" ON public."Prize"; CREATE POLICY "Prize_public_select" ON public."Prize" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING ((("isActive" = true) AND (status = 'published'::text)));
DROP POLICY IF EXISTS "Prize_service_role_all" ON public."Prize"; CREATE POLICY "Prize_service_role_all" ON public."Prize" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "PrizeRedemption_select_combined" ON public."PrizeRedemption"; CREATE POLICY "PrizeRedemption_select_combined" ON public."PrizeRedemption" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((("userId" = (( SELECT auth.uid() AS uid))::text) OR ( SELECT is_admin() AS is_admin)));
DROP POLICY IF EXISTS "PrizeRedemption_service_role_all" ON public."PrizeRedemption"; CREATE POLICY "PrizeRedemption_service_role_all" ON public."PrizeRedemption" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "Users can delete own push subscriptions" ON public."PushSubscription"; CREATE POLICY "Users can delete own push subscriptions" ON public."PushSubscription" AS PERMISSIVE FOR DELETE TO authenticated
  USING ((("userId" = ( SELECT auth_uid() AS auth_uid)) OR ( SELECT is_admin() AS is_admin)));
DROP POLICY IF EXISTS "Users can insert own push subscriptions" ON public."PushSubscription"; CREATE POLICY "Users can insert own push subscriptions" ON public."PushSubscription" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (("userId" = ( SELECT auth_uid() AS auth_uid)));
DROP POLICY IF EXISTS "Users can view own push subscriptions" ON public."PushSubscription"; CREATE POLICY "Users can view own push subscriptions" ON public."PushSubscription" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((("userId" = ( SELECT auth_uid() AS auth_uid)) OR ( SELECT is_admin() AS is_admin)));
DROP POLICY IF EXISTS "Question_select_auth" ON public."Question"; CREATE POLICY "Question_select_auth" ON public."Question" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Question_service_role" ON public."Question"; CREATE POLICY "Question_service_role" ON public."Question" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "QuestionAttempt_select_own" ON public."QuestionAttempt"; CREATE POLICY "QuestionAttempt_select_own" ON public."QuestionAttempt" AS PERMISSIVE FOR SELECT TO authenticated
  USING (("userId" = ( SELECT auth_uid() AS auth_uid)));
DROP POLICY IF EXISTS "QuestionAttempt_service_role" ON public."QuestionAttempt"; CREATE POLICY "QuestionAttempt_service_role" ON public."QuestionAttempt" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "Quiz_select_auth" ON public."Quiz"; CREATE POLICY "Quiz_select_auth" ON public."Quiz" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Quiz_service_role" ON public."Quiz"; CREATE POLICY "Quiz_service_role" ON public."Quiz" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "QuizAttempt_select_own" ON public."QuizAttempt"; CREATE POLICY "QuizAttempt_select_own" ON public."QuizAttempt" AS PERMISSIVE FOR SELECT TO authenticated
  USING (("userId" = ( SELECT auth_uid() AS auth_uid)));
DROP POLICY IF EXISTS "QuizAttempt_service_role" ON public."QuizAttempt"; CREATE POLICY "QuizAttempt_service_role" ON public."QuizAttempt" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "QuizWinner admin write" ON public."QuizWinner"; CREATE POLICY "QuizWinner admin write" ON public."QuizWinner" AS PERMISSIVE FOR ALL TO public
  USING (false);
DROP POLICY IF EXISTS "QuizWinner user read own" ON public."QuizWinner"; CREATE POLICY "QuizWinner user read own" ON public."QuizWinner" AS PERMISSIVE FOR SELECT TO authenticated
  USING (("userId" = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS "RateLimitEntry_service_role_all" ON public."RateLimitEntry"; CREATE POLICY "RateLimitEntry_service_role_all" ON public."RateLimitEntry" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can manage all scheduled notifications" ON public."ScheduledNotification"; CREATE POLICY "Admins can manage all scheduled notifications" ON public."ScheduledNotification" AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT is_admin() AS is_admin))
  WITH CHECK (( SELECT is_admin() AS is_admin));
DROP POLICY IF EXISTS "SecurityEvent_authenticated_insert" ON public."SecurityEvent"; CREATE POLICY "SecurityEvent_authenticated_insert" ON public."SecurityEvent" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (("userId" IN ( SELECT "User".id
   FROM "User"
  WHERE ("User".email = ( SELECT (( SELECT auth.jwt() AS jwt) ->> 'email'::text))))));
DROP POLICY IF EXISTS "SecurityEvent_authenticated_select" ON public."SecurityEvent"; CREATE POLICY "SecurityEvent_authenticated_select" ON public."SecurityEvent" AS PERMISSIVE FOR SELECT TO authenticated
  USING (("userId" IN ( SELECT "User".id
   FROM "User"
  WHERE ("User".email = ( SELECT (( SELECT auth.jwt() AS jwt) ->> 'email'::text))))));
DROP POLICY IF EXISTS "StreamConfiguration_anon_select" ON public."StreamConfiguration"; CREATE POLICY "StreamConfiguration_anon_select" ON public."StreamConfiguration" AS PERMISSIVE FOR SELECT TO anon
  USING (("isActive" = true));
DROP POLICY IF EXISTS "StreamConfiguration_select_auth" ON public."StreamConfiguration"; CREATE POLICY "StreamConfiguration_select_auth" ON public."StreamConfiguration" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "StreamConfiguration_service_role_all" ON public."StreamConfiguration"; CREATE POLICY "StreamConfiguration_service_role_all" ON public."StreamConfiguration" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "StreamEmbed_public_select" ON public."StreamEmbed"; CREATE POLICY "StreamEmbed_public_select" ON public."StreamEmbed" AS PERMISSIVE FOR SELECT TO public
  USING (("isActive" = true));
DROP POLICY IF EXISTS "StreamEmbed_service_role_all" ON public."StreamEmbed"; CREATE POLICY "StreamEmbed_service_role_all" ON public."StreamEmbed" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "StreamMetrics_anon_select" ON public."StreamMetrics"; CREATE POLICY "StreamMetrics_anon_select" ON public."StreamMetrics" AS PERMISSIVE FOR SELECT TO anon
  USING (true);
DROP POLICY IF EXISTS "StreamMetrics_authenticated_select" ON public."StreamMetrics"; CREATE POLICY "StreamMetrics_authenticated_select" ON public."StreamMetrics" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "StreamSession_anon_select" ON public."StreamSession"; CREATE POLICY "StreamSession_anon_select" ON public."StreamSession" AS PERMISSIVE FOR SELECT TO anon
  USING (true);
DROP POLICY IF EXISTS "StreamSession_authenticated_select" ON public."StreamSession"; CREATE POLICY "StreamSession_authenticated_select" ON public."StreamSession" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "User_select_own" ON public."User"; CREATE POLICY "User_select_own" ON public."User" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS "User_service_role_all" ON public."User"; CREATE POLICY "User_service_role_all" ON public."User" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "WalletTransaction_select_own" ON public."WalletTransaction"; CREATE POLICY "WalletTransaction_select_own" ON public."WalletTransaction" AS PERMISSIVE FOR SELECT TO authenticated
  USING (("userId" = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS "WalletTransaction_service_role" ON public."WalletTransaction"; CREATE POLICY "WalletTransaction_service_role" ON public."WalletTransaction" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "Winning_select_unified" ON public."Winning"; CREATE POLICY "Winning_select_unified" ON public."Winning" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Winning_service_role_all" ON public."Winning"; CREATE POLICY "Winning_service_role_all" ON public."Winning" AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS security_logs_insert_service ON public.security_logs; CREATE POLICY security_logs_insert_service ON public.security_logs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
DROP POLICY IF EXISTS security_logs_select_own ON public.security_logs; CREATE POLICY security_logs_select_own ON public.security_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));
