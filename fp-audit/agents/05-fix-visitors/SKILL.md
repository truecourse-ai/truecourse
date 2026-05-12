---
name: fp-audit-05-fix-visitors
description: For each rule with positive+negative fixtures wired up, dispatch a sub-agent that edits the visitor in packages/analyzer/src/rules/ until every positive fixture passes AND every negative fixture still fires. Sub-agent reads ONLY fixtures and visitor source — no fp.jsonl. After visitor changes, orchestrator rebuilds the CLI, re-analyzes affected targets, and updates fp.jsonl status (and stage-6 audit verifies disappearances).
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-fix/SKILL.md` (log to `fp-audit/state/decisions.jsonl`, continue per the table). Forbidden phrasings: "Should I proceed?", "Please clarify", any phrasing that waits for the user. The only allowed abort condition in this stage is `pnpm build:dist` failing — everything else logs and continues.

# Inputs

- `fp-audit/state/fp.jsonl` — global FP ledger (read by orchestrator only, to dispatch and update status)
- `fp-audit/state/rule-briefs.json` — optional, used to give the fix sub-agent the `suggested_predicate` from synthesis as a hint (not authoritative)
- `tests/analyzer/js-positive.test.ts` — contains per-rule `it('no FPs: <rule>', …)` blocks added by stage 3
- `tests/fixtures/sample-js-project-positive/` — positive fixture project with FP patterns appended by stage 3
- `tests/fixtures/sample-js-project-negative/` — negative fixture project with TP patterns (marked `// VIOLATION: <rule>`) appended by stage 4

# Outputs

- Edits to `packages/analyzer/src/rules/<category>/...` visitor files
- `fp-audit/state/fp.jsonl` — for each FP row whose rule was successfully fixed and that no longer fires after re-analyze:
  - `status: "fixed"`
  - `fixed_by_commit: <current HEAD of analyzer repo>`
- For rows whose rule was reported `fixed` but still fire after re-analyze: `status: "surviving"`
- `fp-audit/state/fix-report.jsonl` — one JSON line per rule attempted: `{ rule, outcome, edited_files, iterations, final_failures }`

# Preconditions

A rule is **eligible to fix** only when:
1. It has at least one row with `class === "FP"` and `status === "fixtures-ready"` (or `positive-fixture-ready` if stage 4 hasn't touched the rule yet but a negative test already existed — orchestrator checks).
2. Every such row has a non-null `positive_fixture_path`.
3. The rule has a non-null `negative_fixture_path` on at least one of its FP rows.

Skip rules that fail these gates (log to `decisions.jsonl` with the missing piece named). Do not invent fixtures here — that's stages 3 and 4.

# Steps

1. **Orchestrator reads fp.jsonl** to identify eligible rules. For each eligible rule, collect:
   - `positive_tests`: distinct `positive_fixture_path` values across the rule's FP rows
   - `negative_tests`: distinct `negative_fixture_path` values across the rule's FP rows
   - `suggested_predicate` from `rule-briefs.json` (if present — hint only)

   The sub-agent does NOT read fp.jsonl. The fixtures are the contract.

2. **Pre-dispatch plan:**
   ```
   ── stage 5 dispatch plan ────────────────────────────────
   eligible rules:           <R>
   skipped (missing pieces): <S>
   total sub-agents:         <R>     (one per rule)
   wave size:                10      (fix is heavier — fewer per wave)
   estimated waves:          <ceil(R / 10)>
   ```

3. **Wave-based dispatch.** For each eligible rule, dispatch one sub-agent (Agent tool, `subagent_type=general-purpose`, default model = Opus). Send in waves of ~10 (fix is heavier than classify — keep waves small for vitest CPU sanity). Same loop pattern as earlier stages.

   For each rule in the batch:
   - **Mark the rule's FP rows status = `"fix-attempted"`** before dispatch. Atomic-write fp.jsonl. This is the incremental write — if the orchestrator crashes mid-wave we know which rules were in-flight.
   - Dispatch with the prompt template below.
   - On sub-agent return: read its line in `fix-report.jsonl`:
     - `outcome: "fixed"` → keep status `"fix-attempted"` for now; final `"fixed"` flip waits for re-analyze in step 5.
     - `outcome: "failed"` → revert status of those rows to `"fixtures-ready"` (or `"positive-fixture-ready"` if appropriate). Log the failure. Continue.
   - Atomic-write fp.jsonl after each sub-agent. Do NOT batch end-of-wave.

4. **Rebuild the CLI.** After ALL waves complete: `cd "${ANALYZER_ROOT}" && pnpm build:dist`. If build fails, ABORT stage 5. Surface the build error. Inspect `fix-report.jsonl` for which sub-agent's edits broke it. (User's job — pipeline does not auto-revert.)

5. **Re-analyze each affected target.** For each target that contributed FP rows for any rule whose sub-agent reported `outcome: "fixed"`:
   - Re-invoke `fp-audit/agents/01-clone-analyze/SKILL.md` with `repo_url` + `branch` from that target's `state.json`, `label="re-analyze"`. Agent 01 appends a new snapshot to `<audit>/snapshots/<iso>_re-analyze.json` using the freshly rebuilt `dist/cli.mjs`.

6. **Diff and finalize fp.jsonl status.** For each FP row whose rule was reported `fixed`:
   - Build key: `(repo, file, line, rule)`.
   - Look up matching violation in the latest `_re-analyze` snapshot.
   - No match in new snapshot → `status: "fixed"`, `fixed_by_commit: <git -C ${ANALYZER_ROOT} rev-parse HEAD>`.
   - Still matches → `status: "surviving"`. The visitor edit didn't eliminate this specific instance.
   - Atomic-write fp.jsonl row-by-row (or per-rule batch — either is fine; the row count is small now).

7. **Print summary:**
   ```
   ═══ stage 5 complete ═════════════════════════════════
   rules attempted:      <R>
     fixed (sub-agent):  <F>
     failed:             <X>
   rows after re-analyze:
     fixed:              <K>
     surviving:          <L>
   visitor edits in: packages/analyzer/src/rules/
   ```

   Stage 6 (audit) runs next — verifies the disappearances are really FPs, not silently-suppressed TPs.

# Sub-agent prompt template

Substitute `{{rule}}`, `{{positive_tests}}` (list), `{{negative_tests}}` (list), `{{suggested_predicate}}` (string, may be empty), `{{report_path}}`.

````
You are fixing the visitor for rule `{{rule}}` so that:
  (a) the rule no longer fires on the FP patterns in the positive fixture project
  (b) the rule still fires on the TP patterns in the negative fixture project

Positive check (violations for {{rule}} must be 0 after your fix):
  pnpm vitest run tests/analyzer/js-positive.test.ts 2>&1 | tee /tmp/pos-result.txt
  Then: grep '{{rule}}' /tmp/pos-result.txt | wc -l
  Target: 0 lines matching the rule → no longer fires on the positive fixture.

  The positive fixture has FP patterns for this rule in
  tests/fixtures/sample-js-project-positive/ appended by stage 3.

Negative check (must still pass — {{rule}} TP markers still detected):
  pnpm vitest run tests/analyzer/js-negative.test.ts -t 'finds violations for each expected marker'
  Must PASS. The negative fixture has // VIOLATION: {{rule}} markers that
  your fix must not kill.

Hint from synthesis (not authoritative — use as a starting point):
  {{suggested_predicate}}

DO NOT read fp.jsonl. The fixture projects are the complete contract. If your fix
makes the contract green, the rule is fixed by definition.

# Where the visitor lives

Rule visitors live under `packages/analyzer/src/rules/<category>/visitors/<language>/`
or are pattern-based in `packages/analyzer/src/rules/<category>/deterministic.ts`.

Locate the visitor for `{{rule}}`:
  1. grep -rn '{{rule}}' packages/analyzer/src/rules/
  2. Identify the visitor function or pattern entry that emits this ruleKey.
  3. Read it carefully along with the helper functions it calls.

# Iteration loop

Up to 5 iterations. On each iteration:

  1. Edit the visitor to add a guard that suppresses the FP shape captured by
     the positive fixture project, while preserving the TP shape captured by
     the negative fixture project. The hint above describes the predicate to add.
     Translate it into actual TypeScript/Python AST checks.

     Do NOT add broad escape hatches that weaken detection across many rules.
     The fix must be minimal and surgical — scoped to this rule's visitor.

  2. Run the positive check:
       pnpm vitest run tests/analyzer/js-positive.test.ts 2>&1 | tee /tmp/pos.txt
       grep -c '{{rule}}' /tmp/pos.txt || true
     Must return 0 (rule no longer fires in the positive fixture).

  3. Run the negative check:
       pnpm vitest run tests/analyzer/js-negative.test.ts -t 'finds violations for each expected marker'
     Must PASS (// VIOLATION: {{rule}} marker still detected).

  4. If both pass → done. Append one line to {{report_path}}:
       {"rule": "{{rule}}", "outcome": "fixed", "edited_files": [...], "iterations": <n>, "final_failures": []}

  5. If positive still fails OR negative breaks → analyze vitest output, refine the guard, iterate.

# Failure exit

If after 5 iterations both contracts still aren't satisfied:
  - revert your edits: `git checkout -- packages/analyzer/src/rules/<changed paths>`
  - append: {"rule": "{{rule}}", "outcome": "failed", "edited_files": [...], "iterations": 5, "final_failures": [...]}
  - exit

Do NOT leave a half-broken visitor.

# Constraints

- Never edit the test files. Positive and negative tests are immutable contracts.
- Never delete or weaken an unrelated rule.
- Do not commit. The orchestrator (or human) decides when to commit.
- Do not modify shared utilities outside this rule's visitor unless absolutely
  necessary; if you do, list the file in `edited_files`.
- Do NOT read fp-audit/state/fp.jsonl. You don't need it.
- Output ONLY the JSON line in {{report_path}}. No other stdout.
- NEVER ask the user a question. If stuck after 5 iterations, revert and report failed.
````

# Failure modes

- Sub-agent reports `outcome: "failed"` → orchestrator reverts those rows' status to `"fixtures-ready"` (or prior). Logged in `fix-report.jsonl`. Other rules continue.
- `pnpm build:dist` fails after sub-agents finish → ABORT stage 5. The bad edit is somewhere in the union of `edited_files` across sub-agents reporting `fixed`. User inspects.
- Re-analyze on a target fails → log; that target's rows stay at `status: "fix-attempted"` until manual re-run.
- Re-analyze finds an FP row whose rule was `fixed` is still firing → row's `status = "surviving"`. Either the visitor edit missed this instance (real failure) OR the original classification was wrong (false flag). Stage 6 spot-checks.

# Resumability

The orchestrator's per-row status field tracks progress:
- `fixtures-ready` → not yet attempted
- `fix-attempted` → sub-agent currently/recently running
- `fixed` / `surviving` → re-analyze settled

A crashed run can resume by re-reading fp.jsonl and dispatching only rules whose rows are still at `fixtures-ready`.
