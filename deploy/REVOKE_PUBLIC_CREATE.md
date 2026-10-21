# Stop every role from creating objects in schema `public`

**Status: applied to production on 2026-10-21** (the Mumbai project `eclivawqhdovsndlngfo`, migration
`20261021113231 revoke_public_create_on_public_schema`), with the owner's approval. Afterwards the `public` schema
ACL was `postgres=UC, =U, anon=U, authenticated=U, service_role=U`, and the site's API answered normally.

## Why

Today every database role can create tables, views and functions in schema `public`, including
`anon`, the role behind the public API key. Someone who can create objects there can plant one
that shadows a name the app or another role looks up through `search_path`. The cause is the
schema's access list (ACL), read on 2026-10-20:

```
{postgres=UC/postgres,=UC/postgres,authenticated=U/postgres}
```

`=UC` means PUBLIC (every role) has USAGE and CREATE. That was the default before Postgres 15,
and the project kept it through its upgrades. The rest of production is already locked down.

## What changes

- PUBLIC loses CREATE on schema `public`. It keeps USAGE, so nothing that reads data changes.
- `anon` and `service_role` get USAGE on the schema by name. Today they have it only through
  PUBLIC, and the server key and anon reads depend on it. A new Supabase project grants it the
  same way.
- `postgres` owns the schema, so it can still create objects there. Migrations and the SQL
  editor run as `postgres`, and the `refresh-leaderboard` cron job runs as `postgres` too.

Checked read-only on production on 2026-10-20:

- Every table, function and type in `public` is owned by `postgres`.
- No function in `public` or `private_hardened` runs DDL.
- `pg_stat_statements` shows DDL only from `postgres` and `supabase_admin`, a superuser that
  this change doesn't affect.
- There are no extensions in `public`.
- The app (`src/`) runs no DDL and talks to the database only through supabase-js.

Tested locally: `db-tests/schema-privileges.test.ts`, with the migration in
`db-tests/schema/06-20261020120000_revoke_public_create_on_public_schema.sql`.

## Run after approval

In the Supabase Dashboard → SQL Editor for project `snhgaklxawthpihjiagh` (it runs as `postgres`):

```sql
grant usage on schema public to anon, authenticated, service_role;
revoke create on schema public from public;
```

Then check it:

```sql
select nspacl::text = '{postgres=UC/postgres,=U/postgres,authenticated=U/postgres,anon=U/postgres,service_role=U/postgres}' as acl_ok,
       not has_schema_privilege('anon', 'public', 'CREATE')
         and not has_schema_privilege('authenticated', 'public', 'CREATE')
         and not has_schema_privilege('service_role', 'public', 'CREATE') as api_roles_cannot_create,
       has_schema_privilege('anon', 'public', 'USAGE')
         and has_schema_privilege('authenticated', 'public', 'USAGE')
         and has_schema_privilege('service_role', 'public', 'USAGE') as api_roles_keep_usage
from pg_namespace where nspname = 'public';
```

All three columns should be `true`. Then load the site signed out and signed in. Afterwards,
change the first line of the `06-…` file to say when it was applied, as the other `06-` files do.

To undo it, run `grant create on schema public to public;`. The USAGE grants can stay.

If the Tokyo → Mumbai database move happens first, run this on the new project instead, because
the move copies permissions exactly as they are.
