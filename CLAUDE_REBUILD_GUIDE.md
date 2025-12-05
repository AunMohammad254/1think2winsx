# 1Think 2Win — Claude Rebuild Guide

This guide analyzes the project end‑to‑end and provides clear, ordered steps so Claude can recreate the app with parity. It covers tech stack, data models, API design, frontend flows, security, and operational concerns.

## Overview
- Skill‑based quiz platform: players log in, get 24‑hour access via payment, attempt quizzes, and later get evaluated and awarded points.
- Admin features: manage quizzes/questions, evaluate attempts, allocate points, manage prize claims, and configure livestream embed.
- Core pillars: authentication, payment gating, quizzes, evaluation, points, prizes, claims, streaming, and security.

## Tech Stack
- Next.js `15` App Router, React `19`, TypeScript.
- Auth: NextAuth v5 (`Google` OAuth + credentials) with JWT sessions (`src/lib/auth.ts:52`).
- Database: Prisma v5 with MongoDB (`prisma/schema.prisma:8-11`).
- Styling: TailwindCSS 4.
- Validation: `zod`.
- Security: CSRF protection, rate limiting, security headers, ETag caching.

## Environment Variables
- Required: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (prod), `ADMIN_EMAILS`.
- OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Optional: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (rate limiter), `OPTIMIZE_API_KEY` (Prisma Optimize), `DEBUG_AUTH_KEY`.
- Validation: `src/lib/env-validation.ts` and checks in `src/lib/auth.ts:26-36`.

## Data Models (Prisma)
- `User`: profile, points, relations (`prisma/schema.prisma:13-33`).
- `Quiz`: metadata and relations (`prisma/schema.prisma:35-52`).
- `Question`: text, JSON `options`, optional `correctOption`, status (`prisma/schema.prisma:54-72`).
- `QuizAttempt`: per‑user per‑quiz submission; deferred evaluation (`prisma/schema.prisma:74-99`).
- `Answer`: per‑question answer tied to `QuizAttempt` (`prisma/schema.prisma:101-115`).
- `QuestionAttempt`: tracking per‑question attempts to support reattempts (`prisma/schema.prisma:117-133`).
- `DailyPayment`: grants 24h access (`prisma/schema.prisma:234-250`).
- `Prize`, `PrizeRedemption`, `Winning`: prizes, claims and winners (`prisma/schema.prisma:150-206`, `169-184`, `186-206`).
- `RateLimitEntry`, `SecurityEvent`: security telemetry (`prisma/schema.prisma:208-232`).
- Streaming: `StreamConfiguration`, `StreamSession`, `StreamMetrics` (`prisma/schema.prisma:252-307`).

## Key Backend Modules
- `Auth`: NextAuth configuration, admin detection via `ADMIN_EMAILS` (`src/lib/auth.ts:52-155, 223-235`).
- `CSRF`: token generation and middleware enforcement (`src/app/api/csrf-token/route.ts:12-42`, `src/lib/csrf-protection.ts`).
- `Rate Limiting`: generic/admin/prizeRedemption buckets (`src/lib/rate-limiter.ts:213-249`, apply via `applyRateLimit`).
- `Security Headers`: standardized response headers (`src/lib/security-headers.ts:39-59`).
- `Security Monitoring`: event logging and heuristics (`src/lib/security-monitoring.ts`).
- `Payment Access`: check/require 24h access (`src/lib/payment-middleware.ts:18-87, 92-109`).
- `DB Client`: `src/lib/prisma.ts` and `src/lib/db-load-balancer.ts`.

## API Endpoints
- `GET /api/quizzes`: list quizzes with access status and ETag caching (`src/app/api/quizzes/route.ts:58-215`).
- `POST /api/quizzes`: admin create quiz (CSRF + rate limit) (`src/app/api/quizzes/route.ts:217-321`).
- `GET /api/quizzes/[id]`: gated quiz details, returns only unattempted questions on reattempt (`src/app/api/quizzes/[id]/route.ts:9-172`).
- `POST /api/quizzes/[id]/submit`: submit answers; evaluation deferred (`src/app/api/quizzes/[id]/submit/route.ts:19-298`).
- `GET /api/quizzes/[id]/results`: per‑attempt results (deferred scoring) — present in repo; review for parity.
- `POST /api/payments`: create 24h access (demo, CSRF) (`src/app/api/payments/route.ts:15-132`).
- `GET /api/payments`: current access + recent payments (`src/app/api/payments/route.ts:134-218`).
- `POST /api/daily-payment`: alt daily payment creation (CSRF) (`src/app/api/daily-payment/route.ts:16-138`).
- Admin:
  - `GET /api/admin/quizzes`: list with stats (`src/app/api/admin/quizzes/route.ts:34-192`).
  - `GET/PUT /api/admin/quizzes/[id]`: detailed quiz view and update (CSRF, rate limit) (`src/app/api/admin/quizzes/[id]/route.ts`).
  - `GET/POST /api/admin/quiz-evaluation`: calculate correctness and points (`src/app/api/admin/quiz-evaluation/route.ts:1-183, 213-290`).
  - `POST /api/admin/points-allocation`: award points to winners (`src/app/api/admin/points-allocation/route.ts:1-188`).
  - `GET/PUT /api/admin/claims`: manage prize claims (CSRF, rate limit) (`src/app/api/admin/claims/route.ts:17-133, 135-290`).
  - `GET/POST /api/admin/stream-embed`: persisted livestream embed html (`src/app/api/admin/stream-embed/route.ts:33-75`).
- Prizes & redemption:
  - `GET /api/prizes`: list and seed defaults if none (`src/app/api/prizes/route.ts:63-128`).
  - `GET/POST /api/prize-redemption`: history and redeem (CSRF, rate limit) (`src/app/api/prize-redemption/route.ts:18-203`).
- Streaming:
  - `GET /api/streaming/active`: serve admin embed (cached) (`src/app/api/streaming/active/route.ts:32-69`).
- Profile:
  - `GET /api/profile`: quiz history, best scores, winnings (`src/app/api/profile/route.ts`).
- Debug:
  - `GET /api/debug/auth`: returns session and env hints (guarded) (`src/app/api/debug/auth/route.ts:1-41`).

## Frontend Pages & Flows
- `Quizzes Page`: lists quizzes, live stream, access banner, payment modal (`src/app/quizzes/page.tsx:178-365`).
  - Fetches quizzes: `src/app/quizzes/page.tsx:84-116`.
  - Error banner renders text like “Failed to fetch quizzes” when API fails (`src/app/quizzes/page.tsx:216-221`).
- `Quiz Page`: gated access; loads unattempted questions on reattempt; client‑side submission (`src/app/quiz/[id]/page.tsx:66-96, 98-126`).
- `Quiz Results`: shows evaluated results or pending state (`src/app/quiz/[id]/results/page.tsx`).
- `Admin Dashboard`: multi‑tab for overview/quizzes/evaluation/claims/streaming/maintenance (`src/app/admin/dashboard/page.tsx`).
- `Admin Quiz Management`: per‑quiz management (`src/app/admin/quiz/[id]/page.tsx`).
- `Profile`: user details and history (`src/app/profile/*`).
- `LeaderBoard`, `Register`, `Login`: standard pages; NextAuth routes map `pages.signIn = /login` (`src/lib/auth.ts:61-65`).

## Security & Performance
- **Auth Enforcement**: `requireAuth` before protected endpoints (`src/app/api/quizzes/route.ts:62-69`).
- **Payment Gating**: `checkPaymentAccess`/`requirePaymentAccess` (`src/lib/payment-middleware.ts:18-87, 92-109`).
- **CSRF**: required on mutating routes (`src/app/api/quizzes/route.ts:220-224`, `src/app/api/quizzes/[id]/submit/route.ts:27-33`).
- **Rate Limiting**: `rateLimiters.general/admin/prizeRedemption` (`src/lib/rate-limiter.ts:213-249`), applied via `applyRateLimit`.
- **Security Headers**: responses wrapped with `createSecureJsonResponse` (`src/lib/security-headers.ts:39-59`).
- **ETag & 304**: quiz list returns ETag/304 to prevent redundant transfers (`src/app/api/quizzes/route.ts:84-95, 198-203`).
- **Sanitization**: livestream embed stripped of scripts (`src/app/api/admin/stream-embed/route.ts:63-65`).

## Step‑By‑Step Rebuild Plan (Claude)
1. Initialize project:
   - Create Next.js App Router project (TypeScript, Tailwind). Install dependencies from `package.json`.
2. Configure Prisma (MongoDB):
   - Copy `prisma/schema.prisma` and set `DATABASE_URL`.
   - Run `npx prisma generate` and `npx prisma db push`.
3. Implement authentication:
   - Configure NextAuth (`src/lib/auth.ts`), add Google Provider envs, set `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ADMIN_EMAILS`.
   - Add credential login and JWT callbacks.
4. Security modules:
   - Port CSRF generator/middleware, `security-headers`, `security-logger`, `rate-limiter`.
5. Payments:
   - Implement `/api/payments` and `/api/daily-payment` to create/inspect 24h access, and `payment-middleware` for gating.
6. Quizzes:
   - `/api/quizzes` list with ETag/caching and access flags.
   - `/api/quizzes/[id]` returns only unattempted questions on reattempt.
   - `/api/quizzes/[id]/submit` records answers, defers scoring.
7. Admin:
   - `/api/admin/quizzes` list + stats; `/api/admin/quizzes/[id]` full edit.
   - `/api/admin/quiz-evaluation` evaluate attempts, set correctness on `answer`/`questionAttempt` and compute points.
   - `/api/admin/points-allocation` award points.
   - `/api/admin/claims` review prize redemptions.
   - `/api/admin/stream-embed` store embed html.
8. Prizes & redemption:
   - `/api/prizes` seed/list; `/api/prize-redemption` redeem and history.
9. Streaming:
   - `/api/streaming/active` serve embed; frontend player loads from JSON.
10. Frontend pages:
    - `quizzes` page with `LazyStreamPlayer`, access banner, payment modal.
    - `quiz/[id]` page: load questions, timer, answer selection, submit.
    - `quiz/[id]/results` page.
    - Admin dashboard and per‑quiz management pages; evaluation manager; claims and streaming managers.
11. Error and edge cases:
    - Surface rate limit (429), auth (401/403), payment required (402), not found (404). Handle ETag/304 gracefully.
12. Hardening:
    - Apply `createSecureJsonResponse`, CSRF on mutating routes, rate limiting, admin checks, sanitization.

## Operational Commands
- Dev: `npm run dev`.
- Build: `npm run build` then `npm start`.
- Lint: `npm run lint`.
- Prisma: `npx prisma generate`, `npx prisma db push`, `npx prisma studio` (optional).

## Notable Behaviors to Preserve
- Reattempts show only newly added questions; previously attempted ones are blocked (`src/app/api/quizzes/[id]/route.ts:100-131`).
- Evaluation is admin‑driven; user submissions are “predictions” until evaluated (`src/app/api/quizzes/[id]/submit/route.ts:165-185, 269-285`).
- Quiz list caching with ETag/304; client should handle 304 or set `cache: 'no-store'` (`src/app/quizzes/page.tsx:84-116`).
- Payment gating returned to client as `hasAccess`, `paymentInfo`, `accessError` (`src/app/api/quizzes/route.ts:188-194`).

## Minimal .env Template
```
DATABASE_URL="mongodb+srv://user:pass@cluster/db?retryWrites=true&w=majority"
NEXTAUTH_SECRET="<long-random-string>"
NEXTAUTH_URL="http://localhost:3000"
ADMIN_EMAILS="admin@example.com,owner@example.com"
GOOGLE_CLIENT_ID="<google-client-id>"
GOOGLE_CLIENT_SECRET="<google-client-secret>"
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""
OPTIMIZE_API_KEY=""
DEBUG_AUTH_KEY=""
```

## File Map (High‑Level)
- Backend routes: `src/app/api/**`.
- Auth/security: `src/lib/auth.ts`, `src/lib/csrf-protection.ts`, `src/lib/rate-limiter.ts`, `src/lib/security-headers.ts`, `src/lib/security-logger.ts`.
- Data access: `src/lib/prisma.ts`, `src/lib/db-load-balancer.ts`.
- Frontend pages: `src/app/**` (quizzes, quiz, results, admin, profile, etc.).
- Components: `src/components/**` (stream player, admin managers, prize redemption).
- Prisma schema: `prisma/schema.prisma`.

---
This guide enables a faithful, secure rebuild with Claude by following the ordered steps and preserving important behaviors and safeguards.