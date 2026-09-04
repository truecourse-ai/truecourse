/**
 * `truecourse guard setup` — the CHEAP preparation stage that runs between
 * `spec scan` and `guard generate`.
 *
 * Every environment fact guard needs used to be discovered as a byproduct of the most
 * expensive stage in the product, and FIXING any of them edits `recipe.json`, which
 * moves the recipe fingerprint, which re-authors sections that were already good.
 * Setup makes all of it knowable and fixable before the first extraction call.
 *
 * The steps, in order (the §7.6 taxonomy), and what each may do to the run:
 *   0    an LLM provider must be configured        — the CALLER's check (config lives
 *                                                    above this package); the adapter
 *                                                    fails before calling in.
 *   0.5  a corpus must exist                       — HARD: setup runs after scan.
 *   1    the recipe                                — THE ONLY HARD GATE. Discovery
 *                                                    (deterministic → the repair
 *                                                    session or the one-shot LLM →
 *                                                    verify by running) plus a live
 *                                                    endpoint probe per declared server.
 *   2    detect                                    — one `mapInterfaces` pass; free.
 *   3    the catalog                               — SOFT. The externals declaration
 *                                                    skeleton (det) + the
 *                                                    dependency-catalog session seam.
 *   4    interfaces                                — SOFT. The cli reconcile session
 *                                                    over the union's disputes, then
 *                                                    the web-task authoring run
 *                                                    (both behind `authorInterfaces`).
 *   5    the one seed (data AND auth)              — SOFT, never blocks. The seed
 *                                                    authoring session (`seedSession`).
 *   6    auth                                      — SOFT; the one step that may end
 *                                                    `blocked`. The auth-proof
 *                                                    session (`verifyAuth`).
 * The credential↔spec `satisfies` check is reported here too, where fixing it costs
 * nothing; `guard generate` keeps its own cheap re-validation because specs can move
 * between the two stages.
 *
 * IDEMPOTENT BY CONSTRUCTION, twice over: a bare run over a repo that already has a
 * recipe and a seed reports and no-ops, and the report's `steps` spine records a
 * per-step input fingerprint so an unchanged step is SKIPPED on the next run
 * (`skipped`/`unchanged`). `refresh` forces every step; refreshing the SEED
 * additionally needs `confirmSeedReplace` to answer true, and the CLI's non-TTY path
 * answers false — a hand-edited seed script is never clobbered by a flag.
 *
 * SINGLE-STEP MODE (`only` / the CLI's `--only-<step>` flags): run one LLM-bearing
 * step in isolation — prior steps replay from what they left on disk (never a
 * session, never the live probe; a step nobody ever ran fails loud with
 * {@link SetupStepNotReadyError}), later steps never start, and `guard/setup.json`
 * is MERGED so the steps that did not run this time keep their record. See
 * {@link GuardSetupOptions.only}.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  loadRecipe,
  recipePath,
  buildRouteManifest,
  loadResolvedExternals,
  computeRecipeFingerprint,
  dependenciesPath,
  guardAuthoredInterfacesPath,
  hashableRecipeText,
  readGuardSetup,
  readInterfaceCatalog,
  resolveSeedScript,
  FINGERPRINT_INPUTS,
  RecipeSchema,
  type Recipe,
  type RecipeApiExternal,
} from '@truecourse/guard-runner'
import { parseSecuritySchemes, parseOpenApiSpec, type SecurityScheme } from '@truecourse/shared/openapi'
import type {
  DatastoreUrlRef,
  DetectedExternalService,
  GuardSetupExternalsStep,
  GuardSetupInterfaceResolution,
  GuardSetupRecipeStep,
  GuardSetupReport,
  GuardSetupSeedStep,
  GuardSetupServerProbe,
  GuardSetupTaxonomyKey,
  GuardSetupTaxonomyStep,
  Interface,
  MapperDiagnostic,
} from '@truecourse/shared'
import { discoverRecipe, type RecipeDiscoveryPhase, type RecipeRepairFn } from './recipe-discovery.js'
import { detectEcosystems, routesFromInterfaces, type ApiRouteRef } from './recipe-propose.js'
import { probeApiServers } from './endpoint-probe.js'
import { deriveExternalsSkeleton } from './externals-skeleton.js'
import {
  detectRoleColumns,
  readExistingSeedScript,
  seedDraftGate,
  type SeedDraftDatabase,
} from './seed-draft.js'
import { hasGuardUniverse, corpusOpenApiDocs, readCorpusAreaTags } from './section-plan.js'
import {
  collectProbeCandidates,
  recipeAuthCredentials,
  validateCredentialSatisfies,
  type ProbeCandidate,
} from './openapi-security.js'
import {
  apiAuthEvidence,
  probeCandidatesFromInterfaces,
  requiredResources,
  type ApiAuthEvidence,
  type RequiredResource,
} from './seed-evidence.js'
import type { InterfaceProvider } from './generate.js'
import type { RecipeRunner } from './runners.js'

/** How many spec docs the seed draft is shown, and how much of each. */
const MAX_SPEC_EXCERPTS = 6
const SPEC_EXCERPT_CHARS = 1500

// ---------------------------------------------------------------------------
// Single-step mode (`--only-<step>`)
// ---------------------------------------------------------------------------

/**
 * The setup steps that may spend an LLM session, in spine order — the five the
 * `--only-<step>` flags select from. `detect` is NOT one of them: it is one
 * deterministic `mapInterfaces` pass whose in-memory output every later step
 * reads, so it always runs and the detection snapshot is always this run's.
 */
export const GUARD_SETUP_ONLY_STEPS = ['recipe', 'catalog', 'interfaces', 'seed', 'auth'] as const
export type GuardSetupOnlyStep = (typeof GUARD_SETUP_ONLY_STEPS)[number]

/**
 * A single-step run found a PRIOR step's evidence missing: replaying it would
 * mean spending the sessions (or the boot, or the probe) that belong to that
 * step's OWN flag. Deliberately loud — silently running it is exactly the
 * blurring a stepwise run exists to prevent. The fix is always
 * `truecourse guard setup --only-<step>`.
 */
export class SetupStepNotReadyError extends Error {
  constructor(
    readonly step: GuardSetupOnlyStep,
    /** What is missing, in the words the user has to act on. */
    readonly missing: string,
  ) {
    super(
      `the ${step} step has not run (${missing}) — run \`truecourse guard setup --only-${step}\` first`,
    )
    this.name = 'SetupStepNotReadyError'
  }
}

export interface GuardSetupOptions {
  repoRoot: string
  /** Interface mapping seam — generate's provider shape, optionally extended
   *  with the mapping's run diagnostics; see {@link GuardSetupInterfaceProvider}. */
  interfaces?: GuardSetupInterfaceProvider
  recipeRunner: RecipeRunner
  /** Re-derive the recipe and re-draft the seed even when both already exist. */
  refresh?: boolean
  /** Interfaces step: re-author places that already carry authored tasks. */
  replace?: boolean
  /**
   * Single-step mode: run ONLY this step. Steps BEFORE it replay from what they
   * left on disk — the recipe from `recipe.json` (no discovery, no repair
   * session, no live endpoint probe), the soft steps from their row in
   * `guard/setup.json` (their artifacts — the catalog, the authored tasks, the
   * seed script — are read straight off the tree by whoever needs them, and each
   * may legitimately be empty). A step nothing ever ran throws
   * {@link SetupStepNotReadyError} rather than quietly spending it here. Steps
   * AFTER it never start, `detect` always runs, and the persisted report merges
   * over the previous one so the untouched steps keep their record.
   *
   * The one exception to the merge is a HARD failure, which only `--only-recipe`
   * can reach (every other step replays the recipe rather than re-deriving it):
   * a failed run reports the rows it reached and nothing else, exactly as a
   * whole run does — a recipe that no longer holds is no basis for calling the
   * steps that were computed against it settled.
   */
  only?: GuardSetupOnlyStep
  /**
   * Asked ONCE, and only when a refresh would REPLACE an existing `api.seed`. A seed
   * script is a committed, human-reviewed file: `--refresh` alone is not consent, and
   * a non-TTY caller answers false so a flag can never clobber a hand-edited script.
   */
  confirmSeedReplace?: () => Promise<boolean>
  signal?: AbortSignal
  // --- progress hooks ---
  onStep?: (step: GuardSetupStepKey, detail?: string) => void
  onStepDone?: (step: GuardSetupStepKey, detail?: string) => void
  /**
   * The LIVE detail of the step that is running — the phase inside it. Steps 1 and 4
   * are minutes of real work (an analysis pass, an install, a build, a boot, a model
   * call) behind one label, so without this a caller's spinner sits on "Deriving the
   * recipe" with nothing to show. A plain string callback: this package must not
   * depend on `@truecourse/core`, so the command layer adapts it onto its tracker.
   */
  onStepDetail?: (step: GuardSetupStepKey, detail: string) => void
  // --- the session seams (plan 03) ---
  /**
   * The recipe-repair session (step 9), passed through to `discoverRecipe`.
   * Absent ⇒ the legacy one-shot `recipeRunner` fallback runs instead.
   */
  repair?: RecipeRepairFn
  /**
   * The dependency-catalog session (step 10). Runs inside the catalog step,
   * AFTER the deterministic externals skeleton; its fold (in the seam's own
   * implementation) merges into `scenarios/dependencies.json` + the local
   * overlay. Absent ⇒ the catalog step is its deterministic half alone.
   */
  catalogSession?: GuardSetupCatalogSession
  /**
   * The interfaces step body (plan 03 steps 11 + 12): the cli reconcile
   * session over the mapping's diagnostics, then the web-task authoring run.
   * Absent ⇒ the step reports a `skipped` placeholder row.
   */
  authorInterfaces?: GuardSetupInterfacesStep
  /**
   * The seed authoring session (plan 03 step 13). Replaces the one-shot
   * `draftSeed`; absent ⇒ the seed step reports a `skipped` placeholder row
   * (the gate and the replace-confirmation still run first, here).
   */
  seedSession?: GuardSetupSeedSession
  /**
   * The auth-proof session over the catalog's supplied entries (plan 03 step
   * 14). Absent ⇒ the step reports a `skipped` placeholder row. Its result may
   * be `blocked` — the one step allowed to end that way without failing setup.
   */
  verifyAuth?: GuardSetupAuthStep
  // --- test seams ---
  /** Test seam for step 1's live probe; production boots the real server. */
  probe?: typeof probeApiServers
}

/** Stable step taxonomy, shared by the CLI tracker and the dashboard —
 *  the §7.6 spine: recipe → detect → catalog → interfaces → seed → auth
 *  (the old externals step folded INTO catalog). */
export const GUARD_SETUP_STEPS = [
  { key: 'recipe', label: 'Deriving the recipe' },
  { key: 'detect', label: 'Detecting dependencies' },
  { key: 'catalog', label: 'Cataloguing dependencies' },
  { key: 'interfaces', label: 'Authoring the interface catalog' },
  { key: 'seed', label: 'Preparing data + principals' },
  { key: 'auth', label: 'Verifying supplied auth' },
] as const

export type GuardSetupStepKey = (typeof GUARD_SETUP_STEPS)[number]['key']

// ---------------------------------------------------------------------------
// The session seams — typed here (the engine cannot depend on `@truecourse/core`,
// which owns the sessions), injected by the command adapter.
// ---------------------------------------------------------------------------

/** What the dependency-catalog session is briefed on (plan 03 step 10). */
export interface GuardSetupCatalogSessionInput {
  repoRoot: string
  /** The verified recipe as it stands AFTER the externals skeleton write. */
  recipe: Recipe
  /** The rich in-memory detection — services with evidence, the parsed schema. */
  detected: readonly DetectedExternalService[]
  database: SeedDraftDatabase | null
  datastoreUrls: readonly DatastoreUrlRef[]
  /** The deterministic skeleton's account, already applied to `recipe.json`. */
  skeleton: { declared: string[]; alreadyDeclared: string[]; undeclarable: string[] }
  /** The catalog step's PRE-RUN input fingerprint — the session's cache key. */
  fingerprint: string
}

export type GuardSetupCatalogSessionResult =
  | { status: 'ok'; added: string[]; findings: string[]; sessionRunId?: string; fromCache?: boolean }
  | { status: 'failed'; reason: string; sessionRunId?: string }

export type GuardSetupCatalogSession = (
  input: GuardSetupCatalogSessionInput,
) => Promise<GuardSetupCatalogSessionResult>

/**
 * The provider the setup engine maps the tree with — generate's
 * {@link InterfaceProvider} shape plus the mapping's run DIAGNOSTICS (the cli
 * union's tree-vs-probe disputes, plan 03 step 12). Structural and optional,
 * so every existing provider (which simply omits the field) still fits, and
 * the field never enters the snapshot — it is run reporting the interfaces
 * step consumes.
 */
export type GuardSetupInterfaceProvider = () => Promise<
  Awaited<ReturnType<InterfaceProvider>> & { diagnostics?: MapperDiagnostic[] }
>

/** The interfaces step's seam (plan 03 steps 11 + 12): reconcile, then author. */
export interface GuardSetupInterfacesStepInput {
  repoRoot: string
  fingerprint: string
  refresh: boolean
  /** Re-author places that already carry authored tasks (`--replace`). */
  replace: boolean
  /** The recipe as it stands on disk when the step runs. */
  recipe: Recipe
  /** The memoized mapping's in-memory catalog — what resolutions edit BEFORE
   *  the corrected snapshot is written back. */
  interfaces: readonly Interface[]
  /** EVERY diagnostic the mapping reported; the seam filters down to the kinds
   *  its session can answer (the cli `*-missing-*` disputes). */
  diagnostics: readonly MapperDiagnostic[]
}
export type GuardSetupInterfacesStepResult = {
  status: 'ok' | 'skipped' | 'failed'
  reason?: string
  sessionRunId?: string
  /** What this run disputed/noticed — recorded on the step row, never stored
   *  in the catalog. */
  diagnostics?: MapperDiagnostic[]
  /** The reconcile session's per-subject verdicts, when one ran. */
  resolutions?: GuardSetupInterfaceResolution[]
  /** The catalog edits the resolutions produced, one line each. */
  changes?: string[]
}
export type GuardSetupInterfacesStep = (
  input: GuardSetupInterfacesStepInput,
) => Promise<GuardSetupInterfacesStepResult>

/** What the seed authoring session is briefed on (plan 03 step 13) — today's
 *  draftSeed inputs, gathered by the engine so the session module stays free
 *  of the corpus readers. */
export interface GuardSetupSeedSessionInput {
  repoRoot: string
  recipe: Recipe
  /** The parsed schema — the gate guarantees it is present and non-empty. */
  database: SeedDraftDatabase
  routes: { method: string; path: string }[]
  securitySchemes: { name: string; summary: string }[]
  /**
   * Spec-derived endpoints whose security REQUIRES a scheme — the briefing
   * hands them to the session so a credential probe is CONFIRMED, never hunted
   * (the hunt is what exhausted the documenso session's whole budget, which
   * then shipped a seed declaring zero credentials).
   */
  probeCandidates: ProbeCandidate[]
  /**
   * Why the api surface is judged to authenticate — every deterministic signal
   * (`apiAuthEvidence`), not the OpenAPI scheme alone. Any entry makes `api` a
   * runnable surface the seed must mint a probed principal for.
   */
  apiAuthEvidence?: ApiAuthEvidence[]
  /**
   * The resources the route surface references by id or handle, most-referenced
   * first (`requiredResources`) — the rows a test must already have.
   */
  requiredResources?: RequiredResource[]
  roles: { name: string; source: string }[]
  specExcerpts: { doc: string; text: string }[]
  /** The repo's ecosystem — decides the drafted script's language/extension. */
  ecosystem: string
  /** The caller confirmed replacing the existing `api.seed`. */
  replaceExisting: boolean
  /** The script being replaced, quoted so the draft improves on it. */
  existingScript?: { scriptPath: string; scriptContent: string }
  /** The seed step's PRE-RUN input fingerprint — the session's cache key. */
  fingerprint: string
  /** The live phase line: what is running now, and what to call it when done. */
  onPhase?: (running: string, done: string) => void
}
export type GuardSetupSeedSessionResult =
  | {
      status: 'ok'
      scriptPath: string
      command: string
      fixtures?: string[]
      credentials?: string[]
      sessionRunId?: string
      fromCache?: boolean
      /** The session died without an outcome and its last verified draft was folded. */
      salvaged?: boolean
    }
  | { status: 'failed' | 'skipped'; reason: string; sessionRunId?: string }
export type GuardSetupSeedSession = (
  input: GuardSetupSeedSessionInput,
) => Promise<GuardSetupSeedSessionResult>

/** The auth-proof step's seam (plan 03 step 14). */
export interface GuardSetupAuthStepInput {
  repoRoot: string
  recipe: Recipe
  fingerprint: string
}
export type GuardSetupAuthStepResult = {
  status: 'ok' | 'skipped' | 'failed' | 'blocked'
  reason?: string
  sessionRunId?: string
}
export type GuardSetupAuthStep = (input: GuardSetupAuthStepInput) => Promise<GuardSetupAuthStepResult>

/** What the caller gets back: the persisted record plus the loaded recipe. */
export interface GuardSetupResult {
  report: GuardSetupReport
  /** The recipe setup ended with; null when the hard gate failed. */
  recipe: Recipe | null
}

/**
 * Run the whole stage. Never throws for a repo-shaped problem: step 0.5 and the
 * recipe gate come back as `status: 'failed'` with a reason, and every soft step
 * records its own outcome without demoting the run.
 *
 * SKIP-WHEN-SETTLED (plan 03 step 8): every taxonomy step records an input
 * fingerprint in the report's `steps` spine, computed over the tree AS THE STEP
 * LEFT IT (a step that writes — the skeleton, the seed — would otherwise never
 * match itself again). On a re-run, a step whose prior row settled (`ok`, or an
 * earlier `skipped`/`unchanged` carry-forward) with the same fingerprint is
 * skipped whole; `--refresh` forces every step to run.
 */
export async function runGuardSetup(opts: GuardSetupOptions): Promise<GuardSetupResult> {
  const { repoRoot } = opts

  // Step 0.5 — the corpus. Setup is the SECOND link of a three-stage chain; without
  // the first there is nothing to derive roles, principals, or credentials against,
  // and half-completing would leave a recipe that no spec ever justified.
  if (!hasGuardUniverse(repoRoot)) {
    return failed(
      'No corpus found. `truecourse guard setup` runs after the spec scan — run `truecourse spec scan` first.',
    )
  }

  const phases = stepPhases(opts)
  const steps: GuardSetupTaxonomyStep[] = []
  const settled = settledFingerprints(repoRoot, opts.refresh === true)

  // Single-step mode. `prior` is both the merge source and the evidence a soft
  // step ever ran — a step that ran and produced nothing legitimately left no
  // artifact behind, so the row is what says it happened.
  const only = opts.only
  const prior = only ? readGuardSetup(repoRoot) : null
  const rank = (step: GuardSetupOnlyStep): number => GUARD_SETUP_ONLY_STEPS.indexOf(step)
  /** Prior to the chosen step: replay from disk, never spend. */
  const replayed = (step: GuardSetupOnlyStep): boolean => only !== undefined && rank(step) < rank(only)
  /** After the chosen step: never starts. */
  const later = (step: GuardSetupOnlyStep): boolean => only !== undefined && rank(step) > rank(only)
  const ranBefore = (step: GuardSetupOnlyStep): boolean =>
    (prior?.steps ?? []).some((row) => row.key === step)

  // ONE analysis pass feeds every step — memoized exactly as generate memoizes it.
  // Which STEP pays for it depends on the repo (the recipe step derives from the
  // route surface; a repo that already has one first needs it at detect), so the
  // phase is reported from here, against whichever step is running when the pass
  // actually starts.
  let mappedOnce: ReturnType<typeof mapSafely> | null = null
  let mappedWithRecipe = false
  const mapOnce = (): ReturnType<typeof mapSafely> => {
    if (!mappedOnce) {
      phases.enter({ running: 'analyzing the repository', done: 'analysis' })
      mappedWithRecipe = fs.existsSync(recipePath(repoRoot))
      mappedOnce = mapSafely(opts.interfaces)
    }
    return mappedOnce
  }

  // ---- Step 1: the recipe. THE ONLY HARD GATE. -----------------------------
  opts.onStep?.('recipe')
  phases.step('recipe')
  // The recipe step's fingerprint is the SUBJECT (the ecosystem manifests), never
  // its own output: an edited recipe.json re-runs nothing here, a moved lockfile
  // re-runs everything — the step re-derives when the repo moved.
  const recipeInputFp = ecosystemFingerprint(repoRoot)
  const preexisting = reloadRecipe(repoRoot)
  let recipe: Recipe
  let recipeStep: GuardSetupRecipeStep
  if (replayed('recipe')) {
    // Single-step mode, a later step: the recipe on disk IS the artifact every
    // step downstream reads. Neither discovery nor the repair session nor the
    // live probe runs — they belong to `--only-recipe` — and no row is pushed,
    // so the merge below keeps the one the run that really verified it wrote.
    if (!preexisting) {
      throw new SetupStepNotReadyError('recipe', `no readable recipe at ${recipePath(repoRoot)}`)
    }
    recipe = preexisting
    recipeStep = { status: 'ok', outcome: 'exists' }
    opts.onStepDone?.('recipe', 'replayed from recipe.json — not re-derived, not probed')
  } else if (preexisting && settled('recipe') === recipeInputFp) {
    // Settled: the subject is byte-identical to what the last run verified, so
    // neither discovery nor the live probe re-runs. `--refresh` bypasses this.
    recipe = preexisting
    recipeStep = { status: 'ok', outcome: 'exists' }
    steps.push({ key: 'recipe', status: 'skipped', reason: 'unchanged', inputFingerprint: recipeInputFp })
    opts.onStepDone?.('recipe', 'unchanged — reused without re-verifying')
  } else {
    // A REFRESH re-derives, and discovery writes what it derived — which knows nothing
    // about the blocks it never proposes (`api.seed`, `api.externals`,
    // `api.credentials`, `ownHosts`). Those are user- and setup-authored CAPABILITY
    // declarations; losing them to a refresh would be silent data loss, and it would
    // also defeat the seed confirmation below (a wiped `api.seed` is not a seed anyone
    // is asked about replacing). Captured before, merged back after.
    const authored = opts.refresh ? authoredBlocks(preexisting) : null
    const discovery = await discoverRecipe(repoRoot, opts.recipeRunner, {
      ...(opts.refresh ? { ignoreExisting: true } : {}),
      ...(opts.repair ? { repair: opts.repair } : {}),
      routes: async () => routesFromInterfaces((await mapOnce()).interfaces),
      database: async () => {
        const db = (await mapOnce()).database
        return db ? { type: db.type, driver: db.driver } : null
      },
      datastores: async () => (await mapOnce()).datastoreUrls ?? [],
      onPhase: (phase) => phases.enter(recipePhase(phase)),
    })
    if (discovery.status === 'verify-failed') {
      return failed(discovery.reason, {
        recipe: { status: 'failed', reason: discovery.reason },
        steps: [
          ...steps,
          {
            key: 'recipe',
            status: 'failed',
            reason: discovery.reason,
            inputFingerprint: recipeInputFp,
            ...(discovery.sessionRunId ? { sessionRunId: discovery.sessionRunId } : {}),
          },
        ],
      })
    }
    // Put the authored blocks back before ANYTHING reads the recipe again.
    recipe =
      authored && discovery.status === 'discovered'
        ? (restoreAuthoredBlocks(repoRoot, authored) ?? discovery.recipe)
        : discovery.recipe
    recipeStep = {
      status: 'ok',
      outcome: discovery.status === 'exists' ? 'exists' : 'discovered',
      ...(discovery.status === 'discovered'
        ? {
            source: discovery.source,
            wrotePath: discovery.wrotePath,
            ...(discovery.composePath ? { composePath: discovery.composePath } : {}),
            ...(discovery.todos.length > 0 ? { todos: discovery.todos } : {}),
          }
        : {}),
    }

    // The live endpoint probe — the half verification does not do. See `endpoint-probe.ts`
    // for why any HTTP status (401 and 404 included) is a pass.
    const manifest = buildRouteManifest(repoRoot)
    const probes: GuardSetupServerProbe[] = recipe.api
      ? await (opts.probe ?? probeApiServers)({
          repoRoot,
          recipe,
          manifest,
          ...(opts.signal ? { signal: opts.signal } : {}),
          onServer: (done, total) => {
            const line = total === 1 ? 'probing a live route' : `probing live routes ${done}/${total}`
            if (done === 0) phases.enter({ running: line, done: 'route probe' })
            else phases.tick(line)
          },
        })
      : []
    if (probes.length > 0) recipeStep.probes = probes
    const deadServer = probes.find((p) => !p.ok)
    if (deadServer) {
      const reason =
        `the recipe's server "${deadServer.server}" is declared but not reachable: ${deadServer.error}. ` +
        `Every api scenario would fail identically against it, so setup stops here rather than preparing a world nothing can run in.`
      recipeStep.status = 'failed'
      recipeStep.reason = reason
      return failed(reason, {
        recipe: recipeStep,
        steps: [...steps, { key: 'recipe', status: 'failed', reason, inputFingerprint: recipeInputFp }],
      })
    }
    const sessionRunId = discovery.status === 'discovered' ? discovery.sessionRunId : undefined
    steps.push({
      key: 'recipe',
      status: 'ok',
      inputFingerprint: recipeInputFp,
      ...(sessionRunId ? { sessionRunId } : {}),
    })
    opts.onStepDone?.('recipe', recipeSummary(recipeStep, probes))
  }

  // ---- The credential↔spec check, reported where fixing it is free. --------
  const credentials = recipeAuthCredentials(recipe)
  const openApiDocs = corpusOpenApiDocs(repoRoot)
  const credentialSchemes = credentials.some((c) => c.satisfies)
    ? validateCredentialSatisfies(credentials, openApiDocs)
    : { errors: [], warnings: [] }

  /**
   * Announce a step — and, in single-step mode, answer whether it runs at all.
   * A step AFTER the chosen one never starts, so it is never announced either:
   * a tracker must not tick work that did not happen.
   */
  const enter = (key: GuardSetupOnlyStep): boolean => {
    if (later(key)) return false
    opts.onStep?.(key)
    phases.step(key)
    return true
  }

  // ---- Step 2: detect. Deterministic, free, no LLM — always runs. ----------
  opts.onStep?.('detect')
  phases.step('detect')
  // Discovery may have mapped the tree BEFORE the recipe existed (its route and
  // datastore reads feed the proposal). A mapping with no recipe has no entry to
  // probe, so a cli no extractor reads came out empty — map again now that the
  // recipe is on disk and the verification build left its entry runnable.
  if (mappedOnce && !mappedWithRecipe) mappedOnce = null
  const mapped = await mapOnce()
  const detectedExternals = mapped.externalServices ?? []
  const database = mapped.database ?? null
  const datastoreUrls = mapped.datastoreUrls ?? []
  const detectionSnapshotJson = canonicalDetectionJson(detectedExternals, database, datastoreUrls)
  steps.push({ key: 'detect', status: 'ok', inputFingerprint: '' })
  opts.onStepDone?.(
    'detect',
    detectSummary(detectedExternals, database),
  )

  // ---- Step 3: the catalog — the externals skeleton (det) + the session. ---
  // SOFT throughout: the hard gate already held, and a catalog that could not be
  // classified is a reported step, never a failed setup.
  const catalogFpOf = (): string =>
    catalogFingerprint(detectionSnapshotJson, computeRecipeFingerprint(repoRoot), dependenciesFileContent(repoRoot))
  // The session's COMMITTABLE settle gate. The legacy `settled('catalog')` gate
  // lives in gitignored guard/setup.json, so a fresh checkout re-runs the
  // session every time — and the session's additions are LLM-nondeterministic,
  // so each fresh run can grow the catalog, which moves the recipe fingerprint,
  // which re-authors every flow. This fingerprint deliberately excludes the
  // committed catalog (feeding the session's OUTPUT back into its gate is what
  // made the churn self-sustaining) and the full recipe fingerprint (which
  // folds the catalog too): it hashes only what the session derives FROM —
  // detection, the recipe's own text, and the seed script. While it holds, the
  // committed catalog stands byte-for-byte; the add-only fold already protects
  // curated entries whenever the session does run.
  // Detection IDENTITY without evidence: the evidence entries carry absolute
  // file paths, which differ between two checkouts of identical content (a
  // base worktree vs a head worktree), so a settle gate that folds them can
  // never hold across worktrees. Identity is what the session classifies —
  // which services exist, how they were seen, their override env vars, and the
  // database class — never where in the tree they were spotted.
  const stableDetectionJson = JSON.stringify({
    services: [...detectedExternals]
      .map((s) => ({
        service: s.service,
        category: s.category ?? null,
        source: s.source ?? null,
        baseUrlEnvs: [
          ...new Set([...(s.baseUrlEnvs ?? []).map((e) => e.envVar), ...(s.baseUrlEnv ? [s.baseUrlEnv] : [])]),
        ].sort(),
      }))
      .sort((a, b) => a.service.localeCompare(b.service)),
    database: database ? { type: database.type, driver: database.driver } : null,
  })
  const catalogSessionFpOf = (): string => {
    let recipeRaw = ''
    try {
      recipeRaw = fs.readFileSync(recipePath(repoRoot), 'utf-8')
    } catch {
      // no recipe — the fingerprint still keys on detection alone
    }
    const seedAbs = recipeRaw ? resolveSeedScript(repoRoot, recipeRaw) : null
    const hash = createHash('sha256')
    hash.update(`${stableDetectionJson}::${recipeRaw ? hashableRecipeText(recipeRaw) : ''}::`)
    if (seedAbs && fs.existsSync(seedAbs)) hash.update(fs.readFileSync(seedAbs))
    return `sha256:${hash.digest('hex')}`
  }
  let externalsStep: GuardSetupExternalsStep | undefined
  if (enter('catalog')) {
    const catalogFpPre = catalogFpOf()
    const catalogSessionFp = catalogSessionFpOf()
    const settledSession = opts.refresh === true ? null : readCatalogSettle(repoRoot)
    const catalogOnDisk = fs.existsSync(dependenciesPath(repoRoot))
    // A committed catalog with no settle record predates this gate: adopt it as
    // settled rather than re-classifying — it is a curated, committed file, and
    // `--refresh` remains the explicit way to re-derive it.
    const settleSkip =
      catalogOnDisk && (settledSession === catalogSessionFp || (settledSession === null && opts.refresh !== true))
    if (replayed('catalog')) {
      // Prior step: the catalog on disk stands as it is. Not even the
      // deterministic skeleton runs — it WRITES `api.externals` into the recipe,
      // and a step nobody chose must leave the tree alone.
      if (!ranBefore('catalog')) {
        throw new SetupStepNotReadyError('catalog', 'no catalog row in guard/setup.json')
      }
      opts.onStepDone?.('catalog', 'replayed — scenarios/dependencies.json stands as it is')
    } else if (settled('catalog') === catalogFpPre || settleSkip) {
      // The skeleton is still run for the legacy report field — with unchanged
      // detection and an unchanged recipe it derives nothing and writes nothing —
      // but no session is spent.
      externalsStep = applyExternalsSkeleton(repoRoot, recipe, detectedExternals)
      if (settledSession !== catalogSessionFp) writeCatalogSettle(repoRoot, catalogSessionFp)
      steps.push({ key: 'catalog', status: 'skipped', reason: 'unchanged', inputFingerprint: catalogFpPre })
      opts.onStepDone?.('catalog', 'unchanged')
    } else {
      externalsStep = applyExternalsSkeleton(repoRoot, recipe, detectedExternals)
      if (opts.catalogSession) {
        phases.enter({ running: 'classifying the dependency catalog', done: 'catalog session' })
        const result = await opts.catalogSession({
          repoRoot,
          recipe: reloadRecipe(repoRoot) ?? recipe,
          detected: detectedExternals,
          database,
          datastoreUrls,
          skeleton: {
            declared: externalsStep.declared,
            alreadyDeclared: externalsStep.alreadyDeclared,
            undeclarable: externalsStep.undeclarable,
          },
          fingerprint: catalogFpPre,
        })
        if (result.status === 'ok') writeCatalogSettle(repoRoot, catalogSessionFpOf())
        steps.push(
          result.status === 'ok'
            ? {
                key: 'catalog',
                status: 'ok',
                // Post-write: the fold just moved dependencies.json (and the
                // skeleton may have moved recipe.json), so the settled value is
                // what an unchanged re-run will compute.
                inputFingerprint: catalogFpOf(),
                ...(result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}),
              }
            : {
                key: 'catalog',
                status: 'failed',
                reason: result.reason,
                inputFingerprint: catalogFpPre,
                ...(result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}),
              },
        )
        opts.onStepDone?.('catalog', catalogSummary(externalsStep, result))
      } else {
        // No session wired (a test seam, or the deterministic-only edition): the
        // deterministic half is the whole step.
        steps.push({ key: 'catalog', status: 'ok', inputFingerprint: catalogFpOf() })
        opts.onStepDone?.(
          'catalog',
          `${externalsStep.declared.length} declared · ${externalsStep.unprovided.length} awaiting an account`,
        )
      }
    }
  }

  // ---- Step 4: interfaces — reconcile the cli disputes, author the web tasks.
  // SOFT: an authoring failure fails the STEP, never setup — the derived half of
  // the catalog is already on disk, and generate runs on whatever authored half
  // exists. Skip-when-settled needs BOTH halves settled: an unchanged place set
  // with the authored file missing (deleted, or a fresh clone that never
  // authored) is work, not a skip; `--replace` is an explicit re-author and
  // never skips either.
  if (enter('interfaces')) {
    const interfacesFp = interfacesFingerprint(repoRoot)
    const authoredExists = fs.existsSync(guardAuthoredInterfacesPath(repoRoot))
    if (replayed('interfaces')) {
      // Prior step: the merged catalog on disk — the derived half detect just
      // re-wrote, plus whatever authored half is committed — is what the later
      // steps read. No reconcile session, no authoring run.
      if (!ranBefore('interfaces')) {
        throw new SetupStepNotReadyError('interfaces', 'no interfaces row in guard/setup.json')
      }
      opts.onStepDone?.('interfaces', 'replayed — the authored catalog stands as it is')
    } else if (settled('interfaces') === interfacesFp && authoredExists && opts.replace !== true) {
      steps.push({ key: 'interfaces', status: 'skipped', reason: 'unchanged', inputFingerprint: interfacesFp })
      opts.onStepDone?.('interfaces', 'unchanged')
    } else if (opts.authorInterfaces) {
      const result = await opts.authorInterfaces({
        repoRoot,
        fingerprint: interfacesFp,
        refresh: opts.refresh === true,
        replace: opts.replace === true,
        recipe: reloadRecipe(repoRoot) ?? recipe,
        interfaces: mapped.interfaces,
        diagnostics: mapped.diagnostics,
      })
      steps.push({
        key: 'interfaces',
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
        inputFingerprint: interfacesFingerprint(repoRoot),
        ...(result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}),
        // The step row is where run reporting lands (diagnostics are NEVER
        // stored in the catalog, and 01-D left the CLI/dashboard silent on them).
        ...(result.diagnostics && result.diagnostics.length > 0 ? { diagnostics: result.diagnostics } : {}),
        ...(result.resolutions && result.resolutions.length > 0 ? { resolutions: result.resolutions } : {}),
        ...(result.changes && result.changes.length > 0 ? { changes: result.changes } : {}),
      })
      opts.onStepDone?.('interfaces', result.reason ?? result.status)
    } else {
      steps.push({
        key: 'interfaces',
        status: 'skipped',
        reason:
          'interface authoring is not wired into this run — run `truecourse guard interfaces author`, or inject the `authorInterfaces` seam (production does)',
        inputFingerprint: interfacesFp,
      })
      opts.onStepDone?.('interfaces', 'not wired into this run')
    }
  }

  // The recipe on disk may have changed under the catalog step (the skeleton is a
  // real write), so the seed drafts against the RELOADED one — its fingerprint has
  // already moved.
  const current = reloadRecipe(repoRoot) ?? recipe

  // ---- Step 5: the one seed — data AND auth. SOFT. -------------------------
  const seedFpOf = (): string =>
    seedFingerprint(computeRecipeFingerprint(repoRoot), dependenciesFileContent(repoRoot))
  let seedStep: GuardSetupSeedStep | undefined
  if (enter('seed')) {
    const seedFpPre = seedFpOf()
    if (replayed('seed')) {
      // Prior step: the seed the recipe declares (or the absence of one) is what
      // the auth step runs against. Nothing is drafted, nothing is replaced.
      if (!ranBefore('seed')) {
        throw new SetupStepNotReadyError('seed', 'no seed row in guard/setup.json')
      }
      opts.onStepDone?.('seed', 'replayed — the declared `api.seed` stands as it is')
    } else if (settled('seed') === seedFpPre) {
      const existingSeed = current.api?.seed
      seedStep = existingSeed
        ? {
            status: 'ok',
            outcome: 'exists',
            command: existingSeed.command,
            ...(existingSeed.script ? { scriptPath: existingSeed.script } : {}),
            ...declaredNames(existingSeed),
          }
        : { status: 'skipped', reason: 'unchanged since the last run, which drafted no seed either' }
      steps.push({ key: 'seed', status: 'skipped', reason: 'unchanged', inputFingerprint: seedFpPre })
      opts.onStepDone?.('seed', 'unchanged')
    } else {
      const schemes = collectSecuritySchemes(openApiDocs)
      const specProbes = collectProbeCandidates(openApiDocs)
      const seedRun = await runSeedStep({
        opts,
        recipe: current,
        database,
        routes: routesFromInterfaces(mapped.interfaces),
        schemes,
        // Spec-derived probes first (their security is stated); the mapped
        // operations fill in when the spec declares none, so a corpus with
        // markdown API docs still gets a lookup rather than a search.
        probeCandidates: specProbes.length > 0 ? specProbes : probeCandidatesFromInterfaces(mapped.interfaces),
        apiAuthEvidence: apiAuthEvidence({
          interfaces: mapped.interfaces,
          database,
          docs: corpusDocTexts(repoRoot),
          securitySchemes: schemes,
        }),
        requiredResources: requiredResources(mapped.interfaces),
        fingerprint: seedFpPre,
        onPhase: (running, done) => phases.enter({ running, done }),
      })
      seedStep = seedRun.step
      steps.push({
        key: 'seed',
        status: seedStep.status,
        ...(seedStep.reason ? { reason: seedStep.reason } : {}),
        // Post-write: a drafted seed moved recipe.json AND the script the recipe
        // fingerprint folds, so the settled value is the tree it left behind.
        inputFingerprint: seedFpOf(),
        ...(seedRun.sessionRunId ? { sessionRunId: seedRun.sessionRunId } : {}),
      })
      opts.onStepDone?.('seed', seedSummary(seedStep))
    }
  }

  // ---- Step 6: auth. Framework row only until plan step 14 wires it. -------
  // The ONE step that may end `blocked` (a supplied credential waiting on a user
  // registration) without demoting the run.
  if (enter('auth')) {
    const authFp = authFingerprint(repoRoot)
    if (settled('auth') === authFp) {
      steps.push({ key: 'auth', status: 'skipped', reason: 'unchanged', inputFingerprint: authFp })
      opts.onStepDone?.('auth', 'unchanged')
    } else if (opts.verifyAuth) {
      const result = await opts.verifyAuth({ repoRoot, recipe: reloadRecipe(repoRoot) ?? current, fingerprint: authFp })
      steps.push({
        key: 'auth',
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
        inputFingerprint: authFingerprint(repoRoot),
        ...(result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}),
      })
      opts.onStepDone?.('auth', result.reason ?? result.status)
    } else {
      steps.push({
        key: 'auth',
        status: 'skipped',
        reason:
          'auth verification is not wired into setup yet — supplied auth entries are checked at run time (plan step 14 wires the proof session here)',
        inputFingerprint: authFp,
      })
      opts.onStepDone?.('auth', 'not wired into setup yet')
    }
  }

  // The single-step MERGE: a run that ran one step must not erase the others'
  // record — `guard status`, the externals view and skip-when-settled all read
  // this file as a whole spine. Rows and blocks this run produced win; the rest
  // carry forward. Detect always runs, so the detection snapshot is never stale.
  const externals = externalsStep ?? (only ? prior?.externals : undefined)
  const seed = seedStep ?? (only ? prior?.seed : undefined)
  return {
    recipe: reloadRecipe(repoRoot) ?? current,
    report: {
      ranAt: new Date().toISOString(),
      status: 'ok',
      steps: only ? mergeStepSpine(steps, prior) : steps,
      recipe: recipeStep,
      ...(externals ? { externals } : {}),
      ...(seed ? { seed } : {}),
      ...(credentialSchemes.errors.length > 0 || credentialSchemes.warnings.length > 0
        ? { credentialSchemes }
        : {}),
      detection: {
        externalServices: detectedExternals,
        database: database
          ? { type: database.type, driver: database.driver, tables: database.tables.length }
          : null,
        datastoreUrls,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Skip-when-settled: the step fingerprints (plan 03 step 8)
// ---------------------------------------------------------------------------

/**
 * The spine a SINGLE-STEP run persists: this run's rows, plus the previous
 * report's row for every step it did not touch, in taxonomy order. Without the
 * carry-forward a `--only-seed` run would leave a one-row spine, and the next
 * bare setup would re-derive the recipe and re-classify the catalog for nothing.
 */
function mergeStepSpine(
  fresh: readonly GuardSetupTaxonomyStep[],
  prior: GuardSetupReport | null,
): GuardSetupTaxonomyStep[] {
  const byKey = new Map(fresh.map((row) => [row.key, row]))
  const out: GuardSetupTaxonomyStep[] = []
  for (const { key } of GUARD_SETUP_STEPS) {
    const row = byKey.get(key) ?? (prior?.steps ?? []).find((r) => r.key === key)
    if (row) out.push(row)
  }
  return out
}

/**
 * sha256 over the present ecosystem manifests, path-tagged like the runner's —
 * the runner's own `FINGERPRINT_INPUTS` list (the recipe file itself is folded
 * separately by `computeRecipeFingerprint`, which is exactly why it is not
 * hashed here: the recipe step re-runs when the SUBJECT moved, not when its
 * own output moved). Exported for the pre-flight estimate's settled check.
 */
export function ecosystemFingerprint(repoRoot: string): string {
  const hash = createHash('sha256')
  for (const rel of FINGERPRINT_INPUTS) {
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
    hash.update(rel)
    hash.update('\0')
    hash.update(fs.readFileSync(abs))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** The detection snapshot as one canonical string — services sorted by name so
 *  mapping order can never move a fingerprint. */
function canonicalDetectionJson(
  detected: readonly DetectedExternalService[],
  database: SeedDraftDatabase | null,
  datastoreUrls: readonly DatastoreUrlRef[],
): string {
  return JSON.stringify({
    externalServices: [...detected].sort((a, b) => a.service.localeCompare(b.service)),
    database: database ? { type: database.type, driver: database.driver, tables: database.tables.length } : null,
    datastoreUrls: [...datastoreUrls].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })
}

/** `scenarios/dependencies.json` raw content, `''` when absent — a fingerprint
 *  input, so a hand-edited catalog re-runs the steps that read it. */
function dependenciesFileContent(repoRoot: string): string {
  try {
    return fs.readFileSync(dependenciesPath(repoRoot), 'utf-8')
  } catch {
    return ''
  }
}

function catalogFingerprint(detectionJson: string, recipeFingerprint: string, depsContent: string): string {
  return createHash('sha256').update(`${detectionJson}::${recipeFingerprint}::${depsContent}`).digest('hex')
}

/**
 * The catalog session's COMMITTABLE settle record — `scenarios/dependencies.settle.json`,
 * a sibling of the catalog it settles. Committed (and carried by any seedstore
 * that carries `scenarios/`) so a fresh checkout inherits the verdict "these
 * session inputs were already classified" instead of re-running the session.
 * Deliberately folded into NO other fingerprint: it is bookkeeping about the
 * catalog, not part of it.
 */
function catalogSettlePath(repoRoot: string): string {
  return path.join(path.dirname(dependenciesPath(repoRoot)), 'dependencies.settle.json')
}

function readCatalogSettle(repoRoot: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogSettlePath(repoRoot), 'utf-8')) as {
      catalogSessionFingerprint?: unknown
    }
    return typeof parsed.catalogSessionFingerprint === 'string' ? parsed.catalogSessionFingerprint : null
  } catch {
    return null
  }
}

function writeCatalogSettle(repoRoot: string, fingerprint: string): void {
  fs.writeFileSync(
    catalogSettlePath(repoRoot),
    `${JSON.stringify({ catalogSessionFingerprint: fingerprint }, null, 2)}\n`,
    'utf-8',
  )
}

/** Sorted derived web place `(id, address)` pairs :: the recipe fingerprint —
 *  the interfaces step re-runs when a screen appeared, moved, or vanished.
 *  Exported for the pre-flight estimate's settled check. */
export function interfacesFingerprint(repoRoot: string): string {
  const catalog = readInterfaceCatalog(repoRoot)
  const pairs = (catalog?.resources?.['web'] ?? [])
    .map((place) => `${place.id}\x00${place.address ?? ''}`)
    .sort()
  return createHash('sha256')
    .update(`${pairs.join('\n')}::${computeRecipeFingerprint(repoRoot)}`)
    .digest('hex')
}

function seedFingerprint(recipeFingerprint: string, depsContent: string): string {
  const depsHash = createHash('sha256').update(depsContent).digest('hex')
  return createHash('sha256').update(`${recipeFingerprint}::${depsHash}`).digest('hex')
}

/** The seed step's fingerprint off the tree as it stands — the estimate's
 *  settled check, and the exact value the running step computes. */
export function computeSeedStepFingerprint(repoRoot: string): string {
  return seedFingerprint(computeRecipeFingerprint(repoRoot), dependenciesFileContent(repoRoot))
}

/** The catalog's SUPPLIED entries, canonically — what the auth step consumes. A
 *  catalog that does not parse fingerprints as its raw bytes (still moves when
 *  it moves; never throws here). Exported for the estimate's settled check. */
export function authFingerprint(repoRoot: string): string {
  const raw = dependenciesFileContent(repoRoot)
  let material = raw
  try {
    const parsed = JSON.parse(raw || '{}') as { dependencies?: { class?: string }[] }
    if (Array.isArray(parsed.dependencies)) {
      material = JSON.stringify(parsed.dependencies.filter((d) => d?.class === 'supplied'))
    }
  } catch {
    // fall through to the raw bytes
  }
  return createHash('sha256').update(`auth::${material}`).digest('hex')
}

/**
 * The prior run's settled fingerprints, per step. A row settles when it ran
 * `ok` — or when it was itself a `skipped`/`unchanged` carry-forward of an
 * earlier `ok`, so a third run does not bounce back to re-running. `blocked`
 * and every real `skipped` reason never settle: those steps re-evaluate every
 * run (cheaply — their gates refuse again) until the state moves.
 *
 * Exported for the pre-flight estimate, which probes the SAME settled rows the
 * run will skip on.
 */
export function settledFingerprints(
  repoRoot: string,
  refresh: boolean,
): (key: GuardSetupTaxonomyKey) => string | null {
  if (refresh) return () => null
  const prior = readGuardSetup(repoRoot)
  const byKey = new Map<GuardSetupTaxonomyKey, string>()
  for (const row of prior?.steps ?? []) {
    if (row.status === 'ok' || (row.status === 'skipped' && row.reason === 'unchanged')) {
      byKey.set(row.key, row.inputFingerprint)
    }
  }
  return (key) => byKey.get(key) ?? null
}

/** The catalog step's one-line detail: the skeleton's account + the session's. */
function catalogSummary(
  externals: GuardSetupExternalsStep,
  session: GuardSetupCatalogSessionResult,
): string {
  const head = `${externals.declared.length} declared · ${externals.unprovided.length} awaiting an account`
  if (session.status === 'failed') return `${head} · catalog session failed: ${firstReasonLine(session.reason)}`
  const source = session.fromCache ? ' (cached)' : ''
  return `${head} · ${session.added.length} catalog entr${session.added.length === 1 ? 'y' : 'ies'}${source}`
}

function firstReasonLine(reason: string): string {
  return reason.split('\n')[0]?.trim() ?? reason
}

/** The recipe blocks discovery never proposes — the user's and setup's own work. */
interface AuthoredBlocks {
  seed?: unknown
  externals?: unknown
  credentials?: unknown
  ownHosts?: unknown
}

/** Capture them, or `null` when there is no recipe (nothing to preserve). */
function authoredBlocks(recipe: Recipe | null): AuthoredBlocks | null {
  if (!recipe) return null
  const api = recipe.api
  const blocks: AuthoredBlocks = {
    ...(api?.seed !== undefined ? { seed: api.seed } : {}),
    ...(api?.externals !== undefined ? { externals: api.externals } : {}),
    ...(api?.credentials !== undefined ? { credentials: api.credentials } : {}),
    ...(recipe.ownHosts !== undefined ? { ownHosts: recipe.ownHosts } : {}),
  }
  return Object.keys(blocks).length > 0 ? blocks : null
}

/**
 * Merge the captured blocks back into the freshly written recipe, re-validating the
 * WHOLE result. Returns the merged recipe, or `null` when the merge could not be
 * applied — in which case the caller keeps the derived recipe and the run carries on
 * (a refresh that cannot restore is a visible loss in `git diff`, never a crash).
 */
function restoreAuthoredBlocks(repoRoot: string, blocks: AuthoredBlocks): Recipe | null {
  const file = recipePath(repoRoot)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (blocks.ownHosts !== undefined) doc.ownHosts = blocks.ownHosts
  const api = doc.api as Record<string, unknown> | undefined
  if (api && typeof api === 'object') {
    if (blocks.seed !== undefined) api.seed = blocks.seed
    if (blocks.externals !== undefined) api.externals = blocks.externals
    if (blocks.credentials !== undefined) api.credentials = blocks.credentials
  }
  const validated = RecipeSchema.safeParse(doc)
  if (!validated.success) return null
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + (raw.endsWith('\n') ? '\n' : ''))
  return validated.data
}

// ---------------------------------------------------------------------------
// Step 3 — the externals skeleton write
// ---------------------------------------------------------------------------

/**
 * Derive the skeleton and, when it adds anything, patch `api.externals` into
 * `recipe.json`. The recipe is parsed, patched, and re-serialized in ITS OWN format
 * so the diff a reviewer reads is the declaration block and nothing else, and the
 * WHOLE result is re-validated before it lands.
 *
 * SOFT throughout: a recipe with no `api` block, an unparseable file, a write that
 * would invalidate the recipe — each is a reported `skipped`/`failed` step, never a
 * reason to abandon a run whose hard gate already held.
 */
function applyExternalsSkeleton(
  repoRoot: string,
  recipe: Recipe,
  detected: readonly DetectedExternalService[],
): GuardSetupExternalsStep {
  const base = { declared: [] as string[], alreadyDeclared: [] as string[], undeclarable: [] as string[] }
  if (!recipe.api) {
    return {
      ...base,
      status: 'skipped',
      reason: 'the recipe has no `api` block — external services configure the api driver',
      unprovided: [],
    }
  }
  const skeleton = deriveExternalsSkeleton(recipe, detected)
  const added = Object.keys(skeleton.declare).sort()
  if (added.length > 0) {
    const written = writeExternals(repoRoot, skeleton.declare)
    if (written !== null) {
      return {
        status: 'failed',
        reason: written,
        declared: [],
        alreadyDeclared: skeleton.alreadyDeclared,
        undeclarable: skeleton.undeclarable,
        unprovided: unprovidedServices(repoRoot, recipe),
      }
    }
  }
  return {
    status: 'ok',
    declared: added,
    alreadyDeclared: skeleton.alreadyDeclared,
    undeclarable: skeleton.undeclarable,
    unprovided: unprovidedServices(repoRoot, reloadRecipe(repoRoot) ?? recipe),
  }
}

/** Patch the declarations in; returns `null` on success or the refusal reason. */
function writeExternals(repoRoot: string, declare: Record<string, RecipeApiExternal>): string | null {
  const file = recipePath(repoRoot)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch (e) {
    return `recipe.json could not be read: ${(e as Error).message}`
  }
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(raw) as Record<string, unknown>
  } catch (e) {
    return `recipe.json is not valid JSON: ${(e as Error).message}`
  }
  const api = doc.api as Record<string, unknown> | undefined
  if (!api || typeof api !== 'object') return 'recipe.json has no `api` block'
  const externals = { ...((api.externals as Record<string, RecipeApiExternal>) ?? {}), ...declare }
  api.externals = Object.fromEntries(Object.keys(externals).sort().map((k) => [k, externals[k]]))
  const validated = RecipeSchema.safeParse(doc)
  if (!validated.success) {
    return `declaring the detected services would make recipe.json invalid: ${validated.error.issues
      .map((i) => `${i.path.join('.')} ${i.message}`)
      .join('; ')}`
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + (raw.endsWith('\n') ? '\n' : ''))
  return null
}

/** Declared services with nothing resolvable behind them yet — the honest to-do list. */
function unprovidedServices(repoRoot: string, recipe: Recipe): string[] {
  try {
    return loadResolvedExternals(repoRoot, recipe.api?.externals)
      .filter((e) => e.state !== 'provided')
      .map((e) => e.service)
      .sort()
  } catch {
    // A broken overlay is the externals command's problem to report, not a reason
    // for the setup record to be wrong — report nothing rather than something false.
    return []
  }
}

// ---------------------------------------------------------------------------
// Step 4 — the one seed
// ---------------------------------------------------------------------------

async function runSeedStep(args: {
  opts: GuardSetupOptions
  recipe: Recipe
  database: SeedDraftDatabase | null
  routes: readonly ApiRouteRef[]
  schemes: { name: string; summary: string }[]
  probeCandidates: ProbeCandidate[]
  apiAuthEvidence: ApiAuthEvidence[]
  requiredResources: RequiredResource[]
  /** The step's PRE-RUN fingerprint — the seed session's cache key. */
  fingerprint: string
  onPhase: (running: string, done: string) => void
}): Promise<{ step: GuardSetupSeedStep; sessionRunId?: string }> {
  const { opts, recipe, database, routes, schemes } = args
  const existing = recipe.api?.seed

  // Idempotence: a repo that already has a seed and did not ask for a refresh is
  // REPORTED, not re-drafted. That is the whole "bare setup no-ops" contract.
  if (existing && !opts.refresh) {
    return {
      step: {
        status: 'ok',
        outcome: 'exists',
        command: existing.command,
        ...(existing.script ? { scriptPath: existing.script } : {}),
        ...declaredNames(existing),
      },
    }
  }

  let replaceExisting = false
  if (existing) {
    // `--refresh` is not consent to overwrite a hand-edited script; the caller is
    // asked, and a non-TTY caller answers false.
    replaceExisting = (await opts.confirmSeedReplace?.()) ?? false
    if (!replaceExisting) {
      return {
        step: {
          status: 'skipped',
          outcome: 'exists',
          reason:
            'the recipe already declares `api.seed` and replacing it was not confirmed — the existing seed script is untouched',
          command: existing.command,
          ...(existing.script ? { scriptPath: existing.script } : {}),
          ...declaredNames(existing),
        },
      }
    }
  }

  // The cheap refusals BEFORE anything is drafted, so the reason a user reads is the
  // real one (no api block, no schema) rather than a session failure downstream.
  const gate = seedDraftGate({
    recipe,
    database,
    ...(replaceExisting ? { replaceExisting: true } : {}),
  })
  if (!gate.ok) return { step: { status: 'skipped', reason: gate.reason } }
  // Narrowed by the gate; restated for the type checker.
  if (!database) return { step: { status: 'skipped', reason: 'gate' } }

  // THE SEED SESSION (plan 03 step 13) — the one-shot `draftSeed` retired into
  // an agent session that PROVES its draft by execution. The seam owns the
  // whole lifecycle (services up, the session, the fold's fresh-world gate);
  // this step gathers the briefing inputs, which are exactly the old draft's.
  if (!opts.seedSession) {
    return {
      step: {
        status: 'skipped',
        reason:
          'the seed session is not wired into this run — inject `seedSession` (production does), or declare `api.seed` by hand',
      },
    }
  }

  const result = await opts.seedSession({
    repoRoot: opts.repoRoot,
    recipe,
    database,
    routes: routes.map((r) => ({ method: r.method, path: r.path })),
    securitySchemes: schemes,
    probeCandidates: args.probeCandidates,
    apiAuthEvidence: args.apiAuthEvidence,
    requiredResources: args.requiredResources,
    roles: detectRoleColumns(database),
    specExcerpts: readSpecExcerpts(opts.repoRoot),
    ecosystem: detectEcosystems(opts.repoRoot)[0] ?? 'js',
    replaceExisting,
    ...(replaceExisting && existing
      ? (() => {
          const script = readExistingSeedScript(opts.repoRoot, recipe)
          return script ? { existingScript: script } : {}
        })()
      : {}),
    fingerprint: args.fingerprint,
    onPhase: args.onPhase,
  })

  if (result.status === 'ok') {
    const written = reloadRecipe(opts.repoRoot)?.api?.seed
    return {
      step: {
        status: 'ok',
        outcome: 'drafted',
        scriptPath: result.scriptPath,
        command: result.command,
        ...(result.fixtures && result.fixtures.length > 0 ? { fixtures: result.fixtures } : {}),
        ...(result.credentials && result.credentials.length > 0 ? { credentials: result.credentials } : {}),
        ...(result.salvaged ? { salvaged: true } : {}),
        // Trust the recipe on disk over the seam's echo when both exist.
        ...(written ? declaredNames(written) : {}),
      },
      ...(result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}),
    }
  }
  return {
    step: { status: result.status, reason: result.reason },
    ...(result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}),
  }
}

/** The fixture/credential names a seed declares, sorted, omitted when empty. */
function declaredNames(seed: {
  provides: { fixtures?: Record<string, unknown>; credentials?: Record<string, unknown> }
}): { fixtures?: string[]; credentials?: string[] } {
  const fixtures = Object.keys(seed.provides.fixtures ?? {}).sort()
  const credentials = Object.keys(seed.provides.credentials ?? {}).sort()
  return {
    ...(fixtures.length > 0 ? { fixtures } : {}),
    ...(credentials.length > 0 ? { credentials } : {}),
  }
}

/**
 * Short excerpts of the curated specs — the ROLE and PRINCIPAL language the schema
 * cannot supply. Deliberately bounded and deliberately dumb (the head of each doc):
 * the schema stays the authority on what is creatable, and this only has to tell the
 * model that "org owner" and "member" are words this product uses.
 */
/** Every kept corpus doc's FULL text — the evidence scan reads whole documents,
 *  where the briefing's excerpts stop after the first screen. */
export function corpusDocTexts(repoRoot: string): { doc: string; text: string }[] {
  const out: { doc: string; text: string }[] = []
  for (const ref of readCorpusAreaTags(repoRoot).keys()) {
    try {
      out.push({ doc: ref, text: fs.readFileSync(path.resolve(repoRoot, ref), 'utf-8') })
    } catch {
      continue
    }
  }
  return out
}

export function readSpecExcerpts(repoRoot: string): { doc: string; text: string }[] {
  const out: { doc: string; text: string }[] = []
  for (const ref of readCorpusAreaTags(repoRoot).keys()) {
    if (out.length >= MAX_SPEC_EXCERPTS) break
    let content: string
    try {
      content = fs.readFileSync(path.resolve(repoRoot, ref), 'utf-8')
    } catch {
      continue
    }
    out.push({ doc: ref, text: content.slice(0, SPEC_EXCERPT_CHARS) })
  }
  return out
}

/** The corpus's OpenAPI security schemes as the prompt's CLOSED SET of names. */
export function collectSecuritySchemes(
  docs: readonly { doc: string; content: string }[],
): { name: string; summary: string }[] {
  const byName = new Map<string, string>()
  for (const { content } of docs) {
    const parsed = parseOpenApiSpec(content)
    for (const [name, scheme] of Object.entries(parseSecuritySchemes(parsed))) {
      if (!byName.has(name)) byName.set(name, summarizeScheme(scheme))
    }
  }
  return [...byName].sort(([a], [b]) => a.localeCompare(b)).map(([name, summary]) => ({ name, summary }))
}

function summarizeScheme(scheme: SecurityScheme): string {
  if (scheme.type === 'apiKey') return `apiKey in ${scheme.in ?? 'header'} named ${scheme.name ?? '(unnamed)'}`
  if (scheme.type === 'http') return `http ${scheme.scheme ?? '(unspecified)'}`
  return scheme.type
}

// ---------------------------------------------------------------------------
// The live phase line
// ---------------------------------------------------------------------------

/** One live phase: what to show while it runs, and what to call it once it has. */
interface StepPhase {
  running: string
  done: string
}

/**
 * The running step's live detail. Each phase replaces the last, and the one it
 * replaced is stated with how long it took — so the line reads "what just finished,
 * and what is happening now". There is no clock: every line is written by a real
 * transition, so a caller re-renders only when something actually changed.
 */
function stepPhases(opts: GuardSetupOptions): {
  /** Move to a step; the previous step's phases never leak onto it. */
  step: (key: GuardSetupStepKey) => void
  /** A new phase starts. */
  enter: (phase: StepPhase) => void
  /** A counter moves WITHIN the current phase — same phase, same start time. */
  tick: (running: string) => void
} {
  let stepKey: GuardSetupStepKey = 'recipe'
  let active: { done: string; startedAt: number } | null = null
  let prefix = ''
  let running = ''
  const paint = (): void => opts.onStepDetail?.(stepKey, `${prefix}${running}`)
  return {
    step(key) {
      stepKey = key
      active = null
      prefix = ''
      running = ''
    },
    enter(phase) {
      prefix = active ? `${active.done} ${formatElapsed(Date.now() - active.startedAt)} · ` : ''
      active = { done: phase.done, startedAt: Date.now() }
      running = phase.running
      paint()
    },
    tick(next) {
      if (!active) return
      running = next
      paint()
    },
  }
}

/** Discovery's phases, in the words a reader of the terminal needs. */
function recipePhase(phase: RecipeDiscoveryPhase): StepPhase {
  if (phase.kind === 'proposing') {
    return phase.after
      ? { running: `revising after a failed ${phase.after}`, done: 'revision' }
      : { running: 'asking the model for a recipe', done: 'model proposal' }
  }
  const verb = phase.revision ? 're-verifying' : 'verifying'
  const server = phase.server ? ` (${phase.server})` : ''
  return { running: `${verb}: ${phase.stage}${server}`, done: phase.stage }
}

/** Elapsed as "Ns" under a minute, "Nm Ns" over it. */
function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min === 0 ? `${sec}s` : `${min}m ${sec}s`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The recipe as it is on disk right now — steps 3 and 4 both write to it. */
function reloadRecipe(repoRoot: string): Recipe | null {
  try {
    return loadRecipe(repoRoot, recipePath(repoRoot))?.recipe ?? null
  } catch {
    return null
  }
}

/** A failure of step 0.5 or the recipe gate — nothing downstream ran, and the
 *  spine carries only the rows the run reached. */
function failed(
  reason: string,
  parts: { recipe?: GuardSetupRecipeStep; steps?: GuardSetupTaxonomyStep[] } = {},
): GuardSetupResult {
  return {
    recipe: null,
    report: {
      ranAt: new Date().toISOString(),
      status: 'failed',
      reason,
      steps: parts.steps ?? [],
      recipe: parts.recipe ?? { status: 'skipped', reason },
    },
  }
}

/** The interface mapping, degraded to "nothing detected" rather than a failed setup. */
async function mapSafely(provider?: GuardSetupInterfaceProvider): Promise<{
  interfaces: Interface[]
  externalServices: DetectedExternalService[]
  database: SeedDraftDatabase | null
  datastoreUrls: DatastoreUrlRef[]
  diagnostics: MapperDiagnostic[]
}> {
  const empty = {
    interfaces: [],
    externalServices: [],
    database: null,
    datastoreUrls: [],
    diagnostics: [],
  }
  if (!provider) return empty
  try {
    const mapped = await provider()
    return {
      interfaces: mapped.interfaces,
      externalServices: mapped.externalServices ?? [],
      database: mapped.database ?? null,
      datastoreUrls: mapped.datastoreUrls ?? [],
      diagnostics: mapped.diagnostics ?? [],
    }
  } catch {
    return empty
  }
}

function recipeSummary(step: GuardSetupRecipeStep, probes: readonly GuardSetupServerProbe[]): string {
  const head = step.outcome === 'discovered' ? `wrote ${step.wrotePath} (${step.source})` : 'already present'
  if (probes.length === 0) return head
  const reached = probes.map((p) => `${p.server} ${p.path} → ${p.status ?? '—'}`).join(' · ')
  return `${head} · ${reached}`
}

function detectSummary(externals: readonly DetectedExternalService[], database: SeedDraftDatabase | null): string {
  const parts = [`${externals.length} external service${externals.length === 1 ? '' : 's'}`]
  parts.push(database ? `${database.driver} (${database.tables.length} tables)` : 'no database')
  return parts.join(' · ')
}

function seedSummary(step: GuardSetupSeedStep): string {
  if (step.status !== 'ok') return step.reason ?? 'skipped'
  const parts: string[] = [step.outcome === 'drafted' ? `wrote ${step.scriptPath}` : 'already present']
  if (step.fixtures?.length) parts.push(`${step.fixtures.length} fixture${step.fixtures.length === 1 ? '' : 's'}`)
  if (step.credentials?.length) {
    parts.push(`${step.credentials.length} principal${step.credentials.length === 1 ? '' : 's'}`)
  }
  if (step.salvaged) parts.push('salvaged from a session that produced no outcome')
  return parts.join(' · ')
}
