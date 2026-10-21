# Moving 1think2win.com to Vercel Pro

Date: 2026-10-19 · Status: **plan only**. Nothing has been changed on Vercel, Cloudflare, Hostinger or Supabase.
Superseded for now by moving the Hostinger server to India (`deploy/HOSTINGER_REGION_MOVE.md`); kept for big live events.

> **Public copy.** This repository is public, so the server address, load limits and other clients' details are
> left out. The full copy is in `deploy/private/` on the owner's PC (git-ignored).

## Why

- **The request limit.** Hostinger Business lets only a few requests into the app at once (measured in the 17 Oct
  load test). Under heavy load its abuse protection blocks the whole site, and it can't be configured.
- **The distance.** The Hostinger server is in Paris, but Supabase is in Tokyo (`ap-northeast-1`). Every database
  call crosses Europe to Japan and back (~¼ s), several times per signed-in request.

On Vercel Pro, functions scale automatically, up to 30,000 running at once. They run in Tokyo (`hnd1`), next to the
database, so each database call takes about 1–3 ms.

**Expected cost:** $20/month (one seat, $20 of usage included) at today's traffic. About $50–60/month with four
5,000-player events a month. Most of that is the 5-second `/api/live` poll, billed as CDN requests.

**Effort:** about 2–3 days of preparation and testing, then a 1–2 hour cut-over. Hostinger stays in place as the
rollback for a week.

## What the code already handles

| Area | Why it works on Vercel as it is |
|---|---|
| Scheduler | [scheduler-loop.ts](../src/lib/scheduler-loop.ts) turns itself off when `VERCEL` is set. The cron route already checks `Authorization: Bearer <CRON_SECRET>`, which is exactly what Vercel Cron sends |
| Live polling | `/api/live` and `/api/live/quizzes/[id]` send `s-maxage` + `stale-while-revalidate`, which Vercel's CDN caches. The browser sends no cookies (`credentials: 'omit'`) |
| Request proxy | The [proxy.ts](../src/proxy.ts) matcher skips `/api/*` and static files, so polls never run it |
| Rate limiter | [rate-limiter.ts](../src/lib/rate-limiter.ts) already reads `UPSTASH_REDIS_REST_URL/TOKEN` or `KV_REST_API_URL/TOKEN` (the names Vercel's Upstash integration sets) |
| Load shedding, share card, sharp, Cloudinary SDK, web-push, pdf-parse | Vercel functions run full Node.js, so all of these work unchanged |
| Images | Every `next/image` uses the Cloudinary/Supabase loader or `unoptimized`, except the admin login page. Vercel's paid image optimizer is almost unused |

## What has to change first

### 1. Uploads larger than 4.5 MB (must fix)

Vercel rejects any request body over **4.5 MB** with a `413` error. The app currently accepts bigger files:

| Upload | Today's limit | Path |
|---|---|---|
| Admin media and prize images | 10 MB | [api/upload/route.ts](../src/app/api/upload/route.ts) |
| Profile picture | 5 MB | [api/profile/upload-picture/route.ts](../src/app/api/profile/upload-picture/route.ts) |
| Deposit receipt | 5 MB | Server Action in [profile/wallet/actions.ts](../src/app/profile/wallet/actions.ts) |

Recommended: set every limit to 4 MB, with a clear error message. Optionally, shrink photos in the browser before
upload, since phone screenshots are usually well under that. The bigger alternative is uploading straight from the
browser to Supabase Storage with signed upload URLs. That skips the server-side WebP resizing, so it is more work.

**Probably a bug in production already:** deposit receipts go through a Server Action. Next.js limits Server Action
bodies to **1 MB** unless `experimental.serverActions.bodySizeLimit` is set, and [next.config.js](../next.config.js)
doesn't set it. So receipts over ~1 MB probably fail today on Hostinger too (not reproduced yet). Fix it together
with item 1: set `bodySizeLimit: '4mb'` and cap receipts at 4 MB.

### 2. Cron every minute (must fix)

[vercel.json](../vercel.json) runs `/api/cron/process-scheduled` once a day (`0 0 * * *`). On Hostinger, the
in-process scheduler runs every minute instead. On Vercel that scheduler is off, so change the schedule to
`* * * * *`, which Pro allows. Otherwise scheduled quizzes, 10-minute warnings and auto-pause run only once a day.

### 3. Small config changes

- `vercel.json`: add `"regions": ["hnd1"]` so functions run in Tokyo.
- `package.json`: change `engines.node` from `>=22.12.0` to `22.x`, so Vercel doesn't pick up a new Node major by
  itself.
- `output: 'standalone'` in next.config.js is for Docker and Hostinger. Watch the first preview build. If Vercel
  complains, skip it when `VERCEL` is set, the way the Workers spike skipped it for its build.

### 4. Settings on Vercel (no code)

- **Visitor IP:** set `TRUSTED_IP_HEADER=x-vercel-forwarded-for`. Vercel overwrites `X-Forwarded-For` and doesn't
  pass on any IP a visitor sends. Check it with `GET /api/health?stats=1`.
- **Shared rate limits:** add Upstash Redis from the Vercel Marketplace. On Vercel the app can run as several copies,
  and each copy otherwise counts login, deposit and password limits separately. Start on the free plan. Each limited
  request costs 1–2 Redis commands, so expect a few dollars a month at 5,000-player events (my estimate).
- **Skew Protection:** turn it on (Pro feature), so open tabs keep loading their own build's files after a deploy.
- **Spend Management:** set email alerts at $40 and $80. Choose a hard limit (see "Decisions").

## Environment variables

Copy every variable from the hPanel production app into Vercel → Settings → Environment Variables → **Production**.
Then add:

| Variable | Value |
|---|---|
| `TRUSTED_IP_HEADER` | `x-vercel-forwarded-for` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | from the Upstash integration (or its `KV_REST_API_*` pair) |

`SCHEDULER_ENABLED` and `TOKIO_WORKER_THREADS` are not needed on Vercel. The `NEXT_PUBLIC_*` values are baked in at
build time, so set them before the first build.

**Preview** deployments use the **staging** Supabase project, never production keys. `HOSTINGER_STAGING.md` names it
`veymkpalrmknhprvxqja` (in Seoul). My Supabase connection only sees production, so first check that the staging
project still exists.

## Cloudflare after the move

Vercel recommends Cloudflare in **DNS-only** mode (grey cloud), not proxied. Behind a proxy, Vercel's bot protection
stops working, it sees Cloudflare's IPs instead of visitors', and the two caches can serve pages that reference files
from an old build. So the zone rules below stop applying, and each one needs a replacement:

| Today on Cloudflare | On Vercel |
|---|---|
| Cache Rule for `/api/live` and `/api/live/quizzes/*` | Not needed: Vercel's CDN follows the routes' own `s-maxage` |
| WAF custom rule: block `/api/live*` when it has a query string | Vercel Firewall custom rule with the same condition (custom rules are free) |
| Rate limit D5: 600 `/api/` requests per 10 s per IP | Vercel's built-in DDoS protection, the app's own limits (Upstash), and optionally a Vercel rate-limit rule on write routes only. Rate-limit rules cost $0.55–0.65 per million requests that pass |
| `edge-shield` Worker | Only the staging Worker is deployed, and Worker routes need a proxied hostname. Don't deploy it to production |

DNS records that aren't for the website (MX, SPF/DKIM for Brevo, verification TXT records) stay as they are.

## Steps

### Phase 1: Prepare (no production impact)

1. **Vercel team:** your Vercel login has one team, and it also holds another client's project. Choose where
   1think2win lives (see "Decisions"), and upgrade that team to Pro.
2. **Code changes** on a branch, as a PR: items 1–3 above. Run `bun test` and check that `bun run build` passes.
3. **Import** the GitHub repo into Vercel. Framework Next.js, build command `bun run build`, Node 22.x. Set the Preview
   variables to staging, and leave the custom domain off.
4. **Staging setup:** in the staging Supabase project, add the preview URL pattern to Auth → Redirect URLs. Add the
   preview hostnames to the Turnstile widget, or use Turnstile's test keys on previews.

### Phase 2: Test on a preview (staging database)

| Check | Expected |
|---|---|
| Home, quizzes, leaderboard, auth pages | Render with no console errors |
| Sign-up / sign-in (email and Google), with Turnstile | Works |
| Open a quiz and submit answers | Saved in the staging database |
| Deposit with a 3 MB receipt; profile picture; admin media and prize image upload | Work. A 6 MB file gets the clear 4 MB message |
| Push notification, Brevo email, admin PDF reconcile, share-card PNG | Work |
| Schedule a quiz 2 minutes ahead | Goes live within a minute of its time (cron log shows a run every minute) |
| `curl -sI <preview>/api/live` twice | Second response has `x-vercel-cache: HIT` |
| `/api/live?x=1` | Blocked by the firewall rule |
| `/api/health?stats=1` | `resolvedIp` is your own IP |
| Response header `x-vercel-id` on an API call | Ends in `hnd1` (the function ran in Tokyo) |

Then load-test the preview with the existing k6 scripts in [load-test/](../load-test/), against staging only. Ramp
signed-in requests well past what Hostinger handled in the 17 Oct load test. If Vercel's DDoS protection challenges the
single load machine, add a temporary firewall bypass for that IP, and remove it afterwards. Staging is in Seoul, so
response times will run ~30 ms higher than production will.

### Phase 3: Cut over (pick a day with no live quiz)

1. **Pre-issue the certificate**, so there is no HTTPS gap. Add `1think2win.com` and `www.1think2win.com` to the
   project, run `vercel certs issue 1think2win.com www.1think2win.com --challenge-only`, add the TXT records it prints
   in Cloudflare, then issue the certificate.
2. **Deploy main to Vercel Production.** Smoke-test it on its `*.vercel.app` URL against the production database,
   with read-only checks only.
3. **Switch DNS in Cloudflare.** Change the apex and `www` records to the values Vercel's Domains page shows, set them
   to **DNS only**, and save the old values first.
4. **Check page content, not just status codes.** The home page title is right. `/api/health` returns ok,
   `/api/live` reaches `HIT`, a sign-in works, and a quiz opens.
5. **Leave Hostinger running and untouched.** It receives no traffic now. Its scheduler can keep running: jobs claim
   their rows atomically, so running both is safe.

**Rollback (a few minutes):** set the apex back to an A record for the Hostinger server's IP (hPanel → Plan details)
and `www` back to a CNAME for the
apex, both **Proxied**. Cloudflare's rules are still in the zone and apply again as soon as traffic is proxied. Never
point DNS at the old Hostinger CDN addresses: they serve a parked page.

### Phase 4: After a week

- Review Vercel usage against the estimate, and check the Upstash command count.
- Turn off the Hostinger app's scheduler (`SCHEDULER_ENABLED=false`), then cancel or downgrade the Hostinger plan.
- Update the load-test docs with the new numbers.

## Decisions for the owner

1. **Vercel team:** a new Pro team billed to the client (recommended: separate access and invoice), or upgrade the
   existing personal team that also holds another client's project.
2. **Uploads:** cap at 4 MB (recommended, small change), or direct browser-to-Supabase uploads (more work).
3. **Spending:** alerts only, or also a hard limit that pauses the site when reached. A pause takes the site offline,
   so if you set one, keep it well above normal use (for example $200).
4. **Rate-limit rule on Vercel:** app-only limits plus Vercel DDoS protection (recommended to start), or also a paid
   rate-limit rule on write routes.

## Sources (checked 2026-10-19)

- [Vercel function limits](https://vercel.com/docs/functions/limitations): 4.5 MB body, 300 s default duration, 30,000 concurrency
- [Vercel concurrency scaling](https://vercel.com/docs/functions/concurrency-scaling)
- [Vercel cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing): per-minute on Pro
- [Vercel request headers](https://vercel.com/docs/headers/request-headers): `x-forwarded-for` overwritten
- [Vercel CDN cache](https://vercel.com/docs/caching/cdn-cache)
- [Cloudflare with Vercel](https://vercel.com/kb/guide/cloudflare-with-vercel)
- [Vercel WAF pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing)
- [Vercel Tokyo pricing](https://vercel.com/docs/pricing/regional-pricing/hnd1)
- Next.js `serverActions.bodySizeLimit`: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`
