---
name: fp-audit-03-positive-fixture
description: For every distinct (rule, shape_sig) group in fp.jsonl, extend the positive fixture project with realistic code that triggers exactly that AST shape. One sub-agent per shape — full coverage, no sampling. Stage 5 then has a contract that mirrors documenso's real FP shape diversity.
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-fix/SKILL.md` (log to `fp-audit/state/decisions.jsonl`, continue per the table). Forbidden: "Should I proceed?", "Please clarify", any phrasing that waits for the user.

# Inputs

- `fp-audit/state/fp.jsonl` — global FP ledger (the authoritative source — shapes, files, lines, rules)
- `fp-audit/state/rule-briefs.json` — **optional, hint only**. The `suggested_predicate` per mode helps sub-agents understand the FP's "why" but is not required.
- Each target's clone path from `state.json` (e.g., `/tmp/audit-targets/documenso/`) — the sub-agent reads the real FP source here for reference.

# Outputs

- **Appended code** in existing files under `tests/fixtures/sample-js-project-positive/` — one snippet per shape, placed in a thematically appropriate existing file, or in a new themed file if no existing one fits.
- `fp-audit/state/fp.jsonl` — every row in a shape group that got a fixture:
  - `positive_fixture_path: "<relative path to the fixture file that was extended>"`
  - `status: "positive-fixture-ready"` (advanced from `unconfirmed`)
  - If the appended snippet unexpectedly doesn't fire: `status: "fixed-by-prior-work"`, `fixed_by_commit: <analyzer HEAD>` (rare with per-shape extraction — the snippet should preserve the exact AST shape that fires).
- `fp-audit/state/positive-scratch/<rule_safe>__<shape_sig>.json` — per-shape scratch from sub-agents (gitignored).

# Dispatch unit: one sub-agent per (rule, shape_sig)

Stage 3 previously sampled — one fixture per *mode* (244 dispatches). That left ~97% of real-world FP shape variance uncovered. The new design dispatches **one sub-agent per (rule, shape_sig) group** — ~26K dispatches for the documenso target.

Every distinct AST shape that triggers an FP gets its own fixture entry. No sampling. No synthesis loss.

# Sub-agent model

**Sonnet** (default). The task is structural translation — read a real FP, write an equivalent benign-looking snippet that preserves the AST shape. Sonnet handles this quality of work well and is ~5x cheaper than Opus at this volume.

Override to Opus via the orchestrator only if Sonnet retries consistently produce snippets that don't fire the rule.

# Positive fixture project — natural extension

`tests/fixtures/sample-js-project-positive/` — a realistic multi-service TypeScript/JavaScript project. Existing structure:
- `src/` — themed files: `callbacks.ts`, `framework-apis.ts`, `helpers.ts`, `idiomatic-null-checks.ts`, `nextjs-patterns.ts`, `react-patterns.tsx`, `tailwind-jsx.tsx`, `time-arithmetic.ts`, `type-annotations.ts`
- `services/<service>/src/...` — service-style code (api-gateway, user-service, notification-service, web, infrastructure)
- `shared/utils/src/...` — shared utilities
- `packages/lib/...`, `apps/remix/`, `apps/web/`, `examples/`, `scripts/` — added in prior runs

Sub-agents must **extend existing files** by appending to one whose theme fits the rule (e.g., a React effect rule → `services/web/src/components/...`, a crypto rule → `shared/utils/src/crypto.ts`, an env-access rule → `packages/lib/...`). If no existing file is a sensible fit, the sub-agent picks a natural new path within the project's structure — never under a generic catalog like `fp-cases/` or `documenso-fp-shapes/`. The fixture should read like a coherent codebase, not a test catalog.

Multiple snippets for different shapes of the same rule typically land in the same themed file — that's fine, they accumulate naturally.

# Steps

1. **Read fp.jsonl.** Build the dispatch list — one entry per distinct `(rule, shape_sig)` where `class === "FP"`. Each entry carries:
   - `rule`
   - `shape_sig`
   - Representative `(file, line, why, mode)` (pick the row with the smallest `(file, line)` for determinism)
   - All `fp_id`s in the group (for later stamping)

2. **Filter out already-done groups** — if every row in a group already has `positive_fixture_path` set, skip. (Makes the SKILL resumable.)

3. **Pre-dispatch plan:**
   ```
   ── stage 3 dispatch plan ────────────────────────────────
   distinct (rule, shape_sig) groups: <N>
   sub-agent model:                   sonnet
   wave size:                         50
   estimated waves:                   <ceil(N / 50)>
   ```

4. **Wave-based dispatch loop.** 50 sub-agents per wave (Sonnet is fast and cheap enough to scale). Same retry pattern as earlier stages (MAX_WAVE_RETRIES = 2). Each sub-agent writes to `fp-audit/state/positive-scratch/<rule_safe>__<shape_sig>.json`.

   Validate scratch: file exists, parses as JSON, has `rule`, `shape_sig`, `target_file`, `code_to_append`, `member_fp_ids`.

5. **Apply scratches serially.** For each valid scratch:
   - Append `code_to_append` to `tests/fixtures/sample-js-project-positive/<target_file>`. Separate from existing content with a blank line. Atomic-write.
   - Idempotency: if the first ~60 chars of `code_to_append` already appear in the file, skip (re-run safe).

6. **Verify each appended snippet fires the rule** by running the analyzer programmatically against the fixture project and checking violations for `rule` at the snippet's location. (Use a small helper script — `pnpm vitest run tests/analyzer/js-positive.test.ts` is fine but slow; a direct programmatic check per snippet is faster.)
   - If the rule fires → record `positive_fixture_path` on every fp_id in `member_fp_ids` and advance status to `"positive-fixture-ready"`.
   - If it does NOT fire → mark all member fp_ids `status: "fixed-by-prior-work"` and stamp `positive_fixture_path` anyway (for traceability).

7. **Incremental fp.jsonl writes.** Atomic-write fp.jsonl after EACH scratch is applied + verified. Do NOT batch end-of-wave. Crash-resilient.

8. **Print summary:**
   ```
   ═══ stage 3 complete ═════════════════════════════════
   shape groups processed:     <N>
   snippets appended:          <K>
   snippets that fired (good): <P>
   fixed-by-prior-work:        <Q>
   fp.jsonl rows advanced:     <R>
   ```

# Sub-agent prompt template

Substitute `{{rule}}`, `{{shape_sig}}`, `{{representative_fp_json}}`, `{{clone_path}}`, `{{scratch_path}}`, `{{rule_brief_hint}}`.

`{{representative_fp_json}}` has: `{ fp_id, file, line, why, mode }`.
`{{rule_brief_hint}}` is the mode's `suggested_predicate` from rule-briefs.json if available — optional context.

````
You are generating ONE fixture snippet that recreates a single false-positive
AST shape (rule={{rule}}, shape_sig={{shape_sig}}) so the analyzer's positive
integration test will fail until the rule's visitor is fixed.

Representative FP location: {{representative_fp_json}}
Source repo clone: {{clone_path}}

Hint from synthesis (optional, may be empty): {{rule_brief_hint}}

Your job:

  1. Read the file at {{representative_fp_json.file}} in the clone, ±20 lines
     around line {{representative_fp_json.line}}.

  2. Understand the AST shape that triggers the rule (use the `why` field for
     context). This is the structural pattern that must be preserved.

  3. Write FRESH original TypeScript code that:
     - Recreates the same AST shape — same node types, same nesting, same
       structural features that triggered the rule
     - Uses realistic identifier names (rename variables/functions to fit the
       fixture's theme — DO NOT copy documenso identifiers verbatim)
     - Has no project-specific imports — replace external symbols with
       `declare const X: ...` or `declare function X(...): ...`
     - Reads as code that belongs in the fixture project, not as a stub

  4. Pick the best existing file under
     tests/fixtures/sample-js-project-positive/ to append the snippet to.
     Match by rule category and snippet theme. Browse a few existing files to
     understand the project's style.

     If no existing file fits, propose a new filename in a natural location
     within the project structure (e.g., services/api-gateway/src/foo.ts,
     packages/lib/server-only/bar.ts). DO NOT use generic catalog paths like
     fp-cases/ or documenso-fp-shapes/.

  5. The snippet must be self-contained: any external symbol it references
     must be `declare const`'d at the top of the snippet (or stand-alone).

Output: write JSON to {{scratch_path}}:

{
  "rule": "{{rule}}",
  "shape_sig": "{{shape_sig}}",
  "target_file": "<path relative to tests/fixtures/sample-js-project-positive/>",
  "code_to_append": "<the full block of code to append>",
  "member_fp_ids": [<list of fp_ids in this shape group, copied verbatim from the orchestrator's input>]
}

Constraints:
- Output ONLY the JSON file.
- Do not edit any source/test/fixture files directly — the orchestrator handles writes.
- code_to_append must be valid TypeScript (or JS/Python depending on the FP's file extension).
- Do not add import statements — only `declare const`/`declare function` stubs.
- Snippet must preserve the AST shape that triggers the rule; if you simplify
  too aggressively the rule won't fire and stage 5 has no contract.
- NEVER ask the user a question. If you cannot produce a snippet, write
  { "error": "<reason>", "rule": "{{rule}}", "shape_sig": "{{shape_sig}}", "member_fp_ids": [...] }
  and exit.
````

# Failure modes

- Scratch malformed or missing after MAX_WAVE_RETRIES → log to `decisions.jsonl`, skip (member rows stay `unconfirmed`).
- Append breaks the target file (parse failure) → revert append, log, skip.
- Programmatic verification can't run (analyzer dist missing) → stamp paths but leave status at `positive-fixture-ready` (verification deferred).

# Resumability

Re-running this SKILL is safe:
- Existing valid scratches are reused (skipped in the dispatch loop).
- Already-appended snippets are detected by string-match on the first 60 chars and skipped.
- Already-stamped rows in fp.jsonl are skipped in the group filter (step 2).
