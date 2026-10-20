#!/bin/sh
# Dumps the old Supabase project for deploy/SUPABASE_REGION_MOVE.md. Runs INSIDE the postgres:17-alpine image:
#
#   docker run --rm --env-file old.env -v "<repo>\deploy\supabase-move:/tools:ro" -v "${PWD}:/out" `
#     postgres:17-alpine sh /tools/dump-all.sh structure      # step 2.5: roles.sql, schema.sql, history_schema.sql
#   ... sh /tools/dump-all.sh data                             # step 3.2: data.sql, history_data.sql
#
# old.env holds PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (and PGSSLMODE=require) for the old project's
# Session pooler. It contains the database password: keep it outside the repo.
#
# Same pg_dump flags and filters as `supabase db dump` (supabase/cli, MIT licence,
# apps/cli-go/pkg/migration/scripts/dump_{role,schema,data}.sh and dump.go), so no Supabase CLI download is
# needed. One change, found in the 2026-10-20 rehearsal: roles.sql would re-set a setting on Supabase's own
# superuser (supabase_admin), which the postgres role can't do, so that line is commented out.
set -eu
set -o pipefail

out=/out
internal='information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault'
data_excluded='information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor'
reserved_roles='anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin'
allowed_configs='pgaudit.*|pgrst.*|session_replication_role|statement_timeout|track_io_timing'

# $1 = excluded schemas ('' when --schema is used)
schema_filter() {
  sed -E 's/^\\(un)?restrict .*$/-- &/' \
  | sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' \
  | sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' \
  | sed -E 's/^CREATE SEQUENCE "/CREATE SEQUENCE IF NOT EXISTS "/' \
  | sed -E 's/^CREATE VIEW "/CREATE OR REPLACE VIEW "/' \
  | sed -E 's/^CREATE FUNCTION "/CREATE OR REPLACE FUNCTION "/' \
  | sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/' \
  | sed -E 's/^CREATE PUBLICATION "supabase_realtime/-- &/' \
  | sed -E 's/^CREATE EVENT TRIGGER /-- &/' \
  | sed -E 's/^         WHEN TAG IN /-- &/' \
  | sed -E 's/^   EXECUTE FUNCTION /-- &/' \
  | sed -E 's/^ALTER EVENT TRIGGER /-- &/' \
  | sed -E 's/^ALTER PUBLICATION "supabase_realtime_/-- &/' \
  | sed -E 's/^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /-- &/' \
  | sed -E 's/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/-- &/' \
  | sed -E 's/^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/-- &/' \
  | sed -E "s/^GRANT (.+) ON (.+) \"($1)\"/-- &/" \
  | sed -E "s/^REVOKE (.+) ON (.+) \"($1)\"/-- &/" \
  | sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/\1;/' \
  | sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/\1;/' \
  | sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/\1;/' \
  | sed -E 's/^COMMENT ON EXTENSION (.+)/-- &/' \
  | sed -E 's/^CREATE POLICY "cron_job_/-- &/' \
  | sed -E 's/^ALTER TABLE "cron"/-- &/' \
  | sed -E 's/^SET transaction_timeout = 0;/-- &/' \
  | sed -E '/^--/d'
}

dump_structure() {
  pg_dumpall --roles-only --role postgres --quote-all-identifier --no-role-passwords --no-comments \
  | sed -E 's/^\\(un)?restrict .*$/-- &/' \
  | sed -E "s/^CREATE ROLE \"($reserved_roles)\"/-- &/" \
  | sed -E "s/^ALTER ROLE \"($reserved_roles)\"/-- &/" \
  | sed -E 's/ (NOSUPERUSER|NOREPLICATION)//g' \
  | sed -E "s/^-- (.* SET \"($allowed_configs)\" .*)/\1/" \
  | sed -E "s/GRANT \".*\" TO \"($reserved_roles)\"/-- &/" \
  | sed -E '/^--/d' \
  | sed -E 's/^ALTER ROLE "supabase_admin" .*/-- (Supabase manages this role) &/' \
  | uniq > "$out/roles.sql"
  echo 'RESET ALL;' >> "$out/roles.sql"

  pg_dump --schema-only --quote-all-identifier --role postgres --exclude-schema "$internal" \
  | schema_filter "$internal" > "$out/schema.sql"

  pg_dump --schema-only --quote-all-identifier --role postgres --exclude-schema '' --schema=supabase_migrations \
  | schema_filter '' > "$out/history_schema.sql"
}

# $1 = file, then pg_dump selection flags
dump_data_file() {
  file=$1; shift
  {
    printf 'SET session_replication_role = replica;\n\n'
    pg_dump --data-only --quote-all-identifier --role postgres \
      --exclude-table '"auth"."schema_migrations"' --exclude-table '"storage"."migrations"' \
      --exclude-table '"supabase_functions"."migrations"' "$@" \
    | sed -E 's/^\\(un)?restrict .*$/-- &/'
    echo 'RESET ALL;'
  } > "$out/$file"
}

dump_data() {
  # Storage's tables are left out: the storage copy script (step 2.7/3.5) recreates buckets and file records
  dump_data_file data.sql --exclude-schema "$data_excluded" --schema '*' \
    --exclude-table '"storage"."buckets"' --exclude-table '"storage"."objects"' \
    --exclude-table '"storage"."buckets_vectors"' --exclude-table '"storage"."vector_indexes"'
  dump_data_file history_data.sql --exclude-schema '' --schema supabase_migrations

  # truncate.sql empties exactly the tables these files fill, so the load can be repeated (trial copy in step 2.8,
  # final copy in step 3.3). It only runs where before-schema.sql left its marker, i.e. never on the old project.
  {
    echo "do \$\$ begin"
    echo "  if to_regnamespace('_move_target') is null then"
    echo "    raise exception 'Not the new project (no _move_target schema): refusing to empty its tables';"
    echo "  end if;"
    echo "end \$\$;"
    printf 'TRUNCATE TABLE\n  %s;\n' "$(grep -h '^COPY ' "$out/data.sql" "$out/history_data.sql" | sed -E 's/^COPY ([^ ]+) .*/\1/' | sed ':a;N;$!ba;s/\n/,\n  /g')"
  } > "$out/truncate.sql"
}

case "${1:-}" in
  structure) dump_structure ;;
  data) dump_data ;;
  *) echo "usage: dump-all.sh structure|data" >&2; exit 2 ;;
esac
ls -l "$out"/*.sql
