SET session_replication_role = replica; -- skip FK checks for speed
INSERT INTO auth.users SELECT md5('u'||g)::uuid, 'user'||g||'@test.pk', '{}' FROM generate_series(1,50000) g;
INSERT INTO "User"(id,name,email,points,"walletBalance","updatedAt") SELECT md5('u'||g)::uuid::text, 'User '||g, 'user'||g||'@test.pk', (random()*5000)::int, 100, now() FROM generate_series(1,50000) g;
INSERT INTO "Quiz"(id,title,status,"updatedAt","createdAt") SELECT 'quiz'||q, 'Quiz '||q, CASE WHEN q<=5 THEN 'active' ELSE 'completed' END, now(), now()-(q||' days')::interval FROM generate_series(1,8) q;
INSERT INTO "Question"(id,"quizId",text,options,"updatedAt") SELECT 'q'||q||'_'||n, 'quiz'||q, 'Question '||n||'?', '["A","B","C","D"]', now() FROM generate_series(1,8) q, generate_series(1,20) n;
-- attempts: quiz1 all 50k users, quiz2..8 15k users each
INSERT INTO "QuizAttempt"(id,"userId","quizId",score,"isCompleted","completedAt","createdAt","updatedAt")
 SELECT 'qa_'||q||'_'||u, md5('u'||u)::uuid::text, 'quiz'||q, (random()*100)::int, true, now()-random()*interval '40 days', now()-random()*interval '40 days', now()
 FROM generate_series(1,8) q, generate_series(1,50000) u WHERE q=1 OR u%10 < 3;
INSERT INTO "Answer"(id,"userId","questionId","quizAttemptId","selectedOption","isCorrect","createdAt")
 SELECT 'a_'||qa.id||'_'||n, qa."userId", 'q'||substr(qa."quizId",5)||'_'||n, qa.id, (random()*3)::int, random()<0.5, qa."createdAt"
 FROM "QuizAttempt" qa, generate_series(1,20) n;
INSERT INTO "QuestionAttempt"(id,"userId","questionId","quizId","selectedOption","attemptedAt")
 SELECT 'qt_'||a.id, a."userId", a."questionId", substr(a."quizAttemptId",4,5)::text, a."selectedOption", a."createdAt" FROM "Answer" a;
UPDATE "QuestionAttempt" SET "quizId" = split_part("quizId",'_',1);
INSERT INTO "DailyPayment"(id,"userId",amount,status,"expiresAt","updatedAt") SELECT 'dp_'||g||'_'||d, md5('u'||g)::uuid::text, 2, 'completed', now()-(d||' days')::interval+interval '1 day', now() FROM generate_series(1,50000) g, generate_series(0,9) d;
INSERT INTO "RateLimitEntry"(id,key,"createdAt") SELECT 'rl'||g, md5('u'||(g%50000))::uuid::text, now()-random()*interval '1 hour' FROM generate_series(1,300000) g;
SET session_replication_role = origin;
ANALYZE;
