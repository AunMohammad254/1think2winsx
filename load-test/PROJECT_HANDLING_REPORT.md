# 1Think2Win: 50k-user scale project, handling report

Updated: 2026-10-09 · Branch: `perf/phase-0-1-scale` (not merged, not deployed; all work below is committed, latest `8d890ab`) · Status: Phase 0 + Phase 1 done, staging database built and benchmarked, further fixes made and tested; the app-level load test has **not** been run (it needs your Hostinger staging deploy and the staging secret key).

## 1. Goal and starting verdict

Goal: handle 50,000 concurrent active users on a live-quiz platform (real-time delivery, user writes, outbound push / email / third-party calls) on the current stack, with no new services and no big rewrite.

Hosting facts that shaped every decision: Hostinger managed Node hosting (one Node process, no nginx/Docker/replicas) and a single production Supabase project (`snhgaklxawthpihjiagh`, Tokyo) on the **Free plan** (60 DB connections).

Starting verdict (from reading the code): the system could not serve 50k real-time users or complete a 50k outbound blast. Three things broke first: the single Node origin sits in every herd path; Realtime used per-subscriber-RLS `postgres_changes`; outbound sends ran inside HTTP handlers and silently truncated at 1,000 rows. The submit RPC itself was already solid.

## 2. Delivered earlier (commit `e19a4bc`)

**Phase 0, measurement tooling (`load-test/`):** k6 scenarios (`poll.js`, `herd.js`, `public.js`), `monitor.ts` (event-loop lag, in-flight requests, memory via `/api/health?stats=1`), `prepare-users.ts` (refuses the production project), `RUNBOOK.md`, `REPORT_TEMPLATE.md`, `staging-extras.sql`.

**Phase 1, quick wins:** wallet-flag write storm removed; streaming-client leak fixed; keyset pagination so pushes/newsletters reach everyone (was ≤1,000); lazy profile/notification loading; jittered, visibility-aware polling; list payload slimmed; leaderboard cache job and stale-tolerant `get_leaderboard`; fetch timeouts and load shedding (503 + Retry-After); client retry with jitter; `console.error` kept in production; trusted client-IP resolution (`TRUSTED_PROXY_HOPS` / `TRUSTED_IP_HEADER`); chatbot and share-card hardening; CSRF token caching; public liveness-only `/api/health`.

Production database migration `20261008120000_phase1_scale_hardening.sql` was applied by you and verified (cron job, populated cache, 3 indexes, 10 policies wrapped). It is not tracked in git (`SQL/` is ignored).

## 3. Staging database (built 2026-10-09)

Staging project `veymkpalrmknhprvxqja` (`1think2win-staging`, Seoul, Postgres 17.11) was rebuilt from production's catalog, read-only, and applied through the connector (migrations `staging_01` … `staging_06`). No user data copied; production was only read.

Verified against production with identical fingerprint queries: 27 tables, 2 views, 59 constraints, 77 indexes, 54 policies, and **identical hashes** for columns, indexes, policies, constraints, the 56 function bodies, table/column grants and view definitions. Harmless differences: staging has Supabase's `rls_auto_enable` helper; `auth_uid()` is granted to public explicitly (production relies on the default, same behaviour). Staging is currently empty and clean (0 users, 77 indexes, 1 cron job).

## 4. Measured on the staging database this session (real, not estimated)

All numbers are database-side only (the real production functions, no Node, no PostgREST, no network), on the Free-plan instance (same size class as production). Synthetic users and quizzes were created and fully removed afterwards.

| Test | Result |
|---|---|
| `submit_quiz_attempt`, 1 session, 20 answers, fresh DB | **2.4 ms** avg (p95 3.7, p99 4.6) ≈ 400/s per session |
| Same, 4 truly parallel sessions (pg_cron) | **365 submits/s total**: no scaling over 1 session (~333/s). The instance saturates at ~350/s regardless of parallelism |
| Same under sustained load (~25k attempts written) | rose to 10 ms (parallel) and later 23 ms single-session, partly recovering after 30 s of rest (12 ms). Consistent with the burst disk/CPU budget of small instances running out; the dashboard metric "Disk IO % consumed" would confirm. Not proven |
| Write cost of the duplicate `Answer` table (interleaved A/B in one session) | `QuestionAttempt` only: 2.5 ms; current path (also `Answer`): 4.4 ms in a calm run, 8.9 ms in a busy one. The duplicate write is **40–70 % of a submit** |
| Dropping `Answer` indexes | little effect (−3 % and −10 %): the cost is the extra rows themselves, not a bad index. Indexes were restored |
| Scoring a 2,000-attempt quiz | **current way** (`evaluate_question` ×20 + `finalize_quiz_scores`): **7.1 s**. Set-based join (set the answer key, one UPDATE): **0.23 s**, identical scores (31× faster) |
| `evaluate_question`, one question, 4,000 attempts | 6.3 s (under throttling) |
| Leaderboard at ~22k users / 450k answers | live 369 ms, cache refresh 120 ms, cached read 3 ms |

Meaning for 50k (extrapolated linearly, so treat as order of magnitude): a 50k submit burst is **database-bound at roughly 2–4 minutes on this instance size**, not 25–50 s; post-quiz scoring the current way would take minutes and would likely hit the 30 s admin-client timeout, while the set-based approach would take seconds. Both are fixable in the database (see §7). A Large compute (dedicated CPU, per the Supabase docs) removes the burst-throttling uncertainty.

### Realtime join test (staging, real WebSockets, 100 clients)

| Mechanism | Join result |
|---|---|
| Current `postgres_changes` on `Quiz` | 100/100 subscribed at 25 joins/s and at 5 joins/s |
| Public Broadcast topic | 100/100 at 25 joins/s |
| **Private** Broadcast channel with the authorising policy | **1/100 at 25 joins/s, 67–70/100 at 5 joins/s** (the rest timed out) |

The private channel's per-join authorisation (a database transaction on each join) is a hard join-rate limit on this plan. Security properties held: an anonymous client was refused, a forged signal reached 0 clients, and the real database events (insert, update, delete) were delivered to the connected client with 84 ms delivery after commit. Whether a simpler policy or a larger Realtime database pool on a paid plan removes the limit is **untested** (the auto-mode classifier blocked my attempt to loosen the policy on staging, which I did not work around). The Broadcast code is therefore shipped **off by default** (§5).

## 5. Code changes this session (all uncommitted; 505 tests pass, type-check clean, lint 0 errors, build succeeds)

**Bugs fixed**
- Quiz catalogue read `{quizId, count}` but the database function returns `{quiz_id, attempt_count}`, so "total attempts" was always 0 (`src/lib/quiz-catalog.ts`).
- Lucky draw's consolation points called a function that does not exist and ignored the error, so they were **never awarded**. Now uses `increment_user_points`, bounded concurrency, and reports how many really succeeded (`.../lucky-winner/[quizId]/draw/route.ts`).
- The price shown in the payment dialog came from the *newest* active quiz while the database charges the *oldest* one, so the quoted and charged prices could differ (`src/lib/wallet/service.ts`).
- Late joiners were shown a full countdown although the database rejects answers after `pushedAt + duration`. Now the countdown follows the server's deadline (device-clock-skew safe, no drift in throttled tabs), shows how much time is really left, and disables Start once the window has closed (`src/lib/quiz-clock.ts`, `src/hooks/useQuizCountdown.ts`, `/api/quizzes/[id]`, quiz page and modal).
- 14 `.single()` calls that deliberately ignore "no rows" produced an HTTP 406 on every miss; now `maybeSingle()`.

**Hardening**
- `/api/cron/process-scheduled`: the secret is no longer accepted in the URL (it leaks into access logs); Bearer header only, constant-time compare, shared with `/api/health` (`src/lib/cron-auth.ts`).
- Brevo email sending: per-request timeout and retry of 429/503 with jittered backoff; a timeout is never retried (would risk double emails). `fetchWithRetry` gained `timeoutMs` / `retryOnTimeout`.

**Experimental, OFF by default (`NEXT_PUBLIC_LIVE_BROADCAST=1`)**: private Broadcast channel for quiz changes (a database trigger sends one small message; clients cannot publish) with in-place list patching so a quiz going live causes **no refetch stampede**, plus a jittered unread-count poll instead of the per-user `postgres_changes` notification subscription. Migration `SQL/supabase/migrations/20261009120000_live_broadcast.sql` is written and was tested on staging, then reverted there; **not applied to production**. Do not enable before re-testing joins with `load-test/realtime-probe.ts` on your plan (§4).

**Verified by**: 505 unit/component tests (including the real quiz modal rendered with server-clock scenarios), a real local server pointed at staging with all external credentials blanked (health, cron auth, CSRF, unauthenticated paths: all as expected; warm 401s 12–18 ms), staging database benchmarks (§4) and a real-WebSocket probe.

## 6. Corrections to earlier statements
- Earlier I suggested removing the bcrypt hash at signup as redundant. It is **not**: the profile route compares passwords against it. Left alone.
- Earlier I called production "Micro". The `max_connections=60` fits both Nano (Free) and Micro; the Free plan's compute is Nano.
- The public Broadcast topic I first planned would let any visitor send a fake signal. The design was changed to a private, receive-only channel.

## 7. Recommendations that need your decision (not done)
1. **Stop writing every answer twice.** `Answer` and `QuestionAttempt` hold the same data; writing only one is 1.7–3.5× faster per submit.
2. **Score quizzes set-based.** Stop stamping `isCorrect` on millions of rows; set the answer key and score with one UPDATE (31× faster, identical results). `isCorrect` consumers (leaderboard correct-answer count, profile, admin question stats) would compute from the key instead. This is a production database change.
3. Move to **Large compute** before a real event (dedicated CPU, 160 DB connections, ~$110/month per the Supabase docs) and a paid plan; re-measure with the staging load test.
4. Decide on enabling the Broadcast path only after testing joins on the paid plan.

## 8. Still required before the app-level load test (owner actions)
1. Staging Supabase: check the signing key (ES256), raise Auth rate limits temporarily, turn confirm-email off for the test, and **provide the staging secret key** (it is not available through any connector). Safest hand-over: put it in a git-ignored file and I will read it from there instead of the chat.
2. Deploy a separate staging app on Hostinger from this branch with hand-made environment variables (never `.env.hostinger-import`); set `CRON_SECRET`, `LOAD_SHED_*`, `TRUSTED_*`, `WALLET_FEATURE_ENABLED` as in production.
3. Run the visitor-IP `curl` in `load-test/README.md`, then set `TRUSTED_PROXY_HOPS` / `TRUSTED_IP_HEADER` on staging **and production**.
4. Staging shares the Free organization with production (shared quotas): move it to its own organization, or keep runs small and watch Usage.
5. Create an active quiz with questions on staging, seed users, smoke test, ramp, then tell me "report ready".
6. Decide whether to commit/merge `perf/phase-0-1-scale` and deploy; nothing has been pushed.

## 9. Not verified / limits of this work
- The app has not been exercised end to end with signed-in users (no secret key for staging); only component-level tests, a local server without admin access, and database-level benchmarks.
- Database numbers are single-instance, synthetic and extrapolated; sustained-load slowdown cause (burst budget vs autovacuum vs bloat) is unproven.
- k6 scenarios, push and email sending have still only run against fakes.
- Free-plan Realtime limits (200 connections, 100 messages/s) are unchanged; Pro is 500 / 500, and 10,000 / 2,500 with the spend cap off; 50k concurrent sockets needs Enterprise or a polling-first design.

## 10. Reference
- Commits: `e19a4bc` (Phase 0/1), `806b7fe`, `bdf55c4` (Node 22), `8d890ab` (this session: fixes, hardening, staging deploy tooling).
- Plan: `C:\Users\Aun Abbas\.claude\plans\deep-dive-into-my-calm-swan.md`.
- Staging schema SQL (git-ignored, no data): `load-test/.data/staging-schema/`. Probe tool: `load-test/realtime-probe.ts`.
- Local staging-pointed dev server config (git-ignored): `load-test/.data/run-staging-dev.cjs`, `.claude/launch.json` entry `staging-smoke`.
