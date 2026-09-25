/**
 * Flow setup — the CHEAP preparation stage that runs between the Document scan
 * and Flow generation.
 *
 * Every environment fact guard needs used to be discovered as a byproduct of the most
 * expensive stage in the product, and FIXING any of them edits `recipe.json`, which
 * moves the recipe fingerprint, which re-authors sections that were already good.
 * Setup makes all of it knowable and fixable before the first extraction call.
 *
 * The steps, in order, and what each may do to the run:
 *   0    an LLM provider must be configured        — the CALLER's check (config lives
 *                                                    above this package); the adapter
 *                                                    fails before calling in.
 *   0.5  a corpus must exist                       — HARD: setup runs after scan.
 *   1    the recipe                                — HARD. A repo with none gets
 *                                                    discovery (deterministic → the
 *                                                    repair session or the one-shot
 *                                                    LLM → verify by running); a repo
 *                                                    that has one gets the NEEDS
 *                                                    comparison instead, and a scoped
 *                                                    repair only when the recipe does
 *                                                    not provide what the code needs.
 *                                                    Either way, a live endpoint probe
 *                                                    per declared server.
 *   2    detect                                    — one `mapInterfaces` pass; free.
 *   3    the catalog                               — SOFT. The externals declaration
 *                                                    skeleton (det) + the
 *                                                    dependency-catalog session seam.
 *   4    the one seed (data AND auth)              — SOFT, never blocks. The seed
 *                                                    authoring session (`seedSession`).
 *   5    interfaces                                — SOFT. The cli reconcile session
 *                                                    over the union's disputes, then
 *                                                    the web-task authoring run
 *                                                    (both behind `authorInterfaces`),
 *                                                    which opens the app's screens
 *                                                    signed in as a seeded principal
 *                                                    — hence after the seed.
 *   5.5  private preparations                      — HARD on execution failure;
 *                                                    unsupported profiles may skip.
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
 * (`skipped`/`unchanged`). That spine is written at every step boundary, not
 * only when the run ends, so a run that stops part-way — an empty balance, a
 * killed process — is carried on from what it reached rather than paying for
 * those steps again. `refresh` forces every step. A seed the engine drafted and
 * nobody has edited since is re-drafted whenever its step re-opens; replacing
 * any OTHER seed needs `refresh` and `confirmSeedReplace` to answer true, and a
 * caller that cannot ask answers false — a hand-edited seed script is never
 * clobbered by an option.
 *
 * SINGLE-STEP MODE (`only`): run one LLM-bearing
 * step in isolation — prior steps replay from what they left on disk (never a
 * session, never the live probe; a step nobody ever ran fails loud with
 * {@link SetupStepNotReadyError}), later steps never start, and `guard/setup.json`
 * is MERGED so the steps that did not run this time keep their record. See
 * {@link GuardSetupOptions.only}.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import {
  loadRecipe,
  recipePath,
  buildRouteManifest,
  loadResolvedExternals,
  computeRecipeFingerprint,
  computePreparationFingerprint,
  legacyPreparationFingerprint,
  preparationFingerprintComponents,
  recipeContractFingerprint,
  authoringRecipeContract,
  dependencyCatalogIdentity,
  preparationCatalog,
  dependenciesPath,
  loadDependencyCatalog,
  atomicWriteJson,
  guardAuthoredInterfacesPath,
  hashableRecipeText,
  readGuardSetup,
  writeGuardSetup,
  readInterfaceCatalog,
  readAuthoredInterfaceCatalog,
  webScreensNeedingAuthoring,
  canObserveLiveScreens,
  resolveSeedScript,
  FINGERPRINT_INPUTS,
  RecipeSchema,
  type Recipe,
  type RecipeApiExternal,
} from '@truecourse/guard-runner'
import { parseSecuritySchemes, parseOpenApiSpec, type SecurityScheme } from '@truecourse/shared/openapi'
import { WORK_TREE_DIR } from '@truecourse/shared/work-tree'
import type {
  DatastoreUrlRef,
  DetectedExternalService,
  GuardSetupExternalsStep,
  GuardSetupFailedScreen,
  GuardSetupInterfaceResolution,
  GuardSetupRecipeStep,
  GuardSetupReport,
  GuardSetupSeedStep,
  GuardSetupServerProbe,
  GuardSetupTaxonomyKey,
  GuardSetupTaxonomyStep,
  GuardSetupUnprovidedNeed,
  Interface,
  MapperDiagnostic,
} from '@truecourse/shared'
import { movedNamedInputs, movedSchemeInputs } from '@truecourse/shared'
import { GUARD_COMPOSE_FILE } from './datastore-compose.js'
import {
  discoverRecipe,
  repairExistingRecipe,
  type RecipeDiscoveryPhase,
  type RecipeRepairFn,
  type RepairExistingRecipeResult,
} from './recipe-discovery.js'
import {
  needsFingerprint,
  parseDetectionSnapshot,
  recipeNeeds,
  recipeNeedsDiff,
  recipeNeedsOf,
  type DetectedWorld,
  type UnprovidedNeed,
} from './recipe-needs.js'
import { detectEcosystems, routesFromInterfaces, type ApiRouteRef } from './recipe-propose.js'
import { probeApiServers } from './endpoint-probe.js'
import { deriveExternalsSkeleton } from './externals-skeleton.js'
import { extendCredentialRegistrations } from './credential-registrations.js'
import {
  SEED_STAGE_VERSION,
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
import type { RecipeRunner } from './leaf-seams.js'

const execFileAsync = promisify(execFile)

/** How many spec docs the seed draft is shown, and how much of each. */
const MAX_SPEC_EXCERPTS = 6
const SPEC_EXCERPT_CHARS = 1500

// ---------------------------------------------------------------------------
// Single-step mode (`only`)
// ---------------------------------------------------------------------------

/**
 * The setup steps that may spend an LLM session, in spine order — the ones
 * `only` selects from. `detect` is NOT one of them: it is one
 * deterministic `mapInterfaces` pass whose in-memory output every later step
 * reads, so it always runs and the detection snapshot is always this run's.
 */
export const GUARD_SETUP_ONLY_STEPS = ['recipe', 'catalog', 'seed', 'interfaces', 'preparations', 'auth'] as const
export type GuardSetupOnlyStep = (typeof GUARD_SETUP_ONLY_STEPS)[number]

/**
 * A single-step run found a PRIOR step's evidence missing: replaying it would
 * mean spending the sessions (or the boot, or the probe) that belong to that
 * step's OWN turn. Deliberately loud — silently running it is exactly the
 * blurring a stepwise run exists to prevent. The fix is always a setup run
 * with `only` set to that step.
 */
export class SetupStepNotReadyError extends Error {
  constructor(
    readonly step: GuardSetupOnlyStep,
    /** What is missing, in the words the user has to act on. */
    readonly missing: string,
  ) {
    super(
      `the ${step} step has not run (${missing}) — run it without \`only\` first`,
    )
    this.name = 'SetupStepNotReadyError'
  }
}

export interface GuardSetupOptions {
  repoRoot: string
  /**
   * The identity of the docker WORLD this repository's runs share: the
   * workspace and the repository together (`<org>/<owner>/<repo>`), when the
   * caller has one. Recipe discovery names the compose project after it, so
   * every run of the pair shares one project whatever directory it was cloned
   * into, and no other pair's `reset` reaches its volumes. Absent ⇒ the
   * checkout directory's own name.
   */
  composeKey?: string
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
   * The exception to the merge is a recipe failure in `only: 'recipe'`:
   * a failed run reports the rows it reached and nothing else, exactly as a
   * whole run does — a recipe that no longer holds is no basis for calling the
   * steps that were computed against it settled.
   */
  only?: GuardSetupOnlyStep
  /**
   * Asked ONCE, and only when a refresh would REPLACE an existing `api.seed`
   * the engine did not draft (or that was edited since). A seed script is a
   * human-reviewed artifact of the repo's setup bundle: `refresh` alone is not
   * consent, and a caller that cannot ask answers false, so an option can
   * never clobber a hand-edited script.
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
  /**
   * One thing this step did, in the engine's own words. Appended; never a count
   * `onStepDetail` already carries. A step's facts name the services it detected,
   * the routes it probed, the catalog entries it classified, the seed it proved,
   * and say "from cache" whenever a cache or a settle fingerprint answered
   * instead of a session or a computation.
   */
  onStepFact?: (step: GuardSetupStepKey, line: string) => void
  // --- the session seams ---
  /**
   * The recipe-repair session (step 9), in both situations that reach it: the
   * failure path of discovery for a repo with no recipe, and the SCOPED repair
   * of a standing one the needs comparison found wanting. Absent ⇒ discovery
   * falls back to the one-turn `recipeRunner` proposal, and an unprovided need is
   * reported and left standing rather than repaired.
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
   * The interfaces step body: the cli reconcile session over the mapping's
   * diagnostics, then the web-task authoring run. Runs after the seed step, so
   * `recipe` carries the seed the authoring signs its browser in with.
   * Absent ⇒ the step reports a `skipped` placeholder row.
   */
  authorInterfaces?: GuardSetupInterfacesStep
  /**
   * The seed authoring session. Replaces the one-shot
   * `draftSeed`; absent ⇒ the seed step reports a `skipped` placeholder row
   * (the gate and the replace-confirmation still run first, here).
   */
  seedSession?: GuardSetupSeedSession
  preparationSession?: GuardSetupPreparationSession
  /**
   * The auth-proof session over the catalog's supplied entries. Absent ⇒ the
   * step reports a `skipped` placeholder row. Its result may
   * be `blocked` — the one step allowed to end that way without failing setup.
   */
  verifyAuth?: GuardSetupAuthStep
  // --- test seams ---
  /** Test seam for step 1's live probe; production boots the real server. */
  probe?: typeof probeApiServers
}

/** Stable step taxonomy for the progress tracker —
 *  recipe → detect → catalog → seed → interfaces → preparations → auth
 *  (the old externals step folded INTO catalog). */
export const GUARD_SETUP_STEPS = [
  { key: 'recipe', label: 'Deriving the recipe' },
  { key: 'detect', label: 'Detecting dependencies' },
  { key: 'catalog', label: 'Cataloguing dependencies' },
  { key: 'seed', label: 'Preparing data + principals' },
  { key: 'interfaces', label: 'Authoring the interface catalog' },
  { key: 'preparations', label: 'Verifying private starting states' },
  { key: 'auth', label: 'Verifying supplied auth' },
] as const

export type GuardSetupStepKey = (typeof GUARD_SETUP_STEPS)[number]['key']

// ---------------------------------------------------------------------------
// The session seams — typed here (the engine cannot depend on `@truecourse/core`,
// which owns the sessions), injected by the command adapter.
// ---------------------------------------------------------------------------

/** What the dependency-catalog session is briefed on. */
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
  /** The same fingerprint under the formula the key used to fold, for the OLD
   *  key a miss falls back to. Delete with the legacy hash. */
  legacyFingerprint: string
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
 * union's tree-vs-probe disputes). Structural and optional,
 * so every existing provider (which simply omits the field) still fits, and
 * the field never enters the snapshot — it is run reporting the interfaces
 * step consumes.
 */
export type GuardSetupInterfaceProvider = () => Promise<
  Awaited<ReturnType<InterfaceProvider>> & { diagnostics?: MapperDiagnostic[] }
>

/** The interfaces step's seam: reconcile, then author. */
export interface GuardSetupInterfacesStepInput {
  repoRoot: string
  fingerprint: string
  refresh: boolean
  /** Re-author places that already carry authored tasks (the `replace` option). */
  replace: boolean
  /** The recipe as it stands on disk when the step runs — the seed step's write included. */
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
  /** Re-authored tasks whose key moved through a reworded label alone. */
  labelRekeys?: number
  /** Screens whose authoring has not settled — they retry on a refresh, or when
   *  their own inputs move, and never merely because a setup ran again. */
  failedScreens?: GuardSetupFailedScreen[]
  /** The reconcile session's per-subject verdicts, when one ran. */
  resolutions?: GuardSetupInterfaceResolution[]
  /** The catalog edits the resolutions produced, one line each. */
  changes?: string[]
  /** True when the reconcile session's verdicts came out of the cache rather
   *  than out of a session this run spent. Absent when no reconcile ran. */
  reconcileFromCache?: boolean
}
export type GuardSetupInterfacesStep = (
  input: GuardSetupInterfacesStepInput,
) => Promise<GuardSetupInterfacesStepResult>

/** What the seed authoring session is briefed on — today's
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
  specExcerpts: { doc: string; text: string }[]
  /** The repo's ecosystem — decides the drafted script's language/extension. */
  ecosystem: string
  /** The caller confirmed replacing the existing `api.seed`. */
  replaceExisting: boolean
  /** The script being replaced, quoted so the draft improves on it. */
  existingScript?: { scriptPath: string; scriptContent: string }
  /** The seed step's PRE-RUN input fingerprint — the session's cache key. */
  fingerprint: string
  /**
   * Whether setup was handed a FRESH CHECKOUT — a git repository carrying
   * nothing git ignores beyond what the caller materialized into it. A cloned
   * repository arrives that way and so does every run of it; a folder copied
   * off this machine arrives with the developer's dependencies and build
   * output, and a run of it does too. The seed's cold-clone proof runs only in
   * the first case: it proves the seed against a clone, which is the tree a run
   * gets only there.
   */
  freshCheckout: boolean
  /** The live phase line: what is running now, and what to call it when done. */
  onPhase?: (running: string, done: string) => void
}
/** A coverage rule the seed could not satisfy, and why. */
export interface SeedUnmetRule {
  rule: string
  reason: string
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
      /**
       * The cold-clone proof did NOT run, in one line saying why. The seed was
       * proved in the warm tree alone, so the report says so rather than
       * letting a reader assume a clone verified it.
       */
      coldProofSkipped?: string
      /** The coverage rules the seed could not satisfy: notes on the step, never a failure. */
      unmet?: SeedUnmetRule[]
    }
  | {
      status: 'failed' | 'skipped'
      reason: string
      sessionRunId?: string
      /**
       * The failure is the RECIPE's, not the seed's: the cold-clone proof ran
       * the recipe's own `install`/`build` in a fresh copy and one of them
       * failed. Setup treats that as the recipe gate giving way — the recipe
       * row is unsettled so the next run re-derives it, and the run fails.
       */
      recipeDefect?: boolean
    }
export interface GuardSetupPreparationSessionInput {
  repoRoot: string
  recipe: Recipe
  specExcerpts: { doc: string; text: string }[]
  fingerprint: string
  onPhase?: (running: string, done: string) => void
}
export type GuardSetupPreparationSession = (input: GuardSetupPreparationSessionInput) => Promise<{
  status: 'ok' | 'skipped' | 'failed'
  /** The session's findings as one line, for the step record. */
  reason?: string
  /** The session's findings, which the step counts and the session's outcome carries. */
  findings?: string[]
  sessionRunId?: string
}>

export type GuardSetupSeedSession = (
  input: GuardSetupSeedSessionInput,
) => Promise<GuardSetupSeedSessionResult>

/** The auth-proof step's seam. */
export interface GuardSetupAuthStepInput {
  repoRoot: string
  recipe: Recipe
  fingerprint: string
}
export type GuardSetupAuthStepResult = {
  status: 'ok' | 'skipped' | 'failed' | 'blocked'
  reason?: string
  sessionRunId?: string
  /**
   * One line per supplied dependency the step reached, in the seam's own words:
   * whether it proved, and when it did not, why. Only the seam holds the
   * per-dependency verdicts, so it composes them and the engine reports them.
   */
  facts?: string[]
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
 * recipe/preparation failures come back as `status: 'failed'` with a reason, and every soft step
 * records its own outcome without demoting the run.
 *
 * SKIP-WHEN-SETTLED: every taxonomy step records an input
 * fingerprint in the report's `steps` spine, computed over the tree AS THE STEP
 * LEFT IT (a step that writes — the skeleton, the seed — would otherwise never
 * match itself again). On a re-run, a step whose prior row settled (`ok`, or an
 * earlier `skipped`/`unchanged` carry-forward) with the same fingerprint is
 * skipped whole; `refresh` forces every step to run.
 */
export async function runGuardSetup(opts: GuardSetupOptions): Promise<GuardSetupResult> {
  const { repoRoot } = opts

  // Step 0.5 — the corpus. Setup is the SECOND link of a three-stage chain; without
  // the first there is nothing to derive roles, principals, or credentials against,
  // and half-completing would leave a recipe that no spec ever justified.
  if (!hasGuardUniverse(repoRoot)) {
    return failed(
      'No corpus found. Flow setup runs after the Document scan, which has not curated anything yet.',
    )
  }

  const phases = stepPhases(opts)
  /** One line naming one thing a step did. */
  const fact = (step: GuardSetupStepKey, line: string): void => opts.onStepFact?.(step, line)
  const steps: GuardSetupTaxonomyStep[] = []
  const settled = settledSteps(repoRoot, opts.refresh === true)
  /** The detection snapshot, once the detect step has read it: a catalog input. */
  let detectionSnapshot = ''
  /** The files the schema parsers read, once the detect step has read them: a seed input. */
  let schemaFiles: readonly string[] = []
  /** Whether a step's settled row still holds — its named inputs when it has
   *  them, else its old fingerprint one last time. */
  const holds = (key: GuardSetupTaxonomyKey, legacyFingerprint: string): boolean =>
    stepSettled(repoRoot, key, settled(key), legacyFingerprint, { detectionJson: detectionSnapshot, schemaFiles })
  /**
   * Record a step's row with its inputs BY NAME, read off the tree as the row
   * is recorded, which is the state its fingerprint was computed over. A step
   * whose settled fingerprint no longer holds says which input moved it; a
   * refresh re-opens every step on request, so it names none.
   */
  const pushStep = (row: GuardSetupTaxonomyStep): void => {
    const inputComponents = stepInputComponents(repoRoot, row.key, { detectionJson: detectionSnapshot, schemaFiles })
    steps.push({ ...row, ...(Object.keys(inputComponents).length > 0 ? { inputComponents } : {}) })
    const settledRow = settled(row.key)
    if (settledRow === null) return
    const moved = movedNamedInputs(settledRow.inputComponents, inputComponents)
    // A stage bump re-opens a step whose fingerprint did not move.
    if (settledRow.inputFingerprint === row.inputFingerprint && !moved?.includes(STAGE_INPUT)) return
    fact(row.key, moved ? `re-opened: ${moved.join(', ') || 'no named input'} moved` : 're-opened: the settled row names no inputs')
  }

  // Asked BEFORE any step installs or builds anything: what this tree carries
  // right now is what a run of this repository is handed, and the seed's
  // cold-clone proof needs to know which kind of tree that is.
  const freshCheckout = await isFreshCheckout(repoRoot)

  const priorReport = readGuardSetup(repoRoot)
  // Single-step mode. `prior` is both the merge source and the evidence a soft
  // step ever ran — a step that ran and produced nothing legitimately left no
  // artifact behind, so the row is what says it happened.
  const only = opts.only
  const prior = only ? priorReport : null
  const rank = (step: GuardSetupOnlyStep): number => GUARD_SETUP_ONLY_STEPS.indexOf(step)
  /** Prior to the chosen step: replay from disk, never spend. */
  const replayed = (step: GuardSetupOnlyStep): boolean => only !== undefined && rank(step) < rank(only)
  /** After the chosen step: never starts. */
  const later = (step: GuardSetupOnlyStep): boolean => only !== undefined && rank(step) > rank(only)
  const ranBefore = (step: GuardSetupOnlyStep): boolean =>
    (prior?.steps ?? []).some((row) => row.key === step)

  // What has settled so far, written to `guard/setup.json` at EVERY step
  // boundary rather than only when the run ends. A run that stops part-way —
  // an empty balance, a killed process — assembles no report at all, so
  // without this the steps it did settle would be re-run and re-paid for on
  // the next attempt; a hosted job collects this file into the setup bundle,
  // which is what carries them across clones. The status is the HARD gate's,
  // which held before anything is written here, and a short spine means the
  // run stopped, never that a step passed silently.
  const soFar: {
    recipe?: GuardSetupRecipeStep
    externals?: GuardSetupExternalsStep
    seed?: GuardSetupSeedStep
    detection?: NonNullable<GuardSetupReport['detection']>
  } = {}
  const settleSpine = (): void => {
    if (!soFar.recipe) return
    writeGuardSetup(repoRoot, {
      ranAt: new Date().toISOString(),
      status: 'ok',
      // The prior rows carry forward for every step this run has not reached:
      // a step an earlier run settled stays settled until its input moves.
      steps: mergeStepSpine(steps, priorReport),
      recipe: soFar.recipe,
      ...(soFar.externals ? { externals: soFar.externals } : {}),
      ...(soFar.seed ? { seed: soFar.seed } : {}),
      ...(soFar.detection ? { detection: soFar.detection } : {}),
    })
  }

  // ONE analysis pass feeds every step — memoized exactly as generate memoizes it.
  // Which STEP pays for it depends on the repo (a repo with no recipe maps while
  // discovery proposes one; a repo that has one maps for the needs comparison the
  // recipe gate makes), so the phase is reported from here, against whichever
  // step is running when the pass actually starts.
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
  /**
   * The analysis pass over a tree that HAS a recipe. Discovery maps BEFORE one
   * exists (its route and datastore reads feed the proposal), and a mapping with
   * no entry to probe leaves the cli catalog empty of any program no extractor
   * reads — so a mapping that predates the recipe is thrown away and taken
   * again, once, as soon as one is on disk.
   */
  const mapWithRecipe = (): ReturnType<typeof mapSafely> => {
    if (mappedOnce && !mappedWithRecipe && fs.existsSync(recipePath(repoRoot))) mappedOnce = null
    return mapOnce()
  }
  /**
   * This run's detection snapshot and the recipe step's one settle input: the
   * NEEDS the repository declares. Taken here rather than at detect because the
   * recipe gate is the first thing that asks — the snapshot is shared, not taken
   * twice, and the catalog step keys on the same string.
   */
  const detectWorld = async (): Promise<{ world: DetectedWorld; inputFingerprint: string }> => {
    const mapped = await mapWithRecipe()
    const world: DetectedWorld = {
      externalServices: mapped.externalServices,
      database: mapped.database,
      datastoreUrls: mapped.datastoreUrls,
    }
    detectionSnapshot = canonicalDetectionJson(mapped.externalServices, mapped.database, mapped.datastoreUrls)
    schemaFiles = mapped.database?.schemaFiles ?? []
    return { world, inputFingerprint: recipeStepFingerprint(needsFingerprint(recipeNeeds(world))) }
  }

  // ---- Step 1: the recipe. A failure prevents later setup. -----------------
  opts.onStep?.('recipe')
  phases.step('recipe')
  // The recipe step's subject is what the repository NEEDS of the world a run
  // boots — never a file's bytes. A recipe was proved by really installing,
  // building and booting this application, so re-deriving it is a rewording:
  // a dependency bump, a reformatted lockfile and a renamed script all leave
  // the needs exactly as they were, and a re-derivation over them re-authors a
  // corpus for nothing. The rows an older build wrote name manifests instead,
  // and are compared against the old fingerprint once (see `stepSettled`).
  const legacyRecipeFp = legacyRecipeStepFingerprint(repoRoot)
  const preexisting = reloadRecipe(repoRoot)
  // A recipe the last run FAILED is never reused. Discovery answers `exists`
  // for whatever sits at the recipe path, and the recipe travels in the setup
  // bundle, so without this the refused recipe is read back, re-folded and
  // re-refused every run — each one paying the whole seed fold to reach the
  // same verdict — until someone asks for a refresh by hand.
  const rederive =
    opts.refresh === true ||
    (priorReport?.steps ?? []).some((row) => row.key === 'recipe' && row.status === 'failed')
  let recipe: Recipe
  let recipeStep: GuardSetupRecipeStep

  /**
   * The live endpoint probe — the half verification does not do. See
   * `endpoint-probe.ts` for why any HTTP status (401 and 404 included) is a
   * pass. It BOOTS the recipe's servers, so it is only ever run over a tree
   * something has built.
   */
  const probeRecipe = async (subject: Recipe): Promise<GuardSetupServerProbe[]> => {
    if (!subject.api) return []
    const probes = await (opts.probe ?? probeApiServers)({
      repoRoot,
      recipe: subject,
      manifest: buildRouteManifest(repoRoot),
      ...(opts.signal ? { signal: opts.signal } : {}),
      onServer: (done, total) => {
        const line = total === 1 ? 'probing a live route' : `probing live routes ${done}/${total}`
        if (done === 0) phases.enter({ running: line, done: 'route probe' })
        else phases.tick(line)
      },
    })
    for (const probe of probes) {
      fact(
        'recipe',
        probe.ok
          ? `probed \`${probe.server}\`: GET ${probe.path} answered ${probe.status ?? 'without a status'}`
          : `probed \`${probe.server}\`: GET ${probe.path} did not answer, ${firstReasonLine(probe.error ?? 'no reason reported')}`,
      )
    }
    return probes
  }
  /** Why a dead server stops setup — step 1 is the one hard gate. */
  const deadServerReason = (probe: GuardSetupServerProbe): string =>
    `the recipe's server "${probe.server}" is declared but not reachable: ${probe.error}. ` +
    `Every api scenario would fail identically against it, so setup stops here rather than preparing a world nothing can run in.`

  if (replayed('recipe')) {
    // Single-step mode, a later step: the recipe on disk IS the artifact every
    // step downstream reads. Neither discovery nor the repair session nor the
    // live probe runs — they belong to `only: 'recipe'` — and no row is pushed,
    // so the merge below keeps the one the run that really verified it wrote.
    if (!preexisting) {
      throw new SetupStepNotReadyError('recipe', `no readable recipe at ${recipePath(repoRoot)}`)
    }
    recipe = preexisting
    recipeStep = { status: 'ok', outcome: 'exists' }
    fact('recipe', 'replayed from recipe.json: not re-derived, not probed')
    opts.onStepDone?.('recipe', 'replayed from recipe.json — not re-derived, not probed')
  } else if (preexisting && !rederive) {
    // THE STANDING RECIPE. Nothing re-derives it, and the two questions asked
    // here are whether the repository now needs something it does not provide,
    // and whether what it declares still starts.
    const { world, inputFingerprint } = await detectWorld()
    const diff = recipeNeedsDiff({ repoRoot, recipe: preexisting, world })
    for (const entry of diff.unprovided) fact('recipe', unprovidedNeedFact(entry))
    const toRepair = recipeNeedsOf(diff)
    recipe = preexisting
    recipeStep = {
      status: 'ok',
      outcome: 'exists',
      ...(diff.unprovided.length > 0 ? { unprovidedNeeds: diff.unprovided.map(recordedNeed) } : {}),
    }
    let sessionRunId: string | undefined

    /** What every repair of this recipe is handed beside its scope. */
    const repairArgs = {
      recipe: preexisting,
      database: async () => {
        const db = world.database
        return db ? { type: db.type, driver: db.driver } : null
      },
      datastores: async () => world.datastoreUrls,
      ...(opts.composeKey ? { composeKey: opts.composeKey } : {}),
      onPhase: (phase: RecipeDiscoveryPhase) => phases.enter(recipePhase(phase)),
    }
    /** Take a settled repair onto the run: the recipe, the row, the facts. */
    const applyRepair = (repaired: RepairExistingRecipeResult): void => {
      sessionRunId = repaired.sessionRunId ?? sessionRunId
      if (repaired.status !== 'repaired') {
        if (repaired.status === 'unchanged') {
          fact('recipe', 'the repair session settled on the recipe as it stands; nothing was rewritten')
        }
        return
      }
      recipe = repaired.recipe
      fact('recipe', `repaired in place, ${repaired.changed.join(', ')} rewritten in ${repaired.wrotePath}`)
      for (const surface of repaired.movedSlices) {
        fact('recipe', `repair moved the slice: every ${surface} flow re-authors against the changed recipe`)
      }
      recipeStep = {
        ...recipeStep,
        outcome: 'discovered',
        source: 'llm',
        wrotePath: repaired.wrotePath,
        ...(repaired.movedSlices.length > 0 ? { movedFlowSlices: [...repaired.movedSlices] } : {}),
      }
    }
    /** The recipe gate giving way: the row and the run both carry the reason. */
    const stop = (reason: string): GuardSetupResult => {
      recipeStep = { ...recipeStep, status: 'failed', reason }
      return failed(reason, {
        recipe: recipeStep,
        steps: [
          ...steps,
          {
            key: 'recipe',
            status: 'failed',
            reason,
            inputFingerprint,
            ...(sessionRunId ? { sessionRunId } : {}),
          },
        ],
      })
    }
    /**
     * VERIFICATION — boot the recipe's servers and call a real route on each.
     * Honest only over a tree something has built, so a checkout with no
     * dependencies and no build output is not probed at all: a boot failure
     * there reports the checkout, and the run that builds this repository
     * verifies the recipe's boot for real. A dead server is handed to ONE
     * boot-scoped repair before the gate gives way, since failing instead
     * leaves the row failed, which is what makes the next run throw the whole
     * recipe away and derive a new one. Returns the reason, or null.
     */
    const verifyStanding = async (repairedAlready: boolean): Promise<string | null> => {
      if (freshCheckout && !repairedAlready) {
        fact('recipe', 'nothing is built in this checkout, so the recipe was not re-probed: the run that builds it verifies its boot')
        return null
      }
      let probes = await probeRecipe(recipe)
      let dead = probes.find((p) => !p.ok)
      if (dead && opts.repair && !repairedAlready) {
        const failure = deadServerReason(dead)
        const fixed = await repairExistingRecipe(repoRoot, {
          ...repairArgs,
          repair: opts.repair,
          scope: { kind: 'boot', failure, failureClass: 'endpoint-probe' },
        })
        if (fixed.status === 'failed') {
          fact('recipe', `the recipe no longer starts, and the repair did not settle: ${firstReasonLine(fixed.reason)}`)
        }
        applyRepair(fixed)
        if (fixed.status === 'repaired') {
          probes = await probeRecipe(recipe)
          dead = probes.find((p) => !p.ok)
        }
      }
      if (probes.length > 0) recipeStep.probes = probes
      opts.onStepDone?.('recipe', recipeSummary(recipeStep, probes))
      return dead ? deadServerReason(dead) : null
    }

    if (toRepair.length > 0 && opts.repair) {
      // SCOPED REPAIR. The session is handed the recipe and the named needs and
      // may answer with the world the app runs in and nothing else; the fold
      // refuses a proposal that reaches further, and `verifyProposal` is still
      // the gate that decides whether anything reaches disk.
      const repaired = await repairExistingRecipe(repoRoot, {
        ...repairArgs,
        repair: opts.repair,
        scope: { kind: 'needs', unprovided: toRepair },
      })
      if (repaired.status === 'failed') {
        sessionRunId = repaired.sessionRunId ?? sessionRunId
        fact('recipe', `the recipe does not provide what the repository needs, and the repair did not settle: ${firstReasonLine(repaired.reason)}`)
        return stop(repaired.reason)
      }
      applyRepair(repaired)
      const reason = await verifyStanding(true)
      if (reason) return stop(reason)
      pushStep({ key: 'recipe', status: 'ok', inputFingerprint, ...(sessionRunId ? { sessionRunId } : {}) })
    } else if (toRepair.length === 0 && holds('recipe', legacyRecipeFp)) {
      // Settled: the repository needs nothing the recipe does not provide, and
      // the needs have not moved since the last run verified them. `refresh`
      // bypasses this.
      pushStep({ key: 'recipe', status: 'skipped', reason: 'unchanged', inputFingerprint })
      fact(
        'recipe',
        'the needs have not moved and the recipe provides every one of them, from cache: neither re-derived nor re-probed',
      )
      opts.onStepDone?.('recipe', 'unchanged — reused without re-verifying')
    } else {
      // The needs moved, or one is unprovided with no repair seam wired in.
      // Either way the recipe stands and verification is what says whether it
      // still holds.
      const reason = await verifyStanding(false)
      if (reason) return stop(reason)
      pushStep({ key: 'recipe', status: 'ok', inputFingerprint, ...(sessionRunId ? { sessionRunId } : {}) })
    }
  } else {
    // A RE-DERIVATION (a refresh, or a recipe the last run failed) writes what
    // discovery derived — which knows nothing about the blocks it never proposes
    // (`api.seed`, `api.externals`, `api.credentials`, `ownHosts`). Those are user-
    // and setup-authored CAPABILITY declarations; losing them would be silent data
    // loss, and it would also defeat the seed confirmation below (a wiped `api.seed`
    // is not a seed anyone is asked about replacing). Captured before, merged back
    // after.
    const authored = rederive ? authoredBlocks(preexisting) : null
    const discovery = await discoverRecipe(repoRoot, opts.recipeRunner, {
      ...(rederive ? { ignoreExisting: true } : {}),
      ...(opts.repair ? { repair: opts.repair } : {}),
      ...(opts.composeKey ? { composeKey: opts.composeKey } : {}),
      routes: async () => routesFromInterfaces((await mapOnce()).interfaces),
      database: async () => {
        const db = (await mapOnce()).database
        return db ? { type: db.type, driver: db.driver } : null
      },
      datastores: async () => (await mapOnce()).datastoreUrls ?? [],
      onPhase: (phase) => phases.enter(recipePhase(phase)),
    })
    if (discovery.status === 'verify-failed') {
      fact('recipe', `no recipe holds: ${firstReasonLine(discovery.reason)}`)
      return failed(discovery.reason, {
        recipe: { status: 'failed', reason: discovery.reason },
        steps: [
          ...steps,
          {
            key: 'recipe',
            status: 'failed',
            reason: discovery.reason,
            inputFingerprint: (await detectWorld()).inputFingerprint,
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
    if (discovery.status === 'exists') {
      fact('recipe', 'recipe.json is already committed; it was reused, not re-derived')
    } else {
      fact(
        'recipe',
        discovery.source === 'deterministic'
          ? `recipe derived deterministically from the repository's own manifests, written to ${discovery.wrotePath}`
          : discovery.sessionRunId
            ? `recipe repaired by a session after deterministic discovery failed, written to ${discovery.wrotePath}`
            : `recipe proposed by the model, written to ${discovery.wrotePath}`,
      )
      if (discovery.composePath) {
        fact('recipe', `generated a datastore compose file at ${discovery.composePath}`)
      }
      for (const todo of discovery.todos) fact('recipe', `left for a human to fill in: ${todo}`)
    }

    // The needs the row settles on are read AFTER the recipe landed, off the
    // mapping that sees it: a pass taken before it exists has no entry to probe
    // and reports a different world.
    const { inputFingerprint } = await detectWorld()
    const probes = await probeRecipe(recipe)
    if (probes.length > 0) recipeStep.probes = probes
    const deadServer = probes.find((p) => !p.ok)
    if (deadServer) {
      const reason = deadServerReason(deadServer)
      recipeStep.status = 'failed'
      recipeStep.reason = reason
      return failed(reason, {
        recipe: recipeStep,
        steps: [...steps, { key: 'recipe', status: 'failed', reason, inputFingerprint }],
      })
    }
    const sessionRunId = discovery.status === 'discovered' ? discovery.sessionRunId : undefined
    pushStep({
      key: 'recipe',
      status: 'ok',
      inputFingerprint,
      ...(sessionRunId ? { sessionRunId } : {}),
    })
    opts.onStepDone?.('recipe', recipeSummary(recipeStep, probes))
  }
  // The hard gate held: from here the spine is worth keeping whatever stops
  // the run.
  soFar.recipe = recipeStep
  settleSpine()

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
  // The same pass the recipe gate read its needs off, with the recipe on disk.
  const mapped = await mapWithRecipe()
  const detectedExternals = mapped.externalServices
  const database = mapped.database
  const datastoreUrls = mapped.datastoreUrls
  const detectionSnapshotJson = canonicalDetectionJson(detectedExternals, database, datastoreUrls)
  detectionSnapshot = detectionSnapshotJson
  schemaFiles = database?.schemaFiles ?? []
  pushStep({ key: 'detect', status: 'ok', inputFingerprint: '' })
  for (const service of detectedExternals) fact('detect', detectedServiceFact(service))
  if (database) {
    fact(
      'detect',
      `${database.type} via ${database.driver}: ${database.tables.length} table${database.tables.length === 1 ? '' : 's'} parsed`,
    )
  }
  for (const line of datastoreUrlFacts(datastoreUrls)) fact('detect', line)
  if (detectedExternals.length === 0 && !database && datastoreUrls.length === 0) {
    fact('detect', 'nothing detected: no external service, no database, no datastore url')
  }
  opts.onStepDone?.(
    'detect',
    detectSummary(detectedExternals, database),
  )
  soFar.detection = {
    externalServices: detectedExternals,
    database: database ? detectedDatabaseRow(database) : null,
    datastoreUrls,
  }
  settleSpine()

  // ---- Step 3: the catalog — the externals skeleton (det) + the session. ---
  // SOFT throughout: the hard gate already held, and a catalog that could not be
  // classified is a reported step, never a failed setup.
  // The recipe as the catalog step reads it: the contract before the seed
  // step, which (with the preparations step) writes the recipe later in this
  // same run. A dependency version reaches neither the classification nor
  // the skeleton, so the manifests are not here either.
  const catalogFpOf = (): string =>
    catalogFingerprint(detectionSnapshotJson, recipeContractFingerprint(repoRoot, 'seed'), dependenciesFileContent(repoRoot))
  /** {@link catalogFpOf} as it was computed before the slices — the one check a
   *  settled row with no components gets, and the session's old cache key.
   *  Delete with the legacy hash. */
  const legacyCatalogFpOf = (): string =>
    catalogFingerprint(detectionSnapshotJson, computeRecipeFingerprint(repoRoot), dependenciesFileContent(repoRoot))
  // The session's own settle gate. Its additions are LLM-nondeterministic, so
  // a re-run can grow the catalog, which moves the recipe fingerprint, which
  // re-authors every flow. This fingerprint deliberately excludes the catalog
  // it produces (feeding the session's OUTPUT back into its gate is what made
  // the churn self-sustaining) and the full recipe fingerprint (which folds the
  // catalog too): it hashes only what the session derives FROM — detection and
  // the recipe contract as it stands before the seed step, which writes the
  // recipe after this step in the same run. While it holds, the stored catalog
  // stands byte-for-byte; the add-only fold already protects curated entries
  // whenever the session does run.
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
        credentialEnvs: (s.credentialEnvs ?? []).map(e => e.envVar).sort(),
      }))
      .sort((a, b) => a.service.localeCompare(b.service)),
    database: database ? { type: database.type, driver: database.driver } : null,
  })
  const catalogSessionFpOf = (): string =>
    `sha256:${createHash('sha256').update(`${stableDetectionJson}::${recipeContractFingerprint(repoRoot, 'seed')}`).digest('hex')}`
  /** {@link catalogSessionFpOf} as the settle record was written before the
   *  slices: the recipe's whole text and the seed script. A record under it
   *  holds once, then re-settles under the new value. Delete with the legacy hash. */
  const legacyCatalogSessionFpOf = (): string => {
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
    // A catalog with no settle record predates this gate: adopt it as settled
    // rather than re-classifying — it is a curated artifact of the stored
    // bundle, and `refresh` remains the explicit way to re-derive it.
    const settleSkip =
      catalogOnDisk &&
      (settledSession === catalogSessionFp ||
        settledSession === legacyCatalogSessionFpOf() ||
        (settledSession === null && opts.refresh !== true))
    if (replayed('catalog')) {
      // Prior step: the catalog on disk stands as it is. Not even the
      // deterministic skeleton runs — it WRITES `api.externals` into the recipe,
      // and a step nobody chose must leave the tree alone.
      if (!ranBefore('catalog')) {
        throw new SetupStepNotReadyError('catalog', 'no catalog row in guard/setup.json')
      }
      fact('catalog', 'replayed: scenarios/dependencies.json stands as it is')
      for (const line of catalogEntryFacts(repoRoot)) fact('catalog', line)
      opts.onStepDone?.('catalog', 'replayed — scenarios/dependencies.json stands as it is')
    } else if (holds('catalog', legacyCatalogFpOf()) || settleSkip) {
      // The skeleton is still run for the legacy report field — with unchanged
      // detection and an unchanged recipe it derives nothing and writes nothing —
      // but no session is spent.
      externalsStep = applyExternalsSkeleton(repoRoot, recipe, detectedExternals)
      const catalogFpPost = catalogFpOf()
      const enriched = catalogFpPost !== catalogFpPre
      if (settledSession !== catalogSessionFp || enriched) writeCatalogSettle(repoRoot, catalogSessionFpOf())
      pushStep({ key: 'catalog', status: enriched ? 'ok' : 'skipped', ...(!enriched ? { reason: 'unchanged' } : {}), inputFingerprint: catalogFpPost })
      fact(
        'catalog',
        enriched
          ? 'the classification was already settled, from cache; the skeleton added credential requirements'
          : 'the classification was already settled, from cache; no session was spent',
      )
      for (const line of externalsSkeletonFacts(externalsStep)) fact('catalog', line)
      for (const line of catalogEntryFacts(repoRoot)) fact('catalog', line)
      opts.onStepDone?.('catalog', enriched ? 'credential requirements updated' : 'unchanged')
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
          legacyFingerprint: legacyCatalogFpOf(),
        })
        if (result.status === 'ok') writeCatalogSettle(repoRoot, catalogSessionFpOf())
        pushStep(
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
        for (const line of externalsSkeletonFacts(externalsStep)) fact('catalog', line)
        if (result.status === 'ok') {
          fact(
            'catalog',
            result.fromCache
              ? 'the catalog session\'s classification came from cache'
              : 'the catalog session classified the starting state this run',
          )
          for (const finding of result.findings) {
            fact('catalog', `finding recorded in guard/setup.findings.md: ${firstReasonLine(finding)}`)
          }
        } else {
          fact('catalog', `the catalog session failed: ${firstReasonLine(result.reason)}`)
        }
        for (const line of catalogEntryFacts(repoRoot)) fact('catalog', line)
        opts.onStepDone?.('catalog', catalogSummary(externalsStep, result))
      } else {
        // No session wired (a test seam, or the deterministic-only edition): the
        // deterministic half is the whole step.
        pushStep({ key: 'catalog', status: 'ok', inputFingerprint: catalogFpOf() })
        for (const line of externalsSkeletonFacts(externalsStep)) fact('catalog', line)
        fact('catalog', 'no catalog session is wired into this run; the deterministic skeleton was the whole step')
        for (const line of catalogEntryFacts(repoRoot)) fact('catalog', line)
        opts.onStepDone?.(
          'catalog',
          `${externalsStep.declared.length} declared · ${externalsStep.unprovided.length} awaiting an account`,
        )
      }
    }
  }
  if (externalsStep) soFar.externals = externalsStep
  settleSpine()

  // The recipe on disk may have changed under the catalog step (the skeleton is a
  // real write), so the seed drafts against the RELOADED one — its fingerprint has
  // already moved.
  const current = reloadRecipe(repoRoot) ?? recipe

  // ---- Step 4: the one seed — data AND auth. SOFT. -------------------------
  const seedFpOf = (): string => computeSeedStepFingerprint(repoRoot, schemaFiles)
  const priorDrafted = priorReport?.steps.find((row) => row.key === 'seed')?.draftedSeed
  /** The seed row's `draftedSeed`: this run's draft, or the prior one while the seed still matches it. */
  const draftedSeedOf = (drafted: boolean): { draftedSeed?: string } => {
    const now = seedDigest(repoRoot, reloadRecipe(repoRoot) ?? current)
    return now !== null && (drafted || now === priorDrafted) ? { draftedSeed: now } : {}
  }
  let seedStep: GuardSetupSeedStep | undefined
  /** A recipe defect the seed's cold-clone proof surfaced: the run fails on it. */
  let recipeFailure: string | undefined
  if (enter('seed')) {
    const seedFpPre = seedFpOf()
    if (replayed('seed')) {
      // Prior step: the seed the recipe declares (or the absence of one) is what
      // the auth step runs against. Nothing is drafted, nothing is replaced.
      if (!ranBefore('seed')) {
        throw new SetupStepNotReadyError('seed', 'no seed row in guard/setup.json')
      }
      fact('seed', 'replayed: the declared `api.seed` stands as it is, nothing was drafted or proved')
      opts.onStepDone?.('seed', 'replayed — the declared `api.seed` stands as it is')
    } else if (holds('seed', legacySeedStepFingerprint(repoRoot))) {
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
      pushStep({ key: 'seed', status: 'skipped', reason: 'unchanged', inputFingerprint: seedFpPre, ...draftedSeedOf(false) })
      fact(
        'seed',
        existingSeed
          ? `seed unchanged since the last setup, from cache: \`${existingSeed.command}\` stands`
          : 'seed unchanged since the last setup, from cache: the last run drafted none either',
      )
      for (const line of seedProvidesFacts(seedStep)) fact('seed', line)
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
        engineDrafted: priorDrafted !== undefined && priorDrafted === seedDigest(repoRoot, current),
        freshCheckout,
        onPhase: (running, done) => phases.enter({ running, done }),
      })
      seedStep = seedRun.step
      pushStep({
        key: 'seed',
        status: seedStep.status,
        ...(seedStep.reason ? { reason: seedStep.reason } : {}),
        // Post-write: a drafted seed moved recipe.json AND the script the recipe
        // fingerprint folds, so the settled value is the tree it left behind.
        inputFingerprint: seedFpOf(),
        ...(seedRun.sessionRunId ? { sessionRunId: seedRun.sessionRunId } : {}),
        ...draftedSeedOf(seedStep.outcome === 'drafted'),
      })
      // The cold-clone proof is the one place the recipe's `install`/`build`
      // run in a tree that did not grow across the session's attempts. When
      // they fail there, the recipe verified against a tree a fresh clone will
      // not have — a recipe-gate failure found late. Reported as one: the
      // recipe row is UNSETTLED (the next run re-derives instead of skipping
      // on its unchanged manifests) and the run fails with the reason, so
      // nothing chains a generate onto an install that does not work.
      if (seedRun.recipeDefect && seedStep.reason) {
        recipeFailure = seedStep.reason
        const recipeRow = steps.findIndex((row) => row.key === 'recipe')
        const row: GuardSetupTaxonomyStep = {
          key: 'recipe',
          status: 'failed',
          reason: recipeFailure,
          inputFingerprint: steps[recipeRow]?.inputFingerprint ?? legacyRecipeFp,
          ...(seedRun.sessionRunId ? { sessionRunId: seedRun.sessionRunId } : {}),
        }
        if (recipeRow >= 0) steps[recipeRow] = row
        else steps.push(row)
        recipeStep = { ...recipeStep, status: 'failed', reason: recipeFailure }
        fact('recipe', `unsettled by the seed's cold-clone proof: ${firstReasonLine(recipeFailure)}`)
      }
      fact('seed', seedOutcomeFact(seedStep, seedRun.fromCache === true))
      if (seedRun.coldProofSkipped) fact('seed', seedRun.coldProofSkipped)
      for (const unmet of seedRun.unmet ?? []) fact('seed', `coverage not seeded: ${unmet.rule} (${unmet.reason})`)
      for (const line of seedProvidesFacts(seedStep)) fact('seed', line)
      opts.onStepDone?.('seed', seedSummary(seedStep))
    }
  }
  // The recipe row too: the seed's cold-clone proof may have unsettled it.
  soFar.recipe = recipeStep
  if (seedStep) soFar.seed = seedStep
  settleSpine()

  // ---- Step 5: interfaces — reconcile the cli disputes, author the web tasks.
  // SOFT: an authoring failure fails the STEP, never setup — the derived half of
  // the catalog is already on disk, and generate runs on whatever authored half
  // exists. Skip-when-settled needs BOTH halves settled: an unchanged place set
  // with the authored file missing (deleted, or a clone that never authored) is
  // work, not a skip; `replace` is an explicit re-author and never skips
  // either. It runs AFTER the seed on purpose: the authoring sessions open the
  // app's screens in a browser signed in as a seeded principal, so the seed's
  // principals are an input of theirs, and the recipe they read is the one the
  // seed step just wrote.
  if (enter('interfaces')) {
    const interfacesFp = interfacesFingerprint(repoRoot)
    const authoredExists = fs.existsSync(guardAuthoredInterfacesPath(repoRoot))
    // The derived catalog is what this step reconciles and authors over, so it
    // names what the derivation produced whichever branch below runs.
    for (const line of derivedInterfaceFacts(repoRoot, mapped.interfaces)) fact('interfaces', line)
    if (replayed('interfaces')) {
      // Prior step: the merged catalog on disk — the derived half detect just
      // re-wrote, plus whatever authored half the bundle carried in — is what
      // the later steps read. No reconcile session, no authoring run.
      if (!ranBefore('interfaces')) {
        throw new SetupStepNotReadyError('interfaces', 'no interfaces row in guard/setup.json')
      }
      fact('interfaces', 'replayed: the authored catalog stands as it is')
      opts.onStepDone?.('interfaces', 'replayed — the authored catalog stands as it is')
    } else if (holds('interfaces', legacyInterfacesFingerprint(repoRoot)) && authoredExists && opts.replace !== true &&
      webScreensNeedingAuthoring({
        derived: readInterfaceCatalog(repoRoot),
        authored: readAuthoredInterfaceCatalog(repoRoot),
        recipeContract: authoringRecipeContract(repoRoot),
        repoRoot,
        // A screen authored from source alone is work once the step can look at it live.
        liveAvailable: opts.authorInterfaces !== undefined && (await canObserveLiveScreens(reloadRecipe(repoRoot) ?? recipe)),
      }).size === 0) {
      pushStep({ key: 'interfaces', status: 'skipped', reason: 'unchanged', inputFingerprint: interfacesFp })
      fact('interfaces', 'the place set is unchanged since the last setup, from cache: no reconcile, no authoring')
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
      pushStep({
        key: 'interfaces',
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
        // The fingerprint this step PLANNED over: the step writes only the
        // authored half, which no input of its key reads, so the row records
        // the same value before and after the run rather than re-reading a tree
        // the authoring may have moved underneath it.
        inputFingerprint: interfacesFp,
        ...(result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}),
        // The step row is where run reporting lands (diagnostics are NEVER
        // stored in the catalog, and 01-D left the dashboard silent on them).
        ...(result.diagnostics && result.diagnostics.length > 0 ? { diagnostics: result.diagnostics } : {}),
        ...(result.resolutions && result.resolutions.length > 0 ? { resolutions: result.resolutions } : {}),
        ...(result.changes && result.changes.length > 0 ? { changes: result.changes } : {}),
        ...(result.labelRekeys !== undefined ? { labelRekeys: result.labelRekeys } : {}),
        ...(result.failedScreens && result.failedScreens.length > 0
          ? { failedScreens: result.failedScreens }
          : {}),
      })
      for (const screen of result.failedScreens ?? []) {
        fact('interfaces', `${screen.place}: not authored (${screen.reason ?? 'the session did not settle'}) — refresh to retry`)
      }
      if (result.labelRekeys) {
        fact('interfaces', `${result.labelRekeys} re-authored task${result.labelRekeys === 1 ? '' : 's'} moved a key through a reworded label alone`)
      }
      if (result.resolutions && result.resolutions.length > 0) {
        fact(
          'interfaces',
          result.reconcileFromCache
            ? `${result.resolutions.length} tree-vs-probe dispute${result.resolutions.length === 1 ? '' : 's'} settled from cache`
            : `the reconcile session settled ${result.resolutions.length} tree-vs-probe dispute${result.resolutions.length === 1 ? '' : 's'}`,
        )
        for (const resolution of result.resolutions) {
          fact('interfaces', `${resolution.subject}: ${resolution.resolution}, ${firstReasonLine(resolution.evidence)}`)
        }
      }
      for (const change of result.changes ?? []) fact('interfaces', `catalog edit: ${change}`)
      opts.onStepDone?.('interfaces', result.reason ?? result.status)
    } else {
      pushStep({
        key: 'interfaces',
        status: 'skipped',
        reason:
          'interface authoring is not wired into this run — inject the `authorInterfaces` seam (production does)',
        inputFingerprint: interfacesFp,
      })
      fact('interfaces', 'interface authoring is not wired into this run; the derived catalog stands alone')
      opts.onStepDone?.('interfaces', 'not wired into this run')
    }
  }
  settleSpine()

  // Private state is its own targeted setup step; it never replaces the main seed.
  let preparationFailure: string | undefined
  if (enter('preparations')) {
    const preparationFp = computePreparationFingerprint(repoRoot)
    const preparationRecipe = reloadRecipe(repoRoot) ?? current
    if (replayed('preparations')) {
      fact('preparations', 'replayed: the existing private preparation profiles stand as they are')
      for (const line of preparationFacts(preparationRecipe, repoRoot)) fact('preparations', line)
      opts.onStepDone?.('preparations', 'existing private preparation profiles preserved')
    } else if (holds('preparations', legacyPreparationFingerprint(repoRoot)) &&
      preparationCatalog(preparationRecipe, repoRoot).length === Object.keys(preparationRecipe.preparations ?? {}).length) {
      pushStep({ key: 'preparations', status: 'skipped', reason: 'unchanged', inputFingerprint: preparationFp })
      fact('preparations', 'every private preparation profile is unchanged since the last setup, from cache')
      for (const line of preparationFacts(preparationRecipe, repoRoot)) fact('preparations', line)
      opts.onStepDone?.('preparations', 'unchanged')
    } else {
      const result = opts.preparationSession
        ? await opts.preparationSession({ repoRoot, recipe: preparationRecipe,
            specExcerpts: readSpecExcerpts(repoRoot), fingerprint: preparationFp,
            onPhase: (running, done) => phases.enter({ running, done }) })
        : { status: 'skipped' as const, reason: 'private preparation authoring is unavailable; only profiles with runner-verified baseline checks are usable' }
      pushStep({ key: 'preparations', status: result.status, ...(result.reason ? { reason: result.reason } : {}),
        inputFingerprint: opts.preparationSession ? computePreparationFingerprint(repoRoot) : UNSETTLEABLE_FINGERPRINT, ...('sessionRunId' in result && result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}) })
      // The session's findings are its outcome, read in the session itself;
      // the step only counts them.
      const findings = result.findings ?? []
      const summary =
        result.status === 'ok'
          ? 'the preparation session authored the private starting states'
          : findings.length > 0
            ? `no private starting state was authored, ${findings.length} finding${findings.length === 1 ? '' : 's'}`
            : `no private starting state was authored: ${firstReasonLine(result.reason ?? result.status)}`
      fact('preparations', summary)
      for (const line of preparationFacts(reloadRecipe(repoRoot) ?? preparationRecipe, repoRoot)) fact('preparations', line)
      if (result.status === 'failed') preparationFailure = result.reason || 'Private preparation failed'
      else opts.onStepDone?.('preparations', findings.length > 0 ? summary : (result.reason ?? result.status))
    }
  }
  settleSpine()

  // ---- Step 6: auth. Framework row only until plan step 14 wires it. -------
  // The ONE step that may end `blocked` (a supplied credential waiting on a user
  // registration) without demoting the run.
  if (!preparationFailure && enter('auth')) {
    const authFp = authFingerprint(repoRoot)
    if (holds('auth', authFp)) {
      pushStep({ key: 'auth', status: 'skipped', reason: 'unchanged', inputFingerprint: authFp })
      fact('auth', 'the supplied entries are unchanged since the last setup, from cache: no proof session ran')
      opts.onStepDone?.('auth', 'unchanged')
    } else if (opts.verifyAuth) {
      const result = await opts.verifyAuth({ repoRoot, recipe: reloadRecipe(repoRoot) ?? current, fingerprint: authFp })
      pushStep({
        key: 'auth',
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
        inputFingerprint: authFingerprint(repoRoot),
        ...(result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}),
      })
      for (const line of result.facts ?? []) fact('auth', line)
      if ((result.facts ?? []).length === 0 && result.reason) fact('auth', firstReasonLine(result.reason))
      opts.onStepDone?.('auth', result.reason ?? result.status)
    } else {
      pushStep({
        key: 'auth',
        status: 'skipped',
        reason:
          'auth verification is not wired into setup yet — supplied auth entries are checked at run time (plan step 14 wires the proof session here)',
        inputFingerprint: authFp,
      })
      fact('auth', 'auth verification is not wired into this run; supplied entries are checked at run time instead')
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
      status: recipeFailure || preparationFailure ? 'failed' : 'ok',
      ...(recipeFailure ? { reason: recipeFailure } : preparationFailure ? { reason: preparationFailure } : {}),
      steps: only ? mergeStepSpine(steps, prior) : steps,
      recipe: recipeStep,
      ...(externals ? { externals } : {}),
      ...(seed ? { seed } : {}),
      ...(credentialSchemes.errors.length > 0 || credentialSchemes.warnings.length > 0
        ? { credentialSchemes }
        : {}),
      detection: {
        externalServices: detectedExternals,
        database: database ? detectedDatabaseRow(database) : null,
        datastoreUrls,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Skip-when-settled: the step fingerprints
// ---------------------------------------------------------------------------

/**
 * The spine a SINGLE-STEP run persists: this run's rows, plus the previous
 * report's row for every step it did not touch, in taxonomy order. Without the
 * carry-forward a `only: 'seed'` run would leave a one-row spine, and the next
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
 * Whether `repoRoot` is a FRESH CHECKOUT: a git repository whose working tree
 * carries nothing git ignores except what a caller materialized into it. That
 * is how a cloned repository arrives, and how every run of it arrives; a folder
 * copied off this machine arrives with the developer's dependencies and build
 * output instead.
 *
 * `false` for a tree git cannot read at all: without git there is no clone for a
 * run's tree to be compared to.
 */
async function isFreshCheckout(repoRoot: string): Promise<boolean> {
  // What a caller wrote into this tree before setup ran is not evidence of a
  // warm one: the work tree, the datastore compose file guard generates, and
  // the corpus's own documents, which land wherever their refs point (the
  // workspace corpus a hosted job materializes writes them under `context/`).
  const materialized = new Set<string>([WORK_TREE_DIR, GUARD_COMPOSE_FILE])
  for (const ref of readCorpusAreaTags(repoRoot).keys()) {
    const root = ref.split('/')[0]
    if (root) materialized.add(root)
  }
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoRoot, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    return stdout
      .split('\0')
      .filter(Boolean)
      .every((rel) => materialized.has(rel.replace(/\/$/, '')))
  } catch {
    return false
  }
}

/**
 * THE RECIPE STEP's fingerprint — the NEEDS the repository declares, and
 * nothing else. What is installed, built and served was proved by a real boot,
 * so the step re-opens when the application starts asking for something new,
 * never when a manifest was reformatted.
 */
export function recipeStepFingerprint(needsFp: string): string {
  return createHash('sha256').update(`recipe-needs::${needsFp}`).digest('hex')
}

/**
 * The recipe step's fingerprint as it was computed while its subject was the
 * ecosystem manifests: sha256 over the present ones, path-tagged like the
 * runner's own `FINGERPRINT_INPUTS` list. The one check a settled row written
 * before the needs got it. Delete with the legacy hash.
 */
export function legacyRecipeStepFingerprint(repoRoot: string): string {
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

function catalogFingerprint(detectionJson: string, recipeContract: string, depsContent: string): string {
  return createHash('sha256').update(`${detectionJson}::${recipeContract}::${depsContent}`).digest('hex')
}

/**
 * The catalog session's settle record — `scenarios/dependencies.settle.json`, a
 * sibling of the catalog it settles. Carried in the setup bundle so the next
 * clone inherits the verdict "these session inputs were already classified"
 * instead of re-running the session.
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

/** Sorted derived web place `(id, address)` pairs :: the recipe CONTRACT as it
 *  stands before the preparations step, the seed included — the interfaces
 *  step re-runs when a screen appeared, moved or vanished, or when the promise
 *  it derives against changed, the principals it signs in with among it. A
 *  dependency bump, a catalog edit, and the preparations a later step of the
 *  same run writes reach none of it.
 *  Exported for the pre-flight estimate's settled check. */
export function interfacesFingerprint(repoRoot: string): string {
  return createHash('sha256')
    .update(`${derivedWebPlacePairs(repoRoot)}::${authoringRecipeContract(repoRoot)}`)
    .digest('hex')
}

/** {@link interfacesFingerprint} as it was computed before the slices — the one
 *  check a settled row with no components gets. Delete with the legacy hash. */
export function legacyInterfacesFingerprint(repoRoot: string): string {
  return createHash('sha256')
    .update(`${derivedWebPlacePairs(repoRoot)}::${computeRecipeFingerprint(repoRoot)}`)
    .digest('hex')
}

/** The derived web places as sorted `(id, address)` lines. */
function derivedWebPlacePairs(repoRoot: string): string {
  return (readInterfaceCatalog(repoRoot)?.resources?.['web'] ?? [])
    .map((place) => `${place.id}\x00${place.address ?? ''}`)
    .sort()
    .join('\n')
}

/**
 * The seed step's fingerprint off the tree as it stands — the estimate's
 * settled check, the exact value the running step computes, and the seed
 * session's cache key. The recipe CONTRACT before the preparations step (the
 * seed's own block is in it: the row is stamped after the seed wrote, and a
 * seed deleted by hand re-opens the step) plus the catalog's IDENTITY: which
 * classes of starting state exist, never how the catalog session worded them,
 * and never a dependency version the seed does not read; plus the SCHEMA
 * files the parsers read the product's data model from (`schemaFiles`, from
 * the detection), whose change re-seeds.
 */
export function computeSeedStepFingerprint(repoRoot: string, schemaFiles: readonly string[]): string {
  return createHash('sha256')
    .update(
      `${recipeContractFingerprint(repoRoot, 'preparations')}::${dependencyCatalogIdentity(repoRoot)}::${schemaFilesFingerprint(repoRoot, schemaFiles)}`,
    )
    .digest('hex')
}

/** One digest over the schema files' paths and contents, as they stand in the tree. */
export function schemaFilesFingerprint(repoRoot: string, schemaFiles: readonly string[]): string {
  const hash = createHash('sha256').update('schema')
  for (const file of [...schemaFiles].sort()) {
    let content: Buffer | string
    try {
      content = fs.readFileSync(path.join(repoRoot, file))
    } catch {
      content = '\0missing'
    }
    hash.update(`\n${file}\t${createHash('sha256').update(content).digest('hex')}`)
  }
  return hash.digest('hex')
}

/**
 * The schema files the last setup's detection recorded: what the pre-flight
 * estimate folds into the seed's keys, since it runs no analysis pass of its own.
 */
export function recordedSchemaFiles(repoRoot: string): string[] {
  return readGuardSetup(repoRoot)?.detection?.database?.schemaFiles ?? []
}

/** The detection snapshot's datastore row, as the setup report records it. */
function detectedDatabaseRow(database: SeedDraftDatabase): NonNullable<NonNullable<GuardSetupReport['detection']>['database']> {
  return {
    type: database.type,
    driver: database.driver,
    tables: database.tables.length,
    ...(database.schemaFiles && database.schemaFiles.length > 0 ? { schemaFiles: database.schemaFiles } : {}),
  }
}

/** {@link computeSeedStepFingerprint} as it was computed before the slices —
 *  the one check a settled row with no components gets, and the seed session's
 *  old cache key. Delete with the legacy hash. */
export function legacySeedStepFingerprint(repoRoot: string): string {
  const depsHash = createHash('sha256').update(dependenciesFileContent(repoRoot)).digest('hex')
  return createHash('sha256').update(`${computeRecipeFingerprint(repoRoot)}::${depsHash}`).digest('hex')
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
 * The named input a step whose session carries a hand-bumped stage version
 * records it under. Unlike every other name, one missing from a stored row
 * re-opens the step: that row settled under an earlier stage.
 */
const STAGE_INPUT = 'stage'

/**
 * A step's fingerprint inputs BY NAME, off the tree as it stands: what each
 * step fingerprint above folds, one digest per input, so two rows of the same
 * step can be compared input by input. `detect` has no fingerprint and no inputs.
 */
function stepInputComponents(
  repoRoot: string,
  key: GuardSetupTaxonomyKey,
  { detectionJson = '', schemaFiles = [] }: StepObservations,
): Record<string, string> {
  const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex').slice(0, 16)
  switch (key) {
    case 'recipe':
      // Off the detection snapshot the row was recorded with, so the needs the
      // gate compares are the needs of the world this run actually saw.
      return { needs: digest(needsFingerprint(recipeNeeds(parseDetectionSnapshot(detectionJson)))) }
    case 'detect':
      return {}
    case 'catalog':
      return {
        detection: digest(detectionJson),
        'recipe.contract': digest(recipeContractFingerprint(repoRoot, 'seed')),
        catalog: digest(dependenciesFileContent(repoRoot)),
      }
    case 'interfaces':
      return {
        places: digest(derivedWebPlacePairs(repoRoot)),
        'recipe.contract': digest(authoringRecipeContract(repoRoot)),
      }
    case 'seed':
      return {
        [STAGE_INPUT]: `seed-v${SEED_STAGE_VERSION}`,
        'recipe.contract': digest(recipeContractFingerprint(repoRoot, 'preparations')),
        catalog: digest(dependencyCatalogIdentity(repoRoot)),
        schema: digest(schemaFilesFingerprint(repoRoot, schemaFiles)),
      }
    case 'preparations':
      return preparationFingerprintComponents(repoRoot)
    case 'auth':
      return { supplied: digest(authFingerprint(repoRoot)) }
  }
}

/**
 * The fingerprint a step records when it could not read its own inputs — it ran
 * without the session it needs, so there is nothing to settle on. Such a row
 * never settles, whatever it carries beside the fingerprint.
 */
const UNSETTLEABLE_FINGERPRINT = 'authoring-unavailable'

/**
 * What a run observed that some steps' inputs are computed from: the detection
 * snapshot (the recipe's needs, the catalog) and the schema files the parsers
 * read (the seed). A caller that has not observed them passes nothing.
 */
export interface StepObservations {
  detectionJson?: string
  schemaFiles?: readonly string[]
}

/** A settled step row, as the next run's gate reads it. */
export interface SettledStepRow {
  inputFingerprint: string
  /** The row's inputs by name; absent on a row written before they existed. */
  inputComponents?: Record<string, string>
}

/**
 * The prior run's settled rows, per step. A row settles when it ran `ok` — or
 * when it was itself a `skipped`/`unchanged` carry-forward of an earlier `ok`,
 * so a third run does not bounce back to re-running. `blocked` and every real
 * `skipped` reason never settle: those steps re-evaluate every run (cheaply —
 * their gates refuse again) until the state moves.
 *
 * Exported for the pre-flight estimate, which probes the SAME settled rows the
 * run will skip on.
 */
export function settledSteps(
  repoRoot: string,
  refresh: boolean,
): (key: GuardSetupTaxonomyKey) => SettledStepRow | null {
  if (refresh) return () => null
  const prior = readGuardSetup(repoRoot)
  const byKey = new Map<GuardSetupTaxonomyKey, SettledStepRow>()
  for (const row of prior?.steps ?? []) {
    if (row.inputFingerprint === UNSETTLEABLE_FINGERPRINT) continue
    if (row.status === 'ok' || (row.status === 'skipped' && (row.reason === 'unchanged' || row.key === 'preparations'))) {
      byKey.set(row.key, {
        inputFingerprint: row.inputFingerprint,
        ...(row.inputComponents ? { inputComponents: row.inputComponents } : {}),
      })
    }
  }
  return (key) => byKey.get(key) ?? null
}

/**
 * Does a settled step row still hold? The flow compare's rule, for the step
 * spine: a row WITH named inputs is compared name by name under the step's
 * current scheme, so changing what a step folds re-opens nothing by itself. A
 * row that predates the names is compared against the step's OLD fingerprint,
 * once — it then settles again with names, and never takes this path twice.
 * The one exception is a step's {@link STAGE_INPUT}: a row must carry the
 * stage version the step runs now, or it re-opens.
 */
export function stepSettled(
  repoRoot: string,
  key: GuardSetupTaxonomyKey,
  settled: SettledStepRow | null,
  legacyFingerprint: string,
  observed: StepObservations = {},
): boolean {
  if (!settled) return false
  const current = stepInputComponents(repoRoot, key, observed)
  // The stage version is never filled in: a row that does not carry the
  // stage the step runs now settled under an older one.
  if (STAGE_INPUT in current && settled.inputComponents?.[STAGE_INPUT] !== current[STAGE_INPUT]) return false
  // Names that share nothing with the step's scheme prove nothing about it:
  // such a row is compared like one that has none.
  const stored = settled.inputComponents
  if (stored && Object.keys(current).some((name) => name in stored)) {
    return movedSchemeInputs(stored, current).length === 0
  }
  return settled.inputFingerprint === legacyFingerprint
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

// ---------------------------------------------------------------------------
// The step facts: one line per thing a step did
// ---------------------------------------------------------------------------

/** One detected third party: how it was seen, and the variables it is reached through. */
function detectedServiceFact(service: DetectedExternalService): string {
  const evidence = service.evidence[0]
  const how =
    service.source === 'http'
      ? `outbound requests to ${hostOf(evidence?.url) ?? 'a third-party host'}`
      : service.source === 'binary'
        ? `spawned binary \`${evidence?.binary ?? service.service}\``
        : `sdk import${evidence?.importSource ? ` \`${evidence.importSource}\`` : ''}`
  const parts = [`${service.service}: ${how}`]
  if (service.category) parts.push(`category ${service.category}`)
  const baseUrlEnvs = [
    ...new Set([
      ...(service.baseUrlEnvs ?? []).map((e) => e.envVar),
      ...(service.baseUrlEnv ? [service.baseUrlEnv] : []),
    ]),
  ]
  if (baseUrlEnvs.length > 0) parts.push(`base url from ${baseUrlEnvs.join(', ')}`)
  const credentialEnvs = (service.credentialEnvs ?? []).map((e) => e.envVar)
  if (credentialEnvs.length > 0) parts.push(`credential from ${credentialEnvs.join(', ')}`)
  return parts.join('; ')
}

/** One need nothing provides, as a line and as the row records it. */
function unprovidedNeedFact(entry: UnprovidedNeed): string {
  const where = entry.answer === 'recipe' ? 'the recipe must provide' : 'someone must register'
  return `${entry.need.id} is not provided: ${where} ${entry.provides}`
}

function recordedNeed(entry: UnprovidedNeed): GuardSetupUnprovidedNeed {
  return { need: entry.need.id, provides: entry.provides, answer: entry.answer }
}

/** The host of a detected URL literal, when it parses. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

/** The datastore connection URLs, one line per distinct scheme + override variable.
 *  The URL literal itself is never echoed: a dev default can carry a password. */
function datastoreUrlFacts(refs: readonly DatastoreUrlRef[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const ref of refs) {
    const key = `${ref.scheme}\x00${ref.envVar ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(
      ref.envVar
        ? `datastore url: ${ref.scheme}, overridden by ${ref.envVar}`
        : `datastore url: ${ref.scheme}, no override variable`,
    )
  }
  return out
}

/** What the deterministic externals skeleton did to `recipe.json` this run. */
function externalsSkeletonFacts(step: GuardSetupExternalsStep): string[] {
  if (step.status === 'failed') {
    return [`the externals skeleton was refused: ${firstReasonLine(step.reason ?? 'no reason reported')}`]
  }
  if (step.status === 'skipped') {
    return [`no external service was declared: ${firstReasonLine(step.reason ?? 'no reason reported')}`]
  }
  const out: string[] = []
  for (const service of step.declared) out.push(`declared \`${service}\` under api.externals`)
  for (const service of step.undeclarable) {
    out.push(`\`${service}\` was not declared: no base-url variable points anywhere`)
  }
  for (const service of step.unprovided) out.push(`\`${service}\` is declared but has no account behind it yet`)
  return out
}

/** The catalog as it stands: one line per entry, with the class and how an
 *  instance is registered. A catalog that does not parse says so and nothing more. */
function catalogEntryFacts(repoRoot: string): string[] {
  let entries: ReturnType<typeof loadDependencyCatalog>['dependencies']
  try {
    entries = loadDependencyCatalog(repoRoot).dependencies
  } catch (error) {
    return [`scenarios/dependencies.json could not be read: ${(error as Error).message}`]
  }
  return entries.map((entry) => {
    if (entry.class !== 'supplied') return `${entry.name}: ${entry.class}`
    const registration = entry.registration
    if (registration?.kind === 'env') {
      return `${entry.name}: supplied, env ${registration.vars.map((v) => v.name).join(', ')}`
    }
    if (registration?.kind === 'path') return `${entry.name}: supplied, a path on this machine`
    if (registration?.kind === 'config-dir') {
      return `${entry.name}: supplied, a config dir copied to ${registration.homePath}`
    }
    return `${entry.name}: supplied`
  })
}

/** What the derivation produced, per surface, plus the web places the authoring
 *  half stands on. */
function derivedInterfaceFacts(repoRoot: string, interfaces: readonly Interface[]): string[] {
  const perType = new Map<string, number>()
  for (const entry of interfaces) perType.set(entry.type, (perType.get(entry.type) ?? 0) + 1)
  const out = [...perType]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type}: ${count} interface${count === 1 ? '' : 's'} derived`)
  const places = readInterfaceCatalog(repoRoot)?.resources?.['web']?.length ?? 0
  if (places > 0) out.push(`web: ${places} place${places === 1 ? '' : 's'} derived`)
  if (out.length === 0) out.push('the derivation produced no interfaces')
  return out
}

/** How the seed the step ended with came to be. */
function seedOutcomeFact(step: GuardSetupSeedStep, fromCache: boolean): string {
  if (step.status !== 'ok') return `seed refused: ${firstReasonLine(step.reason ?? 'no reason reported')}`
  if (step.outcome === 'exists') return 'the recipe already declares `api.seed`; it was not re-drafted'
  const where = step.scriptPath ? `, ${step.scriptPath}` : ''
  const head = fromCache
    ? `seed re-proved from cache${where}`
    : `seed proved by running it against the live services${where}`
  return step.salvaged ? `${head}; salvaged from a session that produced no outcome` : head
}

/** What the seed puts into the world, one line per fixture and per principal. */
function seedProvidesFacts(step: GuardSetupSeedStep): string[] {
  if (step.status !== 'ok') return []
  return [
    ...(step.fixtures ?? []).map((name) => `seed fixture: ${name}`),
    ...(step.credentials ?? []).map((name) => `seed principal: ${name}`),
  ]
}

/** The private starting states the recipe carries, one line per usable profile. */
function preparationFacts(recipe: Recipe, repoRoot: string): string[] {
  const usable = preparationCatalog(recipe, repoRoot)
  const declared = Object.keys(recipe.preparations ?? {})
  const out = usable.map((profile) => {
    const provides = [
      ...Object.keys(profile.fixtures).map((name) => `fixture ${name}`),
      ...Object.keys(profile.credentials).map((name) => `principal ${name}`),
    ]
    const head = `${profile.name}: ${profile.baseline} baseline, ${profile.scope} scope`
    return provides.length > 0 ? `${head}, provides ${provides.join(', ')}` : head
  })
  const usableNames = new Set(usable.map((p) => p.name))
  for (const name of declared) {
    if (!usableNames.has(name)) out.push(`${name}: unusable, it carries no runner-verified baseline checks`)
  }
  return out
}

/** The recipe blocks discovery never proposes — the user's and setup's own work. */
interface AuthoredBlocks {
  preparations?: unknown
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
    ...(recipe.preparations !== undefined ? { preparations: recipe.preparations } : {}),
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
 * (a refresh that cannot restore loses the authored blocks visibly in the setup
 * report, never crashes the run).
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
  if (blocks.preparations !== undefined) doc.preparations = blocks.preparations
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
  // This deterministic enrichment also runs when the classification session is
  // already settled. Existing registrations and local secret overlays survive.
  try {
    const catalog = loadDependencyCatalog(repoRoot)
    const extended = extendCredentialRegistrations(catalog, detected)
    if (extended !== catalog) atomicWriteJson(dependenciesPath(repoRoot), extended)
  } catch (error) {
    return { ...base, status: 'failed', reason: `credential requirements could not be added: ${(error as Error).message}`, unprovided: [] }
  }
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
  if (added.length > 0 || Object.keys(skeleton.update).length > 0) {
    const written = writeExternals(repoRoot, { ...skeleton.declare, ...skeleton.update })
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
  atomicWriteJson(file, doc)
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
  /** The existing seed is the one the engine last drafted, unedited since. */
  engineDrafted: boolean
  /** Whether the tree setup was handed is a fresh checkout — the cold proof's gate. */
  freshCheckout: boolean
  onPhase: (running: string, done: string) => void
}): Promise<{
  step: GuardSetupSeedStep
  sessionRunId?: string
  fromCache?: boolean
  recipeDefect?: boolean
  /** The cold-clone proof stood down, in the seam's own words. */
  coldProofSkipped?: string
  unmet?: SeedUnmetRule[]
}> {
  const { opts, recipe, database, routes, schemes } = args
  const existing = recipe.api?.seed

  // Idempotence: a repo that already has a seed of its own and did not ask for
  // a refresh is REPORTED, not re-drafted. That is the whole "bare setup
  // no-ops" contract. A seed the engine drafted is the engine's: the step
  // re-opened because an input it was drafted from moved, so it is drafted again.
  if (existing && !opts.refresh && !args.engineDrafted) {
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
    // `refresh` is not consent to overwrite a hand-edited script; the caller is
    // asked, and a caller that cannot ask answers false.
    replaceExisting = args.engineDrafted || ((await opts.confirmSeedReplace?.()) ?? false)
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

  // THE SEED SESSION — the one-shot `draftSeed` retired into
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
    freshCheckout: args.freshCheckout,
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
      ...(result.fromCache ? { fromCache: true } : {}),
      ...(result.coldProofSkipped ? { coldProofSkipped: result.coldProofSkipped } : {}),
      ...(result.unmet && result.unmet.length > 0 ? { unmet: result.unmet } : {}),
    }
  }
  return {
    step: { status: result.status, reason: result.reason },
    ...(result.sessionRunId ? { sessionRunId: result.sessionRunId } : {}),
    ...(result.recipeDefect ? { recipeDefect: true } : {}),
  }
}

/**
 * A digest of the `api.seed` block and the script it names, as they stand now:
 * what the seed row's `draftedSeed` records. Null when no seed is declared.
 */
function seedDigest(repoRoot: string, recipe: Recipe): string | null {
  const seed = recipe.api?.seed
  if (!seed) return null
  const script = readExistingSeedScript(repoRoot, recipe)?.scriptContent ?? ''
  return createHash('sha256').update(JSON.stringify(seed)).update('\0').update(script).digest('hex').slice(0, 16)
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

/** Discovery's phases, in the words a reader of the progress line needs. */
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
