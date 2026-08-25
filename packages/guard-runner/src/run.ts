/**
 * `guard run` orchestration: load the recipe, load scenarios, build once, run the
 * scenarios in parallel sandboxes, map outcomes into a `GuardLatest`, and write it
 * to `.truecourse/guard/LATEST.json`. Zero LLM anywhere.
 */

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  guardExecutionSteps,
  guardScenarioDrivers,
  isApiRequestStep,
  isApiServerScenario,
  isRunStep,
  isWebStep,
  worstOutcome,
  type GuardApiScenario,
  type GuardCliStep,
  type GuardBinds,
  type GuardLatest,
  type GuardManifest,
  type GuardOutcome,
  type GuardScenario,
  type GuardScenarioResult,
  type GuardSectionRollup,
} from '@truecourse/shared'
import { responseJsonSchema, openApiServerBasePath } from '@truecourse/shared/openapi'
import {
  loadRecipe,
  resolveEntry,
  computeRecipeFingerprint,
  resolveApiCredentials,
  CredentialResolutionError,
  RecipeError,
  resolveApiServers,
  resolveScenarioServer,
  resolveWebSurface,
  credentialServers,
  type Recipe,
  type LoadedRecipe,
  type RecipeApiCredential,
  type ResolvedApiServer,
} from './recipe.js'
import {
  loadResolvedExternals,
  externalsInjectEnv,
  externalsSecrets,
  externalProxyTargets,
  boundIncompleteExternals,
  incompleteExternalMessage,
  ExternalsError,
  type ResolvedExternal,
} from './externals.js'
import { loadScenarios, type ScenarioLoadError } from './scenario-loader.js'
import type { GuardSharedWorld } from './shared-world.js'
import {
  DependencyCatalogError,
  dependencyBlockFor,
  resolveDependencies,
  suppliedInstancesFor,
  type DependencyBlock,
  type ResolvedDependencies,
} from './dependencies.js'
import { readGuardDecisions } from './decisions.js'
import { runBuild, runInstall, DEFAULT_BUILD_TIMEOUT_MS, DEFAULT_INSTALL_TIMEOUT_MS, type BuildResult } from './build.js'
import { preflightEntry, formatEntryPreflightError, type EntryPreflightResult } from './preflight.js'
import { runScenario } from './run-scenario.js'
import {
  createStepStatsCollector,
  detectNoOpAnomaly,
  type GuardNoOpAnomaly,
  type GuardRunStepStats,
} from './step-stats.js'
import { runApiScenario, type RunApiScenarioContext, type ServesPathVerdict } from './api/run-api-scenario.js'
import { buildRouteManifest, whichAppServes, type RouteManifest } from './route-manifest.js'
import { preflightApiServer } from './api/preflight.js'
import { runSeed, SeedError } from './api/seed.js'
import { containsFixtureReference } from './api/vars.js'
import { runCredentialRequests, CredentialRequestError } from './api/credential-request.js'
import {
  appendGuardHistory,
  readGuardLatest,
  readMergedInterfaceCatalog,
  recipePath,
  writeGuardLatest,
  writeGuardRun,
} from './store.js'
import { mergeGuardBoard, summarizeResults } from './board.js'
import { DEFAULT_STEP_TIMEOUT_MS } from './executor.js'
import { indexRepoDocs, nodeRefContext } from './doc-index.js'
import {
  resolveScenarioBinds,
  isOpenApiDoc,
  extractSectionTexts,
  type BindingResolution,
  type DocSectionIndex,
  type ScenarioBindingVerdict,
} from './section-index.js'
import { isInterfaceDrifted } from './interface-drift.js'
import { readManifest } from './manifest.js'
import { newRunNonce, scenarioUnique } from './unique.js'
import type { GuardVisualJudge } from './visual-judge.js'

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
   * The ids of the FULL committed corpus this run's selection was drawn from — what
   * the merged board keeps rows for. A caller that applies its own `--scenario`
   * restriction before calling (the core run driver does, so a hosted executor never
   * carries a filter) must pass it, or the scenarios it filtered out would look
   * deleted and drop off the board. Omitted → the scenarios handed to this run ARE
   * the corpus, which is what a full run and the `scenarioId` path below both mean.
   */
  corpusIds?: readonly string[]
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
   * The run-level SHARED world (services + seed), threaded by generate across
   * every sandbox/birth execution so their lifecycles cannot race on the
   * recipe's singleton compose project (see shared-world.ts). When present,
   * this run consumes the shared boot instead of running `services.up`/`seed`
   * itself, and NEVER runs `services.down` — the handle's owner does, once.
   * In-process only; absent on a plain `guard run` and on hosted executors.
   */
  sharedWorld?: GuardSharedWorld
  /**
   * The wall-clock below which an exit-0 empty-output cli step is classified a
   * no-op for anomaly detection (C4). Defaults to `NO_OP_STEP_THRESHOLD_MS`; a
   * test seam that lets a run exercise the aggregation without relying on
   * sub-10ms real process timing. The api predicate has no timing knob — loopback
   * latency does not separate a dead stub from a healthy server.
   */
  noOpThresholdMs?: number
  /**
   * Write `LATEST.json` (default true). Birth validation sets it false so a
   * validation run never moves the repo's guard baseline.
   */
  persist?: boolean
  /** Phase transitions for progress rendering; `run` carries the scenario count. */
  onPhase?: (phase: 'build' | 'run', total?: number) => void
  /** Fires as each scenario settles, with the running done-count. */
  onScenarioSettled?: (done: number, total: number, result: GuardScenarioResult) => void
  /**
   * OPTIONAL annotator for FAILING web steps (see {@link GuardVisualJudge}). This
   * package calls no model; core injects one built from the installed transport.
   * Omitted ⇒ zero behavior change, which is what every test and birth validation
   * relies on. A green run never invokes it, so it costs nothing when nothing broke.
   */
  visualJudge?: GuardVisualJudge
}

export type RunGuardResult =
  | { status: 'no-recipe' }
  | { status: 'invalid-recipe'; message: string }
  | {
      /**
       * The recipe declares an api credential sourced from a host env var that is
       * not set at run time — a hard stop (an api scenario would otherwise run
       * un-authenticated), never a silent skip.
       */
      status: 'missing-credential-env'
      message: string
    }
  | {
      /**
       * EVERY runnable scenario of this run drives a declared external API account
       * that is only PARTLY configured on this machine — a base URL with no key, or
       * a key whose `valueFromEnv` var is unset. Those scenarios were authored
       * against a LIVE service, so running them against a half-described world would
       * blame the app for an infrastructure gap.
       *
       * SCOPED, not run-wide: when only SOME scenarios drive the half-configured
       * service they settle as `error`s naming the gap and their siblings run, so this
       * status means "there is nothing else left to run" — the case where the
       * configuration gap genuinely IS the whole story. A service that is simply NOT
       * provided (nothing configured) is never this — its flows stay blocked, as before.
       */
      status: 'missing-external-env'
      message: string
    }
  | {
      /**
       * The recipe's `api.seed` command failed — a non-zero exit, an unparseable /
       * missing manifest, or a manifest that omits a declared credential/fixture. A
       * hard stop before any server boots (the whole run needs the seeded world),
       * never a silent skip.
       */
      status: 'seed-failed'
      message: string
    }
  | {
      /**
       * A `fromRequest` credential's login call failed — the request could not be
       * sent, timed out, or answered without the declared capture path/header. Runs
       * once the run-level preflight server is healthy and before any scenario; a
       * hard stop, because every scenario referencing that credential would
       * otherwise run un-authenticated and blame the app for a 401.
       */
      status: 'credential-request-failed'
      message: string
    }
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
      /**
       * THIS RUN's own record — exactly the scenarios it executed, which is what the
       * run snapshot, the history row and every "what did this run do" surface show.
       * A scoped run's `latest` therefore holds one scenario, not the whole board.
       */
      latest: GuardLatest
      /**
       * The materialized current-state view this run wrote to `LATEST.json`: `latest`
       * merged into the recorded board (see {@link mergeGuardBoard}). Equal to
       * `latest` for a full run over a fresh store; absent when `persist` is false,
       * where nothing was written and there is no board to speak of.
       */
      board?: GuardLatest
      latestPath: string
      loadErrors: ScenarioLoadError[]
      /** The binding record if `scenarios/manifest.json` exists (informational). */
      manifest: GuardManifest | null
      /**
       * Per-run step aggregate (C4) — executed vs no-op/inert step invocations,
       * per driver. NOT persisted to `LATEST.json` (whose schema is frozen);
       * lives on the in-memory result so a real run and birth validation compute
       * it identically. Optional so an executor that REPLAYS a stored run (the
       * hosted gate's `storedRunReport`) can honestly report none.
       */
      stepStats?: GuardRunStepStats
      /**
       * The no-op anomaly the runner detected over `stepStats`, or null. A real
       * `guard run` surfaces it without aborting; `guard generate` folds the
       * stats across its birth rounds and ABORTS as `recipe-failed` on its own
       * detection (see the generator). Optional exactly like `stepStats`.
       */
      anomaly?: GuardNoOpAnomaly | null
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
    case 'missing-credential-env':
      return result.message
    case 'missing-external-env':
      return result.message
    case 'seed-failed':
      return result.message
    case 'credential-request-failed':
      return result.message
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
        kind: result.preflight.kind === 'silent' ? 'silent' : 'crash',
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
  | {
      loaded: LoadedRecipe
      selected: GuardScenario[]
      /** Every committed scenario id, before the `--scenario` restriction — what the
       *  merged board keeps rows for (see {@link RunGuardOptions.corpusIds}). */
      corpusIds: string[]
      loadErrors: ScenarioLoadError[]
    }

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
  return {
    loaded: recipe.loaded,
    selected: sel.selected,
    corpusIds: scenarios.map((s) => s.id),
    loadErrors,
  }
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
  // What the merged board keeps rows for: the caller's corpus when it filtered before
  // calling, else the set handed to this run (which its own `scenarioId` narrowed).
  const corpusIds = new Set(opts.corpusIds ?? scenarios.map((s) => s.id))

  // Check EVERY binding against the live section index before running anything: a
  // scenario realizes a flow, so it binds one section per milestone. A section that
  // was edited (stale) or removed (orphaned) blocks execution; a section that moved
  // with its text intact remaps and still runs. See {@link resolveScenarioBinds} for
  // the fold from per-bind resolutions to the one scenario verdict.
  const docIndexes = indexRepoDocs(repoRoot, new Set(selected.flatMap((s) => s.binds.map((b) => b.doc))))
  const indexFor = (doc: string): DocSectionIndex | null => docIndexes.indexes.get(doc) ?? null
  const planned = selected.map((scenario) => ({
    scenario,
    verdict: resolveScenarioBinds(scenario.binds, indexFor),
  }))
  const executable = planned.filter((p) => p.verdict.kind === 'executable')
  const nonExecutable = planned.filter((p) => p.verdict.kind !== 'executable')

  // The interface grounding check — a per-scenario ANNOTATION, computed once against
  // the mapping snapshot (absent snapshot ⇒ no annotation anywhere). It never gates
  // execution: a scenario whose surface moved still runs its frozen steps.
  //
  // The baseline is the MERGED catalog, both halves of it: `isInterfaceDrifted`
  // reads an id it cannot find as drift, and the mapper derives `cli`/`api` only —
  // so every hand-authored surface lives in the committed
  // `guard/interfaces.authored.json`. Reading the derived half alone would stamp
  // every web-grounded scenario as drifted on every run, with nothing having moved.
  const interfaceCatalog = readMergedInterfaceCatalog(repoRoot)
  const drifted = new Set(
    selected.filter((s) => isInterfaceDrifted(s, interfaceCatalog)).map((s) => s.id),
  )
  const annotate = (scenario: GuardScenario): { interfaceDrifted?: true } =>
    drifted.has(scenario.id) ? { interfaceDrifted: true } : {}

  // WHICH EXECUTOR, read off the steps ({@link isApiServerScenario}): a scenario
  // whose every step is an api verb runs against the recipe's booted server;
  // anything else runs in a sandbox. Preparation follows from that — the api path
  // needs the `api` block, the sandbox path needs whatever its own steps ask for.
  // A scenario whose preparation is missing settles as an `error` naming the gap
  // (never a silent skip) and never blocks the other path's scenarios from running.
  const sandboxExec = executable.filter((p) => !isApiServerScenario(p.scenario))
  const apiExec = executable.filter(
    (p): p is (typeof executable)[number] & { scenario: GuardApiScenario } =>
      isApiServerScenario(p.scenario),
  )
  // The web surface is per RECIPE, not per scenario: it boots inside whichever
  // sandbox reaches a step that needs it. What the run needs to know up front is only
  // whether ANY selected scenario has one, so the surface's build can be skipped
  // otherwise. A `request` step counts as much as a web step — it is sent to that
  // same served surface, so a request-only scenario needs it built too.
  const webSurface = resolveWebSurface(loaded.recipe)
  /** Does this scenario reach the served web surface? (Teardown steps count.) */
  const usesServedSurface = (s: GuardScenario): boolean =>
    guardExecutionSteps(s).some((step) => isWebStep(step) || isApiRequestStep(step))
  const servedExec = sandboxExec.filter((p) => usesServedSurface(p.scenario))
  // What a sandbox scenario NEEDS decides its preparation: only a `run:` step
  // invokes the entry, so a scenario with none — a browser-only journey on a
  // web-only product (cal.com has no CLI) — must not be gated on `entry`. Its
  // preparation is the served web surface, and a missing one settles the same
  // honest unprepared error a missing `entry` always has.
  const entryExec = sandboxExec.filter((p) =>
    guardExecutionSteps(p.scenario).some((step) => isRunStep(step as GuardCliStep)),
  )
  /**
   * Does this scenario need the run's PREPARED WORLD — the one-shot `api.services.up`
   * and the `api.seed` that fills it? The same question the per-driver gate above
   * asks, asked of the world the whole run SHARES rather than of one surface:
   *
   *  - an api-server scenario runs against the recipe's booted server, which is that
   *    world by definition;
   *  - a sandbox scenario that reaches the SERVED surface is driving the product —
   *    the app the datastore stands behind, whose rows the seed wrote;
   *  - a scenario whose steps read `{{fixture:…}}` is quoting the seed's own output,
   *    which is a need for the seed however the step then uses it.
   *
   * Anything else — pure git/write/`run:` sandbox work — needs none of it, and that
   * is the economy this predicate exists to protect: a cli-only selection must not
   * start docker (item 98).
   */
  const needsPreparedWorld = (s: GuardScenario): boolean =>
    isApiServerScenario(s) ||
    usesServedSurface(s) ||
    containsFixtureReference(JSON.stringify(guardExecutionSteps(s)))
  const hasEntry = loaded.recipe.entry !== undefined
  const api = loaded.recipe.api
  // Both recipe shapes collapse into ONE named-server map here, and every
  // api scenario BINDS to one of its entries (`scenario.server`, defaulting to the
  // recipe's `defaultServer`). A scenario naming a server the recipe no longer
  // declares is a per-scenario `error` with the resolver's reason — the same
  // honest gap a missing driver preparation settles as, never a run-wide stop.
  const resolvedServers = resolveApiServers(loaded.recipe)
  const boundServerById = new Map<string, ResolvedApiServer>()
  const unboundApi: { scenario: GuardScenario; verdict: ScenarioBindingVerdict; missing: string }[] = []
  if (api) {
    for (const p of apiExec) {
      const bound = resolveScenarioServer(p.scenario, resolvedServers)
      if (bound.ok) boundServerById.set(p.scenario.id, bound.server)
      else unboundApi.push({ ...p, missing: bound.reason })
    }
  }
  const apiRunnableExec = api ? apiExec.filter((p) => boundServerById.has(p.scenario.id)) : []
  const sandboxUnprepared: { scenario: GuardScenario; verdict: ScenarioBindingVerdict; missing: string }[] = []
  const sandboxPrepared: typeof sandboxExec = []
  for (const p of sandboxExec) {
    if (!hasEntry && entryExec.includes(p)) {
      sandboxUnprepared.push({ ...p, missing: 'recipe.json has no `entry` — the cli driver has no preparation' })
    } else if (webSurface === undefined && servedExec.includes(p)) {
      sandboxUnprepared.push({
        ...p,
        missing: 'recipe.json has no `web` block — the scenario’s browser/request steps have no served surface',
      })
    } else {
      sandboxPrepared.push(p)
    }
  }
  const prepared = [...sandboxPrepared, ...apiRunnableExec]
  const unprepared = [
    ...sandboxUnprepared,
    ...(api
      ? unboundApi
      : apiExec.map((p) => ({ ...p, missing: 'recipe.json has no `api` block — the api driver has no preparation' }))),
  ]

  // THE DEPENDENCY GATE. A scenario that binds a SUPPLIED dependency with no
  // registered instance does not execute: it settles `blocked` naming the
  // dependency and its rolled-up requirement. Deliberately BEFORE the build and
  // before any sandbox — nothing is spawned, nothing is fetched, and a
  // `${supplied:…}` token can never land in an argv or a seeded file, because the
  // only path that interpolates one runs on the other side of this filter.
  //
  // Never a `fail`: the code is not in dispute here and the spec is not
  // contradicted; what is missing is a real-world input the engine must not
  // fabricate (§7.2). Registering an instance is the one action that clears it.
  let resolvedDependencies: ResolvedDependencies
  try {
    resolvedDependencies = resolveDependencies(repoRoot, {
      // A dismissed flow's contributed need drops out of the requirement a reader
      // is shown — its expectation died with the flow.
      dismissedFlows: new Set(readGuardDecisions(repoRoot).dismissedFlows.map((f) => f.flowId)),
    })
  } catch (e) {
    if (e instanceof DependencyCatalogError) return { status: 'invalid-recipe', message: e.message }
    throw e
  }
  const dependencyBlocked: {
    scenario: GuardScenario
    verdict: ScenarioBindingVerdict
    block: DependencyBlock
  }[] = []
  const runnable = prepared.filter((p) => {
    const block = dependencyBlockFor(p.scenario, resolvedDependencies)
    if (!block) return true
    dependencyBlocked.push({ ...p, block })
    return false
  })

  /**
   * THE PREPARED-WORLD GATE (item 98). Services and the seed are the RUN's shared
   * world, so what decides whether to prepare it is whether anything this selection
   * will actually RUN needs it — not the size of the api pool. Gating on the pool is
   * what made `guard run --scenario <a web one>` start no services and seed nothing,
   * leaving every `{{fixture:…}}` in it settling as "the seed did not run for this
   * selection". The api pool keeps its own disjunct so an api selection's preparation
   * is byte-identical to what it always was, dependency-blocked scenarios included.
   */
  const worldNeeded = apiRunnableExec.length > 0 || runnable.some((p) => needsPreparedWorld(p.scenario))

  // B5: build the OpenAPI operation-schema index ONCE for the docs bound by api
  // scenarios that assert `schema: true`. Built only when at least one such scenario
  // exists, so a repo not using response-conformance reads no extra files (the flow
  // stays byte-identical). Empty otherwise; `resolveScenarioResponseSchemas` then
  // returns undefined and any stray `schema: true` step errors.
  const schemaBoundDocs = new Set(
    apiExec
      .filter((p) => p.scenario.steps.some((s) => isApiRequestStep(s) && s.expect.schema === true))
      .flatMap((p) => p.scenario.binds.map((b) => b.doc)),
  )
  const operationSchemaIndex = schemaBoundDocs.size > 0 ? buildOperationSchemaIndex(repoRoot, schemaBoundDocs) : new Map()

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

      // The WEB surface's own build, and ONLY when this run has steps that reach it.
      // Compiling a client is minutes on a real app; a cli-only run must not pay
      // for it, which is the whole reason the web block carries its own command.
      // It builds with the SURFACE's env (`recipe.env` ⊕ `web.env`) — the same env
      // the serve process gets, so a variable the client is compiled against
      // (`VITE_*`) reaches the build too.
      if (webSurface?.build && servedExec.length > 0) {
        const webBuild = await runBuild(
          repoRoot,
          webSurface.build,
          webSurface.env,
          opts.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
          cancel.signal,
        )
        const stopWeb = cancelled('build')
        if (stopWeb) return stopWeb
        if (!webBuild.ok) return { status: 'build-failed', build: webBuild, loadErrors }
      }
    }

    const resolvedEntry = hasEntry ? resolveEntry(repoRoot, loaded.recipe.entry!) : null

    // Pre-flight the built entry ONCE before any cli scenario touches it: if it
    // can't even start, that is ONE loud entry-level error, not N indistinguishable
    // scenario failures. Runs under the build phase (before the run counter is announced).
    // Probe only when a selected scenario will actually invoke the entry — a
    // web-only selection must not boot a binary no step runs.
    if (buildsOwnEntry && resolvedEntry && entryExec.length > 0) {
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
    //
    // The SHARED half (services + seed) is prepared whenever this selection needs
    // the world (`worldNeeded`); the api SERVER half — credentials, `fromRequest`
    // logins, the per-server boot preflight — belongs to the api pool alone and is
    // gated on `apiPool` below. A web-only selection therefore gets the seeded
    // datastore its app reads and boots no api server for scenarios it will not run.
    const apiPool = apiRunnableExec.length > 0
    /** Per bound server: its absolutized serve argv and its boot env. */
    const serverBoot = new Map<string, { resolvedServe: string[]; env: Record<string, string> }>()
    let apiCredentials: Map<string, string> | undefined
    let apiFixtures: Map<string, Record<string, unknown>> | undefined
    let externalSecrets: Map<string, string> | undefined
    let externalTargets: ReturnType<typeof externalProxyTargets> = []
    /**
     * Runnable api scenarios whose `setup.externals` drives a HALF-configured service
     * — the only scenarios a partly-configured account is about. They settle as
     * per-scenario errors below (see the population site for why) and never dispatch.
     */
    const externalBlocked: {
      scenario: GuardScenario
      verdict: ScenarioBindingVerdict
      external: ResolvedExternal
    }[] = []
    const externalBlockedIds = new Set<string>()
    if (api && worldNeeded) {
      // User-provided external API accounts. A PROVIDED external puts its
      // base URL + its extra env into the SERVER env, ABOVE `api.env` (the account
      // the user supplied beats the recipe's default pointer) and BELOW a scenario's
      // own `setup.env` (which is layered later in `createSandbox` — so a scenario
      // that stubs the service with `${HTTP_STUB:…}` still wins for that scenario).
      // A partly-configured external refuses the scenarios that DRIVE it (below); an
      // unprovided one injects nothing and its flows stay blocked exactly as before.
      let resolvedExternals
      try {
        resolvedExternals = loadResolvedExternals(repoRoot, api.externals, process.env)
      } catch (e) {
        if (e instanceof ExternalsError) return { status: 'invalid-recipe', message: e.message }
        throw e
      }
      // The half-configured-external refusal, SCOPED to the scenarios it is actually
      // about. An `incomplete` service contributes no `inject` and no `secrets`, so
      // booting the app with one declared is byte-identical to booting it with an
      // `unprovided` one — a repo full of unconfigured services is guard's ordinary
      // state. What the refusal protects against is a scenario that BELIEVES it is
      // driving the live account, and a scenario says so in exactly one place:
      // `setup.externals`.
      // So the scenarios naming it settle as errors carrying the configuration gap,
      // every other scenario births and runs normally, and the RUN is refused only
      // when there is nothing else left to run. Refusing run-wide is what turned one
      // half-configured service on the cal.diy bench (`hit-pay` — 1 of 18 declared, no
      // account, never mentioned by the user) into zero tests across all 93 flows.
      for (const p of apiRunnableExec) {
        const blocking = boundIncompleteExternals(
          Object.keys(p.scenario.setup?.externals ?? {}),
          resolvedExternals,
        )
        if (blocking.length === 0) continue
        externalBlocked.push({ ...p, external: blocking[0] })
        externalBlockedIds.add(p.scenario.id)
      }
      if (externalBlocked.length > 0 && externalBlocked.length === runnable.length) {
        return {
          status: 'missing-external-env',
          message: incompleteExternalMessage(externalBlocked[0].external),
        }
      }
      externalSecrets = externalsSecrets(resolvedExternals)
      // Every provided external is reached through a per-SCENARIO loopback
      // proxy, so any scenario can script a fault on it. The run-level env below
      // still carries the REAL origins — the seed and the boot preflight talk to the
      // account directly; only scenarios are proxied.
      externalTargets = externalProxyTargets(resolvedExternals)
      // Every server this run needs: the ones its runnable scenarios bound to, plus
      // the ones a `fromRequest` login must be minted against (a credential is needed
      // even when no scenario runs on the server that issues it). Each carries its own
      // env layer (`recipe.env` ⊕ `api.env` ⊕ the server's `env`) with the externals
      // injection ON TOP — the user-supplied account beats the recipe's pointer.
      const externalsEnv = externalsInjectEnv(resolvedExternals)
      const loginsByServer = new Map<string, Record<string, RecipeApiCredential>>()
      // A `fromRequest` login is minted against a LIVE server, and only an api
      // scenario can ever read the value. With no api pool the mint would boot a
      // server for nobody, so a world-only preparation declares no logins — and
      // `serversNeeded` below is then empty, which is what keeps it from booting one.
      if (apiPool) {
        for (const [name, cred] of Object.entries(api.credentials ?? {})) {
          if (!cred.fromRequest) continue
          const server = cred.fromRequest.server ?? resolvedServers.defaultServer
          const group = loginsByServer.get(server) ?? {}
          group[name] = cred
          loginsByServer.set(server, group)
        }
      }
      const serversNeeded = new Set<string>([
        // A scenario refused above never dispatches, so its server is not needed —
        // booting (and preflighting) one for it alone would resurrect the run-wide
        // failure the scoping just removed, as an `entry-preflight-failed` instead.
        ...apiRunnableExec
          .filter((p) => !externalBlockedIds.has(p.scenario.id))
          .map((p) => boundServerById.get(p.scenario.id)!.name),
        ...loginsByServer.keys(),
      ])
      for (const name of serversNeeded) {
        const server = resolvedServers.servers.get(name)
        if (!server) continue // a login naming an undeclared server is a schema error
        serverBoot.set(name, {
          resolvedServe: resolveEntry(repoRoot, server.serve),
          env: { ...server.env, ...externalsEnv },
        })
      }
      // The run-level, SHARED world (services, seed) is prepared with the DEFAULT
      // server's env — the same value a single-server recipe always had.
      const sharedEnv =
        serverBoot.get(resolvedServers.defaultServer)?.env ??
        { ...(resolvedServers.servers.get(resolvedServers.defaultServer)?.env ?? {}), ...externalsEnv }
      // Resolve declared credentials from the host env BEFORE booting — a missing
      // env var is a loud stop, and the secret values never touch the recipe env.
      // Only the api pool can READ a credential (a sandbox scenario binds no server,
      // and `{{cred:…}}` is deliberately not active there — item 99), so a world-only
      // preparation resolves none: refusing a web-only run over an api key nothing in
      // it can use would be the same false gate item 98 removes. The seed still folds
      // whatever it PUBLISHES into this map.
      if (apiPool) {
        try {
          const resolved = resolveApiCredentials(api.credentials, process.env)
          apiCredentials = new Map([...resolved].map(([name, cred]) => [name, cred.value]))
        } catch (e) {
          if (e instanceof CredentialResolutionError) return { status: 'missing-credential-env', message: e.message }
          throw e
        }
      } else {
        apiCredentials = new Map()
      }
      // The prepared world (services + seed) — either THIS run's own, or the
      // run-level SHARED one (`opts.sharedWorld`): generate threads a single
      // world across every sandbox/birth execution so their up/down lifecycles
      // cannot race each other on the recipe's singleton compose project (see
      // shared-world.ts — the documenso 13-worker P1017 incident). A plain
      // `guard run` passes no handle and prepares + tears down its own, as
      // before. The boot/teardown THUNKS live here so the shared path runs
      // byte-identical logic to the owned path.
      type WorldBoot =
        | { ok: true; credentials: [string, string][]; fixtures: Map<string, Record<string, unknown>> | undefined }
        | { ok: false; stop: RunGuardResult }
      const bootWorld = async (): Promise<WorldBoot> => {
        if (api.services) {
          const up = await runBuild(
            repoRoot,
            api.services.up,
            loaded.recipe.env,
            opts.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
            cancel.signal,
          )
          const stop = cancelled('build')
          if (stop) return { ok: false, stop }
          if (!up.ok) return { ok: false, stop: { status: 'build-failed', build: up, loadErrors } }
        }
        // Seed AFTER services.up (its datastore/migrations are ready) and BEFORE
        // the server boots — once per prepared world. Seeded credentials merge
        // into the resolved map (and are redacted like any secret); seeded
        // fixtures feed `{{fixture:…}}`.
        const credentials: [string, string][] = []
        let fixtures: Map<string, Record<string, unknown>> | undefined
        if (api.seed) {
          try {
            const seeded = await runSeed({
              repoRoot,
              seed: api.seed,
              // The seed prepares state for the SERVER, so it runs with the server's env
              // (recipe.env merged with api.env) — a datastore URL in `api.env` must reach it.
              env: sharedEnv,
              // Fold the already-resolved Phase-1 credential values into the failure
              // redactor so a secret the seed echoes before failing is masked in seed-failed.
              knownCredentials: apiCredentials,
              externalSecrets,
              timeoutMs: opts.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
              signal: cancel.signal,
            })
            for (const [name, cred] of seeded.credentials) credentials.push([name, cred.value])
            fixtures = seeded.fixtures
          } catch (e) {
            const stop = cancelled('build')
            if (stop) return { ok: false, stop }
            if (e instanceof SeedError) return { ok: false, stop: { status: 'seed-failed', message: e.message } }
            throw e
          }
        }
        return { ok: true, credentials, fixtures }
      }
      const downWorld = async (): Promise<void> => {
        if (api.services?.down) {
          await runBuild(repoRoot, api.services.down, loaded.recipe.env, DEFAULT_BUILD_TIMEOUT_MS)
        }
      }
      const world = opts.sharedWorld
        ? await opts.sharedWorld.ensure(bootWorld, downWorld, (v) => !v.ok)
        : await bootWorld()
      if (!world.ok) return world.stop
      // Own-world runs tear down in the finally below; a shared world is torn
      // down exactly once by its owner's `shutdown()`, never per execution.
      if (!opts.sharedWorld && api.services) servicesUp = true
      for (const [name, value] of world.credentials) apiCredentials.set(name, value)
      if (world.fixtures !== undefined) apiFixtures = world.fixtures
      // `fromRequest` credentials mint their value against a LIVE app, so the login
      // rides the preflight boot itself (`onReady`) rather than paying for a second
      // one — and lands after the seed, so a seeded account can be the one it logs
      // in as. The minted values merge into the same map static and seeded
      // credentials share, so redaction and `{{cred:…}}` need no new plumbing.
      // ONE preflight per needed server, sequentially, in name order — the api analog
      // of the entry preflight, once per service instead of once per repo. The first
      // server that will not start ends the run with the SAME loud status a
      // single-server recipe gets, labelled so a reader knows which one died.
      let credentialRequestError: CredentialRequestError | null = null
      const labelServers = resolvedServers.servers.size > 1
      for (const name of [...serversNeeded].sort()) {
        const server = resolvedServers.servers.get(name)
        const boot = serverBoot.get(name)
        if (!server || !boot) continue
        const logins = loginsByServer.get(name)
        const apiPreflight = await preflightApiServer({
          resolvedServe: boot.resolvedServe,
          displayServe: server.serve,
          ...(server.cwd === 'repo' ? { cwd: repoRoot } : {}),
          recipeEnv: boot.env,
          healthPath: server.healthPath,
          readyTimeoutMs: server.readyTimeoutMs,
          ...(labelServers ? { label: name } : {}),
          signal: cancel.signal,
          ...(logins
            ? {
                onReady: async (baseUrl: string) => {
                  try {
                    const minted = await runCredentialRequests({
                      baseUrl,
                      credentials: logins,
                      timeoutMs: opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
                      signal: cancel.signal,
                    })
                    for (const [credName, cred] of minted) apiCredentials!.set(credName, cred.value)
                  } catch (e) {
                    // Recorded, not rethrown: the preflight's own contract is the boot,
                    // and a throw here would surface as a crash rather than a status.
                    if (e instanceof CredentialRequestError) credentialRequestError = e
                    else throw e
                  }
                },
              }
            : {}),
        })
        const stop = cancelled('build')
        if (stop) return stop
        if (credentialRequestError) {
          return { status: 'credential-request-failed', message: (credentialRequestError as CredentialRequestError).message }
        }
        if (!apiPreflight.ok) {
          return { status: 'entry-preflight-failed', preflight: apiPreflight, buildCommand: loaded.recipe.build, loadErrors }
        }
      }
    }

    opts.onPhase?.('run', selected.length)

    const runId = buildRunId()
    // One nonce per run seeds each scenario's stable `${unique}` token (distinct per
    // scenario id, distinct across runs) — see `scenarioUnique`.
    const runNonce = newRunNonce()
    const ranAt = new Date().toISOString()
    const stepTimeoutMs = opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
    const concurrency = opts.concurrency ?? defaultRunConcurrency()

    const results: GuardScenarioResult[] = []

    // Per-run step aggregate (C4), fed synchronously by each scenario's `onStep`.
    // A cli step that exited 0, wrote nothing, and returned instantly — or an api
    // request answered with an empty body — is the raw material of the no-op
    // anomaly the run reports (and the generator aborts on).
    const stepStats = createStepStatsCollector(opts.noOpThresholdMs)

    // Stale/orphaned scenarios settle immediately — they never touch a sandbox.
    for (const { scenario, verdict } of nonExecutable) {
      const result = { ...nonExecutableResult(scenario, verdict), ...annotate(scenario) }
      results.push(result)
      settled += 1
      opts.onScenarioSettled?.(settled, selected.length, result)
    }

    // Scenarios whose surface has no preparation in the recipe settle as errors —
    // an honest per-scenario gap, never a silent skip, never a run-wide failure.
    for (const { scenario, verdict, missing } of unprepared) {
      const result: GuardScenarioResult = {
        id: scenario.id,
        title: scenario.title,
        binds: scenario.binds[0],
        ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
        outcome: 'error',
        durationMs: 0,
        failure: {
          step: 1,
          // The driver named is the scenario's PRIMARY one (registry order), which
          // is the surface whose preparation the recipe is missing.
          expected: `the recipe to prepare the ${guardScenarioDrivers(scenario)[0]} driver`,
          actual: missing,
        },
        ...(verdict.kind === 'executable' && verdict.remappedTo ? { remappedTo: verdict.remappedTo } : {}),
        ...annotate(scenario),
      }
      results.push(result)
      settled += 1
      opts.onScenarioSettled?.(settled, selected.length, result)
    }

    // Scenarios held back by the dependency gate settle as `blocked` — a
    // non-executed outcome like stale/orphaned, not a verdict about the repo. The
    // `failure` carries the same sentence for every surface that already renders a
    // reason, and `blockedOn` carries the structured half (which dependency, whose
    // flows asked for what, where an instance is registered).
    for (const { scenario, verdict, block } of dependencyBlocked) {
      const result: GuardScenarioResult = {
        id: scenario.id,
        title: scenario.title,
        binds: scenario.binds[0],
        ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
        outcome: 'blocked',
        durationMs: 0,
        failure: {
          step: 1,
          expected: `a registered instance of the supplied dependency "${block.dependency}"`,
          actual: `${block.detail} — it must be ${block.requirement}`,
        },
        blockedOn: {
          dependency: block.dependency,
          requirement: block.requirement,
          needs: block.needs,
          registerIn: block.registerIn,
        },
        ...(verdict.kind === 'executable' && verdict.remappedTo ? { remappedTo: verdict.remappedTo } : {}),
        ...annotate(scenario),
      }
      results.push(result)
      settled += 1
      opts.onScenarioSettled?.(settled, selected.length, result)
    }

    // Scenarios that drive a half-configured external settle the same honest way: the
    // gap is real for THEM, so they are errors naming it — the neighbouring precedent
    // is `startExternalProxies`, where a `setup.externals` entry for a service that is
    // not provided is already a scenario error rather than a run-wide stop. The
    // `expected` is deliberately NOT one of the setup-defect sentinels: this is
    // infrastructure the model cannot author its way out of, so birth validation must
    // not spend its evidence-retry on it (see `isSetupDefectResult`).
    for (const { scenario, verdict, external } of externalBlocked) {
      const result: GuardScenarioResult = {
        id: scenario.id,
        title: scenario.title,
        binds: scenario.binds[0],
        ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
        outcome: 'error',
        durationMs: 0,
        failure: {
          step: 1,
          expected: `external service "${external.service}" to be configured`,
          actual: incompleteExternalMessage(external),
        },
        ...(verdict.kind === 'executable' && verdict.remappedTo ? { remappedTo: verdict.remappedTo } : {}),
        ...annotate(scenario),
      }
      results.push(result)
      settled += 1
      opts.onScenarioSettled?.(settled, selected.length, result)
    }

    // Pass evidence is part of the persisted run baseline; a non-persisted (birth
    // validation) run captures none for its passing candidates — the next real run does.
    const capturePassEvidence = opts.persist !== false

    // A credential authenticates against its declared `servers` (all of them when it
    // declares none). A scenario therefore sees only the credentials its
    // BOUND server accepts; the rest ride `foreignCredentials`, which turns a
    // cross-server `{{cred:…}}` reference into an actionable error instead of a 401
    // the app gets blamed for. Computed once per server, on first use.
    /** The bound server of an api scenario, in the shape the driver boots from. */
    const boundServer = (scenarioId: string): RunApiScenarioContext['server'] => {
      const server = boundServerById.get(scenarioId)!
      return {
        name: server.name,
        resolvedServe: serverBoot.get(server.name)!.resolvedServe,
        cwd: server.cwd,
        healthPath: server.healthPath,
        readyTimeoutMs: server.readyTimeoutMs,
        ...(server.app ? { app: server.app } : {}),
      }
    }

    // The run-time route-triage input: which workspace app serves a path. The
    // manifest is a directory walk, so it is built LAZILY and ONCE — a fully green
    // run never asks, and therefore never pays. Only a POSITIVE attribution to
    // another app answers `no`; an app that proxies (`opaque`), one whose routes
    // could not be read, a server with no `app`, and a path nobody claims all answer
    // `unknown`, which leaves the ordinary `fail` exactly as it was (R6).
    let routeManifestMemo: RouteManifest | null = null
    const servesPathFor =
      (server: ResolvedApiServer) =>
      (requestPath: string): ServesPathVerdict => {
        if (!server.app) return { verdict: 'unknown' }
        routeManifestMemo ??= buildRouteManifest(repoRoot)
        const own = routeManifestMemo.apps.find((a) => a.dir === server.app)
        if (!own || own.opaque || own.routes.length === 0) return { verdict: 'unknown' }
        if (whichAppServes({ apps: [own] }, requestPath)) return { verdict: 'yes' }
        const other = whichAppServes(routeManifestMemo, requestPath)
        if (!other || other.app.opaque || other.app.routes.length === 0) return { verdict: 'unknown' }
        return { verdict: 'no', servedBy: other.app.dir }
      }

    const credentialAllowlist = new Map<string, string[]>()
    for (const [name, cred] of Object.entries(api?.credentials ?? {})) {
      credentialAllowlist.set(name, credentialServers(cred, resolvedServers))
    }
    for (const [name, cred] of Object.entries(api?.seed?.provides.credentials ?? {})) {
      credentialAllowlist.set(name, credentialServers(cred, resolvedServers))
    }
    const credentialViewCache = new Map<
      string,
      { credentials: Map<string, string>; foreign: Map<string, readonly string[]> }
    >()
    const credentialsFor = (serverName: string) => {
      const cached = credentialViewCache.get(serverName)
      if (cached) return cached
      const credentials = new Map<string, string>()
      const foreign = new Map<string, readonly string[]>()
      for (const [name, value] of apiCredentials ?? []) {
        const allowed = credentialAllowlist.get(name)
        if (!allowed || allowed.includes(serverName)) credentials.set(name, value)
        else foreign.set(name, allowed)
      }
      const view = { credentials, foreign }
      credentialViewCache.set(serverName, view)
      return view
    }

    const runOne = async ({ scenario, verdict }: (typeof runnable)[number]): Promise<GuardScenarioResult | null> => {
      // Once cancelled, no new child spawns; a post-cancel settlement doesn't count
      // either — a run ending `aborted`/`run-timed-out` discards these results.
      if (cancel.signal.aborted) return null
      // WHICH EXECUTOR — the same steps-derived question the preparation split
      // asked, asked once more where the scenario is actually dispatched.
      const outcome =
        isApiServerScenario(scenario)
          ? await runApiScenario(scenario, {
              repoRoot,
              runId,
              unique: scenarioUnique(runNonce, scenario.id),
              server: boundServer(scenario.id),
              recipeEnv: serverBoot.get(boundServerById.get(scenario.id)!.name)!.env,
              credentials: credentialsFor(boundServerById.get(scenario.id)!.name).credentials,
              foreignCredentials: credentialsFor(boundServerById.get(scenario.id)!.name).foreign,
              servesPath: servesPathFor(boundServerById.get(scenario.id)!),
              externalSecrets,
              externalTargets,
              fixtures: apiFixtures,
              responseSchemas: resolveScenarioResponseSchemas(
                operationSchemaIndex,
                scenario as GuardApiScenario,
                verdict.resolutions,
              ),
              stepTimeoutMs,
              capturePassEvidence,
              signal: cancel.signal,
              onStep: (o) => stepStats.onApiStep(o),
            })
          : await runScenario(scenario, {
              repoRoot,
              runId,
              unique: scenarioUnique(runNonce, scenario.id),
              resolvedEntry: resolvedEntry!,
              recipeEnv: loaded.recipe.env,
              ...(loaded.recipe.expose ? { expose: loaded.recipe.expose } : {}),
              // Every binding is `provided` by construction — the gate above kept the
              // rest out of `runnable` — so this only ever materializes real instances.
              supplied: suppliedInstancesFor(scenario, resolvedDependencies),
              // The seed's fixtures reach a SANDBOX scenario too (the api call site
              // above passes the same map): the canonical document a seeded world
              // published is the one a web step uploads and an api step posts, and
              // one world has one copy of it. Undefined when the seed did not run —
              // which the scenario reports as such, `seedDeclared` telling it apart
              // from a fixture that simply does not exist.
              ...(apiFixtures ? { fixtures: apiFixtures } : {}),
              ...(api?.seed ? { seedDeclared: true } : {}),
              ...(webSurface ? { web: webSurface } : {}),
              stepTimeoutMs,
              capturePassEvidence,
              signal: cancel.signal,
              onStep: (o) => stepStats.onCliStep(o),
              // Only the cli/web pool: an api scenario has no screen to look at.
              ...(opts.visualJudge ? { visualJudge: opts.visualJudge } : {}),
            })
      if (cancel.signal.aborted) return null
      const result: GuardScenarioResult = {
        ...outcome,
        ...(verdict.kind === 'executable' && verdict.remappedTo ? { remappedTo: verdict.remappedTo } : {}),
        ...annotate(scenario),
      }
      settled += 1
      opts.onScenarioSettled?.(settled, selected.length, result)
      return result
    }

    // THREE POOLS, run concurrently — split by what a scenario keeps RESIDENT. An
    // api-server scenario boots a whole target server that lives for the scenario's
    // duration, and a sandbox scenario with web/request steps boots its own served
    // surface PLUS a browser — both are heavyweight, so each heavy pool caps
    // parallel scenarios at `apiBootConcurrency` (which bounds resident servers,
    // not just boot-starts — the diagnosed cal.com starvation). The plain cli pool
    // takes the rest of the budget. `orderReadBeforeWrite` still runs read-only api
    // scenarios ahead of mutating ones WITHIN the api pool (its ordering only ever
    // mattered for the api set — sandboxes are isolated).
    const apiRunnable = orderReadBeforeWrite(
      runnable.filter((x) => isApiServerScenario(x.scenario) && !externalBlockedIds.has(x.scenario.id)),
    )
    const servedIds = new Set(servedExec.map((p) => p.scenario.id))
    const sandboxRunnable = runnable.filter((x) => !isApiServerScenario(x.scenario))
    const servedRunnable = sandboxRunnable.filter((x) => servedIds.has(x.scenario.id))
    const plainRunnable = sandboxRunnable.filter((x) => !servedIds.has(x.scenario.id))
    // The pools share ONE budget so their combined in-flight count never exceeds
    // `concurrency` — the host-load knob whose violation caused the incident. Each
    // present pool keeps a floor of 1 so none can be starved outright; allocation
    // runs heavy-first and the plain pool takes the remainder. A single-path run is
    // unchanged (api-only ≤ apiCap, plain-sandbox-only = full width). See
    // `TRUECOURSE_MAX_API_CONCURRENCY`.
    const heavyCap = apiBootConcurrency(concurrency)
    const laterPools = (...counts: number[]): number => counts.filter((n) => n > 0).length
    let remaining = concurrency
    const apiWidth =
      apiRunnable.length > 0
        ? Math.min(heavyCap, Math.max(1, remaining - laterPools(servedRunnable.length, plainRunnable.length)))
        : 0
    remaining -= apiWidth
    const servedWidth =
      servedRunnable.length > 0
        ? Math.min(heavyCap, Math.max(1, remaining - laterPools(plainRunnable.length)))
        : 0
    remaining -= servedWidth
    const plainWidth = plainRunnable.length > 0 ? Math.max(1, remaining) : 0
    const [apiResults, servedResults, plainResults] = await Promise.all([
      mapWithConcurrency(apiRunnable, apiWidth, runOne),
      mapWithConcurrency(servedRunnable, servedWidth, runOne),
      mapWithConcurrency(plainRunnable, plainWidth, runOne),
    ])
    const executed = [...apiResults, ...servedResults, ...plainResults].filter(
      (r): r is GuardScenarioResult => r !== null,
    )
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
      },
      summary: summarizeResults(results),
      scenarios: results,
      sections: rollupSections(results, new Map(selected.map((s) => [s.id, s.binds]))),
    }

    // Birth validation runs with `persist: false` and must write NOTHING to the
    // store — no LATEST, no run snapshot, no history — so it never moves the baseline.
    let latestPath = ''
    let board: GuardLatest | undefined
    if (opts.persist !== false) {
      // LATEST is the BOARD: this run merged into what was already recorded, so a
      // scoped run updates its own scenarios and leaves every other verdict standing.
      // The run snapshot and the history row stay scoped to what actually ran — they
      // are this run's own record, not a view of current state.
      board = mergeGuardBoard(readGuardLatest(repoRoot), latest, corpusIds)
      latestPath = writeGuardLatest(repoRoot, board)
      writeGuardRun(repoRoot, latest)
      appendGuardHistory(repoRoot, {
        runId: latest.run.runId,
        ranAt: latest.run.ranAt,
        branch: latest.run.branch,
        commit: latest.run.commit,
        summary: latest.summary,
      })
    }
    const finalStepStats = stepStats.snapshot()
    return {
      status: 'ok',
      latest,
      ...(board ? { board } : {}),
      latestPath,
      loadErrors,
      manifest: readManifest(repoRoot),
      stepStats: finalStepStats,
      anomaly: detectNoOpAnomaly(finalStepStats),
    }
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

/**
 * An api scenario is READ-ONLY when every step is a GET or HEAD — it observes state
 * without mutating it. A cli scenario carries no reliable read/write signal, so it is
 * never treated as read-only.
 */
function isReadOnlyScenario(scenario: GuardScenario): boolean {
  if (!isApiServerScenario(scenario)) return false
  // A lifecycle step (boot/signal/logs) restarts or stops the server under test —
  // the least read-only thing a scenario can do, so one is disqualifying.
  return scenario.steps.every(
    (s) => isApiRequestStep(s) && (s.request.method === 'GET' || s.request.method === 'HEAD'),
  )
}

/**
 * Order a runnable set so read-only api scenarios dispatch BEFORE any mutating one —
 * shared-state hygiene: within a single boot (a `guard run` or a batched birth
 * round) reads that ran first can't be polluted by a sibling's writes. The order is a
 * STABLE partition — read-only api scenarios first in their original relative order,
 * everything else (mutating api + all cli, which keep their existing relative order)
 * after — so it is fully deterministic (no randomness). cli scenarios run in isolated
 * sandboxes, so their placement after the api reads is harmless.
 */
export function orderReadBeforeWrite<T extends { scenario: GuardScenario }>(items: T[]): T[] {
  const reads: T[] = []
  const rest: T[] = []
  for (const item of items) (isReadOnlyScenario(item.scenario) ? reads : rest).push(item)
  return [...reads, ...rest]
}

/** Build the result for a scenario the binding check excluded from execution. */
function nonExecutableResult(
  scenario: GuardScenario,
  verdict: ScenarioBindingVerdict,
): GuardScenarioResult {
  const base = {
    id: scenario.id,
    title: scenario.title,
    binds: scenario.binds[0],
    ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
    durationMs: 0,
  }
  if (verdict.kind === 'stale') {
    return {
      ...base,
      outcome: 'stale',
      // Absent when the staleness came from a REMOVED bound section — nothing to hash.
      ...(verdict.currentFingerprint ? { currentFingerprint: verdict.currentFingerprint } : {}),
    }
  }
  return { ...base, outcome: 'orphaned' }
}

/**
 * Per-section rollup over EVERY section each scenario binds — a scenario that
 * realizes a multi-milestone flow paints its outcome onto all of them, not just its
 * primary bind (which is all the result itself carries). `bindsById` supplies the
 * full binding set from the scenarios that were selected for the run.
 */
function rollupSections(
  results: readonly GuardScenarioResult[],
  bindsById: ReadonlyMap<string, readonly GuardBinds[]>,
): GuardSectionRollup[] {
  const byKey = new Map<string, { doc: string; section: string; outcomes: GuardOutcome[]; ids: string[] }>()
  for (const r of results) {
    for (const bind of bindsById.get(r.id) ?? [r.binds]) {
      const key = `${bind.doc}\x00${bind.section}`
      let entry = byKey.get(key)
      if (!entry) {
        entry = { doc: bind.doc, section: bind.section, outcomes: [], ids: [] }
        byKey.set(key, entry)
      }
      entry.outcomes.push(r.outcome)
      entry.ids.push(r.id)
    }
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

/** One bound OpenAPI operation slice, parsed from its canonical section text. */
interface ParsedOperation {
  method: string
  path: string
  operation: unknown
}

/** Parse an operation section's canonical `{ method, path, operation }` text, or null. */
function parseOperationCanonical(fullText: string): ParsedOperation | null {
  let value: unknown
  try {
    value = JSON.parse(fullText)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  if (typeof obj.method !== 'string' || typeof obj.path !== 'string' || obj.operation === undefined) return null
  return { method: obj.method, path: obj.path, operation: obj.operation }
}

/**
 * Build `doc → (anchor → parsed operation)` for the given docs that are OpenAPI
 * documents, reading each once. The anchors match {@link buildDocSectionIndex}'s, so
 * a scenario's resolved binding anchor keys straight into it. Non-OpenAPI docs and
 * unparseable sections are skipped.
 */
function buildOperationSchemaIndex(repoRoot: string, docs: Set<string>): Map<string, Map<string, ParsedOperation>> {
  const out = new Map<string, Map<string, ParsedOperation>>()
  for (const doc of docs) {
    const abs = path.resolve(repoRoot, doc)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
    const content = fs.readFileSync(abs, 'utf-8')
    if (!isOpenApiDoc(doc, content)) continue
    // The canonical section text carries only the bare `paths`-key path; reunite it
    // with the doc's `servers` base path so a bound op's comparable path matches
    // scenario request URLs (which include the base path). '' for base-path-less specs.
    const basePath = openApiServerBasePath(content)
    const byAnchor = new Map<string, ParsedOperation>()
    for (const [anchor, text] of extractSectionTexts(doc, content, nodeRefContext(repoRoot, abs))) {
      const parsed = parseOperationCanonical(text.fullText)
      if (parsed) byAnchor.set(anchor, basePath ? { ...parsed, path: basePath + parsed.path } : parsed)
    }
    out.set(doc, byAnchor)
  }
  return out
}

/**
 * The `responseSchemas` context for one api scenario: the bound operation's identity
 * plus its declared JSON response schema for each status the scenario's `schema: true`
 * steps assert. The operation comes from the FIRST binding that resolves to one — a
 * scenario realizing a flow binds several sections and the OpenAPI operation need not
 * be the primary. Undefined when no binding is an OpenAPI operation — then a
 * `schema: true` step is a scenario error (resolved in `runApiScenario`).
 */
function resolveScenarioResponseSchemas(
  index: Map<string, Map<string, ParsedOperation>>,
  scenario: GuardApiScenario,
  resolutions: readonly BindingResolution[],
): { method: string; path: string; byStatus: ReadonlyMap<number, unknown> } | undefined {
  let op: ParsedOperation | undefined
  for (const [i, bind] of scenario.binds.entries()) {
    const resolution = resolutions[i]
    // The live anchor: a bind that remapped is indexed where its section moved to.
    const anchor = resolution && 'section' in resolution ? resolution.section.anchor : bind.section
    op = index.get(bind.doc)?.get(anchor)
    if (op) break
  }
  if (!op) return undefined
  const byStatus = new Map<number, unknown>()
  for (const step of scenario.steps) {
    if (!isApiRequestStep(step)) continue
    if (step.expect.schema === true && step.expect.status !== undefined) {
      const schema = responseJsonSchema(op.operation, step.expect.status)
      if (schema !== undefined) byStatus.set(step.expect.status, schema)
    }
  }
  return { method: op.method.toUpperCase(), path: op.path, byStatus }
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

/**
 * The parallel-boot cap for the API driver, ALWAYS ≤ the general sandbox width.
 * An api scenario boots a whole target server that lives for the scenario's
 * duration (a NestJS host is 1.5–2.5GB), so running boots at the CLI sandbox
 * width starves the host — the diagnosed cal.com failure (one pressure window,
 * ~67 health-timeouts). The cap bounds RESIDENT servers, not just boot-starts.
 * Default `min(general, 3)`; `TRUECOURSE_MAX_API_CONCURRENCY` overrides (positive
 * integer, clamped down to `general` — the api set can never out-parallel the run).
 */
export function apiBootConcurrency(general: number): number {
  const env = process.env.TRUECOURSE_MAX_API_CONCURRENCY
  if (env) {
    const n = parseInt(env, 10)
    if (Number.isFinite(n) && n > 0) return Math.min(n, general)
  }
  return Math.min(general, 3)
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
