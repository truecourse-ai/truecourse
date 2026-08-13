# TrueCourse — Claude Instructions

## Key Files to Keep Updated

- **docs/SPEC_GUARD_PLAN.md** — The source of truth for the guard (spec → scenario) pipeline: design, implementation status, and the numbered decision/work items. When completing work on an item, update its `STATUS:`; when adding features or changing scope, update the plan.
- **README.md** — Must reflect the current state of the project. When adding new packages, endpoints, commands, environment variables, or changing the project structure, update the README to match.

## Project Layout

- `apps/dashboard/client/` — Vite + React Router frontend (React Flow graph, Tailwind CSS, dark mode)
- `apps/dashboard/server/` — Express + Socket.io HTTP layer that serves the dashboard. Thin adapter over `@truecourse/core`; contains routes, sockets, middleware, and dashboard-only services (analytics, watcher, telemetry).
- `apps/landing/` — Public marketing site (Vite + React + Tailwind v4). Standalone, deployed separately from the local dashboard. `pnpm --filter @truecourse/landing dev` runs it on port 3100. Sample OSS analysis reports live in `apps/landing/src/data/analyses.ts`.
- `packages/core/` — Framework-agnostic analysis engine: pipeline, graph/flow services, LLM providers, persistence (analysis-store), config, logger, errors. Consumed by both the CLI and the dashboard server.
- `packages/analyzer/` — Tree-sitter (WASM via `web-tree-sitter`) + TypeScript Compiler analysis engine (TS/JS/Python)
- `packages/llm-api/` — The direct-API `LlmTransport` (`createApiTransport`) on the Vercel AI SDK: `anthropic | openai | bedrock | copilot`, `generateObject` when the request carries a schema, per-call StageUsage. The only OSS package allowed to import `ai` / `@ai-sdk/*` (enforced by `tests/architecture/ee-import-boundary.test.ts`); `@truecourse/ee-llm` re-exports it.
- `packages/shared/` — Shared Zod schemas and TypeScript types
- `tools/cli/` — CLI commands (analyze, dashboard, list, add, rules). Thin adapter over `@truecourse/core` — does NOT depend on the dashboard server.
- `tests/` — All tests (centralized, not colocated). Organized by package: `tests/shared/`, `tests/analyzer/`, `tests/server/` (covers both dashboard-server routes and core services), `tests/cli/`.
- `tests/fixtures/` — Fixture repos the tests drive: `sample-{js,python,csharp}-project-{positive,negative,il}/` (analyzer rule fixtures), `sample-scheduling-saas/`, `guard-fixture-cli/` (the `relkit` CLI) and `guard-fixture-api/` (the `todos` + `api-v2` HTTP servers) for the guard drivers, `recipe-propose/` and `route-manifest-monorepo/` for the deterministic recipe/route derivations

## Development Commands

```bash
pnpm dev          # Start all services (turbo) — file-based store under <repo>/.truecourse/
pnpm build        # Build all packages
pnpm build:dist   # Build distributable npm package (static frontend + bundled server → dist/)
pnpm test         # Run all tests (vitest)
```

## Storage

Analyses are stored as JSON files. **No database.**

Per-repo layout under `<repo>/.truecourse/`:
- `analyses/` — per-analysis snapshot files, filenames `<iso>_<short-uuid>.json` (gitignored)
- `LATEST.json` — materialized current-state view, also serves as the diff baseline (committable — see below)
- `history.json` — append-only summaries for cross-analysis queries (gitignored)
- `diff.json` — optional current diff analysis, overwritten each diff run (gitignored)
- `config.json` — per-repo settings (committable)
- `ui-state.json` — graph positions + collapse state (gitignored)
- `logs/` — per-repo analyze logs (gitignored)
- `.analyze.lock` — transient, held for the duration of an analyze (gitignored)
- `specs/` — the spec-consolidation store for `truecourse spec scan`:
  - `specs/corpus.json` — **committable** (LATEST.json convention). The curated doc corpus produced by the corpus-path scan (`curate()`): kept docs + their area tags, docs grouped by area, within-area overlap flags, auto-detected doc→doc relations, and the relevance-dropped docs (`skippedDocs`: path + reason) so the dashboard can surface "not included" docs for force-include. Expensive to regenerate (LLM tagging) and not purely deterministic, so teammates inherit it from git.
  - `specs/decisions.json` — **committable**, user-authored. Curated resolutions: doc→doc `relations[]` (replace/precedence/keep-both), `manualAreas[]` (area-tag overrides), `manualIncludes[]` (relevance force-includes), `manualExcludes[]` (force-excludes — drop an otherwise-kept doc), and `conflictResolutions[]` (section-scoped conflict verdicts — pick-a-side / dismissal keyed by dispute identity; the losing side's disputed claim is suppressed at guard generate).
  - `specs/sources.json` — **committable**. The registry of llms.txt documentation sites added with `truecourse spec source add`: per source the llms.txt URL, title, `fetchedAt`, the fetched pages (url + snapshot path + content hash) and the skipped links with reasons. Fetched over the network, so teammates inherit it from git rather than refetching.
  - `specs/sources/<id>/` — **committable**. The fetched markdown pages of each source, snapshotted as real files so discovery, guard generate and the doc viewer read them like any repo doc. Same rationale as `sources.json`: only `spec source add/refresh` reach the network, and a fresh clone must scan offline.
- `.cache/` — derived, **gitignored**, safe to delete (re-derived on the next run): the per-stage LLM KV caches that make re-runs cheap — `consolidator/{area-tags,relevance,overlap,vocab,chain-detection}/` (scan), `contract/{enumerate,reconcile,extract}/` (generate), `guard/{triage,visual-judge}/` (guard generate's failing-test triage and `guard run`'s visual judge — the latter keyed on the screenshot bytes + the failure identity, so re-running an unchanged red board makes no vision call). The `contract/extract` cache is keyed on each area's prompt + doc-content hash + reconciled target identities, so contract generation only re-runs the (expensive Opus) extraction for areas whose specs actually changed — unchanged areas are cache hits. **Not** for run-result data — that's `contracts/result.json` below.
- `contracts/` (+ `contracts/_inferred/`, `contracts/_shared/`) — the generated `.tc` contract corpus (spec→code map), **committable / git-tracked**. A materialization of `specs/corpus.json`; committed so it travels with the repo.
- `contracts/manifest.json` — **committable / git-tracked**. The spec→contract map: each area's spec content-hash from the last generate. Travels with the repo so `contracts generate` is a deterministic no-op when specs are unchanged (a cloner re-running generate regenerates nothing) — only new/edited areas call the LLM, deleted specs drop their contracts. The estimate reads it too (deterministic, clone-safe). See `packages/contract-extractor/src/manifest.ts`.
- `contracts/result.json` — **gitignored** run-result of the last `contracts generate` (written count, coverage gaps, validation issues), living next to the `.tc` tree it describes. The dashboard reads it back so a page reload still shows them, and its mtime drives the staleness dots. (The rest of `contracts/` is tracked; this one file is ignored.)
- `guard/` — the guard run store for `truecourse guard run`, mirroring the analyze store (there is **no** `diff.json` — guard shows current state only). See `packages/guard-runner/src/store.ts`; the committed scenarios it runs live in `scenarios/` (`recipe.json`, `manifest.json`, `<area>/*.yaml`, and `decisions.json` — the user-authored `dismissedClaims` `guard generate` honors, the spec `decisions.json` analog — all committable).
  - `guard/runs/<iso>_<short-uuid>.json` — per-run snapshots (gitignored)
  - `guard/LATEST.json` — materialized current run state (**committable**, same convention as the analyze `LATEST.json`)
  - `guard/history.json` — append-only per-run summaries (gitignored)
  - `guard/evidence/<runId>/` — per-failure transcripts (gitignored)
  - `guard/auto-resolutions.json` — **gitignored** durable auto-resolve ledger + flow-taint set for `guard generate`: per-flow counts of auto-resolved "the test is wrong" verdicts (escalating to a human task past the threshold) and the tainted flows whose next generate bypasses the author cache. Transient run memory; safe to delete (auto behaviors just start their budget over).
  - `guard/setup.json` — **gitignored**, derived, safe to delete: the record of the last `truecourse guard setup` (item 77). Per-step outcomes (the recipe + its live endpoint probes, the externals skeleton, the one seed) plus the DETECTION SNAPSHOT — the external services, the database and its parsed-table count, and the datastore URLs from setup's single `mapJourneys` pass. `readGuardExternalsView` reads its detected list from HERE (falling back to `guard/result.json` only for a repo that generated before setup existed), which is what makes the External APIs surfaces work before the first generate. `guard status` renders it as its first row. See `packages/guard-runner/src/store.ts`.
  - `guard/result.json` — **gitignored** run-result of the last `guard generate` (written/settled/punt/birth-finding/error counts, per-section gap reasons, call+token+cost totals, and the per-stage LLM-failure tallies — a stage that lost EVERY call aborts the run as `status: 'llm-failed'` and rewrites nothing else). The CLI `guard status` and the dashboard coverage view render the same summary from it.
  - `scenarios/externals.local.json` — **gitignored** secrets overlay for the recipe's `api.externals` (item 62): `Record<serviceName, { baseUrl?, env? }>`, merged over the committed declaration per FIELD at load time (local wins). `recipe.json` declares WHICH external services exist and which env vars they need — committed, so it enters the recipe fingerprint and declaring a service re-authors the sections it used to block; this file holds the base URLs and API keys that must never reach git, and is deliberately outside every fingerprint (rotating a key never re-authors). See `packages/guard-runner/src/externals.ts`.

The gitignored vs committable split is materialized by the `.truecourse/.gitignore` template in `packages/core/src/config/paths.ts` (`GITIGNORE_CONTENTS`) — keep it in sync when adding store files.

`LATEST.json` is tracked so it travels via git: `git worktree add` and fresh clones inherit a baseline without anyone having to cold-start `truecourse analyze`. The convention is **only commit `LATEST.json` after merging to main** (run `truecourse analyze`, commit the result). Don't commit it from feature branches — two PRs both updating `LATEST.json` will conflict on a giant generated JSON. The same applies to `guard/LATEST.json` (the guard run baseline) and `specs/corpus.json` (the spec snapshot): commit it only after merging to main.

Global layout under `~/.truecourse/`:
- `config.json` — the LLM transport selection (`llm.transport`: `claude-code` | `api`) and, for API mode, `llm.api` (provider, model, fallbackModel, apiKey / apiKeyEnv, baseURL, headers, Bedrock creds). Written `0600` in a `0700` dir; the `api` block persists across transport flips. Read/written via `packages/core/src/config/global-config.ts`, installed by `services/llm/install-transport.ts`, authored by `truecourse config llm setup`.
- `registry.json` — known project paths + `lastAnalyzed`
- `logs/` — dashboard + install logs
- `cache/openrouter-prices.json` — cached model prices (per-token, fetched daily from OpenRouter) for the pre-flight cost estimate. Derived, safe to delete. Set `TRUECOURSE_NO_PRICE_FETCH=1` to skip the network and use bundled list prices (air-gapped; the test suite sets this).

The server walks up from `cwd` looking for `.truecourse/`. Set `TRUECOURSE_HOME` to relocate the user-level dir (tests do this).

The pre-flight LLM estimate (spec scan and guard generate) is **token + ceiling-cost**: token math is deterministic and offline; cost multiplies the high end of each stage's call range by per-token prices and ignores prompt-caching discounts, so the real bill lands at or below it. The single source is `packages/core/src/services/llm/{token-estimator,spec-estimate,model-prices}.ts` — the CLI prompt and dashboard modal render identical numbers. Both estimates are **cache-aware** and label the subject "N of M … changed"; when nothing changed the estimate has no stages and the confirm prompt is skipped:
- **Scan** — exact: relevance + area-tags are cached per doc (content-keyed) and each cache directly gates its own call, so the estimate reads the real caches (`readRelevanceCache`/`isAreaTagCached`) and counts only the misses.
- **Generate** — uses the enumerate cache as a proxy for the extract cache (docs unchanged ⇒ both cached). One caveat documented in `spec-estimate.ts`: on the first run after the extract cache was introduced the enumerate cache can be warm while the extract cache is empty, so that single run can under-count.

## Rules

- **No workarounds.** Always find and fix the root cause. Do not use hacks, fallbacks, or temporary patches to bypass issues. If something isn't working, investigate why and fix it properly.
- **Dev servers.** Do not start, stop, or restart dev servers. The user manages `pnpm dev` from their terminal. If a restart is needed (e.g. `.env` change), tell the user.
- **Storage.** The store is file-based. Writes go through `packages/core/src/lib/analysis-store.ts` via `atomicWriteJson` (write-to-tmp + rename for atomicity). Reads are mtime-cached on `LATEST.json`. Concurrent analyses are prevented by `.analyze.lock` (O_EXCL).
- **No Claude Code session details in commits/PRs/issues.** Never put a `Claude-Session:` trailer or any `https://claude.ai/code/session…` URL into a commit message, PR body, or issue body — strip them before committing or opening the PR/issue. Default commit/PR formatting is otherwise fine.

## Releasing

When bumping the package version, update all four places — `package.json` alone is not enough because `commander` reads the version from code:

1. `tools/cli/package.json` — the `truecourse` CLI published to npm.
2. `packages/core/package.json` — the `@truecourse/core` workspace package (kept in sync even though it's not published separately).
3. `apps/dashboard/server/package.json` — the `@truecourse/dashboard-server` workspace package (kept in sync even though it's not published separately).
4. `tools/cli/src/index.ts` — the `.version("X.Y.Z")` call on the commander program. This is what `truecourse --version` prints.

The internal packages (`@truecourse/dashboard-client`, `@truecourse/analyzer`, `@truecourse/shared`) are marked `private: true` and never published — leave their versions at `0.1.0`.

npm publishing is automated via `.github/workflows/publish.yml`, which has two triggers — both run the same publish steps, so never `npm publish` manually:
- **Push a git tag `vX.Y.Z`** (after merging to `main`) — the manual / prerelease path.
- **Merge a campaign-close PR** (labelled `*fp-campaign-complete`) — the fp-automation path. The workflow verifies the four version locations agree, then creates the `vX.Y.Z` tag on the merge commit and publishes. The `fp-campaign-close` routine does **not** push the tag (routine sessions can't push `v*` refs — issue #752); CI owns tagging. See `docs/fp-automation/README.md` → "Release on merge".

## Testing

- When running tests, save the full output to a file and read from it — do NOT run tests multiple times with different grep patterns. For example: `pnpm test 2>&1 | tee /tmp/test-output.txt` then read the file.
- The full suite needs `pnpm build` run once first (tests resolve workspace packages from `dist/`) and the C# Roslyn host built (`dotnet build -c Release tools/csharp-roslyn-host`, once per checkout/worktree) — without the host the C# e2e test fails hard and the Roslyn semantic-rule tests skip.
- CI runs the suite in 4 shards (`vitest --shard=i/4`) across both `test.yml` and `publish.yml`, which share `.github/actions/setup`. Shard assignment is a hash of the file path, so tests must not depend on running in the same process as another file — they already can't, since vitest isolates every file.
- The Roslyn rule suites (`tests/analyzer/roslyn-rules-*.test.ts`) share one host process per file via `useRoslynHost()` in `tests/analyzer/helpers.ts`. Each snippet is still its own `analyze` request (its own Roslyn compilation); only the ~0.8s process boot is amortized. Never call `runRoslynHost` per assertion — that is what made these files take ~6 minutes.
- `tests/setup.ts` hides the developer's global/system git config from the whole suite (`GIT_CONFIG_GLOBAL=/dev/null`), so host settings like `commit.gpgsign` can't leak into temp fixture repos. Tests that commit must set `user.name`/`user.email` per-repo.

## Conventions

- All tests live in the `tests/` directory at the repo root, not colocated with source files
- The analyzer supports TypeScript, JavaScript, Python, and C#. C#'s deterministic rules run as tree-sitter visitors plus a **build-required** Roslyn semantic host (`tools/csharp-roslyn-host`, needs the .NET 8 SDK). Analyzing C# without the host **fails hard** — there is no tree-sitter-only fallback, by design (see `violation-pipeline.service.ts`).
- Detection patterns are TypeScript constants in `packages/analyzer/src/patterns/`, not JSON files
- LLM providers implement the `LLMProvider` interface — add new providers there
- Types shared between frontend and backend go in `packages/shared`. The analysis-store's file format lives in `packages/core/src/types/snapshot.ts` (core-internal).
- Anything used by both the CLI and the dashboard server lives in `packages/core/`. CLI/dashboard-server should never import from each other — they are sibling adapters over `core`.
