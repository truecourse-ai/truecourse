# Plan 003: Give aggregate-sensitive scenarios verified private data

STATUS: COMPLETE
Priority: P1. Effort: L. Risk: medium/high, touches seed and lifecycle ownership. Depends on implemented Plan 001. Steps 1–4 provide the preparation foundation for Plan 004; finish case-specific integration and the final gates after Plan 004 assignment changes. This is an integration dependency, not a requirement to wait before implementing the runtime foundation. Category: correctness. Confidence: high.

## Problem and incident

Generation `cd2ec0ff-d11c-4c09-a553-5f3b686e2ec3` for spiderhands/expense-tracker at commit `58899f746bc470cfafb802d1cb27b35893631ad6` ran browser and API authors against a changing ledger. The UI worker observed 1, 16, 66, 98 and over 100 records, including other workers' maximum-value records. The saved query scenario subsequently captured baselineCount=8, created six records, and expected 14; step 11 returned 22 with sibling-created rows. Unique descriptions prevented collisions but did not isolate global counts or totals.

The empty-ledger author successfully improvised `setup.env.SQLITE_PATH: data/empty-${unique}.sqlite`. That is useful evidence that this app supports private storage, not a general solution. Shared seed data and credentials were prepared before scenario environment overrides; another app could inherit fixture IDs from the wrong database. Exact counts, sums, ordering/page boundaries and empty state need runner-owned, verified preparation shared by every driver in one scenario.

## Current state and scope

- packages/guard-runner/src/run.ts: shared world preparation uses the default server environment; `runSeed({repoRoot, seed: api.seed, env: sharedEnv, ...})` runs once and publishes shared credentials/fixtures. Driver pools later execute concurrently.
- packages/guard-runner/src/shared-world.ts: service lifecycle sharing intentionally avoids singleton Compose up/down races. A borrower must never reset shared services beneath siblings. Preserve this design.
- packages/guard-runner/src/api/run-api-scenario.ts: createSandbox receives scenarioEnv: setup?.env above recipe/proxy env.
- packages/guard-runner/src/web/surface.ts: `env: { ...opts.sandboxEnv, ...opts.surface.env }` applies surface env afterward, so a raw scenario datastore override may lose on web while winning on API.
- packages/guard-runner/src/run-scenario.ts, drivers/surface.ts, api/seed.ts and guard-executor.ts: per-scenario execution, served driver preparation, seed manifests, and the local/hosted seam. Hosted executors may ignore the in-process sharedWorld handle; the isolation contract must be serializable.
- packages/guard-runner/src/recipe.ts: recipe schema and fingerprints currently include api.seed.script content only.
- packages/shared/src/guard/scenario.ts: setup supports env/files, with no verified preparation profile selection.
- packages/core/src/services/guard-setup/bundle.ts: currently copies only the main api.seed.script beyond fixed bundle members.
- packages/guard-generator/src/recipe-discovery.ts and prompts.ts; packages/core/src/services/guard-setup/recipe-repair.ts, seed-session.ts, session-context.ts: discovery/repair ownership.

In scope: these modules; a focused new runner preparation module; shared verification/preparation schemas and exports; generator birth/assignment/context/cache/estimate consumers; setup bundle/storage materialization adapters and their contract tests; tests/guard-runner, tests/guard-generator, relevant tests/core and tests/data-store; README and status docs. Read existing setup dependency/readiness contracts before adding profiles. Out of scope: resetting user databases, disabling parallelism globally, replacing shared service lifecycle management, app-specific engine branches, arbitrary new SQL execution in authored tests, and new datastore adapters unrelated to demonstrated app support.

## Target contract

Use named, recipe-owned preparation profiles and a serializable scenario selection, for example `setup.preparation: empty-ledger`. The profile shape belongs with Recipe, with browser-safe selection/requirement types in shared. Final field names should follow existing recipe conventions, but retain these semantics:

- A scenario-private data scope and declared baseline: empty or known seeded records.
- Repository-owned preparation/cleanup script references and environment bindings, plus required published fixture/credential fields using existing seed manifest conventions.
- A runner-generated namespace and owned absolute directory, unique per execution attempt rather than merely per scenario ID. Profile bindings may refer to these values. Concrete runtime paths and secrets never enter committed hashes or artifacts.
- Seed and all API/web/request servers in that scenario resolve the same target and use credentials/fixtures created there. No inheritance of shared fixture IDs into a private datastore.
- Exact expected totals/counts derive from independently controlled input records or seed inputs. A manifest value copied from the application's aggregate output is not an independent oracle.

For SQLite, use a private file in the owned execution directory. For service-backed apps, require a verified app-supported database/schema/service namespace. A tenant is acceptable only when it isolates the actual claimed query scope; it cannot prove an instance-wide total. Do not claim general PostgreSQL/MySQL isolation without an implemented, verified preparation contract. An unavailable profile is a precise preparation gap.

## Steps

### 1. Add schemas and deterministic preparation identity

Add named profiles to recipe, a profile selection to scenario setup, and a typed requirement for isolated/controlled starting state in verification or its associated preparation model. Keep observation capabilities separate from preparation requirements. Old scenarios with no profile retain their current shared behavior; aggregate-sensitive new assignments must not silently fall back to it.

Validate unknown profiles, invalid namespace/env references, conflicting setup overrides of profile-owned datastore bindings and missing required manifest fields before launching an app. Reuse seed/script path resolution and secret redaction. Profile scripts must remain within repository-owned paths; cleanup may act only on the allocated namespace/directory. Record the profile identity and baseline in evidence without secrets.

Verify: add tests/guard-runner/scenario-preparation.test.ts and run `pnpm exec vitest run tests/guard-runner/scenario-preparation.test.ts tests/guard-runner/step-env.test.ts tests/guard-runner/child-env.test.ts tests/shared/guard-verification.test.ts`. Schemas/identity/environment-conflict tests pass; unselected legacy scenarios stay unchanged.

### 2. Resolve once per execution before seeding and server boot

Implement an owned per-scenario preparation lifecycle, separate from shared infrastructure ownership. Resolve profile env at the final boot boundary consistently for preparation, seed, API, browser and in-scenario requests. Allocate the runner-owned namespace/directory and register its cleanup ownership before provisioning, seed or app start. Cleanup must receive this allocation even if preparation fails before publishing a manifest. Never invoke cleanup with an absent namespace or default shared-datastore bindings. Use the resulting per-world credentials/fixtures in every driver, including credential header and server-allowlist metadata currently assembled from the main recipe in run.ts. A private credential value without its injection/target metadata is insufficient; validate authenticated browser and API use. Unrelated established environment precedence should not change; explicitly reject conflicting profile-owned bindings rather than silently targeting two worlds.

A new namespace is required for every whole-scenario execution: probe, submit confirmation, cache replay, rerun or complete scenario retry. HTTP retries, assertion polling, startup recovery and explicit server restart steps within that execution retain its world and records. Do not reseed/reset during an in-scenario restart. Do not reuse data across whole-scenario executions because scenario IDs, YAML or cached review are equal. Shut down this scenario's browsers/servers before cleanup, including failed preparation, abort and timeout. Cleanup must never call a shared reset or delete a sibling namespace. Mixed-driver scenarios share one private data world for their complete path.

Verify: `pnpm exec vitest run tests/guard-runner/scenario-preparation.test.ts tests/guard-runner/shared-world.test.ts tests/guard-runner/run-driver-preparation.test.ts tests/guard-runner/api-seed.test.ts` passes. Tests must demonstrate shared infrastructure still boots/tears down once while private data lifetimes are independent; authenticated private fixtures with header/allowlist metadata and env conflicts across API/web receive explicit coverage. A server-restart persistence test must keep created data. Test cleanup failures before and after preparation manifest publication without harming a sibling.

### 3. Discover and verify preparation through Setup

Teach existing recipe/seed discovery and repair to create profiles grounded in application configuration, including the expense fixture's supported SQLite path override. Preserve existing main setup artifacts. Add targeted readiness/fingerprint tracking so a missing profile can be refreshed without throwing away working interfaces, credentials or dependency decisions.

Verify isolation by provisioning two worlds, mutating A, and observing through the application that B is unchanged. Verify empty baseline and known seeded values through the app, not just process exit success. Missing fixture amount/date/category fields must be requested or avoided by using an empty profile and explicitly created known records. Do not expose secret credential values in author briefings.

Publish profile capabilities and fixture field availability in match/worker context. Source cases requiring a fresh ledger or exact global total/count/page boundary must select suitable verified preparation. Infer this requirement during source-grounded extraction/planning and validate explicit metadata; do not use substring heuristics in the runner. A missing preparation blocks only affected cases. Plan 004 supplies the case-level disposition plumbing.

Verify: `pnpm exec vitest run tests/core/guard-setup-recipe-repair.test.ts tests/core/guard-setup-seed-session.test.ts tests/guard-generator/partial-matching.test.ts tests/guard-generator/completion-regression.test.ts`. Add discovery success, false-isolation failure, unavailable profile and preserved existing setup coverage.

### 4. Package and invalidate all behavior-affecting inputs

Extend bundle collection/materialization to transport every referenced preparation/seed/cleanup script. Fold script contents, profile definitions, baseline and applicable preparation requirements into recipe/setup/generation/worker cache identity. An edited script must invalidate affected completion even when its path is unchanged. Exclude random runtime namespace values and secrets.

Use GuardExecInput.recipe and scenarios, not an in-process handle, to convey requirements. Add serialization/materialization parity tests proving a hosted-shaped fresh checkout can prepare and execute the same selected profile. Locate the real production executor adapter before declaring hosted validation complete; if not present in this checkout, document the external adapter requirement and verify its protocol rather than pretending a local test validated it.

Verify: `pnpm exec vitest run tests/core/guard-setup-bundle.test.ts tests/data-store/guard-setup-bundle.test.ts tests/guard-runner/scenario-preparation.test.ts tests/core/guard-generate-session-cache.test.ts` passes. Test changed script contents, missing bundle member, cleanup paths, fresh checkout and cache replay.

### 5. Reproduce interference under concurrency

Use a small persisted-state fixture, not only mocked world handles. One test captures 8 and inserts 6 while a sibling inserts 8; the first test's private total remains 14. Add a concurrent empty-ledger test, exact total/pagination/order scenarios, API plus web/request in one scenario, authenticated per-world fixtures, changed recipe/web env, repeated runs and reordered scheduling. Synchronize race tests using fixture barriers, not sleeps.

Run healthy expense behavior with noisy sibling writers and require deterministic success. Deliberately break total/count/sort calculations and require failure so isolation cannot mask real defects. Abort one profile during setup and prove its sibling survives with no cross-cleanup. Browser tests must run Chromium.

Verify: `pnpm exec vitest run tests/guard-runner/scenario-preparation.test.ts tests/guard-runner/completion-browser.test.ts tests/guard-generator/completion-regression.test.ts`, followed by all final gates.

## Done criteria

- [x] Exact counts/totals and empty state remain stable with concurrent unrelated writers and across retries.
- [x] Seed, credentials, fixtures and all drivers in one scenario target the same private data scope.
- [x] Shared infrastructure is never reset by private cleanup.
- [x] Preparation is verified, persisted, bundled and fingerprinted consistently.
- [x] Missing isolation reports a case-specific preparation gap; there is no shared-state fallback.
- [x] Real app defects still fail and all targeted/final gates pass.
- [x] README documents profile ownership, selection, supported modes and targeted setup refresh.

Maintenance: preparation additions interact with environment precedence, authentication, server ownership, cache identity and remote packaging. Serial execution and world: mutates are not replacements for a known private baseline. Preserve the documented shared-world lifecycle fix.

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

Implementation: recipe-owned instance preparations allocate primary and peer worlds per execution, seed their own fixtures/credentials, verify through the application, and clean only owned allocations. Profile environment wins across drivers; scenario and nested boot overrides of owned keys are rejected. Private mutators do not reset shared state. Setup has a verified preparation authoring session and --only-preparations; profile scripts travel in bundles and fingerprints. The production EE job and GitHub runner use the standard serialized executor contract after bundle materialization. Tests execute serialized bundles in a fresh checkout; custom external executor overrides remain responsible for honoring that contract. Live HTTP/Chromium tests cover concurrent totals/counts/order/pages/empty state, private authentication, restarts, replay, false isolation, broken aggregates/order/pages, pre-manifest failure, abort and cleanup failure. Shared service ownership is preserved.

Live rollout validation: **NOT RUN** for this implementation. The previously analyzed generation remains historical evidence. No deployment, DB mutation, hosted generation or user dev-server management was performed. The code implementation and local validation are complete; live rollout remains separately NOT RUN.

Validation: **COMPLETE**. `pnpm --filter @truecourse/core... build`, core and dashboard-client typechecks, and `git diff --check` passed. Final `pnpm test`: **699 files passed, 13,355 tests passed, 32 existing skips**. The private-state and completion-browser regressions executed against real HTTP servers and Chromium. No live-model quality or hosted rerun result is inferred from these fixtures.
