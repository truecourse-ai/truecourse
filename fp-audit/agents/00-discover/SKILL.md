---
name: fp-audit-discover
description: Discovery phase of the FP audit pipeline. Clones a target repo, runs truecourse analyze, and classifies every violation as TP / FP / DRIFT / UNCERTAIN. Produces / extends fp.jsonl. Stops before any fixture or visitor work — that's the fix phase. Invoke with a repo URL.
---

# Inputs

- `repo_url` (required) — git URL or `https://github.com/owner/name`
- `branch`   (optional, default `main`)
- `from_stage` (optional, default 1) — start at stage N (1 or 2); useful for resuming after a failure

# Autonomous mode (applies to EVERY stage and EVERY sub-agent)

This phase runs unattended. **Never ask the user a question.** Never pause for confirmation, manual review, or clarification. When you hit an ambiguous, unexpected, or seemingly-risky situation:

1. Pick the option per the policy table below.
2. Append one JSON line to `fp-audit/state/decisions.jsonl` with: `{ stage, time, situation, chose, reason, unit }`. `unit` identifies the smallest thing affected (slice id or `null`).
3. Continue with the next unit. Do not abort a whole stage for a single unit's problem unless the policy explicitly says abort.

Forbidden phrasings — if you find yourself about to say any of these, STOP and apply the policy instead:
- "Should I proceed?" / "Would you like me to…?"
- "I noticed X — please clarify"
- "Before I continue, can you confirm…?"
- "There are several options — which one?"

The user is not present. Treat this as a script, not a dialogue.

## Decision policy

| Situation                                                            | Action                                                                                         |
|----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| A `git`, `node`, or `pnpm` command exits non-zero                    | Log; mark the affected unit `failed`; continue with the next unit.                            |
| A sub-agent's output file is missing or malformed                    | Log; loop redispatches the slice (validation in SKILL 02 deletes the bad report).             |
| `dist/cli.mjs` invocation fails on the target                        | Log; abort stage 1 (no snapshot, nothing to classify).                                        |
| Stage 2: too many slices to dispatch in one message                  | **Use the wave-based loop in SKILL 02.** Do NOT truncate, sample, or cap. The loop reaches 100% coverage over many waves regardless of total count. |
| Stage 2: any slice has no valid report after retries                 | **ABORT stage 2.** Phase does not produce a complete `fp.jsonl`. Log the stuck slices.        |
| Anything else not covered                                            | Log as `unhandled`; skip the smallest unit; continue. **Never apply this row to stage 2 slice coverage** — see the rows above. |

# Preflight (always, before stage 1)

The phase must use the **locally built CLI**, not whatever `truecourse` is on PATH.

1. Capture the analyzer repo root: `ANALYZER_ROOT="$(git rev-parse --show-toplevel)"`. Hand this to every stage that runs the CLI. Do this BEFORE any `cd` into a target clone.
2. If `${ANALYZER_ROOT}/dist/cli.mjs` does not exist, run `pnpm build:dist` from `${ANALYZER_ROOT}`. If the build fails, abort the phase (do not run stage 1).

Every `truecourse analyze` invocation in any sub-SKILL must be substituted with `node "${ANALYZER_ROOT}/dist/cli.mjs" analyze`.

# How to run

Execute each stage in order, skipping any stage whose number is less than `from_stage`. For each stage:

1. Announce the stage with one line: `── stage N — <label> ────────`.
2. Read the stage's SKILL.md.
3. Execute every step in it exactly. Use Bash, Read, Write, and Agent (sub-agent dispatch) as needed.
4. Verify outputs (per the checks below). If verification fails, stop the phase and tell the user which stage to resume from.
5. Print a one-line summary.

Move to the next stage only when verification passes.

# Stage manifest

| Stage | SKILL                                          | Inputs                | Verifies                                                                  |
|-------|------------------------------------------------|-----------------------|---------------------------------------------------------------------------|
| 1     | `fp-audit/agents/01-clone-analyze/SKILL.md`    | `repo_url`, `branch`  | `fp-audit/state/.last-audit-dir` exists; the dir it points to has `state.json` and at least one snapshot |
| 2     | `fp-audit/agents/02-classify/SKILL.md`         | `audit_dir`           | `<audit_dir>/slices/manifest.json` exists; **every** slice listed has a non-empty `<audit_dir>/reports/<slice>` file with the expected row count (1 for kind="head", N for kind="tail"); `fp-audit/state/fp.jsonl` has at least one row per (repo, file, line, rule) covered by reports. **If even one slice is missing a valid report, fail.** |

# Inter-stage handoff

- **Stage 1 → 2.** Stage 1 writes the audit dir path to `fp-audit/state/.last-audit-dir`. Read this to get `audit_dir` for stage 2.

# Failure handling

If a stage fails:

1. **Do not** continue to the next stage.
2. Print:
   ```
   ✗ stage <N> failed: <one-line reason>
   resume: re-invoke this skill with from_stage=<N>
   ```
3. Leave partial state in place.

# What this SKILL does NOT do

- Does not generate fixtures, edit visitors, or update FP status. That's the fix phase (`fp-audit/agents/00-fix/SKILL.md`).
- Does not commit anything.
- Does not retry failed stages automatically.

# Multi-repo runs

Invoke this SKILL once per target repo. The fp.jsonl ledger accumulates entries across repos automatically (each row carries its `repo` field). Run discovery on as many repos as you want before invoking the fix phase.

# Final summary

After both stages complete, print:

```
═══ discovery complete ═══════════════════════════════════
repo:     <repo_url>
branch:   <branch>
audit:    <audit_dir>
fp.jsonl: <total> entries — <TP> TP, <FP> FP, <DRIFT> DRIFT, <UNCERTAIN> UNCERTAIN
next:     run fp-audit/agents/00-fix/SKILL.md to act on the FPs
```

Counts come from grepping `"class":"<value>"` in `fp-audit/state/fp.jsonl` (filter to entries with `repo == <repo>` for per-repo numbers; the totals are across all repos discovered so far).
