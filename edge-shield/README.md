# edge-shield

Cloudflare Worker routed on `/api/*` for `1think2win.com`, `www` and `staging`. It rate-limits at the edge,
caches `/api/leaderboard`, times out slow origin calls with the app's 503 shape, and calls the app's scheduler
every minute. Details are in the header of [`src/index.ts`](src/index.ts) and in [`wrangler.toml`](wrangler.toml).

Status (2026-10-13): staging Worker deployed (version `3ea23e81`, staging `CRON_SECRET` set). It gets no traffic yet
because `staging.1think2win.com` has no DNS record. Production Worker not deployed.

## Plan: use Workers Paid ($5/month)

The Free plan allows **100,000 Worker requests per day for the whole account** (reset 00:00 UTC, 05:00 PKT).
Past that, the routes either fail open (the Worker is skipped, so the origin takes the burst with no edge limits
or cache) or fail closed (Cloudflare error 1027 on every `/api` call).

That is too little for this test. A signed-in player on the quiz list polls `/api/quizzes` every 60–80 s, which is about
50 requests an hour, plus a few per quiz. So 5,000–10,000 players for one evening come to roughly 250,000–500,000
requests, and a single k6 `poll.js` run at 833 req/s uses up 100,000 in two minutes.

Workers Paid costs $5/month per account and includes 10 million requests a month (then $0.30 per million) and 30 million
CPU-ms. This Worker does very little CPU work, so a test month should cost $5. Only `/api/*` runs the Worker: pages,
images and the browser's direct Supabase calls are not counted.
Source: developers.cloudflare.com/workers/platform/limits and /pricing (checked 2026-10-13).

## One-time setup (account owner)

1. Cloudflare dashboard → **Workers & Pages → Plans** → Workers Paid.
2. `cd edge-shield`, `npm ci`, `npx wrangler login`.
3. `CRON_SECRET` must equal the app's `CRON_SECRET` in hPanel for the same site:
   `npx wrangler secret list --env staging` (probably already set) and `npx wrangler secret put CRON_SECRET` (production).
4. Staging DNS: the zone's DNS is on Cloudflare, so hPanel cannot create the subdomain record. In Cloudflare → DNS,
   add `staging`, pointing at Hostinger the same way the existing `1think2win.com` / `www` records do, set to
   **Proxied**. The route only matches the name `staging.1think2win.com`.

## Deploy staging, then production

```bash
npx vitest run
npm run deploy:staging
```

Check on staging:

| Check | Expected |
|---|---|
| `curl -sI https://staging.1think2win.com/api/leaderboard` twice | second answer has `cf-cache-status: HIT` |
| `seq 700 \| xargs -P 25 -I{} curl -s -o /dev/null -w "%{http_code}\n" https://staging.1think2win.com/api/health \| sort \| uniq -c` | some `429` among the `200`s (the limiter is approximate, so the count varies) |
| Dashboard → the Worker → Logs, for a few minutes | a scheduled run every minute, no `process-scheduled answered 401` |

On staging the app runs with `SCHEDULER_ENABLED=false`, so the cron is what moves scheduled quizzes live there.

Then `npm run deploy` and repeat the first and third checks on `1think2win.com`. Leave `SCHEDULER_ENABLED` unset
in production: the in-process loop stays as a fallback, and running both is safe because jobs claim rows atomically.

**Off switch:** Dashboard → the Worker → Settings → Domains & Routes → remove the routes. Traffic then goes straight
to Hostinger, as it does today. After later deploys, `npx wrangler rollback` returns to the previous version.

## After it is live

- The app's own per-IP limits (login, newsletter, chatbot) need the visitor IP: re-run the `curl` in
  [`load-test/README.md`](../load-test/README.md#setting-the-visitor-ip-trusted_proxy_hops--trusted_ip_header)
  and set `TRUSTED_IP_HEADER` / `TRUSTED_PROXY_HOPS` from its table.
- Load tests: signed-in k6 scenarios are limited per session, and staging's per-IP ceiling (200,000/min) is set
  high so one load machine is not capped. `public.js` is anonymous, so from one machine it shares a single 600/min
  bucket and will mostly get `429`. That is the edge doing its job, not an origin failure.

## Limits to know

- Rate limits are counted per Cloudflare location and are approximate by design. They absorb bursts; they are not
  exact quotas.
- Session keys come from the unverified cookie; the per-IP ceiling (3,000/min in production) bounds anyone who
  rotates fake cookies.
- Requests that reach Hostinger without going through Cloudflare skip the Worker. The app's own limits and load
  shedding remain the backstop.
