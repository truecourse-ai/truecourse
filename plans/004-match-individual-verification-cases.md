# Plan 004: Retain executable cases when another case cannot be matched

STATUS: COMPLETE
Priority: P1. Effort: L. Risk: high, changes assignment and compatibility. Depends on implemented Plan 001; integrate Plan 003 preparation metadata before final validation. Category: correctness. Confidence: high.

## Problem and incident

In generation `cd2ec0ff-d11c-4c09-a553-5f3b686e2ec3` for spiderhands/expense-tracker at commit `58899f746bc470cfafb802d1cb27b35893631ad6`, the main seven-milestone lifecycle lost three entire milestones before authoring:

- Post-save UI checks were excluded because the web claim also named HTTP POST.
- Table columns and both ordering cases were excluded because the catalog mapped View but not the description link.
- Prefilled/edit/cancel/reload checks were excluded because another case required the original creation timestamp, which is not visible in the UI.

Filter/pagination received invalid matcher output after its corrective retry. Some web-scoped claims advertised API proof drivers, producing avoidable unsupported-driver gaps. Completion accounting cannot recover cases excluded from worker assignment.

## Current state and scope

- packages/guard-generator/src/schemas.ts: RealizationStepSchema is `{interfaceId, milestone, note?}`; RealizationGapSchema is `{milestone, kind: mapping|capability, reason}`.
- packages/guard-generator/src/match.ts: `matchReferenceIssues` rejects `milestone ${gap.milestone} appears in both plan and gaps; use one disposition`. `matchFlow` aggregates all verification requirements and removes whole milestones for a capability gap. RealizationPlan contains interfaces and milestone numbers, not selected case IDs.
- packages/shared/src/guard/verification.ts: cases carry requires/conditions; verificationBoundaryProblems checks declared metadata. It cannot detect protocol semantics hidden in prose that falsely declares only browser requirements.
- packages/core/src/services/guard-generate/extract.ts and flows.ts, packages/guard-generator/src/flows.ts: extraction/composition and scoped requirement validation.
- packages/guard-generator/src/generate.ts: taskProgress derives assignment using plan.steps milestone numbers; coverage gaps and final reconciliation are also milestone based.
- packages/shared/src/guard/coverage-progress.ts, flows.ts, manifest.ts, report.ts: identity/proof/gap persistence; packages/core/src/commands/guard-read.ts projects coverage.
- packages/core/src/services/guard-setup/reconcile-interfaces.ts and interfaces-step.ts, packages/core/src/services/interface-author/draft.ts and session.ts: catalog repair boundary. Read these before changing missing-action handling.

In scope: these files, affected generator/core prompt/cache/serialization modules and shared exports, tests/shared, tests/guard-generator, relevant tests/core and tests/server, mechanical preview schemas if their contracts change, README/status docs. Out of scope: claiming the browser can observe invisible protocol state, blanket API proof for UI requirements, automatic app code edits, arbitrary locator invention and redesigning dashboard labels.

## Steps

### 1. Split observation boundaries and source cases accurately

Extract UI post-save behavior independently from the HTTP method contract; extract UI edit persistence separately from API identity/createdAt metadata. Extract pristine empty-state and filtered-empty presentation as explicit source-grounded cases or separate condition-compatible claims. Preserve primary-date and same-date-ID ordering independently. Keep linked cases that require one common transition together; do not erase their prerequisites by splitting.

Strengthen extraction/composition instructions and their structured validation; use explicit scope/requires metadata, not regex guesses about prose. When semantic ambiguity remains, report a precise upstream boundary defect rather than pretend deterministic metadata validation proves prose correctness. Persist the source references and invalidate affected extraction/composition hashes; never relabel old review evidence onto new case IDs.

Verify: `pnpm exec vitest run tests/core/guard-generate-extract-session.test.ts tests/core/guard-generate-flows-session.test.ts tests/shared/guard-verification.test.ts tests/guard-generator/partial-matching.test.ts` passes. Add all three mixed requirements and distinct empty-state cases as fixtures; distinguish orchestration stubs from real-model semantic evaluation.

### 2. Make realization and gaps address case IDs

Add `checks?: string[]` to each single-milestone realization step/gap, required and nonempty for new explicit-case outputs. Legacy milestones without case metadata retain their existing interpretation. Normalize legacy cached explicit-case plans only if a full milestone assignment can be proven; otherwise miss the cache and re-match. Never interpret missing checks as an empty successful assignment.

Normalize plan disposition by `(milestone, caseId, surface)`. Multiple grounded actions may serve a case; their order is retained. A case cannot be both planned and gapped on the same surface, but different cases of one milestone may be. Reject unknown IDs, duplicated gap dispositions and unsupported assigned observations; derive missing dispositions explicitly. Match each case's requirements, not the union of unavailable sibling requirements. Prepared steps remain part of the ordered path and cannot count as proof by themselves.

For persisted multi-milestone gaps, add a shared obligation reference shape such as `{milestone, caseId}` and an optional obligations array; preserve existing milestones for old readers. Carry it through report, manifest and read models. Never remove a sibling case's gap merely because a different case of the same milestone passes.

Verify: `pnpm exec vitest run tests/guard-generator/partial-matching.test.ts tests/shared/guard-coverage-progress.test.ts tests/server/guard-flows.test.ts` passes. Cover planned sort cases plus missing link case, overlap rejection, invalid IDs, legacy behavior and multiple compatible drivers. Confirm the named test files exist before execution; add focused files when needed.

### 3. Thread exact assignment through workers, proof and caches

Update RealizationPlan, author context, taskProgress, preflight, worker completion hints, confirmCached, final persistence and read projections to use assigned obligation keys. A worker must not wait for gapped sibling cases or claim their completion. Full flow coverage still requires every required case; a worker's settled assignment is not a settled whole flow. Retained valid proof from other tasks remains usable only under matching scope, bindings and review version.

Include selected assignments, gap semantics and preparation identity in match/worker/generation hashes. Update cost estimation to use the same planner as execution. Add a regression where two supported cases settle while one missing-action case remains incomplete with no flow completion hash, including subsequent cache replay and case resolution.

Verify: `pnpm exec vitest run tests/guard-generator/completion-regression.test.ts tests/guard-generator/partial-coverage.test.ts tests/core/guard-generate-worker-seam.test.ts tests/core/guard-generate-session-cache.test.ts tests/server/guard-flows.test.ts` passes.

### 4. Repair missing catalog actions without hiding remaining work

Emit an actionable catalog gap for the description link with source/place/context references. Extend the existing setup/interface-author reconciliation path to request that concrete supporting action; validate its locator in the target page before it can supply a plan. Preserve View and other valid mapped actions. No unbounded generation-to-setup recursion: at most one bounded catalog repair attempt per missing-action identity in a generation; if the existing ownership architecture requires an explicit setup run, persist that exact action as the next step instead of silently running unrelated setup.

Preserve the matcher's failed response and exact schema/reference issues in diagnostics. Invalid JSON/empty plan should produce a recoverable matcher error, never a fabricated capability gap. Maintain the existing bounded corrective retry.

Verify: `pnpm exec vitest run tests/interface-author/draft.test.ts tests/core/guard-setup-reconcile.test.ts tests/guard-generator/partial-matching.test.ts tests/server/guard-flow-alternatives.test.ts` passes; add real-browser description and View navigation checks to tests/guard-runner/completion-browser.test.ts where absent. Then run final gates.

## Done criteria

- [x] Missing description navigation does not suppress table/order cases.
- [x] UI post-save/edit cases are authorable independently of protocol/metadata contracts.
- [x] Every plan/gap/cache/persist/read path agrees on case identity and scope.
- [x] Partial planned work cannot mark a whole flow complete.
- [x] Legacy artifacts remain readable and obsolete assignments do not become completion hits.
- [x] Grounded catalog repair is bounded and leaves precise gaps when unsuccessful.
- [x] Targeted and final gates pass; status docs are updated.

Maintenance: any future observation, preparation condition or alternative driver must be checked at case assignment, worker completion and final coverage. Do not solve missing metadata by broadening all drivers.

## Working constraints and validation baseline

Planned September 9, 2026 at commit `3af0cb0f` **plus the existing uncommitted working tree**, including Plan 001. Run `git status --short` and compare the excerpts below with live source before editing. A commit-only diff does not capture this baseline. Preserve unrelated edits. Use the `sm/` branch prefix if a branch is needed; no commit, push or deployment is requested by this plan.

The repository is TypeScript/pnpm. Engine code lives in packages/guard-generator and packages/guard-runner; core owns session orchestration; browser-safe schemas belong in packages/shared. All tests live under root tests/. Follow existing Vitest fixtures and dependency-injected session seams. Never add Node-only hashing imports to the shared browser entry point. No dev-server management and no live DB writes. The hosted guard store uses PostgreSQL even though older AGENTS storage notes describe the local analysis store.

The last implementation baseline passed 694 files / 13,298 tests with 32 existing skips, plus package builds and core/dashboard typechecks. Those results precede these plans and do not validate them. Some integration tests import built packages: rebuild core and its dependencies before final integration testing.

Final gates for this plan:

```sh
pnpm --filter @truecourse/core... build
pnpm --filter @truecourse/core typecheck
pnpm --filter @truecourse/dashboard-client typecheck
pnpm test
git diff --check
```

Each must exit zero. Real-browser regressions must execute in Chromium, not silently skip. Local fixture servers are test processes; do not start or restart the user's dev servers. Record actual results and update this plan, plans/README.md and root PLAN.md. README must document any new contract. If evidence or architecture contradicts a design assumption, investigate and revise the plan explicitly; do not weaken coverage or silently substitute a workaround.

## Implementation record — September 9, 2026

Implementation: explicit checks identify each planned or blocked case. Capability and preparation filtering retain supported siblings, and runtime/estimate share assignment fingerprints and preparation partitioning. Historical fresh-state metadata still requires an empty profile. Extraction and synthesis preserve full case metadata and reject incompatible proof-driver claims. Manifest, report and dashboard reads preserve exact obligation references, including schema round trips. Missing catalog actions produce source-specific interface-authoring instructions; no additional in-generation web authoring seam was introduced. Tests cover missing description navigation alongside table/order cases, UI/protocol boundaries, assignment conflicts, cache changes, missing profiles and invalidated retained proof.

Live rollout validation: **NOT RUN** for this implementation. The previously analyzed generation remains historical evidence. No deployment, DB mutation, hosted generation or user dev-server management was performed. The code implementation and local validation are complete; live rollout remains separately NOT RUN.

Validation: **COMPLETE**. `pnpm --filter @truecourse/core... build`, core and dashboard-client typechecks, and `git diff --check` passed. Final `pnpm test`: **699 files passed, 13,355 tests passed, 32 existing skips**. The private-state and completion-browser regressions executed against real HTTP servers and Chromium. No live-model quality or hosted rerun result is inferred from these fixtures.
