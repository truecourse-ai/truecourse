# Plan 001: Complete required guard checks before ending generation

STATUS: COMPLETE

## Purpose and priority

P1 correctness work. Effort: L across six reviewable changes. Risk: medium; the outcome gate affects shared session infrastructure, and assertion changes affect serialized scenarios. Planned on September 9, 2026 against commit `3af0cb0f` **plus the existing uncommitted working tree**. No implementation or live regeneration was performed while writing this plan.

The engine should retain useful partial tests and continue generating missing checks. It must never obtain a complete result by dropping difficult assertions. Generation is complete when every required obligation has current, reviewed executable evidence. Execution is passing only when every required scenario passes. A reviewed test exposing an application defect may complete generation while leaving execution failing.

## Observed incident and evidence

Read-only PostgreSQL inspection identified:

- Repository `spiderhands/expense-tracker`, commit `58899f746bc470cfafb802d1cb27b35893631ad6`.
- Generation activity `a724334e-f3e1-4602-a4d0-b00cd51d91eb`.
- Worker `023cd2c9-0247-4b2d-bf17-298c271386ad`, work item `flow:add-an-expense-and-open-its-details:web`.
- Execution run `2026-09-09T11-58-35Z_6fe9e137`.
- The worker completed with a `settled` outcome after 15 turns. There was no terminal budget-exhaustion failure. A recovered API retry happened earlier. The worker ran live; a cache hit did not cause this incident.
- Early drafts included cancellation and post-save checks. Three YAML parsing failures preceded browser execution. A post-save locator searched for a status element with accessible name `Expense added.`; it failed although the captured page text contained that message. The next draft omitted the post-save obligation.
- Fidelity rejected missing row values once, then missing dialog-closure proof twice. The last cancellation draft reopened the dialog and asserted visibility, which cannot prove it closed previously. The final draft removed cancellation.
- Activity cursor 480 accepted the reduced scenario and returned: `Verified milestone(s): 4, 5 ... Continue with remaining obligations, or finish with:` followed by a settled outcome. Cursor 492 recorded the worker using that outcome.
- The saved manifest contains one passing scenario, five reviewed cases of ten, `generationInputsHash: null`, and generation gaps for milestones 1, 2, and 3.
- The approved ordering case used two records with the same date. It demonstrated the ID tie-breaker, but not primary date-descending ordering.

These facts were verified in `activity_runs`, `activity_events`, `guard_scenario_sets`, `content`, and `guard_runs`. Reproduction tests must use small synthetic fixtures; they must not connect to the user's database or depend on temporary investigation files.

## Current implementation and drift checks

Repository root: `/Users/smat/projects/work/inconcept-labs/github/truecourse-ai/truecourse`.

Run `git status --short` and `git diff --stat 3af0cb0f..HEAD -- packages tests` before implementation. HEAD does not include the in-progress changes this plan inspected. Preserve those changes; compare the symbols and excerpts below against live files before editing. Do not reset or overwrite unrelated work.

- `packages/core/src/services/guard-generate/flow-worker.ts`, `WORKER_ADDENDUM`: explicitly permits selecting an independently verifiable subset and says one passing portion does not complete a flow. Preserve partial acceptance.
- `packages/guard-generator/src/generate.ts`, `acceptSubmission`: currently emits `Continue with remaining obligations, or finish with:` after every acceptance. This is the premature completion path.
- Same file, `workerFidelityBriefing`: filters milestones and cases to those selected in the candidate. That scope is deliberate; do not make every individual scenario prove the entire flow.
- Same file, `confirmCached`: confirms execution outcomes, then stashes cached YAML. It does not currently require complete, current reviewed case evidence before taking a hit.
- Same file, final persistence: `const missing = work.flow.milestones.filter((m) => coversFlowMilestones([m], authoredProof) !== true)`. Missing cases are found only after the worker session ends.
- `packages/core/src/services/guard-generate/run.ts`: the post-session guard checks accepted SHAs; cache writes depend on the worker outcome being `settled`. Completeness must be checked before both session finalization and cache publication.
- `packages/agent-loop/src/agent-loop.ts`: after the one-shot `outcomePrecondition`, `def.outcomeSchema.safeParse(result.value)` can directly mark a session completed. A schema alone cannot validate changing coverage state.
- `packages/shared/src/guard/proof.ts`: `scenarioMilestoneProof`, `coversFlowMilestones`, and `caseEvidenceDefect` already represent selected checks and reviewer evidence. Extend/reuse this model rather than inventing an unrelated coverage definition.
- `packages/shared/src/guard/web-steps.ts`, `GuardWebExpectSchema`: `text | url | visible | state | attribute | class`; no direct hidden, count, or current input-value assertion. Capture supports value/count, but observing a value is not asserting it.
- `packages/guard-runner/src/web/executor.ts`: positive target resolution waits for a visible, unambiguous match. A negative assertion cannot reuse that positive-resolution precondition.
- `packages/shared/src/guard/verification.ts`: cases carry `conditions`, including `fresh-state`, and claim groups require compatible conditions. The incident's empty-ledger case incorrectly had no starting-state condition.
- `packages/guard-runner/src/web/browser.ts`: browser timezone is pinned to UTC. Default-date checks must use the browser clock/timezone, not an author-supplied calendar date.

Conventions: Node 22+, pnpm 9.15, TypeScript, Zod, centralized Vitest tests under `tests/`. The generic agent loop imports neither provider SDKs nor Node builtins. Generator code must remain independent of core; core injects session behavior. Browser-imported shared modules must not import Node hashing. Follow `tests/guard-generator/partial-coverage.test.ts` for temporary-repository cleanup and `tests/guard-runner/web-selection.test.ts` for real Chromium execution.

Project decisions in `PLAN.md`: retain partial verified work; reject stale/unreviewed proof; preserve compact dashboard labels. Do not undo these decisions.

## Scope and boundaries

In scope:

- Shared guard proof, verification, web-step, report and manifest schemas, with necessary exports and browser-safe helpers.
- Generator acceptance, persistence, extraction/matching, serialization, prompts and examples needed for these fixes.
- Core guard-generation worker, fidelity, orchestration and caches; read-model proof projection only where needed for consistent semantics.
- Generic session definition/loop, and driver conformance tests for a provider-independent outcome validation hook.
- Browser executor, token traversal, diagnostics and evidence recording for new assertions.
- Centralized shared, agent-loop, generator, runner, core, server and driver-conformance tests; synthetic fixtures under `tests/fixtures/`.
- README documentation of new assertions and generation semantics, `PLAN.md` status updates, this plan and its index.

Out of scope: dashboard redesign, raising budgets as the fix, application changes to make tests green, broad analyzer refactors, production database migrations, clearing unrelated caches, changing existing hosted rows, or starting/stopping/restarting dev servers. Add a schema migration only if unavoidable and separately reviewed; versioned cache payloads should not need one. Do not publish, commit, push, or trigger a paid/live generation without task authorization. Use `sm/` if a new branch is needed.

## Required invariants

1. Required obligations come from current spec/flow data, not the latest candidate's selected cases.
2. Candidate acceptance is independent of flow completion. Accepted work survives another candidate failing, a blocker, cancellation, or budget exhaustion.
3. The coverage unit is the full case identity in its flow/milestone and fingerprint context. Identical case IDs in different milestones cannot satisfy each other.
4. Only current, independently reviewed assertions count. An annotation, successful setup action, captured value, stale review, or missing reviewer result does not count.
5. A rejected case stays outstanding if removed from the next draft. A later valid reviewed implementation may resolve it; historical rejection must not permanently taint repaired evidence.
6. A task may finish when all obligations assigned to that worker are accounted for. A web worker must not wait for an API-only obligation. Overall completion uses the valid union across tasks and retained scenarios.
7. Reviewed expected failures account for authored obligations without claiming passing coverage. Earlier failure must not certify unreachable later assertions as runtime successes. Preserve the existing expected-red rules and add explicit tests for this distinction.
8. Blocking, budget exhaustion and missing executor capabilities remain distinct reasons for incomplete generation. No fabricated application defect or setup requirement.
9. No result, cache hit, or interrupted final turn can bypass the completion validator.

## Step 1: Centralize outstanding-obligation accounting

Add a browser-safe pure helper near the existing proof model, preferably `packages/shared/src/guard/coverage-progress.ts`, exported through the existing shared guard entry points. Compute required, reviewed/authored, passing, and outstanding obligations separately. Use canonical IDs and current review fingerprints. Keep selected-case fidelity strict without requiring each candidate to cover all cases.

In generator task state, expose a progress snapshot based on current retained priors, latest accepted replacements, accepted new scenarios, and accepted drops. Latest replacement for a scenario ID wins. Preserve the provenance of an outstanding requirement and its latest rejection where available. The engine already knows missing cases even when no reviewer selected them.

Define worker assignment from the current realization plan and accepted proof drivers. Test mixed web/API work, alternative proof drivers, overlapping cases, and priors from other surfaces. A task should neither wait for another worker nor claim its coverage early. Reconcile the final union again at persistence. Existing legacy milestones without case metadata must retain an explicit legacy/unknown path; never silently equate unknown with complete.

Test the incident's ten-case example: five accepted cases remain accepted and exactly five stay outstanding. A candidate removing cancellation after its rejection leaves cancellation outstanding. Replacements, drops, stale spec bindings and edited YAML must recompute proof correctly.

Verify: `pnpm exec vitest run tests/shared/guard-case-evidence.test.ts tests/shared/guard-verification.test.ts tests/shared/guard-coverage-progress.test.ts tests/guard-generator/partial-coverage.test.ts` → all pass. Create the new coverage-progress test file in this step.

## Step 2: Add browser assertions that can express the requirements

Extend `GuardWebExpectSchema` additively; preserve existing YAML:

- `hidden: locator | locator[]`: succeeds when no matching target is visible, including detached targets. It retries until the existing step deadline. A visible match must prevent success. Ambiguous scope containers remain an error; do not select the first match to hide ambiguity. An observation before Cancel plus a hidden assertion after Cancel proves the transition.
- `count: { target: locator, equals: nonnegative integer }`: asserts matching cardinality with retries, including zero. Document the locator's visibility semantics. Reject `pick: first` for count so selecting one cannot make a wrong count pass.
- `inputValue: { target: locator, expected: streamMatcher | { browserDate: 'today' } }`: reads current input/textarea/select DOM value, not the HTML value attribute. Use the existing stream matcher vocabulary, token traversal and invalid-regex checks. `browserDate: today` computes the local calendar date from the controlled browser context at assertion time. Do not compare the date field to itself. Test timezone and midnight boundaries. For selects, expected values are DOM option values; visible-label checks remain separate.

Match existing schema naming patterns if they provide an equivalent shape, but keep these semantics. Keep arbitrary JavaScript out of authored scenarios. Implement waiting inside the executor, never generated sleeps. Propagate expectation subjects into evidence, text rendering, serialization, regex validation, token substitution and shared proof detection. Inspect all consumers of the existing expectation union, including preview-vendored schemas if relevant; update mechanical copies without redesigning UI.

Add real-browser fixtures for detached and CSS-hidden dialogs, delayed closure, a dialog that stays open, duplicate visible matches, invalid scopes, missing inputs, input property differing from its attribute, select defaults and asynchronous value updates. A previously visible dialog with a broken Cancel handler must fail the closure assertion. Emit useful actual-state evidence on failure.

Verify: `pnpm exec vitest run tests/guard-runner/web-driver.test.ts tests/guard-runner/web-selection.test.ts tests/guard-runner/web-expectations.test.ts tests/guard-runner/web-playwright-optional.test.ts tests/guard-runner/capture.test.ts tests/shared/guard-case-evidence.test.ts` → all pass. Create `web-expectations.test.ts`. Real-browser tests must execute; a skipped suite is not validation. If Chromium is unavailable, report the missing environment prerequisite rather than marking this step complete.

## Step 3: Keep the worker active until assigned obligations are accounted for

Add an optional generic outcome validator to `SessionDef`, returning either acceptance or structured corrective feedback. It must be asynchronous-capable and provider-independent. The guard worker supplies a validator that checks the actual progress snapshot, accepted SHA ownership, and accepted drops. Generic session code must contain no guard-specific types or proof logic.

Run validation before appending a terminal outcome and marking the session completed. On a premature `settled`, append corrective feedback with exact outstanding cases, resume the same session transcript/cursor, and continue under the SAME cumulative budget. Do not reset turns/tokens or grant a new session budget. Preserve existing precondition, cancellation, transport retry, transcript ordering, and resume behavior. The validator must also run on an outcome arriving during budget wrap-up; when no budget remains, preserve accepted work and report incomplete/budget-exhausted rather than accepting false completion. Repeated no-progress outcomes must consume the bounded session budget and cannot loop indefinitely.

Use the snapshot after every `submit_scenario` to return accepted scope and exact remaining case IDs/claims. Remove the unconditional suggested settled object. Offer settled only when assigned obligations are complete. Include concise remaining requirements in the worker briefing and budget wrap-up. Feedback from rejected candidates must direct repair of the specific assertion rather than imply dropping the case resolves it.

Do not reject honest partial `blocked`/`retired` outcomes merely because they lack full coverage. Require a blocker to reference outstanding assigned obligations and a concrete execution/capability limitation; a failed locator is not proof of an unavailable service. Preserve partial artifacts when the worker cannot finish. Keep the final generator fold as a second invariant check for scripted seams or future callers that bypass the generic loop.

Test: accept five of ten → premature settled refused → author submits remaining cases → complete. Test partial then blocked, partial then budget exhausted, repeated settled with no progress, unreviewed acceptance, dropped/replaced priors, foreign SHA, mixed surfaces, cancellation, expected-red accounting, and outcomes during interruption. Test actual driver continuation semantics with existing conformance stubs, not only direct task calls.

Verify: `pnpm exec vitest run tests/agent-loop tests/llm-drivers/session-driver-conformance.test.ts tests/guard-generator/flow-worker.test.ts tests/guard-generator/partial-coverage.test.ts tests/core/guard-generate-worker-seam.test.ts` → all pass, with the new completion regressions executing.

## Step 4: Preserve complete review evidence through caches and regeneration

Version the worker cache payload/semantics. Cache a finished task only when assigned obligations are accounted for with current review evidence. Persist the case evidence and reviewed-scenario fingerprint needed to prove that fact; a SHA pointing to YAML is not sufficient review evidence. Do not reconstruct a faithful review from the fact that a cached test runs green.

On cache lookup, verify required-case/assignment fingerprints, scenario fingerprints, review policy version, supported executor vocabulary and evidence coverage before accepting a completed hit. Then retain existing runtime confirmation against the actual environment. An incomplete or old entry can supply validated candidate/prior material but must not skip the authoring loop. Legacy entries without the new evidence/version are misses for completion purposes; do not delete unrelated caches.

Changing review/extraction rules must invalidate their affected cache keys too. Existing stale reviewed artifacts must be eligible for re-review/regeneration; unchanged YAML does not mean an obsolete review policy remains authoritative. After a spec case split, do not automatically relabel old evidence onto new case IDs.

Test full cache replay preserves proof and skips authoring; cached partial green requires authoring; a YAML edit invalidates review; a new obligation invalidates completion; old cache version does not falsely complete; runtime failure invalidates the hit; unreviewed scenarios are never completion hits; partial persisted priors can be extended without duplication.

Verify: `pnpm exec vitest run tests/core/guard-generate-session-cache.test.ts tests/core/guard-generate-worker-seam.test.ts tests/guard-generator/partial-coverage.test.ts tests/server/guard-flows.test.ts` → all pass. Update intentional fingerprint pins with an explanation of the semantic change.

## Step 5: Make cases independently testable and review the whole selected case

In extraction and fidelity prompts/examples, teach separate testable obligations for distinct branches and conditions. The example `sort by date descending, then ID descending` requires both different-date ordering and same-date tie-breaking. Prefer separate stable case IDs for these distinct behaviors. Do not count the whole ordering case when only its tie-breaker was asserted.

Mark an empty-ledger obligation with its actual `fresh-state` preparation requirement; separate it from populated-ledger obligations according to existing verification boundary rules. Ensure the condition survives extraction, composition, matching, assignment and authoring. Arrange state through supported actions or an isolated declared recipe/setup. A fixture label alone does not prove the ledger is empty; assert the starting state. Do not truncate the user's database or depend on whatever data previous workers left behind.

For totals, use a fully controlled ledger with known amounts to assert the exact total and formatting, or existing captured-value comparisons where they truly establish the requirement. A mere before/after increase cannot prove the overall total equals every stored expense. Do not invent arithmetic expressions that the DSL does not support.

For post-save assertions, require actual coverage of closure, announcement, totals, pagination and preserved filters. To test reset to page one, establish a later page first. Avoid over-splitting dependent guarantees into isolated scenarios that no longer prove their common transition. Assert the announcement using its actual mapped accessibility role/name and text; textual contents do not automatically become an accessible name.

Use the full source claim as context to flag omissions within a selected case, while allowing omission of explicitly separate, unselected cases. Keep review evidence tied to real assertions and their input conditions. A deterministic annotation validator cannot guarantee semantic fidelity; do not claim it can. Add reviewed examples and behavioral regressions for the semantic obligations.

Reduce the incident's authoring friction with valid YAML examples that quote template strings, colons and regexes, and with grounded locator diagnostics. Do not change the accepted YAML contract or add a silent parser repair path. Keep this subordinate to completion enforcement.

Verify: `pnpm exec vitest run tests/guard-generator/prompts.test.ts tests/guard-generator/case-coverage.test.ts tests/guard-generator/partial-matching.test.ts tests/core/guard-generate-extract-session.test.ts tests/shared/guard-verification.test.ts` → all pass. Add cases for omitted primary sort, unasserted closure, self-referential date checks, empty-state conditions and compound post-save requirements. Use scripted fidelity outputs for orchestration tests; do not mistake those stubs for a real-model quality evaluation.

## Step 6: Reproduce the incident end to end and document rollout

Create a small expense-like fixture under `tests/fixtures/guard-completion/` and a regression under `tests/guard-generator/completion-regression.test.ts`. Use the existing temporary-repo helpers and a scripted worker to replay this sequence: bad announcement locator, rejected cancellation, smaller valid scenario, premature settled. Assert that the engine retains the valid portion, returns the outstanding obligations, and either finishes after additional reviewed scenarios or reports a specific incomplete cause.

Use real Chromium for the fixture assertions. Include controlled populated and empty state, dialog defaults, Cancel, post-save transition, three records that distinguish primary date order and ID tie-breaking, both detail links and empty notes. For each guarantee, deliberately break that behavior in an isolated fixture variant and require the relevant scenario to fail. Keep production defaults unchanged and variants inside test fixtures.

Verify persistence and server projection after completion and after exhaustion: no uncovered case disappears, no application failure becomes a generation gap, and no incomplete flow has a completion hash. Test a second generation with unchanged complete inputs and a second generation with missing cases. Confirm no duplicated scenario IDs or lost prior evidence.

Update README for new assertion syntax, partial acceptance versus complete generation, and the behavior of incomplete retries. Update the relevant STATUS tags in root PLAN.md and this plan/index as implementation phases finish. Keep compact UI labels unchanged.

Verify: `pnpm exec vitest run tests/guard-generator/completion-regression.test.ts tests/guard-runner/web-expectations.test.ts tests/server/guard-flows.test.ts tests/shared/guard-proof-browser.test.ts` → all pass with real-browser cases executed.

Then run the final verification gates below. After implementation validation, a separately authorized hosted regeneration of the incident repository can confirm real-model authoring quality. Do not rewrite historical generation or execution rows. Inspect the new activity transcript and manifest for complete reviewed coverage, genuine passing executions or concrete failures, and no early settled response with outstanding work. Any assertion newly exposing an application bug is a successful detection, not a reason to weaken the scenario.

## Final verification gates

Commands are taken from package scripts and root Vitest configuration. Implementation validation is recorded below.

1. `pnpm --filter @truecourse/shared build`
2. `pnpm --filter @truecourse/agent-loop build`
3. `pnpm --filter @truecourse/guard-runner build`
4. `pnpm --filter @truecourse/guard-generator build`
5. `pnpm --filter @truecourse/core typecheck`
6. `pnpm test`
7. `git diff --check`

Expected: each exits zero; full suite passes; the new Chromium regressions run rather than skip. If a baseline test/typecheck is already broken by unrelated working-tree changes, record its exact failure before implementation and distinguish it from regressions. Do not remove assertions or skip tests to obtain a green result.

## Done criteria

- [x] Browser closure, count and current-value expectations have strict schemas, deterministic execution, evidence and real-browser regressions.
- [x] Required-case accounting survives omission, rejection, replacement, drops, multiple surfaces and stale proof.
- [x] Premature settled responses continue in the same bounded session; no alternate finalization path bypasses validation.
- [x] Cache replay retains current reviewed proof and cannot finish incomplete generation.
- [x] Extraction/review examples cover primary ordering and tie-breaks, proper starting-state conditions and complete post-save claims.
- [x] The replay regression proves five accepted cases cannot settle a ten-case assignment and that subsequent scenarios can finish it.
- [x] Deliberately broken fixture behaviors make the relevant scenarios fail.
- [x] Final verification gates pass, README and root PLAN.md match implemented behavior, and plan/index statuses reflect actual completion.
- [x] No dev servers were managed and no historical/live database rows were edited.

## Escalation and maintenance

If the dirty source has materially changed these invariants, reconcile the plan with the live code before implementing. Report unresolved scope conflicts rather than overwriting another task's work. If real-browser tests cannot run, leave their validation incomplete and state the prerequisite. If required evidence needs an executor capability outside the planned primitives, report the concrete missing operation instead of weakening the case or adding arbitrary JavaScript. If the fixture reveals an application defect, preserve the failing test.

Future assertion vocabulary, review policy, case extraction and worker assignment changes must revisit fingerprints, proof validation, cache compatibility and the same-session outcome gate together. Broad security/performance audits, dashboard changes, and live regeneration are outside this plan.


## Implementation validation, September 9

All six implementation steps and their final verification gates are complete.

- Added the shared obligation calculation and per-case rejection feedback, plus completion validation in the generic session loop and guard finalization.
- Added hidden/count/input-value browser assertions with evidence and preview-schema parity. Both the assertion suite and expense fixture tests execute in Chromium.
- Versioned worker review caches and manifest evidence. Both live completion and persistence reject stale bindings, incomplete prior evidence, unreviewed expected failures and obsolete review policy. Reaccepting an earlier YAML after another edit persists the last accepted replacement.
- Nine completion regressions cover shrinking scope, same-session recovery, cache replay, budget exhaustion, empty blocked work, reviewed/unreviewed failures, stale prior evidence/bindings and replacement ordering.
- Built core and its dependencies, including shared, agent-loop, guard-runner and guard-generator. Core and dashboard-client typechecks pass. Both provider-adapter continuation regressions pass.
- The first full suite exposed intentional fingerprint changes, stale CLI/UI fixtures and a stale built core read model. Updated fixture contracts and rebuilt packages. Final `pnpm test`: 694 files passed; 13,298 tests passed and 32 existing tests skipped. All 34 new browser tests executed in Chromium. `git diff --check` passes.
- No hosted regeneration or historical DB rewrite was performed. Real-model quality remains to be assessed in a new generation; scripted fidelity results test orchestration rather than model judgment.
