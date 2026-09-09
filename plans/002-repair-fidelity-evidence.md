# Plan 002: Repair evidence metadata inside fidelity review

STATUS: COMPLETE
Priority: P1. Effort: M. Risk: medium. Depends on implemented Plan 001. Category: correctness. Confidence: high, reproduced from stored inputs.

## Problem and incident

Generation `cd2ec0ff-d11c-4c09-a553-5f3b686e2ec3`, repo `spiderhands/expense-tracker`, commit `58899f746bc470cfafb802d1cb27b35893631ad6`, ended with 6/17 complete flows. The empty-ledger worker `65a646a2-a159-43c1-a109-e5b75d5efd4a` passed browser execution but retired after repeated evidence rejection.

At activity cursor 360 its scenario asserted pristine empty-state text on steps 6 and 7, tagged `milestone: 3, checks: [empty-ledger-state]`. Steps 10 and 11 asserted the filtered-empty presentation but had no checks annotation. At cursor 377 reviewer `4d12b1a7-e83c-4ace-9174-fd520c5db25a` returned faithful and cited steps [6,7,10,11] for that case. At cursor 380 the engine rejected it because every cited proof step must carry the matching annotation. This cycle repeated five times. It is an evidence-contract failure, distinct from a reviewer finding a weak assertion.

The fix must retain strict independent proof, repair malformed references before accepting/caching the review, and give precise diagnostics when scenario annotations actually need author repair.

## Current state and scope

- packages/shared/src/guard/proof.ts, `caseEvidenceDefect`: currently returns a string, including `Case ${p.milestone}/${id} cites a step that does not assert that case on its proof driver.` It does not report the offending indices or distinguish invalid metadata from missing assertions.
- packages/guard-generator/src/generate.ts, `WorkerFidelityInput`: contains flowFingerprint, sectionKeys, scenarioBehavior and briefing, but no typed proof context. In settleSubmission: `if (defect) verdict = { kind: 'flagged', mismatch: defect, confidence: 'high' }`. This consumes semantic rejection handling and taints the flow.
- packages/core/src/services/guard-generate/fidelity.ts, `judgeWorkerFidelity`: schema-valid cached verdicts return immediately; completed child output is cached before generator evidence validation. `fidelitySessionDef` has a five-turn budget and can use the generic SessionDef.validateOutcome from Plan 001.
- packages/core/src/services/guard-generate/flow-worker.ts and run.ts: parent tool feedback and completion cache integration.
- tests/core/guard-generate-worker-seam.test.ts: existing fidelitySessionDef/judgeWorkerFidelity test patterns. tests/shared/guard-case-evidence.test.ts and tests/guard-generator/completion-regression.test.ts cover proof and persistence.

In scope: these files, package exports/types directly affected, prompt/cache pins, tests/fixtures/guard-completion, tests/cli/guard-adjudication-e2e.test.ts, tests/llm-drivers/session-driver-conformance.test.ts, README and plan status docs. Out of scope: lowering proof requirements, changing UI labels, data isolation, broad extraction redesign, live result rewrites.

## Steps

### 1. Return structured, actionable evidence issues

Add a browser-safe evidence validation result carrying issue kind, milestone, caseId, cited step index, actual driver/milestone/checks where applicable, and eligible tagged assertion indices. Cover missing/duplicate evidence, out-of-range/non-integer references, unselected cases, wrong drivers and untagged/non-asserting references. Retain caseEvidenceDefect as a compatibility formatter for existing consumers while migrating relevant callers.

Keep `steps` as proof-bearing assertion references. Context/supporting actions may inform the reason but do not become proof automatically. Require at least one real, correctly annotated assertion for every selected case. Do not auto-tag scenario steps, silently trim citations or infer semantic fidelity from metadata.

Verify: `pnpm exec vitest run tests/shared/guard-case-evidence.test.ts tests/shared/guard-proof-browser.test.ts` passes, including explicit bad steps 10/11 and correct candidates 6/7.

### 2. Validate the child before it completes or caches

Extend WorkerFidelityInput with immutable typed milestone/scenario-step context derived by the engine. Do not parse the prose briefing to recover it. Pass this into fidelitySessionDef and use validateOutcome on faithful outputs. A malformed evidence response receives the exact issues and eligible indices, then resumes the same child within its existing budget. A semantically flagged verdict remains a legitimate result.

Teach the reviewer the precise annotation contract. It may correct its citations if the already-tagged assertions prove the selected claim. If required proof is absent or needs scenario changes, it must describe that specific semantic/annotation defect rather than invent valid metadata. For the stored example, separate the selected pristine-state case from unrelated source requirements; missing extracted requirements must not silently expand that case.

Apply the same validation to cache reads. Invalid cached faithful evidence is a review miss, not an immediate generator rejection. Write cache entries only after validation. Bump relevant prompt/policy fingerprints; validate runtime context even on current-version hits. No global cache deletion.

Verify: `pnpm exec vitest run tests/core/guard-generate-worker-seam.test.ts tests/core/guard-generate-session-cache.test.ts tests/llm-drivers/session-driver-conformance.test.ts` passes. Add invalid cached verdict, correction success, repeated invalid output exhaustion and both provider continuation cases.

### 3. Keep structural failure separate from semantic rejection

Retain generator-side validation as a defensive check for injected judges and future callers. An invalid evidence result must name exact steps and not increment semantic fidelityFlags, taint the flow, or create a false high-confidence claim failure. Route an exhausted/malformed review through explicit review-unavailable handling, preserving the artifact as unreviewed and keeping generation incomplete. A parent tool report must distinguish review unavailable, malformed evidence, and an actual weak test.

Cache/persistence must never grant coverage or a completion hash for unresolved review. Expected-red scenarios use identical validation rules and remain failing, not passing. Record review repair in the session transcript and account for its real usage.

Verify: `pnpm exec vitest run tests/guard-generator/completion-regression.test.ts tests/guard-generator/flow-worker.test.ts tests/cli/guard-adjudication-e2e.test.ts tests/server/guard-flows.test.ts` passes. Assert that actual semantic failures still taint/reject, while structural defects do not.

### 4. Preserve a permanent incident regression

Create a minimal sanitized fixture under tests/fixtures/guard-completion with milestone/case metadata, the 11-step shape, and reviewer evidence [6,7,10,11]. Do not depend on /tmp files or live DB access. Script a corrected reviewer response only if the cited tagged assertions establish the selected case; separately test a genuinely missing assertion that requires worker repair and cannot be repaired by changing references. Assert bounded child repair, no repeated semantic retirement, correct cached evidence and incomplete status on failure.

Verify: the above targeted tests plus all final gates. Document proof-reference semantics and review failures in README.

## Done criteria

- [x] The stored malformed-reference pattern repairs within the review session or reports a precise review failure.
- [x] An invalid faithful cache entry never short-circuits validation.
- [x] Missing assertions cannot be converted into proof by citation edits.
- [x] Semantic rejection counts and taint are unaffected by structural metadata errors.
- [x] Exhaustion preserves unreviewed artifacts and null completion hashes.
- [x] Targeted and final gates pass; status docs are updated.

Maintenance: future evidence fields, selected-case identities or review policy changes must update child validation, cache validation and generator fallback together. Keep one validator rather than divergent rules in each layer.

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

Implementation: structured evidence issues and typed proof context now validate reviewer output before completion and cache writes. Invalid citations resume the existing child within its cumulative budget; the generator fallback records annotation defects without semantic taint. The permanent empty-ledger fixture reproduces references [6,7,10,11]. Tests cover valid repair, malformed references, stale cache context, actual missing proof, exhausted review and retirement without a semantic penalty.

Live rollout validation: **NOT RUN** for this implementation. The previously analyzed generation remains historical evidence. No deployment, DB mutation, hosted generation or user dev-server management was performed. The code implementation and local validation are complete; live rollout remains separately NOT RUN.

Validation: **COMPLETE**. `pnpm --filter @truecourse/core... build`, core and dashboard-client typechecks, and `git diff --check` passed. Final `pnpm test`: **699 files passed, 13,355 tests passed, 32 existing skips**. The private-state and completion-browser regressions executed against real HTTP servers and Chromium. No live-model quality or hosted rerun result is inferred from these fixtures.
