# Load-test runbook (step by step, Windows / PowerShell)

Goal: find out how many players the **Hostinger Node app** and the **Supabase database** can really
serve during a live quiz, and send the results back so the next phase is based on measurements.

Total time: about **4–6 hours**, mostly waiting for seeding and builds. Do it in one or two sessions.
Every step ends with a **Checkpoint** — don't continue until it passes. If one fails, stop and send the
exact error text.

> ## Three safety rules
> 1. **Never point any of this at production.** Production has real users and is the only Supabase
>    project you have right now. The seeding script refuses to run against it, but don't test the refusal.
> 2. **The staging app shares your Hostinger plan's CPU/RAM with production.** Test when no live quiz is
>    running and few people are online, ramp up gradually, and **stop at once** if the real site slows
>    down or Hostinger emails you about resource limits.
> 3. **Staging gets its own keys and secrets.** Never paste production keys into the staging app or into
>    this tooling. Never share `users.json` / `sessions.json` (they hold staging passwords and tokens).

## What you will do
```
Part 1  install tools                        (20 min)
Part 2  fill in the owner checklist          (30–45 min)   -> Report, Part A
Part 3  create a STAGING database            (45–60 min)   <- the tricky part, read the box below
Part 4  deploy a STAGING copy of the app     (30–60 min)
Part 5  smoke test with 50 users             (15 min)
Part 6  the real test, step by step          (1–2 h)       -> Report, Parts B–E
Part 7  clean up                             (10 min)
Part 8  send me the report
```

> ### Why not just click "Create branch" in Supabase?
> A Supabase branch is built from the project's **migration history**. Your production history starts
> in February with small fix-ups and contains **no base schema** (the 27 tables were created by pasting
> SQL into the SQL editor, and the scale-50k and Phase 1 scripts aren't in the history either). A branch
> would come up empty or broken. So staging is a **new project**, filled with a copy of production's
> *structure* (no user data). Part 3 shows how. **If you'd rather not do Part 3 by hand, ask me:** with
> your approval of the small cost I can create the staging project and copy the structure for you using the
> Supabase connector, and you can skip straight to Part 4.

---

## Part 1 — Install tools (20 min)

Open **PowerShell** in the project folder (`D:\Projects(Clients)\1think2winsx`).

1. **k6** (the load generator):
   ```powershell
   winget install k6 --source winget
   ```
   Close and reopen PowerShell, then `k6 version` — **Checkpoint:** it prints a version.
2. **Bun** is already installed: `bun --version` prints a version (1.x).
3. **PostgreSQL command-line tools** (only for Part 3 if you do it yourself): download the installer from
   <https://www.postgresql.org/download/windows/>, and in the component list tick **only "Command Line
   Tools"**. Open a new PowerShell, `pg_dump --version` — **Checkpoint:** version **17** or higher
   (production runs Postgres 17).
4. Make sure the PC running k6 is on a **wired connection**, with other heavy apps closed. During runs
   watch Task Manager: if k6's CPU stays above ~80 %, the *load generator* is the limit, not your site.

---

## Part 2 — Owner checklist (30–45 min)

Fill in **Part A of `load-test/REPORT_TEMPLATE.md`** (copy it first, see Part 8). Menu names change over
time; if you can't find one, write "not found" and move on.

**Supabase production project → dashboard**
- **Compute size**: Project Settings → Compute and Disk. (Production's database looks like the Micro
  size: 60 connections.) Write down the size name.
- **Max rows**: Project Settings → API → *Max rows*. Write the number.
- **Signing keys**: Authentication → JWT Signing Keys (or Settings). Is the current key **ES256 / ECC
  (P-256)**? Write yes/no. (Quick proof: open `https://snhgaklxawthpihjiagh.supabase.co/auth/v1/.well-known/jwks.json`
  in a browser — it should list a key with `"alg":"ES256"`.)
- **Auth rate limits**: Authentication → Rate Limits. Write down the sign-in/sign-up/token-refresh numbers.
- **Realtime**: Project Settings → Realtime (or Realtime → Settings). Write *Max concurrent connections*
  and *Max events per second*. Also write which **plan** the organization is on (Free / Pro / Team) —
  Organization → Billing.
- **Email (SMTP)**: Authentication → Emails → SMTP: custom SMTP configured? yes/no.

**Hostinger hPanel → your production Node app**
- Write the **plan name** (e.g. Business / Cloud Startup), and the CPU / RAM limits shown for it.
- Is there a **CDN / caching** toggle for the site? yes/no, on/off.
- Environment variables: what is `WALLET_FEATURE_ENABLED`? (Don't write the other values.)
- **Which datacenter location** is the site hosted in?

**Brevo**: Account → Plan: daily/monthly **send limit**.

**Visitor-IP setting** (do this later, in Part 6 step 0, once the new code is deployed).

**Checkpoint:** Part A of the report has no empty rows (or says "not found").

---

## Part 3 — Create the STAGING database (45–60 min)

### 3.1 Create the project
Supabase dashboard → **New project** (same organization), name `1think2win-staging`, **same region as
production** (Northeast Asia / Tokyo), a strong database password (save it in your password manager).
Wait until it is "Healthy". Keep **Compute at Micro** — it matches production today, so results
describe the *current* setup.

> **Your organization is on Supabase's Free plan** (confirmed 2026-10-08), so a second project costs
> **$0** (a Free organization may have two active projects). But Free-plan usage limits (egress, auth
> users, realtime messages) are counted **per organization**: a load test that blows through them could
> get *production* restricted too. So create the staging project in a **separate, new Free
> organization** (dashboard → organization switcher → *New organization*, name it `1think2win-staging`),
> not in the production one. Delete the project in Part 7.

Write down (you'll need them): **URL** (`https://<ref>.supabase.co`), **publishable/anon key**,
**secret/service_role key** (Project Settings → API Keys), and the **staging ref** (`<ref>`).

### 3.2 Copy production's *structure* into it
You need production's **database password**. If you've lost it: Project Settings → Database → Reset
password. (The app talks to Supabase through its API keys, not this password — but check hPanel doesn't
hold a `DATABASE_URL` for production first.)

In the Supabase dashboard open **Connect → Session pooler** and copy the connection string for each
project (it looks like `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`).
The pooler host varies, so always copy yours.

```powershell
mkdir load-test\.data -ErrorAction SilentlyContinue

# 1) dump PRODUCTION structure (read-only operation; no data, no users)
$env:PGPASSWORD = "<PRODUCTION DB PASSWORD>"
pg_dump "postgresql://postgres.snhgaklxawthpihjiagh@<production pooler host>:5432/postgres" `
  --schema-only --schema=public --schema=private_hardened --no-owner `
  -f load-test\.data\staging-schema.sql

# 2) restore it into STAGING
$env:PGPASSWORD = "<STAGING DB PASSWORD>"
psql "postgresql://postgres.<STAGING REF>@<staging pooler host>:5432/postgres" -f load-test\.data\staging-schema.sql

Remove-Item Env:PGPASSWORD
```
A few messages like "schema public already exists" or "extension already exists" are normal. Anything
else that says `ERROR` — copy the line and send it to me.

### 3.3 Add what a dump doesn't carry
Supabase dashboard → switch to the **staging** project → SQL Editor → paste the whole of
`load-test/staging-extras.sql` → Run. It ends with a sanity query.

**Checkpoint:** the last query returns `public_tables = 27`, `public_views = 2`, `public_functions = 52`,
`private_functions = 4`, `auth_trigger = 1`, `cron_job = 1`. Anything different → send me the numbers.

### 3.4 Settings on the staging project
1. **Authentication → JWT Signing Keys:** make sure the current key is **ES256** (create/rotate to an
   asymmetric key if it isn't), then open
   `https://<staging ref>.supabase.co/auth/v1/.well-known/jwks.json` — it must show `"alg":"ES256"`.
   *Why:* the app verifies logins locally only with asymmetric keys; with the old HS256 key every API
   call would make an extra network request and the results wouldn't match production.
2. **Authentication → Rate Limits:** raise the sign-in / token-refresh limits to the maximum **for the
   duration of seeding** (staging only). Note the original values in the report.
3. **Authentication → Sign In / Providers → Email:** turn **off** "Confirm email" (otherwise seeded users
   can't sign in; the seed script also pre-confirms them, this is just a safety net).

**Checkpoint:** the JWKS URL shows ES256.

---

## Part 4 — Deploy a STAGING copy of the app (30–60 min)

> **Before building anything: the Hostinger build script packages the last *commit* (`git archive HEAD`),
> not your working folder.** Phase 0/1 are not committed yet. Tell me "commit it" first (or run
> `git add -A; git commit` yourself), otherwise staging would run the **old** code and the test would
> measure the wrong thing.
>
> **And do not use the `.env.hostinger-import` file the script generates for staging:** it is built from
> your production `.env`. Create the staging variables by hand (below).

1. Run `scripts\build-hostinger.ps1` (it creates `hostinger-deploy.zip` — same as for production).
2. hPanel → add a **second Node.js Web App** on a **separate subdomain** (for example
   `staging.yourdomain.com`), application type Next.js, uploading the zip, build script `build`, output
   directory `.next`, Node 20.9+ — the same settings you used for production.
3. **Before the first build**, in that staging app's *Environment variables* add (by hand):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | staging URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging publishable/anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | staging secret/service_role key |
   | `AUTH_SECRET` | a new random string |
   | `ADMIN_EMAILS` / `ADMIN_PASSWORD` | staging-only admin login you invent now |
   | `CRON_SECRET` | a new random string (you'll need it for the monitor) — **write it down** |
   | `NEXT_PUBLIC_SITE_URL` | `https://staging.yourdomain.com` |
   | `WALLET_FEATURE_ENABLED` | same value as production |
   | `NEWSLETTER_UNSUBSCRIBE_SECRET` | any random string |
   | `SCHEDULER_ENABLED` | `false` |

   **Leave out** `BREVO_*`, `GEMINI_API_KEY`, `VAPID_*`, `CLOUDINARY_*`, Google OAuth: staging must not
   send real emails or pushes. (`NEXT_PUBLIC_*` values are baked in at *build* time — that's why they
   must exist before the build.)
4. Build/deploy, open the staging URL.

**Checkpoint:** `https://staging.yourdomain.com/api/health` returns `{"status":"ok",...}` and the
home page loads.

---

## Part 5 — Smoke test with 50 users (15 min)

Set the variables **in this PowerShell window** (they disappear when you close it):

```powershell
$env:LOADTEST_SUPABASE_URL      = "https://<staging ref>.supabase.co"
$env:LOADTEST_SERVICE_ROLE_KEY  = "<staging secret/service_role key>"
$env:LOADTEST_ANON_KEY          = "<staging publishable/anon key>"
$env:LOADTEST_CONFIRM_STAGING   = "yes"
$env:LOADTEST_BASE_URL          = "https://staging.yourdomain.com"
$env:LOADTEST_CRON_SECRET       = "<staging CRON_SECRET>"
```

```powershell
bun load-test/prepare-users.ts seed --count 50
bun load-test/prepare-users.ts sessions
k6 run -e BASE_URL=$env:LOADTEST_BASE_URL -e RATE=5 -e DURATION=30s load-test/k6/poll.js
```
**Checkpoint:** k6 prints `hard errors 0`; if you see 401s, the sessions aren't being accepted (tell me
the first error line). If `seed` says "Refusing to run: … production", you used the wrong URL — stop and
fix it.

Then the **visitor-IP step** (see `load-test/README.md` → *Setting the visitor IP*): run the one `curl`
against the staging URL with the staging `CRON_SECRET`, pick `TRUSTED_PROXY_HOPS` / `TRUSTED_IP_HEADER`,
set it on **staging first**, restart, and confirm `client.resolvedIp` is your real IP. Write the result in
the report.

Finally create the quizzes the herd test needs: open `https://staging.yourdomain.com/admin`, log in with
your staging admin, create **2 quizzes**, each with **5 multiple-choice questions**, **duration 120
minutes**, then **push each live** so they are Active. Copy the two quiz ids (they're in the quiz URL).

---

## Part 6 — The real test (1–2 hours)

### 6.0 Seed the full user set
```powershell
bun load-test/prepare-users.ts seed --count 5000 --concurrency 10      # ~5–15 min
bun load-test/prepare-users.ts sessions --concurrency 5                  # ~10–25 min
```
Sign-ins are slow; if they fail with 429, wait 5 minutes (or raise the staging Auth limits more) and
re-run `sessions`. Access tokens last ~1 hour — **re-run `sessions` before Part 6.3** if it has been
longer.
**Checkpoint:** "5000 sessions written" (a few failures are OK).

### 6.1 Open two windows
- **Window A (monitor):** keep the variables from Part 5 set, then `bun load-test/monitor.ts`. Leave it
  running for the whole test. It prints one line every 2 s and saves a CSV.
- **Window B (load):** the commands below.
- Also open the **staging Supabase dashboard → Reports → Database** (CPU, connections) and the
  **Hostinger resource graphs** in a browser, to screenshot after each run.

Before **each** run, in the staging SQL editor: `select pg_stat_statements_reset();`
After each run: 
```sql
select left(query, 90) as query, calls, round(mean_exec_time::numeric, 1) as mean_ms, round(total_exec_time::numeric) as total_ms
from pg_stat_statements order by total_exec_time desc limit 10;
```
Paste that table into the report.

### 6.2 Ramp — one run at a time, writing a row in the report after each
**Stop the whole test (and write why) if:** p95 latency > 3 s, or errors > 1 %, or `shed_503` starts
climbing steadily, or the production site slows down, or Hostinger warns about limits.

| # | Command (PowerShell, run from the project folder) | What it models |
|---|---|---|
| 1 | `k6 run -e BASE_URL=$env:LOADTEST_BASE_URL -e RATE=100 -e DURATION=3m load-test/k6/poll.js` | light polling |
| 2 | same with `-e RATE=400` | medium |
| 3 | same with `-e RATE=833` | **50,000 players polling every 60 s** |
| 4 | `k6 run -e BASE_URL=$env:LOADTEST_BASE_URL -e RATE=500 -e DURATION=3m load-test/k6/public.js` | anonymous traffic |
| 5 | same with `-e RATE=1500` | heavy anonymous |

If #3 passes comfortably, try `RATE=1200` and `RATE=1800` too (the limit is what you want to find).

### 6.3 Go-live herd (uses one fresh quiz per run)
With 5,000 users the request *rate* is `5000 ÷ seconds`. Shorter windows = higher rate:

| Run | Windows | Resulting rate | Command |
|---|---|---|---|
| H1 | 10 s open, 10 s submit | ~500 req/s | `k6 run -e BASE_URL=$env:LOADTEST_BASE_URL -e QUIZ_ID=<quiz 1 id> -e OPEN_SECONDS=10 -e SUBMIT_SECONDS=10 load-test/k6/herd.js` |
| H2 | 3 s open, 3 s submit | ~1,670 req/s | same with `<quiz 2 id>`, `-e OPEN_SECONDS=3 -e SUBMIT_SECONDS=3` |

(A user can submit **once per quiz**, which is why each run needs its own quiz. For 50,000 users in 30 s
the rate would be ~1,670 req/s, the same as H2.)

**Checkpoint after every run:** a row in Report Part B, the SQL table in Part C, screenshots saved.

---

## Part 7 — Clean up (10 min)
- Supabase: pause or **delete the staging project** (Project Settings → General).
- Hostinger: delete the staging app and its subdomain.
- Restore the Auth limits (if you changed them on any project you keep).
- Keep `load-test/.data/results-*.json`, `monitor-*.csv` and your report **until I've read them**. Then
  delete `load-test/.data/users.json` and `sessions.json` (staging credentials).

## Part 8 — Send me the report
1. Copy `load-test/REPORT_TEMPLATE.md` to `load-test/.data/REPORT.md` and fill it in as you go.
2. When finished, tell me **"report ready"**. I can read `load-test/.data/` on your machine directly
   (the k6 results, the monitor CSVs and `REPORT.md`) — you don't need to paste anything. Don't send me
   `users.json` / `sessions.json`.
3. I'll turn it into: the measured capacity, the bottleneck ranking, and what Phase 2–5 should
   change first.

## If something goes wrong
| Symptom | Likely cause |
|---|---|
| k6: `hard_errors` full of 401 | sessions expired (re-run `sessions`), or staging keys/URL mismatch |
| k6: many 403 with an HTML body | Hostinger's firewall is blocking your IP for high request rates — lower the rate, or ask Hostinger support to allow your IP |
| k6: `dial tcp … too many open files` / very slow | the load generator is the limit: lower the rate or run k6 from a stronger machine |
| `seed`: "Refusing to run" | the URL is the production project — use the staging URL |
| `seed`: 422 / "email_exists" | users from an earlier run exist; fine, or re-run on a fresh project |
| Monitor prints "no response" | the app is saturated or restarting — that's a result, write down when it happened |
