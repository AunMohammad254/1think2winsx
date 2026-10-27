#!/usr/bin/env bash
# Runs `bunx playwright <args>` (install, install-deps) with a time limit, retrying a slow or failed try.
#
# These steps normally take 12-120 s, but on some runs apt-get crawls for 10-30 minutes. With no limit
# that used up the job's 30 minutes and the run was cancelled, failing the PR through no fault of its
# own. The crawl sticks to one runner's path to the Azure apt mirror (other jobs fetched the same
# packages at 10+ MB/s that minute, while one runner crawled at 40 KB/s on all three tries), so
# retries skip that mirror.
#
# Playwright runs apt-get through sudo, so timeout's signal stops bunx but not apt-get: the runner
# user may not signal a root process, and sudo doesn't pass on a signal sent from its own process
# group (it expects the command got it too). The timed-out apt-get kept the dpkg lock, so every retry
# failed at once on it. Before a retry we stop it ourselves and wait for the lock to be let go.
set -u

LIMIT_SECONDS=300
ATTEMPTS=3

running() { pgrep -x 'apt-get|dpkg' >/dev/null; }

# Waits up to $1 seconds for every apt-get and dpkg to exit; a process's dpkg locks go with it
wait_for_apt() {
  local waited=0
  while running; do
    [ "$waited" -ge "$1" ] && return 1
    sleep 2
    waited=$((waited + 2))
  done
}

stop_leftover_apt() {
  # apt-get is the part that crawls (downloading); a dpkg it already started gets time to finish
  sudo pkill -x apt-get
  wait_for_apt 60 && return
  echo "::warning::apt-get/dpkg still running 60s after SIGTERM, killing them"
  sudo pkill -KILL -x 'apt-get|dpkg'
  wait_for_apt 20 || echo "::warning::apt-get/dpkg still running, the next attempt may find the dpkg lock held"
}

# The runner image lists its apt mirrors here, Azure first, then archive.ubuntu.com and
# security.ubuntu.com. apt only moves past a mirror when a download fails, never when it crawls.
skip_azure_mirror() {
  local list=/etc/apt/apt-mirrors.txt
  # Leave the list alone unless it has the Azure mirror and another one to fall back to
  if grep -q 'azure\.archive' "$list" 2>/dev/null && grep -v 'azure\.archive' "$list" | grep -q .; then
    sudo sed -i '/azure\.archive/d' "$list"
    echo "Retrying without the Azure apt mirror: $(tr '\n' ' ' < "$list")"
  fi
}

for attempt in $(seq 1 "$ATTEMPTS"); do
  if timeout --kill-after=15 "$LIMIT_SECONDS" bunx playwright "$@"; then
    exit 0
  fi
  echo "::warning::playwright $* failed or ran past ${LIMIT_SECONDS}s (attempt $attempt of $ATTEMPTS)"
  [ "$attempt" -lt "$ATTEMPTS" ] || break
  stop_leftover_apt
  # A stopped dpkg leaves packages half-configured, which makes the next apt-get refuse to run
  sudo dpkg --configure -a || true
  skip_azure_mirror
  sleep 10
done

echo "::error::playwright $* failed $ATTEMPTS times"
exit 1
