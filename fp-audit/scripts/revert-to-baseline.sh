#!/bin/bash
# Revert the fp-audit-pipeline branch to baseline before re-running stage 3.
# Keeps:
#   - Pipeline infra commits (SKILLs, scripts, .gitignore)
#   - js-positive harness extension (16a7261)
#   - Negative fixture data-layer-external addition (2777988)
#   - fp.jsonl classification data (class, why, mode, shape_sig, negative_fixture_path)
# Reverts:
#   - Stage 5 visitor edits (uncommitted)
#   - Stage 3 positive fixture additions (commits 83b8da7 + a978ab2)
#   - fp.jsonl positive-fixture status fields

set -euo pipefail

WORKTREE="/Users/musheghgevorgyan/repos/truecourse/.claude/worktrees/fp-audit-pipeline"
cd "$WORKTREE"

echo "==> 1. Revert stage 5 visitor edits (uncommitted)"
git checkout -- packages/analyzer/
echo "    reverted $(git diff --stat packages/analyzer/ 2>/dev/null | wc -l | tr -d ' ') files in packages/analyzer/"

echo "==> 2. Remove stage 5 helper scripts and leftover test"
rm -f fp-audit/scripts/stage5-finalize.mjs
rm -f fp-audit/scripts/stage5-mark-status-batch.mjs
rm -f fp-audit/scripts/stage5-mark-status.mjs
rm -f tests/analyzer/locate-uc.test.ts

echo "==> 3. Restore positive fixture project to main baseline"
git checkout main -- tests/fixtures/sample-js-project-positive/
# Also clean any untracked new files in the positive fixture that weren't on main
git clean -fd tests/fixtures/sample-js-project-positive/

echo "==> 4. Reset fp.jsonl positive- AND negative-fixture fields (keep classification)"
node -e "
const fs = require('fs');
const path = 'fp-audit/state/fp.jsonl';
const lines = fs.readFileSync(path, 'utf-8').trim().split('\n');
let reset = 0;
const out = lines.map(line => {
  const r = JSON.parse(line);
  if (r.class === 'FP') {
    if (r.positive_fixture_path || r.negative_fixture_path || r.status !== 'unconfirmed') reset++;
    r.status = 'unconfirmed';
    delete r.positive_fixture_path;
    delete r.negative_fixture_path;
    delete r.fixed_by_commit;
  }
  return JSON.stringify(r);
});
const tmp = path + '.tmp';
fs.writeFileSync(tmp, out.join('\n') + '\n');
fs.renameSync(tmp, path);
console.log('    reset', reset, 'FP rows');
"

echo "==> 5. Clean up stage 3 + 4 scratch artifacts"
rm -rf fp-audit/state/positive-scratch
rm -rf fp-audit/state/negative-scratch
rm -f fp-audit/state/positive-scratch-tier1.json
rm -f fp-audit/state/positive-scratch-tier2.json
rm -f fp-audit/state/positive-scratch-tier2-arch.json
rm -f fp-audit/state/positive-rule-outcomes.json
rm -f fp-audit/state/positive-apply-log.json
rm -f fp-audit/state/positive-dispatch.json
rm -f fp-audit/state/positive-rule-inputs.json
rm -f fp-audit/state/negative-warnings.jsonl
rm -rf fp-audit/state/positive-batches
rm -rf fp-audit/state/positive-inputs

echo "==> 6. Rebuild dist to restore baseline analyzer"
pnpm build:dist

echo ""
echo "✓ Reverted. Branch state:"
git status --short
echo ""
echo "Next: claude --model opus --dangerously-skip-permissions"
echo "      Read fp-audit/agents/03-positive-fixture/SKILL.md and run it."
