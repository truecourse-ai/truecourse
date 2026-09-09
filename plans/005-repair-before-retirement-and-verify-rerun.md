# Plan 005: Repair recoverable failures before retirement and verify the complete path

STATUS: COMPLETE
Priority: P1. Effort: M. Risk: medium. Depends on Plans 002, 003 and 004. Category: correctness and regression coverage. Confidence: high.

## Problem and incident

Expense-tracker generation `cd2ec0ff-d11c-4c09-a553-5f3b686e2ec3` ended with 6/17 flows complete. Its main lifecycle worker retired after 12 turns, empty-ledger after 19, and API lifecycle after 15; none ended budget-exhausted. The API worker correctly preserved three accepted portions covering 11/15 cases, but left ordinary description/notes checks unattempted alongside an aggregate-state blocker.

The main lifecycle worker's final candidate had dropped its difficult total case but was rejected because Cancel was tested with Amount blank. Its terminal explanation still named the old total problem. A valid submitted portion was never accepted, so Plan 001 preservation could not save any UI scenario. The engine should direct repairs using the current per-case finding and preserve independently valid portions, without demanding impossible work or silently accepting weak tests.

## Current state and scope

- packages/guard-generator/src/generate.ts: WorkerTaskState tracks pendingFidelityFinding and rejectionByObligation; after repeated flags the tool says `Either author a scenario that genuinely verifies the milestones, or end the session with a retired outcome.` validateTaskOutcome validates settled coverage and some blocked milestone ownership but does not reconcile retired explanations with current case evidence.
- packages/core/src/services/guard-generate/flow-worker.ts: already tells the worker to submit useful portions and repair locators; instructions alone did not achieve that in the observed run.
- packages/shared/src/guard/flows.ts: retired requires attempts/lastEvidence, blocked uses perMilestone. It has no current per-case remainder disposition.
- packages/agent-loop/src/agent-loop.ts: generic validateOutcome already resumes under the same budget. Reuse it; no guard-specific logic belongs here.
- tests/guard-generator/completion-regression.test.ts and tests/guard-runner/completion-browser.test.ts: patterns for scripted session plus real-browser healthy/broken fixtures. tests/core/guard-generate-worker-seam.test.ts covers adapters.

In scope: these files and affected cache/read/projection/serialization modules, shared outcome exports, tests/fixtures/guard-completion, tests/core, tests/guard-generator, tests/guard-runner, tests/server, README and status docs. Out of scope: automatic database deletion, live regeneration without user authorization, larger budgets as the primary fix, arbitrary JavaScript assertion support, app patches, request interception and authored timezone switching.

## Steps

### 1. Track repair state by outstanding obligation

Store current issue category, observed evidence, selected candidate/review identity and whether a repair has already been requested for each assigned obligation. Categories must distinguish assertion/locator/annotation defects from unavailable preparation, unsupported observation and review-service failure. Reuse Plan 002 structural issues and Plan 004 obligation keys; do not infer categories from prose matching.

Clear only the cases actually repaired by current accepted evidence. Source omissions/matcher gaps are not worker failures. Expose concrete missing assertions/arrange conditions in submission feedback and the next session continuation. For cancellation, require a fully valid unsaved form, visible dialog before Cancel, closure after Cancel, and a check that the valid draft was not saved. A blank required field must not provide the only reason nothing was saved.

Verify: `pnpm exec vitest run tests/guard-generator/completion-regression.test.ts tests/guard-generator/flow-worker.test.ts tests/guard-runner/completion-browser.test.ts` passes. Add the incident valid-vs-invalid Cancel fixture and a broken handler that attempts submission.

### 2. Reconcile incomplete outcomes without creating infinite retries

Add a structured remaining-obligation disposition to new retired/blocked worker outputs, using current case IDs and a reason category plus observed evidence. Maintain schema readability for historical outcomes but require complete current dispositions in new explicit-case sessions. An unsupported or unavailable-preparation case may stop immediately when the engine's evidence supports it. Cancellation, transport failure and real budget exhaustion must still terminate promptly.

When a terminal explanation is stale, references covered/unassigned cases, or uses one blocker to abandon unrelated repairable cases, return one targeted corrective request for that unchanged issue set. Request repair or separate submission of independent valid portions. Use existing cumulative budget; no extra session and no unbounded refusal loop. Track the issue-set identity so repeated lack of progress terminates as incomplete with accurate diagnostics rather than looping or falsely settling. Do not fabricate a minimum attempt count or require model reasoning text.

The parent cannot automatically trim a rejected candidate and call it faithful. Any revised portion must execute and receive independent review. Expected application failures remain reviewable authored tests and must not be softened to obtain passing status.

Verify: `pnpm exec vitest run tests/agent-loop/agent-loop.test.ts tests/guard-generator/completion-regression.test.ts tests/core/guard-generate-worker-seam.test.ts tests/llm-drivers/session-driver-conformance.test.ts` passes. Cover stale total explanation after cancellation rejection, real preparation blocker, unattempted independent boundaries, no-progress terminal retry bound, cancellation and wrap-up outcomes.

### 3. Reproduce the entire rerun with permanent fixtures

Add sanitized fixtures capturing: reviewer references [6,7,10,11]; shared baseline count 8 plus six own records with eight concurrent foreign inserts; missing description link alongside valid order cases; mixed POST/UI and createdAt/UI requirements; and invalid Cancel setup followed by corrected valid setup. Keep fixture data in tests/, not /tmp or a DB dependency. Use recorded tool/result shapes, not private reasoning transcripts.

Combine real runner execution with deterministic scripted reviewer/worker responses. Assert valid portions persist, all remaining cases have exact dispositions, complete flow hashes require reviewed full coverage, birth and subsequent run use identical preparation, and the known application fixtures pass. Deliberately break counts, sort directions, cancellation and post-save transitions and require failures. Test cold generation, cached complete replay, incomplete retry and altered setup/assignment invalidation.

Verify: `pnpm exec vitest run tests/guard-generator/completion-regression.test.ts tests/guard-runner/completion-browser.test.ts tests/server/guard-flows.test.ts tests/shared/guard-proof-browser.test.ts` and the final gates pass. Do not present scripted reviewers as a real-model quality test.

### 4. Document and verify rollout

Update README and root PLAN.md with the evidence-repair, isolation, matching and retirement contracts. Keep Plan 001 marked implemented; record its live rerun as revealing the follow-up defects rather than claiming implementation tests guaranteed complete live generation.

After code validation and deployment, a new user-authorized hosted generation should reuse current records and invalidate affected caches through fingerprints. Regenerate the setup bundle/catalog only if its preparation or action contract changed; do not delete historical DB rows. Inspect the new activity transcript, per-case manifest and following Guard Run for: no repeated malformed-evidence rejection, no shared-data count drift, planned browser cases retained despite independent gaps, correct incomplete explanations, and actual reviewed full coverage for supported cases. Real application failures and unsupported capabilities remain visible. Record run IDs and actual coverage; do not require every flow to pass when its needed executor capability is absent.

## Done criteria

- [x] Latest rejection and terminal remainder explanations agree case by case.
- [x] A repairable case is not abandoned solely because an unrelated case blocks.
- [x] No-progress recovery is bounded within existing session budgets.
- [x] Real cancellation/transport/exhaustion terminates without losing accepted work.
- [x] Regression fixtures distinguish weak tests, metadata defects, isolation defects and app failures.
- [x] All implementation gates pass and docs are current.
- [x] Live rollout validation is recorded separately as NOT RUN, COMPLETE, or incomplete with concrete reasons; never implied by scripted tests.

Maintenance: keep repair categories aligned with validator/runner error types. A future new case or capability must not silently expand an existing accepted proof. Review outcome schema/provider compatibility whenever dispositions change.

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

Implementation: current remainder rows carry case identity, reason category, evidence and a stable issue ID. A single corrective request is allowed for an unchanged behavioral issue set, excluding timing, generated IDs and changing reviewer prose. Successful probes clear obsolete execution findings without supplying reviewed proof. Independent accepted portions survive failure, budget exhaustion and retirement; annotation/review availability problems do not consume semantic retirement penalties. The Cancel fixture uses a fully valid draft and detects both an unclosed dialog and accidental save, with an explicit regression showing how a blank Amount masks the defect. Scripted worker/reviewer tests validate routing and persistence; they do not measure live-model generation quality.

Live rollout validation: **NOT RUN** for this implementation. The previously analyzed generation remains historical evidence. No deployment, DB mutation, hosted generation or user dev-server management was performed. The code implementation and local validation are complete; live rollout remains separately NOT RUN.

Validation: **COMPLETE**. `pnpm --filter @truecourse/core... build`, core and dashboard-client typechecks, and `git diff --check` passed. Final `pnpm test`: **699 files passed, 13,355 tests passed, 32 existing skips**. The private-state and completion-browser regressions executed against real HTTP servers and Chromium. No live-model quality or hosted rerun result is inferred from these fixtures.
