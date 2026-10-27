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
- Admin claim decisions: `update_claim_status` approves, rejects (refund and restock) or marks a claim
  delivered only along the admin screen's steps, refunds once under concurrent rejects, has a single
  overload, and only the service role can call it
- Daily email limit: `reserve_email_quota` stops registrations and newsletters at 279 and the
  password, account and support emails at 299 over a rolling 24 hours, gives the exact retry time,
  lets exactly the cap through under concurrent requests, and reads its numbers from `AppSettings`;
  `release_email_quota`, `email_quota_status`, and that only the service role can reach any of it
- Protected answers and winners (migration `06-20261024120000`): a question players answered can't be
  deleted or get new options (its wording and status can change, and deleting the whole quiz still
  works), and a prize won in a quiz can't be deleted
- Email services: the `EmailLog` table's checks and 90-day pruning, `record_email_event` never taking
  a result back, `email_log_totals`, the daily limit following `AppSettings.email_provider` (Brevo
  299, SES 199 by default), the guard that stops on a changed `email_quota_settings()`, and that
  only the service role can reach any of it
- Points pool paid as points each (migration `06-20261027120000`): the earliest scorers filling the
  places get the same points, the pool caps how many are paid, the preview matches the settle, the
  refusals (no percentage, more than the pool, below 0), the older seven-argument call keeps the random
  split through the single `settle_quiz`, and the guard stops a second run
- Signing up again (migration `06-20261025120000`): every foreign key to `"User"(id)` cascades an id
  change, so production's `on_auth_user_created` trigger hands a returning player their old `"User"`
  row (with its notifications) and they can lock in answers; the migration's repair of accounts left
  without a row, and that it never takes a row from a live account

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
