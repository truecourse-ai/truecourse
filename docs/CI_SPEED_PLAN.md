# CI Speed Plan

Source of truth for making `test.yml` and `publish.yml` fast. Update each item's `STATUS:` as work lands.

## Problem

A PR takes ~13.6 min to get a test verdict. A release takes 16–38 min. Both run the same single-runner `pnpm test`.

## Where the time goes

Step timings from a green `test.yml` run (`gh api .../jobs`):

| Step | Time |
|---|---|
| checkout + setup node/pnpm/dotnet | 14s |
| `pnpm install` | 13s |
| `pnpm build` | 54s |
| `dotnet build` Roslyn host | 12s |
| **`pnpm test`** | **722s** |

The test step is 87% of the run. Caching alone cannot fix this.

Full-suite local measurement (`vitest --reporter=json`, 8-core): 320s wall, 1147s CPU across 389 files. Top 20 files = 63% of test CPU.

| File | CPU |
|---|---|
| analyzer/roslyn-rules-bugs.test.ts | 161s |
| analyzer/roslyn-rules-code-quality.test.ts | 121s |
| cli/analyze.test.ts | 56s |
| analyzer/roslyn-rules-performance.test.ts | 51s |
| github-app/guard-gate-runner.test.ts | 45s |

## Root causes

**1. The Roslyn rule tests spawn one .NET process per assertion.**
`tests/analyzer/roslyn-rules-*.test.ts` call `runRoslynHost()` inside every `it()`, and `roslyn-host-client.ts` does `spawn('dotnet', …)` per call — 450+ process boots at ~0.8s each. All C# files together ≈ 430s ≈ 37% of test CPU. The host already accepts *"one `analyze` request with all the files"* (`roslyn-host-client.ts:6`); production batches, the tests do not.

**2. No parallelism above the single runner.** One job, one machine, 397 files.

**3. Turbo cache is cold on every CI run.** The build step logs `Cached: 0 cached, 21 total` — unchanged packages rebuild from scratch every time. No pnpm store or NuGet cache either.

**4. The test job builds packages tests never load.** `@truecourse/dashboard-client` (18.8s) and `@truecourse/landing` (14.9s) — 33.7s of the 123.7s build CPU. Client tests import `apps/dashboard/client/src` through the `@` alias; the architecture test reads `apps/landing/src`. Neither needs the built output.

**5. Stale runs are never cancelled.** `test.yml` has no `concurrency:` block. Across the last 60 runs, 10 overlapping pairs wasted 87 min of runner time.

## Why publish must keep running the tests

The publish test step looks redundant. It is not — it is the only gate a release commit passes.

- Every release tag points at a commit **not on `main`**: `git branch -r --contains` returns `on_main=0` for all six `v0.7.4-*` tags.
- `test.yml` triggers only on `push: branches: [main]` and `pull_request`, so those commits are never tested by it. A search of the last 100 `test.yml` runs for `5a75baac` (v0.7.4-spec-sources.3) returns zero runs.
- That publish run caught a real defect and blocked the release:
  ```
  FAIL tests/core/corpus-in-process.test.ts > curateInProcess
  LlmStageFailureError: every LLM call in the `spec.vocab` stage failed (1 of 1)
    — First failure: spawn /nonexistent/claude-test-tripwire ENOENT
  ```
- All real releases so far used the tag-push trigger; every `pull_request`-triggered publish run was a `gate=false` skip.

**Conclusion: make the publish tests fast, do not remove them.**

Node versions stay split as they are — `test.yml` on Node 20 (the declared `engines` floor and the esbuild `--target`), `publish.yml` on Node 22 (what most users run). That covers both ends at no extra cost.

## Work items

**1. Stop respawning the Roslyn host per assertion.** `STATUS: done`
The host already reads requests in a loop until stdin closes and answers each with one response line (`Program.cs:51`), so the fix is to hold one process open rather than to merge the snippets into a single request — merging would put every snippet in one Roslyn compilation and change what the rules see.

`openRoslynHost()` (`packages/analyzer/src/roslyn-host-client.ts`) returns a session; `runRoslynHost`/`runRoslynWorkspace` are now one-shot wrappers over it, so there is a single code path. `useRoslynHost()` in `tests/analyzer/helpers.ts` gives each rule file one session, closed in `afterAll`. Every snippet is still its own `analyze` request and its own compilation — identical results, one process boot instead of 450.

Measured on the two heaviest files (380 assertions): **282s → 2.41s**, all passing.

**2. Cache `.turbo`, the pnpm store, and NuGet.** `STATUS: done`
In `.github/actions/setup` — a composite action both workflows use, so their toolchain and build steps cannot drift apart. `setup-node` handles the pnpm store; `actions/cache` covers `.turbo/cache` (per-SHA key, prefix restore-key) and `~/.nuget/packages`.

**3. Trim the test job's build scope.** `STATUS: done`
`pnpm build:test` = `turbo build` excluding `./apps/landing` and `./apps/dashboard/client`. Nothing in the suite loads their build output, and the exclusion lives in exactly one place.

Both apps already had `typecheck` scripts; a `typecheck` task in `turbo.json` plus a root `pnpm typecheck` wires them into a CI job that runs alongside the shards. Type coverage moves, it does not disappear.

**4. Shard `test.yml` four ways.** `STATUS: done`
A `matrix` over `vitest --shard=i/4`, plus an aggregate job that branch protection can require as a single check.

Shard balance was simulated against vitest's real algorithm — `sha1(path)` sorted, sliced into contiguous ranges (`BaseSequencer.shard`), so assignment is effectively random and duration-blind:

| N | slowest shard (before item 1) | slowest shard (after item 1) |
|---|---|---|
| 2 | 592s | 400s |
| 4 | 397s | **216s** |
| 6 | 315s | 172s |
| 8 | 300s | 136s |

Before item 1, sharding plateaus at ~300s — one 161s file sets the floor. After it, returns flatten past N=4 because the fixed per-shard overhead dominates. **N=4.**

The divisor comes from `strategy.job-total`, so changing the shard count means editing the matrix list alone.

**5. Shard `publish.yml` the same way.** `STATUS: done`
Same matrix, same coverage, on Node 22. The job list is now `gate → meta → test → publish`: `meta` resolves the version, tag and commit once and every later job checks out that exact SHA, so the commit that is tested is provably the commit that is published. Tag creation moved into `publish`, which means a failing suite no longer leaves a tag behind.

**6. Add `concurrency: cancel-in-progress` to `test.yml`.** `STATUS: done`
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```
Saves runner time, not wall time. Three lines.

## Expected result

| | Now | After |
|---|---|---|
| PR verdict | 13.6 min | ~2.8 min |
| Release | 16–38 min | ~5 min |

No test is skipped, moved to a nightly job, or deleted. Coverage is unchanged.

## Follow-up

`main` is currently unprotected, so nothing had to change outside the repo. If branch protection is turned on later, require **`tests-passed`** — the aggregate job — rather than the individual `test (1..4)` checks, so the shard count can change without touching repository settings.

## Rejected alternatives

| Option | Why not |
|---|---|
| Remove the publish test step | Disproven above — it is the only gate on release commits, and it has caught a real defect |
| `pool: threads` / `isolate: false` | Measured. −36% on collect-heavy packages but only −8% on `tests/analyzer`, and it breaks tests: 29 test files mutate `process.env` (`HOME`, `TRUECOURSE_HOME`, `CLAUDE_CODE_BINARY`, …) and threads share one `process.env`. Needs a threads/forks project split plus an architecture test to keep new files on the right side. Worth revisiting separately; not worth trading determinism for here |
| Larger GitHub runners | Billed on public repos |
| Self-hosted runners | Fork PRs would execute arbitrary code on our hardware |
| `vitest --changed` | The module graph misses fixture and built-`dist` dependencies — false negatives on a merge gate |
| Skip slow tests / move to nightly | Coverage loss |
| Node 20 + 22 matrix | Doubles the job count for little gain; the current 20/22 split already covers both ends |
