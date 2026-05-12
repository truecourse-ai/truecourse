---
name: fp-audit-04-negative-fixture
description: For every rule that has FP rows, extend the negative fixture project with a real TP pattern (marked with // VIOLATION: rule-key) so a too-aggressive visitor fix breaks js-negative.test.ts. Updates negative_fixture_path on each FP row.
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-fix/SKILL.md` (log to `fp-audit/state/decisions.jsonl`, continue per the table). Forbidden: "Should I proceed?", "Please clarify", any phrasing that waits for the user.

# Inputs

- (none — reads `fp-audit/state/fp.jsonl`)

# Outputs

- **Appended code** in existing files under `tests/fixtures/sample-js-project-negative/` — one TP-pattern snippet per rule, with `// VIOLATION: <rule-key>` comment on the line immediately before each violating line.
- `fp-audit/state/fp.jsonl` — every FP row for a rule that gets a negative fixture:
  - `negative_fixture_path: "<relative file path>::<rule>"` (the file where the marker was added)
  - `status: "fixtures-ready"` (if `positive_fixture_path` already set; otherwise stays `positive-fixture-ready`)
- `fp-audit/state/negative-scratch/<rule_safe>.json` — per-rule scratch from sub-agents (gitignored).
- `fp-audit/state/negative-warnings.jsonl` — rules with no TP entry available (for human review).

# How the negative test works

`tests/analyzer/js-negative.test.ts` scans all source files for `// VIOLATION: rule-key` comments and expects the analyzer to fire on the **next line** after each comment. Adding a snippet with `// VIOLATION: <rule>` above a genuine TP line registers it as an expected detection. If a visitor fix kills that detection, the test fails — catching over-suppression automatically.

No new `it()` blocks need to be added to `js-negative.test.ts`. The marker mechanism handles it.

# Negative fixture project

`tests/fixtures/sample-js-project-negative/` — realistic multi-service TypeScript project. Key locations:
- `services/api-gateway/src/` — Express routes, controllers, middleware, services
- `packages/shared/lib/` — shared utilities

Sub-agents must extend one of these existing files (or create a new realistic file). The code must look like a real bug a developer might introduce.

# Steps

1. Read `fp-audit/state/fp.jsonl`. Gather unique rules from `class === "FP"` rows.

2. For each rule, **detect existing coverage**:
   - Scan `tests/fixtures/sample-js-project-negative/` for an existing `// VIOLATION: <rule>` comment.
   - If found → record `negative_fixture_path = "<file>::<rule>"` for all FP rows. No sub-agent needed.

3. For rules without existing coverage, find a TP candidate:
   - Pick the `fp.jsonl` row with `rule === <rule>` AND `class === "TP"` with smallest `(file, line)`.
   - If no TP exists → write to `fp-audit/state/negative-warnings.jsonl` with `{ rule, reason: "no TP entry available" }`. Skip.

4. **Pre-dispatch plan:**
   ```
   ── stage 4 dispatch plan ────────────────────────────────
   rules needing new negatives: <R>
   reusing existing coverage:   <E>
   no TP available (warnings):  <W>
   wave size:                   20
   ```

5. Dispatch sub-agents in parallel (waves of 20). Each writes to `fp-audit/state/negative-scratch/<rule_safe>.json`.

   Validate scratch: file exists, parses as JSON, has `rule`, `target_file`, `code_to_append`.

6. **Apply scratch files serially.**
   For each valid scratch:
   - Append `code_to_append` to the target file in the negative project. Atomic-write.
   - Confirm `code_to_append` contains the `// VIOLATION: <rule>` comment on the line before the triggering expression.

7. **Verify the negative test still passes** (the new TP marker fires):
   ```bash
   pnpm vitest run tests/analyzer/js-negative.test.ts -t 'finds violations for each expected marker'
   ```
   - Expected: PASS. The new `// VIOLATION:` marker is detected.
   - If FAILS: the appended code doesn't trigger the rule. Revert the append. Log to `negative-warnings.jsonl` with `reason: "generated TP did not fire"`. Skip.

8. **Incremental fp.jsonl writes.** After each scratch is applied and verified, update ALL FP rows for that rule with `negative_fixture_path` and advance status where appropriate. Atomic-write.

9. **Print summary:** `<R> rules — <E> reused existing markers, <N> new TPs added, <W> warnings.`

# Sub-agent prompt template

Substitute `{{rule}}`, `{{tp_row_json}}`, `{{clone_path}}`, `{{scratch_path}}`, `{{fixture_root}}`.

````
You are extending the negative fixture project for rule `{{rule}}`.

The negative fixture uses `// VIOLATION: rule-key` comments to mark expected
detections. The test framework asserts the analyzer fires on the line IMMEDIATELY
AFTER each comment. Your job is to add a realistic TP snippet so that if a future
visitor fix becomes too aggressive, the test catches it.

TP source row: {{tp_row_json}}
Clone root: {{clone_path}}
Negative fixture root: {{fixture_root}}

Steps:

1. Read the TP's file at file:line ±20 lines from the clone.

2. Read 1–2 existing files from {{fixture_root}} to understand the project style
   (multi-service Express/TypeScript project).

3. Compose a snippet that:
   - Contains the violating expression on a dedicated line.
   - Has `// VIOLATION: <rule>` on the line IMMEDIATELY before that expression.
   - Looks like a realistic bug a developer would write.
   - Uses `declare const` for external symbols if needed (no new imports).

   Example format:
   ```typescript
   // VIOLATION: bugs/deterministic/empty-catch
   try { await riskyOp(); } catch (e) {}
   ```

4. Choose the most appropriate existing file to append to (prefer service files
   under `services/api-gateway/src/` matching the rule's domain).

Output: write JSON to {{scratch_path}}:

{
  "rule": "<rule>",
  "target_file": "<path relative to fixture root>",
  "code_to_append": "<full snippet including the // VIOLATION comment>",
  "source_tp": { "file": "...", "line": ..., "snippet": "..." }
}

Constraints:
- Output ONLY the JSON file. Do not edit files directly.
- The line immediately after `// VIOLATION: <rule>` MUST be the expression that triggers the rule.
- Do not add import statements — only `declare const` stubs.
- NEVER ask the user a question. If stuck, write { "error": "<reason>", "rule": "<rule>" }.
````

# Failure modes

- No TP available → `negative-warnings.jsonl`, skipped.
- Generated TP doesn't fire → revert append, warn, skip.
- Scratch missing after MAX_WAVE_RETRIES → log, skip.

# Resumability

Re-run skips rules whose FP rows already have `negative_fixture_path` set. Appends are idempotent (skip if `// VIOLATION: <rule>` already present in the project).
