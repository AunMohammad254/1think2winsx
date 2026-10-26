#!/usr/bin/env bash
# Runs `bunx playwright <args>` (install, install-deps) with a time limit, retrying a slow or failed try.
#
# These steps normally take 12-120 s, but on some runs apt-get crawls for 10-30 minutes. With no limit
# that used up the job's 30 minutes and the run was cancelled, failing the PR through no fault of its
# own. A fresh attempt usually downloads at normal speed.
set -u

LIMIT_SECONDS=300
ATTEMPTS=3

for attempt in $(seq 1 "$ATTEMPTS"); do
  # timeout signals its whole process group, so apt-get and dpkg stop with bunx
  if timeout --kill-after=15 "$LIMIT_SECONDS" bunx playwright "$@"; then
    exit 0
  fi
  echo "::warning::playwright $* failed or ran past ${LIMIT_SECONDS}s (attempt $attempt of $ATTEMPTS)"
  # Kill any lingering apt-get or dpkg processes that might be holding the lock
  sudo killall -9 apt-get apt dpkg || true
  # A stopped dpkg leaves packages half-configured, which makes the next apt-get refuse to run
  sudo dpkg --configure -a || true
  sleep 10
done

echo "::error::playwright $* failed $ATTEMPTS times"
exit 1
