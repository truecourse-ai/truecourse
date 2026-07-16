/**
 * `guard run` orchestration: load the recipe, load scenarios, build once, run the
 * scenarios in parallel sandboxes, map outcomes into a `GuardLatest`, and write it
 * to `.truecourse/guard/LATEST.json`. Zero LLM anywhere.
 */

import os from 'node:os'
import crypto from 'node:crypto'
import {
  GUARD_FORMAT_VERSION,
  worstOutcome,
  type GuardLatest,
  type GuardManifest,
  type GuardOutcome,
  type GuardScenario,
  type GuardScenarioResult,
  type GuardSectionRollup,
  type GuardSummary,
} from '@truecourse/shared'
import {
  loadRecipe,
  resolveEntry,
  computeRecipeFingerprint,
  RecipeError,
  DEFAULT_API_HEALTH_PATH,
  DEFAULT_API_READY_TIMEOUT_MS,
  type Recipe,
  type LoadedRecipe,
} from './recipe.js'
import { loadScenarios, type ScenarioLoadError } from './scenario-loader.js'
import { runBuild, runInstall, DEFAULT_BUILD_TIMEOUT_MS, DEFAULT_INSTALL_TIMEOUT_MS, type BuildResult } from './build.js'
import { preflightEntry, formatEntryPreflightError, type EntryPreflightResult } from './preflight.js'
import { runScenario } from './run-scenario.js'
import { runApiScenario } from './api/run-api-scenario.js'
import { preflightApiServer } from './api/preflight.js'
import { appendGuardHistory, recipePath, writeGuardLatest, writeGuardRun } from './store.js'
import { DEFAULT_STEP_TIMEOUT_MS } from './executor.js'
import { indexRepoDocs } from './doc-index.js'
import { resolveBinding, type BindingResolution } from './section-index.js'
import { readManifest } from './manifest.js'

export interface RunGuardOptions {
  repoRoot: string
  /** Restrict the run to a single scenario id (`--scenario`). */
  scenarioId?: string
  /**
   * Run these scenarios instead of the committed ones on disk. The guard
   * generator's birth validation injects freshly-authored candidates here so it
   * exercises them through the exact run engine, building once, without writing
   * anything to the corpus. Omitted → the committed scenarios are loaded.
   */
  scenarios?: GuardScenario[]
  /**
   * Run against this recipe instead of loading `scenarios/recipe.json` from disk.
   * The executor seam supplies it (a hosted store per-commit; birth validation the
   * already-loaded recipe), skipping the `no-recipe`/`invalid-recipe` branches.
   * Omitted → the committed recipe is loaded, exactly as before.
   */
  recipe?: Recipe
  branch?: string | null
  commit?: string | null
  stepTimeoutMs?: number
  /** Overall run wall-clock; exceeding it aborts in-flight scenarios → `run-timed-out`. */
  runTimeoutMs?: number
  /** Build wall-clock, replacing the runner's default (10min) only when set. */
  buildTimeoutMs?: number
  /** Install wall-clock, replacing the runner's default (10min) only when set. */
  installTimeoutMs?: number
  /** External cancellation; SIGKILLs the build/scenario children → `aborted`. */
  signal?: AbortSignal
  /** Parallel sandbox limit; default `TRUECOURSE_MAX_CONCURRENCY`, else min(cpus, 8). */
  concurrency?: number
  /** Suppress the build (tests that pre-build). Off by default. */
  skipBuild?: boolean
  /**
   * Write `LATEST.json` (default true). Birth validation sets it false so a
   * validation run never moves the repo's guard baseline.
   */
  persist?: boolean
  /** Phase transitions for progress rendering; `run` carries the scenario count. */
  onPhase?: (phase: 'build' | 'run', total?: number) => void
  /** Fires as each scenario settles, with the running done-count. */
  onScenarioSettled?: (done: number, total: number, result: GuardScenarioResult) => void
}

export type RunGuardResult =
  | { status: 'no-recipe' }
  | { status: 'invalid-recipe'; message: string }
  | { status: 'no-scenarios'; loadErrors: ScenarioLoadError[]; requestedId?: string }
  | { status: 'build-failed'; build: BuildResult; loadErrors: ScenarioLoadError[] }
  | {
      /**
       * The build succeeded but the built entry cannot START — a stale/orphaned
       * dist, a missing interpreter, a module-resolution crash. ONE loud error with
       * the startup stderr, never N identical scenario failures.
       */
      status: 'entry-preflight-failed'
      preflight: EntryPreflightResult
      /** The recipe build command, for the rebuild hint. */
      buildCommand: string
      loadErrors: ScenarioLoadError[]
    }
  | {
      /**
       * The overall `runTimeoutMs` wall-clock elapsed before every scenario
       * settled; in-flight children were SIGKILLed and nothing was persisted.
       */
      status: 'run-timed-out'
      elapsedMs: number
      /** Scenarios that settled before the deadline, of `total` selected. */
      settled: number
      total: number
    }
  | {
      /** The external `signal` fired; children were killed, nothing persisted. */
      status: 'aborted'
      phase: 'build' | 'run'
    }
  | {
      status: 'ok'
      latest: GuardLatest
      latestPath: string
      loadErrors: ScenarioLoadError[]
      /** The binding record if `scenarios/manifest.json` exists (informational). */
      manifest: GuardManifest | null
    }

/**
 * The canonical human-readable reason for a non-ok run result (`null` for 'ok').
 * Every adapter — the CLI command, the dashboard run route, birth validation —
 * renders THIS wording and adds only its own framing (exit codes, prefixes,
 * output tails), so the per-status phrasing can never drift between surfaces.
 */
export function runFailureMessage(result: Exclude<RunGuardResult, { status: 'ok' }>): string
export function runFailureMessage(result: RunGuardResult): string | null
export function runFailureMessage(result: RunGuardResult): string | null {
  switch (result.status) {
    case 'ok':
      return null
    case 'no-recipe':
      return 'No .truecourse/scenarios/recipe.json found. Add a recipe describing how to build and invoke the entrypoint.'
    case 'invalid-recipe':
      return `recipe.json is invalid: ${result.message}`
    case 'no-scenarios':
      return result.requestedId
        ? `No scenario with id "${result.requestedId}".`
        : 'No scenarios found under .truecourse/scenarios/.'
    case 'build-failed':
      return `Build failed (\`${result.build.command}\`)${result.build.timedOut ? ' — timed out' : ''}. No scenarios ran.`
    case 'entry-preflight-failed':
      return formatEntryPreflightError({
        entry: result.preflight.entry,
        buildCommand: result.buildCommand,
        stderr: result.preflight.stderr,
      })
    case 'run-timed-out':
      return `Guard run timed out after ${Math.round(result.elapsedMs / 1000)}s — ${result.settled}/${result.total} scenarios settled; in-flight scenarios were aborted.`
    case 'aborted':
      return `Guard run was aborted during the ${result.phase} phase.`
  }
}

/** Recipe + scenario sourcing outcome: an early result, or the inputs to execute. */
export type GuardRunInputs =
  | { early: RunGuardResult }
  | { loaded: LoadedRecipe; selected: GuardScenario[]; loadErrors: ScenarioLoadError[] }

/** Load the committed recipe, mapping load failures to their early results. */
function sourceRecipe(repoRoot: string): { early: RunGuardResult } | { loaded: LoadedRecipe } {
  let loaded: LoadedRecipe | null
  try {
    loaded = loadRecipe(repoRoot, recipePath(repoRoot))
  } catch (e) {
    if (e instanceof RecipeError) return { early: { status: 'invalid-recipe', message: e.message } }
    throw e
  }
  if (!loaded) return { early: { status: 'no-recipe' } }
  return { loaded }
}

/** Apply the optional id restriction, mapping an empty selection to no-scenarios. */
function selectScenarios(
  scenarios: GuardScenario[],
  loadErrors: ScenarioLoadError[],
  scenarioId?: string,
): { early: RunGuardResult } | { selected: GuardScenario[] } {
  const selected = scenarioId ? scenarios.filter((s) => s.id === scenarioId) : scenarios
  if (selected.length === 0) {
    return { early: { status: 'no-scenarios', loadErrors, requestedId: scenarioId } }
  }
  return { selected }
}

/**
 * Source the committed recipe + scenarios exactly as `runGuard` itself would.
 * External drivers that decide "is there anything to run" locally (the core run
 * command keeps that decision on its side of the executor seam) call this instead
 * of re-implementing the load shape, so their early-result semantics can never
 * drift from the engine's.
 */
export function sourceGuardRunInputs(repoRoot: string, scenarioId?: string): GuardRunInputs {
  const recipe = sourceRecipe(repoRoot)
  if ('early' in recipe) return recipe
  const { scenarios, errors: loadErrors } = loadScenarios(repoRoot)
  const sel = selectScenarios(scenarios, loadErrors, scenarioId)
  if ('early' in sel) return sel
  return { loaded: recipe.loaded, selected: sel.selected, loadErrors }
}

export async function runGuard(opts: RunGuardOptions): Promise<RunGuardResult> {
  const { repoRoot } = opts

  // A caller cancelled before anything started never reached the run phase.
  if (opts.signal?.aborted) return { status: 'aborted', phase: 'build' }

  let loaded: LoadedRecipe
  if (opts.recipe) {
    // Injected recipe: the fingerprint is still the on-disk discovery-input hash
    // (identical to what loadRecipe would compute) so the persisted run envelope is
    // unchanged; only the disk read of recipe.json is skipped.
    loaded = { recipe: opts.recipe, fingerprint: computeRecipeFingerprint(repoRoot) }
  } else {
    const disk = sourceRecipe(repoRoot)
    if ('early' in disk) return disk.early
    loaded = disk.loaded
  }

  const { scenarios, errors: loadErrors } = opts.scenarios
    ? { scenarios: opts.scenarios, errors: [] as ScenarioLoadError[] }
    : loadScenarios(repoRoot)
  const sel = selectScenarios(scenarios, loadErrors, opts.scenarioId)
  if ('early' in sel) return sel.early
  const selected = sel.selected

  // Check each binding against the live section index before running anything.
  // A section that was edited (stale) or removed (orphaned) is not executed;
  // a section that moved with its text intact remaps and still runs.
  const docIndexes = indexRepoDocs(repoRoot, new Set(selected.map((s) => s.binds.doc)))
  const planned = selected.map((scenario) => ({
    scenario,
    resolution: resolveBinding(
      docIndexes.indexes.get(scenario.binds.doc) ?? null,
      scenario.binds.section,
      scenario.binds.fingerprint,
    ),
  }))
  const executable = planned.filter(
    (p) => p.resolution.kind === 'match' || p.resolution.kind === 'remap',
  )
  const nonExecutable = planned.filter(
    (p) => p.resolution.kind === 'stale' || p.resolution.kind === 'orphaned',
  )

  // Per-driver preparation: a cli scenario needs the recipe `entry`; an api
  // scenario needs the `api` block. A scenario whose preparation is missing
  // settles as an `error` naming the gap (never a silent skip) and never blocks
  // the other driver's scenarios from running.
  const cliExec = executable.filter((p) => p.scenario.driver === 'cli')
  const apiExec = executable.filter((p) => p.scenario.driver === 'api')
  const hasEntry = loaded.recipe.entry !== undefined
  const api = loaded.recipe.api
  const runnable = [...(hasEntry ? cliExec : []), ...(api ? apiExec : [])]
  const unprepared = [
    ...(hasEntry
      ? []
      : cliExec.map((p) => ({ ...p, missing: 'recipe.json has no `entry` — the cli driver has no preparation' }))),
    ...(api
      ? []
      : apiExec.map((p) => ({ ...p, missing: 'recipe.json has no `api` block — the api driver has no preparation' }))),
  ]

  // We own the build (and thus the entry pre-flight) only on a real run; birth
  // validation reuses the generator's single build + pre-flight and passes skipBuild.
  const buildsOwnEntry = !opts.skipBuild && runnable.length > 0

  // Run-level cancellation: children listen on ONE internal controller, tripped by
  // either the external `signal` or the overall `runTimeoutMs` wall-clock —
  // whichever fires, in-flight children are SIGKILLed and nothing is persisted.
  const startedAt = Date.now()
  const cancel = new AbortController()
  let runTimedOut = false
  let settled = 0
  // True once `api.services.up` ran — the matching `down` runs on the way out.
  let servicesUp = false
  const onExternalAbort = (): void => cancel.abort()
  opts.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const runTimer =
    opts.runTimeoutMs !== undefined
      ? setTimeout(() => {
          runTimedOut = true
          cancel.abort()
        }, opts.runTimeoutMs)
      : null

  /** The cancellation result to return from `phase`, or null when still live. */
  const cancelled = (phase: 'build' | 'run'): RunGuardResult | null => {
    if (runTimedOut) {
      return { status: 'run-timed-out', elapsedMs: Date.now() - startedAt, settled, total: selected.length }
    }
    if (opts.signal?.aborted) return { status: 'aborted', phase }
    return null
  }

  try {
    if (buildsOwnEntry) {
      opts.onPhase?.('build')
      // The optional recipe install runs BEFORE the build, in the repo root, with
      // the same hermetic env. A failed install is reported exactly like a failed
      // build — its BuildResult carries the install command.
      if (loaded.recipe.install) {
        const install = await runInstall(
          repoRoot,
          loaded.recipe.install,
          loaded.recipe.env,
          opts.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
          cancel.signal,
        )
        // A cancellation-killed install must never masquerade as a build failure.
        const stop = cancelled('build')
        if (stop) return stop
        if (!install.ok) return { status: 'build-failed', build: install, loadErrors }
      }
      const build = await runBuild(
        repoRoot,
        loaded.recipe.build,
        loaded.recipe.env,
        opts.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
        cancel.signal,
      )
      // A cancellation-killed build must never masquerade as a build failure.
      const stop = cancelled('build')
      if (stop) return stop
      if (!build.ok) return { status: 'build-failed', build, loadErrors }
    }

    const resolvedEntry = hasEntry ? resolveEntry(repoRoot, loaded.recipe.entry!) : null

    // Pre-flight the built entry ONCE before any cli scenario touches it: if it
    // can't even start, that is ONE loud entry-level error, not N indistinguishable
    // scenario failures. Runs under the build phase (before the run counter is announced).
    if (buildsOwnEntry && resolvedEntry && cliExec.length > 0) {
      const preflight = await preflightEntry({
        resolvedEntry,
        displayEntry: loaded.recipe.entry!,
        recipeEnv: loaded.recipe.env,
        repoRoot,
      })
      const stop = cancelled('build')
      if (stop) return stop
      if (!preflight.ok) {
        return { status: 'entry-preflight-failed', preflight, buildCommand: loaded.recipe.build, loadErrors }
      }
    }

    // Api preparation — the optional one-shot services bring-up (the repo's own
    // command, e.g. `docker compose up -d db`), then ONE loud boot preflight in a
    // throwaway sandbox (the api analog of the entry preflight above, reported
    // through the SAME result status). Runs even under `skipBuild` — the server
    // boot is not the build, and birth validation needs the loud single error too.
    let resolvedServe: string[] | null = null
    let apiRecipeEnv: Record<string, string> | undefined
    if (api && apiExec.length > 0) {
      resolvedServe = resolveEntry(repoRoot, api.serve)
      apiRecipeEnv = { ...(loaded.recipe.env ?? {}), ...(api.env ?? {}) }
      if (api.services) {
        const up = await runBuild(
          repoRoot,
          api.services.up,
          loaded.recipe.env,
          opts.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
          cancel.signal,
        )
        const stop = cancelled('build')
        if (stop) return stop
        if (!up.ok) return { status: 'build-failed', build: up, loadErrors }
        servicesUp = true
      }
      const apiPreflight = await preflightApiServer({
        resolvedServe,
        displayServe: api.serve,
        recipeEnv: apiRecipeEnv,
        healthPath: api.healthPath ?? DEFAULT_API_HEALTH_PATH,
        readyTimeoutMs: api.readyTimeoutMs ?? DEFAULT_API_READY_TIMEOUT_MS,
        signal: cancel.signal,
      })
      const stop = cancelled('build')
      if (stop) return stop
      if (!apiPreflight.ok) {
        return { status: 'entry-preflight-failed', preflight: apiPreflight, buildCommand: loaded.recipe.build, loadErrors }
      }
    }

    opts.onPhase?.('run', selected.length)

    const runId = buildRunId()
    const ranAt = new Date().toISOString()
    const stepTimeoutMs = opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
    const concurrency = opts.concurrency ?? defaultRunConcurrency()

    const results: GuardScenarioResult[] = []

    // Stale/orphaned scenarios settle immediately — they never touch a sandbox.
    for (const { scenario, resolution } of nonExecutable) {
      const result = nonExecutableResult(scenario, resolution)
      results.push(result)
      settled += 1
      opts.onScenarioSettled?.(settled, selected.length, result)
    }

    // Scenarios whose driver has no preparation in the recipe settle as errors —
    // an honest per-scenario gap, never a silent skip, never a run-wide failure.
    for (const { scenario, resolution, missing } of unprepared) {
      const result: GuardScenarioResult = {
        id: scenario.id,
        title: scenario.title,
        binds: scenario.binds,
        outcome: 'error',
        durationMs: 0,
        failure: { step: 1, expected: `the recipe to prepare the ${scenario.driver} driver`, actual: missing },
        ...(resolution.kind === 'remap' ? { remappedTo: resolution.section.anchor } : {}),
      }
      results.push(result)
      settled += 1
      opts.onScenarioSettled?.(settled, selected.length, result)
    }

    // Pass evidence is part of the persisted run baseline; a non-persisted (birth
    // validation) run captures none for its passing candidates — the next real run does.
    const capturePassEvidence = opts.persist !== false
    const executed = (
      await mapWithConcurrency(runnable, concurrency, async ({ scenario, resolution }) => {
        // Once cancelled, no new child spawns; a post-cancel settlement doesn't count
        // either — a run ending `aborted`/`run-timed-out` discards these results.
        if (cancel.signal.aborted) return null
        const outcome =
          scenario.driver === 'api'
            ? await runApiScenario(scenario, {
                repoRoot,
                runId,
                resolvedServe: resolvedServe!,
                healthPath: api!.healthPath ?? DEFAULT_API_HEALTH_PATH,
                readyTimeoutMs: api!.readyTimeoutMs ?? DEFAULT_API_READY_TIMEOUT_MS,
                recipeEnv: apiRecipeEnv,
                stepTimeoutMs,
                capturePassEvidence,
                signal: cancel.signal,
              })
            : await runScenario(scenario, {
                repoRoot,
                runId,
                resolvedEntry: resolvedEntry!,
                recipeEnv: loaded.recipe.env,
                stepTimeoutMs,
                capturePassEvidence,
                signal: cancel.signal,
              })
        if (cancel.signal.aborted) return null
        const result: GuardScenarioResult =
          resolution.kind === 'remap' ? { ...outcome, remappedTo: resolution.section.anchor } : outcome
        settled += 1
        opts.onScenarioSettled?.(settled, selected.length, result)
        return result
      })
    ).filter((r): r is GuardScenarioResult => r !== null)
    const stop = cancelled('run')
    if (stop) return stop
    results.push(...executed)
    results.sort((a, b) => a.id.localeCompare(b.id))

    const latest: GuardLatest = {
      run: {
        runId,
        ranAt,
        branch: opts.branch ?? null,
        commit: opts.commit ?? null,
        recipeFingerprint: loaded.fingerprint,
        scenarioFormat: GUARD_FORMAT_VERSION,
      },
      summary: summarize(results),
      scenarios: results,
      sections: rollupSections(results),
    }

    // Birth validation runs with `persist: false` and must write NOTHING to the
    // store — no LATEST, no run snapshot, no history — so it never moves the baseline.
    let latestPath = ''
    if (opts.persist !== false) {
      latestPath = writeGuardLatest(repoRoot, latest)
      writeGuardRun(repoRoot, latest)
      appendGuardHistory(repoRoot, {
        runId: latest.run.runId,
        ranAt: latest.run.ranAt,
        branch: latest.run.branch,
        commit: latest.run.commit,
        summary: latest.summary,
      })
    }
    return { status: 'ok', latest, latestPath, loadErrors, manifest: readManifest(repoRoot) }
  } finally {
    if (runTimer) clearTimeout(runTimer)
    opts.signal?.removeEventListener('abort', onExternalAbort)
    // Tear down whatever `api.services.up` brought up — best-effort, unconditional
    // (a failed teardown must never mask the run's own result).
    if (servicesUp && api?.services?.down) {
      await runBuild(repoRoot, api.services.down, loaded.recipe.env, DEFAULT_BUILD_TIMEOUT_MS)
    }
  }
}

/** Build the result for a scenario the binding check excluded from execution. */
function nonExecutableResult(
  scenario: GuardScenario,
  resolution: BindingResolution,
): GuardScenarioResult {
  const base = { id: scenario.id, title: scenario.title, binds: scenario.binds, durationMs: 0 }
  if (resolution.kind === 'stale') {
    return { ...base, outcome: 'stale', currentFingerprint: resolution.currentFingerprint }
  }
  return { ...base, outcome: 'orphaned' }
}

function summarize(results: readonly GuardScenarioResult[]): GuardSummary {
  const summary: GuardSummary = { total: results.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 }
  for (const r of results) summary[r.outcome] += 1
  return summary
}

function rollupSections(results: readonly GuardScenarioResult[]): GuardSectionRollup[] {
  const byKey = new Map<string, { doc: string; section: string; outcomes: GuardOutcome[]; ids: string[] }>()
  for (const r of results) {
    const key = `${r.binds.doc}\x00${r.binds.section}`
    let entry = byKey.get(key)
    if (!entry) {
      entry = { doc: r.binds.doc, section: r.binds.section, outcomes: [], ids: [] }
      byKey.set(key, entry)
    }
    entry.outcomes.push(r.outcome)
    entry.ids.push(r.id)
  }
  return [...byKey.values()]
    .map((e) => ({
      doc: e.doc,
      section: e.section,
      status: worstOutcome(e.outcomes),
      scenarioIds: e.ids.slice().sort(),
    }))
    .sort((a, b) => a.doc.localeCompare(b.doc) || a.section.localeCompare(b.section))
}

/**
 * Default scenario-sandbox concurrency: `TRUECOURSE_MAX_CONCURRENCY` when it parses
 * to a positive integer (same semantics as the guard generator's authoring limit),
 * else `min(cpus, 8)`. Birth validation inherits it via `runGuard`.
 */
export function defaultRunConcurrency(): number {
  const env = process.env.TRUECOURSE_MAX_CONCURRENCY
  if (env) {
    const n = parseInt(env, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return Math.min(os.cpus().length, 8)
}

/** `<iso>_<short-uuid>` — sortable, filesystem-safe, matches the analyze store convention. */
function buildRunId(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')
  const short = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  return `${iso}_${short}`
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}
