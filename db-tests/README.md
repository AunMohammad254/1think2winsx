# Database tests

Tests that run the app's real Postgres functions, row-level security and table privileges
against a **local** Postgres. The unit suite (`src/tests`) mocks Supabase, so it can't catch
wrong SQL. Covered so far:

- `submit_quiz_attempt`: saving, resubmits, re-attempts, closed questions, answering window,
  payment, wrong user, bad payloads, concurrent double submit
- `get_quiz_attempt_counts_by_quiz`: column names and who may call it
- `decrement_prize_stock`: decrements `stock`, raises P0001 when empty, no oversell under racing
  calls, service role only
- Removed functions stay removed (`validate_quiz_submission_time`)
- RLS: players read only their own rows; anon reads no quiz data; players can't write
  attempt, payment or quiz tables directly
- Schema `public`: anon, authenticated and service_role keep USAGE but can't create tables,
  views or functions in it
- Support tickets: `create_support_ticket` numbers, rate limits and concurrent requests, the
  `SupportTicket` constraints, and that only the service role can reach the table or functions

## Running locally

Needs Docker. Start a throwaway Postgres 17 (the Supabase project's major version):

```bash
docker run -d --rm --name t2w-dbtest -p 127.0.0.1:54329:5432 -e POSTGRES_PASSWORD=postgres postgres:17-alpine
```

Then run the tests:

```bash
bun run test:db
```

Stop the container when you're done (`--rm` deletes it):

```bash
docker stop t2w-dbtest
```

The default server URL is `postgres://postgres:postgres@127.0.0.1:54329/postgres`. Set
`DB_TEST_URL` to use another local server. Each run drops and recreates a database called
`t2w_db_tests` on that server and empties its tables between tests. To make sure this can
never hit a real database, `helpers.ts` refuses any host that isn't `localhost`, `127.0.0.1`
or `::1`.

These tests are separate from `bun run test` / `bun run test:coverage`. They use their own
config (`db-tests/vitest.config.ts`), add no coverage, and are excluded from `bun test` in
`bunfig.toml`. In CI they run as the `db-tests` job in `.github/workflows/tests.yml`,
against a Postgres service container.

## How it works

- `schema/00-supabase-shim.sql` adds what a Supabase project provides: the `anon`,
  `authenticated` and `service_role` roles, and `auth.uid()`, `auth.role()` and `auth.jwt()`
  (same definitions as Supabase). It also adds minimal `auth.users` and `auth.identities`
  tables, and gives schema `public` the access list production had on 2026-10-20 (PUBLIC
  could still create objects there until the `06-20261020120000` migration).
- `schema/01-…` to `05-…` are the baseline: a verbatim copy of a read-only dump of the live
  schema's catalog taken on 2026-10-09. It covers tables, constraints, indexes, functions,
  views, RLS policies and grants, and contains no data. The repo's `SQL/` folder isn't
  committed and can't rebuild the schema: replaying it in order fails, because the core
  tables were never created there.
- `helpers.ts` `as(pool, caller, fn)` runs a transaction the way PostgREST runs a request:
  `set_config('role', …)` plus the JWT claims in `request.jwt.claims`. So `player(userId)`
  behaves like a signed-in supabase-js client, `anon` like the anon key, and `serviceRole`
  like the server key.

Not in the baseline: triggers (for example `on_auth_user_created` on `auth.users`, and the
`quiz_broadcast` trigger from the 2026-10-09 live-broadcast migration). Also, PostgREST and
GoTrue don't run here, because the tests call SQL directly.

## Updating the baseline

When a migration changes the live schema, add the same SQL here as a new file that sorts
after the baseline, for example `schema/06-20261020120000_my_change.sql`. Files are applied
in name order. To refresh the baseline itself, take a new read-only catalog dump and replace
`01-…` to `05-…` with it. Check the dump for data and secrets before committing it. The
tests themselves must never connect to the Supabase project.
