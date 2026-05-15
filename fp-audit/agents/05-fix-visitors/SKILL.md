---
name: fp-audit-05-fix-visitors
description: For each rule with positive+negative fixtures wired up, dispatch ONE sub-agent at a time that edits the rule's visitor until every positive fixture passes AND every negative fixture still fires. Orchestrator commits per rule, so progress is durable across interruptions, resets, or crashes. No parallel waves, no shared-tree contamination.
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-fix/SKILL.md` (log to `fp-audit/state/decisions.jsonl`, continue per the table). Forbidden: "Should I proceed?", "Please clarify".

# Design principles

These principles are load-bearing — earlier designs violated them and lost ~half the work after 14 hours:

1. **Successful edits are persisted via git commit, not left in the working tree.** The working tree is never authoritative state.
2. **One rule at a time, sequential dispatch.** No parallel sub-agents in a shared working tree. Parallelism trades reliability for marginal throughput at this stage.
3. **Sub-agent never runs git commands.** Only the orchestrator commits, reverts, or stashes. Sub-agents only edit files.
4. **Patch capture is a safety net, not the primary mechanism.** Each successful sub-agent's diff is also captured to `fp-audit/state/patches/<rule>.patch` (gitignored). If the orchestrator crashes between sub-agent return and commit, the patch survives.
5. **Resumability is via fp.jsonl status + git log.** Re-running the SKILL skips rules already at `status: "fixed"` or `"surviving"`, and rules whose commit message matches `^stage5: fix <rule>$`.

# Inputs

- `fp-audit/state/fp.jsonl` — global FP ledger
- `fp-audit/state/rule-briefs.json` — optional, hint only
- `tests/analyzer/js-positive.test.ts` — positive fixture contract (rule X must fire 0× after fix)
- `tests/analyzer/js-negative.test.ts` — negative fixture contract (rule X's `// VIOLATION:` markers must still fire)
- `tests/fixtures/sample-js-project-positive/` — positive fixtures from stage 3
- `tests/fixtures/sample-js-project-negative/` — negative fixtures from stage 4

# Outputs

- Edits to `packages/analyzer/src/rules/<category>/...`, **committed one rule per commit** with message format `stage5: fix <rule-key>` (e.g. `stage5: fix code-quality/deterministic/magic-string`).
- `fp-audit/state/fix-report.jsonl` — one JSON line per rule: `{rule, outcome, edited_files, iterations, commit_sha, final_failures}`
- `fp-audit/state/patches/<rule_safe>.patch` — backup of each successful sub-agent's diff (gitignored; survives any reset)
- `fp-audit/state/fp.jsonl` row status transitions:
  - `fixtures-ready` → `fix-attempted` (orchestrator stamps before dispatch)
  - `fix-attempted` → `fixed` (re-analyze step 6 confirms documenso row no longer fires)
  - `fix-attempted` → `surviving` (re-analyze finds row still fires)
  - `fix-attempted` → `fixtures-ready` (sub-agent reported failed; rolled back)

# Preconditions

A rule is **eligible to fix** only when:
1. ≥1 row has `class === "FP"` AND `status === "fixtures-ready"`
2. Every such row has non-null `positive_fixture_path`
3. The rule has non-null `negative_fixture_path` on ≥1 of its FP rows

Skip rules failing these gates. Log to `decisions.jsonl` with the missing piece named.

# Sub-agent model

**Opus** (default). Visitor edits require AST literacy + non-trivial reasoning about what guard distinguishes the FP shape from the TP shape.

# Steps

## 1. Setup

```bash
mkdir -p fp-audit/state/patches
test -f fp-audit/state/fix-report.jsonl || touch fp-audit/state/fix-report.jsonl
```

Confirm the working tree is clean before starting (`git status --porcelain`). If not, ABORT and surface the dirty state — the orchestrator must start from a known baseline.

## 2. Build eligible rule list

Read `fp.jsonl`. For each eligible rule (see Preconditions), collect:
- `positive_tests`: distinct `positive_fixture_path` values across the rule's FP rows
- `negative_tests`: distinct `negative_fixture_path` values across the rule's FP rows
- `suggested_predicate` from `rule-briefs.json` (hint, optional)

Skip rules whose `stage5: fix <rule>` commit already exists in `git log --grep` (resumability). Skip rules where every member FP row is already at status `fixed` or `surviving`.

## 3. Pre-dispatch summary

```
── stage 5 dispatch plan ────────────────────────────────
eligible rules:           <R>
already fixed (skipped):  <S>
remaining to dispatch:    <D>
dispatch model:           opus
parallelism:              SEQUENTIAL (one rule at a time)
estimated time:           ~<D × 6 minutes>
```

## 4. Per-rule loop

For each remaining rule:

### 4a. Mark in-flight

Update every member FP row's status from `fixtures-ready` → `fix-attempted`. Atomic-write fp.jsonl.

### 4b. Verify baseline

Before dispatching, sanity-check:
- `pnpm vitest run tests/analyzer/js-positive.test.ts 2>&1 | grep -c '<rule>'` returns N > 0 (rule currently fires in positive fixture — there's something to fix)
- `pnpm vitest run tests/analyzer/js-negative.test.ts -t 'finds violations for each expected marker'` passes for this rule (TP marker currently fires)

If either fails, the fixture contract is broken for this rule. Log to `decisions.jsonl` with `reason: "broken-contract-pre-dispatch"`, revert the rule's rows to `fixtures-ready`, continue with next rule.

### 4c. Dispatch ONE sub-agent

Use the prompt template below. Substitute the rule's `{{positive_tests}}`, `{{negative_tests}}`, `{{suggested_predicate}}`, and `{{report_path}}` (which is `fp-audit/state/fix-reports/<rule_safe>.json`).

The sub-agent edits visitor files in the working tree and writes a single JSON line to `{{report_path}}`. **The sub-agent NEVER runs git commands.**

### 4d. Validate sub-agent's claim

Parse `{{report_path}}`. If `outcome: "fixed"`:

```bash
# Positive contract: rule no longer fires on positive fixture
pnpm vitest run tests/analyzer/js-positive.test.ts 2>&1 | tee /tmp/pos.txt
positive_count=$(grep -c '<rule>' /tmp/pos.txt || echo 0)

# Negative contract: rule still fires on TP markers
pnpm vitest run tests/analyzer/js-negative.test.ts -t 'finds violations for each expected marker' 2>&1 | tee /tmp/neg.txt
negative_pass=$(grep -c "Rule coverage: .*/.* expected rules detected" /tmp/neg.txt)
neg_missing=$(grep "MISSING VIOLATIONS" /tmp/neg.txt | grep -c '<rule>' || echo 0)
```

Pass criteria: `positive_count == 0` AND `neg_missing == 0`.

### 4e. Commit or revert

If pass criteria met:
```bash
# Capture patch as safety backup
git diff -- packages/analyzer/ > fp-audit/state/patches/<rule_safe>.patch

# Commit
git add packages/analyzer/
git commit -m "stage5: fix <rule-key>"

# Update fix-report.jsonl
echo '{"rule":"<rule>","outcome":"fixed","edited_files":[...],"commit_sha":"$(git rev-parse HEAD)","iterations":<n>}' >> fp-audit/state/fix-report.jsonl
```

If pass criteria NOT met (sub-agent reported fixed but tests don't agree, or sub-agent reported failed):
```bash
# Hard revert all uncommitted edits
git checkout HEAD -- packages/analyzer/

# Revert rule's fp.jsonl rows
# from fix-attempted → fixtures-ready

# Log
echo '{"rule":"<rule>","outcome":"failed","reason":"<short>","iterations":<n>}' >> fp-audit/state/fix-report.jsonl
```

The working tree is now clean again. The next rule starts from a known state.

### 4f. Progress checkpoint every 10 rules

After every 10 rules processed, print:
```
Progress: <X>/<D> rules dispatched
  fixed: <F>, failed: <E>
  last fixed: <rule>
  last failed: <rule>
```

## 5. Rebuild CLI

After all rules processed: `pnpm build:dist`. If build fails, ABORT — the partial state is committed but the analyzer dist is broken. Surface to user.

## 6. Re-analyze each target

For each target in fp.jsonl that contributed FP rows: invoke `fp-audit/agents/01-clone-analyze/SKILL.md` with `repo_url`, `branch`, `label="re-analyze-stage5"`. Agent 01 appends a new snapshot using the rebuilt `dist/cli.mjs`.

## 7. Finalize fp.jsonl status

For each FP row at status `fix-attempted`:
- Build key `(repo, file, line, rule)`
- Look up in latest `_re-analyze-stage5` snapshot
- Not present → `status: "fixed"`, `fixed_by_commit: <last stage5 commit>`
- Present → `status: "surviving"`

Atomic-write fp.jsonl.

## 8. Summary

```
═══ stage 5 complete ═════════════════════════════════
rules attempted:    <D>
  fixed (sub-agent + tests + commit): <F>
  failed:                              <E>

documenso rows after re-analyze:
  fixed:      <K>
  surviving:  <L>

commits: <F> commits, all prefixed "stage5: fix <rule>"
patches: <F> files in fp-audit/state/patches/
```

# Sub-agent prompt template

Substitute `{{rule}}`, `{{positive_tests}}` (list of fixture file paths), `{{negative_tests}}` (list of fixture file paths), `{{suggested_predicate}}`, `{{report_path}}`.

````
You are fixing the visitor for rule `{{rule}}` so that:
  (a) the rule no longer fires on the FP patterns in the positive fixture project
  (b) the rule still fires on the TP patterns in the negative fixture project

Positive check (target: 0 firings of {{rule}}):
  pnpm vitest run tests/analyzer/js-positive.test.ts 2>&1 | tee /tmp/pos.txt
  grep -c '{{rule}}' /tmp/pos.txt

Negative check (target: still detected):
  pnpm vitest run tests/analyzer/js-negative.test.ts -t 'finds violations for each expected marker' 2>&1 | tee /tmp/neg.txt
  Confirm {{rule}} is NOT in any "MISSING VIOLATIONS" output.

Hint from synthesis (not authoritative):
  {{suggested_predicate}}

# Where the visitor lives

`packages/analyzer/src/rules/<category>/visitors/<language>/` or pattern-based
in `packages/analyzer/src/rules/<category>/deterministic.ts`.

Locate it:
  1. grep -rn '{{rule}}' packages/analyzer/src/rules/
  2. Read the visitor function and the helper functions it calls.

# Iteration loop (up to 10 iterations)

Per iteration:
  1. Edit the visitor to add a guard that suppresses the FP shape while
     preserving the TP shape. Be surgical — minimal change, scoped to this
     visitor. Do NOT add broad escape hatches.
  2. Run positive check. Count must reach 0.
  3. Run negative check. {{rule}} must NOT be in MISSING.
  4. If both pass → write report and exit.
  5. Otherwise refine the guard and iterate.

# Writing the report

When done (success or failure), write a SINGLE JSON object to {{report_path}}:

Success:
{
  "rule": "{{rule}}",
  "outcome": "fixed",
  "edited_files": ["packages/analyzer/src/rules/.../foo.ts", ...],
  "iterations": <n>,
  "final_failures": []
}

Failure (after 10 iterations):
{
  "rule": "{{rule}}",
  "outcome": "failed",
  "edited_files": ["packages/analyzer/src/rules/.../foo.ts", ...],
  "iterations": 10,
  "final_failures": ["positive count = N", "negative MISSING: rule was killed"]
}

# Absolute constraints

- NEVER run `git` commands. Not `git checkout`, not `git reset`, not `git stash`,
  not anything. The orchestrator owns version control. If you need to undo an
  edit, just edit the file again with the original content (which you can read
  from the file's pre-edit state — keep a copy if needed).
- NEVER edit test files. Positive/negative tests are immutable contracts.
- NEVER edit unrelated rules' visitors or shared utilities outside this rule's
  visitor unless absolutely necessary; if you do, list the file in edited_files.
- NEVER ask the user a question.
- Do NOT read fp-audit/state/fp.jsonl. The fixture projects are the contract.
- Output ONLY the JSON file at {{report_path}}. No other stdout.

If after 10 iterations the contracts still aren't both green:
  - DO NOT revert your edits. Leave them in the working tree.
  - The orchestrator will revert via `git checkout HEAD -- packages/analyzer/`
    after reading your failed report.
  - Write the "failed" report and exit.

# Why this matters

In previous runs, sub-agents that ran `git checkout` on failure clobbered
sister sub-agents' edits in shared helper files. The orchestrator now ensures
exclusive working-tree access by running you one at a time, and rolls back
your edits on failure itself. You only edit; the orchestrator owns state.
````

# Failure modes

- **Sub-agent reports failed**: orchestrator runs `git checkout HEAD -- packages/analyzer/`, reverts the rule's fp.jsonl rows to `fixtures-ready`. The next rule starts clean.
- **Sub-agent reports fixed but post-validation fails** (positive count > 0 or negative MISSING contains the rule): same as failed — revert + log.
- **`pnpm build:dist` fails after all rules done**: ABORT stage 5. Surface the build error. Inspect recent commits to find the breaking change. The user reverts the specific commit(s) and re-runs from step 5.
- **Re-analyze fails for a target**: log; that target's rows stay at `fix-attempted` for manual re-run.
- **A row whose rule was `fixed` still fires on re-analyze** → `status: "surviving"`. Either the visitor edit missed this instance OR the original classification was wrong. Stage 6 audits.

# Resumability

The orchestrator can be killed and restarted at any point. On restart:
1. Read `fix-report.jsonl` — skip rules already with outcome `fixed` (their commit exists).
2. Read `fp.jsonl` — skip rules whose all member rows are at `fixed`/`surviving`.
3. Re-dispatch only the remaining rules.

A clean working tree is required at startup. If the previous run died mid-rule, the orchestrator runs `git checkout HEAD -- packages/analyzer/` once at the top to discard any abandoned edits before starting the loop.

# Why no parallelism here

Earlier designs ran 5–10 sub-agents per wave in a shared working tree. Two failure modes emerged:
1. A sub-agent's `git checkout` on failure clobbered overlapping edits from successful sister sub-agents in shared helper files (`_helpers.ts`, etc.).
2. Periodic `git reset --hard HEAD` events (cause unidentified) wiped the entire uncommitted working tree, losing all in-flight successes.

Sequential dispatch + per-rule commit eliminates both:
- Only one sub-agent is in the working tree at a time → no contamination
- Each success is committed before the next sub-agent starts → no reset can wipe past wins
- The patches/ directory is a redundant backup → even if the orchestrator crashes between sub-agent return and commit, the patch survives

This is slower in wall-clock time but produces reliable, durable progress that can be measured precisely (one commit = one rule fixed).
