#!/bin/sh
# TrueCourse v0.4 upgrade helper.
#
# Older TrueCourse releases (<= v0.3.x) shipped an embedded Postgres server
# that was spawned on first analyze and left running as a background process.
# v0.4 replaces the database with a file-based store (`<repo>/.truecourse/`),
# so those Postgres processes are now orphans. Run this script once after
# upgrading to stop them; it's a no-op on machines that never ran an old
# version.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/truecourse-ai/truecourse/main/scripts/stop-legacy-postgres.sh | sh
#
# Or download and run locally:
#   sh scripts/stop-legacy-postgres.sh
set -e

pids=$(pgrep -f 'postgres.*\.truecourse/data' || true)
if [ -z "$pids" ]; then
  echo "No legacy TrueCourse Postgres processes running."
  exit 0
fi

echo "Stopping TrueCourse v0.3.x Postgres (PIDs: $pids)"
# shellcheck disable=SC2086
kill -TERM $pids
sleep 2

still=$(pgrep -f 'postgres.*\.truecourse/data' || true)
if [ -n "$still" ]; then
  echo "Force-killing stragglers: $still"
  # shellcheck disable=SC2086
  kill -KILL $still
fi
echo "Done. Re-run 'truecourse analyze' to populate the new file-based store."
