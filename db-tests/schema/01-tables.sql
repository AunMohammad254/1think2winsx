-- Test baseline: verbatim copy of the 2026-10-09 read-only dump of the live schema.
-- Do not edit by hand: see db-tests/README.md ("Updating the baseline").
-- 01: tables (columns, types, defaults, NOT NULL). Generated read-only from production catalog.
CREATE TABLE IF NOT EXISTS public."AdminSession" (
  id text NOT NULL,
  token text NOT NULL,
  email text NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL);

CREATE TABLE IF NOT EXISTS public."Answer" (
  id text NOT NULL,
  "userId" text NOT NULL,
  "questionId" text NOT NULL,
  "quizAttemptId" text NOT NULL,
  "selectedOption" integer NOT NULL,
  "isCorrect" boolean,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL);

CREATE TABLE IF NOT EXISTS public."AppSettings" (
  key text NOT NULL,
  value text NOT NULL,
  description text,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedBy" text);

CREATE TABLE IF NOT EXISTS public."DailyPayment" (
  id text NOT NULL,
  "userId" text NOT NULL,
  amount double precision DEFAULT 2.0 NOT NULL,
  status text NOT NULL,
  "paymentMethod" text,
  "transactionId" text,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL);

CREATE TABLE IF NOT EXISTS public."LeaderboardCache" (
  timeframe text NOT NULL,
  rank integer NOT NULL,
  "row" jsonb NOT NULL,
  "refreshedAt" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public."NewsletterSubscription" (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  "createdAt" timestamp without time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public."Notification" (
  id text NOT NULL,
  "userId" text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL,
  read boolean DEFAULT false NOT NULL,
  link text,
  "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp without time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public."Payment" (
  id text NOT NULL,
  "userId" text NOT NULL,
  amount double precision NOT NULL,
  status text NOT NULL,
  "paymentMethod" text,
  "transactionId" text,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL);

CREATE TABLE IF NOT EXISTS public."Prize" (
  id text NOT NULL,
  name text NOT NULL,
  description text,
  "imageUrl" text,
  "modelUrl" text,
  type text NOT NULL,
  "pointsRequired" integer NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  category text DEFAULT 'general'::text NOT NULL,
  stock integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'published'::text NOT NULL,
  value double precision DEFAULT 0 NOT NULL);

CREATE TABLE IF NOT EXISTS public."PrizeRedemption" (
  id text NOT NULL,
  "userId" text NOT NULL,
  "prizeId" text NOT NULL,
  "pointsUsed" integer NOT NULL,
  status text NOT NULL,
  "fullName" text,
  "whatsappNumber" text,
  address text,
  "requestedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "processedAt" timestamp(3) without time zone,
  notes text,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "processedBy" text,
  "trackingNumber" text,
  "deliveryDate" timestamp(3) without time zone);

CREATE TABLE IF NOT EXISTS public."PushSubscription" (
  id text NOT NULL,
  "userId" text NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  "createdAt" timestamp without time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public."Question" (
  id text NOT NULL,
  "quizId" text NOT NULL,
  text text NOT NULL,
  options text NOT NULL,
  "correctOption" integer,
  "hasCorrectAnswer" boolean DEFAULT false NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL);

CREATE TABLE IF NOT EXISTS public."QuestionAttempt" (
  id text NOT NULL,
  "userId" text NOT NULL,
  "questionId" text NOT NULL,
  "quizId" text NOT NULL,
  "selectedOption" integer NOT NULL,
  "isCorrect" boolean,
  "attemptedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public."Quiz" (
  id text NOT NULL,
  title text NOT NULL,
  description text,
  duration integer DEFAULT 30 NOT NULL,
  "passingScore" integer DEFAULT 70 NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "accessPrice" double precision DEFAULT 2.0 NOT NULL,
  "startsAt" timestamp with time zone,
  "prizeId" text,
  "isBumperPrize" boolean DEFAULT false NOT NULL,
  "quizType" text DEFAULT 'normal'::text NOT NULL,
  "pushedAt" timestamp with time zone,
  "timeUpDuration" integer DEFAULT 60);

CREATE TABLE IF NOT EXISTS public."QuizAttempt" (
  id text NOT NULL,
  "userId" text NOT NULL,
  "quizId" text NOT NULL,
  score integer DEFAULT 0 NOT NULL,
  points integer DEFAULT 0 NOT NULL,
  "isCompleted" boolean DEFAULT false NOT NULL,
  "isEvaluated" boolean DEFAULT false NOT NULL,
  "completedAt" timestamp(3) without time zone,
  "paymentId" text,
  "dailyPaymentId" text,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL);

CREATE TABLE IF NOT EXISTS public."QuizWinner" (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  "quizId" text NOT NULL,
  "prizeId" text NOT NULL,
  "userId" text NOT NULL,
  score integer NOT NULL,
  "completedAt" timestamp with time zone,
  "selectionMethod" text NOT NULL,
  "selectedBy" text,
  seed text NOT NULL,
  "selectedAt" timestamp with time zone DEFAULT now() NOT NULL,
  "notificationSent" boolean DEFAULT false NOT NULL,
  "prizeRedemptionId" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public."RateLimitEntry" (
  id text NOT NULL,
  key text NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL);

CREATE TABLE IF NOT EXISTS public."ScheduledNotification" (
  id text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text DEFAULT 'general'::text NOT NULL,
  link text,
  "targetType" text DEFAULT 'broadcast'::text NOT NULL,
  "targetUserId" text,
  "scheduledAt" timestamp without time zone NOT NULL,
  dispatched boolean DEFAULT false NOT NULL,
  "createdAt" timestamp without time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public."SecurityEvent" (
  id text NOT NULL,
  type text NOT NULL,
  "userId" text,
  ip text,
  "userAgent" text,
  endpoint text,
  details text,
  severity text,
  "timestamp" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL);

CREATE TABLE IF NOT EXISTS public."StreamConfiguration" (
  id text NOT NULL,
  name text NOT NULL,
  "facebookPageId" text NOT NULL,
  "accessToken" text NOT NULL,
  "streamKey" text,
  "isActive" boolean DEFAULT false NOT NULL,
  "isDefault" boolean DEFAULT false NOT NULL,
  quality text DEFAULT 'auto'::text NOT NULL,
  "autoReconnect" boolean DEFAULT true NOT NULL,
  "maxReconnectAttempts" integer DEFAULT 5 NOT NULL,
  "reconnectDelay" integer DEFAULT 3000 NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL);

CREATE TABLE IF NOT EXISTS public."StreamEmbed" (
  id text DEFAULT 'default'::text NOT NULL,
  "embedHtml" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "lastUpdatedBy" text,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  platform text DEFAULT 'custom'::text,
  title text DEFAULT 'Livestream'::text,
  "embedUrl" text,
  "updatedBy" text);

CREATE TABLE IF NOT EXISTS public."StreamMetrics" (
  id text NOT NULL,
  "streamConfigurationId" text NOT NULL,
  "sessionId" text,
  "metricType" text NOT NULL,
  value double precision NOT NULL,
  metadata text,
  "timestamp" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL);

CREATE TABLE IF NOT EXISTS public."StreamSession" (
  id text NOT NULL,
  "streamConfigurationId" text NOT NULL,
  "facebookLiveVideoId" text,
  status text NOT NULL,
  "startedAt" timestamp(3) without time zone,
  "endedAt" timestamp(3) without time zone,
  "errorMessage" text,
  "reconnectAttempts" integer DEFAULT 0 NOT NULL,
  "viewerCount" integer DEFAULT 0 NOT NULL,
  "peakViewerCount" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL);

CREATE TABLE IF NOT EXISTS public."User" (
  id text NOT NULL,
  name text,
  email text NOT NULL,
  password text,
  phone text,
  "dateOfBirth" timestamp(3) without time zone,
  "profilePicture" text,
  points integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "walletBalance" double precision DEFAULT 0 NOT NULL,
  "authProvider" text);

CREATE TABLE IF NOT EXISTS public."WalletTransaction" (
  id text NOT NULL,
  "userId" text NOT NULL,
  amount double precision NOT NULL,
  "paymentMethod" text NOT NULL,
  "transactionId" text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  "proofImage" text,
  "adminNotes" text,
  "processedAt" timestamp(3) without time zone,
  "processedBy" text,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  type text DEFAULT 'deposit'::text NOT NULL,
  description text,
  notes text);

CREATE TABLE IF NOT EXISTS public."Winning" (
  id text NOT NULL,
  "userId" text NOT NULL,
  "quizId" text NOT NULL,
  "prizeId" text NOT NULL,
  claimed boolean DEFAULT false NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL);

CREATE TABLE IF NOT EXISTS public.security_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  event_description text,
  ip_address inet,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now());
