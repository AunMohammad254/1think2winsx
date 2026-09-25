# Local 50k-user load test

Reproduces production (Supabase) locally: real Postgres 16 + PostgREST 12 behind a
tiny gateway that mimics Supabase's `/rest/v1` and `/auth/v1/user` (20 ms simulated
RTT each), seeded with **50,000 users, 155k quiz attempts, 3.1M answers**.

```bash
# 1. Postgres on :5433, then (as superuser)
createdb -p 5433 t2w
for f in sql/00_shim.sql sql/01_tables.sql sql/02_prod_security.sql sql/03_prod_functions.sql sql/10_seed.sql; do psql -p 5433 -d t2w -f $f; done
#    ...optionally apply ../supabase/migrations/*.sql to test the "after" state
# 2. PostgREST + gateway
postgrest pgrst.conf &      # https://github.com/PostgREST/postgrest/releases
node gateway.mjs &          # :54321 (fake Supabase URL)
node keys.mjs print         # anon/service keys -> put in the app's .env.local
# 3. Build & start the app (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321), then
npm i undici@6
CONC=200 DUR=30 node loadgen.mjs          # mixed traffic, random user out of 50k
ONLY=quizList CONC=1 DUR=3 node loadgen.mjs  # per-endpoint upstream-call profile
node sectest.mjs                           # direct-API exploit checks (run as a normal user)
```

Traffic mix: 40% quiz list, 20% leaderboard, 15% quiz detail, 10% submit, 15% landing page.
