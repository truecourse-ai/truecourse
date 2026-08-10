#!/usr/bin/env bash
# Materialize the reference fixtures into ~/truecourse-fixtures and git-init
# each one. The flows assert structure and git-tracked-ness, never commit
# hashes, so a locally initialized history is equivalent to the original.
#
# TEMPORARY convenience so a teammate inherits working fixture instances
# instead of re-minting them (the guard-subject mint alone costs real LLM
# spend). Slated to move out of the repo once the team settles fixture
# distribution.
#
# After running: register the instances (Dependencies tab or the overlay):
#   analysis-target        → ~/truecourse-fixtures/sample-js-project-negative
#   spec-docs-project      → ~/truecourse-fixtures/sample-scheduling-saas
#   guard-subject-project  → ~/truecourse-fixtures/guard-subject
#   llms-txt-site          → llms-txt-url:        http://127.0.0.1:4173/llms.txt
#                            second-llms-txt-url: http://127.0.0.1:4173/ops/llms.txt
#                            no-llms-txt-url:     http://127.0.0.1:4173/empty/llms.txt
#     (serve with: python3 -m http.server 4173 -d ~/truecourse-fixtures/llms-docs-site)
#   claude-login / llm-api-credentials → your own accounts, never shared.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/truecourse-fixtures"
mkdir -p "$DST"

materialize() {
  local name="$1"
  local dst="$DST/$name"
  if [ -e "$dst" ]; then
    echo "skip $name — $dst already exists (delete it first to refresh)"
    return
  fi
  rsync -a "$SRC/$name/" "$dst/"
  if [ "$name" != "llms-docs-site" ]; then
    git -C "$dst" init -q
    git -C "$dst" config user.name "Fixture"
    git -C "$dst" config user.email "fixture@truecourse.dev"
    # Each fixture's own .gitignore (if any) governs what gets committed —
    # derived stores stay on disk but out of history, exactly as minted.
    git -C "$dst" add -A
    git -C "$dst" commit -qm "materialized from reference/fixtures"
    echo "ready $name (git-initialized)"
  else
    echo "ready $name (static site — no git needed)"
  fi
}

materialize sample-js-project-negative
materialize sample-scheduling-saas
materialize llms-docs-site
materialize guard-subject
if [ -d "$SRC/api-subject" ]; then materialize api-subject; fi

echo
echo "Done. Register the instances (see the header of this script), start the"
echo "llms site server, and run: node tools/cli/dist/index.js guard run"
