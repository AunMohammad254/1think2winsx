# edge-shield

Cloudflare Worker routed on `1think2win.com/api/*` (and `staging.1think2win.com/api/*`). It rate-limits at the
edge, keeps the API's share of Hostinger's traffic under Hostinger's own limit, times out slow origin calls with
the app's 503 shape, turns Hostinger's 403 block page into that same retryable 503, and calls the app's scheduler
every minute. With `LOCKIN_EDGE = "true"` it also takes quiz lock-ins itself and queues them for Supabase, so they
never reach Hostinger ([below](#lock-ins-at-the-edge-lockin_edge)). Details are in the headers of the files in
[`src/`](src) and in [`wrangler.toml`](wrangler.toml).

Status (2026-10-29): production Worker not deployed yet. Staging Worker deployed (version `3ea23e81`), with its
cron removed on 2026-10-29: `staging.1think2win.com` has no DNS record, so it called a name that doesn't resolve
every minute (1,418 runs a day). The account is on **Workers Paid** since 2026-10-14 (10 million requests a month
included, then $0.30 per million; no daily limit).

## What it does on each `/api` request

| Step | Limit (production) | Over it |
|---|---|---|
| per caller: submits | 10 per 10 s per session (per IP without one) | 429 busy |
| per caller: other API calls | 600 per minute per session | 429 busy |
| per IP ceiling | 3,000 per minute (a carrier NAT or campus Wi-Fi full of players) | 429 busy |
| Hostinger's budget | 600 per 10 s (60/s) per Cloudflare location, counted only for requests that passed the above | 503 busy |
| origin call | no headers within 15 s (not for `/api/admin/*`, `/api/cron/*` and uploads) | 503 busy |
| Hostinger's HTML 403 block page | n/a | 503 busy, logged as `hostingerBlock` |

Busy answers have the app's `withLoadShed` body and a jittered `Retry-After`, so the client's retry helper backs
off on its own. Hostinger blocks the whole site (403, about 19 minutes) at roughly 100 requests/s. Players in
Pakistan arrive mostly through Cloudflare's Karachi location (KHI), a few through Lahore (LHE) and Muscat (MCT), so
the 60/s budget leaves room for page requests, which don't pass this Worker.

`/api/cron/*`, `/api/webhooks/*` and `/api/auth/send-email-hook` are never limited: the scheduler, and senders
(Brevo, AWS SES, Supabase) that sign their own calls and burst from a few IPs during a newsletter.

If the Worker itself throws, `passThroughOnException` sends the request on to Hostinger as if it weren't there
(except lock-ins at the edge, which answer 503 busy instead: at lock-in volume Hostinger would block the site).

## Lock-ins at the edge (`LOCKIN_EDGE`)

Goal: 50,000 players locking in on one live quiz, with Supabase as the only limit. At a question's deadline those
lock-ins arrive within seconds; at ~100 requests/s Hostinger blocks the whole site for about 19 minutes. So with
`LOCKIN_EDGE = "true"` they never reach it:

1. `POST /api/quizzes/<id>/submit` without `X-Lockin-Direct: 1` is taken by the Worker
   ([`src/lockin.ts`](src/lockin.ts)), a live match's over included: `submit_lockin_batch` judges each over's
   questions by their own close time at the edge's receive time. Only app builds before 2026-11-06 send that header
   (on match overs); those requests go to Hostinger as before, with the usual limits.
2. `Origin` must be `SITE_URL` (else 403 `forbidden`).
3. The session is checked here ([`src/session.ts`](src/session.ts), [`src/jwt.ts`](src/jwt.ts)): the
   `sb-<ref>-auth-token` cookie (chunked `.0`, `.1`… and `base64-` encoded, as @supabase/ssr writes it) holds the
   access token, an ES256 JWT verified against the project's JWKS (`/auth/v1/.well-known/jwks.json`, kept 10 minutes
   in memory, refetched for an unknown `kid`), then `iss`, `aud = authenticated`, `sub` and `exp`. No cookie or a bad
   token: 401 `unauthorized`. Expired: 401 `session_expired`, so the client refreshes and sends again. JWKS
   unreachable with nothing cached: 503 busy.
4. `SUBMIT_LIMITER` applies per session as before (log-only while `ENFORCE = "false"`). The per-IP ceiling and
   Hostinger's budget don't: the session is verified, and nothing reaches Hostinger.
5. The body is checked like the app's `submitQuizSchema` (unanswered `-1` entries dropped, then 1–200 answers with a
   1–100 character `questionId` and an integer `selectedOption` 0–9); bad: 400, over 64 KB: 413.
6. The receive time is stamped, the quiz's tally ([`src/tally.ts`](src/tally.ts)) gets +1, and
   `{ q, u, t, a: [{ q, o }] }` goes on the `lockins` queue. The player gets **202** in the app's success shape with
   `status: "received"`. If the queue refuses, the tally gets its 1 back and the player gets 503 busy (retried).
   Any other fault also answers 503 busy, never Hostinger.
7. The consumer ([`src/consumer.ts`](src/consumer.ts)) takes batches of up to 100 (4 at a time), groups them by
   quiz and calls `public.submit_lockin_batch(p_quiz_id, p_items)` with the service-role key. The database judges each
   lock-in by `t`, so time spent in the queue never makes a player late, and returns one status per item (`saved`,
   `reattempt`, `duplicate`, `closed`, `entries_closed`, `invalid`, `payment_required`, `not_found`), logged in
   Workers Logs as `lockinBatch` counts. A failed call is retried after 5 s; after 20 tries its messages go to
   `lockins-dlq`. Nothing is dropped.

With `LOCKIN_EDGE = "true"`, `GET /api/csrf-token` is answered here too (a fresh base64url token of 32 random bytes,
valid one hour): the app checks CSRF tokens only by format and `Origin`, and players fetch one before every lock-in.

`GET /api/edge/lockin-status?quiz=<id>` with `Authorization: Bearer <CRON_SECRET>` returns `{ quizId, received }`,
the lock-ins this Worker accepted for that quiz (16 Durable Object shards summed; resends count again). It is never
rate-limited and answers whatever `LOCKIN_EDGE` says, since queued lock-ins keep draining when it is off.

**Off switch:** set `LOCKIN_EDGE = "false"` in `wrangler.toml` and `npm run deploy`. Lock-ins and CSRF tokens go
to Hostinger again; the consumer keeps saving what is already queued.

### Rollout (owner)

1. Before turning it on: `submit_lockin_batch` is applied in production, and the client build that handles the
   202 (match overs included) and resends after `session_expired` is deployed on Hostinger.
2. Once, in `edge-shield/`:
   - `npx wrangler queues create lockins` and `npx wrangler queues create lockins-dlq`
   - `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`, pasting `SUPABASE_SERVICE_ROLE_KEY` from hPanel
   - staging, if used: `npx wrangler queues create lockins-staging`, `npx wrangler queues create lockins-staging-dlq`
     and `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging`
3. `npx vitest run`, then `npm run deploy` with `LOCKIN_EDGE = "false"`: this adds the queue, its consumer and the
   tally Durable Object without changing any request.
4. Set `LOCKIN_EDGE = "true"` and deploy again. Lock in on a test quiz, then check Workers Logs for a `lockinBatch`
   line with `saved`, and
   `curl -H "Authorization: Bearer <CRON_SECRET>" "https://1think2win.com/api/edge/lockin-status?quiz=<id>"`.
5. Watch `lockins-dlq` (dashboard → Storage & databases → Queues): any message there is a lock-in that could not be
   saved in 20 tries, with its user, quiz, receive time and answers.

Costs on Workers Paid: about 3 queue operations per lock-in (write, read, delete; 1 million a month included, then
$0.40 per million) and one Durable Object request per lock-in (1 million included, then $0.15 per million).

Staging's `SUPABASE_URL` is a placeholder (`set-a-staging-project.invalid`) that doesn't resolve, so staging can never
save lock-ins to the live database. Before a staging load test with `LOCKIN_EDGE = "true"`, set it to a test
project's URL (a Supabase Free org, so it costs nothing) and put that project's service-role key in the staging
secret.

## Routes without the Worker

Created through the Cloudflare API (a route with no script), not by Wrangler. Each would cost Worker requests and
gain nothing:

| Pattern | Why |
|---|---|
| `1think2win.com/api/live` | cached by a Cache Rule for 5 s; players poll it every 5–7 s (~600 requests per player-hour) |
| `1think2win.com/api/live/*` | shared quiz copies, cached by the same rule |
| `1think2win.com/api/leaderboard` | cached by a Cache Rule (deploy/cloudflare-leaderboard-cache-rule.json) |
| `1think2win.com/api/streaming/active*` | whether a stream is on: cached for 5 s by the live API Cache Rule (since 2026-11-12) |
| `1think2win.com/api/webhooks/*` | Brevo and AWS SES callbacks |
| `1think2win.com/api/auth/send-email-hook` | Supabase's send-email hook |

The more specific pattern wins, so these beat `1think2win.com/api/*`.

## Deploy production (log-only first)

1. Owner, once: in `edge-shield/`, `npm ci`, `npx wrangler login`, then `npx wrangler secret put CRON_SECRET` and
   paste the value of `CRON_SECRET` from hPanel. It must equal the app's, or the scheduler calls get 401. Deploys
   also need the `lockins` queues and `SUPABASE_SERVICE_ROLE_KEY` (step 2 of the lock-in rollout above).
2. `npx vitest run`, then `npm run deploy`. `ENFORCE = "false"` in `wrangler.toml`: every limit is counted and
   logged as `wouldLimit` in Workers Logs, and nothing is blocked.
3. Create the routes without the Worker (above), then check: `bun run cache:check` and `bun run smoke:prod` from the
   project folder, and Workers Logs for a scheduled run every minute with no `process-scheduled answered 401`.
4. After a few days or one live quiz, read the `wouldLimit` and `hostingerBlock` lines and tune the limits. Then set
   `ENFORCE = "true"` and deploy again.

The app keeps its in-process scheduler (`SCHEDULER_ENABLED` unset in production) as a fallback. Running both is safe
because jobs claim rows atomically.

**Off switch:** Cloudflare → the zone → Workers Routes → remove `1think2win.com/api/*` (or the Worker's route in its
Settings → Domains & Routes). Traffic then goes straight to Hostinger, as before. After later deploys,
`npx wrangler rollback` returns to the previous version.

## Staging

`npm run deploy:staging` deploys with `ENFORCE = "true"` and no cron. Before a staging load test: add a Proxied
`staging` DNS record in Cloudflare pointing at the staging Hostinger app the same way the apex does, set
`[env.staging.triggers] crons = ["* * * * *"]` again, and deploy. On staging the app runs with
`SCHEDULER_ENABLED=false`, so the cron is what moves scheduled quizzes live there. Staging's per-IP ceiling
(200,000/min) is high so one k6 machine isn't capped.

## After it is live

- The app's own per-IP limits (login, newsletter, chatbot) need the visitor IP: re-run the `curl` in
  [`load-test/README.md`](../load-test/README.md#setting-the-visitor-ip-trusted_proxy_hops--trusted_ip_header)
  and set `TRUSTED_IP_HEADER` / `TRUSTED_PROXY_HOPS` from its table.

## Limits to know

- Rate limits are counted per Cloudflare location and are approximate by design. They absorb bursts; they are not
  exact quotas. Hostinger's budget is per location too, so traffic split across KHI, LHE and MCT gets up to 60/s each.
- Session keys come from the unverified cookie; the per-IP ceiling bounds anyone who rotates fake cookies. Lock-ins
  at the edge verify the session first, so a fake cookie gets a 401 there.
- Session tokens must be ES256. If the project ever goes back to the legacy HS256 secret, every lock-in at the edge
  gets 401: turn `LOCKIN_EDGE` off.
- Requests that reach Hostinger without going through Cloudflare skip the Worker. The app's own limits and load
  shedding remain the backstop.
- The zone also has a Cloudflare rate-limit rule, "Origin flood guard (D5)"
  ([deploy/cloudflare-origin-rate-limit-rule.json](../deploy/cloudflare-origin-rate-limit-rule.json)): one address
  (per Cloudflare location) may send 600 requests per 10 s to Hostinger, on any path; past that, the address is
  refused for 10 s. It runs before this Worker. Since 2026-11-13 it counts only requests that go to the origin
  (`requests_to_origin`, which the Free plan accepts), on every path:
  - Before, it covered `/api/*` only, so one address could send any number of page requests (`/quizzes?x=1`,
    `/login`, a made-up path) and trip Hostinger's site-wide block alone.
  - Before, it also counted cached polls (`/api/live/quizzes/*`, the match feed every 3 s), so about 200 viewers
    behind one carrier address would have been refused. Cached answers no longer count against anyone.
  - Nothing is left out by path except Cloudflare's own `/cdn-cgi/`: a made-up path under `/_next/static/` or
    `/api/live/` is a cache miss, reaches Hostinger, and so is counted.
  - The number is unchanged, and it is a ceiling per shared address: about 150 to 200 players behind one address
    acting in the same 10 s. Raise it from an event's data, not by guess. **Rollback:** `PATCH` the rule back to
    `(starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne "/api/live")` without
    `requests_to_origin`.
- These tests run locally (`npx vitest run`), not in CI.
