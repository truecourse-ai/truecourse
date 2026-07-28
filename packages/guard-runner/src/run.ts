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
  GUARD_FORMAT_VERSION,
  worstOutcome,
  type GuardApiScenario,
  type GuardBinds,
  type GuardLatest,
  type GuardManifest,
  type GuardOutcome,
  type GuardScenario,
  type GuardScenarioResult,
  type GuardSectionRollup,
  type GuardSummary,
} from '@truecourse/shared'
import { responseJsonSchema, openApiServerBasePath } from '@truecourse/shared/openapi'
import {
  loadRecipe,
  resolveEntry,
  computeRecipeFingerprint,
  resolveApiCredentials,
  CredentialResolutionError,
  RecipeError,
  DEFAULT_API_HEALTH_PATH,
  DEFAULT_API_READY_TIMEOUT_MS,
  type Recipe,
  type LoadedRecipe,
} from './recipe.js'
import {
  loadResolvedExternals,
  externalsInjectEnv,
  externalsSecrets,
  firstIncompleteExternal,
  incompleteExternalMessage,
  ExternalsError,
} from './externals.js'
import { loadScenarios, type ScenarioLoadError } from './scenario-loader.js'
import { runBuild, runInstall, DEFAULT_BUILD_TIMEOUT_MS, DEFAULT_INSTALL_TIMEOUT_MS, type BuildResult } from './build.js'
import { preflightEntry, formatEntryPreflightError, type EntryPreflightResult } from './preflight.js'
import { runScenario } from './run-scenario.js'
import { runApiScenario } from './api/run-api-scenario.js'
import { preflightApiServer } from './api/preflight.js'
import { runSeed, SeedError } from './api/seed.js'
import { runCredentialRequests, CredentialRequestError } from './api/credential-request.js'
import { appendGuardHistory, readJourneyCatalog, recipePath, writeGuardLatest, writeGuardRun } from './store.js'
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
import { isJourneyDrifted } from './journey-drift.js'
import { readManifest } from './manifest.js'
import { newRunNonce, scenarioUnique } from './unique.js'

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
       * A declared external API account (item 62) is only PARTLY configured on this
       * machine — a base URL with no key, or a key whose `valueFromEnv` var is unset.
       * The scenarios in the corpus were authored against a LIVE service, so running
       * them against a half-described world would blame the app for an infrastructure
       * gap. A hard stop, mirroring `missing-credential-env`; a service that is simply
       * NOT provided (nothing configured) is not this — its flows stay blocked, as before.
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

  // The journey grounding check — a per-scenario ANNOTATION, computed once against
  // the mapping snapshot (absent snapshot ⇒ no annotation anywhere). It never gates
  // execution: a scenario whose surface moved still runs its frozen steps.
  const journeyCatalog = readJourneyCatalog(repoRoot)
  const drifted = new Set(
    selected.filter((s) => isJourneyDrifted(s, journeyCatalog)).map((s) => s.id),
  )
  const annotate = (scenario: GuardScenario): { journeyDrifted?: true } =>
    drifted.has(scenario.id) ? { journeyDrifted: true } : {}

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

  // B5: build the OpenAPI operation-schema index ONCE for the docs bound by api
  // scenarios that assert `schema: true`. Built only when at least one such scenario
  // exists, so a repo not using response-conformance reads no extra files (the flow
  // stays byte-identical). Empty otherwise; `resolveScenarioResponseSchemas` then
  // returns undefined and any stray `schema: true` step errors.
  const schemaBoundDocs = new Set(
    apiExec
      .filter((p) => (p.scenario as GuardApiScenario).steps.some((s) => s.expect.schema === true))
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
    let apiCredentials: Map<string, string> | undefined
    let apiFixtures: Map<string, Record<string, unknown>> | undefined
    let externalSecrets: Map<string, string> | undefined
    if (api && apiExec.length > 0) {
      resolvedServe = resolveEntry(repoRoot, api.serve)
      // User-provided external API accounts (item 62). A PROVIDED external puts its
      // base URL + its extra env into the SERVER env, ABOVE `api.env` (the account
      // the user supplied beats the recipe's default pointer) and BELOW a scenario's
      // own `setup.env` (which is layered later in `createSandbox` — so a scenario
      // that stubs the service with `${HTTP_STUB:…}` still wins for that scenario).
      // A partly-configured external is a hard stop; an unprovided one injects
      // nothing and its flows stay blocked exactly as before.
      let resolvedExternals
      try {
        resolvedExternals = loadResolvedExternals(repoRoot, api.externals, process.env)
      } catch (e) {
        if (e instanceof ExternalsError) return { status: 'invalid-recipe', message: e.message }
        throw e
      }
      const incomplete = firstIncompleteExternal(resolvedExternals)
      if (incomplete) {
        return { status: 'missing-external-env', message: incompleteExternalMessage(incomplete) }
      }
      externalSecrets = externalsSecrets(resolvedExternals)
      apiRecipeEnv = {
        ...(loaded.recipe.env ?? {}),
        ...(api.env ?? {}),
        ...externalsInjectEnv(resolvedExternals),
      }
      // Resolve declared credentials from the host env BEFORE booting — a missing
      // env var is a loud stop, and the secret values never touch the recipe env.
      try {
        const resolved = resolveApiCredentials(api.credentials, process.env)
        apiCredentials = new Map([...resolved].map(([name, cred]) => [name, cred.value]))
      } catch (e) {
        if (e instanceof CredentialResolutionError) return { status: 'missing-credential-env', message: e.message }
        throw e
      }
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
      // Seed AFTER services.up (its datastore/migrations are ready) and BEFORE the
      // server boots — once per run. Seeded credentials merge into the resolved map
      // (and are redacted like any secret); seeded fixtures feed `{{fixture:…}}`.
      if (api.seed) {
        try {
          const seeded = await runSeed({
            repoRoot,
            seed: api.seed,
            // The seed prepares state for the SERVER, so it runs with the server's env
            // (recipe.env merged with api.env) — a datastore URL in `api.env` must reach it.
            env: apiRecipeEnv,
            // Fold the already-resolved Phase-1 credential values into the failure
            // redactor so a secret the seed echoes before failing is masked in seed-failed.
            knownCredentials: apiCredentials,
            externalSecrets,
            timeoutMs: opts.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
            signal: cancel.signal,
          })
          for (const [name, cred] of seeded.credentials) apiCredentials.set(name, cred.value)
          apiFixtures = seeded.fixtures
        } catch (e) {
          const stop = cancelled('build')
          if (stop) return stop
          if (e instanceof SeedError) return { status: 'seed-failed', message: e.message }
          throw e
        }
      }
      // `fromRequest` credentials mint their value against a LIVE app, so the login
      // rides the preflight boot itself (`onReady`) rather than paying for a second
      // one — and lands after the seed, so a seeded account can be the one it logs
      // in as. The minted values merge into the same map static and seeded
      // credentials share, so redaction and `{{cred:…}}` need no new plumbing.
      let credentialRequestError: CredentialRequestError | null = null
      const apiPreflight = await preflightApiServer({
        resolvedServe,
        displayServe: api.serve,
        recipeEnv: apiRecipeEnv,
        healthPath: api.healthPath ?? DEFAULT_API_HEALTH_PATH,
        readyTimeoutMs: api.readyTimeoutMs ?? DEFAULT_API_READY_TIMEOUT_MS,
        signal: cancel.signal,
        onReady: async (baseUrl) => {
          try {
            const minted = await runCredentialRequests({
              baseUrl,
              credentials: api.credentials,
              timeoutMs: opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
              signal: cancel.signal,
            })
            for (const [name, cred] of minted) apiCredentials!.set(name, cred.value)
          } catch (e) {
            // Recorded, not rethrown: the preflight's own contract is the boot, and
            // a throw here would surface as an unhandled crash rather than a status.
            if (e instanceof CredentialRequestError) credentialRequestError = e
            else throw e
          }
        },
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

    opts.onPhase?.('run', selected.length)

    const runId = buildRunId()
    // One nonce per run seeds each scenario's stable `${unique}` token (distinct per
    // scenario id, distinct across runs) — see `scenarioUnique`.
    const runNonce = newRunNonce()
    const ranAt = new Date().toISOString()
    const stepTimeoutMs = opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
    const concurrency = opts.concurrency ?? defaultRunConcurrency()

    const results: GuardScenarioResult[] = []

    // Stale/orphaned scenarios settle immediately — they never touch a sandbox.
    for (const { scenario, verdict } of nonExecutable) {
      const result = { ...nonExecutableResult(scenario, verdict), ...annotate(scenario) }
      results.push(result)
      settled += 1
      opts.onScenarioSettled?.(settled, selected.length, result)
    }

    // Scenarios whose driver has no preparation in the recipe settle as errors —
    // an honest per-scenario gap, never a silent skip, never a run-wide failure.
    for (const { scenario, verdict, missing } of unprepared) {
      const result: GuardScenarioResult = {
        id: scenario.id,
        title: scenario.title,
        binds: scenario.binds[0],
        ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
        outcome: 'error',
        durationMs: 0,
        failure: { step: 1, expected: `the recipe to prepare the ${scenario.driver} driver`, actual: missing },
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

    const runOne = async ({ scenario, verdict }: (typeof runnable)[number]): Promise<GuardScenarioResult | null> => {
      // Once cancelled, no new child spawns; a post-cancel settlement doesn't count
      // either — a run ending `aborted`/`run-timed-out` discards these results.
      if (cancel.signal.aborted) return null
      const outcome =
        scenario.driver === 'api'
          ? await runApiScenario(scenario, {
              repoRoot,
              runId,
              unique: scenarioUnique(runNonce, scenario.id),
              resolvedServe: resolvedServe!,
              healthPath: api!.healthPath ?? DEFAULT_API_HEALTH_PATH,
              readyTimeoutMs: api!.readyTimeoutMs ?? DEFAULT_API_READY_TIMEOUT_MS,
              recipeEnv: apiRecipeEnv,
              credentials: apiCredentials,
              externalSecrets,
              fixtures: apiFixtures,
              responseSchemas: resolveScenarioResponseSchemas(
                operationSchemaIndex,
                scenario as GuardApiScenario,
                verdict.resolutions,
              ),
              stepTimeoutMs,
              capturePassEvidence,
              signal: cancel.signal,
            })
          : await runScenario(scenario, {
              repoRoot,
              runId,
              unique: scenarioUnique(runNonce, scenario.id),
              resolvedEntry: resolvedEntry!,
              recipeEnv: loaded.recipe.env,
              stepTimeoutMs,
              capturePassEvidence,
              signal: cancel.signal,
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

    // TWO POOLS, run concurrently. An api scenario boots a whole target server that
    // lives for the scenario's duration, so a shared pool at the CLI sandbox width lets
    // heavyweight servers pile up (the diagnosed cal.com starvation). The api pool caps
    // parallel scenarios at `apiBootConcurrency` — which bounds RESIDENT servers, not
    // just boot-starts. `orderReadBeforeWrite` still runs read-only api scenarios ahead
    // of mutating ones WITHIN the api pool (its ordering only ever mattered for the api
    // set — cli sandboxes are isolated).
    const apiRunnable = orderReadBeforeWrite(runnable.filter((x) => x.scenario.driver === 'api'))
    const cliRunnable = runnable.filter((x) => x.scenario.driver !== 'api')
    // The two pools share ONE budget so their combined in-flight count never exceeds
    // `concurrency` — the host-load knob whose violation caused the incident. When both
    // drivers run, the api pool draws from that budget (capped so it can't starve cli of
    // its floor of 1) and cli takes the remainder; a single-driver run is unchanged
    // (api-only ≤ apiCap, cli-only = full width). See `TRUECOURSE_MAX_API_CONCURRENCY`.
    const bothDrivers = apiRunnable.length > 0 && cliRunnable.length > 0
    const apiWidth = bothDrivers
      ? Math.min(apiBootConcurrency(concurrency), Math.max(1, concurrency - 1))
      : apiBootConcurrency(concurrency)
    const cliWidth = bothDrivers ? Math.max(1, concurrency - apiWidth) : concurrency
    const [apiResults, cliResults] = await Promise.all([
      mapWithConcurrency(apiRunnable, apiWidth, runOne),
      mapWithConcurrency(cliRunnable, cliWidth, runOne),
    ])
    const executed = [...apiResults, ...cliResults].filter((r): r is GuardScenarioResult => r !== null)
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
      sections: rollupSections(results, new Map(selected.map((s) => [s.id, s.binds]))),
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

/**
 * An api scenario is READ-ONLY when every step is a GET or HEAD — it observes state
 * without mutating it. A cli scenario carries no reliable read/write signal, so it is
 * never treated as read-only.
 */
function isReadOnlyScenario(scenario: GuardScenario): boolean {
  if (scenario.driver !== 'api') return false
  return scenario.steps.every((s) => s.request.method === 'GET' || s.request.method === 'HEAD')
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

function summarize(results: readonly GuardScenarioResult[]): GuardSummary {
  const summary: GuardSummary = { total: results.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 }
  for (const r of results) summary[r.outcome] += 1
  return summary
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
