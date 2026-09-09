# Plan 006: Define coherent flows before generating their tests

Status: PROPOSED. Priority P1. Effort L. Risk medium. Category: architecture/correctness.
Planned September 9, 2026 at `3af0cb0f`, including substantial uncommitted work.

## Outcome and product rule

The expense API page currently presents multiple independently accepted scenario portions under the broad flow “Manage expenses through the documented API.” Define independently meaningful behaviors during claim extraction and flow synthesis instead. A flow describes one behavior or dependent journey. Milestones describe its dependent checkpoints; cases describe variations of that same behavior. Sharing an endpoint, entity, document section or observation method does not establish a journey.

Examples to validate against actual source claims: keep create → retrieve → update → delete as a lifecycle flow when each transition acts on the same expense; give category validation, amount validation, date validation and route-ID validation their own flows. Category enum values remain cases of category validation. Do not make one flow per HTTP call, case value, or generated YAML file. Setup may create an expense without making “create expense” an asserted milestone of every validation flow.

Publish one current, fully reviewed scenario per generated flow and execution surface. API and browser realizations may remain distinct when they verify the same complete behavior. A mixed-driver journey may use supported setup and assertion composition; this proposal does not prohibit that. Preserve incomplete authoring work as resumable drafts/evidence, not extra published passing tests. A complete reviewed scenario that reveals an application defect is still a valid failing test.

This proposal changes the publication policy recorded in Plan 001 and the earlier index decisions. It retains case evidence, complete-coverage checks, bounded repair and honest blockers. Plans 004–005 must be reconciled with this proposal before implementation; they currently assume independently published partial scenarios. No source behavior changes merely by writing this plan.

## Current state and drift check

Run `git diff --stat` and `git diff --stat 3af0cb0f..HEAD` before implementation. Compare these excerpts against the working tree, not just HEAD. Preserve unrelated local work.

- `packages/core/src/services/guard-generate/extract.ts`: `check_claims` and the extraction prompt already require concrete behaviors and compatible case conditions. Compound same-scope behaviors can still need separation here; synthesis cannot rewrite claim text.
- `packages/core/src/services/guard-generate/flows.ts`: the prompt already says a one-milestone validation flow is valid and to compose only dependent paths.
- `packages/guard-generator/src/flows.ts`, `validateAreaSynthesis`: `groups.size > 1` rejects differing `verificationGroup` values. Matching scope/method/conditions does not establish semantic dependence. `applySubsumption` currently prefers longer containing milestone sequences.
- `packages/core/src/services/guard-generate/flow-worker.ts`: “You may submit multiple scenarios for distinct, independently verifiable portions of this flow.”
- `packages/guard-generator/src/generate.ts`: `if (state.priors.size === 0 && state.acceptedSha) { id = assignScenarioId(...) }` creates identities for additional accepted portions. The stash fold persists accepted subsets independently of terminal outcome.
- `packages/shared/src/guard/proof.ts`: `scenarioMilestoneScopeDefect` validates selected milestones, whereas `coversFlowMilestones` checks complete obligations. These are different contracts and remain useful.
- `packages/shared/src/guard/flows.ts`: identity resolution uses milestone overlap; a split requires careful handling of previous IDs and fingerprints.
- Both `apps/dashboard/client/src/components/guard/GuardFlowDetail.tsx` and its preview/vendor copy render scenario rows. Hiding rows here would lose information without repairing generation.

## Implementation scope

Use the files above, shared guard scenario/manifest/dashboard contracts as needed, `packages/core/src/commands/guard-read.ts`, generation prompt/fidelity/cache modules, their centralized tests, README.md, PLAN.md and plans/. Mirror changed browser contracts in the existing preview/vendor copies. No new package is required. Follow Zod schemas and the existing generator-to-core injected-session pattern. Follow `tests/guard-generator/partial-coverage.test.ts` for fixture ownership and cleanup.

Do not modify unrelated dependency UI, database schema, runner isolation or agent-loop budgets. Do not start/stop dev servers or trigger live generation as part of implementation. Use existing persistence adapters; preserve prior results. Do not concatenate existing scenario YAML or rewrite historical runs.

## Steps

### 1. Enforce behavior boundaries before authoring

Add synthesis regression fixtures covering the expense rules above, two unrelated API claims with identical verification metadata, a coherent lifecycle, and multiple boundary values of one rule. Repair extraction when a single claim combines unrelated behaviors, preserving source attribution and accounting for every clause. Version the corresponding prompt/cache inputs.

Have multi-milestone synthesis supply a source-grounded explanation of how each checkpoint contributes to the shared transition or consumes preceding state. Validate reference structure deterministically; have semantic review evaluate whether the claimed relationship is supported by the source. Do not pretend a connected graph or a model-authored explanation proves coherence. Return precise grouping defects for bounded synthesis correction, and validate the final corrected outcome before persistence. Reject unresolved broad groupings without dropping claims. Keep the semantic check within the existing session architecture, injected from core.

Only apply subsumption to validated coherent paths with equivalent behavior and conditions. A broad invalid umbrella must never remove valid standalone validation flows. Reuse checks between the session tool and final fold.

Verify: `pnpm exec vitest run tests/core/guard-generate-extract-session.test.ts tests/core/guard-generate-flows-session.test.ts tests/guard-generator/flows.test.ts` passes. Scripted reviewers test orchestration; a separately recorded real-model evaluation is necessary to assess semantic grouping quality.

### 2. Separate authoring progress from published tests

Keep partial submissions available for execution, evidence review and continued repair. Persist them through an explicit draft/checkpoint lifecycle supported by the existing stores, scoped by flow, surface and input/review fingerprints. They must survive an interrupted session without entering the ordinary runnable scenario inventory as passing tests. Add a distinction in shared contracts rather than inferring draft status from filenames.

Maintain a stable identity for the current generated scenario per flow/surface. Publish or replace it atomically only after that complete scenario has executed and fidelity review covers all its required obligations. Per-case union across independent drafts cannot prove a dependent lifecycle. Re-execute and review the complete artifact; do not concatenate drafts or reuse their verdict as its verdict. Allow reviewed application failures; missing review or incomplete assertions remain incomplete.

Remove the fresh-generation suffix allocation for accepted portions. Reconcile worker prompts, all driver authoring prompts, one-shot paths, edit mode, cache replay and manifest folding with the same publication rule. Preserve hand-authored scenarios and explicit complete alternate-driver realizations.

Verify: `pnpm exec vitest run tests/guard-generator/flow-worker.test.ts tests/guard-generator/partial-coverage.test.ts tests/guard-generator/completion-regression.test.ts tests/core/guard-generate-worker-seam.test.ts tests/core/guard-generate-session-cache.test.ts` passes. Cover accepted draft then blocked, restart/resume, full green publication, full reviewed red publication, changed fingerprints, and stale/unreviewed draft rejection.

### 3. Regenerate safely and expose the correct inventory

Make synthesis and publication-policy fingerprints invalidate incompatible cache entries naturally. On regeneration, resolve splits through explicit source/milestone lineage: an old umbrella's ID/result must not imply every successor is covered. Retain history and require current reviewed proof for each successor. Replace generated current inventory only through the normal persistence transaction/fold after a valid replacement corpus exists; a failed synthesis must not erase existing artifacts.

Read old multi-scenario manifests honestly until regeneration. Do not hide legacy rows or relabel them as complete canonical tests. New inventory has separate flow rows and one steps panel per selected complete realization; incomplete authoring reports progress and the remaining blocker. If multiple complete drivers exist, make driver selection explicit. Apply equivalent behavior to original and preview UI.

Verify: `pnpm exec vitest run tests/shared/guard-flows.test.ts tests/guard-generator/flows.test.ts tests/server/guard-flows.test.ts tests/dashboard-client/guard-flows.test.tsx tests/dashboard-client/preview-tests-runs-real.test.tsx` passes. Include split identity, no inherited pass, failed regeneration preserving old artifacts, legacy visibility and independent-flow navigation regressions.

### 4. Reconcile documentation and validate

Update README.md and root PLAN.md when implementing, explicitly replacing the earlier policy of publishing partial scenarios. Update the conflicting portions of Plans 004–005 and the plan index. Keep completed historical validation records intact.

Run `pnpm --filter @truecourse/shared --filter @truecourse/guard-generator --filter @truecourse/core --filter @truecourse/dashboard-client typecheck`, `pnpm test`, and `git diff --check`. All must exit zero; report unrelated baseline failures separately without suppressing them. Do not claim live expense-tracker verification from fixture tests. A later authorized regeneration verifies actual flow names, obligation preservation, lineage, and the resulting detail pages.

## Done criteria and review risks

- Regression fixtures reject unrelated same-method API groupings and retain dependent journeys.
- Every original required claim/case remains accounted for after splitting.
- A partial draft survives interruption but cannot appear as a published passing test.
- One complete reviewed artifact is current per generated flow/surface; retries replace it safely.
- Split successors receive no inherited verdict without fresh compatible evidence.
- Historical results and hand-authored scenarios remain readable.
- Targeted tests, package typechecks, full tests and whitespace checks pass.

Report a concrete design blocker before expanding scope if checkpoint durability requires an unplanned storage migration or if source claims cannot support the proposed grouping. Do not classify semantic independence with title keywords or a maximum milestone count. The central review risks are false grouping, flow proliferation, lost obligations and invalid reuse of coverage across splits.

This is a scoped proposal, not a repository-wide security/performance audit. No implementation or tests ran during planning.
