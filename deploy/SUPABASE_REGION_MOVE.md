# Supabase region move (Tokyo → Mumbai): plan

Date: 2026-10-20 · Status: **done on 2026-10-21.** Production runs on the Mumbai project `eclivawqhdovsndlngfo`
(`ap-south-1`); the Tokyo project was deleted after the switch. The steps actually run differ from this plan: the new
project was built in a Free-plan organization first (no second paid project at any time), checked, switched to, and
then transferred into the Pro organization, all at no extra cost. Server→database latency went from 155–168 ms to
about 40 ms. The run log is in the private copy. The tools used are in `deploy/supabase-move/` (`settings.mjs` and
`storage-copy.mjs` were added for that run). The plan below is kept as written.

> **Public copy.** This repository is public, so load limits and one security note are left out. The full copy is
> in `deploy/private/` on the owner's PC (git-ignored).
Moving the production database is a production change: it needs the **owner's approval** before any step below
is run.

**Goal:** put the database next to the app server. Hostinger is moving the site from Paris to India (Mumbai,
see `deploy/HOSTINGER_REGION_MOVE.md`); the Supabase project is in Tokyo (`ap-northeast-1`). Supabase can't
change a project's region in place, so the move means **a new project in Mumbai (`ap-south-1`)**, copying
everything into it, and switching the site over.

---

## Recommendation

**Do it, soon after the Hostinger move is finished and checked, in a quiet hour with no live quiz.**

- **Gain:** each database call should drop from about **130–150 ms** (Mumbai server → Tokyo database) to about
  **10–25 ms**. A signed-in page that makes 4 calls one after another waits roughly **0.5 s less**. Players' own
  browsers also reach Supabase (live quiz updates, Google sign-in) about 3× faster from Pakistan.
- **Cost:** **under $1 once** (a second project for about a day); the monthly bill stays the same once the old
  project is moved to a Free organization and paused (step 5.3).
- **Downtime:** about **30–45 minutes** in which pages still load but nobody can sign in, answer or save
  anything. **Everyone has to sign in again once** afterwards.
- **Why now:** production is tiny (20 MB of data, 15 users, 226 files), so the copy takes minutes. Every month
  of growth makes it slower and riskier. It's also a natural moment to switch to Supabase's new API keys, which
  the current project has to do anyway before the old keys stop working at the end of 2026 (see Risks).
- **Code changes:** none are needed for the switch itself. The app reads the Supabase address and keys from
  environment variables. Two load-test safety lists that name the project should be updated afterwards
  (step 5.4).

---

## What production looks like today

Read from production on 2026-10-20 (read-only queries through the Supabase connector).

| Item | Value |
| --- | --- |
| Project | `1Think2Win`, ref `snhgaklxawthpihjiagh`, region `ap-northeast-1` (Tokyo), Postgres 17.6 |
| Organization | `vbbsulvzpgaredeueqgj`, **Pro plan** |
| Compute | Micro (`max_connections` 60, `shared_buffers` 256 MB) |
| JWT signing | ES256 (asymmetric). The JWKS has one key, so `getClaims()` checks sign-ins locally |
| Database size | 20 MB |
| Auth | 15 users. Identities: 9 Google, 8 email. No MFA. 8 sessions |
| Biggest tables | `Notification` 619 rows, `RateLimitEntry` 103, `WalletTransaction` 48; the rest are small |
| Schemas | `public` (56 functions, 0 triggers) and `private_hardened` (6 functions: `is_admin`, `redeem_prize`, `submit_quiz`, …) |
| RLS policies | 65, including 9 on `storage.objects` |
| Trigger on `auth.users` | `on_auth_user_created` → `public.handle_new_user()` (creates the `User` row at sign-up) |
| pg_cron | 1 job: `refresh-leaderboard`, `*/5 * * * *`, `SELECT public.refresh_leaderboard_cache()` |
| Realtime | `Quiz` and `Notification` are in the `supabase_realtime` publication |
| Extensions in use | `pg_cron`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `hypopg`, `index_advisor`, `supabase_vault` (Vault holds 0 secrets) |
| Not used | Edge Functions (none), Database Webhooks / `pg_net` (not installed), auth hooks, custom login roles |
| Storage | `avatars` 1 file · `prize-images` 15 · `site-media` 210 (19 MB) · `receipts` (private) 0 · `uploads` (old, public) 0 |
| Role settings | `anon` statement_timeout 3 s; `authenticated` 8 s; `authenticator` 8 s plus lock_timeout 8 s. These look like Supabase's defaults; compare them on the new project |
| Migration history | 26 entries in `supabase_migrations`, but most of the schema dates from before migrations were tracked (Prisma era). **Don't rebuild the schema from migrations: dump it** |
| Stored links to this project | `Prize.imageUrl` (4 rows), `User.profilePicture` (1), `LeaderboardCache.row` (3). Each holds `https://snhgaklxawthpihjiagh.supabase.co/storage/v1/object/public/...` |

---

## Expected gain

### Database call latency (server → Supabase)

| Setup | Per call | 4 calls in a row | Source |
| --- | --- | --- | --- |
| Today: Paris server → Tokyo | **164 ms** | ~660 ms | measured with the deep health check, 2026-10-20 (`HOSTINGER_REGION_MOVE.md` step 8) |
| After the Hostinger move only: Mumbai → Tokyo | **~130–150 ms** (estimate) | ~520–600 ms | AWS Mumbai↔Tokyo round trip is about 131 ms ([economize.cloud](https://www.economize.cloud/resources/aws/latency/ap-south-1-vs-ap-northeast-1/)), plus a few ms of processing |
| After both moves: Mumbai → Mumbai | **~10–25 ms** (estimate) | ~40–100 ms | same city: 1–5 ms of network, plus the API's own processing and TLS |

Hostinger's India data centre is in Mumbai ([Hostinger](https://www.hostinger.com/blog/hostinger-newly-launched-data-center-location-in-india));
Supabase's `ap-south-1` is AWS Mumbai. So after both moves the server and database are in the same city.

The deep health check (`/api/health?deep=1`, `components.database.latency`) times one Supabase API query. That
is the number to compare: right after the Hostinger move (runbook step 8), and again after this move.

The Hostinger move alone saves only about 15–35 ms per call. Most of the distance is between Mumbai and Tokyo, so
**this move is where most of the gain comes from.**

### Players' browsers → Supabase

Some traffic goes from the browser straight to Supabase: the live-quiz connection (Realtime), Google sign-in
redirects, and image downloads the CDN hasn't cached. Measured from the owner's PC in Pakistan on 2026-10-20 (TCP
connect, 5 tries each):

| To | Round trip |
| --- | --- |
| AWS Mumbai (`ap-south-1`) | 55–80 ms |
| AWS Tokyo (`ap-northeast-1`) | 170–205 ms |

### Capacity

Faster database calls mean each signed-in request finishes sooner. The 2026-10-17 load test found the limit was
Hostinger's request queue, not the database. So this may raise the signed-in request ceiling that test found,
but don't count on it until a test measures it again.

---

## Cost

| Item | Cost |
| --- | --- |
| Pro plan | $25/month, unchanged. It includes $10/month of compute credit, enough for **one** Micro project |
| A second project | **$10/month** (Supabase's quote for this organization), billed by the hour at $0.01344/h, about **$0.32 a day** |
| Rehearsal (step 1) | **$0**: done locally in Docker on 2026-10-20, no Supabase project |
| New project created a few hours before the window, old one kept running for 1 day after it | about **$0.40** |
| After the old project is moved to a Free organization and paused (step 5.3) | back to **$25/month**: one Micro project, covered by the credit |
| Egress, storage, monthly active users | unchanged (same usage, same plan quotas) |

Paid projects can't be paused. Supabase: *"To pause a project currently under a paid plan, first transfer the
project to an organization on the Free plan."* That is step 5.3: the old project stays available as a paused
archive at no cost, instead of being deleted.

---

## Everything tied to the project address or keys

### Supabase settings that do **not** come across with the data (copy them by hand)

Write each value down from the old project (step 0.4), and check it off on the new one.

| Where (Dashboard) | What | If it's missed |
| --- | --- | --- |
| Authentication → URL Configuration | **Site URL** `https://1think2win.com`; **Redirect URLs** allow list | sign-in emails and Google sign-in send users to the wrong place or are rejected |
| Authentication → Sign In / Providers → Google | Client ID and **client secret** (the same Google client as today), and every option the old project has | Google sign-in fails |
| Authentication → Sign In / Providers → Email | confirm email, secure email change, password rules, leaked-password protection | different sign-up behaviour |
| Authentication → Attack Protection | **CAPTCHA: Turnstile + secret key** | if CAPTCHA is on with no or wrong secret, **every sign-in and sign-up fails**; if it's off, there's no bot protection |
| Authentication → Emails → SMTP | **Brevo SMTP**: host, port, user, **password**, sender name and address | confirmation and password-reset emails come from Supabase's test mailer (2/hour) or not at all |
| Authentication → Emails → Templates | every template's subject and body | default Supabase emails |
| Authentication → Rate Limits, Sessions | every value | different limits |
| Project Settings → JWT Keys | the **current key must be ECC (P-256) / ES256**, as it is today | `getClaims()` asks the Auth server on every request, which is slower |
| Project Settings → API Keys | the new project's keys go into hPanel (see below) | — |
| Project Settings → Data API | exposed schemas (expect `public`, `graphql_public`), extra search path, **max rows** | API errors, or a different row cap |
| Realtime → Settings | **"Allow public access"** must match the old project. The app joins a public channel (`quiz-changes`) | live quiz updates silently stop |
| Database → Settings | SSL enforcement, network restrictions, pooler size | — |
| Database → Extensions | `pg_cron`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `hypopg`, `index_advisor`. `schema.sql` creates all of them itself (`CREATE EXTENSION IF NOT EXISTS`), so enabling them first is only a safety net | the schema load fails |

The Management API can export the old Auth configuration in one call, which saves copying screens by hand:
`GET https://api.supabase.com/v1/projects/snhgaklxawthpihjiagh/config/auth` with the personal access token
(`SUPABASE_ACCESS_TOKEN` in `.env`). The same body can be sent as a `PATCH` to the new project. Secrets (Google
secret, SMTP password, CAPTCHA secret) may come back blank or masked, so **type them in by hand** either way.
The exported file contains secrets: keep it outside the repo and delete it afterwards.

### Outside Supabase

| Where | Change | If it's missed |
| --- | --- | --- |
| **hPanel → Environment variables** | `NEXT_PUBLIC_SUPABASE_URL` → `https://<new-ref>.supabase.co`; `NEXT_PUBLIC_SUPABASE_ANON_KEY` → new publishable key; `SUPABASE_SERVICE_ROLE_KEY` → new secret key | the site keeps using Tokyo |
| hPanel → `DATABASE_URL`, `DIRECT_URL` | Not used by the app code (Prisma leftovers). Point them at the new project, or delete them | nothing breaks, but they'd point at a deleted database later |
| **hPanel → Redeploy** | `NEXT_PUBLIC_*` values are **built into** the pages, the CSP (`src/proxy.ts:13`, built per process) and the image settings (`next.config.js:33`). Changing the variables does nothing until a **rebuild** | browsers keep calling the old project, and the CSP blocks the new one |
| **Google Cloud Console** → the OAuth client → *Authorized redirect URIs* | **Add** `https://<new-ref>.supabase.co/auth/v1/callback`. Keep the old one until step 5.4 | Google sign-in shows `redirect_uri_mismatch` |
| Brevo → Security → **Authorized IPs** | If that list is on, Supabase Mumbai sends from different IPs than Tokyo. Turn the list off for SMTP, or add Supabase's sending IPs | sign-up and password-reset emails stop (Brevo blocks them) |
| Cloudflare | Nothing points at Supabase (no custom domain, no Worker). **Purge the cache** after the switch: cached `/api/live/quizzes/*` answers contain old image links | old image links are served until the cache expires (they work until the old project is deleted) |
| Turnstile widget (Cloudflare) | nothing: it checks the site's domain, not Supabase | — |
| Local files (git-ignored, they hold secrets) | `.env`, `.env.production`, `.env.hostinger-import` all name the old project. Update them after the switch. **Keep a copy of the old values** for rollback (step 4) | local dev and the next hPanel import go to the old project |
| GitHub Actions | `gh secret list` shows no repository secrets; CI uses `https://test.supabase.co`. Nothing to change | — |

### In the repo

No application code names the project. Everything goes through `NEXT_PUBLIC_SUPABASE_URL`:
`src/lib/supabase/*.ts`, `src/lib/auth*.ts`, `src/actions/auth-actions.ts`, `src/lib/media/config.ts`,
`src/proxy.ts`, `next.config.js`. The code uses `@supabase/supabase-js` 2.108 and `@supabase/ssr` 0.10
everywhere, and never sends the key in its own `Authorization` header. So the new `sb_publishable_…` and
`sb_secret_…` keys can go into the **same** variables.

Places that hard-code the ref `snhgaklxawthpihjiagh`:

| File | What | Change |
| --- | --- | --- |
| `load-test/prepare-users.ts:23` | `PRODUCTION_PROJECT_REFS`: refuses to create load-test users on production | **add the new ref** (keep the old one). Otherwise this guard no longer protects production |
| `load-test/realtime-probe.ts:24` | `PRODUCTION_REF`: same kind of guard | make it a list with both refs |
| `load-test/RUNBOOK.md:71,131`, `load-test/PROJECT_HANDLING_REPORT.md:9`, `deploy/HOSTINGER_REGION_MOVE.md:22` | docs that mention the ref or "Tokyo" | update the text |

Other ways the old address is tied in:

- **Session cookie name.** `@supabase/ssr` names the cookie `sb-<project-ref>-auth-token`
  (`load-test/lib/session-cookie.ts:26`). The new project has a new ref, so the site no longer sees existing
  cookies and **every user is signed out once**. They can't be carried over anyway: tokens are signed with the
  old project's private key, which can't be exported.
- **Stored image links** (see the table above): rewrite them in SQL (step 3.6). Until then images still load from
  the old project. But `parseMediaUrl()` (`src/lib/media/config.ts:76`) only recognises the **current** project's
  address, so deleting or replacing such an image would leave its files behind. And once the old project is
  deleted, those images break.

---

## Rehearsal results (local, 2026-10-20)

Production was copied (read-only) into a local Postgres 17 in Docker that was set up like a brand-new Supabase
project: Supabase's roles, its `auth`/`storage`/`realtime` schemas as production has them, the default grants
every new project starts with, and nothing of the app. The restore ran as a **non-superuser `postgres`**, as it
does on Supabase. Then everything was compared with production. The copies were deleted afterwards.

**Result: the method works, after four fixes**, which are now built into the tools and the steps below:

| # | Found | Effect without the fix | Fix |
| --- | --- | --- | --- |
| 1 | **Security:** a new project grants everything in `public` to `anon`, `authenticated` and `service_role` by default. Production has those defaults removed, and the dump only adds grants | the API roles got extra rights on **88 of 95** objects, including EXECUTE on admin-only functions such as `approve_claim` and `allocate_points_to_winners` | `before-schema.sql` removes the defaults before the schema load. Afterwards all 95 objects matched production (Appendix D) |
| 2 | `roles.sql` re-sets a setting on `supabase_admin`, Supabase's own superuser | the whole structure load stops: *only roles with the SUPERUSER attribute may alter roles with the SUPERUSER attribute* | `dump-all.sh` comments that line out (Supabase sets it on every project anyway) |
| 3 | `schema.sql` already adds `Quiz` and `Notification` to the Realtime publication | the old Appendix A line fails: *relation "Quiz" is already member of publication* | line removed from Appendix A |
| 4 | Repeating the data load (trial copy, then the final copy) | the second load fails on duplicate rows | `dump-all.sh data` also writes `truncate.sql`, which empties exactly those tables first. It refuses to run on any database without the marker `before-schema.sql` creates, so it can't empty the old project |

What was checked, all passing:

- **Contents:** every row of every table in `public`, `private_hardened`, `auth` and `supabase_migrations` is
  identical (row fingerprints, Appendix D), plus functions (62), policies (54 + 9 storage), RLS flags, columns,
  constraints, indexes, views, sequences, the Realtime tables and the cron job. The only difference is
  `auth.schema_migrations` (82 rows), which Supabase Auth fills itself on a new project.
- **Permissions:** all 95 tables, functions, sequences and schemas match production exactly (with fix 1).
- **Order:** roles → schema → storage policies → data → sign-up trigger → cron job, as in steps 2.5–3.4.
- **Sign-up trigger:** a new `auth.users` row creates its `User` row.
- **Freeze and unfreeze** (steps 3.1 and Rollback): writes fail while frozen and work again afterwards.
- **Repeat load:** a trial load, a test sign-up, then `truncate.sql` + the final load gave an exact copy again.
- **Files:** all **226** files (19.0 MB) are listed by the method Supabase's copy script uses and download with
  the size the database records. None would be missed. The script keeps each bucket's public flag, size limit
  and file types.
- **Link rewrite (Appendix C):** the scan finds exactly the 3 known columns (4 + 1 + 3 links). After the rewrite
  and the leaderboard rebuild, it finds none.

Timings from the owner's PC:

| Step | Time |
| --- | --- |
| `dump-all.sh structure` (roles, schema, history) | ~1 min |
| `dump-all.sh data` (data, history, truncate list) | ~45 s |
| Structure load / data load | ~1 s each locally; allow a minute each over the internet |
| Storage: list and download 226 files from Tokyo | 71 s per pass, plus the upload to Mumbai |
| Link rewrite + scan | under 1 s |

Not testable locally, so step 2 tests them on the **real** new project before the window: the permissions
Supabase gives `postgres` through `supautils` (creating extensions, storage policies, the trigger on
`auth.users`, the freeze), the Supabase services against the copied data (password and Google sign-in, Storage
API, Realtime), and the app itself against the new project.

---

## Steps

Tools on the PC: Docker Desktop, and the `postgres:17-alpine` image (already downloaded; `pg_dump` and `psql`
17.11). The scripts are in `deploy/supabase-move/`:

| File | What it does |
| --- | --- |
| `dump-all.sh` | `structure` or `data` dump of the old project, with the same pg_dump commands and filters as `supabase db dump`, so the Supabase CLI isn't needed. Fix 2 is built in; `data` also writes `truncate.sql` |
| `before-schema.sql` | fix 1, plus the marker that `truncate.sql` checks. **New project only** |
| `check-copy.sql`, `check-permissions.sql` | Appendix D: run on both projects; the outputs must match |

Keep the dump files **outside the repo**, for example `D:\1think2win-migration\`. They contain password hashes
and personal data. Delete them when the old project is deleted.

Connections: in `D:\1think2win-migration\`, make one file per project from its **Session pooler** details
(Dashboard → **Connect**, IPv4, port 5432; the direct `db.<ref>.supabase.co` host is IPv6-only). They hold the
database passwords: never commit or share them, and delete them in step 5.5.

`old.env`:
```
PGHOST=aws-1-ap-northeast-1.pooler.supabase.com
PGPORT=5432
PGUSER=postgres.snhgaklxawthpihjiagh
PGPASSWORD=<old database password>
PGDATABASE=postgres
PGSSLMODE=require
```

`new.env`: the same six lines with the new project's values (`PGHOST=aws-<n>-ap-south-1.pooler.supabase.com`,
`PGUSER=postgres.<new-ref>`, its database password).

Every command below runs in PowerShell from `D:\1think2win-migration\`, after:
```powershell
$TOOLS = "D:\Projects(Clients)\1think2winsx\deploy\supabase-move"
```

### Step 0: Before anything (no downtime)

- [ ] 0.1 **Owner approval** for the move, the window, and "everyone signs in again".
- [x] 0.2 The **Hostinger move is finished** and `HOSTINGER_REGION_MOVE.md` step 8 passes. Write down the deep
      health latency from the new server: **155–168 ms** (2026-10-20, Mumbai server → Tokyo database; that's the
      "before" number for this move).
- [ ] 0.3 Pick the window: no live quiz, no scheduled push, lowest traffic. Tell players the day before (sign-in
      will be needed again).
- [ ] 0.4 Record the old project's settings (the "copy by hand" table above), and export the Auth config through
      the Management API.
- [ ] 0.5 Reset or look up the old project's **database password** (Database → Settings). Resetting it doesn't
      affect the app, which doesn't connect to Postgres directly.

### Step 1: Rehearsal (done locally on 2026-10-20)

- [x] Done in Docker at no cost. See [Rehearsal results](#rehearsal-results-local-2026-10-20); its fixes are in the
      tools and in steps 2–3.
- The parts that need Supabase itself are tested on the **real** new project in step 2 (2.8–2.10), hours before
  the window, so no separate rehearsal project is needed.

### Step 2: Prepare the real project (no downtime, on switch day, a few hours before the window)

- [ ] 2.1 Create project `1Think2Win` in **`ap-south-1` (Mumbai)**, in the same organization, Micro. Write down:
      new ref `____________________`, URL `https://<new-ref>.supabase.co`. Make `new.env` (see above).
- [ ] 2.2 Copy every setting from step 0.4. Enabling the extensions first is optional (`schema.sql` creates them).
      Make sure the JWT signing key is **ES256**: if it shows a legacy HS256 secret, create an ECC P-256 key and
      rotate to it now, while the project has no users.
- [ ] 2.3 API keys: copy the **publishable** and **secret** keys (Settings → API Keys). Use these, not the legacy
      `anon`/`service_role` keys, which stop working at the end of 2026.
- [ ] 2.4 Google Cloud Console: **add** the new callback URL (keep the old one).
- [ ] 2.5 Dump the structure from the old project and load it into the new one. `before-schema.sql` goes **first**
      (security fix 1). One transaction: if anything fails, nothing is loaded; fix it and rerun.
      ```powershell
      docker run --rm --env-file old.env -v "${TOOLS}:/tools:ro" -v "${PWD}:/out" postgres:17-alpine sh /tools/dump-all.sh structure
      docker run --rm --env-file new.env -v "${TOOLS}:/tools:ro" -v "${PWD}:/m" postgres:17-alpine `
        psql --single-transaction --variable ON_ERROR_STOP=1 `
        --file /tools/before-schema.sql --file /m/roles.sql --file /m/schema.sql --file /m/history_schema.sql
      ```
      Supabase's guide lists two other known errors; neither appeared in the rehearsal: `ALTER ... OWNER TO
      "supabase_admin"` (comment such lines out of `schema.sql`) and the `cli_login_postgres` grant (comment it out
      of `roles.sql`).
- [ ] 2.6 SQL editor on the **new** project: the 9 storage policies and the `lock_timeout` line (Appendix A). The
      Realtime publication already came with `schema.sql`. Keep the trigger and cron job for later: they go in
      **after** a data load.
- [ ] 2.7 **Storage, first pass:** create the 5 buckets with the same settings, and copy all files.
      [Supabase's storage migration script](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore#migrating-storage-objects)
      does both. It creates each bucket with the same public flag, size limit and file types, and keeps each
      file's content type and cache-control. Run it from the migration folder, with the old and new URL and
      secret key. Check the counts: `avatars` 1 · `prize-images` 15 · `site-media` 210 · `receipts` 0 · `uploads` 0.
      (Rehearsal: all 226 files list and download correctly; downloading took 71 s.)
- [ ] 2.8 **Trial data copy** (the old project is **not** frozen, the live site carries on). Run the commands of
      steps 3.2 and 3.3, then Appendix A's "after the data load" part, then the Appendix D checks:
      `check-permissions` must match apart from the 3 expected lines. `check-copy` may differ on tables the live
      site changed since the trial dump; that's fine now, because the window copies them again. Then run Appendix
      C (link rewrite) and its scan.
- [ ] 2.9 **Test the app against the new project, locally** (live site unaffected):
      - First, SQL editor on the new project: `truncate public."PushSubscription";`. The copy holds real players'
        devices, and nothing in this test may notify them. The final load in step 3.3 puts the rows back.
      - A temporary `.env.local` (it overrides `.env`) with the three Supabase values of the new project **and
        `SCHEDULER_ENABLED=false`**, so the app's job runner can't send scheduled pushes or emails from the copy.
        Then `npm run build && npm run start`.
      - On `http://localhost:3000`, go through the step-4 checks that don't send anything: email and Google sign-in
        with existing accounts, a new sign-up, avatar upload (delete the test file afterwards: Storage isn't reset
        by the final load), images, leaderboard, the live quiz page. Don't send newsletters or payments.
      - Google sign-in from localhost needs `http://localhost:3000/**` in the new project's redirect list (copied
        from production, which has it).
      - Delete `.env.local` afterwards.
- [ ] 2.10 **Try the freeze and unfreeze** (step 3.1 and Rollback commands) on the **new** project, to prove they
      work as the `postgres` role on Supabase. Unfreeze it again.
- [ ] 2.11 Optional: Appendix B gives a quick row-count view in the SQL editor. Appendix D is the full check.

### Step 3: Switch over (the window, about 30–45 minutes)

Pages keep loading during the window, but sign-in, answers and every save fail on purpose. That way no write
lands in the old database after its final copy.

- [ ] 3.1 **Freeze the old database** (SQL editor, **old** project):
      ```sql
      alter database postgres set default_transaction_read_only = on;
      ```
      Then Settings → General → **Restart project**, so every connection picks it up (1–2 min). Check in a new
      SQL editor tab: `show default_transaction_read_only;` says `on`, and
      `create table public._freeze_check (x int);` fails with *cannot execute CREATE TABLE in a read-only
      transaction*. Supabase itself switches databases to read-only when a disk fills, so its services cope
      with it. Step 2.10 confirms the commands work as `postgres` on Supabase; the local rehearsal confirmed
      that writes fail while frozen and work again after the unfreeze.
- [ ] 3.2 **Dump the data** (auth users and identities included; Storage's tables are left out, the copy script
      handles them). This also writes `truncate.sql`:
      ```powershell
      docker run --rm --env-file old.env -v "${TOOLS}:/tools:ro" -v "${PWD}:/out" postgres:17-alpine sh /tools/dump-all.sh data
      ```
- [ ] 3.3 **Load it** into the new project: empty the tables the trial filled, then load with triggers off. One
      transaction, so a failure leaves the trial copy as it was:
      ```powershell
      docker run --rm --env-file new.env -v "${PWD}:/m" postgres:17-alpine `
        psql --single-transaction --variable ON_ERROR_STOP=1 `
        --file /m/truncate.sql --command "SET session_replication_role = replica" --file /m/data.sql --file /m/history_data.sql
      ```
- [ ] 3.4 Create the `on_auth_user_created` trigger and the cron job (Appendix A). Both commands are safe to run
      again if step 2.8 already created them.
- [ ] 3.5 **Compare the two projects** (Appendix D). Both outputs must match apart from the expected lines listed
      there. The old project is frozen, so there's no other excuse for a difference.
- [ ] 3.6 **Rewrite the stored image links** and rebuild the leaderboard (Appendix C). Then run the link scan
      (Appendix C): it must return **no rows**.
- [ ] 3.7 **Storage, second pass:** run the copy script again and choose "merge", to pick up any file uploaded
      since step 2.7. Check the counts again.
- [ ] 3.8 **hPanel:** set the three Supabase variables (and `DATABASE_URL`/`DIRECT_URL`) to the new project, then
      **Deployments → Redeploy** with the same zip that is live. The build log must finish without errors.
- [ ] 3.9 Cloudflare → Caching → **Purge Everything**.
- [ ] 3.10 Run the checks in step 4. If they pass, the window is over. **Leave the old database frozen.**

### Step 4: Checks after the switch

| Check | How | Expect |
| --- | --- | --- |
| Site up | open https://1think2win.com | home page loads |
| Uses the new project | `curl -sI https://1think2win.com/faq` | `content-security-policy` `connect-src` contains `https://<new-ref>.supabase.co` and **not** the old ref |
| Faster | `curl -s -H "Authorization: Bearer <CRON_SECRET>" "https://1think2win.com/api/health?deep=1"` → `components.database.latency` | **~10–25 ms** (was 164 ms in Paris; step 0.2 has the Mumbai→Tokyo number) |
| Email sign-in (existing user) | sign in with a known password | lands on /quizzes (password hashes came across) |
| Google sign-in (existing user) | sign in with Google | the **same** account and points, not a new empty profile |
| Sign-up | new email address | Turnstile passes, the confirmation email arrives (SMTP), and `select count(*) from public."User"` goes up by 1 (the trigger works) |
| Password reset | "Forgot password" | email arrives, the link works |
| Avatar upload | profile → change picture | saved; the image URL is on the new host |
| Prize image | admin → create a prize with an image, then delete it | created with an image URL on the new host; deleting queues a `MediaDeletion` row (`pending`) whose URL is on the new host |
| Images | home, prizes, leaderboard | no broken images; image URLs use the new host |
| Live quiz | admin → push a quiz while another device watches the stream | banner and countdown appear; the bell count goes up (Realtime) |
| Leaderboard job | new project: `select status, end_time from cron.job_run_details order by end_time desc limit 3;` after 5 min | `succeeded` |
| Browser console | DevTools on a quiz page | no CSP errors; the websocket goes to `wss://<new-ref>.supabase.co/realtime/...` |
| Errors | Sentry → Issues | no new spike |
| Old project quiet | old project → Logs → API | no new requests except from tabs left open since before the switch |

### Step 5: Afterwards

- [ ] 5.1 Keep the old project **frozen and running for 1 day** (about $0.32) as the quick-rollback copy (see
      Rollback).
- [ ] 5.2 Before moving it: old project → Database → **Backups**, download the latest daily backup and keep it with
      the step-3 dump files. The Free plan has no backups, so this is the last one Supabase makes.
- [ ] 5.3 **Move the old project to a Free organization and pause it**, instead of deleting it. It then costs
      nothing and stays available as an archive.
      1. Dashboard → organization switcher → **New organization**, plan **Free** (for example
         `1think2win-archive`).
      2. Old project → Settings → General → **Transfer project** → the Free organization. Supabase requires:
         you are **Owner** of the current organization, the project has no GitHub integration connected and no log
         drains, and you have a free-project slot. That means at most two **active** free projects across your
         organizations; paused ones don't count. Expect 1–2 minutes of downtime on the old project, which no longer
         serves anyone.
      3. Then, in the old project → Settings → General → **Pause project**. Leave it frozen (read-only).
      4. While paused it can be resumed with one click for **90 days**, to look something up or recover a row.
         After 90 days the dashboard still offers its backup and Storage files for download.
      5. Delete it once you no longer need it (at the latest after the 90 days). Keep the dump files and the backup
         from 5.2 until then.
- [ ] 5.4 Remove the old project's callback URL from the Google client (nothing signs in there any more).
- [ ] 5.5 New project → SQL editor: `drop schema _move_target;` (the marker for `truncate.sql`). Delete `old.env`
      and `new.env` (they hold database passwords).
- [ ] 5.6 Update the local `.env`, `.env.production` and `.env.hostinger-import` with the new values.
- [ ] 5.7 Small PR: add the new ref to the load-test guards (`load-test/prepare-users.ts:23`,
      `load-test/realtime-probe.ts:24`), and update the docs that name the old ref or Tokyo.
- [ ] 5.8 Run the deep health check again and record the number in `HOSTINGER_REGION_MOVE.md`.

---

## Rollback

The old project stays untouched and frozen at the moment of the final copy, so going back is quick.

| When | How | Data loss |
| --- | --- | --- |
| Before the hPanel redeploy (steps 3.1–3.7) | Unfreeze the old database (below). Nothing else changed | none |
| After the switch, within ~1 hour | hPanel: put back the **old** three values (keep them from `.env.hostinger-import` before step 3.8) → Redeploy → unfreeze the old database → purge the Cloudflare cache | anything written to the new project since the switch (sign-ups, answers): copy it back by hand, or accept losing it |
| Later | **Don't roll back.** Fix the problem on the new project (both projects have diverged) | — |
| After step 5.3 (old project paused in the Free organization) | Not a rollback target any more: resume it only to look something up or recover data by hand | — |

Unfreeze (SQL editor, **old** project), then restart the project:
```sql
set session characteristics as transaction read write;
alter database postgres reset default_transaction_read_only;
```

Users who signed in on the new project have to sign in again after a rollback, because the cookie name changes
back.

---

## Risks

| Risk | Likelihood | Effect | Mitigation |
| --- | --- | --- | --- |
| Everyone is signed out once | **certain** | each player signs in again | announce it; pick a quiet hour |
| A Supabase setting isn't copied (CAPTCHA secret, SMTP, Google secret, templates) | medium | sign-ins, sign-ups or emails fail | the copy-by-hand table, the Auth config export, and the step-4 sign-in, sign-up and reset checks |
| Brevo's IP allow-list blocks Supabase Mumbai's mail servers | low–medium | sign-up and reset emails stop | check Brevo → Security → Authorized IPs before the window |
| Google callback URL not added | low | Google sign-in fails | step 2.4, tested in the rehearsal |
| `on_auth_user_created` trigger not recreated | medium (the dump skips it) | new sign-ups get no `User` row and the app errors after sign-up | step 3.4; the sign-up check |
| Storage policies not recreated | medium (the dump skips them) | avatar and receipt uploads are refused | step 2.6; the avatar check |
| Realtime publication or "Allow public access" differs | low (`schema.sql` carries the publication; rehearsal confirmed) | live quiz pushes and bell counts stop updating live | the Realtime setting (copy by hand); Appendix D; the live-quiz check |
| pg_cron job not recreated | medium (the data dump skips it; the rehearsal confirmed) | the leaderboard stops refreshing | step 3.4; the job-history check. Its run history (2,937 rows) isn't copied, which is fine |
| Files not copied, or links not rewritten | low | broken images once the old project is deleted | object counts, the link scan; the old project stays as a paused archive for 90 days (step 5.3) |
| Writes during the window are lost | low (frozen) | lost answers or sign-ups | the freeze in step 3.1, and choosing the window |
| Browser tabs open since before the switch keep the old address | certain for open tabs | those tabs talk to the frozen old project: saves fail, nothing silently goes to the wrong place | a reload fixes it. The service worker loads pages from the network first (`public/sw.js`) |
| Sign-up or reset links emailed just before the switch | low | the link fails (its one-time code is in the old project) | the user asks for a new email |
| New API keys behave differently from the legacy ones | low | API or Realtime errors | the rehearsal runs the app with them; the code only passes keys to supabase-js |
| The new project uses legacy HS256 signing | low | each request asks the Auth server (fast in Mumbai, but slower) | step 2.2 |
| The Hostinger rebuild fails | low | the old build keeps running against the frozen database | `next.config.js` keeps `experimental.cpus: 4`; roll back if the build can't be fixed within the hour |
| The load-test guards don't know the new ref | certain until step 5.4 | a load test could target the live site | step 5.4, before anyone runs a load test |
| Restore errors (`supabase_admin` owner lines, `cli_login_postgres` grant, Postgres 17 settings) | low (rehearsed) | the load stops (single transaction, so nothing is half-loaded) | the local rehearsal found one (fix 2, built into `dump-all.sh`); Supabase-only permissions are tested on the real project in step 2, before the window |
| The new project's default grants give the API roles rights production withholds | **certain without fix 1** | visitors and signed-in users could call admin-only functions (`approve_claim`, `allocate_points_to_winners`, …) and use locked-down tables | `before-schema.sql` in step 2.5; the Appendix D permission check must match before the switch |
| `truncate.sql` run against the wrong project | low | it would empty that project's tables | it stops unless the `_move_target` marker from `before-schema.sql` exists, which only the new project has |
| The app test (step 2.9) notifies real players from the copied data | low | stray pushes or emails | `SCHEDULER_ENABLED=false`, `PushSubscription` emptied on the new project first, no newsletters or payments in the test |

**Not caused by this move, but due by the same date:** the current project uses the legacy `anon` and
`service_role` keys, which Supabase says keep working only **until the end of 2026**. If this move doesn't happen,
switch the current project to publishable and secret keys before then. The move does it as a side effect
(step 2.3).

---

## Appendix A: SQL to recreate what the dump leaves out

Generated from production on 2026-10-20. Run it on the **new** project.

```sql
-- Storage policies (step 2.6)
create policy "Authenticated users can upload" on storage.objects as permissive for insert to public
  with check (((bucket_id = 'uploads'::text) and (auth.role() = 'authenticated'::text)));
create policy "Users can delete own files" on storage.objects as permissive for delete to public
  using (((bucket_id = 'uploads'::text) and (auth.uid() = owner)));
create policy "Users can update own files" on storage.objects as permissive for update to public
  using (((bucket_id = 'uploads'::text) and (auth.uid() = owner)));
create policy avatars_owner_delete on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'avatars'::text) and ((storage.foldername(name))[1] = (( select auth.uid() as uid))::text)));
create policy avatars_owner_insert on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'avatars'::text) and ((storage.foldername(name))[1] = (( select auth.uid() as uid))::text)));
create policy avatars_owner_select on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'avatars'::text) and ((storage.foldername(name))[1] = (( select auth.uid() as uid))::text)));
create policy avatars_owner_update on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'avatars'::text) and ((storage.foldername(name))[1] = (( select auth.uid() as uid))::text)))
  with check (((bucket_id = 'avatars'::text) and ((storage.foldername(name))[1] = (( select auth.uid() as uid))::text)));
create policy receipts_owner_insert on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'receipts'::text) and ((storage.foldername(name))[1] = (( select auth.uid() as uid))::text)));
create policy receipts_owner_select on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'receipts'::text) and ((storage.foldername(name))[1] = (( select auth.uid() as uid))::text)));

-- Realtime: nothing to do. schema.sql already adds "Quiz" and "Notification" to supabase_realtime
-- (running the old `alter publication ... add table` line fails with "already member of publication").

-- Role timeouts (step 2.6): roles.sql already carries the statement_timeout values; only this one isn't in it
alter role authenticator set lock_timeout = '8s';

-- After a data load (steps 2.8 and 3.4). Safe to run twice: the trigger is replaced, the job updated by name
create or replace trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
select cron.schedule('refresh-leaderboard', '*/5 * * * *', 'SELECT public.refresh_leaderboard_cache()');
```

On the day, check again for anything added since this plan was written:
`select schemaname, policyname from pg_policies where schemaname in ('storage','realtime');`,
`select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('auth','storage') and not t.tgisinternal;`
(ignore Supabase's own `protect_*`, `enforce_bucket_name_length_trigger` and `update_objects_updated_at`), and
`select jobname, schedule, command from cron.job;`.

## Appendix B: Row counts (run on both projects and compare)

```sql
select 'public.' || table_name as tbl,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::int as n
from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
union all select 'auth.users', count(*) from auth.users
union all select 'auth.identities', count(*) from auth.identities
union all select 'storage:' || bucket_id, count(*) from storage.objects group by bucket_id
order by 1;
```

## Appendix C: Rewrite stored links (new project, step 3.6)

Replace `<new-ref>` first.

```sql
begin;
update public."Prize" set "imageUrl" = replace("imageUrl", 'https://snhgaklxawthpihjiagh.supabase.co/', 'https://<new-ref>.supabase.co/')
  where "imageUrl" like 'https://snhgaklxawthpihjiagh.supabase.co/%';
update public."User" set "profilePicture" = replace("profilePicture", 'https://snhgaklxawthpihjiagh.supabase.co/', 'https://<new-ref>.supabase.co/')
  where "profilePicture" like 'https://snhgaklxawthpihjiagh.supabase.co/%';
-- Prize images queued for delayed deletion (0 rows today). Otherwise the scheduler can't delete them, because
-- parseMediaUrl() rejects other hosts
update public."MediaDeletion" set "url" = replace("url", 'https://snhgaklxawthpihjiagh.supabase.co/', 'https://<new-ref>.supabase.co/')
  where "url" like 'https://snhgaklxawthpihjiagh.supabase.co/%';
select public.refresh_leaderboard_cache();
commit;
```

Link scan: lists every text or JSON column that still holds the old address. It must return no rows. If it
finds a column not covered above, rewrite it the same way.

```sql
select table_schema, table_name, column_name, n from (
  select c.table_schema, c.table_name, c.column_name,
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I where %I::text like %L',
      c.table_schema, c.table_name, c.column_name, '%snhgaklxawthpihjiagh%'), false, true, '')))[1]::text::int as n
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema in ('public', 'private_hardened') and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
) x where n > 0;
```

## Appendix D: Compare the two projects (steps 2.8 and 3.5)

Read-only on both. Run it after the data load and the trigger/cron step, and **before** the link rewrite
(Appendix C changes `Prize`, `User` and `LeaderboardCache` on purpose).

```powershell
foreach ($p in "old", "new") { foreach ($c in "check-copy", "check-permissions") {
  docker run --rm --env-file "$p.env" -v "${TOOLS}:/tools:ro" postgres:17-alpine psql -At -F "`t" --variable ON_ERROR_STOP=1 `
    --command "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY" --file "/tools/$c.sql" | Out-File -Encoding utf8 "$p-$c.tsv"
} }
Compare-Object (Get-Content old-check-copy.tsv) (Get-Content new-check-copy.tsv)
Compare-Object (Get-Content old-check-permissions.tsv) (Get-Content new-check-permissions.tsv)
```

`check-copy.sql` prints one line per check: row count and a fingerprint of every row of every table, plus
functions, policies, RLS, columns, constraints, indexes, views, grants, triggers, Realtime tables, sequences, role
settings, the cron job and extensions. `check-permissions.sql` lists who may use each of the 95 tables, functions,
sequences and schemas. `Compare-Object` prints only lines that differ (`<=` old only, `=>` new only). Expected,
and fine:

| Output | Expected difference | Why |
| --- | --- | --- |
| `check-copy` | `rows auth.schema_migrations` | Supabase Auth's own record of its upgrades; the new project fills it itself |
| `check-copy` | `rows public.LeaderboardCache` | only if the new project's cron job rebuilt it between the load and the check |
| `check-copy` | `extensions` | only if the new project has an extra extension enabled by default; harmless |
| `check-copy` | `role settings` (`session_preload_libraries=safeupdate` on `authenticator`) | should match, because Supabase sets it on every project. If the new project lacks it, note it and carry on (it only blocks UPDATE/DELETE without a WHERE through the API), then ask Supabase support |
| `check-permissions` | 3 lines `default grants supabase_admin …`, new project only | Supabase's own role keeps its default grants. `postgres` can't change them, and they only apply to objects Supabase itself creates |
| either, **step 2.8 only** | rows of tables the live site changed after the trial dump | the window copies them again |

Anything else is a real difference: stop, fix it, and run the check again before step 3.8. If it can't be fixed
within the window, follow Rollback (unfreeze the old project).

---

Sources: Supabase docs ([Change project region](https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z),
[Backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[Restore to a new project](https://supabase.com/docs/guides/platform/clone-project): same region only, so it doesn't apply here,
[JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys),
[Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys),
[Compute usage and pricing](https://supabase.com/docs/guides/platform/manage-your-usage/compute),
[Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq),
[Project transfers](https://supabase.com/docs/guides/platform/project-transfer),
[Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing));
Supabase's own code: the `supabase db dump` scripts ([supabase/cli](https://github.com/supabase/cli/tree/develop/apps/cli-go/pkg/migration))
and a new project's default grants ([supabase/postgres initial schema](https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql));
[AWS Mumbai↔Tokyo latency](https://www.economize.cloud/resources/aws/latency/ap-south-1-vs-ap-northeast-1/) (third-party measurement);
[Hostinger's Mumbai data centre](https://www.hostinger.com/blog/hostinger-newly-launched-data-center-location-in-india).
Production facts come from read-only queries on 2026-10-20; latency was measured from the owner's PC the same day.
