/**
 * The `GuardExecutor` seam — the single boundary all guard EXECUTION crosses
 * (a real `guard run` and generate-time birth validation alike). The OSS default
 * runs in-process through {@link runGuard}; the enterprise edition swaps in a
 * hosted executor (build + run a per-commit checkout elsewhere) via the registry
 * in `@truecourse/core`, symmetric with the `GuardStore` seam.
 *
 * The TYPE and the default live here (guard-runner); the singleton registry lives
 * in core. `guard-generator` never imports core — it receives the executor as a
 * threaded option, so its only edge stays guard-generator → guard-runner.
 */

import type { GuardScenario, GuardScenarioResult } from '@truecourse/shared'
import type { Recipe } from './recipe.js'
import { runGuard, type RunGuardResult } from './run.js'

export interface GuardExecInput {
  /** The checkout to build + run against (working-tree root). */
  checkoutDir: string
  /** The recipe — passed IN, not read from disk, so a hosted store can supply it per-commit. */
  recipe: Recipe
  /**
   * Scenarios to execute: committed corpus for a run, fresh candidates for
   * birth-validation. Callers pass the exact set to run — any `--scenario`-style
   * restriction is applied before the seam, so the executor carries no filter.
   */
  scenarios: GuardScenario[]
  /**
   * The ids of the FULL corpus `scenarios` was drawn from. Because the filter is
   * applied before the seam, a scoped run must say what it filtered OUT, or the
   * merged board would read those scenarios as deleted and drop their last verdicts.
   * Omitted ⇒ `scenarios` IS the corpus (a full run; birth validation, which
   * persists nothing at all).
   */
  corpusIds?: readonly string[]
  branch?: string | null
  commit?: string | null
  /** true = real run (persist LATEST/run/history), false = birth-validation (in-memory only). REQUIRED. */
  persist: boolean
  /** Suppress the build (birth reuses the generator's single build between rounds). */
  skipBuild?: boolean
  /** Parallel sandbox limit; default `TRUECOURSE_MAX_CONCURRENCY`, else min(cpus, 8). */
  concurrency?: number
  /** Per-step wall-clock timeout for a scenario's commands. */
  stepTimeoutMs?: number
  /** No-op classification threshold for the birth anomaly gate (C4) — a test seam;
   *  production leaves it on the runner's default. */
  noOpThresholdMs?: number
  /** Overall run wall-clock; exceeding it aborts in-flight scenarios → `run-timed-out`. */
  runTimeoutMs?: number
  /** Build wall-clock, replacing the runner's default only when set. */
  buildTimeoutMs?: number
  /** Install wall-clock, replacing the runner's default only when set. */
  installTimeoutMs?: number
  /** External cancellation; aborts the build + scenario children → `aborted`. */
  signal?: AbortSignal
  onPhase?: (phase: 'build' | 'run', total?: number) => void
  onScenarioSettled?: (done: number, total: number, result: GuardScenarioResult) => void
}

/** The run report — reuses the existing discriminated union verbatim. */
export type GuardExecReport = RunGuardResult

/** The seam: checkout + scenarios + recipe → run report. */
export type GuardExecutor = (input: GuardExecInput) => Promise<GuardExecReport>

/**
 * OSS default: run in-process through the existing engine. The input maps 1:1 onto
 * `RunGuardOptions` — `checkoutDir` → `repoRoot`, everything else by name — and the
 * injected `recipe` makes `runGuard` skip its disk load.
 */
export const defaultGuardExecutor: GuardExecutor = (input) =>
  runGuard({
    repoRoot: input.checkoutDir,
    recipe: input.recipe,
    scenarios: input.scenarios,
    ...(input.corpusIds ? { corpusIds: input.corpusIds } : {}),
    branch: input.branch,
    commit: input.commit,
    persist: input.persist,
    skipBuild: input.skipBuild,
    concurrency: input.concurrency,
    stepTimeoutMs: input.stepTimeoutMs,
    noOpThresholdMs: input.noOpThresholdMs,
    runTimeoutMs: input.runTimeoutMs,
    buildTimeoutMs: input.buildTimeoutMs,
    installTimeoutMs: input.installTimeoutMs,
    signal: input.signal,
    onPhase: input.onPhase,
    onScenarioSettled: input.onScenarioSettled,
  })
