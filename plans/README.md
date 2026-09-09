# Implementation plans

Planning date: September 9, 2026. These plans use the working tree at commit `3af0cb0f`, including existing uncommitted changes. Read the drift notes before implementation.

| Plan | Purpose | Priority | Effort | Status |
| --- | --- | --- | --- | --- |
| [001](001-complete-guard-generation.md) | Complete required guard checks before ending generation | P1 | L | COMPLETE |
| [002](002-repair-fidelity-evidence.md) | Repair reviewer evidence before acceptance and caching | P1 | M | COMPLETE |
| [003](003-isolate-scenario-data.md) | Verify and provide private scenario data | P1 | L | COMPLETE |
| [004](004-match-individual-verification-cases.md) | Match and preserve independent cases | P1 | L | COMPLETE |
| [005](005-repair-before-retirement-and-verify-rerun.md) | Repair recoverable failures and verify the combined path | P1 | M | COMPLETE |
| [006](006-enforce-coherent-flow-boundaries.md) | Define coherent flows before generating complete tests | P1 | L | PROPOSED |

Plan 006 proposes revising the partial-scenario publication policy below following the discussion of repeated steps panels. It separates independent behaviors during synthesis and retains incomplete authoring as drafts. Reconcile Plans 004–005 with that policy before implementing 006; the earlier decisions remain a record of the current implementation, not approval of the new proposal.

Execute Plan 001 in its numbered order: shared obligation accounting, browser assertions, bounded completion loop, cache correctness, case/review quality, then end-to-end regression and rollout validation. Each step has targeted test gates. Root `PLAN.md` remains the project status tracker.

## Decisions retained

- Saving faithful partial tests is deliberate and remains supported.
- The fix must enforce completion without requiring every scenario to verify an entire flow.
- Generation can be complete while execution fails on a real application defect.
- Budget increases, dashboard relabeling, cache clearing and manual database edits do not fix this incident.
- Cache completeness is a related code-path defect, not the cause of the inspected live session.

This is a scoped plan based on generation transcripts and the relevant engine code, not a whole-repository audit. No implementation tests or live generation ran during planning.

All six implementation steps of Plan 001 are complete. The final suite passed 694 files and 13,298 tests, including all new Chromium regressions. Package builds, core/dashboard typechecks and whitespace validation pass. The user subsequently regenerated the repository. The September 9 live analysis below records the remaining defects; it does not invalidate the completed Plan 001 implementation gates.


## September 9 rerun and follow-up order

Generation `cd2ec0ff-d11c-4c09-a553-5f3b686e2ec3` for `spiderhands/expense-tracker` ended at 13:33:50 UTC with 6/17 flows complete and 10 saved tests. Run `2026-09-09T13-33-59Z_8094658e` passed 9 and failed 1. Read-only DB inspection showed shared-state interference, repeated malformed reviewer evidence, whole-milestone matching gaps and early worker retirement. The evidence and exact failure shapes are inlined in Plans 002–005; implementation must not depend on temporary investigation files.

Recommended execution:

1. Plan 002 fixes the deterministic review loop first.
2. Implement Plan 003's schema/runtime/setup/bundle foundation.
3. Plan 004 adds exact case assignment and plugs in Plan 003 preparation requirements. Complete the joint isolation/assignment validation before marking either plan complete.
4. Plan 005 uses those error categories and assignment identities for bounded repair, then runs the combined regression and rollout gates.

Plan 002 and the Plan 003 runtime work can be developed independently, but they touch shared generator/core consumers and must be reconciled before integration. Plan 005 depends on the finished contracts of all three preceding plans.

No implementation or live DB mutation was performed while writing these follow-up plans. The plan work is scoped to observed generation/execution failures; it is not a general security, performance or dependency audit.

## Alternatives considered and rejected

- Clearing generation/setup tables: does not fix evidence validation, state interference or assignment loss; preserve history and use input fingerprints.
- Increasing worker budgets: the observed workers retired before exhaustion; repair routing is the first issue.
- Serializing the whole suite: cannot guarantee an empty ledger or an independently known global sum, and discards safe concurrency.
- Using raw setup.env as the general isolation contract: seed/fixture scope and API/web environment precedence currently differ.
- Weakening the evidence validator or counting a passing subset as full coverage: would reintroduce false certification.
- Treating shared-world lifecycle management as a bug: its ownership prevents documented singleton-service teardown races. Add private data scope while preserving lifecycle ownership.
- Request interception and authored timezone switching: genuine additional capabilities, deferred from these incident fixes. Keep their affected cases explicitly unsupported.

## Implementation validation — September 9, 2026

Plans 002–005 are implemented. Validation: **COMPLETE**. `pnpm --filter @truecourse/core... build`, core and dashboard-client typechecks, and `git diff --check` passed. Final `pnpm test`: **699 files passed, 13,355 tests passed, 32 existing skips**. The private-state and completion-browser regressions executed against real HTTP servers and Chromium. No live-model quality or hosted rerun result is inferred from these fixtures.

Rollout: deploy the updated engine/runner, run `truecourse guard setup --only-preparations --refresh`, then `truecourse guard generate`. For remaining mapping gaps, run targeted `truecourse guard interfaces author` using the reported action/source. Preserve existing setup artifacts and DB history. Live validation after these changes is **NOT RUN**. Plan 006 remains proposed and was not implemented here.
