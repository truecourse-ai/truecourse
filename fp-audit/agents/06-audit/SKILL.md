---
name: fp-audit-06-audit
description: Safety-net step after stage 5. For each rule whose visitor was fixed, diff the before/after re-analyze snapshots, sample the violations that DISAPPEARED, and verify with a sub-agent that they were really FPs (not silently-suppressed real bugs). If any disappearance turns out to be a TP, revert that rule's visitor fix.
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-fix/SKILL.md` (log to `fp-audit/state/decisions.jsonl`, continue per the table). Forbidden: "Should I proceed?", "Please clarify", any phrasing that waits for the user.

# Purpose

The classifier's verdict on individual violations can be wrong. If the classifier said "FP" but the violation was actually a real bug, stage 5's visitor fix has now suppressed that real-bug detection — silently. This stage catches that.

The check uses the analyzer's own behavior as ground truth: any violation that **was firing before the fix** and **no longer fires after the fix** had its detection killed by the visitor edit. If a sample of those disappearances includes any genuine TPs, the rule's fix is too aggressive and must be reverted.

# Inputs

- `fp-audit/state/fp.jsonl` — global FP ledger, expected to contain rows with `status: "fixed"` or `"surviving"` from stage 5
- `fp-audit/state/fix-report.jsonl` — one line per rule attempted by stage 5
- Each target's `<audit_dir>/snapshots/` — must contain at least one `_audit` snapshot (baseline) and one `_re-analyze` snapshot (post-fix)

# Outputs

- `fp-audit/state/audit-report.jsonl` — one JSON line per rule audited:
  ```json
  {
    "rule": "<rule>",
    "verdict": "safe" | "over-suppressed" | "inconclusive",
    "disappeared_count": <int>,
    "sampled": <int>,
    "sample_results": [{ "fp_id": "...", "file": "...", "line": ..., "class": "TP|FP|UNCERTAIN", "why": "..." }],
    "tp_count_in_sample": <int>,
    "action": "kept" | "reverted",
    "audited_at": "<iso>"
  }
  ```
- If a rule is reverted: `git checkout -- packages/analyzer/src/rules/<paths>` on its edited files, then `pnpm build:dist` again. fp.jsonl rows for that rule revert from `status: "fixed" | "surviving"` back to `status: "fixtures-ready"` (so the user can re-run stage 5 with tightened fixtures).

# Steps

1. **Build the audit set.** Read `fix-report.jsonl`. For each line with `outcome: "fixed"`:
   - Read the corresponding rule's FP rows from fp.jsonl.
   - For each target (`repo` + `target_commit`) that contributed FP rows for this rule:
     - Read the latest `_audit` snapshot (baseline before fix).
     - Read the latest `_re-analyze` snapshot (after fix).
     - Build `before_set = { (file, line) | violation has ruleKey == <rule> in baseline }`.
     - Build `after_set = { (file, line) | violation has ruleKey == <rule> in re-analyze }`.
     - `disappeared = before_set − after_set` — these are the violations the visitor fix eliminated.

2. **Pre-dispatch plan.**
   ```
   ── stage 6 audit plan ───────────────────────────────────
   rules fixed by stage 5:    <R>
   total disappearances:      <D>     (summed across rules)
   sample size per rule:      min(50, ceil(0.05 * disappeared_count))
   total sub-agents:          <R>     (one per rule)
   wave size:                 30
   ```

3. **Wave-based dispatch.** For each fixed rule:
   - Sample `min(50, max(10, ceil(0.05 * disappeared_count)))` disappearances. Sampling is stratified by `shape_sig` (look up shape_sig from fp.jsonl using `(file, line, rule)`) so rare shapes get representation. Random tie-breaks deterministic via SHA1(rule+file+line) ordering.
   - Dispatch ONE audit sub-agent per rule (Agent tool, `model="opus"`, default).
   - Same wave-loop structure as earlier stages (30 per wave, validate output, retry, hard gate).

4. **Adjudicate verdicts.** For each rule, read its audit sub-agent's result:
   - `tp_count_in_sample == 0` → `verdict: "safe"`, `action: "kept"`. Sub-agent confirmed all sampled disappearances are real FPs. Done.
   - `tp_count_in_sample >= 1` → `verdict: "over-suppressed"`, `action: "reverted"`. Revert the rule's visitor fix:
     - Identify edited files from the rule's `fix-report.jsonl` line.
     - `git checkout -- <files>` (analyzer repo).
     - Revert status of the rule's FP rows in fp.jsonl back to `"fixtures-ready"`. Atomic-write.
     - Log to `decisions.jsonl`: `{ stage: 6, situation: "rule fix reverted — TP in disappearance sample", rule, sample_tps: [...] }`.
   - Sub-agent could not decide on enough rows (UNCERTAIN ≥ 50% of sample) → `verdict: "inconclusive"`, `action: "kept"`. Flag for human review in `audit-report.jsonl`. Status stays as set by stage 5.

5. **If any rules were reverted, rebuild the CLI:**
   ```bash
   cd "${ANALYZER_ROOT}" && pnpm build:dist
   ```
   This restores the previous `dist/cli.mjs` for those rules. (Other rules' fixes remain in the bundle.)

6. **Print summary:**
   ```
   ═══ stage 6 complete ═════════════════════════════════
   rules audited:            <R>
     verdict safe:           <S>     (kept fix)
     verdict over-suppressed:<O>     (reverted fix)
     verdict inconclusive:   <I>     (kept fix, flagged for review)
   total disappearances sampled: <total_sampled>
   real TPs found among disappearances: <total_tps>
   ```

# Audit sub-agent prompt template

Substitute `{{rule}}`, `{{sample_json}}`, `{{clone_paths}}`, `{{report_path}}`.

`{{sample_json}}` is a list: `[{ fp_id, file, line, target_commit, repo }, ...]` — the violations to audit.

`{{clone_paths}}` is a mapping `{ repo: clone_path }` so the sub-agent can resolve files for each repo.

````
You are auditing whether the disappearances caused by a recent visitor fix
for rule `{{rule}}` are really false positives, or if any of them were
genuine bugs that the fix has silently suppressed.

Input: {{sample_json}}
  A list of (file, line, fp_id) tuples — each is a violation that was firing
  before the fix and no longer fires after. Your job is to classify each one
  independently as if you were the original classifier.

Clone paths (resolve files in the right repo): {{clone_paths}}

For each entry:
  1. Read the file at file:line in the corresponding clone (±20 lines context).
  2. Decide:
       - TP        — this code is a genuine instance of what the rule should
                     catch. The fix silently suppressed it. DANGEROUS.
       - FP        — this code is benign; the fix was correct to suppress it.
       - UNCERTAIN — cannot decide from local context.

  3. Output one row per entry with: { fp_id, file, line, class, why }

# Critical instruction

Be SKEPTICAL of "FP". If the code reasonably matches the rule's stated intent,
classify TP. The whole point of this audit is to catch over-suppression — if
you rubber-stamp everything as FP, the audit is worthless.

Bias slightly toward TP when in doubt. UNCERTAIN is fine when the call really
depends on cross-file semantics.

Output: write JSONL to {{report_path}} — one row per input entry, in same order:
  { fp_id, file, line, class, why }

Constraints:
  - Output ONLY the JSONL file.
  - Row count of output MUST equal row count of input.
  - NEVER ask the user a question. UNCERTAIN if undecidable.
````

# Failure modes

- Re-analyze snapshot missing for a target → cannot compute disappearances for rules from that target. Log; skip those rules' audit. Status stays as stage 5 set it.
- Audit sub-agent returns malformed JSON / wrong row count → loop redispatches up to MAX_WAVE_RETRIES; on persistent failure → verdict `"inconclusive"` for that rule, audit-report logged.
- `pnpm build:dist` fails after reverts → log; leave fp.jsonl statuses as adjusted (reverted rules at `"fixtures-ready"`) and surface the build error. User inspects.

# What this SKILL deliberately does NOT do

- Does not change the verdict of fp.jsonl rows for rules that pass the audit. Trust the visitor's behavior on those.
- Does not re-classify all FPs. Only audits the disappearances.
- Does not commit. Reverts are local checkouts; user decides what to commit.
- Does not loop — runs once after stage 5. If a rule is reverted, the user adjusts the positive fixture (which was probably too broad) and re-runs stage 5 manually.

# Resumability

`audit-report.jsonl` is append-only. On re-run, the orchestrator reads it and skips rules already audited (presence of a line for the rule). Useful if the process crashes mid-stage.
