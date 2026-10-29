# edge-shield

Cloudflare Worker routed on `1think2win.com/api/*` (and `staging.1think2win.com/api/*`). It rate-limits at the
edge, keeps the API's share of Hostinger's traffic under Hostinger's own limit, times out slow origin calls with
the app's 503 shape, turns Hostinger's 403 block page into that same retryable 503, and calls the app's scheduler
every minute. Details are in the header of [`src/index.ts`](src/index.ts) and in [`wrangler.toml`](wrangler.toml).

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

If the Worker itself throws, `passThroughOnException` sends the request on to Hostinger as if it weren't there.

## Routes without the Worker

Created through the Cloudflare API (a route with no script), not by Wrangler. Each would cost Worker requests and
gain nothing:

| Pattern | Why |
|---|---|
| `1think2win.com/api/live` | cached by a Cache Rule for 5 s; players poll it every 5–7 s (~600 requests per player-hour) |
| `1think2win.com/api/live/*` | shared quiz copies, cached by the same rule |
| `1think2win.com/api/leaderboard` | cached by a Cache Rule (deploy/cloudflare-leaderboard-cache-rule.json) |
| `1think2win.com/api/webhooks/*` | Brevo and AWS SES callbacks |
| `1think2win.com/api/auth/send-email-hook` | Supabase's send-email hook |

The more specific pattern wins, so these beat `1think2win.com/api/*`.

## Deploy production (log-only first)

1. Owner, once: in `edge-shield/`, `npm ci`, `npx wrangler login`, then `npx wrangler secret put CRON_SECRET` and
   paste the value of `CRON_SECRET` from hPanel. It must equal the app's, or the scheduler calls get 401.
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
- Session keys come from the unverified cookie; the per-IP ceiling bounds anyone who rotates fake cookies.
- Requests that reach Hostinger without going through Cloudflare skip the Worker. The app's own limits and load
  shedding remain the backstop.
- The zone also has a Cloudflare rate-limit rule, "API flood guard (D5)": 600 requests per 10 s per IP and location on
  `/api/*` except `/api/live`. It runs before this Worker.
- These tests run locally (`npx vitest run`), not in CI.
