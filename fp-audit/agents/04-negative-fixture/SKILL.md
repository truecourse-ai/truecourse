---
name: fp-audit-04-negative-fixture
description: For every distinct (rule, shape_sig) group of TP rows in fp.jsonl, extend the negative fixture project with a real-looking snippet marked `// VIOLATION: <rule>`. One sub-agent per TP shape — symmetric with stage 3's per-shape positive coverage. Protects every documenso TP shape from over-suppression by stage 5.
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-fix/SKILL.md`. Forbidden: "Should I proceed?", "Please clarify".

# Inputs

- `fp-audit/state/fp.jsonl` — global ledger (TP rows are the source of truth)
- Each target's clone path from `state.json` (e.g., `/tmp/audit-targets/documenso/`) — sub-agents read real TP source for AST reference

# Outputs

- **Appended code with `// VIOLATION: <rule>` markers** in existing files under `tests/fixtures/sample-js-project-negative/` — one snippet per (rule, shape_sig) TP group, placed at a thematically natural location.
- `fp-audit/state/fp.jsonl` — every FP row whose rule now has at least one negative marker:
  - `negative_fixture_path: "<relative path>::<rule>"`
  - `status: "fixtures-ready"` (if `positive_fixture_path` already set)
- `fp-audit/state/negative-scratch/<rule_safe>__<shape_sig>.json` — per-shape scratch (gitignored)
- `fp-audit/state/negative-warnings.jsonl` — rules with FPs but zero TP rows (cannot generate negative; logged for human review)

# Dispatch unit: one sub-agent per (rule, shape_sig) of TP rows

Stage 4 previously dispatched per rule (1 marker per rule = 176 markers). The new design dispatches per **(rule, shape_sig)** TP group — ~1-2K dispatches. Every distinct TP shape gets its own marker so stage 5's visitor edit cannot silently over-suppress shape-level real bug detection.

# Sub-agent model

**Sonnet** (default). Pattern-translation task — same rationale as stage 3.

# Negative fixture project

`tests/fixtures/sample-js-project-negative/` — realistic multi-service TypeScript project. Sub-agents extend existing files where the rule's domain fits (e.g., crypto TP → `shared/utils/src/`, route TP → `services/api-gateway/src/routes/`). No generic catalog dirs.

# Steps

1. **Read fp.jsonl.** Build dispatch list — one entry per distinct `(rule, shape_sig)` where `class === "TP"`. Each entry carries the representative `(file, line)` TP row and all member `fp_id`s.

2. **Find existing markers**. For each `(rule, shape_sig)` group, check if a `// VIOLATION: <rule>` marker already exists in the negative fixture. If yes → reuse (no sub-agent needed for that group).

3. **Rules with FPs but zero TPs** → log to `negative-warnings.jsonl` with reason "no TP rows available". Stage 5 will not be able to fix this rule (skipped per 00-fix policy).

4. **Pre-dispatch plan:**
   ```
   ── stage 4 dispatch plan ────────────────────────────────
   distinct (rule, shape_sig) TP groups: <N>
   reusing existing markers:             <E>
   needing new markers:                  <K>
   no-TP rules (warnings):               <W>
   sub-agent model:                      sonnet
   wave size:                            50
   ```

5. **Wave-based dispatch.** 50 sub-agents per wave. Each writes to `fp-audit/state/negative-scratch/<rule_safe>__<shape_sig>.json`.

   Validate: file exists, parses JSON, has `rule`, `shape_sig`, `target_file`, `code_to_append` (containing `// VIOLATION: <rule>` on the line BEFORE the triggering line).

6. **Apply scratches serially.** Append `code_to_append` to the chosen target file. Idempotent — skip if first 60 chars already present.

7. **Verify** by running `js-negative.test.ts -t 'finds violations for each expected marker'`. The new marker should be detected. On failure: revert the append, log to `negative-warnings.jsonl` with reason "generated TP did not fire".

8. **Incremental fp.jsonl writes.** After each scratch verified, stamp `negative_fixture_path` on every FP row whose rule has at least one valid negative marker. Advance status to `"fixtures-ready"` if `positive_fixture_path` is also set. Atomic-write per scratch.

9. **Summary:**
   ```
   ═══ stage 4 complete ═════════════════════════════════
   TP shape groups processed: <N>
   markers reused:            <E>
   new markers added:         <K>
   warnings:                  <W>
   fp.jsonl rows advanced:    <R>
   ```

# Sub-agent prompt template

Substitute `{{rule}}`, `{{shape_sig}}`, `{{representative_tp_json}}`, `{{clone_path}}`, `{{scratch_path}}`.

````
You are generating ONE negative-fixture snippet that recreates a single TP
AST shape (rule={{rule}}, shape_sig={{shape_sig}}) so a too-aggressive visitor
fix in stage 5 cannot silently suppress this shape.

Representative TP location: {{representative_tp_json}}
Source repo clone: {{clone_path}}

Steps:
  1. Read the TP's file at {{representative_tp_json.file}}, ±20 lines around line {{representative_tp_json.line}}.
  2. Understand the AST shape that legitimately triggers the rule.
  3. Write FRESH original TypeScript that:
     - Preserves the same AST shape
     - Uses realistic identifier names (rename from documenso — don't copy verbatim)
     - Uses `declare const`/`declare function` for external symbols
     - Has `// VIOLATION: {{rule}}` on the line IMMEDIATELY before the triggering expression
     - Reads as code that belongs in a service codebase, not a stub
  4. Pick the best existing file under tests/fixtures/sample-js-project-negative/ (prefer services/*/src/ files matching the rule's domain). New files OK if no existing fit — natural path within the project.

Output: write JSON to {{scratch_path}}:
{
  "rule": "{{rule}}",
  "shape_sig": "{{shape_sig}}",
  "target_file": "<path relative to tests/fixtures/sample-js-project-negative/>",
  "code_to_append": "<full snippet INCLUDING the // VIOLATION: comment>",
  "member_fp_ids": [<list of fp_ids in this TP shape group>]
}

Constraints:
- Output ONLY the JSON file.
- Line immediately after `// VIOLATION: {{rule}}` MUST be the rule-triggering expression.
- No real npm imports — declare-const stubs only.
- NEVER ask the user a question. If stuck, write { "error": "<reason>", "rule": "{{rule}}", "shape_sig": "{{shape_sig}}" } and exit.
````

# Failure modes

- Scratch malformed after retries → log + skip group.
- Append breaks file parse → revert + log.
- Generated TP doesn't fire → revert + log to negative-warnings.jsonl.

# Resumability

- Existing valid scratches reused.
- Already-appended markers detected by string-match and skipped.
- Already-stamped fp.jsonl rows skipped in the dispatch list.
