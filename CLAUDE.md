# TrueCourse — Claude Instructions

## Key Files to Keep Updated

- **PLAN.md** — The source of truth for all phases, implementation status, and test plans. When completing work on any phase or sub-task, update the relevant `STATUS:` tags. When adding new features or changing scope, update the plan accordingly.
- **README.md** — Must reflect the current state of the project. When adding new packages, endpoints, commands, environment variables, or changing the project structure, update the README to match.

## Project Layout

- `apps/dashboard/client/` — Vite + React Router frontend (React Flow graph, Tailwind CSS, dark mode)
- `apps/dashboard/server/` — Express + Socket.io HTTP layer that serves the dashboard. Thin adapter over `@truecourse/core`; contains routes, sockets, middleware, and dashboard-only services (analytics, watcher, telemetry).
- `apps/landing/` — Public marketing site (Vite + React + Tailwind v4). Standalone, deployed separately from the local dashboard. `pnpm --filter @truecourse/landing dev` runs it on port 3100. Sample OSS analysis reports live in `apps/landing/src/data/analyses.ts`.
- `packages/core/` — Framework-agnostic analysis engine: pipeline, graph/flow services, LLM providers, persistence (analysis-store), config, logger, errors. Consumed by both the CLI and the dashboard server.
- `packages/analyzer/` — Tree-sitter (WASM via `web-tree-sitter`) + TypeScript Compiler analysis engine (TS/JS/Python)
- `packages/shared/` — Shared Zod schemas and TypeScript types
- `tools/cli/` — CLI commands (analyze, dashboard, list, add, rules). Thin adapter over `@truecourse/core` — does NOT depend on the dashboard server.
- `tests/` — All tests (centralized, not colocated). Organized by package: `tests/shared/`, `tests/analyzer/`, `tests/server/` (covers both dashboard-server routes and core services), `tests/cli/`.
- `tests/fixtures/sample-project/` — Realistic multi-service TS/JS repo used by tests

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
- `verifier/` — drift store for `truecourse verify`, mirroring the analyze store (see `packages/core/src/lib/verify-store.ts`):
  - `verifier/runs/<iso>_<short-uuid>.json` — per-run drift snapshots (gitignored)
  - `verifier/LATEST.json` — materialized current verify state + diff baseline (committable, same convention as the analyze `LATEST.json`)
  - `verifier/history.json` — append-only per-run summaries (gitignored)
  - `verifier/diff.json` — optional current-vs-baseline drift diff, overwritten each `verify --diff` run (gitignored)
- `specs/` — the spec-consolidation store for `truecourse spec scan`:
  - `specs/corpus.json` — **committable** (LATEST.json convention). The curated doc corpus produced by the corpus-path scan (`curate()`): kept docs + their area tags, docs grouped by area, within-area overlap flags, auto-detected doc→doc relations, and the relevance-dropped docs (`skippedDocs`: path + reason) so the dashboard can surface "not included" docs for force-include. Expensive to regenerate (LLM tagging) and not purely deterministic, so teammates inherit it from git. See `docs/SPEC_SCAN_REDESIGN_PLAN.md`.
  - `specs/decisions.json` — **committable**, user-authored. Curated resolutions: doc→doc `relations[]` (replace/precedence/keep-both), `manualAreas[]` (area-tag overrides), `manualIncludes[]` (relevance force-includes), and `manualExcludes[]` (force-excludes — drop an otherwise-kept doc).
- `.cache/` — derived, **gitignored**, safe to delete (re-derived on the next run): the per-stage LLM KV caches that make re-runs cheap — `consolidator/{area-tags,relevance,overlap,vocab,chain-detection}/` (scan), `contract/{enumerate,reconcile,extract}/` (generate), plus `drift/` and `verifier/` (verify). The `contract/extract` cache is keyed on each area's prompt + doc-content hash + reconciled target identities, so `contracts generate` only re-runs the (expensive Opus) extraction for areas whose specs actually changed — unchanged areas are cache hits. **Not** for run-result data — that's `contracts/result.json` below.
- `contracts/` (+ `contracts/_inferred/`, `contracts/_shared/`) — the generated `.tc` contract corpus, **committable / git-tracked**. Although it's a materialization of `specs/corpus.json`, it's kept in git on purpose: the OSS Contracts BL-Drift view diffs working-tree `.tc` against HEAD (`/contracts/diff`), so committing your contracts is how PRs review spec changes.
- `contracts/manifest.json` — **committable / git-tracked**. The spec→contract map: each area's spec content-hash from the last generate. Travels with the repo so `contracts generate` is a deterministic no-op when specs are unchanged (a cloner re-running generate regenerates nothing) — only new/edited areas call the LLM, deleted specs drop their contracts. The estimate reads it too (deterministic, clone-safe). See `packages/contract-extractor/src/manifest.ts`.
- `contracts/result.json` — **gitignored** run-result of the last `contracts generate` (written count, coverage gaps, validation issues), living next to the `.tc` tree it describes. The dashboard reads it back so a page reload still shows them, and its mtime drives the staleness dots. (The rest of `contracts/` is tracked; this one file is ignored.)

The gitignored vs committable split is materialized by the `.truecourse/.gitignore` template in `packages/core/src/config/paths.ts` (`GITIGNORE_CONTENTS`) — keep it in sync when adding store files.

`LATEST.json` is tracked so it travels via git: `git worktree add` and fresh clones inherit a baseline without anyone having to cold-start `truecourse analyze`. The convention is **only commit `LATEST.json` after merging to main** (run `truecourse analyze`, commit the result). Don't commit it from feature branches — two PRs both updating `LATEST.json` will conflict on a giant generated JSON. The same applies to `verifier/LATEST.json` (the drift baseline) and `specs/corpus.json` (the spec snapshot): commit it only after merging to main.

Global layout under `~/.truecourse/`:
- `config.json` — LLM keys, provider
- `registry.json` — known project paths + `lastAnalyzed`
- `logs/` — dashboard + install logs
- `cache/openrouter-prices.json` — cached model prices (per-token, fetched daily from OpenRouter) for the pre-flight cost estimate. Derived, safe to delete. Set `TRUECOURSE_NO_PRICE_FETCH=1` to skip the network and use bundled list prices (air-gapped; the test suite sets this).

The server walks up from `cwd` looking for `.truecourse/`. Set `TRUECOURSE_HOME` to relocate the user-level dir (tests do this).

The pre-flight LLM estimate (spec scan / contracts generate) is **token + ceiling-cost**: token math is deterministic and offline; cost multiplies the high end of each stage's call range by per-token prices and ignores prompt-caching discounts, so the real bill lands at or below it. The single source is `packages/core/src/services/llm/{token-estimator,spec-estimate,model-prices}.ts` — the CLI prompt and dashboard modal render identical numbers. Both estimates are **cache-aware** and label the subject "N of M … changed"; when nothing changed the estimate has no stages and the confirm prompt is skipped:
- **Scan** — exact: relevance + area-tags are cached per doc (content-keyed) and each cache directly gates its own call, so the estimate reads the real caches (`readRelevanceCache`/`isAreaTagCached`) and counts only the misses.
- **Generate** — uses the enumerate cache as a proxy for the extract cache (docs unchanged ⇒ both cached). One caveat documented in `spec-estimate.ts`: on the first run after the extract cache was introduced the enumerate cache can be warm while the extract cache is empty, so that single run can under-count.

## Rules

- **No workarounds.** Always find and fix the root cause. Do not use hacks, fallbacks, or temporary patches to bypass issues. If something isn't working, investigate why and fix it properly.
- **Dev servers.** Do not start, stop, or restart dev servers. The user manages `pnpm dev` from their terminal. If a restart is needed (e.g. `.env` change), tell the user.
- **Storage.** The store is file-based. Writes go through `packages/core/src/lib/analysis-store.ts` via `atomicWriteJson` (write-to-tmp + rename for atomicity). Reads are mtime-cached on `LATEST.json`. Concurrent analyses are prevented by `.analyze.lock` (O_EXCL).

## Releasing

When bumping the package version, update all four places — `package.json` alone is not enough because `commander` reads the version from code:

1. `tools/cli/package.json` — the `truecourse` CLI published to npm.
2. `packages/core/package.json` — the `@truecourse/core` workspace package (kept in sync even though it's not published separately).
3. `apps/dashboard/server/package.json` — the `@truecourse/dashboard-server` workspace package (kept in sync even though it's not published separately).
4. `tools/cli/src/index.ts` — the `.version("X.Y.Z")` call on the commander program. This is what `truecourse --version` prints.

The internal packages (`@truecourse/dashboard-client`, `@truecourse/analyzer`, `@truecourse/shared`) are marked `private: true` and never published — leave their versions at `0.1.0`.

npm publishing is automated: push a git tag `vX.Y.Z` after merging to `main` and the GitHub Actions workflow publishes `truecourse` to npm. Never `npm publish` manually.

## Testing

- When running tests, save the full output to a file and read from it — do NOT run tests multiple times with different grep patterns. For example: `pnpm test 2>&1 | tee /tmp/test-output.txt` then read the file.

## Conventions

- All tests live in the `tests/` directory at the repo root, not colocated with source files
- The analyzer supports TypeScript, JavaScript, Python, and C#. C#'s deterministic rules run as tree-sitter visitors plus a **build-required** Roslyn semantic host (`tools/csharp-roslyn-host`, needs the .NET 8 SDK). Analyzing C# without the host **fails hard** — there is no tree-sitter-only fallback, by design (see `violation-pipeline.service.ts`).
- Detection patterns are TypeScript constants in `packages/analyzer/src/patterns/`, not JSON files
- LLM providers implement the `LLMProvider` interface — add new providers there
- Types shared between frontend and backend go in `packages/shared`. The analysis-store's file format lives in `packages/core/src/types/snapshot.ts` (core-internal).
- Anything used by both the CLI and the dashboard server lives in `packages/core/`. CLI/dashboard-server should never import from each other — they are sibling adapters over `core`.
