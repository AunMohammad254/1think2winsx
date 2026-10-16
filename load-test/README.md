# Load test (Phase 0)

Measures where the app saturates, so scaling work is guided by numbers instead of estimates.
It simulates the three moments that matter for a live quiz:

| Scenario | File | What it models |
|---|---|---|
| Steady polling | `k6/poll.js` | every online player refreshing the quiz list (50k users / 60 s ≈ **833 req/s**) |
| Go-live herd | `k6/herd.js` | everyone opens the quiz, then everyone submits within seconds |
| Anonymous traffic | `k6/public.js` | leaderboard + live-stream check + health probe |

`monitor.ts` runs alongside and samples the app's own **event-loop lag, in-flight requests, memory
and shed count** (`GET /api/health?stats=1`), which is the clearest signal of "the single Node
process is the bottleneck".

> **Never run this against production.** It creates thousands of real auth users, writes quiz
> attempts, and can saturate the app. Use a separate **staging** Supabase project and a separate staging
> deployment of the app. `prepare-users.ts` refuses to run against the production project and requires
> `LOADTEST_CONFIRM_STAGING=yes`.
>
> A Supabase *branch* of production does **not** work as staging here: branches are built from the
> project's migration history, and this project's history has no base schema (see RUNBOOK.md).

**Step-by-step instructions (Windows/PowerShell), the report template and the staging-database setup
are in [`RUNBOOK.md`](./RUNBOOK.md), [`REPORT_TEMPLATE.md`](./REPORT_TEMPLATE.md) and
[`staging-extras.sql`](./staging-extras.sql).** The sections below are the reference version.

## Prerequisites

- [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) (`winget install k6` / `brew install k6`) — a local tool, not a service
- Bun (already used by this repo)
- A staging app deployment (same code, **its own** `.env`) pointing at the staging Supabase project,
  with `CRON_SECRET` set (used by `monitor.ts`)
- The migration `SQL/supabase/migrations/20261008120000_phase1_scale_hardening.sql` applied to staging
- In the staging Supabase dashboard, temporarily raise **Authentication → Rate Limits** (sign-ins,
  token refreshes) while seeding sessions, then restore them

Run everything from the **repository root**.

## 1. Create users and sessions

```bash
export LOADTEST_SUPABASE_URL=https://<staging-ref>.supabase.co
export LOADTEST_SERVICE_ROLE_KEY=<staging service role key>
export LOADTEST_ANON_KEY=<staging anon/publishable key>
export LOADTEST_CONFIRM_STAGING=yes

bun load-test/prepare-users.ts seed --count 5000 --concurrency 10
bun load-test/prepare-users.ts sessions --concurrency 5
```

This writes `load-test/.data/users.json` and `sessions.json` (git-ignored; they contain passwords and
access tokens). Tokens last about an hour, so re-run `sessions` before a long test. Use as many users
as you can: one user can only submit **once per quiz**, and the app limits each user to 60 requests
per minute, so with few users a high `RATE` measures the rate limiter instead of the app.

## 2. Run a scenario (with the monitor in a second terminal)

```bash
# terminal A — process stats from the app under test
export LOADTEST_BASE_URL=https://staging.example.com
export LOADTEST_CRON_SECRET=<staging CRON_SECRET>
bun load-test/monitor.ts

# terminal B — the load
mkdir -p load-test/.data
k6 run -e BASE_URL=$LOADTEST_BASE_URL -e RATE=833 -e DURATION=5m load-test/k6/poll.js
k6 run -e BASE_URL=$LOADTEST_BASE_URL -e RATE=1500 -e DURATION=3m load-test/k6/public.js

# go-live herd: first create an ACTIVE quiz on staging and copy its id
k6 run -e BASE_URL=$LOADTEST_BASE_URL -e QUIZ_ID=<id> -e OPEN_SECONDS=30 -e SUBMIT_SECONDS=30 load-test/k6/herd.js
```

A single laptop comfortably generates a few thousand requests per second. Beyond that run k6 from a
separate machine (or several); do not trust numbers from a load generator that is itself maxed out
(watch its CPU).

## 3. Reading the results

| You see | It means |
|---|---|
| `eventLoopLagP99Ms` above ~200 ms in the monitor while latency climbs | the single Node process is CPU-bound — the origin is the bottleneck |
| rising `rssMb` that does not fall after the run | a memory leak |
| `shed_503` > 0 | the built-in load shedder engaged (`LOAD_SHED_*`); clients retry with `Retry-After` |
| `hard_errors` > 0 | real failures (500s, timeouts, 401/403 you did not expect) — check the app logs |
| latency fine in the app but slow in `pg_stat_statements` | the database, not Node, is the bottleneck → raise Supabase compute |

**Pass criteria used by the thresholds** (adjust to your goals): poll p95 < 1 s, open-quiz p95 < 2 s,
submit p95 < 3 s, public p95 < 800 ms, no hard errors, p99 event-loop lag < 100–200 ms. Results are
saved to `load-test/.data/results-<scenario>-<time>.json`.

Calibrate the safety valve from what you observe: `LOAD_SHED_MAX_INFLIGHT` (default 1500) and
`LOAD_SHED_MAX_LAG_MS` (default 2000) are deliberately loose.

## 4. Realtime connections (5k sample)

Each open browser tab holds a Supabase Realtime WebSocket. One load machine cannot hold 50k, so test
about 5,000, check the Supabase dashboard **Reports → Realtime** (connections, messages/s), and
extrapolate. Ask Supabase support whether fan-out deliveries count against the *Messages per second*
limit of your plan (default for Pro without spend cap / Team: 10,000 connections, 2,500 msg/s), and
request a higher limit before a 50k event.

## Setting the visitor IP (`TRUSTED_PROXY_HOPS` / `TRUSTED_IP_HEADER`)

**The problem.** Some limits are per visitor IP (login attempts, newsletter sign-up, "forgot email", the
chatbot). Your app does not see visitors directly: Hostinger's servers sit in front and pass the visitor's
address along in a header. But a visitor can also send that header themselves with any value they like
(`X-Forwarded-For: 1.2.3.4`). If the app believes the wrong part of it, someone can try unlimited
passwords by changing the fake IP on every request.

**The fix** is to tell the app which header or position to believe. That depends on what Hostinger really
sends, so measure it once (5 minutes):

1. Find your own public IP (search "what is my IP"). Call it `YOUR_IP`.
2. Run this against your **live site**, with your real `CRON_SECRET` from the hPanel environment
   variables. It sends fake values for every IP header on purpose:

   ```bash
   curl -s "https://YOUR-SITE.com/api/health?stats=1" \
     -H "Authorization: Bearer YOUR_CRON_SECRET" \
     -H "X-Forwarded-For: 9.9.9.9" \
     -H "X-Real-IP: 8.8.8.8" \
     -H "CF-Connecting-IP: 7.7.7.7"
   ```

3. In the answer look at `client.received`. Each field is what the app got after Hostinger's
   servers handled the request:

   | What you see | Meaning | What to set |
   |---|---|---|
   | `"x-forwarded-for": "9.9.9.9, YOUR_IP"` | one server in front, it **added** your real IP at the end | `TRUSTED_PROXY_HOPS=1` |
   | `"x-forwarded-for": "9.9.9.9, YOUR_IP, <another IP>"` | two servers in front (e.g. a CDN, then the host) | `TRUSTED_PROXY_HOPS=2` |
   | `"cf-connecting-ip": "YOUR_IP"` (your fake `7.7.7.7` is gone) | the host **overwrites** this header with the real IP | `TRUSTED_IP_HEADER=cf-connecting-ip` |
   | `"x-real-ip": "YOUR_IP"` (your fake `8.8.8.8` is gone) | same idea, different header | `TRUSTED_IP_HEADER=x-real-ip` |
   | every header still shows only your fake values, or `null` | the host does not tell the app the real IP | ask Hostinger support; leave unset for now |

   A header is only safe to trust if **your fake value is not what arrives**. If `cf-connecting-ip`
   comes back as `7.7.7.7`, it is just echoing what you sent: do not use it.
4. Add the one setting in hPanel → your Node app → Environment variables, then redeploy/restart.
5. Run the same `curl` again and check `client.resolvedIp`: it must now be `YOUR_IP`, not a fake
   value. Run it once **without** the fake headers too; it should still be `YOUR_IP`.

**Why it is not set automatically.** Guessing wrong in the other direction is worse than the current
state: if the app were told "one server in front" while there are really two, every visitor would look
like the same IP (the CDN's), the login limit (10 attempts per 15 minutes) would be shared by everyone,
and real users would get blocked. That is why the code keeps the old behaviour until you measure and set it.

## Phase 0 checklist — things only the project owner can confirm

- [ ] **JWT signing**: Supabase → Authentication → Signing Keys uses an asymmetric key (ES256). The
      audits saw ES256 in the public JWKS, so `getClaims()` verifies locally. If it were legacy HS256,
      every API call would cost a network round-trip to Supabase Auth.
- [ ] **pg_cron**: after applying the migration, `select * from cron.job;` shows `refresh-leaderboard`
      and `select count(*) from "LeaderboardCache";` is 300.
- [ ] **Supabase plan**: compute size (production looks Micro-class: `max_connections=60`), Realtime
      connection/message limits, and the Auth rate limits for sign-in and sign-up per IP.
- [ ] **PostgREST max rows**: Dashboard → Settings → API → *Max rows* (a migration note says 1000).
      The new keyset pagination works for any value.
- [ ] **Hostinger plan**: CPU cores, RAM and process limits of the Node web app; whether a custom
      start command is allowed; whether its proxy/CDN caches responses with `Cache-Control: public`.
- [ ] **Region latency**: the Hostinger datacenter vs the Supabase region (production is
      `ap-northeast-1`, Tokyo); every API request pays that round-trip to the database.
- [ ] **Visitor-IP setting** (`TRUSTED_PROXY_HOPS` / `TRUSTED_IP_HEADER`): follow
      [the section below](#setting-the-visitor-ip-trusted_proxy_hops--trusted_ip_header). Until it is
      set, IP-based rate limits (login attempts, newsletter, forgot-email, chatbot) can be dodged by
      sending a forged `X-Forwarded-For` header.
- [ ] **`WALLET_FEATURE_ENABLED`** in hPanel (it is `false` in the local env files): the fixed code
      tolerates either value, but this decides whether quizzes are free.
- [ ] **Brevo plan quota** and bulk-sending terms (needed before Phase 4).
