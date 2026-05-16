---
name: fp-audit-fix
description: Fix phase of the FP audit pipeline. Reads fp.jsonl produced by discovery, runs synthesis (2.5) → positive fixtures (3) → negative fixtures (4) → visitor fixes (5) → audit (6). Fixes are global across all repos in fp.jsonl. No CLI inputs.
---

# Inputs

- `from_stage` (optional, default `2.5`) — start at a specific stage; useful for resuming. Valid values: `2.5`, `3`, `4`, `5`, `6`.

# Autonomous mode (applies to EVERY stage and EVERY sub-agent)

This phase runs unattended. **Never ask the user a question.** Never pause for confirmation, manual review, or clarification.

1. Pick the option per the policy table below.
2. Append one JSON line to `fp-audit/state/decisions.jsonl` with: `{ stage, time, situation, chose, reason, unit }`.
3. Continue with the next unit. Do not abort a whole stage for a single unit's problem unless the policy explicitly says abort.

Forbidden phrasings:
- "Should I proceed?" / "Would you like me to…?"
- "I noticed X — please clarify"
- "Before I continue, can you confirm…?"
- "There are several options — which one?"

The user is not present. Treat this as a script, not a dialogue.

## Decision policy

| Situation                                                            | Action                                                                                         |
|----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| A `git`, `node`, `pnpm`, or `vitest` command exits non-zero          | Log; mark the affected unit `failed`; continue.                                                |
| A sub-agent's output file is missing or malformed                    | Loop redispatches; on persistent failure, log and skip that unit.                              |
| A test fails after insertion when it should have passed (or vice versa) | Revert the insertion (`git checkout -- <file>`); log; continue.                              |
| A path or file referenced by a row doesn't exist                     | Log; skip that unit.                                                                          |
| `dist/cli.mjs` invocation fails on a target during re-analyze        | Log; mark target's stage-5 work `failed`; continue with other targets.                         |
| `pnpm build:dist` fails (stage 5 or stage 6 revert)                  | **ABORT** the stage that triggered it. Surface the build output. Other stages' work stands.    |
| A rule lacks a positive or negative fixture in stage 5               | Skip that rule (log "skipped: missing fixture"); continue.                                     |
| Sub-agent's iterative loop hits its retry cap                        | Mark `outcome: "failed"`; revert its edits; log; continue.                                     |
| Stage 6 finds a TP in a fixed rule's disappearances                  | Revert that rule's fix; rebuild dist. Other rules' fixes stand.                                 |
| Anything else not covered                                            | Log as `unhandled`; skip the smallest unit; continue.                                          |

# Preflight

1. `ANALYZER_ROOT="$(git rev-parse --show-toplevel)"`. Stage 5 and stage 6 need this.
2. Verify `fp-audit/state/fp.jsonl` exists and is non-empty. If not, abort — discovery hasn't been run (or produced no rows). Tell the user to run `fp-audit/agents/00-discover/SKILL.md` first.
3. Verify `${ANALYZER_ROOT}/dist/cli.mjs` exists; if not, run `pnpm build:dist`. If the build fails, abort.

# Status state machine (lives in fp.jsonl `status` field)

Per-row state advances incrementally as stages run. Each stage writes fp.jsonl row-by-row, not in batches — so a crash preserves completed work.

```
unconfirmed            (set by stage 2)
  └─→ positive-fixture-ready    (stage 3 — positive test written + verified failing)
       └─→ fixtures-ready       (stage 4 — negative test wired up)
            └─→ fix-attempted   (stage 5 — sub-agent running)
                 ├─→ fixed       (stage 5 re-analyze confirms gone)
                 ├─→ surviving   (stage 5 re-analyze shows still firing)
                 └─→ fixtures-ready  (stage 5 sub-agent failed, reverted; or stage 6 reverted)

fixed-by-prior-work    (stage 3: positive test unexpectedly passes — shape already handled)
failed                 (sub-agent could not produce a needed artifact)
```

Status is the source of truth for "where in the process is this row." Path fields (`positive_fixture_path`, `negative_fixture_path`, `fixed_by_commit`) are also persisted but status is the simpler aggregate.

# Stage manifest

| Stage | SKILL                                              | Inputs                          | Verifies                                                                  |
|-------|----------------------------------------------------|---------------------------------|---------------------------------------------------------------------------|
| 2.5   | `fp-audit/agents/02b-synthesize/SKILL.md`          | (reads `fp.jsonl`)              | `fp-audit/state/rule-briefs.json` exists with ≥1 mode per rule with ≥10 FPs; every FP row in those rules has `mode` field stamped |
| 3     | `fp-audit/agents/03-positive-fixture/SKILL.md`     | (reads briefs + `fp.jsonl`)     | every `class:"FP"` row in `fp.jsonl` has either `positive_fixture_path` set or `status:"fixed-by-prior-work"` |
| 4     | `fp-audit/agents/04-negative-fixture/SKILL.md`     | (reads `fp.jsonl`)              | every distinct rule with FP rows has `negative_fixture_path` set on its rows, or appears in `negative-warnings.jsonl`; eligible rows have `status:"fixtures-ready"` |
| 5     | `fp-audit/agents/05-fix-visitors/SKILL.md`         | (reads `fp.jsonl` for dispatch) | `fix-report.jsonl` has one row per eligible rule; rows with fixed rules have `status:"fixed"` or `"surviving"` |
| 6     | `fp-audit/agents/06-audit/SKILL.md`                | (reads `fp.jsonl` + `fix-report.jsonl`) | `audit-report.jsonl` has one row per stage-5-fixed rule; any over-suppressed rules have been reverted (status back to `"fixtures-ready"`) |

# How to run

Execute each stage in order, skipping any whose number is less than `from_stage`. For each stage:

1. Announce with one line: `── stage <N> — <label> ────────`.
2. Read the stage's SKILL.md.
3. Execute every step exactly. Use Bash, Read, Write, and Agent (sub-agent dispatch) as needed.
4. Verify outputs per the table. If verification fails, stop the phase and tell the user which stage to resume from.
5. Print a one-line summary.

Move to the next stage only when verification passes.

# Inter-stage handoff

All stages read/write `fp-audit/state/fp.jsonl`. Run sequentially, never in parallel:
- Stage 3 depends on stage 2.5's `rule-briefs.json` (with fallback for rules excluded from briefs).
- Stage 4 depends on stage 3's `positive_fixture_path`.
- Stage 5 depends on both fixture paths AND `status: "fixtures-ready"`.
- Stage 6 depends on stage 5's `fix-report.jsonl` and the latest `_re-analyze` snapshots.

# Sub-agent models

- **Stage 2.5** sub-agents → Sonnet (semantic clustering, moderate reasoning).
- **Stages 3, 4, 5, 6** sub-agents → Opus default (fixture generation, visitor editing, and audit need stronger reasoning).

`/fast` mode (Opus 4.6) is acceptable for stages 3-6 — slightly faster, same model class.

# Failure handling

If a stage fails:

1. **Do not** continue to the next stage.
2. Print:
   ```
   ✗ stage <N> failed: <one-line reason>
   resume: re-invoke this skill with from_stage=<N>
   ```
3. Leave partial state in place. fp.jsonl reflects work-done-so-far due to incremental writes.

# What this SKILL does NOT do

- Does not run discovery (clone, analyze, classify). That's `00-discover/SKILL.md`.
- Does not commit anything. Visitor edits, new tests, and `fp.jsonl` updates remain uncommitted.
- Does not retry failed stages automatically. Resume is explicit.

# Final summary

After all selected stages complete, print:

```
═══ fix phase complete ═══════════════════════════════════
fp.jsonl: <total> entries
  unconfirmed:              <U>
  positive-fixture-ready:   <P>
  fixtures-ready:           <F>
  fix-attempted:            <A>     (stuck — should be 0 if pipeline completed)
  fixed:                    <K>
  surviving:                <S>
  fixed-by-prior-work:      <X>
  failed:                   <E>

fixtures: <Pf> positive, <Nf> negative tests added
visitors: <R> rules attempted in stage 5 — <Ff> fixed, <Xx> failed
audit:    <O> rules over-suppressed and reverted, <Sa> safe, <Ic> inconclusive
```
