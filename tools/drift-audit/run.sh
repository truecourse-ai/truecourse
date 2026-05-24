#!/usr/bin/env bash
# Drift audit runner — pairs a spec doc with the repo's source code and
# asks Opus to enumerate drifts. Writes one JSON file per run.
#
# Usage:
#   tools/drift-audit/run.sh <repo-root> <spec-doc> [<code-root>]
#
# - <repo-root>  absolute path to the repo to audit
# - <spec-doc>   path (relative to repo-root) of the spec to audit against
# - <code-root>  optional path (relative to repo-root) under which to
#                walk for source files. Defaults to the repo root itself.
#
# Auto-discovers source files under <code-root>:
#   include: .ts, .tsx, .js, .jsx, .mjs, .cjs, .py, .go, .java, .rb, .rs, .sql
#   exclude: node_modules, dist, build, .truecourse, .git, .next, coverage,
#            .cache, vendor, target, *.test.*, *.spec.*, *.d.ts
#
# Example:
#   tools/drift-audit/run.sh /Users/me/repos/signal7/Compliance docs/PRDs/backend_PRDv2.md backend/src
#
# Output: <repo-root>/drift-audit-<spec-basename>-<date>.json
#
# Requires: `claude` CLI on PATH.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <repo-root> <spec-doc> [<code-root>]" >&2
  exit 1
fi

REPO_ROOT="$1"
SPEC_DOC="$2"
CODE_ROOT_REL="${3:-.}"

if [[ ! -d "$REPO_ROOT" ]]; then
  echo "error: repo-root $REPO_ROOT does not exist" >&2
  exit 1
fi

cd "$REPO_ROOT"

if [[ ! -f "$SPEC_DOC" ]]; then
  echo "error: spec doc $REPO_ROOT/$SPEC_DOC not found" >&2
  exit 1
fi

if [[ ! -d "$CODE_ROOT_REL" ]]; then
  echo "error: code-root $REPO_ROOT/$CODE_ROOT_REL is not a directory" >&2
  exit 1
fi

# Resolve this script's directory so we can find the sibling system-prompt file.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEM_PROMPT_FILE="$SCRIPT_DIR/../../docs/contracts/drift-audit-system-prompt.txt"

if [[ ! -f "$SYSTEM_PROMPT_FILE" ]]; then
  echo "error: system prompt not found at $SYSTEM_PROMPT_FILE" >&2
  exit 1
fi

# ---- Discover source files ----
# find honors the exclusions inline so we don't traverse junk dirs.
mapfile -t SOURCE_FILES < <(
  find "$CODE_ROOT_REL" \
    \( -type d \( \
        -name node_modules -o \
        -name dist -o \
        -name build -o \
        -name .truecourse -o \
        -name .git -o \
        -name .next -o \
        -name coverage -o \
        -name .cache -o \
        -name vendor -o \
        -name target -o \
        -name __pycache__ \
      \) -prune \) -o \
    \( -type f \( \
        -name '*.ts' -o \
        -name '*.tsx' -o \
        -name '*.js' -o \
        -name '*.jsx' -o \
        -name '*.mjs' -o \
        -name '*.cjs' -o \
        -name '*.py' -o \
        -name '*.go' -o \
        -name '*.java' -o \
        -name '*.rb' -o \
        -name '*.rs' -o \
        -name '*.sql' \
      \) \
      ! -name '*.test.*' \
      ! -name '*.spec.*' \
      ! -name '*.d.ts' \
      -print \) | sort
)

if [[ ${#SOURCE_FILES[@]} -eq 0 ]]; then
  echo "error: no source files found under $REPO_ROOT/$CODE_ROOT_REL" >&2
  exit 1
fi

# ---- Build the user prompt ----
USER_PROMPT_FILE="$(mktemp -t drift-audit-XXXXXX)"
trap 'rm -f "$USER_PROMPT_FILE"' EXIT

{
  echo "SPEC DOCUMENT(S):"
  echo
  echo "--- $SPEC_DOC ---"
  cat "$SPEC_DOC"
  echo "--- end ---"
  echo
  echo "CODE:"
  echo
  for file in "${SOURCE_FILES[@]}"; do
    echo "--- $file ---"
    cat "$file"
    echo "--- end ---"
    echo
  done
  echo "Audit the code against the spec. Return the JSON object as specified."
} > "$USER_PROMPT_FILE"

INPUT_BYTES=$(wc -c < "$USER_PROMPT_FILE")
echo "[drift-audit] files: ${#SOURCE_FILES[@]} · input: $INPUT_BYTES bytes (~$((INPUT_BYTES / 4)) tokens)" >&2

# Soft warning if we're pushing close to Opus's context limit.
if [[ $INPUT_BYTES -gt 600000 ]]; then
  echo "[drift-audit] WARNING: input >600KB — may exceed model context. Narrow with the optional <code-root> arg." >&2
fi

# ---- Output file ----
SPEC_BASENAME=$(basename "$SPEC_DOC" .md)
DATE=$(date +%Y-%m-%d)
OUT_FILE="$REPO_ROOT/drift-audit-${SPEC_BASENAME}-${DATE}.json"

echo "[drift-audit] running claude (opus); output → $OUT_FILE" >&2

# Heartbeat — claude -p with --output-format json is silent until done,
# which can be a few minutes. Print elapsed time every 15s so the user
# knows it's alive.
(
  start=$SECONDS
  while sleep 15; do
    elapsed=$((SECONDS - start))
    printf "[drift-audit] still running… %dm%02ds elapsed\n" $((elapsed / 60)) $((elapsed % 60)) >&2
  done
) &
HEARTBEAT_PID=$!
trap 'kill $HEARTBEAT_PID 2>/dev/null; rm -f "$USER_PROMPT_FILE"' EXIT

T0=$SECONDS
claude -p "$(cat "$USER_PROMPT_FILE")" \
  --model opus \
  --append-system-prompt "$(cat "$SYSTEM_PROMPT_FILE")" \
  --output-format json \
  > "$OUT_FILE"
TOTAL=$((SECONDS - T0))

kill $HEARTBEAT_PID 2>/dev/null || true
wait $HEARTBEAT_PID 2>/dev/null || true

# Quick sanity report on the result so the user sees something useful
# before they go run jq.
if jq -e '.result' "$OUT_FILE" >/dev/null 2>&1; then
  FINDING_COUNT=$(jq -r '.result | fromjson | .findings | length' "$OUT_FILE" 2>/dev/null || echo "?")
  printf "[drift-audit] done in %dm%02ds · %s findings · output: %s\n" \
    $((TOTAL / 60)) $((TOTAL % 60)) "$FINDING_COUNT" "$OUT_FILE" >&2
else
  printf "[drift-audit] done in %dm%02ds · output: %s (could not parse — inspect manually)\n" \
    $((TOTAL / 60)) $((TOTAL % 60)) "$OUT_FILE" >&2
fi

echo "[drift-audit] view findings: jq '.result | fromjson' $OUT_FILE" >&2
