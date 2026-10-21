# Hostinger region move (Paris → India): what to do when it finishes

Started 2026-10-20. Hostinger says the move takes 1–4 hours and DNS changes up to 12 hours.
**The site's server gets a new IP address**, and because DNS lives in Cloudflare (not Hostinger), nothing
points at the new server until you update Cloudflare yourself (step 2).
Hostinger allows one location change every 30 days, so there is no quick way back.

Work through the steps in order. Each has a check, so you know it worked before moving on.
If you get stuck, open a Claude session in this project and say:
*"Follow deploy/HOSTINGER_REGION_MOVE.md. I'm at step N; here's what I see: …"*

> **Public copy.** This repository is public, so server addresses and load limits are left out. They're in
> hPanel (Plan details), the Cloudflare DNS records, and the full copy in `deploy/private/` on the owner's PC
> (git-ignored).

---

## Where things stand (2026-10-20)

| Item | State |
| --- | --- |
| Live site | `0f046f3` (`hostinger-deploy.zip`, SHA256 `CE24218BDEDAD4F78360F054EE24C1669E2D28A3F7DC4D4CBADB6C5451460CFF`): stream viewer, **prize-creation fix**, **Sentry** code. Sentry stays off until step 5 plus a redeploy |
| Pull request | [#35](https://github.com/AunMohammad254/1think2winsx/pull/35), merged as `f3b975b` (same code as the live site) |
| Server | Asia (India), Mumbai, since 2026-10-20. Cloudflare points at it since 03:53 UTC (steps 1–3 done). Its IP is in hPanel → Plan details |
| Database | Supabase, Tokyo (unchanged). Server→database calls measured about the same as from Paris (step 8); the real gain needs the Supabase move (`deploy/SUPABASE_REGION_MOVE.md`). **Done 2026-10-21: the database is now in Mumbai too** |

---

## Step 1 — Confirm the move is finished

- [x] hPanel → **Websites → 1think2win.com**: the server location shows **Asia (India)** and no transfer is
      in progress (Hostinger usually emails you too).
- [x] Note the **new IP address**: hPanel → the website's **Dashboard / Plan details** → *IP address*.

  Done 2026-10-20: Plan details shows Asia (India), backups in Singapore, and the new IP. Before the switch the new
  server already served the same build as Paris (build ID `8-rZso9gM6t22jVTo5Zk7`) with a valid certificate.

## Step 2 — Point Cloudflare at the new server (the site is down until this is done)

Cloudflare dashboard → **1think2win.com → DNS → Records**. Change **only** these two:

| Type | Name | Change content from → to | Proxy status |
| --- | --- | --- | --- |
| A | `1think2win.com` | old IP → **new IP** | **Proxied** (orange cloud), keep as is |
| A | `ftp` | old IP → **new IP** | DNS only (grey), keep as is |

Leave everything else alone: the `www` CNAME follows the apex automatically, and the MX, DKIM, SPF,
DMARC and Brevo records are for email, which this move doesn't touch.

- [ ] **Never** point the apex at a Hostinger CDN address (`*.cdn.hstgr.net`, `92.112.198.106`,
      `148.135.128.161`). The Hostinger CDN is off for this site, and those addresses then serve a
      "Parked Domain" page that still answers 200 OK. This happened on 2026-10-17.
- [ ] Optional, safer: if you never use FTP, **delete the `ftp` record**. Because it isn't proxied,
      anyone can look it up and find the server's real IP, which lets them bypass Cloudflare.

**Done 2026-10-20 03:53 UTC** (by Claude, owner-approved): both A records changed from the Paris IP to the India
IP, proxy settings unchanged. To undo while Hostinger still runs the Paris server, set both back to the Paris IP
(in the private copy).

**Check** (after a minute or two):
```bash
curl -s https://1think2win.com/ | grep -o "<title>[^<]*</title>"
```
Expect the site's real title, **not** "Parked Domain". A `521`/`522` error means Cloudflare can't reach the
server: re-check the IP. A `526` error is the certificate (step 3).

## Step 3 — HTTPS certificate on the new server

Cloudflare's SSL mode is **Full (strict)**, so the new server must have a valid certificate for
`1think2win.com` and `www.1think2win.com`.

- [ ] hPanel → **Security → SSL**: the certificate is **Active** for both names. If not, install or
      reinstall it there (free Let's Encrypt).
- [ ] Don't switch Cloudflare to *Flexible*: with "Always use HTTPS" on, that causes redirect loops.
      If you need a stopgap while the certificate is issued, *Full* (not strict) works; set it back to
      *Full (strict)* afterwards.

**Check:** the site loads over https with no `526` error page. **Passed 2026-10-20:** the India server's
certificate verifies for both `1think2win.com` and `www.1think2win.com`.

## Step 4 — hPanel settings that must have survived the move

- [ ] **Performance → CDN** is still **off**. Cloudflare is the only CDN; Hostinger's support confirmed
      "use only one CDN".
- [ ] **Node.js app settings:** application type Next.js, build script `build`, output directory `.next`,
      **Node 22.x**, package manager npm.
- [ ] **Environment variables:** all 28 are still there. They are:
      `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
      `DIRECT_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_SITE_URL`
      (must be `https://1think2win.com`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
      `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `ADMIN_EMAILS`, `ADMIN_PASSWORD`, `BREVO_API_KEY`,
      `BREVO_SMTP_USERNAME`, `BREVO_SMTP_PASSWORD`, `BREVO_SENDER_EMAIL`, `GEMINI_API_KEY`,
      `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `WALLET_FEATURE_ENABLED`,
      `NEWSLETTER_UNSUBSCRIBE_SECRET`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
      `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CRON_SECRET`.
      If any are missing: **Environment variables → Import .env** → upload `.env.hostinger-import` from
      this folder (it holds secrets; never share or commit it).

## Step 5 — New hPanel variables for Sentry (add before deploying)

The build reads these, so add them **before** step 6.

| Variable | Value | Needed? |
| --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → Settings → Projects → your project → **Client Keys (DSN)** | **Yes**, Sentry stays off without it |
| `SENTRY_PROJECT` | your Sentry project's slug (the organization slug `1think2win` is already in the code) | For readable error locations |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → **Auth Tokens** → create one. **Secret**: put it only in hPanel | For readable error locations |

## Step 6 — Deploy the new build

**Status 2026-10-20 06:30 UTC:** `0f046f3` is live on the India server (build ID `lEU2vjnN4HW8Hp574kpPD`, Sentry release
`0f046f3`, `worker-src` in the security policy; site, health, live cache and pages pass). **But no Sentry DSN was
built in**, so Sentry is still off: do step 5, then **Redeploy** once more (the DSN is read at build time).

- [ ] hPanel → **Deployments → Settings and redeploy → Upload new files** → `hostinger-deploy.zip` →
      **Redeploy**. Check it's the right file first:
      ```powershell
      Get-FileHash hostinger-deploy.zip -Algorithm SHA256
      ```
      should print `CE24218BDEDAD4F78360F054EE24C1669E2D28A3F7DC4D4CBADB6C5451460CFF`.
- [ ] The build log finishes without errors. If it says the OS "can't spawn worker thread", the 4-worker
      cap was lost: it's in `next.config.js` (`experimental.cpus: 4`). Ask Claude.

## Step 7 — Services that may only accept the old server's address

Hostinger warns that anything which allowed your old IP has to be updated by hand.

- [ ] **Brevo** (emails the app sends itself, e.g. newsletter and notification emails): Brevo → your
      account → **Security → Authorized IPs**. If that list is turned on, add the new IP (or remove the old
      one). Otherwise those emails fail and Brevo emails you about a blocked IP. Sign-in emails are sent by
      Supabase, not by your server, so they aren't affected.
- [ ] **Not affected** (no action): Supabase (the app doesn't connect to the database directly), Cloudflare
      Turnstile and Google sign-in (they check the domain, not the IP), Cloudinary, Gemini, web push.

## Step 8 — Check the live site

| Check | How | Expect |
| --- | --- | --- |
| Site is up | open https://1think2win.com | the real home page |
| Health | `curl -s https://1think2win.com/api/health` | `{"status":"ok","timestamp":"…"}`, not an HTML page |
| Live updates cached | run `curl -sI https://1think2win.com/api/live` twice | `cf-cache-status: HIT` on the second |
| New build is live | open a quiz page with the stream, right-click the video → inspect | the YouTube address contains `fs=0`, and YouTube shows no fullscreen button |
| Security policy | `curl -sI https://1think2win.com/faq` | `content-security-policy` contains `worker-src 'self' blob:` |
| Sign-in | sign in with email and with Google | both land on /quizzes |
| Prize creation (fixed) | admin → Prizes → create a test prize, then delete it | "Prize created successfully!" |
| Live quiz push | admin → push a quiz while watching the stream on another device | banner with a countdown; bell count goes up |
| Sentry (server) | `curl -s https://1think2win.com/api/quizzes` (signed out, so it's refused), then Sentry → **Explore → Logs** | within a minute or two: "Authentication failed …" and a `[SECURITY EVENT]` entry |
| Sentry (browser) | Sentry → **Issues** and **Replays** during real testing | errors from testers' browsers appear as they happen; nothing shows until one occurs |
| Speed | ask Claude to "run the deep health check" (it needs `CRON_SECRET` from `.env`): `curl -s -H "Authorization: Bearer <CRON_SECRET>" "https://1think2win.com/api/health?deep=1"` and read `components.database.latency` | **before the move: 164 ms** (Paris → Tokyo, 2026-10-20). Lower afterwards means the move paid off |

**Results 2026-10-20, right after the DNS switch (build `6041c5a`, before the step 6 deploy):**

| Check | Result |
| --- | --- |
| Site up | passed: real title; `/`, `/prizes`, `/leaderboard`, `/faq` 200; `/quizzes` → sign-in page (`/auth?mode=login`) 200; `www` → 301 to the apex |
| Health | passed: `{"status":"ok"}` |
| Live updates cached | passed: `MISS` then `HIT` |
| `ftp` record | passed: resolves to the new server |
| Security policy | as expected for `6041c5a`: contains `static.cloudflareinsights.com`. `worker-src 'self' blob:` arrives with the step 6 build |
| Speed | `components.database.latency` 155–168 ms (one 400 ms outlier), about the same as Paris (164 ms): the database is still in Tokyo. **After the Supabase move (2026-10-21): 21–52 ms, median about 40 ms** |
| Not checked yet | sign-in, prize creation, live quiz push, Sentry: they need you, or the step 6 build |
| Unrelated to the move | `/sitemap.xml` and `/robots.txt` return 404 on both the old and the new server |

If the Sentry check shows nothing, check step 5 was done **before** the redeploy (the DSN is read at
build time), then ask Claude: it can confirm the setup end to end with your DSN.

---

## Not part of the move, still open

- [x] **Merge PR #35**: merged 2026-10-20 as `f3b975b`; `main` now has exactly the code that is deployed.
- [ ] **`Quiz.announcedAt` migration** (`db-tests/schema/06-20261019200000_quiz_announced_at.sql`) needs the
      owner's approval before it's applied to production. Until then the upcoming-quiz pop-up on the
      stream doesn't appear; bell notifications work as before.
- [ ] If you added `192.168.1.100` to the **Turnstile widget** or to **Supabase → Authentication → Redirect
      URLs** for phone testing, remove it.
- [ ] `deploy/VERCEL_MIGRATION.md` (2026-10-19) planned a move to Vercel. Moving Hostinger to India
      replaces that plan for now; keep the file or delete it.
- [ ] Hostinger's request queue and its automatic abuse protection (which can block the whole site under heavy
      load) don't change with the region. Big live events still need the hosting discussion in
      `deploy/VERCEL_MIGRATION.md`.

Sources: Hostinger, [How to transfer your hosting plan to a different server](https://support.hostinger.com/en/articles/5577027-how-to-transfer-your-hosting-plan-to-a-different-server),
[How to set up Cloudflare for a domain hosted on Hostinger](https://www.hostinger.com/support/4741545-how-to-use-cloudflare-in-hostinger/).
Cloudflare records and SSL mode were read from the Cloudflare account on 2026-10-20.
