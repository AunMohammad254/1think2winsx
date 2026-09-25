-- Replica of CURRENT production grants/policies (as audited 2026-09-25)
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('GRANT ALL ON public.%I TO authenticated, service_role', t);
 END LOOP; END $$;
GRANT SELECT ON "Quiz","Prize","AdminSession" TO anon;
GRANT INSERT,UPDATE,DELETE ON "DailyPayment","RateLimitEntry" TO anon;
REVOKE SELECT ON "RateLimitEntry","SecurityEvent" FROM authenticated;
CREATE FUNCTION public.auth_uid() RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$ SELECT auth.uid()::text; $$;
CREATE FUNCTION private_hardened.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM "AdminSession" WHERE email = (SELECT (SELECT auth.jwt()) ->> 'email') AND "expiresAt" > NOW()); $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$ SELECT private_hardened.is_admin(); $$;
-- service_role bypass policies
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('CREATE POLICY %I ON public.%I TO service_role USING (true) WITH CHECK (true)', t||'_service_role', t);
 END LOOP; END $$;
CREATE POLICY "Answer_delete_own" ON "Answer" FOR DELETE TO authenticated USING ("userId" = (SELECT auth_uid()));
CREATE POLICY "Answer_insert_own" ON "Answer" FOR INSERT TO authenticated WITH CHECK ("userId" = (SELECT auth_uid()));
CREATE POLICY "Answer_select_own" ON "Answer" FOR SELECT TO authenticated USING ("userId" = (SELECT auth_uid()));
CREATE POLICY "Answer_update_own" ON "Answer" FOR UPDATE TO authenticated USING ("userId" = (SELECT auth_uid())) WITH CHECK ("userId" = (SELECT auth_uid()));
CREATE POLICY "DailyPayment_insert_own" ON "DailyPayment" FOR INSERT TO authenticated WITH CHECK ("userId" = auth_uid());
CREATE POLICY "DailyPayment_select_own" ON "DailyPayment" FOR SELECT TO authenticated USING ("userId" = auth_uid());
CREATE POLICY "DailyPayment_update_own" ON "DailyPayment" FOR UPDATE TO authenticated USING ("userId" = auth_uid()) WITH CHECK ("userId" = auth_uid());
CREATE POLICY "Payment_insert_own" ON "Payment" FOR INSERT TO authenticated WITH CHECK ("userId" = auth_uid());
CREATE POLICY "Payment_select_own" ON "Payment" FOR SELECT TO authenticated USING ("userId" = auth_uid());
CREATE POLICY "Payment_update_own" ON "Payment" FOR UPDATE TO authenticated USING ("userId" = auth_uid()) WITH CHECK ("userId" = auth_uid());
CREATE POLICY "Payment_delete_own" ON "Payment" FOR DELETE TO authenticated USING ("userId" = auth_uid());
CREATE POLICY "Prize_public_select" ON "Prize" FOR SELECT TO anon, authenticated USING ("isActive" AND status='published');
CREATE POLICY "Question_select_auth" ON "Question" FOR SELECT TO authenticated USING (true);
CREATE POLICY "QuestionAttempt_insert_own" ON "QuestionAttempt" FOR INSERT TO authenticated WITH CHECK ("userId" = (SELECT auth_uid()));
CREATE POLICY "QuestionAttempt_select_own" ON "QuestionAttempt" FOR SELECT TO authenticated USING ("userId" = (SELECT auth_uid()));
CREATE POLICY "QuestionAttempt_update_own" ON "QuestionAttempt" FOR UPDATE TO authenticated USING ("userId" = (SELECT auth_uid())) WITH CHECK ("userId" = (SELECT auth_uid()));
CREATE POLICY "Quiz_select_auth" ON "Quiz" FOR SELECT TO authenticated USING (true);
CREATE POLICY "QuizAttempt_insert_own" ON "QuizAttempt" FOR INSERT TO authenticated WITH CHECK ("userId" = (SELECT auth_uid()));
CREATE POLICY "QuizAttempt_select_own" ON "QuizAttempt" FOR SELECT TO authenticated USING ("userId" = (SELECT auth_uid()));
CREATE POLICY "QuizAttempt_update_own" ON "QuizAttempt" FOR UPDATE TO authenticated USING ("userId" = (SELECT auth_uid())) WITH CHECK ("userId" = (SELECT auth_uid()));
CREATE POLICY "RateLimitEntry_anyone_select" ON "RateLimitEntry" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "User_select_unified" ON "User" FOR SELECT TO authenticated USING (true);
CREATE POLICY "User_update_unified" ON "User" FOR UPDATE TO authenticated
  USING ((id = ((SELECT auth.uid()))::text) OR EXISTS (SELECT 1 FROM "AdminSession" WHERE email = (SELECT auth.jwt()->>'email') AND "expiresAt" > now()))
  WITH CHECK ((id = ((SELECT auth.uid()))::text) OR EXISTS (SELECT 1 FROM "AdminSession" WHERE email = (SELECT auth.jwt()->>'email') AND "expiresAt" > now()));
CREATE POLICY "WalletTransaction_authenticated" ON "WalletTransaction" TO authenticated
  USING ("userId" = (SELECT id FROM "User" WHERE email = (SELECT auth.jwt()->>'email')))
  WITH CHECK ("userId" = (SELECT id FROM "User" WHERE email = (SELECT auth.jwt()->>'email')));
CREATE POLICY "Notification_select" ON "Notification" FOR SELECT TO authenticated USING (is_admin() OR "userId" = (SELECT auth_uid()));
CREATE POLICY "PrizeRedemption_select_combined" ON "PrizeRedemption" FOR SELECT TO authenticated USING ("userId" = ((SELECT auth.uid()))::text);
CREATE POLICY "AppSettings admin read" ON "AppSettings" FOR SELECT USING (false);
