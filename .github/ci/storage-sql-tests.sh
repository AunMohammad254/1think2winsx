#!/usr/bin/env bash
# Runs the storage access-rule checks in supabase/tests (receipts and media buckets) against a
# throwaway Postgres 17 container. Never a Supabase project. Any failed check raises, psql stops at
# the first error and this script exits non-zero.
#
#   bash .github/ci/storage-sql-tests.sh
#
# The order is the one in the test files' headers, in one psql session: the shim (roles, auth.uid(),
# the storage schema), the media migration and its test, then the receipts migration and its test.
#
# Its own container, not the db-tests one: both shims create the cluster-wide roles anon,
# authenticated and service_role, so they cannot share a Postgres server.
set -euo pipefail

# Git Bash on Windows rewrites arguments like /sql/x.sql into Windows paths; this turns that off
export MSYS_NO_PATHCONV=1

IMAGE=postgres:17-alpine
NAME="t2w-storage-sql-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null

# Over TCP: the image first runs a setup server on the socket only, then restarts into the real one
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U postgres; then ready=1; break; fi
  sleep 1
done
if [ "${ready:-0}" != 1 ]; then
  echo "::error::Postgres did not start within 60s"
  docker logs "$NAME" | tail -20
  exit 1
fi

docker cp supabase "$NAME":/sql >/dev/null

docker exec "$NAME" psql -U postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 --quiet \
  -f /sql/tests/storage-shim.sql \
  -f /sql/migrations/20261018150000_media_storage.sql \
  -f /sql/tests/media_storage.test.sql \
  -f /sql/migrations/20261018160000_receipts_bucket.sql \
  -f /sql/tests/receipts_storage.test.sql

echo "Storage SQL tests passed (media_storage, receipts_storage)"
