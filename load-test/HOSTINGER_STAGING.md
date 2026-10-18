# Deploy a STAGING copy on Hostinger (safe, step by step)

Goal: a second, throw-away copy of the app, on its own subdomain and its own Supabase project, so the load
test can hurt it without touching production. Companion to `RUNBOOK.md` (Parts 4–6); this file is the
detailed, safety-checked version.

**Golden rules**
1. Staging uses the **staging** Supabase project only (`veymkpalrmknhprvxqja`). Never a production key, URL or `.env`.
2. Never type or paste a secret key into the chat. Keys go into hPanel and into one git-ignored file (Step 3).
3. Never import `.env.hostinger-import` into the staging app. It is generated from the production `.env`.

## Where things stand (2026-10-09)
| Item | Status |
|---|---|
| Staging database (27 tables, 56 functions, 54 policies, 77 indexes, trigger, cron) | **Done**, verified identical to production, empty |
| Staging signing key | **ES256** (same as production): nothing to do |
| Staging "Confirm email" | **ON** (needs switching off, Step 2) |
| Staging Auth rate limits | not raised yet (Step 2) |
| Staging API keys in your hands | not yet (Step 3) |
| Code with the latest fixes | in your working folder, **not committed** (Step 1) |
| Hostinger staging app | not created (Step 4) |

---

## Step 1: Commit the code (the build only packages commits)
`scripts\build-hostinger.ps1` zips `git archive HEAD`: **only committed, tracked files**. Your fixes are not
committed, and several are **new files** (`src/lib/quiz-clock.ts`, `src/hooks/useQuizCountdown.ts`, …). If they
are not added, the Hostinger build **fails** (imports of missing files), or deploys old code.

Tell me **"commit"** and I will do it, or run it yourself:
```powershell
cd D:\Projects(Clients)\1think2winsx
git status --short          # every "??" line is a new file that must be included
git add -A
git commit -m "perf: server-clock quiz timer, bug fixes, hardening, load-test tooling"
git status --short          # must print nothing
```
(`load-test\.data\`, `SQL\`, `.claude\` and `.env*` are git-ignored, so no secrets are committed.)

## Step 2: Staging Supabase settings (2 minutes, dashboard)
Open the **staging** project (`veymkpalrmknhprvxqja`, name `1think2win-staging`; check the name at the top-left).
1. **Authentication → Sign In / Providers → Email → turn OFF "Confirm email"** → Save.
   Checkpoint: I can verify it from here (`mailer_autoconfirm` becomes `true`).
2. **Authentication → Rate Limits** (staging only). On the Free plan only three fields are editable; the rest are
   greyed out and not needed. Old values are in brackets: write them down and restore them after the test.

   | Field | Set to | Why |
   |---|---|---|
   | Rate limit for **sign-ups and sign-ins** (30 per 5 min per IP) | the **highest value the box accepts** (try `10000`) | **This is the one that matters.** Creating 5,000 test sessions is 5,000 password sign-ins from one IP. At 30 per 5 min that is about 14 hours; at 1,000 per 5 min about 25 minutes |
   | Rate limit for **token refreshes** (150 per 5 min per IP) | highest accepted (try `5000`) | the staging app server refreshes expired tokens from one IP, if a test runs past the hour |
   | Rate limit for token verifications (30 per 5 min) | leave | OTP / magic links are not used |
   | emails per hour (2), SMS, anonymous, Web3 | cannot be changed, leave | not used: users are created pre-confirmed by the seed script, and "Confirm email" is off |

   Click **Save changes**. If the box refuses your number, use the largest it accepts and seed fewer users:
   `seed --count 1000 --concurrency 3` is still enough for the poll and herd tests (each player may send about
   one request per second, so 1,000 players ≈ 1,000 req/s). Time to create the sessions is about
   `users ÷ limit × 5 minutes`.
   (The "IP Address Forwarding" switch further down stays **off**.)

## Step 3: Get the staging keys and park them safely
Staging project → **Project Settings → API Keys**. Use the **Legacy anon, service_role API keys** tab
(not the new `sb_secret_...` keys): they are plain JWTs and work with every library version the app uses.
Create the file `load-test\.data\staging.env` (git-ignored; I read it from disk, you never paste it in chat):
```
LOADTEST_SUPABASE_URL=https://veymkpalrmknhprvxqja.supabase.co
LOADTEST_ANON_KEY=<staging anon key>
LOADTEST_SERVICE_ROLE_KEY=<staging service_role key>
LOADTEST_CRON_SECRET=<the CRON_SECRET you will set in Step 4>
LOADTEST_BASE_URL=https://staging.yourdomain.com
LOADTEST_CONFIRM_STAGING=yes
```
Generate each random secret (CRON_SECRET etc.) with:
```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

## Step 4: Build the package and create the Hostinger staging app
1. `powershell -ExecutionPolicy Bypass -File scripts\build-hostinger.ps1 -Staging`
   This builds **`hostinger-staging.zip`** (not `hostinger-deploy.zip`, which is the production package) and:
   refuses to run with uncommitted changes; never reads your production `.env`; stamps the zip with
   `STAGING-BUILD.txt` (commit and time); fails if anything inside mentions the production Supabase project;
   and writes `load-test\.data\staging-hostinger.env.template` (variable names, no secrets).
   It must end with `OK: ... source only, no secrets` and print the zip's SHA256.
   If an old `.env.hostinger-import` exists in the project folder (from a production build), **delete it**:
   `Remove-Item .env.hostinger-import` (production secrets; never import it for staging).
2. hPanel → **Websites → Add Website → Node.js web app → Upload your files** (Hostinger accepts `.zip`, `.tar`,
   `.tar.gz`, `.tgz`; the archive needs a `package.json` at its root and must not contain `node_modules` or `.git`),
   on a **new subdomain** (for example `staging.yourdomain.com`), **not** your production app.
   The domain's DNS is on Cloudflare, so the subdomain's record is added there, not in hPanel. Name it `staging` so
   the edge Worker's route matches (see [`edge-shield/README.md`](../edge-shield/README.md)).
   - Upload `hostinger-staging.zip`.
   - Framework preset: **Next.js** (build script `build`, output directory `.next`, package manager npm: these are
     auto-detected; leave them). Hostinger starts the standalone server itself and ignores the entry file.
   - **Node.js version: 22** (it is Hostinger's default; 18, 20, 22 and 24 are offered). The repo requires 22.12 or
     newer. `.npmrc` does not enforce engines, so an older 22.x only warns, but pick the newest 22.x if you can choose.
   - Hostinger's docs describe no "re-upload" button for archive apps. To ship a new build to staging later, check
     the app's **Deployments** page for an upload option; otherwise delete the staging app and create it again
     (your variables are re-imported from the template).
3. **Before the first build**, add these Environment variables (hPanel → the staging app → Environment variables, or
   the "Set environment variables" box in the deploy screen). Variables apply to both the build and the running app,
   `NEXT_PUBLIC_*` values are baked in at build time, so they must exist **before** the build, and saving a change
   redeploys the app. Easiest: fill in `load-test\.data\staging-hostinger.env.template` (the packaging script wrote
   it) and use **Import .env**. Hostinger accepts only `A-Z`, `0-9` and `_` in names, so these are all valid:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://veymkpalrmknhprvxqja.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | staging service_role key |
   | `CRON_SECRET` | a new random secret (same as in `staging.env`) |
   | `NEXT_PUBLIC_SITE_URL` | `https://staging.yourdomain.com` (**must** be the staging address: the app calls itself on it) |
   | `ADMIN_EMAILS` | an admin email you invent for staging |
   | `ADMIN_PASSWORD` | a new password for it (not your production one) |
   | `WALLET_FEATURE_ENABLED` | the same value as your production app, so quizzes behave the same |
   | `NEWSLETTER_UNSUBSCRIBE_SECRET` | any new random string |
   | `SCHEDULER_ENABLED` | `false` |

   **Do not add** `BREVO_*`, `GEMINI_API_KEY`, `VAPID_*`, `CLOUDINARY_*`, `STRIPE_*`, Google OAuth, `DATABASE_URL`,
   `DIRECT_URL` or anything from production: staging must not be able to send real email/push or reach production.
   `AUTH_SECRET` is not used by the code.
4. Deploy. Open `https://staging.yourdomain.com`.

## Step 5: Prove it is safe before any load
| # | Check | Expected |
|---|---|---|
| 1 | `https://staging.yourdomain.com/api/health` | `{"status":"ok",...}` |
| 2 | `curl -s -H "Authorization: Bearer <CRON_SECRET>" "https://staging.yourdomain.com/api/health?stats=1"` | JSON with `"nodeVersion":"v22..."` (proves Node 22 and the secret) |
| 3 | Tell me "staging is up". I create a staging-only test user; you sign in on the staging site. | I confirm from the database that **staging** recorded the sign-in and **production** did not change. This is the proof the app points at staging. |
| 4 | Log in at `/admin` with the staging admin | works |
| 5 | hPanel resource graphs | screenshot the idle CPU / RAM as the baseline |

If check 3 shows activity in production: **stop, remove the app's environment variables, and tell me.**

## Step 6: The visitor-IP measurement (needs no Supabase)
Do the one `curl` from `README.md` → *Setting the visitor IP* against the staging URL, set
`TRUSTED_PROXY_HOPS` or `TRUSTED_IP_HEADER` on staging, restart, re-check `client.resolvedIp`. Repeat on
production afterwards (production is exposed to forged-IP bypass until it is set).

## Step 7: Tell me "ready"
Once Steps 1–5 are done, I run Part 5 (50-user smoke test) and Part 6 (the ramp) from this machine with
k6 and `monitor.ts`, reading `load-test\.data\staging.env`, and write the report. You only watch the
Hostinger graphs. Stop conditions: p95 > 3 s, errors > 1 %, or Hostinger warns about limits.

---

## If Supabase is not ready
| Situation | What to do |
|---|---|
| **You cannot reach the dashboard or do not have the keys yet** | Do Steps 1, 4 and 6 with placeholder Supabase values: the build, Node 22, `/api/health`, the `?stats=1` curl and the visitor-IP measurement need **no** database. Pages that read data will show errors; that is expected until the real keys are set. After adding the real values, **rebuild** (the `NEXT_PUBLIC_*` ones are build-time). |
| **Staging project paused, deleted, or empty** | Tell me "rebuild staging". I re-apply the saved schema (`load-test\.data\staging-schema\`, migrations `staging_01`–`06`) through the connector and re-verify against production (about 10 minutes). A paused project can also be restored from the dashboard. |
| **Worried about shared Free-plan quotas** (staging shares production's organization) | Move staging to a new Free organization (staging project → Settings → General → Transfer project), or keep the first runs small and watch the organization's Usage page. |
| **Confirm email cannot be switched off** | Fine for the load test: the seed script creates pre-confirmed users. Only manual sign-ups on staging need email confirmation. |
| **Only the Auth rate limits are not raised** | Seed fewer users at a time (`--count 500`, `--concurrency 3`) and wait out any 429s; raising the limits just makes seeding faster. |

## Cleaning up afterwards
Delete (or pause) the staging Supabase project, delete the Hostinger staging app and subdomain, restore the
Auth rate limits, and delete `load-test\.data\staging.env`, `users.json` and `sessions.json` once I have read the results.
