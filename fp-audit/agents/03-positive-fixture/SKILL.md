---
name: fp-audit-03-positive-fixture
description: For each rule that has FP rows, extend the positive fixture project with realistic code that triggers the FP, then add one per-rule it() to js-positive.test.ts so stage 5 has a named contract to run. The test fails today (the rule fires) and passes after stage 5 fixes the visitor.
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-fix/SKILL.md` (log to `fp-audit/state/decisions.jsonl`, continue per the table). Forbidden: "Should I proceed?", "Please clarify", any phrasing that waits for the user.

# Inputs

- `fp-audit/state/rule-briefs.json` — produced by stage 2.5 (synthesize)
- `fp-audit/state/fp.jsonl` — global FP ledger

# Outputs

- **Appended code** in existing files under `tests/fixtures/sample-js-project-positive/src/` — one or more FP-pattern snippets per rule, written into whichever existing file fits best (or a new thematic file if nothing fits).
- `fp-audit/state/fp.jsonl` — every FP row for a rule that gets a fixture:
  - `positive_fixture_path: "<relative path to the fixture file that was extended>"`
  - `status: "positive-fixture-ready"` (advanced from `unconfirmed`)
  - If the test unexpectedly passes today: `status: "fixed-by-prior-work"`, `fixed_by_commit: <analyzer HEAD>`
- `fp-audit/state/positive-scratch/<rule_safe>.json` — per-rule scratch from sub-agents (gitignored).

# Positive fixture project

`tests/fixtures/sample-js-project-positive/` — realistic TypeScript/JavaScript project. Existing source files under `src/`:
- `callbacks.ts` — async callbacks, event handlers
- `framework-apis.ts` — framework usage patterns
- `helpers.ts` — utility functions
- `idiomatic-null-checks.ts` — null/undefined handling
- `nextjs-patterns.ts` — Next.js page/API patterns
- `react-patterns.tsx` — React component patterns
- `tailwind-jsx.tsx` — Tailwind + JSX
- `time-arithmetic.ts` — date/time operations
- `type-annotations.ts` — TypeScript type patterns

Sub-agents must extend one of these files (or create a new thematic file if the rule's pattern doesn't fit any). The code must look like it belongs there naturally — realistic, not a synthetic test stub.

# Dispatch unit: one sub-agent per RULE (not per mode)

Unlike the previous design, dispatch one sub-agent per rule. That sub-agent appends ALL modes' FP patterns for that rule into the fixture project (one representative snippet per mode). This keeps the fixture project coherent — all patterns for a rule land in the same file section.

# Steps

1. Read `fp-audit/state/fp.jsonl`. Collect unique rules that have `class === "FP"` rows with `positive_fixture_path === null`. These are the rules needing fixtures.

2. Read `fp-audit/state/rule-briefs.json` to get modes and `suggested_predicate` for each rule (fallback: group FP rows by `shape_sig` as synthetic modes for rules not in briefs).

3. **Pre-dispatch plan:**
   ```
   ── stage 3 dispatch plan ────────────────────────────────
   rules needing fixtures:   <R>
   wave size:                20
   estimated waves:          <ceil(R / 20)>
   ```

4. **Wave-based dispatch.** One sub-agent per rule, waves of 20, same retry loop as earlier stages (MAX_WAVE_RETRIES = 2). Each sub-agent writes to `fp-audit/state/positive-scratch/<rule_safe>.json`.

   Validate scratch: file exists, parses as JSON, has `rule`, `target_file`, `code_to_append`, `modes_covered`.

5. **Apply scratch files serially.**
   For each valid scratch:
   - Append `code_to_append` to `tests/fixtures/sample-js-project-positive/src/<target_file>`. Separate from existing content with a blank line. Atomic-write.

6. **Verify the rule fires on the appended code** (proves the FP exists):
   ```bash
   pnpm vitest run tests/analyzer/js-positive.test.ts 2>&1 | tee /tmp/pos-verify.txt
   grep -c '"ruleKey"' /tmp/pos-verify.txt || true
   ```
   Parse the output: if violations for this rule appear → FAIL as expected → good contract.
   If the rule does NOT appear in violations → appended code doesn't trigger it → set `status: "fixed-by-prior-work"`, `fixed_by_commit: <analyzer HEAD>`.
   On vitest crash/error: log, leave status at `positive-fixture-ready` (verification deferred).

7. **Incremental fp.jsonl writes.** After each scratch is applied and verified, update ALL FP rows for that rule with `positive_fixture_path` and new status. Atomic-write. Do NOT batch.

8. **Print summary:**
   ```
   ═══ stage 3 complete ═════════════════════════════════
   rules processed:            <R>
   fixture appends written:    <R>
   failing as expected:        <F>
   fixed-by-prior-work:        <X>
   errored / skipped:          <E>
   fp.jsonl rows advanced:     <N>
   ```

# Sub-agent prompt template

Substitute `{{rule}}`, `{{modes_json}}`, `{{clone_path}}`, `{{scratch_path}}`, `{{fixture_root}}`.

`{{modes_json}}` is the array of modes from rule-briefs.json for this rule (or synthetic shape groups). Each mode has `name`, `summary`, `suggested_predicate`, `representative_fp_ids`.

`{{fixture_root}}` = absolute path to `tests/fixtures/sample-js-project-positive/`.

````
You are extending the positive fixture project for rule `{{rule}}`.

The positive fixture project contains clean, realistic code that should produce
ZERO analyzer violations. Your job is to append code patterns that the rule
currently fires on (false positives) — so the test fails today, and passes
after the visitor is fixed.

Rule modes (each is a distinct FP pattern):
{{modes_json}}

Clone of the target repo (to read real FP examples): {{clone_path}}
Positive fixture project root: {{fixture_root}}

Steps:

1. For each mode, pick the simplest `representative_fp_id`. Read fp.jsonl to
   find its file + line. Read that source file ±20 lines from the clone.

2. Read 2–3 of the existing fixture files at {{fixture_root}}/src/ to understand
   the project's code style and which file fits best for this rule.

3. For ALL modes of this rule, compose ONE block of code to append. The block
   should:
   - Contain one representative snippet per mode, clearly separated by a blank line.
   - Look like it belongs in the chosen file — realistic TypeScript, not a stub.
   - Use `declare const` for external symbols if needed (no project-specific imports).
   - Be self-contained (no imports required beyond what the file already has).
   - Actually trigger the rule today (that's the point — these are FP patterns).

4. Choose the best existing file under src/ to append to. Pick the file whose
   theme is closest to the rule's domain. If no file fits, propose a new filename
   (e.g., `src/error-handling.ts`) — the orchestrator will create it.

Output: write JSON to {{scratch_path}}:

{
  "rule": "<rule>",
  "target_file": "<filename relative to src/, e.g. helpers.ts>",
  "code_to_append": "<the full block of code to append, newline-separated>",
  "modes_covered": ["<mode name 1>", "<mode name 2>", ...]
}

Constraints:
- Output ONLY the JSON file. Do not edit any files directly.
- code_to_append must be valid TypeScript (or JavaScript for .js files).
- Do not add import statements — only `declare const` stubs.
- NEVER ask the user a question. If you cannot produce a valid fixture, write
  { "error": "<reason>", "rule": "<rule>" } and exit.
````

# Failure modes

- Scratch missing or malformed after MAX_WAVE_RETRIES → log, skip rule (its rows stay `unconfirmed`).
- Append makes the file unparseable → revert the append, log, skip.
- vitest cannot run → leave status at `positive-fixture-ready`, fixture is still in place.

# Resumability

Re-run skips rules whose FP rows already have `positive_fixture_path` set. Scratch files already written are reused. Fixture appends are detected by scanning the file for the appended block's first line (skip re-append if already present).
