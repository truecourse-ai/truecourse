/**
 * `guard generate` orchestration — the LLM pipeline that turns spec FLOWS into
 * committed scenarios. The generation unit is the flow (a user-goal path over
 * spec claims); sections remain the binding/staleness anchor underneath it.
 * Stages, all output-only (the model returns content; the engine writes):
 *
 *   1. recipe   load `recipe.json`, or discover + verify one (proposal-only LLM).
 *   2. index    deterministic doc universe + section index + change detection.
 *   3. extract  one cached call per document view → claims + untestable notes,
 *               anchors snapped to the live index. Claims are no longer the
 *               generation unit — they are the milestone vocabulary.
 *   4. journeys deterministic, free: the app's own surfaces, mapped from the tree.
 *   5. flows    per-area synthesis + the epic pass → `scenarios/flows.json`.
 *   6. match    per (flow, surface with a catalog): the realization plan, or an
 *               explicit `unrealizable` — the join of the two halves.
 *   7. author   one Opus call per (flow, surface with a plan) → one scenario whose
 *               steps carry the milestone each realizes.
 *   8. birth    run every candidate once; re-author a failing FLOW once with its
 *               evidence; a still-failing candidate is triaged (item 81) and
 *               ROUTED (item 80): repo-blamed or untriaged → COMMITTED as a
 *               failing test with its diagnosis; generation-defect → withheld.
 *   9. persist  INDEPENDENTLY: every scenario is written the moment its birth
 *               execution settles — passing or failing. Only a "test is wrong"
 *               verdict (a fidelity rejection, a generation-defect triage)
 *               withholds one; there is no held state.
 *  10. manifest rewrite the flow-keyed binding record with the settled outcomes,
 *               each scenario carrying the status it was committed with.
 *
 * A flow whose `generationInputsHash` still matches the manifest is a no-op: it is
 * matched from cache (free), its committed scenarios stand, and the gaps only
 * AUTHORING could have derived are carried forward from its entry. Everything a
 * flow cannot realize lands as a per-surface gap (`no-journey` / `unrealizable` /
 * `awaiting-driver` / `blocked-on`) in both the report and the manifest.
 *
 * THE SETTLE INVARIANT binds every write: a flow that records its hash accounts for
 * each surface it PLANNED with a committed test XOR a gap. An entry that would
 * settle in silence stays unsettled with the reason recorded, and an entry already
 * violating it is treated as work (its hash disregarded) so the hole re-runs.
 */

import { createHash } from 'node:crypto'
import pLimit from 'p-limit'
import os from 'node:os'
import { z } from 'zod'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import type { LlmTransport } from '@truecourse/shared/llm'
import {
  writeManifest,
  readManifest,
  readGuardDecisions,
  readGuardAutoResolutions,
  writeGuardAutoResolutions,
  readJourneyCatalog,
  manifestPath,
  runBuild,
  runInstall,
  resolveEntry,
  resolveApiServers,
  credentialServers,
  buildRouteManifest,
  loadRecipe,
  recipePath,
  preflightEntry,
  formatEntryPreflightError,
  isSetupDefectResult,
  defaultGuardExecutor,
  loadResolvedExternals,
  detectNoOpAnomaly,
  foldStepStats,
  type GuardNoOpAnomaly,
  type GuardRunStepStats,
  type ResolvedExternal,
  type GuardExecutor,
  type Recipe,
  type BuildResult,
  type EntryPreflightResult,
} from '@truecourse/guard-runner'
import {
  GUARD_FORMAT_VERSION,
  DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER,
  autoResolutionKey,
  composeBlockedOnReason,
  dismissedClaimKey,
  firstInvalidMatchPattern,
  guardDriver,
  isRunnableDriver,
  runnableDriverIds,
  unaccountedSurfaces,
  violatesSettleInvariant,
  runRefusalError,
  type GuardAutoResolutionEntry,
  type GuardAutoResolutionSource,
  type GuardAutoResolved,
  type GuardBirthFinding,
  type GuardFlowTaint,
  type OutputExcerpts,
  type ApiRequestContract,
  type DatastoreUrlRef,
  type DetectedExternalService,
  type OutboundRequest,
  type GuardCoverageGap,
  type GuardDismissedClaim,
  type GuardDriverId,
  type GuardEntryPreflight,
  type GuardFlow,
  type GuardFlowsReport,
  type GuardGenerateError,
  type GuardJourneysReport,
  type GuardManifestFlow,
  type GuardManifestGap,
  type GuardManifestScenario,
  type GuardOrphanedDismissal,
  type GuardOrphanedFlowDismissal,
  type GuardRunRefusal,
  type GuardScenario,
  type GuardScenarioDiagnosis,
  type GuardTestStatus,
  type Journey,
} from '@truecourse/shared'
import {
  planGuardWork,
  collectWorkDocs,
  hasGuardUniverse,
  sectionInputsKey,
  flowGenerationInputsHash,
  type SectionInput,
} from './section-plan.js'
import { buildOperationIndex, matchedRequestSchemas, parseOperationSection, type OperationEntry } from './openapi-enrich.js'
import {
  resolveSectionAuth,
  recipeAuthCredentials,
  validateCredentialSatisfies,
  type SatisfiedScheme,
} from './openapi-security.js'
import { parseOpenApiSpec } from '@truecourse/shared/openapi'
import {
  GENERATE_PROMPT_FINGERPRINT,
  GENERATE_API_PROMPT_FINGERPRINT,
  FIDELITY_PROMPT_FINGERPRINT,
  type AuthorMilestone,
  type AuthorUserContext,
  type JourneyContractHint,
  type OutboundRequestHint,
  type BirthRetryContext,
  type ExternalServiceHint,
  type FidelityUserContext,
} from './prompts.js'
import {
  AuthoredFlowScenarioSchema,
  RawGeneratedScenarioSchema,
  FidelityReviewSchema,
  type RawGeneratedScenario,
} from './schemas.js'
import {
  spawnExtractRunner,
  spawnGenerateRunner,
  spawnRecipeRunner,
  spawnFidelityRunner,
  spawnTriageRunner,
  spawnFlowsRunner,
  spawnFlowsEpicRunner,
  spawnMatchRunner,
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
  type FidelityRunner,
  type TriageRunner,
  type FlowsRunner,
  type FlowsEpicRunner,
  type MatchRunner,
} from './runners.js'
import { runTriage, type TriageMilestone } from './triage.js'
import { extractDocClaims, countExtractViews, type DocClaims } from './extract.js'
import {
  synthesizeFlows,
  buildFlowAreas,
  flowSectionKey,
  type FlowAreaDocInput,
  type FlowClaimInput,
} from './flows.js'
import {
  buildSurfaceCatalogs,
  matchFlow,
  realizationLines,
  type RealizationPlan,
  type SurfaceCatalog,
} from './match.js'
import { groundProbes, type ProbeTranscript } from './ground.js'
import { flattenZodError, quoteInvalidOutput, scenarioCompositionDefect } from './validate.js'
import { mineExampleBlocks, exampleFidelityDefect, type DocExampleBlock } from './examples.js'
import { discoverRecipe } from './recipe-discovery.js'
import type { SeedDraftDatabase } from './seed-draft.js'
import { routesFromJourneys } from './recipe-propose.js'
import { enrichBlockedOn } from './external-blocked.js'
import {
  buildJourneyContractHints,
  buildOtherOperationHints,
  buildOutboundRequestHints,
  outboundOverflow,
} from './grounding.js'
import { birthValidate, type BirthCandidate, type BirthOutcome, type BirthRound } from './birth.js'
import {
  buildServerRouteIndex,
  bindFlowServer,
  documentedApiPaths,
  missingServerBlockedOn,
  multiServerBlockedOn,
  servedByOtherApp,
  appDirOfServer,
  MISSING_SERVER_NOUN,
  type ServerRouteIndex,
} from './server-binding.js'
import {
  assignScenarioId,
  buildFlowScenario,
  areaOrDocSlug,
  writeScenarioFile,
  serializeScenarioYaml,
  deleteScenarioFiles,
  existingScenarioIds,
} from './serialize.js'

export const GENERATE_CACHE_NAME = 'guard/generate'
export const FIDELITY_CACHE_NAME = 'guard/fidelity'

/** Sentinel anchor for the single entry-preflight error — it belongs to no section. */
const ENTRY_PREFLIGHT_ANCHOR = '(entry preflight)'

/**
 * Ceiling on isolated birth re-confirmations per generate (layer d). Each isolated
 * re-run is a fresh services.up + seed + boot, so the cost scales with the number of
 * FAILURES — the whole point — but a pathological run with hundreds of failing
 * candidates must not spawn hundreds of boots. Beyond this, remaining would-be
 * findings settle as findings with the (polluted) batch evidence.
 */
const ISOLATION_CAP = 20

// ---------------------------------------------------------------------------
// Result + option types
// ---------------------------------------------------------------------------

export interface GeneratedScenarioInfo {
  id: string
  title: string
  /** The scenario's PRIMARY binding — its flow's first milestone's section. */
  doc: string
  anchor: string
  /** Repo-relative path of the written `.yaml`. */
  file: string
  /** The flow this scenario realizes. */
  flowId: string
  /** The surface it runs on. */
  surface: GuardDriverId
  /** The status the test was committed with — `failing` when it failed at birth. */
  status: GuardTestStatus
}

/**
 * A test's BIRTH-stage failure result — the doc-vs-code disagreement (or authoring
 * defect) the committed test records, or a fidelity rejection (never committed).
 * The single definition lives in `@truecourse/shared`
 * (`GuardBirthFindingSchema`); re-exported here so the generator's public API is
 * unchanged. It carries the failing run's raw `stdout`/`stderr` excerpts (Fix 1)
 * and, for a flow scenario, the milestone the failing step realized.
 */
export type { GuardBirthFinding } from '@truecourse/shared'

/**
 * One error a generate recorded. The single definition lives in `@truecourse/shared`
 * (`GuardGenerateErrorSchema`) — it is what `result.json` is validated against, and a
 * second structural copy here drifted from it the moment the schema gained the
 * `kind`/`flowId` discriminator. Re-exported so the generator's public API is unchanged.
 */
export type { GuardGenerateError } from '@truecourse/shared'

/**
 * A document whose claim extraction could not complete — the model returned
 * invalid output even after one corrective re-ask, or a call threw. An error
 * state, NOT an empty extraction: the doc's claims are missing from synthesis, so
 * the areas that read them are reported and re-attempt next run.
 */
export interface GuardExtractionFailure {
  doc: string
  /** One-line reason — the flattened Zod message or the thrown error text. */
  reason: string
}

/**
 * One failed authoring ATTEMPT, surfaced the moment it happens. Authoring is one
 * call per (flow, surface), and a failing call is otherwise invisible while it
 * runs: the flow never ticks the settle counter, so a call that is timing out
 * looks exactly like a slow one. Fired once per failed attempt — a corrective
 * re-ask fires twice (`willRetry: true`, then the final `false`).
 */
export interface AuthorFailure {
  /** The flow whose authoring failed. */
  flowId: string
  /** The flow's title — the words a surface names the unit by. */
  flowTitle: string
  /** The surface being authored (one call per flow+surface). */
  surface: GuardDriverId
  /** The flow's PRIMARY binding — where every coverage surface attributes it. */
  doc: string
  anchor: string
  /** One-line reason — `timed out after 10m`, `invalid output`, … */
  reason: string
  /** 1-based attempt index: 1 = the first call, 2 = the corrective re-ask. */
  attempt: number
  /** True when another attempt follows; false on the final failure. */
  willRetry: boolean
}

export interface GuardGenerateResult {
  status: 'no-docs' | 'recipe-failed' | 'ok'
  /** For `no-docs` / `recipe-failed`: the user-facing reason. */
  reason?: string
  /** `entry` is the cli preparation (absent on an api-only recipe); `serve` the api one. */
  recipe?: {
    status: 'exists' | 'discovered'
    entry?: string[]
    serve?: string[]
    wrotePath?: string
    /** The datastore compose file discovery GENERATED beside the recipe (item 68),
     *  repo-root-relative. Both files are artifacts the user reviews and commits. */
    composePath?: string
    /** Which proposer produced a freshly discovered recipe (absent for `exists`). */
    source?: 'deterministic' | 'llm'
    /** Fill-ins the proposer could not decide — printed, never silently dropped. */
    todos?: string[]
    /**
     * Advisory recipe diagnostics that did NOT stop the run (item 56): a credential
     * declaring a `satisfies` in a corpus with no OpenAPI document at all. The
     * un-resolvable-scheme case is an error, not a warning — it fails the run with
     * `status: 'recipe-failed'`.
     */
    warnings?: string[]
  }
  sectionsTotal: number
  /** Sections whose text moved since the last generate, plus sections no flow binds. */
  sectionsChanged: number
  skippedUnchanged: number
  /** True when no flow needed work and none was removed — the confirm/run was a no-op. */
  noChanges: boolean
  /** Every test committed this run, passing and failing alike. */
  written: GeneratedScenarioInfo[]
  coverageGaps: GuardCoverageGap[]
  /** The birth-stage failure results (item 80): the committed failing tests
   *  (repo-blamed or untriaged), plus the withheld classes — generation-defect
   *  verdicts and fidelity rejections. For a fresh run, `written('failing').length
   *  === birthFindings committed rows` — the routing's arithmetic identity. */
  birthFindings: GuardBirthFinding[]
  errors: GuardGenerateError[]
  extractionFailures: GuardExtractionFailure[]
  orphaned: { doc: string; anchor: string; scenarioIds: string[] }[]
  /**
   * Birth outcomes that PASSED across both validation rounds. A birth pass is
   * written unless the fidelity reviewer flags it, so `written` differs from this
   * by the fidelity rejections (fewer) and the committed failing tests (more).
   */
  birthPassed: number
  /**
   * Dismissals in `scenarios/decisions.json` whose claim text matched nothing in a
   * doc this run extracted — stale entries surfaced (never silently honored).
   */
  orphanedDismissals: GuardOrphanedDismissal[]
  /** `dismissedFlows` entries that matched no live flow after synthesis. */
  orphanedFlowDismissals: GuardOrphanedFlowDismissal[]
  /**
   * The auto-resolved rows this run (item 83) — high-confidence machine judgments
   * the tool acted on itself, each also counted in the durable ledger
   * (`guard/auto-resolutions.json`) that escalates a non-converging flow to a
   * human task. A visible record, never silence.
   */
  autoResolved: GuardAutoResolved[]
  /** The flow-led counts — the run's headline under flow-keyed generation. */
  flows: GuardFlowsReport
  /** The journey catalog the run matched against. */
  journeys: GuardJourneysReport
  /**
   * The third parties this repo imports (item 57) — the whole detected list, not
   * only the ones a blocked flow named, so a reader sees "this repo talks to stripe
   * and sendgrid" independently of whether any flow was blocked. Empty when nothing
   * was detected OR when journey mapping degraded to the snapshot.
   */
  externalServices: DetectedExternalService[]
  manifestPath?: string
  /**
   * Present ONLY when the built entry failed to start — the birth phase was
   * short-circuited into ONE loud error (in `errors`), so every cli-bearing flow
   * stayed unsettled. Zero birth findings.
   */
  entryPreflight?: GuardEntryPreflight
  /**
   * Present ONLY when the runner REFUSED the run (a broken recipe, a
   * half-configured external account). Birth validated nothing, so every candidate
   * flow stayed unsettled — with ONE run-level error, never one per candidate.
   */
  refusal?: GuardRunRefusal
  /**
   * The recipe-inputs fingerprint (`sha256:…`, which folds the seed script's
   * content) this generate authored against. Persisted so a later READ can tell a
   * gap the current recipe + seed already produced from one that predates an edit
   * — "re-run guard generate" is only honest advice for the latter. Absent when
   * the recipe failed before a fingerprint existed.
   */
  recipeFingerprint?: string
}

export interface GuardGenerateModels {
  extract?: string
  /** Flow synthesis + the epic pass (stage `guard.flows`). */
  flows?: string
  /** Realization matching (stage `guard.match`). */
  match?: string
  generate?: string
  /** Evidence-retry re-authoring (stage `guard.retry`); defaults to `generate`. */
  retry?: string
  /** Fidelity review (stage `guard.fidelity`) — a cheap-tier adversarial pass. */
  fidelity?: string
  /** Failing-test triage (stage `guard.triage`) — the top-tier post-birth judgment. */
  triage?: string
  recipe?: string
  fallback?: string
}

/**
 * Where the journey catalog comes from. Mapping needs the ANALYZER, which lives
 * above this package, so the caller injects it (core's `mapJourneys`). Omitted, the
 * generator falls back to the last mapping's snapshot and then to an empty catalog:
 * degradation is defined, never inherited — an empty surface settles as an honest
 * `no-journey` gap instead of failing the spec half of the pipeline.
 */
export type JourneyProvider = () => Promise<{
  journeys: Journey[]
  /**
   * The repo's detected third-party dependencies (item 57). Derived from the SAME
   * analysis pass as the journeys — a pure read of the analyzer's import registry —
   * so it rides this seam rather than opening a second one that would re-analyze the
   * tree. Omitted (a provider that predates it, or the snapshot fallback) reads as
   * "not detected": every blocked-on reason keeps its generic noun.
   */
  externalServices?: DetectedExternalService[]
  /**
   * The repo's datastore + its PARSED schema (item 66), off the same analysis pass
   * for the same reason. Omitted (an older provider, the snapshot fallback) reads as
   * "no database detected": the seed-drafting stage skips with exactly that reason.
   */
  database?: SeedDraftDatabase | null
  /**
   * The datastore connection URLs the tree declares (item 68), off the same pass
   * again. They are what the recipe proposer GENERATES a compose file from when the
   * repo needs a database and ships none. Omitted (an older provider, the snapshot
   * fallback) ⇒ nothing is generated, and such a repo gets item 67's guided failure.
   */
  datastoreUrls?: DatastoreUrlRef[]
  /**
   * What each api operation's handler reads off the request (item 69), off the same
   * pass again — the exact paths + required body fields the authoring prompt shows
   * per journey. Omitted (an older provider, the snapshot fallback) ⇒ the prompt
   * renders no contract block, exactly as before item 69.
   */
  requestContracts?: ApiRequestContract[]
  /**
   * How the app constructs its OUTBOUND requests and which response fields it reads
   * back (item 69). What a `setup.http` stub must satisfy to be accepted by the app
   * it fakes for. Omitted ⇒ no outbound block, as before item 69.
   */
  outboundRequests?: OutboundRequest[]
}>

export interface GenerateGuardsOptions {
  repoRoot: string
  transport?: LlmTransport
  models?: GuardGenerateModels
  /**
   * The execution seam birth validation runs through. Core passes
   * `getGuardExecutor()` (OSS in-process default, or the EE hosted executor);
   * defaults to `defaultGuardExecutor` when omitted so generate stays runnable
   * standalone.
   */
  executor?: GuardExecutor
  concurrency?: number
  /** Isolated birth re-confirmation ceiling (layer d); defaults to {@link ISOLATION_CAP}.
   *  Lowered by tests to exercise the cap without hundreds of boots. */
  isolationCap?: number
  /**
   * C4's cli no-op classification threshold (a step under this wall-clock, exit 0,
   * no output, counts as a no-op) — a test seam so the anomaly gate is drivable
   * without relying on sub-10ms real process timing. Defaults to the runner's
   * `NO_OP_STEP_THRESHOLD_MS`. The api predicate has no timing knob: loopback
   * latency does not separate a dead stub from a healthy server, so it judges
   * body emptiness + status uniformity instead.
   */
  noOpThresholdMs?: number
  /**
   * Item-83 escalation threshold: how many times a flow's test may auto-resolve
   * (a fidelity self-heal, a generation-defect retirement) before it surfaces as
   * a human task instead. Defaults to {@link DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER};
   * tests lower it to observe escalation in fewer runs.
   */
  escalateAutoResolveAfter?: number
  /** Journey mapping seam — see {@link JourneyProvider}. */
  journeys?: JourneyProvider
  /**
   * Item 78's hard gate: refuse to run without a committed `recipe.json` instead of
   * deriving one. TRUE on every working-tree path (`truecourse guard setup` owns
   * derivation now); FALSE on the hosted/EE ephemeral-checkout paths, which have no
   * user to run setup and must stay self-sufficient. Defaults to false so the engine
   * is unchanged for any caller that does not opt in.
   */
  requireExistingRecipe?: boolean
  /**
   * INTERNAL test seam: stop after flow synthesis, before journey matching and
   * authoring. Not a user-facing option and not exposed by any command — flow
   * curation is `dismissedFlows` and cost control is the estimate gate.
   */
  stopAfterFlows?: boolean
  // --- test seams (production injects none) ---
  extractRunner?: ExtractRunner
  generateRunner?: GenerateRunner
  recipeRunner?: RecipeRunner
  fidelityRunner?: FidelityRunner
  triageRunner?: TriageRunner
  flowsRunner?: FlowsRunner
  flowsEpicRunner?: FlowsEpicRunner
  matchRunner?: MatchRunner
  // --- progress hooks ---
  onPlan?: (total: number, work: number) => void
  onExtractProgress?: (done: number, total: number) => void
  /** Per-VIEW extraction progress (a chunked doc is many view calls) — the live
   *  counter. Fires `(0, total)` as soon as the view plan is known (views are
   *  planned per doc upfront), then once per completed view. */
  onExtractViewProgress?: (done: number, total: number) => void
  /** Journey mapping settled: how many journeys were derived, across all surfaces. */
  onJourneys?: (journeys: number, surfaces: number) => void
  /** Flow synthesis progress, ticking per area as it settles. */
  onFlowProgress?: (done: number, total: number) => void
  /** Realization-matching progress, ticking per (flow, surface) pair. */
  onMatchProgress?: (done: number, total: number) => void
  /** Authoring progress over the (flow, surface) pairs with a realization plan. */
  onAuthorProgress?: (done: number, total: number) => void
  /** Grounding probe progress — captured vs planned probes across all authoring
   *  calls; the planned total grows as later flows enter grounding. */
  onGroundProgress?: (captured: number, planned: number) => void
  /** Birth build/run phase transitions (forwarded from the runner) — for a "building…"
   *  detail. `confirm` is the generator's own isolated re-confirmation phase (layer d),
   *  carrying the number of would-be findings being re-checked in clean rooms. */
  onBirthPhase?: (phase: 'build' | 'run' | 'confirm', total?: number) => void
  /** Birth progress, ticking per settled scenario across both rounds. */
  onBirthProgress?: (done: number, total: number) => void
  /** Retry-authoring progress: `total` = failed flow scenarios being re-authored. */
  onRetryProgress?: (done: number, total: number) => void
  /** Fidelity-review progress: `reviewed` = green scenarios reviewed so far, `planned`
   *  = green scenarios queued for review. */
  onFidelityProgress?: (reviewed: number, planned: number) => void
  /** Failing-test triage progress: `total` = the run's birth failures (known once
   *  every birth round settles — the triage stage runs after them all). */
  onTriageProgress?: (done: number, total: number) => void
  /** Per-FLOW settle progress: `total` = the flows this run had work for. */
  onFlowSettled?: (settled: number, total: number) => void
  /** Fired the moment an authoring attempt fails — a thrown call, invalid output, or
   *  a rejected scenario. One event per failed attempt; the CLI renders it live and
   *  counts the flows that gave up. Optional, so callers that surface nothing (the
   *  dashboard popup) pass nothing and behave exactly as before. */
  onAuthorFailure?: (failure: AuthorFailure) => void
}

function defaultConcurrency(): number {
  const env = process.env.TRUECOURSE_MAX_CONCURRENCY
  if (env) {
    const n = parseInt(env, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return Math.min(os.cpus().length, 4)
}

/** The authoring system-prompt fingerprint for a surface — each driver has its own
 *  prompt, so a scenario's cache entry moves only when ITS prompt changes. */
function authorPromptFingerprint(surface: GuardDriverId): string {
  return surface === 'api' ? GENERATE_API_PROMPT_FINGERPRINT : GENERATE_PROMPT_FINGERPRINT
}

/**
 * Per-(flow, surface) authoring cache key: it moves when the flow's milestone
 * composition changes, when any bound section's content key moves (text, a
 * suppressed quote, a referenced OpenAPI schema, its security context), when the
 * realization plan's journeys move, when the recipe or the format version changes,
 * or when that surface's authoring prompt changes. Nothing else re-authors.
 */
export function authorCacheKey(
  flow: Pick<GuardFlow, 'fingerprint'>,
  surface: GuardDriverId,
  sectionKeys: readonly string[],
  journeyFingerprints: readonly string[],
  recipeFingerprint: string,
): string {
  const parts = [
    authorPromptFingerprint(surface),
    recipeFingerprint,
    String(GUARD_FORMAT_VERSION),
    surface,
    flow.fingerprint,
    [...sectionKeys].sort().join('~'),
    [...journeyFingerprints].sort().join('~'),
  ]
  return createHash('sha256').update(parts.join('::')).digest('hex')
}

/** Per-retry cache key: the round-1 key plus the birth evidence that drove the
 *  re-ask, so a stopped/re-run generate never re-pays the retry round. */
export function retryCacheKey(
  flow: Pick<GuardFlow, 'fingerprint'>,
  surface: GuardDriverId,
  sectionKeys: readonly string[],
  journeyFingerprints: readonly string[],
  recipeFingerprint: string,
  evidence: GuardBirthFinding,
): string {
  const evidenceHash = createHash('sha256')
    .update(
      [
        evidence.title,
        String(evidence.step),
        String(evidence.failedMilestone ?? ''),
        evidence.expected,
        evidence.actual,
        evidence.stdout ?? '',
        evidence.stderr ?? '',
      ].join('|'),
    )
    .digest('hex')
  return createHash('sha256')
    .update(
      [
        authorCacheKey(flow, surface, sectionKeys, journeyFingerprints, recipeFingerprint),
        evidenceHash,
      ].join('::'),
    )
    .digest('hex')
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function generateGuards(options: GenerateGuardsOptions): Promise<GuardGenerateResult> {
  const { repoRoot } = options
  // Birth validation runs through the injected execution seam (OSS in-process by
  // default); the recipe is the discovered/loaded one below, passed IN so the
  // executor never re-reads recipe.json.
  const executor = options.executor ?? defaultGuardExecutor

  if (!hasGuardUniverse(repoRoot)) {
    return emptyResult('no-docs', {
      reason: 'No corpus found. Run `truecourse spec scan` to curate the spec docs first.',
    })
  }

  // 1. Recipe — the shared entrypoint every scenario runs against.
  //
  // Item 78: on the WORKING-TREE path generate no longer DERIVES one. `truecourse
  // guard setup` does, before a single extraction call is paid for, precisely so
  // that fixing the recipe (which moves its fingerprint, which re-authors every
  // section generated against it) costs nothing. Generate loads what setup left and
  // stops if there is none. Hosted/EE keeps deriving: an ephemeral checkout has no
  // user to run setup in it, so the caller passes `requireExistingRecipe: false`.
  if (options.requireExistingRecipe) {
    let existing: ReturnType<typeof loadRecipe>
    try {
      existing = loadRecipe(repoRoot, recipePath(repoRoot))
    } catch (e) {
      return emptyResult('recipe-failed', { reason: (e as Error).message })
    }
    if (!existing) {
      return emptyResult('recipe-failed', {
        reason:
          'No .truecourse/scenarios/recipe.json. Run `truecourse guard setup` first — it derives and verifies the recipe, declares the external APIs this repo talks to, and prepares the seed, so `guard generate` never pays to discover any of it.',
      })
    }
  }
  const recipeRunner =
    options.recipeRunner ??
    spawnRecipeRunner({ transport: options.transport, model: options.models?.recipe, fallbackModel: options.models?.fallback })
  // Journey mapping is memoized: the deterministic recipe proposer ranks its health
  // path over the SAME route surface stage 4 walks, so a repo with no recipe maps
  // its journeys once, earlier — never twice.
  let mappedJourneys: Promise<MappedSurface> | null = null
  const journeysOnce = (): Promise<MappedSurface> => (mappedJourneys ??= mapJourneysSafely(repoRoot, options.journeys))

  const recipeResult = await discoverRecipe(repoRoot, recipeRunner, {
    routes: async () => routesFromJourneys((await journeysOnce()).journeys),
    // The datastore half of the SAME memoized pass — read only when a boot
    // verification failed, so the failure can name the dependency it died on.
    database: async () => {
      const db = (await journeysOnce()).database
      return db ? { type: db.type, driver: db.driver } : null
    },
    // The connection URLs the SAME pass harvested: with no compose file in the
    // repo, the proposer derives one from them (item 68).
    datastores: async () => (await journeysOnce()).datastoreUrls,
  })
  if (recipeResult.status === 'verify-failed') {
    return emptyResult('recipe-failed', { reason: recipeResult.reason })
  }
  const recipe: Recipe = recipeResult.recipe
  const recipeFingerprint = recipeResult.fingerprint
  const recipeMeta: NonNullable<GuardGenerateResult['recipe']> = {
    status: recipeResult.status,
    ...(recipe.entry ? { entry: recipe.entry } : {}),
    // Either recipe shape reports the DEFAULT server's argv (item 75) — the report
    // field is one line about how the api driver starts, not a server inventory.
    ...(recipe.api ? { serve: defaultServerServe(recipe) } : {}),
    ...(recipeResult.status === 'discovered'
      ? {
          wrotePath: recipeResult.wrotePath,
          ...(recipeResult.composePath ? { composePath: recipeResult.composePath } : {}),
          source: recipeResult.source,
          ...(recipeResult.todos.length > 0 ? { todos: recipeResult.todos } : {}),
        }
      : {}),
  }

  // Item 76: which workspace app serves which path, joined to the recipe's declared
  // servers. Derived from the working tree alone (no LLM, nothing persisted, nothing
  // fingerprinted), so it costs a directory walk and answers, per flow, "does this
  // path's app even have a server?". A repo with one package yields an empty join
  // and every gate below degrades to the behaviour guard had before it existed.
  const serverIndex = buildServerRouteIndex(buildRouteManifest(repoRoot), recipe)
  /** The server a scenario means when it stamps none — the stamping baseline. */
  const defaultApiServer = resolveApiServers(recipe).defaultServer

  // 2. Index — the deterministic section universe + spec-side change detection.
  const plan = planGuardWork(repoRoot, recipeFingerprint)
  // Item 42 / B4: the cross-doc OpenAPI operation index, built once from the whole
  // section universe. api authoring matches its sections against it to inject the
  // authoritative request-body schemas.
  const opIndex = buildOperationIndex(plan.sections, plan.basePaths)
  options.onPlan?.(plan.sections.length, plan.work.length)
  const orphanedSections = plan.orphaned.map((e) => ({ doc: e.doc, anchor: e.anchor, scenarioIds: e.scenarioIds }))

  const limit = pLimit(Math.max(1, options.concurrency ?? defaultConcurrency()))
  const isolationCap = Math.max(0, options.isolationCap ?? ISOLATION_CAP)
  const extractRunner =
    options.extractRunner ??
    spawnExtractRunner({ transport: options.transport, model: options.models?.extract, fallbackModel: options.models?.fallback })
  const flowsRunner =
    options.flowsRunner ??
    spawnFlowsRunner({ transport: options.transport, model: options.models?.flows, fallbackModel: options.models?.fallback })
  const flowsEpicRunner =
    options.flowsEpicRunner ??
    spawnFlowsEpicRunner({ transport: options.transport, model: options.models?.flows, fallbackModel: options.models?.fallback })
  const matchRunner =
    options.matchRunner ??
    spawnMatchRunner({ transport: options.transport, model: options.models?.match, fallbackModel: options.models?.fallback })
  const generateRunner =
    options.generateRunner ??
    spawnGenerateRunner({
      transport: options.transport,
      model: options.models?.generate,
      retryModel: options.models?.retry,
      fallbackModel: options.models?.fallback,
    })
  // The fidelity reviewer (item 33) audits each green scenario before it persists.
  // It needs an LLM: production always supplies a transport, so the review always
  // runs there. A caller supplying NEITHER a transport NOR a `fidelityRunner` has
  // no model access, so the audit is skipped and green scenarios persist unreviewed.
  const fidelityRunner: FidelityRunner | undefined =
    options.fidelityRunner ??
    (options.transport
      ? spawnFidelityRunner({
          transport: options.transport,
          model: options.models?.fidelity,
          fallbackModel: options.models?.fallback,
        })
      : undefined)
  // The failing-test triage judge (item 81) spawns exactly like fidelity: production
  // always supplies a transport, so failing tests always carry a verdict there. A
  // caller with NEITHER a transport NOR a `triageRunner` has no model access — the
  // stage is skipped and failing tests commit untriaged (the conservative default).
  const triageRunner: TriageRunner | undefined =
    options.triageRunner ??
    (options.transport
      ? spawnTriageRunner({
          transport: options.transport,
          model: options.models?.triage,
          fallbackModel: options.models?.fallback,
        })
      : undefined)

  const coverageGaps: GuardCoverageGap[] = []
  const errors: GuardGenerateError[] = []
  const extractionFailures: GuardExtractionFailure[] = []

  // The user's curation (committable `scenarios/decisions.json`). A dismissed claim
  // (identity = doc + anchor + the extracted claim's stable text) never becomes a
  // milestone; a dismissed FLOW is dropped whole. Both settle as visible `dismissed`
  // gaps rather than silently disappearing.
  const decisions = readGuardDecisions(repoRoot)
  const dismissalByKey = new Map<string, GuardDismissedClaim>(
    decisions.dismissedClaims.map((d) => [dismissedClaimKey(d.doc, d.anchor, d.title), d]),
  )
  const flowDismissalById = new Map(decisions.dismissedFlows.map((d) => [d.flowId, d]))

  // The durable auto-resolve ledger (item 83) — escalation counts + the flow-taint
  // set, read once and rewritten once at run end. A tainted flow (its test ended a
  // prior run rejected) bypasses the author cache below and re-authors fresh with
  // the prior mismatch as evidence; the flagged/cleared reconciliation happens
  // after settle. The ledger is the safety valve: every auto behavior below checks
  // its budget here first, so none can loop silently forever.
  const priorLedger = readGuardAutoResolutions(repoRoot)
  const nowIso = new Date().toISOString()
  const escalateAfter = Math.max(1, options.escalateAutoResolveAfter ?? DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER)
  // Flows whose test ended THIS run rejected → their taint (re)recorded at run end.
  const flaggedFlows = new Map<string, GuardFlowTaint>()
  // Tainted flows whose round-1 author cache was freshly overwritten this run —
  // their prior taint clears at run end, unless they re-flag below.
  const freshlyAuthoredTaints = new Set<string>()
  const taintFlow = (flowId: string, surface: GuardDriverId, title: string, mismatch: string): void => {
    flaggedFlows.set(autoResolutionKey(flowId, surface), { flowId, surface, title, mismatch, updatedAt: nowIso })
  }
  // This run's auto-resolution bumps, applied to the ledger at run end.
  // `autoResolveCount` reads prior + bumps, so the escalation budget holds WITHIN
  // a run too (a fidelity discard and a triage retirement of the same flow count).
  const ledgerBumps = new Map<string, { times: number; source: GuardAutoResolutionSource }>()
  const bumpLedger = (key: string, source: GuardAutoResolutionSource): void => {
    const bump = ledgerBumps.get(key)
    if (bump) {
      bump.times++
      bump.source = source
    } else ledgerBumps.set(key, { times: 1, source })
  }
  const autoResolveCount = (key: string): number =>
    (priorLedger.entries[key]?.count ?? 0) + (ledgerBumps.get(key)?.times ?? 0)
  // The auto-resolved rows this run — the report's visible record of what the
  // ledger counted.
  const autoResolved: GuardAutoResolved[] = []

  // 3. Extract — one (cached) read per document VIEW, across the WHOLE universe: a
  // flow spans sections, and its area's synthesis needs the complete claim
  // inventory, not only the changed sections'. Extraction is content-cached, so an
  // unchanged document costs nothing.
  const docs = collectWorkDocs(repoRoot, { ...plan, work: plan.sections })
  // Doc path → its raw text: the OpenAPI security resolution the api authoring prompt
  // carries needs the WHOLE document (schemes + the doc-level `security` fallback).
  const docText = new Map(docs.map((d) => [d.doc, d.content]))
  const sectionByKey = new Map(plan.sections.map((s) => [flowSectionKey(s.doc, s.anchor), s]))

  // Item 56 / Phase 2: a credential's `satisfies` naming a scheme NO OpenAPI doc in
  // the corpus declares can never bind — the matcher would silently fall through to
  // the header heuristic (or block the operation) with no diagnostic anywhere. It is
  // a recipe defect, so it stops the run HERE: before the first (paid) extraction
  // call, and reported through the same `recipe-failed` channel a discovery failure
  // uses. A key present in SOME doc is fine (schemes resolve per doc).
  const satisfiesCheck = validateCredentialSatisfies(recipeAuthCredentials(recipe), docs)
  if (satisfiesCheck.errors.length > 0) {
    return emptyResult('recipe-failed', { reason: satisfiesCheck.errors.join(' ') })
  }
  if (satisfiesCheck.warnings.length > 0) recipeMeta.warnings = satisfiesCheck.warnings

  let extractDone = 0
  const viewTotal = docs.reduce((n, d) => n + countExtractViews(d), 0)
  let viewDone = 0
  // Announce the planned denominator before the first (possibly slow) view
  // resolves so the live counter is never a bare count without context.
  options.onExtractViewProgress?.(0, viewTotal)
  const extracted = await Promise.all(
    docs.map(async (doc) => {
      const result = await extractDocClaims(repoRoot, doc, extractRunner, limit, () =>
        options.onExtractViewProgress?.(++viewDone, viewTotal),
      )
      options.onExtractProgress?.(++extractDone, docs.length)
      return { doc, result }
    }),
  )

  // Claim inventory per document, plus the claim-level coverage gaps extraction
  // itself settles (dismissed, untestable, no-claim, awaiting-driver, prep-missing).
  const areaTagsByDoc = new Map(plan.sections.map((s) => [s.doc, s.areaTags]))
  const extractedClaimKeys = new Set<string>()
  const extractedDocs = new Set<string>()
  const areaInputs: FlowAreaDocInput[] = []

  for (const { doc, result } of extracted) {
    if (!result.ok) {
      extractionFailures.push({ doc: doc.doc, reason: result.reason })
      continue
    }
    if (!result.complete) {
      extractionFailures.push({
        doc: doc.doc,
        reason: `${result.failedViews} extraction view(s) failed — re-run to complete coverage for affected sections`,
      })
    }
    extractedDocs.add(doc.doc)
    for (const c of result.data.claims) {
      extractedClaimKeys.add(dismissedClaimKey(doc.doc, c.sectionAnchor, c.claim))
    }
    const { claimsByAnchor, noteByAnchor } = groupExtraction(result.data)
    const live: FlowClaimInput[] = []

    for (const s of doc.sections) {
      const claims = claimsByAnchor.get(s.anchor) ?? []
      const note = noteByAnchor.get(s.anchor)
      let kept = 0
      for (const c of claims) {
        const dismissal = dismissalByKey.get(dismissedClaimKey(s.doc, s.anchor, c.claim))
        if (dismissal) {
          coverageGaps.push({
            doc: s.doc,
            anchor: s.anchor,
            kind: 'dismissed',
            reason: dismissedReason(c.claim, dismissal.note),
          })
          continue
        }
        if (!isRunnableDriver(c.driver)) {
          // A claim on a surface with no driver yet is recorded coverage honesty.
          coverageGaps.push({ doc: s.doc, anchor: s.anchor, kind: 'awaiting-driver', driver: c.driver, reason: c.reason })
          continue
        }
        if (!driverPrepared(recipe, c.driver)) {
          // A runnable claim whose driver has no recipe preparation is an honest
          // blocked-on gap — never composed into a flow that could only die.
          coverageGaps.push({
            doc: s.doc,
            anchor: s.anchor,
            kind: 'blocked-on',
            reason: composeBlockedOnReason([missingPrepNoun(c.driver)], oneLine(c.claim)),
          })
          continue
        }
        kept++
        live.push({ doc: s.doc, anchor: s.anchor, title: c.claim, driver: c.driver })
      }
      if (claims.length === 0 && kept === 0) {
        // No claim at all. In a COMPLETE doc that's an honest gap; in an incomplete
        // one the section may live in a failed view — don't settle it either way.
        if (result.complete || note) {
          coverageGaps.push({
            doc: s.doc,
            anchor: s.anchor,
            kind: note ? 'untestable' : 'no-claim',
            reason: note?.reason ?? 'the section states no claim a runnable driver can assert',
          })
        }
      }
    }

    areaInputs.push({
      doc: doc.doc,
      areaTags: areaTagsByDoc.get(doc.doc) ?? [],
      outline: doc.sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
      untestable: result.data.untestable.map((u) => ({ anchor: u.sectionAnchor, reason: u.reason })),
      claims: live,
    })
  }

  // Orphan honesty: a dismissal whose doc was extracted but whose claim text matched
  // no live claim is stale — surfaced so it is never silently honored.
  const orphanedDismissals: GuardOrphanedDismissal[] = decisions.dismissedClaims
    .filter((d) => extractedDocs.has(d.doc) && !extractedClaimKeys.has(dismissedClaimKey(d.doc, d.anchor, d.title)))
    .map((d) => ({ doc: d.doc, anchor: d.anchor, title: d.title }))

  // 4. Journeys — deterministic, free, and independent of everything spec-side.
  const mapped = await journeysOnce()
  const catalog = mapped.journeys
  // Item 57: the repo's own third-party dependencies, from the same pass. They name
  // the third party in an api authoring prompt and in every blocked-on gap reason.
  const externalServices = mapped.externalServices
  // The AUTHORING hint per service: its canonical name plus, when one was detected, the
  // env var that overrides its base URL — the precondition for a `setup.http` stub.
  // Item 62: the user-provided external accounts, joined onto the detected list. A
  // PROVIDED service flips from blocker to capability (the runner points the app at
  // it); a declared-but-unprovided one changes nothing. A declared external the
  // detector never saw is still advertised when PROVIDED — the user knows about an
  // integration import scanning cannot see, and an account they supplied is a real
  // capability regardless of how the dependency is reached.
  const providedExternals = resolveProvidedExternals(repoRoot, recipe)
  const externalServiceHints = buildExternalServiceHints(externalServices, providedExternals)
  // Item 69: the code-truth grounding, off the SAME mapping pass. The inbound half is
  // joined per flow (the operations its plan walks); the outbound half is repo-level
  // and capped here, once.
  const requestContracts = mapped.requestContracts
  const outboundRequestHints = buildOutboundRequestHints(mapped.outboundRequests, externalServices)
  const outboundRequestsOverflow = outboundOverflow(mapped.outboundRequests)
  const catalogs = buildSurfaceCatalogs(catalog)
  // Item 70: the WHOLE api surface, so a flow can reach for the operations it does
  // not itself walk when a SETUP step needs one (sign up, then sign in, then test
  // favorites). Empty for a repo with no api journeys — the block simply renders not.
  const apiJourneys = catalogs.get('api')?.journeys ?? []
  options.onJourneys?.(catalog.length, catalogs.size)
  const journeysReport: GuardJourneysReport = {
    total: catalog.length,
    bySurface: Object.fromEntries([...catalogs].map(([surface, c]) => [surface, c.journeys.length])),
  }

  // 5. Flow synthesis — the spec-side generation unit. Reads claims and outlines
  // only; the journey catalog above never enters its prompts.
  const areas = buildFlowAreas(areaInputs)
  let areasDone = 0
  options.onFlowProgress?.(0, areas.length)
  const synthesis = await synthesizeFlows({
    repoRoot,
    areas,
    runner: flowsRunner,
    epicRunner: flowsEpicRunner,
    sectionFingerprints: new Map(plan.sections.map((s) => [flowSectionKey(s.doc, s.anchor), s.fingerprint])),
    limit,
    onArea: () => options.onFlowProgress?.(++areasDone, areas.length),
  })

  // Dismissed flows drop whole (with their scenarios); a dismissal naming a flow
  // synthesis no longer produces is reported, never silently honored.
  const liveFlows: GuardFlow[] = []
  let dismissedFlowCount = 0
  for (const flow of synthesis.flows) {
    const dismissal = flowDismissalById.get(flow.id)
    if (!dismissal) {
      liveFlows.push(flow)
      continue
    }
    dismissedFlowCount++
    const primary = primarySection(flow, sectionByKey)
    coverageGaps.push({
      doc: primary?.doc ?? flow.milestones[0].doc,
      anchor: primary?.anchor ?? flow.milestones[0].anchor,
      kind: 'dismissed',
      flowId: flow.id,
      reason: dismissedReason(flow.title, dismissal.note),
    })
  }
  const liveFlowIds = new Set(synthesis.flows.map((f) => f.id))
  const orphanedFlowDismissals: GuardOrphanedFlowDismissal[] = decisions.dismissedFlows
    .filter((d) => !liveFlowIds.has(d.flowId))
    .map((d) => ({ flowId: d.flowId, title: d.title }))

  const flowsReport: GuardFlowsReport = {
    total: liveFlows.length,
    settled: 0,
    unsettled: 0,
    skipped: 0,
    dismissed: dismissedFlowCount,
    orphaned: synthesis.orphaned.length,
    subsumed: synthesis.subsumed.length,
    noFlowClaims: synthesis.noFlowClaims.length,
    unsettledAreas: synthesis.unsettled.map((u) => ({ areaId: u.areaId, reason: u.reason })),
  }

  const priorFlows = new Map((readManifest(repoRoot)?.flows ?? []).map((f) => [f.flowId, f]))

  if (options.stopAfterFlows) {
    return {
      status: 'ok',
      recipe: recipeMeta,
      recipeFingerprint,
      sectionsTotal: plan.sections.length,
      sectionsChanged: plan.work.length,
      skippedUnchanged: plan.sections.length - plan.work.length,
      noChanges: false,
      written: [],
      coverageGaps,
      birthFindings: [],
      errors,
      extractionFailures,
      orphaned: orphanedSections,
      birthPassed: 0,
      orphanedDismissals,
      orphanedFlowDismissals,
      autoResolved: [],
      flows: flowsReport,
      journeys: journeysReport,
      externalServices,
    }
  }

  // 6. Match — one (cached) verdict per (flow, surface). The surfaces a flow is
  // accounted for are the runnable ones the recipe prepares, plus any surface the
  // catalog detected: a mapped-but-unrunnable surface is honest coverage
  // accounting ("realizable on web — awaiting the web driver"), not silence.
  const surfaces = accountedSurfaces(recipe, catalogs)
  const works: FlowWork[] = []
  const matchPairs = liveFlows.length * surfaces.filter((s) => matchable(s, recipe, catalogs)).length
  let matchDone = 0
  if (matchPairs > 0) options.onMatchProgress?.(0, matchPairs)

  for (const flow of liveFlows) {
    const primary = primarySection(flow, sectionByKey)
    if (!primary) {
      // Every milestone's section vanished between synthesis and here (a concurrent
      // edit): nothing can bind, so the flow is skipped with a stated reason.
      errors.push({
        doc: flow.milestones[0].doc,
        anchor: flow.milestones[0].anchor,
        message: `flow "${flow.id}" binds no live section — re-run generate after re-scanning the corpus`,
      })
      continue
    }
    const sections = new Map<number, SectionInput>()
    for (const m of flow.milestones) {
      const s = sectionByKey.get(flowSectionKey(m.doc, m.anchor))
      if (s) sections.set(m.order, s)
    }
    const sectionKeys = [...new Set(flow.bindings.map((b) => sectionByKey.get(flowSectionKey(b.doc, b.anchor))))]
      .filter((s): s is SectionInput => s !== undefined)
      .map(sectionInputsKey)

    const plans = new Map<GuardDriverId, RealizationPlan>()
    const gaps: GuardManifestGap[] = []
    const serverBySurface = new Map<GuardDriverId, string>()
    for (const surface of surfaces) {
      const surfaceCatalog = catalogs.get(surface)
      const journeyCount = surfaceCatalog?.journeys.length ?? 0
      if (!isRunnableDriver(surface)) {
        if (journeyCount > 0) {
          gaps.push({
            surface,
            kind: 'awaiting-driver',
            driver: surface,
            reason: `${journeyCount} ${surface} journey(s) could realize this flow — ${guardDriver(surface)?.waitingLabel ?? `needs the ${surface} driver`}`,
          })
        }
        continue
      }
      if (!driverPrepared(recipe, surface)) {
        if (journeyCount > 0) {
          gaps.push({
            surface,
            kind: 'blocked-on',
            reason: composeBlockedOnReason([missingPrepNoun(surface)], oneLine(flow.title)),
          })
        }
        continue
      }
      if (!surfaceCatalog || journeyCount === 0) {
        // An EMPTY catalog never reaches the matcher: with nothing to choose from a
        // verdict would be noise. This is the extraction gap, stated as such.
        gaps.push({
          surface,
          kind: 'no-journey',
          reason: `no ${surface} journey was mapped from this repository — the flow may be realizable, but nothing was found to realize it with`,
        })
        continue
      }
      // GATE A (item 76, pre-match): the flow's own documented paths all belong to
      // an app the recipe declares no server for. Nothing a matcher could say would
      // change that, so the (paid) match call is skipped and the flow settles as the
      // blocked-on gap whose fix is a recipe edit. Deliberately strict: it fires only
      // when NO documented path reaches a declared server (`alsoBound` empty), so a
      // flow the manifest only half-understands is decided by Gate B instead.
      if (surface === 'api') {
        const preMatch = bindFlowServer(documentedApiPaths([...sections.values()], plan.basePaths), serverIndex)
        if (preMatch.kind === 'missing-server' && preMatch.alsoBound.length === 0) {
          gaps.push({
            surface,
            kind: 'blocked-on',
            reason: composeBlockedOnReason(missingServerBlockedOn(preMatch.app), oneLine(flow.title)),
          })
          continue
        }
      }
      const outcome = await limit(() => matchFlow(repoRoot, flow, surfaceCatalog, matchRunner))
      options.onMatchProgress?.(++matchDone, matchPairs)
      if (outcome.kind === 'plan') {
        // GATE B (post-match, authoritative): the paths the plan will ACTUALLY drive
        // decide the server. A plan whose app has no server — or one that spans two
        // servers, which no single scenario can run against (R2) — is dropped rather
        // than authored, because the scenario it would produce could only ask the
        // wrong service and report a false failure.
        if (surface === 'api') {
          const bound = bindFlowServer(journeyPaths(outcome.plan), serverIndex)
          if (bound.kind === 'missing-server') {
            gaps.push({
              surface,
              kind: 'blocked-on',
              reason: composeBlockedOnReason(missingServerBlockedOn(bound.app), oneLine(flow.title)),
            })
            continue
          }
          if (bound.kind === 'spans') {
            gaps.push({
              surface,
              kind: 'blocked-on',
              reason: composeBlockedOnReason(multiServerBlockedOn(bound.apps), oneLine(flow.title)),
            })
            continue
          }
          if (bound.kind === 'bound') serverBySurface.set(surface, bound.server)
        }
        plans.set(surface, outcome.plan)
      } else if (outcome.kind === 'unrealizable') {
        gaps.push({ surface, kind: 'unrealizable', reason: outcome.reason })
      } else {
        errors.push({ doc: primary.doc, anchor: primary.anchor, message: `matching (${surface}) ${outcome.reason}` })
      }
    }

    const journeyFingerprints = [...plans.values()].flatMap((p) => p.journeys.map((j) => j.fingerprint))
    const inputsHash = flowGenerationInputsHash({
      flowFingerprint: flow.fingerprint,
      sectionKeys,
      journeyFingerprints,
      recipeFingerprint,
    })
    const prior = priorFlows.get(flow.id)
    // A settled entry that leaves a planned surface unaccounted for (no test, no
    // gap) is a hole nothing can heal: its hash skips the flow forever. Its hash is
    // DISREGARDED, so the flow re-runs here and settles honestly — no migration.
    const changed = !prior || prior.generationInputsHash !== inputsHash || violatesSettleInvariant(prior)
    if (!changed && prior) {
      // Unchanged ⇒ authoring does not run, so the gaps the AUTHOR stage settled last
      // time (a refusal: "blocked on world-state the sandbox cannot provide") cannot
      // be re-derived — only the MATCH-stage gaps above can. Carrying them forward is
      // what keeps the settle outcome and the settle hash together; without it the
      // first no-op re-run erases the reason while keeping the hash that skips it.
      for (const gap of prior.gaps) {
        if (plans.has(gap.surface) && !gaps.some((g) => sameGap(g, gap))) gaps.push(gap)
      }
    }
    works.push({
      flow,
      primary,
      sections,
      sectionKeys,
      plans,
      serverBySurface,
      gaps,
      inputsHash,
      prior,
      changed,
    })
  }

  // Every flow-level gap is reported alongside the manifest's per-surface record.
  for (const w of works) {
    for (const gap of w.gaps) {
      coverageGaps.push({
        doc: w.primary.doc,
        anchor: w.primary.anchor,
        kind: gap.kind,
        reason: gap.reason,
        flowId: w.flow.id,
        surface: gap.surface,
        ...(gap.driver ? { driver: gap.driver } : {}),
      })
    }
  }

  const changedWorks = works.filter((w) => w.changed)
  flowsReport.skipped = works.length - changedWorks.length
  // Announce the settle denominator before the first (slow) authoring/birth phase,
  // so the live counter is never a bare count without context.
  options.onFlowSettled?.(0, changedWorks.length)

  // 7. Author — one call per (flow, surface with a plan). The build starts here, in
  // parallel with authoring: every birth round reuses it (skipBuild).
  const authorTasks: AuthorTask[] = changedWorks.flatMap((work) =>
    [...work.plans.entries()].map(([surface, plan]) => ({
      work,
      surface,
      plan,
      ...(work.serverBySurface.get(surface) ? { server: work.serverBySurface.get(surface)! } : {}),
    })),
  )

  // The build is kicked ONCE, as soon as there is anything to author, so it overlaps
  // authoring; every birth round then reuses it (skipBuild). A run with no authoring
  // work never builds at all. The optional recipe install runs first; a failed
  // install IS the build result (same shape, carrying the install command).
  let buildMemo: Promise<BuildResult> | null = null
  const startBuild = (): Promise<BuildResult> => {
    buildMemo ??= (async () => {
      if (recipe.install) {
        const install = await runInstall(repoRoot, recipe.install, recipe.env)
        if (!install.ok) return install
      }
      return runBuild(repoRoot, recipe.build, recipe.env)
    })()
    return buildMemo
  }
  if (authorTasks.length > 0) void startBuild()
  let buildAnnounced = false
  const awaitBuild = async (): Promise<BuildResult> => {
    if (!buildAnnounced) {
      buildAnnounced = true
      options.onBirthPhase?.('build')
    }
    return startBuild()
  }

  // Grounded authoring: before a cli authoring call the engine probes the real
  // program for the commands the flow's claims name (empty sandbox, cached) and
  // injects the transcripts. A failed build skips probing entirely, leaving
  // authoring ungrounded.
  let resolvedEntryMemo: string[] | null = null
  let groundPlanned = 0
  let groundCaptured = 0
  const groundClaims = async (claimTexts: string[]): Promise<ProbeTranscript[]> => {
    if (!recipe.entry) return []
    const build = await startBuild()
    if (!build.ok) return []
    resolvedEntryMemo ??= resolveEntry(repoRoot, recipe.entry)
    return groundProbes({
      repoRoot,
      claimTexts,
      resolvedEntry: resolvedEntryMemo,
      displayEntry: recipe.entry,
      recipeFingerprint,
      recipeEnv: recipe.env,
      onProbesPlanned: (n) => {
        groundPlanned += n
        options.onGroundProgress?.(groundCaptured, groundPlanned)
      },
      onProbeCaptured: () => options.onGroundProgress?.(++groundCaptured, groundPlanned),
    })
  }

  // Pre-flight the built entry ONCE (after the build succeeds), before any birth
  // candidate runs against it. A dead entry short-circuits the whole birth phase
  // into ONE loud error; the judgment is GENERAL (no string matching).
  let entryPreflightMemo: Promise<EntryPreflightResult | null> | null = null
  const preflightEntryOnce = (): Promise<EntryPreflightResult | null> => {
    entryPreflightMemo ??= (async () => {
      if (!recipe.entry) return null
      const build = await startBuild()
      if (!build.ok) return null
      resolvedEntryMemo ??= resolveEntry(repoRoot, recipe.entry)
      return preflightEntry({ resolvedEntry: resolvedEntryMemo, displayEntry: recipe.entry, recipeEnv: recipe.env, repoRoot })
    })()
    return entryPreflightMemo
  }

  let entryPreflightFailure: GuardEntryPreflight | null = null
  const deadEntry = async (): Promise<boolean> => {
    const preflight = await preflightEntryOnce()
    if (!preflight || preflight.ok) return false
    if (!entryPreflightFailure) {
      entryPreflightFailure = {
        entry: preflight.entry,
        buildCommand: recipe.build,
        stderr: preflight.stderr,
        ...(preflight.kind === 'silent' ? { kind: 'silent' as const } : {}),
      }
      errors.push({
        doc: preflight.entry,
        anchor: ENTRY_PREFLIGHT_ANCHOR,
        // A dead entry is a REFUSAL, not an authoring miss: nothing was validated and
        // re-running changes nothing until the binary is rebuilt.
        kind: 'refusal',
        message: formatEntryPreflightError(entryPreflightFailure),
      })
    }
    return true
  }

  const authorTotal = authorTasks.length
  let authorDone = 0
  const bumpAuthor = (): void => options.onAuthorProgress?.(++authorDone, authorTotal)
  if (authorTotal > 0) options.onAuthorProgress?.(0, authorTotal)

  const authored = new Map<string, RawGeneratedScenario>()
  await Promise.all(
    authorTasks.map((task) =>
      limit(async () => {
        // Item 83 — a TAINTED flow (its test ended a prior run rejected) bypasses
        // the author cache: the cache still holds the rejected scenario, and
        // re-serving it would re-flag it and treadmill. Force a fresh author
        // carrying the prior rejection as evidence; a completed call overwrote
        // the poisoned entry, so the taint clears at run end unless it re-flags.
        const taintKey = autoResolutionKey(task.work.flow.id, task.surface)
        const taint = priorLedger.tainted[taintKey]
        try {
          const attempt = await authorFlowScenario({
            repoRoot,
            task,
            recipe,
            recipeFingerprint,
            runner: generateRunner,
            opIndex,
            docText,
            ground: groundClaims,
            externalServices: externalServiceHints,
            requestContracts,
            apiJourneys,
            outboundRequests: outboundRequestHints,
            outboundRequestsOverflow,
            serverIndex,
            ...(taint ? { priorFlag: { title: taint.title, mismatch: taint.mismatch } } : {}),
            onAuthorFailure: options.onAuthorFailure,
          })
          if (taint && !('error' in attempt)) freshlyAuthoredTaints.add(taintKey)
          if ('error' in attempt) {
            errors.push({
              doc: task.work.primary.doc,
              anchor: task.work.primary.anchor,
              kind: 'authoring',
              flowId: task.work.flow.id,
              surface: task.surface,
              message: `authoring (${task.surface}) ${attempt.error}`,
            })
            task.errored = true
          } else if (attempt.scenario) {
            authored.set(taskKey(task), attempt.scenario)
          } else {
            // Item 57: a generic "external-service" becomes the repo's actual third
            // parties, in the capability segment — so the existing
            // `blockedOnCapabilities` tally counts per SERVICE, not per placeholder.
            const blockedOn = enrichBlockedOn(attempt.blockedOn, externalServices)
            const reason = composeBlockedOnReason(blockedOn, oneLine(task.work.flow.title))
            task.work.gaps.push({ surface: task.surface, kind: 'blocked-on', reason })
            coverageGaps.push({
              doc: task.work.primary.doc,
              anchor: task.work.primary.anchor,
              kind: 'blocked-on',
              flowId: task.work.flow.id,
              surface: task.surface,
              reason,
            })
          }
        } finally {
          bumpAuthor()
        }
      }),
    ),
  )

  // 8. Birth — ONE round-1 invocation for every candidate, then ONE retry round for
  // the failures, then isolated re-confirmation of api would-be findings.
  const usedIds = existingScenarioIds(repoRoot)
  // A flow about to re-author frees its OWN prior ids (its files are deleted below)
  // so it reuses its stable `<flow>.<surface>.1` without stealing a sibling's.
  for (const w of changedWorks) {
    for (const id of w.prior?.scenarios.map((s) => s.id) ?? []) usedIds.delete(id)
  }

  // The "test is wrong" verdicts — the two classes item 80 withholds from the
  // corpus: a fidelity rejection on a green candidate, and a `generation-defect`
  // triage verdict on a failing one. Both unsettle their flow so the next
  // generate re-authors.
  const fidelityRejections = new Map<string, GuardBirthFinding[]>()
  const withheldFailures = new Map<string, GuardBirthFinding[]>()
  const persisted = new Map<string, BirthCandidate[]>()
  // Tests that FAILED their birth execution. After triage routing (item 80) this
  // holds the COMMIT class only — triage blamed the repo, or produced no verdict —
  // committed exactly like a passing test (item 50) with the birth result
  // recorded, so the flow settles.
  const failedTests = new Map<string, { candidate: BirthCandidate; finding: GuardBirthFinding }[]>()
  const settleFailedTest = (task: AuthorTask, o: BirthOutcome): void => {
    pushInto(failedTests, taskKey(task), { candidate: o.candidate, finding: toFinding(o) })
  }

  /**
   * Item 76's SAFETY NET, for the flows the route gates could not classify at
   * generate time (a path the manifest did not attribute, a plan whose journeys
   * carry no path): birth ran the scenario, the bound server 404ed a path another
   * app serves, and the runner annotated the outcome `unservedRoute`. That is the
   * SAME fact Gate B blocks on, arriving later — so it settles as the same
   * `blocked-on` gap instead of an `errors.push`, which would leave the flow
   * unsettled and re-authoring (and re-paying) on every future generate. Returns
   * false for every other error, which keeps its handling untouched.
   */
  const settleUnservedRoute = (task: AuthorTask, o: BirthOutcome): boolean => {
    if (!o.result.unservedRoute) return false
    const reason = composeBlockedOnReason(
      [MISSING_SERVER_NOUN, oneLine(firstSentence(o.result.failure?.actual ?? ''))],
      oneLine(task.work.flow.title),
    )
    task.work.gaps.push({ surface: task.surface, kind: 'blocked-on', reason })
    coverageGaps.push({
      doc: task.work.primary.doc,
      anchor: task.work.primary.anchor,
      kind: 'blocked-on',
      flowId: task.work.flow.id,
      surface: task.surface,
      reason,
    })
    return true
  }

  const round1: BirthCandidate[] = []
  const taskByKey = new Map(authorTasks.map((t) => [taskKey(t), t]))
  for (const task of authorTasks) {
    const raw = authored.get(taskKey(task))
    if (!raw) continue
    const built = safeBuild(task, raw, usedIds, errors, defaultApiServer)
    if (built) round1.push(built)
  }

  let birthTotal = 0
  let birthSettled = 0
  const bumpBirth = (): void => options.onBirthProgress?.(++birthSettled, birthTotal)
  const reconcileBirth = (): void => {
    if (birthSettled < birthTotal) options.onBirthProgress?.((birthSettled = birthTotal), birthTotal)
  }

  // C4 — the no-op birth anomaly gate, the last line of defense against a
  // silently inert recipe that got past every preflight. Each birth round's
  // per-driver step aggregate folds into ONE cumulative sample (fresh candidates
  // only — the isolated re-confirmations re-run already-counted candidates and
  // are not folded), and the moment the sample says a driver is a do-nothing
  // surface, generate aborts through the same `recipe-failed` channel a
  // discovery failure uses. Every fold point sits BEFORE stage 11 (persist), so
  // nothing corpus-side has been written and the abort IS the rollback: no
  // scenario files, no manifest write, no ledger write, no findings.
  let birthStepStats: GuardRunStepStats | null = null
  const foldBirthRound = (round: BirthRound): GuardNoOpAnomaly | null => {
    if (!round.stepStats) return null
    birthStepStats = birthStepStats ? foldStepStats(birthStepStats, round.stepStats) : round.stepStats
    return detectNoOpAnomaly(birthStepStats)
  }

  /**
   * The RUN-LEVEL refusal, recorded at most once. The runner declined to run —
   * nothing was built, booted or executed — so this is deliberately NOT fanned out
   * into a per-candidate error: the candidates were never judged, and N copies of
   * one config fact read as N broken tests. The affected flows still stay unsettled
   * (`task.errored`), so the next generate re-attempts them once the config is fixed.
   */
  let runRefusal: GuardRunRefusal | null = null
  const settleRefusal = (round: BirthRound, pool: BirthCandidate[]): void => {
    if (!round.refusal) return
    if (!runRefusal) {
      runRefusal = round.refusal
      errors.push(runRefusalError(round.refusal))
    }
    for (const c of pool) taskByKey.get(c.ref)!.errored = true
  }

  const round2Failures: BirthOutcome[] = []
  if (round1.length > 0) {
    const build = await awaitBuild()
    if (!build.ok) {
      const message = `build failed (\`${build.command}\`)${build.timedOut ? ' — timed out' : ''}`
      for (const c of round1) {
        const task = taskByKey.get(c.ref)!
        task.errored = true
        errors.push(errorFrom({ candidate: c, result: { failure: { actual: message } } }))
      }
      reconcileBirth()
    } else {
      // The built entry can't start — birthing any cli candidate against it would
      // yield N indistinguishable failures. Every cli candidate is skipped (its flow
      // stays unsettled); the ONE loud error was recorded once. Api candidates
      // proceed (the api server has its own preflight inside the runner).
      const dead = round1.some((c) => c.scenario.driver === 'cli') && (await deadEntry())
      const pool = dead ? round1.filter((c) => c.scenario.driver !== 'cli') : round1
      if (dead) {
        for (const c of round1) {
          if (c.scenario.driver === 'cli') taskByKey.get(c.ref)!.errored = true
        }
      }
      if (pool.length > 0) {
        birthTotal += pool.length
        const round1Run = await birthValidate(repoRoot, pool, { executor, recipe, skipBuild: true, noOpThresholdMs: options.noOpThresholdMs, onPhase: options.onBirthPhase, onScenarioSettled: bumpBirth })
        reconcileBirth()
        // A refused run yields NO outcomes, so every stage below iterates an empty
        // list and settles nothing — the refusal was already recorded once.
        settleRefusal(round1Run, pool)
        // The anomaly gate fires NOW — before a single retry/fidelity/triage call
        // is spent on scenarios validated against a do-nothing surface.
        const round1Anomaly = foldBirthRound(round1Run)
        if (round1Anomaly) {
          return emptyResult('recipe-failed', { reason: noOpAnomalyReason(round1Anomaly, recipe) })
        }
        const r1 = round1Run.outcomes

        // Retry classification: a fail (or a setup defect) re-authors the WHOLE flow
        // scenario once with its evidence; anything else settles here.
        const retryEntries: { task: AuthorTask; outcome: BirthOutcome; evidence: GuardBirthFinding }[] = []
        for (const o of r1) {
          const task = taskByKey.get(o.candidate.ref)!
          if (o.result.outcome === 'fail' || isSetupDefectResult(o.result)) {
            retryEntries.push({ task, outcome: o, evidence: toFinding(o) })
          } else if (o.result.outcome === 'pass') {
            pushInto(persisted, o.candidate.ref, o.candidate)
          } else if (!settleUnservedRoute(task, o)) {
            task.errored = true
            errors.push(errorFrom(o))
          }
        }

        if (retryEntries.length > 0) {
          for (const { task } of retryEntries) {
            for (const c of round1) if (c.ref === taskKey(task)) usedIds.delete(c.scenario.id)
          }
          let retryDone = 0
          options.onRetryProgress?.(0, retryEntries.length)
          const retryPool: BirthCandidate[] = []
          await Promise.all(
            retryEntries.map((entry) =>
              limit(async () => {
                try {
                  const attempt = await authorFlowScenario({
                    repoRoot,
                    task: entry.task,
                    recipe,
                    recipeFingerprint,
                    runner: generateRunner,
                    opIndex,
                    docText,
                    ground: groundClaims,
                    externalServices: externalServiceHints,
                    requestContracts,
                    apiJourneys,
                    outboundRequests: outboundRequestHints,
                    outboundRequestsOverflow,
                    serverIndex,
                    retry: retryContext(entry.evidence),
                    onAuthorFailure: options.onAuthorFailure,
                  })
                  if ('error' in attempt) {
                    entry.task.errored = true
                    errors.push({
                      doc: entry.task.work.primary.doc,
                      anchor: entry.task.work.primary.anchor,
                      kind: 'authoring',
                      flowId: entry.task.work.flow.id,
                      surface: entry.task.surface,
                      message: `retry authoring (${entry.task.surface}) ${attempt.error}`,
                    })
                    return
                  }
                  if (!attempt.scenario) {
                    // The retry gave up on the world it needs — the round-1 candidate
                    // is the final word, so it is committed as a failing test with
                    // the birth result it already produced.
                    settleFailedTest(entry.task, entry.outcome)
                    return
                  }
                  const built = safeBuild(entry.task, attempt.scenario, usedIds, errors, defaultApiServer)
                  if (built) retryPool.push(built)
                } finally {
                  options.onRetryProgress?.(++retryDone, retryEntries.length)
                }
              }),
            ),
          )
          if (retryPool.length > 0) {
            birthTotal += retryPool.length
            const round2Run = await birthValidate(repoRoot, retryPool, { executor, recipe, skipBuild: true, noOpThresholdMs: options.noOpThresholdMs, onPhase: options.onBirthPhase, onScenarioSettled: bumpBirth })
            reconcileBirth()
            settleRefusal(round2Run, retryPool)
            // Fold the retry round too: a corpus just under the sample floor on
            // round 1 can cross it here, and nothing is persisted yet either way.
            const round2Anomaly = foldBirthRound(round2Run)
            if (round2Anomaly) {
              return emptyResult('recipe-failed', { reason: noOpAnomalyReason(round2Anomaly, recipe) })
            }
            const r2 = round2Run.outcomes
            for (const o of r2) {
              if (o.result.outcome === 'pass') pushInto(persisted, o.candidate.ref, o.candidate)
              else if (o.result.outcome === 'fail') round2Failures.push(o)
              else if (!settleUnservedRoute(taskByKey.get(o.candidate.ref)!, o)) {
                // A setup-declaration defect that survived its evidence retry is a
                // rejected test too (item 83): taint the flow so the next generate
                // bypasses the author cache still holding the bad setup block.
                if (isSetupDefectResult(o.result)) {
                  taintFlow(
                    o.candidate.flow.id,
                    o.candidate.surface,
                    o.candidate.scenario.title,
                    o.result.failure?.actual ?? 'setup failed to materialize',
                  )
                }
                taskByKey.get(o.candidate.ref)!.errored = true
                errors.push(errorFrom(o))
              }
            }
          }
        }
      }
    }
  }

  // 9. Isolated re-confirmation of the round-2 failures (layer d), for the API
  // driver ONLY: a cli scenario already runs in its own fresh sandbox, so a re-run
  // can never flip and would only burn a boot + cap budget. Each remaining (api)
  // candidate is re-run ALONE in a fresh runner invocation: a PASS means shared-state
  // pollution — keep the candidate green; a FAIL confirms the failure with CLEAN-ROOM
  // evidence. The order (and thus the cap selection) is DETERMINISTIC — flow order,
  // then scenario id — never LLM/authoring completion order.
  const flowOrder = new Map(works.map((w, i) => [w.flow.id, i]))
  const apiFailures: BirthOutcome[] = []
  for (const o of round2Failures) {
    if (o.candidate.scenario.driver === 'api') apiFailures.push(o)
    else settleFailedTest(taskByKey.get(o.candidate.ref)!, o)
  }
  apiFailures.sort(
    (a, b) =>
      (flowOrder.get(a.candidate.flow.id) ?? 0) - (flowOrder.get(b.candidate.flow.id) ?? 0) ||
      a.candidate.scenario.id.localeCompare(b.candidate.scenario.id),
  )
  if (apiFailures.length > 0) {
    const toIsolate = Math.min(apiFailures.length, isolationCap)
    if (toIsolate > 0) options.onBirthPhase?.('confirm', toIsolate)
    for (let i = 0; i < apiFailures.length; i++) {
      const outcome = apiFailures[i]
      const task = taskByKey.get(outcome.candidate.ref)!
      if (i >= isolationCap) {
        settleFailedTest(task, outcome) // over the cap → batch evidence
        continue
      }
      // NOT folded into the anomaly sample: isolation RE-RUNS candidates whose
      // steps round 2 already counted — folding would double-count them.
      const isoRun = await birthValidate(repoRoot, [outcome.candidate], { executor, recipe, skipBuild: true, noOpThresholdMs: options.noOpThresholdMs })
      // A refusal DURING isolation says nothing about this candidate: its batch
      // verdict already stands and is settled below, so the refusal is recorded (once)
      // WITHOUT unsettling anything — hence the empty pool.
      settleRefusal(isoRun, [])
      const iso = isoRun.outcomes
      const isoResult = iso[0]?.result
      if (isoResult?.outcome === 'pass') {
        pushInto(persisted, outcome.candidate.ref, outcome.candidate) // the batch polluted it
      } else if (isoResult?.outcome === 'fail') {
        settleFailedTest(task, iso[0]) // confirmed — clean-room evidence
      } else {
        settleFailedTest(task, outcome) // isolation errored (infra) — keep the batch evidence
      }
    }
  }

  // 10. Fidelity review (item 33): every green candidate is audited against its
  // FLOW's milestones before it may persist. It reviews the birth PASSES only — a
  // failing test's verdict is already "the code disagrees", and a reviewer pass over
  // it would buy nothing the birth evidence does not already say.
  let fidelityReviewed = 0
  let fidelityPlanned = [...persisted.values()].reduce((n, list) => n + list.length, 0)
  if (fidelityRunner && fidelityPlanned > 0) {
    options.onFidelityProgress?.(0, fidelityPlanned)
    // Reviews fan out across EVERY flow through the shared pool — one scenario per
    // (flow, surface) means a per-flow loop would review the corpus serially.
    const reviews = await Promise.all(
      [...persisted].flatMap(([ref, candidates]) =>
        candidates.map((c) =>
          limit(async () => {
            const review = await reviewFidelity(repoRoot, taskByKey.get(ref)!, c, fidelityRunner)
            options.onFidelityProgress?.(++fidelityReviewed, fidelityPlanned)
            return { ref, c, review }
          }),
        ),
      ),
    )
    const faithful = new Map<string, BirthCandidate[]>()
    // HIGH-confidence flags with auto-resolve budget left SELF-HEAL (item 83):
    // the candidate is discarded and its flow re-authored ONCE — an auditable
    // ledger row, never a human task. Every other flag is a rejection: at HIGH
    // over budget it carries the escalation note ("re-generation is not fixing
    // this"); either way the flow is tainted so the next generate authors fresh.
    const selfHeal: { ref: string; candidate: BirthCandidate; mismatch: string }[] = []
    for (const { ref, c, review } of reviews) {
      const task = taskByKey.get(ref)!
      if ('error' in review) {
        task.errored = true
        errors.push({
          doc: task.work.primary.doc,
          anchor: task.work.primary.anchor,
          message: `fidelity review (${task.surface}) ${review.error}`,
        })
      } else if (review.verdict === 'flagged') {
        const key = autoResolutionKey(c.flow.id, c.surface)
        if (review.confidence === 'high' && autoResolveCount(key) < escalateAfter) {
          selfHeal.push({ ref, candidate: c, mismatch: review.mismatch })
          bumpLedger(key, 'fidelity')
        } else {
          const finding = fidelityFinding(c, review.mismatch)
          if (review.confidence === 'high') {
            finding.autoResolveEscalation = { count: autoResolveCount(key), source: 'fidelity' }
          }
          pushInto(fidelityRejections, ref, finding)
          taintFlow(c.flow.id, c.surface, c.scenario.title, review.mismatch)
        }
      } else {
        pushInto(faithful, ref, c)
      }
    }
    for (const ref of persisted.keys()) persisted.set(ref, faithful.get(ref) ?? [])

    if (selfHeal.length > 0) {
      // Free the discarded ids so each re-author reuses its stable `<flow>.<surface>.1`.
      for (const { candidate } of selfHeal) usedIds.delete(candidate.scenario.id)
      let healDone = 0
      options.onRetryProgress?.(0, selfHeal.length)
      const replacements: BirthCandidate[] = []
      const healOutcomes = new Map<string, 'resolved' | 'finding' | 'unresolved'>()
      await Promise.all(
        selfHeal.map((h) =>
          limit(async () => {
            const task = taskByKey.get(h.ref)!
            try {
              const attempt = await authorFlowScenario({
                repoRoot,
                task,
                recipe,
                recipeFingerprint,
                runner: generateRunner,
                opIndex,
                docText,
                ground: groundClaims,
                externalServices: externalServiceHints,
                requestContracts,
                apiJourneys,
                outboundRequests: outboundRequestHints,
                outboundRequestsOverflow,
                serverIndex,
                // The rejection is the correction evidence; it also bypasses the
                // author cache, which still holds the discarded scenario.
                priorFlag: { title: h.candidate.scenario.title, mismatch: h.mismatch },
                onAuthorFailure: options.onAuthorFailure,
              })
              if ('error' in attempt) {
                task.errored = true
                errors.push({
                  doc: task.work.primary.doc,
                  anchor: task.work.primary.anchor,
                  kind: 'authoring',
                  flowId: task.work.flow.id,
                  surface: task.surface,
                  message: `re-author after fidelity discard (${task.surface}) ${attempt.error}`,
                })
                healOutcomes.set(h.ref, 'unresolved')
                return
              }
              if (!attempt.scenario) {
                const blockedOn = enrichBlockedOn(attempt.blockedOn, externalServices)
                const reason = composeBlockedOnReason(blockedOn, oneLine(task.work.flow.title))
                task.work.gaps.push({ surface: task.surface, kind: 'blocked-on', reason })
                coverageGaps.push({
                  doc: task.work.primary.doc,
                  anchor: task.work.primary.anchor,
                  kind: 'blocked-on',
                  flowId: task.work.flow.id,
                  surface: task.surface,
                  reason,
                })
                healOutcomes.set(h.ref, 'unresolved')
                return
              }
              const built = safeBuild(task, attempt.scenario, usedIds, errors, defaultApiServer)
              if (built) replacements.push(built)
              else healOutcomes.set(h.ref, 'unresolved')
            } finally {
              options.onRetryProgress?.(++healDone, selfHeal.length)
            }
          }),
        ),
      )
      if (replacements.length > 0) {
        birthTotal += replacements.length
        const healRun = await birthValidate(repoRoot, replacements, { executor, recipe, skipBuild: true, noOpThresholdMs: options.noOpThresholdMs, onPhase: options.onBirthPhase, onScenarioSettled: bumpBirth })
        reconcileBirth()
        settleRefusal(healRun, replacements)
        // The heal round runs fresh scenarios — its steps join the same sample.
        const healAnomaly = foldBirthRound(healRun)
        if (healAnomaly) {
          return emptyResult('recipe-failed', { reason: noOpAnomalyReason(healAnomaly, recipe) })
        }
        if (healRun.refusal) for (const c of replacements) healOutcomes.set(c.ref, 'unresolved')
        const healPasses: BirthOutcome[] = []
        for (const o of healRun.outcomes) {
          const task = taskByKey.get(o.candidate.ref)!
          if (o.result.outcome === 'pass') healPasses.push(o)
          else if (o.result.outcome === 'fail') {
            // A failing replacement is just another failing test: the triage +
            // routing below decide commit vs withhold.
            settleFailedTest(task, o)
            healOutcomes.set(o.candidate.ref, 'finding')
          } else if (settleUnservedRoute(task, o)) {
            healOutcomes.set(o.candidate.ref, 'unresolved')
          } else {
            task.errored = true
            errors.push(errorFrom(o))
            healOutcomes.set(o.candidate.ref, 'unresolved')
          }
        }
        // The replacement is reviewed again — a flag at ANY confidence is now a
        // rejection (at most one self-heal per flow per run).
        fidelityPlanned += healPasses.length
        const finalReviews = await Promise.all(
          healPasses.map((o) =>
            limit(async () => {
              const review = await reviewFidelity(repoRoot, taskByKey.get(o.candidate.ref)!, o.candidate, fidelityRunner)
              options.onFidelityProgress?.(++fidelityReviewed, fidelityPlanned)
              return { o, review }
            }),
          ),
        )
        for (const { o, review } of finalReviews) {
          const c = o.candidate
          const task = taskByKey.get(c.ref)!
          if ('error' in review) {
            task.errored = true
            errors.push({
              doc: task.work.primary.doc,
              anchor: task.work.primary.anchor,
              message: `fidelity review (${task.surface}) ${review.error}`,
            })
            healOutcomes.set(c.ref, 'unresolved')
          } else if (review.verdict === 'flagged') {
            pushInto(fidelityRejections, c.ref, fidelityFinding(c, review.mismatch))
            taintFlow(c.flow.id, c.surface, c.scenario.title, review.mismatch)
            healOutcomes.set(c.ref, 'finding')
          } else {
            pushInto(persisted, c.ref, c)
            healOutcomes.set(c.ref, 'resolved')
          }
        }
      }
      // The ledger rows — one per discard, with the re-author's outcome. A heal
      // that did NOT converge leaves the flow tainted, so the NEXT generate
      // re-authors fresh again (a `resolved` heal settles clean and needs none).
      for (const h of selfHeal) {
        const outcome = healOutcomes.get(h.ref) ?? 'unresolved'
        autoResolved.push({
          kind: 'fidelity-discard',
          flowId: h.candidate.flow.id,
          surface: h.candidate.surface,
          doc: h.candidate.section.doc,
          anchor: h.candidate.section.anchor,
          title: h.candidate.scenario.title,
          mismatch: h.mismatch,
          outcome,
        })
        if (outcome !== 'resolved') {
          taintFlow(h.candidate.flow.id, h.candidate.surface, h.candidate.scenario.title, h.mismatch)
        }
      }
    }
  }

  // 10.5 Triage (item 81) — ONE judgment call per failing test, after every birth
  // round has settled. The verdict (+ confidence, brief, unblock recommendation)
  // attaches to the TEST's birth finding in place; the flow rolls it up read-side.
  // Setup-class failures never reach here — the runner's deterministic machinery
  // (run refusals, unserved routes, setup-defect results, authoring `blockedOn`)
  // routed them to the needs-setup/blocked states before any verdict existed, which
  // is why the verdict set has no `environment`. Fail-soft and cached per failure
  // identity: a re-generate re-triages only new or changed failures, and a test
  // whose call cannot complete commits untriaged.
  const failedEntries = [...failedTests.values()].flat()
  if (triageRunner && failedEntries.length > 0) {
    let triaged = 0
    options.onTriageProgress?.(0, failedEntries.length)
    await Promise.all(
      failedEntries.map((entry) =>
        limit(async () => {
          try {
            const { candidate, finding } = entry
            const section = sectionByKey.get(flowSectionKey(finding.doc, finding.anchor))
            const milestones: TriageMilestone[] = [...candidate.flow.milestones]
              .sort((a, b) => a.order - b.order)
              .map((m) => ({
                order: m.order,
                claim: m.claimTitle,
                ...(m.order === finding.failedMilestone ? { failed: true } : {}),
              }))
            // The request-surface grounding the pipeline already holds: real probe
            // transcripts for a cli test (a cache hit — authoring grounded the same
            // claim), the plan's inbound request contracts for an api test.
            const probes =
              candidate.surface === 'cli' && finding.claim ? await groundClaims([finding.claim]) : []
            const plan = taskByKey.get(candidate.ref)?.plan
            const journeyContracts =
              candidate.surface === 'api' && plan
                ? buildJourneyContractHints(plan.journeys, requestContracts)
                : []
            const triage = await runTriage(
              repoRoot,
              finding,
              {
                flow: { id: candidate.flow.id, title: candidate.flow.title, goal: candidate.flow.goal },
                surface: candidate.surface,
                sectionHeading: section?.headingText ?? finding.anchor,
                sectionText: section ? section.fullText || section.ownText : '',
                milestones,
                probes,
                journeyContracts,
              },
              triageRunner,
            )
            if (triage) finding.triage = triage
          } finally {
            options.onTriageProgress?.(++triaged, failedEntries.length)
          }
        }),
      ),
    )
  }

  // Item 80 — birth-failure routing. A failing test commits only when triage
  // blamed the REPO (`code-drift` / `doc-drift`) or produced no verdict (the
  // conservative default: red drift is the product's value, so an untriaged
  // failure is never silently withheld). A `generation-defect` verdict says OUR
  // scenario is faulty — it is withheld from the corpus and its flow stays
  // unsettled, so the next generate re-authors it (tainted, so the poisoned
  // author cache is bypassed). At HIGH confidence with auto-resolve budget left
  // the failure is RETIRED to the ledger (item 83) — an auditable row, never a
  // human task — and past the budget it escalates as one ("re-generation is not
  // fixing this"). Setup-class failures never got this far: the deterministic
  // machinery settled them without a verdict.
  const autoRetiredRefs = new Set<string>()
  for (const [ref, entries] of failedTests) {
    const commitClass: typeof entries = []
    for (const e of entries) {
      const triage = e.finding.triage
      if (triage?.verdict !== 'generation-defect') {
        commitClass.push(e)
        continue
      }
      const c = e.candidate
      const key = autoResolutionKey(c.flow.id, c.surface)
      taintFlow(c.flow.id, c.surface, e.finding.title, triage.brief)
      if (triage.confidence === 'high' && autoResolveCount(key) < escalateAfter) {
        autoResolved.push({
          kind: 'triage-resolve',
          flowId: c.flow.id,
          surface: c.surface,
          doc: e.finding.doc,
          anchor: e.finding.anchor,
          title: e.finding.title,
          verdict: triage.verdict,
          brief: triage.brief,
        })
        bumpLedger(key, 'triage')
        autoRetiredRefs.add(ref)
        continue
      }
      if (triage.confidence === 'high') {
        e.finding.autoResolveEscalation = { count: autoResolveCount(key), source: 'triage' }
      }
      pushInto(withheldFailures, ref, e.finding)
    }
    failedTests.set(ref, commitClass)
  }

  // 11. Persist — INDEPENDENTLY, per scenario, whatever its birth execution said.
  // A test that passed is written; a test that FAILED is written too, with its
  // birth result recorded (item 50) and `status: 'failing'` in the manifest — a
  // committed failing test is a decision surface, so its flow SETTLES. Only a
  // fidelity rejection (the test itself is wrong) or an error withholds work and
  // leaves the flow unsettled for the next generate.
  const written: GeneratedScenarioInfo[] = []
  const birthFindings: GuardBirthFinding[] = []
  const workingManifest = new Map<string, GuardManifestFlow>()
  let flowsSettled = 0
  const settleTotal = changedWorks.length
  const writeWorkingManifest = (): void => {
    const flows = [...workingManifest.values()].sort((a, b) => a.flowId.localeCompare(b.flowId))
    writeManifest(repoRoot, { version: GUARD_FORMAT_VERSION, flows })
  }

  // THE SETTLE INVARIANT, enforced at the one place a flow settles: an entry may
  // record its inputs hash (and be skipped by every future generate) only when each
  // surface it PLANNED accounts for itself with a committed test or a gap. An entry
  // that would settle in silence is left UNSETTLED with the reason recorded — never
  // a hole nothing can re-run.
  const enforceSettleInvariant = (entry: GuardManifestFlow): GuardManifestFlow => {
    const unaccounted = unaccountedSurfaces(entry)
    if (entry.generationInputsHash === null || unaccounted.length === 0) return entry
    errors.push({
      doc: entry.bindings[0]?.doc ?? entry.flowId,
      anchor: entry.bindings[0]?.anchor ?? '',
      message: `flow "${entry.flowId}" planned ${unaccounted.join(', ')} but recorded neither a test nor a gap there — left unsettled for the next generate`,
    })
    return { ...entry, generationInputsHash: null }
  }

  for (const work of works) {
    if (!work.changed) {
      // Unchanged: its committed scenarios stand, its MATCH-stage gaps are re-derived
      // (the author-stage ones were carried forward above, since authoring does not
      // run), and its hash carries so the next generate is a no-op again.
      workingManifest.set(
        work.flow.id,
        enforceSettleInvariant(manifestEntry(work, work.prior?.scenarios ?? [], work.inputsHash)),
      )
      continue
    }
    // The flow re-authored: its OWN prior files go, then its survivors land.
    deleteScenarioFiles(repoRoot, work.prior?.scenarios.map((s) => s.id) ?? [])
    const slug = areaOrDocSlug(work.primary)
    const scenarios: GuardManifestScenario[] = []
    let unsettledFlow = false
    for (const [surface] of work.plans) {
      const ref = `${work.flow.id}\0${surface}`
      const task = taskByKey.get(ref)
      const commit = (c: BirthCandidate, status: GuardTestStatus, finding?: GuardBirthFinding): string => {
        const file = writeScenarioFile(repoRoot, slug, c.scenario)
        written.push({
          id: c.scenario.id,
          title: c.scenario.title,
          doc: work.primary.doc,
          anchor: work.primary.anchor,
          file,
          flowId: work.flow.id,
          surface,
          status,
        })
        // A failing test COMMITS WITH its diagnosis (item 80): the manifest entry
        // is the durable record — it travels with the corpus and survives every
        // no-op generate, so the report's committed row re-derives from it.
        scenarios.push({
          id: c.scenario.id,
          surface,
          status,
          ...(finding ? { diagnosis: diagnosisOf(finding, file) } : {}),
        })
        return file
      }
      for (const c of persisted.get(ref) ?? []) commit(c, 'passing')
      for (const { candidate, finding } of failedTests.get(ref) ?? []) {
        const file = commit(candidate, 'failing', finding)
        // The birth result rides the report keyed on the test it belongs to, so
        // every failure now names a scenario the user can open, re-run, or delete.
        birthFindings.push({ ...finding, scenarioId: candidate.scenario.id, committed: true, file })
      }
      const rejections = fidelityRejections.get(ref) ?? []
      const withheld = withheldFailures.get(ref) ?? []
      birthFindings.push(...rejections, ...withheld)
      // An auto-retired failure left no row — but the flow still re-attempts.
      if (rejections.length > 0 || withheld.length > 0 || autoRetiredRefs.has(ref) || task?.errored) {
        unsettledFlow = true
      }
    }
    // A flow left unsettled on some surface keeps a manifest entry (its committed
    // tests are real coverage) but records NO inputs hash, so the next generate
    // re-runs it. A committed failing test is NOT such a surface — it settled.
    const entry = enforceSettleInvariant(manifestEntry(work, scenarios, unsettledFlow ? null : work.inputsHash))
    workingManifest.set(work.flow.id, entry)
    if (entry.generationInputsHash === null) flowsReport.unsettled++
    else flowsReport.settled++
    options.onFlowSettled?.(++flowsSettled, settleTotal)
  }
  flowsReport.settled += flowsReport.skipped
  // A committed flow that no longer exists is treated by INTENT, not by symmetry:
  //  - DISMISSED — the user said "don't guard this": its scenarios are deleted with it.
  //    So is a flow synthesis stopped producing because EVERY claim it was composed
  //    from is dismissed: the dismissal is the intent, and the tests it authored
  //    (including a committed failing one) go with the claims they asserted.
  //  - ORPHANED WITH TESTS — its entry and files are CARRIED FORWARD untouched but
  //    MARKED (`orphaned: true`), so the next `guard run` surfaces those scenarios
  //    as stale drift instead of coverage silently disappearing, and every reader
  //    can say WHY the flow has no goal or milestones.
  //  - ORPHANED WITH NO TEST — a ghost: no flow derives it, no test realizes it, so
  //    the entry is pure stale bookkeeping. It is PRUNED, and its gaps (which
  //    explain a missing test for a flow that no longer exists) die with it. The
  //    rule reads the entry, not this run's synthesis, so ghosts carried forward by
  //    EARLIER generates are pruned on the next one too.
  const dismissedAway = new Set(
    synthesis.orphaned
      .filter((f) =>
        f.milestones.length > 0 &&
        f.milestones.every((m) => dismissalByKey.has(dismissedClaimKey(m.doc, m.anchor, m.claimTitle))),
      )
      .map((f) => f.id),
  )
  // Synthesis still produces these ids — a prior entry among them is not orphaned,
  // it just did not settle this run (its sections vanished mid-run and it was
  // skipped with an error), so it is carried untouched and never marked or pruned.
  const synthesizedIds = new Set(synthesis.flows.map((f) => f.id))
  const orphanedThisRun = new Set(synthesis.orphaned.map((f) => f.id))
  let removedFlows = 0
  let prunedFlows = 0
  for (const [flowId, prior] of priorFlows) {
    if (workingManifest.has(flowId)) continue
    if (flowDismissalById.has(flowId) || dismissedAway.has(flowId)) {
      deleteScenarioFiles(repoRoot, prior.scenarios.map((s) => s.id))
      removedFlows++
      // Removed by intent — never counted among the orphans whose scenarios are kept.
      if (dismissedAway.has(flowId)) flowsReport.orphaned--
      continue
    }
    if (synthesizedIds.has(flowId)) {
      workingManifest.set(flowId, prior)
      continue
    }
    if (prior.scenarios.length === 0) {
      prunedFlows++
      // The count means "orphans whose coverage was kept" — a pruned ghost kept none.
      if (orphanedThisRun.has(flowId)) flowsReport.orphaned--
      continue
    }
    workingManifest.set(flowId, { ...prior, orphaned: true })
  }
  writeWorkingManifest()

  // Item 66's post-generate seed drafting used to run HERE. It is gone (item 78):
  // `truecourse guard setup` writes the seed BEFORE the first extraction call, and
  // item 66's own gate refused to overwrite an existing `api.seed` — so the stage was
  // dead by construction the moment setup became a prerequisite.

  // Reconcile the durable ledger ONCE (item 83) — counts and taints together:
  //  - counts: prior entries carry; this run's auto-resolutions bump theirs; a
  //    flow that CONVERGED (committed a passing test) clears its budget.
  //  - taints: a tainted flow freshly re-authored this run clears (the poisoned
  //    cache entry was overwritten) unless it re-flagged; a flow that ended
  //    rejected is (re)tainted with the latest evidence; a flow neither
  //    re-authored nor cleared keeps its prior taint.
  // Written only when something is (or was) in the ledger, so a clean run never
  // creates the file.
  const nextEntries: Record<string, GuardAutoResolutionEntry> = { ...priorLedger.entries }
  for (const [key, bump] of ledgerBumps) {
    nextEntries[key] = {
      count: (priorLedger.entries[key]?.count ?? 0) + bump.times,
      source: bump.source,
      updatedAt: nowIso,
    }
  }
  for (const w of written) {
    if (w.status === 'passing') delete nextEntries[autoResolutionKey(w.flowId, w.surface)]
  }
  const nextTainted: Record<string, GuardFlowTaint> = { ...priorLedger.tainted }
  for (const key of freshlyAuthoredTaints) delete nextTainted[key]
  for (const [key, taint] of flaggedFlows) nextTainted[key] = taint
  if (
    Object.keys(nextEntries).length > 0 ||
    Object.keys(nextTainted).length > 0 ||
    Object.keys(priorLedger.entries).length > 0 ||
    Object.keys(priorLedger.tainted).length > 0
  ) {
    writeGuardAutoResolutions(repoRoot, { version: 1, entries: nextEntries, tainted: nextTainted })
  }

  // The surviving-pass identity (B6): one count per birth pass that reached a
  // reported bucket — a committed passing test, a fidelity rejection, or a
  // fidelity-discard ledger row. A pass whose review could not complete reaches
  // no bucket and is not counted.
  const birthPassed =
    written.filter((w) => w.status === 'passing').length +
    [...fidelityRejections.values()].reduce((n, list) => n + list.length, 0) +
    autoResolved.filter((a) => a.kind === 'fidelity-discard').length

  return {
    status: 'ok',
    recipe: recipeMeta,
    recipeFingerprint,
    sectionsTotal: plan.sections.length,
    sectionsChanged: plan.work.length,
    skippedUnchanged: plan.sections.length - plan.work.length,
    // A prune rewrites a committed file, so it is never a no-op run.
    noChanges: changedWorks.length === 0 && removedFlows === 0 && prunedFlows === 0,
    written,
    coverageGaps,
    birthFindings,
    errors,
    extractionFailures,
    orphaned: orphanedSections,
    birthPassed,
    orphanedDismissals,
    orphanedFlowDismissals,
    autoResolved,
    flows: flowsReport,
    journeys: journeysReport,
    externalServices,
    manifestPath: manifestPath(repoRoot),
    ...(entryPreflightFailure ? { entryPreflight: entryPreflightFailure } : {}),
    ...(runRefusal ? { refusal: runRefusal } : {}),
  }
}

/** Every path a plan's journeys enter through — what the flow will actually drive,
 *  and therefore what decides its server (item 76's Gate B). */
function journeyPaths(plan: RealizationPlan): string[] {
  const paths: string[] = []
  for (const journey of plan.journeys) {
    const entry = journey.entry as { path?: string }
    if (typeof entry?.path === 'string') paths.push(entry.path)
  }
  return paths
}

// ---------------------------------------------------------------------------
// Per-flow bookkeeping
// ---------------------------------------------------------------------------

/** One flow's resolved generation state: where it binds, how it realizes, and
 *  whether its inputs moved since the manifest. */
interface FlowWork {
  flow: GuardFlow
  /** The flow's PRIMARY bound section — its first milestone's, for attribution. */
  primary: SectionInput
  /** Milestone order → its live section. */
  sections: Map<number, SectionInput>
  /** Every bound section's content key — the flow hash's spec half. */
  sectionKeys: string[]
  /** The realization plan per surface that has one. */
  plans: Map<GuardDriverId, RealizationPlan>
  /**
   * The recipe server each surface's plan binds to (item 76), when the route
   * manifest could positively attribute its paths to a declared server. Absent for
   * the surfaces (and the repos) where nothing is known — the scenario then means
   * the recipe's default server, exactly as every pre-multi-server scenario does.
   */
  serverBySurface: Map<GuardDriverId, string>
  /** Why the other surfaces have no scenario. */
  gaps: GuardManifestGap[]
  inputsHash: string
  prior?: GuardManifestFlow
  changed: boolean
}

/** One (flow, surface) authoring unit. */
interface AuthorTask {
  work: FlowWork
  surface: GuardDriverId
  plan: RealizationPlan
  /** The recipe server this scenario runs against (item 76), when the binding knows
   *  it. Absent ⇒ the recipe's default server, and no `server` is stamped. */
  server?: string
  /** Set when authoring/birth/fidelity errored — the flow stays unsettled. */
  errored?: boolean
}

const taskKey = (task: { work: FlowWork; surface: GuardDriverId }): string => `${task.work.flow.id}\0${task.surface}`

function manifestEntry(
  work: FlowWork,
  scenarios: GuardManifestScenario[],
  generationInputsHash: string | null,
): GuardManifestFlow {
  return {
    flowId: work.flow.id,
    flowFingerprint: work.flow.fingerprint,
    bindings: work.flow.bindings,
    scenarios: scenarios.slice().sort((a, b) => a.id.localeCompare(b.id)),
    // Every surface that got a PLAN records the journeys it walks — including the
    // surfaces that then failed to author (blocked-on / errored) and contribute no
    // scenario. That is the only record that the spec DOES reach this code path,
    // so the journeys view never calls a matched-but-blocked path unmentioned.
    journeys: [...work.plans.entries()]
      .map(([surface, plan]) => ({ surface, journeyIds: plan.journeys.map((j) => j.id) }))
      .filter((j) => j.journeyIds.length > 0)
      .sort((a, b) => a.surface.localeCompare(b.surface)),
    generationInputsHash,
    gaps: work.gaps.slice().sort((a, b) => a.surface.localeCompare(b.surface) || a.kind.localeCompare(b.kind)),
  }
}

/** The flow's first milestone's live section — the attribution pivot. Null when no
 *  milestone's section survives in the live index. */
function primarySection(flow: GuardFlow, byKey: ReadonlyMap<string, SectionInput>): SectionInput | null {
  for (const m of [...flow.milestones].sort((a, b) => a.order - b.order)) {
    const section = byKey.get(flowSectionKey(m.doc, m.anchor))
    if (section) return section
  }
  return null
}

/**
 * The surfaces a flow is accounted for: every runnable driver the recipe prepares
 * (where a scenario could exist) UNION every surface the journey mapper detected
 * (so a mapped-but-unrunnable surface is visible coverage, not silence). Registry
 * order, so the accounting is deterministic.
 */
function accountedSurfaces(recipe: Recipe, catalogs: ReadonlyMap<GuardDriverId, SurfaceCatalog>): GuardDriverId[] {
  const wanted = new Set<GuardDriverId>(catalogs.keys())
  for (const id of runnableDriverIds) if (driverPrepared(recipe, id)) wanted.add(id)
  return [...wanted].sort()
}

/** True when this surface reaches the matcher (runnable, prepared, catalog non-empty). */
function matchable(
  surface: GuardDriverId,
  recipe: Recipe,
  catalogs: ReadonlyMap<GuardDriverId, SurfaceCatalog>,
): boolean {
  return isRunnableDriver(surface) && driverPrepared(recipe, surface) && (catalogs.get(surface)?.journeys.length ?? 0) > 0
}

/**
 * The user-provided external accounts that are actually USABLE this run (item 62):
 * declared in `api.externals` AND fully resolved (base URL + every declared env
 * var, counting the gitignored `externals.local.json` overlay and the host env).
 * A malformed overlay degrades to "none provided" rather than failing generation —
 * authoring against a service that is not really reachable is the harm to avoid,
 * and the RUNNER refuses the same repo loudly with `missing-external-env`.
 */
function resolveProvidedExternals(repoRoot: string, recipe: Recipe): ResolvedExternal[] {
  try {
    return loadResolvedExternals(repoRoot, recipe.api?.externals).filter((e) => e.state === 'provided')
  } catch {
    return []
  }
}

/**
 * The authoring hints: every DETECTED third party (the blockers worth naming), each
 * marked `provided` when the user supplied an account for it, plus any PROVIDED
 * service the detector never saw (appended, sorted, so the order stays stable). A
 * provided service's `baseUrlEnv` comes from the RECIPE — that declaration is what
 * the runner actually injects, so it beats the detector's guess.
 */
function buildExternalServiceHints(
  detected: readonly DetectedExternalService[],
  provided: readonly ResolvedExternal[],
): ExternalServiceHint[] {
  const byService = new Map(provided.map((p) => [p.service, p]))
  const hints: ExternalServiceHint[] = detected.map((s) => {
    const account = byService.get(s.service)
    if (!account) {
      // Every detected override variable rides along (item 63) — a stub has to point
      // all of them at itself. Only ONE is still rendered as before.
      const baseUrlEnvs = (s.baseUrlEnvs ?? []).map((e) => e.envVar)
      return {
        name: s.service,
        ...(s.baseUrlEnv ? { baseUrlEnv: s.baseUrlEnv } : {}),
        ...(baseUrlEnvs.length > 1 ? { baseUrlEnvs } : {}),
      }
    }
    return providedHint(account)
  })
  const seen = new Set(detected.map((s) => s.service))
  for (const account of [...provided].sort((a, b) => a.service.localeCompare(b.service))) {
    if (!seen.has(account.service)) hints.push(providedHint(account))
  }
  return hints
}

function providedHint(account: ResolvedExternal): ExternalServiceHint {
  return {
    name: account.service,
    baseUrlEnv: account.baseUrlEnv,
    provided: true,
    ...(account.mode ? { mode: account.mode } : {}),
    ...(account.description ? { description: account.description } : {}),
  }
}

/** What ONE analysis pass of the working tree yields this run — see {@link JourneyProvider}. */
interface MappedSurface {
  journeys: Journey[]
  externalServices: DetectedExternalService[]
  /** Per-operation inbound request contracts — the per-journey authoring grounding. */
  requestContracts: ApiRequestContract[]
  /** The app's own outbound request construction — the stub-fidelity grounding. */
  outboundRequests: OutboundRequest[]
  /** The detected datastore + its parsed schema — the seed draft's whole grounding. */
  database: SeedDraftDatabase | null
  /** The connection URLs the app writes down — the generated datastore's source. */
  datastoreUrls: DatastoreUrlRef[]
}

/**
 * The journey catalog for this run: the injected mapper, else the last mapping's
 * snapshot, else empty. A mapper that throws degrades to the snapshot for the same
 * reason it degrades to empty — the spec half of the pipeline must keep working on
 * a repo the mapper chokes on.
 */
async function mapJourneysSafely(repoRoot: string, provider?: JourneyProvider): Promise<MappedSurface> {
  if (provider) {
    try {
      const mapped = await provider()
      return {
        journeys: mapped.journeys,
        externalServices: mapped.externalServices ?? [],
        database: mapped.database ?? null,
        datastoreUrls: mapped.datastoreUrls ?? [],
        requestContracts: mapped.requestContracts ?? [],
        outboundRequests: mapped.outboundRequests ?? [],
      }
    } catch {
      /* fall through to the snapshot */
    }
  }
  // The snapshot carries journeys only — external services are derived from the
  // working tree, never persisted, so a degraded run reports none rather than a
  // stale list.
  return {
    journeys: readJourneyCatalog(repoRoot)?.journeys ?? [],
    externalServices: [],
    database: null,
    datastoreUrls: [],
    requestContracts: [],
    outboundRequests: [],
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function oneLine(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 120 ? `${t.slice(0, 120)}…` : t
}

/** The first sentence of a runner failure message — its VERDICT, without the
 *  remediation sentence that follows it (which the gap's own noun already implies). */
function firstSentence(text: string): string {
  const stop = text.indexOf('. ')
  return stop === -1 ? text : text.slice(0, stop)
}

/** Group a doc's snapped extraction by anchor: claims per section + notes per section. */
function groupExtraction(data: DocClaims): {
  claimsByAnchor: Map<string, DocClaims['claims']>
  noteByAnchor: Map<string, DocClaims['untestable'][number]>
} {
  const claimsByAnchor = new Map<string, DocClaims['claims']>()
  for (const c of data.claims) pushInto(claimsByAnchor, c.sectionAnchor, c)
  const noteByAnchor = new Map(data.untestable.map((n) => [n.sectionAnchor, n]))
  return { claimsByAnchor, noteByAnchor }
}

/**
 * The `recipe-failed` reason for a no-op birth anomaly (C4), per driver: what
 * tripped, the counts, and the fix. The cli text names the entry argv and the
 * timing threshold; the api text names the serve argv and the uniform
 * status+emptiness that make a booted server a dead stub.
 */
function noOpAnomalyReason(anomaly: GuardNoOpAnomaly, recipe: Recipe): string {
  if (anomaly.driver === 'cli') {
    const pct = Math.round(anomaly.fraction * 100)
    return (
      `The recipe entry \`${(recipe.entry ?? []).join(' ')}\` behaves like a do-nothing binary: ${anomaly.noOpSteps} of ` +
      `${anomaly.executedSteps} birth steps (${pct}%) exited 0 with no output in under ${anomaly.thresholdMs}ms, ` +
      `so it ignores its arguments. Every scenario validated against it would be a silent no-op, so generation ` +
      `was aborted before writing any scenarios or spending retry/fidelity calls. Fix the recipe entry (it likely ` +
      `names a stale build output or a placeholder such as \`true\`) and re-run \`truecourse guard generate\`.`
    )
  }
  const pct = Math.round(anomaly.fraction * 100)
  const serve = defaultServerServe(recipe) ?? []
  return (
    `The api server (\`${serve.join(' ')}\`) behaves like a dead stub: ${anomaly.inertRequests} of ` +
    `${anomaly.executedRequests} birth requests (${pct}%) answered with an EMPTY body, and every completed ` +
    `request answered the same status (${anomaly.status}) across ${anomaly.requestLines} distinct method+path ` +
    `request lines — the server answers every route identically with nothing, regardless of what it is asked. ` +
    `Every scenario validated against it would prove nothing about the spec, so generation was aborted before ` +
    `writing any scenarios or spending retry/fidelity calls. Fix the recipe's api serve command (it likely boots ` +
    `a placeholder or the wrong service) and re-run \`truecourse guard generate\`.`
  )
}

function emptyResult(status: 'no-docs' | 'recipe-failed', extra: { reason: string }): GuardGenerateResult {
  return {
    status,
    reason: extra.reason,
    sectionsTotal: 0,
    sectionsChanged: 0,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    birthPassed: 0,
    orphanedDismissals: [],
    orphanedFlowDismissals: [],
    autoResolved: [],
    flows: {
      total: 0,
      settled: 0,
      unsettled: 0,
      skipped: 0,
      dismissed: 0,
      orphaned: 0,
      subsumed: 0,
      noFlowClaims: 0,
      unsettledAreas: [],
    },
    journeys: { total: 0, bySurface: {} },
    externalServices: [],
  }
}

/** Append `value` to the array at `map[key]`, creating it on first use. */
function pushInto<T>(map: Map<string, T[]>, k: string, value: T): void {
  const list = map.get(k)
  if (list) list.push(value)
  else map.set(k, [value])
}

/** Two gap records saying the same thing about the same surface. */
function sameGap(a: GuardManifestGap, b: GuardManifestGap): boolean {
  return a.surface === b.surface && a.kind === b.kind && a.reason === b.reason
}

/** True when the recipe carries a driver's preparation layer. */
function driverPrepared(recipe: Recipe, driver: GuardDriverId): boolean {
  if (driver === 'cli') return recipe.entry !== undefined
  if (driver === 'api') return recipe.api !== undefined
  return false
}

/** The capability noun a prep-missing blocked-on gap names. */
function missingPrepNoun(driver: GuardDriverId): string {
  return driver === 'api' ? 'a recipe `api` block' : 'a recipe `entry`'
}

/** The `dismissed` coverage-gap reason: the subject one-liner, plus the note if any. */
function dismissedReason(subject: string, note?: string): string {
  const base = `dismissed: ${oneLine(subject)}`
  return note ? `${base} — ${oneLine(note)}` : base
}

// --- Authoring ---------------------------------------------------------------

type AuthorAttempt = { scenario: RawGeneratedScenario | null; blockedOn: string[] } | { error: string }

/** The cached authored output for one (flow, surface): its scenario, or the
 *  capabilities the flow is blocked on. */
const AuthoredCacheSchema = z.object({
  scenario: RawGeneratedScenarioSchema.nullable(),
  blockedOn: z.array(z.string().min(1)).default([]),
})

/**
 * Author ONE scenario for one (flow, surface): cache → call → one corrective
 * re-ask when the output is invalid OR leaves a milestone unrealized. The
 * milestone-coverage check is the engine's, not the prompt's: a scenario that
 * silently drops a milestone would guard less than the flow promises.
 */
async function authorFlowScenario(opts: {
  repoRoot: string
  task: AuthorTask
  recipe: Recipe
  recipeFingerprint: string
  runner: GenerateRunner
  opIndex: OperationEntry[]
  /** Doc path → its raw text, for the OpenAPI security resolution the prompt carries. */
  docText: ReadonlyMap<string, string>
  ground: (claimTexts: string[]) => Promise<ProbeTranscript[]>
  /** The third parties this repo imports (item 57) — canonical name + base-URL env
   *  var when one was detected (item 58's stub precondition). Api prompts only. */
  externalServices: ExternalServiceHint[]
  /** Item 69: per-operation inbound contracts, joined to THIS flow's journeys below. */
  requestContracts: ApiRequestContract[]
  /**
   * Item 70: the WHOLE api journey catalog, so the prompt can offer the operations
   * this flow does NOT walk as setup material (signing up before signing in). Empty
   * on a cli batch or a repo with no api surface.
   */
  apiJourneys: Journey[]
  /** Item 69: the repo's outbound request construction, already capped. */
  outboundRequests: OutboundRequestHint[]
  outboundRequestsOverflow: number
  /** Item 76: the app↔server join, so the catalog this prompt advertises is the
   *  BOUND server's own surface and never another service's. */
  serverIndex: ServerRouteIndex
  retry?: BirthRetryContext
  /**
   * Item 83 — the prior-rejection evidence (a taint from an earlier generate, or
   * this run's fidelity self-heal). Its presence BYPASSES the round-1 cache read:
   * the cache still holds the rejected scenario. The fresh result overwrites it.
   */
  priorFlag?: { title: string; mismatch: string }
  /** Live failure sink — fires per failed attempt, before the call sequence resolves. */
  onAuthorFailure?: (failure: AuthorFailure) => void
}): Promise<AuthorAttempt> {
  const { repoRoot, task, recipe, recipeFingerprint, runner, opIndex, retry } = opts
  const { work, surface, plan } = task
  // Fires the moment an attempt fails, so a live surface can say WHICH flow and WHY
  // while the run is still going. Undefined sink ⇒ nothing is built or called.
  const failed = (reason: string, attempt: number, willRetry: boolean): void =>
    opts.onAuthorFailure?.({
      flowId: work.flow.id,
      flowTitle: work.flow.title,
      surface,
      doc: work.primary.doc,
      anchor: work.primary.anchor,
      reason,
      attempt,
      willRetry,
    })
  const journeyFingerprints = plan.journeys.map((j) => j.fingerprint)
  const cacheKey = retry
    ? retryCacheKey(work.flow, surface, work.sectionKeys, journeyFingerprints, recipeFingerprint, {
        ...emptyFinding(),
        ...retry,
        title: retry.scenarioTitle,
      })
    : authorCacheKey(work.flow, surface, work.sectionKeys, journeyFingerprints, recipeFingerprint)

  // D3 — the flow's doc-example blocks, mined once for the byte-fidelity
  // validator (the same mining feeds the per-milestone DOC EXAMPLE prompt
  // blocks through `authorMilestones`).
  const exampleBlocks: DocExampleBlock[] = [...new Set(work.sections.values())].flatMap((s) =>
    mineExampleBlocks(s.fullText || s.ownText).map((b) => ({ ...b, doc: s.doc, anchor: s.anchor })),
  )
  const exampleDefectOf = (scenario: RawGeneratedScenario): string | null =>
    exampleFidelityDefect(
      scenario.driver === 'api'
        ? { driver: 'api', steps: scenario.steps, ...(scenario.setup ? { setup: scenario.setup } : {}) }
        : { driver: 'cli', steps: scenario.steps, ...(scenario.setup ? { setup: scenario.setup } : {}) },
      exampleBlocks,
    )

  // A prior rejection poisons the cache entry (it IS the rejected scenario) —
  // skip the read; the fresh result below overwrites it under the same key.
  const cached = opts.priorFlag ? null : await getCacheEntry(repoRoot, GENERATE_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = AuthoredCacheSchema.safeParse(cached)
    if (parsed.success) {
      if (!parsed.data.scenario) return { scenario: null, blockedOn: parsed.data.blockedOn }
      if (
        uncoveredMilestones(work.flow, parsed.data.scenario).length === 0 &&
        !firstInvalidMatchPattern(parsed.data.scenario.steps) &&
        !compositionDefectOf(parsed.data.scenario, recipe) &&
        !exampleDefectOf(parsed.data.scenario)
      ) {
        return { scenario: parsed.data.scenario, blockedOn: [] }
      }
    }
  }

  // Probes ground CLI commands against the built entry — api scenarios are authored
  // ungrounded (birth evidence supplies the real responses).
  const probes = surface === 'cli' ? await opts.ground(work.flow.milestones.map((m) => m.claimTitle)) : []
  const journeyContracts = buildJourneyContractHints(plan.journeys, opts.requestContracts)
  // Item 76: the setup catalog is the BOUND server's own surface. An operation the
  // route manifest positively attributes to ANOTHER app is unreachable from this
  // scenario, and advertising it is exactly how cal.com's `/v2/...` paths ended up
  // in a scenario bound to `apps/web`. An operation nobody claims stays offered —
  // unknown is not foreign (R6). The flow's OWN operations need no such filter:
  // Gate B already bound the server from those very paths.
  const boundApp = appDirOfServer(opts.serverIndex, task.server)
  const reachableJourneys = boundApp
    ? opts.apiJourneys.filter((j) => !servedByOtherApp(opts.serverIndex, boundApp, journeyEntryPath(j)))
    : opts.apiJourneys
  const other = buildOtherOperationHints(reachableJourneys, opts.requestContracts, journeyContracts)
  const base: AuthorUserContext = {
    ...buildAuthorCtx(work, surface, plan, recipe, probes, opIndex, opts.docText, opts.externalServices, opts.serverIndex, {
      journeyContracts,
      otherOperations: other.operations,
      otherOperationsOverflow: other.overflow,
      outboundRequests: opts.outboundRequests,
      outboundRequestsOverflow: opts.outboundRequestsOverflow,
    }, retry),
    ...(opts.priorFlag ? { priorFlag: opts.priorFlag } : {}),
  }

  let ctx: AuthorUserContext = base
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown
    try {
      raw = await runner(ctx)
    } catch (e) {
      failed(authorFailureReason((e as Error).message), attempt + 1, false)
      return { error: attempt === 0 ? `call failed: ${(e as Error).message}` : `re-ask failed: ${(e as Error).message}` }
    }
    const parsed = AuthoredFlowScenarioSchema.safeParse(raw)
    if (!parsed.success) {
      if (attempt > 0) {
        failed('invalid output twice', attempt + 1, false)
        return { error: `output invalid after re-ask: ${flattenZodError(parsed.error)}` }
      }
      failed('invalid output', attempt + 1, true)
      ctx = { ...base, correction: { invalidOutput: quoteInvalidOutput(raw) } }
      continue
    }
    if (!parsed.data.scenario) {
      const blockedOn = normalizeBlockedOn(parsed.data.blockedOn)
      await setCacheEntry(repoRoot, GENERATE_CACHE_NAME, cacheKey, { scenario: null, blockedOn })
      return { scenario: null, blockedOn }
    }
    const scenario = parsed.data.scenario
    const uncovered = uncoveredMilestones(work.flow, scenario)
    const unknown = unknownMilestones(work.flow, scenario)
    if (uncovered.length > 0 || unknown.length > 0) {
      if (attempt > 0) {
        failed(`${uncovered.length} milestone(s) still unrealized`, attempt + 1, false)
        return {
          error: `scenario left ${uncovered.length} milestone(s) unrealized after re-ask (${uncovered.join(', ')})`,
        }
      }
      failed('milestones unrealized', attempt + 1, true)
      ctx = { ...base, issues: { uncoveredMilestones: uncovered, unknownMilestones: unknown } }
      continue
    }
    // A scenario the schema accepts but the engine cannot COMPOSE — a cli step
    // re-stating the program, an api `${var}` nothing captured, a stub the
    // scenario points at but never declares. Each dies as an infra error mid-run
    // (a wasted sandbox, and a failure that reads like drift), so it is corrected
    // here on the same one re-ask.
    const composition = compositionDefectOf(scenario, recipe)
    if (composition) {
      if (attempt > 0) {
        failed('does not compose twice', attempt + 1, false)
        return { error: `scenario still does not compose after re-ask (${composition})` }
      }
      failed('does not compose', attempt + 1, true)
      ctx = {
        ...base,
        issues: { uncoveredMilestones: [], unknownMilestones: [], composition },
      }
      continue
    }
    // D3 — a scenario embedding a REFORMATTED copy of a doc's own example runs
    // different bytes than the ones the doc promised an outcome for. Corrected
    // on the same single re-ask a composition defect gets.
    const exampleDefect = exampleDefectOf(scenario)
    if (exampleDefect) {
      if (attempt > 0) {
        failed('reformats a doc example twice', attempt + 1, false)
        return { error: `scenario still reformats the doc's own example after re-ask (${exampleDefect})` }
      }
      failed('reformats a doc example', attempt + 1, true)
      ctx = {
        ...base,
        issues: { uncoveredMilestones: [], unknownMilestones: [], exampleFidelity: exampleDefect },
      }
      continue
    }
    // A `matches` the schema accepts but `new RegExp` rejects would throw (log
    // matcher) or never match (stream/body/json) at birth, after a sandbox run has
    // already been paid for. Correct it here, on the same one re-ask.
    const badRe = firstInvalidMatchPattern(scenario.steps)
    if (badRe) {
      if (attempt > 0) {
        failed('invalid `matches` regex twice', attempt + 1, false)
        return {
          error: `scenario keeps an invalid \`matches\` regex after re-ask (step ${badRe.step} ${badRe.where}: /${badRe.pattern}/ — ${badRe.error})`,
        }
      }
      failed('invalid `matches` regex', attempt + 1, true)
      ctx = {
        ...base,
        issues: { uncoveredMilestones: [], unknownMilestones: [], invalidPattern: badRe },
      }
      continue
    }
    await setCacheEntry(repoRoot, GENERATE_CACHE_NAME, cacheKey, { scenario, blockedOn: [] })
    return { scenario, blockedOn: [] }
  }
  failed('authoring exhausted its attempts', 2, false)
  return { error: 'authoring exhausted its attempts' }
}

/**
 * A clean one-line reason for a thrown authoring call — a timeout collapses to
 * `timed out after Nm`, anything else to its trimmed message.
 */
function authorFailureReason(raw: string): string {
  const m = /timed out(?: after (\d+)\s*ms)?/i.exec(raw)
  if (m) {
    const mins = m[1] ? Math.round(parseInt(m[1], 10) / 60000) : 0
    return mins > 0 ? `timed out after ${mins}m` : 'timed out'
  }
  return oneLine(raw)
}

/**
 * One authored scenario's composition defect against THIS recipe, or null. The
 * cli rule needs the entrypoint (a step's `run` is argv appended to it); the api
 * rules are self-contained (a journey has to chain with itself).
 */
function compositionDefectOf(scenario: RawGeneratedScenario, recipe: Recipe): string | null {
  return scenarioCompositionDefect(
    scenario.driver === 'api'
      ? { driver: 'api', steps: scenario.steps, ...(scenario.setup ? { setup: scenario.setup } : {}) }
      : { driver: 'cli', steps: scenario.steps, ...(scenario.setup ? { setup: scenario.setup } : {}) },
    recipe.entry,
  )
}

/** The flow milestones no step of the scenario realizes. */
function uncoveredMilestones(flow: GuardFlow, scenario: RawGeneratedScenario): number[] {
  const covered = new Set(scenario.steps.map((s) => s.milestone).filter((m): m is number => typeof m === 'number'))
  return flow.milestones.map((m) => m.order).filter((order) => !covered.has(order))
}

/** `milestone` values on the scenario's steps that match no milestone of the flow. */
function unknownMilestones(flow: GuardFlow, scenario: RawGeneratedScenario): number[] {
  const known = new Set(flow.milestones.map((m) => m.order))
  const out: number[] = []
  for (const step of scenario.steps) {
    if (typeof step.milestone === 'number' && !known.has(step.milestone) && !out.includes(step.milestone)) {
      out.push(step.milestone)
    }
  }
  return out
}

/** Lowercase, trim, and dedupe (first-seen order) the capability nouns a blocked flow named. */
function normalizeBlockedOn(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const t = n.trim().toLowerCase()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out.length > 0 ? out : ['world-state the sandbox cannot provide']
}

/** The authoring context for one (flow, surface): the claims + section texts
 *  (WHAT to assert) and the realization plan translated to driver verbs (HOW). */
function buildAuthorCtx(
  work: FlowWork,
  surface: GuardDriverId,
  plan: RealizationPlan,
  recipe: Recipe,
  probes: ProbeTranscript[],
  opIndex: OperationEntry[],
  docText: ReadonlyMap<string, string>,
  externalServices: ExternalServiceHint[],
  serverIndex: ServerRouteIndex,
  grounding: {
    journeyContracts: JourneyContractHint[]
    otherOperations: JourneyContractHint[]
    otherOperationsOverflow: number
    outboundRequests: OutboundRequestHint[]
    outboundRequestsOverflow: number
  },
  retry?: BirthRetryContext,
): AuthorUserContext {
  const sections = [...new Set([...work.sections.values()])]
  // Item 76: the server this flow's scenario runs against. The prompt describes THAT
  // service — its serve argv, its health path, and only the credentials that
  // authenticate against it — so the model is never shown a surface the scenario
  // cannot reach. Absent binding ⇒ the recipe's default server, which is exactly
  // what every single-server repo's prompt has always described.
  const serverName = work.serverBySurface.get(surface)
  const bound = serverName ? resolveApiServers(recipe).servers.get(serverName) : undefined
  return {
    flow: { id: work.flow.id, title: work.flow.title, goal: work.flow.goal },
    milestones: authorMilestones(work, plan, surface),
    journeyPath: plan.journeys.map((j) => j.id),
    areaTags: [...new Set(sections.flatMap((s) => s.areaTags))],
    driver: surface === 'api' ? 'api' : 'cli',
    ...(surface === 'api'
      ? {
          recipeServe: bound ? [...bound.serve] : defaultServerServe(recipe),
          recipeHealthPath: bound ? declaredHealthPath(recipe, bound.name) : defaultServerHealthPath(recipe),
          ...(serverName
            ? {
                server: {
                  name: serverName,
                  ...(appDirOfServer(serverIndex, serverName) ? { app: appDirOfServer(serverIndex, serverName)! } : {}),
                  ...(bound?.description ? { description: bound.description } : {}),
                },
              }
            : {}),
          credentials: recipeCredentialCapabilities(recipe, serverName),
          fixtures: recipeFixtureCatalog(recipe),
          endpointSchemas: flowEndpointSchemas(sections, opIndex),
          bindsOpenApiOperation: sections.some((s) => parseOperationSection(s) !== null),
          operationAuth: flowOperationAuth(sections, recipe, docText),
          ...(externalServices.length > 0 ? { externalServices } : {}),
          // Item 69 — each gated on non-empty, so a repo the extractors read nothing
          // out of renders exactly the prompt it did before.
          ...(grounding.journeyContracts.length > 0 ? { journeyContracts: grounding.journeyContracts } : {}),
          ...(grounding.otherOperations.length > 0
            ? {
                otherOperations: grounding.otherOperations,
                ...(grounding.otherOperationsOverflow > 0
                  ? { otherOperationsOverflow: grounding.otherOperationsOverflow }
                  : {}),
              }
            : {}),
          ...(grounding.outboundRequests.length > 0
            ? {
                outboundRequests: grounding.outboundRequests,
                ...(grounding.outboundRequestsOverflow > 0
                  ? { outboundRequestsOverflow: grounding.outboundRequestsOverflow }
                  : {}),
              }
            : {}),
        }
      : { recipeEntry: recipe.entry }),
    recipeBuild: recipe.build,
    probes,
    ...(retry ? { retry } : {}),
  }
}

/** The flow's milestones as authoring sees them, in path order. */
function authorMilestones(work: FlowWork, plan: RealizationPlan, surface: GuardDriverId): AuthorMilestone[] {
  return [...work.flow.milestones]
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const section = work.sections.get(m.order)
      const realization = plan.steps
        .filter((s) => s.milestone === m.order)
        .flatMap((s) => realizationLines(s.journey, surface))
      // D3 — the section's fenced example blocks, mined deterministically from
      // the same text embedded above so the prompt's DOC EXAMPLE bytes can never
      // drift from the section they came from.
      const examples = section ? mineExampleBlocks(section.fullText || section.ownText) : []
      return {
        order: m.order,
        claim: m.claimTitle,
        doc: m.doc,
        sectionHeading: section?.headingText ?? m.anchor,
        sectionText: section?.fullText || section?.ownText || '',
        ...(m.note ? { note: m.note } : {}),
        realization: [...new Set(realization)],
        ...(examples.length > 0 ? { examples } : {}),
      }
    })
}

/**
 * The OpenAPI write-op request schemas the flow's sections reference (item 42 /
 * B4), deduped by `method path` and sorted stably. Empty when no section matches a
 * write op.
 */
function flowEndpointSchemas(
  sections: readonly SectionInput[],
  opIndex: OperationEntry[],
): { method: string; path: string; requestSchema: string }[] {
  const byKey = new Map<string, { method: string; path: string; requestSchema: string }>()
  for (const s of sections) {
    for (const e of matchedRequestSchemas(s, opIndex)) byKey.set(`${e.method} ${e.path}`, e)
  }
  return [...byKey.values()].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`))
}

/**
 * The DEFAULT api server's serve argv, whichever shape the recipe uses (item 75).
 * A single-server recipe returns its `api.serve` verbatim, so nothing an existing
 * repo sees changes; a `servers` recipe returns the argv of the server a scenario
 * means when it names none.
 */
function defaultServerServe(recipe: Recipe): string[] | undefined {
  const resolved = resolveApiServers(recipe)
  const serve = resolved.servers.get(resolved.defaultServer)?.serve
  return serve ? [...serve] : undefined
}

/**
 * The default server's DECLARED health path, or undefined when it declares none.
 * Deliberately the raw value rather than the resolved one: this feeds the authoring
 * prompt, and materializing the runner's `/` default would change the prompt of
 * every repo that never declared a health path.
 */
function defaultServerHealthPath(recipe: Recipe): string | undefined {
  const api = recipe.api
  if (!api) return undefined
  if (api.serve) return api.healthPath
  const name = api.defaultServer ?? Object.keys(api.servers ?? {})[0]
  return name ? api.servers?.[name]?.healthPath : undefined
}

/**
 * The recipe's credentials as authoring capabilities — name + header + optional role
 * description (never the secret value), sorted for a stable prompt. Both the directly
 * `api.credentials` and the seed-provided `api.seed.provides.credentials` are advertised
 * together: to the author they are the same `{{cred:<name>}}` handle, differing only in
 * how the runner mints the value.
 */
function recipeCredentialCapabilities(
  recipe: Recipe,
  /**
   * The server the scenario is bound to (item 75 / R8). A credential's `servers`
   * allowlist says which services it authenticates against, so a web session cookie
   * is never advertised to an api-v2 scenario — the runner would refuse the
   * `{{cred:…}}` reference anyway, and a prompt that offers it invites a scenario
   * that can only error. Absent (no binding, or a credential with no allowlist) ⇒
   * advertised, which is what every single-server recipe means.
   */
  server?: string,
): { name: string; header: string; description?: string }[] {
  const resolved = resolveApiServers(recipe)
  const usable = (cred: { servers?: readonly string[] }): boolean =>
    server === undefined || credentialServers(cred, resolved).includes(server)
  const out: { name: string; header: string; description?: string }[] = []
  for (const [name, cred] of Object.entries(recipe.api?.credentials ?? {})) {
    if (!usable(cred)) continue
    out.push({ name, header: cred.header, ...(cred.description ? { description: cred.description } : {}) })
  }
  for (const [name, cred] of Object.entries(recipe.api?.seed?.provides.credentials ?? {})) {
    if (!usable(cred)) continue
    out.push({ name, header: cred.header, ...(cred.description ? { description: cred.description } : {}) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** One journey's entry path (`''` when it has none) — the route-manifest lookup key. */
function journeyEntryPath(journey: Journey): string {
  const entry = journey.entry as { path?: string }
  return typeof entry?.path === 'string' ? entry.path : ''
}

/**
 * ONE server's DECLARED health path, or undefined when it declares none — the same
 * "raw, never materialized" rule {@link defaultServerHealthPath} follows, so a repo
 * that declared no health path keeps the prompt it always had.
 */
function declaredHealthPath(recipe: Recipe, server: string): string | undefined {
  const api = recipe.api
  if (!api) return undefined
  if (api.serve) return api.healthPath
  return api.servers?.[server]?.healthPath
}

/**
 * How the flow's bound OpenAPI operations map onto the declared credentials (item
 * 45 / B7), aggregated across its operation sections: the credentials that satisfy
 * each required scheme, and the schemes NO credential satisfies. `undefined` when
 * nothing is security-relevant (public operations, markdown sections, or no bound
 * operation), keeping the prompt byte-identical to before B7.
 */
function flowOperationAuth(
  sections: readonly SectionInput[],
  recipe: Recipe,
  docText: ReadonlyMap<string, string>,
): { satisfiedBy: SatisfiedScheme[]; unsatisfied: string[] } | undefined {
  const credentials = recipeAuthCredentials(recipe)
  const satisfiedByKey = new Map<string, SatisfiedScheme>()
  const unsatisfied = new Set<string>()
  const docCache = new Map<string, ReturnType<typeof parseOpenApiSpec>>()
  for (const s of sections) {
    // The WHOLE document, never the section slice: `resolveSectionAuth` resolves
    // `components.securitySchemes` and the doc-level `security` fallback, neither of
    // which lives inside an operation's own canonical text.
    if (!docCache.has(s.doc)) docCache.set(s.doc, parseOpenApiSpec(docText.get(s.doc) ?? ''))
    const doc = docCache.get(s.doc)
    if (!doc) continue
    const auth = resolveSectionAuth(s, doc, credentials)
    if (!auth) continue
    for (const scheme of auth.satisfiedBy) satisfiedByKey.set(`${scheme.scheme}\0${scheme.credential}`, scheme)
    for (const scheme of auth.unsatisfied) unsatisfied.add(scheme)
  }
  if (satisfiedByKey.size === 0 && unsatisfied.size === 0) return undefined
  return {
    satisfiedBy: [...satisfiedByKey.values()].sort(
      (a, b) => a.scheme.localeCompare(b.scheme) || a.credential.localeCompare(b.credential),
    ),
    unsatisfied: [...unsatisfied].sort(),
  }
}

/** The seed stage's fixture catalog as an authoring capability — name + field names
 *  only (never runtime values), sorted for a stable prompt. */
function recipeFixtureCatalog(recipe: Recipe): { name: string; fields: string[] }[] {
  const declared = recipe.api?.seed?.provides.fixtures
  if (!declared) return []
  return Object.entries(declared)
    .map(([name, fields]) => ({ name, fields }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Build a scenario, recording a validation failure as an error rather than throwing. */
function safeBuild(
  task: AuthorTask,
  raw: RawGeneratedScenario,
  usedIds: Set<string>,
  errors: GuardGenerateError[],
  /** The recipe's default server — the scenario's `server` is stamped only when the
   *  flow bound a DIFFERENT one, so a single-server repo's YAML is unchanged. */
  defaultServer: string,
): BirthCandidate | null {
  const id = assignScenarioId(task.work.flow.id, task.surface, usedIds)
  try {
    const scenario = buildFlowScenario({
      flow: task.work.flow,
      journeys: task.plan.journeys,
      raw,
      id,
      ...(task.server ? { server: task.server } : {}),
      defaultServer,
    })
    return { flow: task.work.flow, surface: task.surface, section: task.work.primary, scenario, ref: taskKey(task) }
  } catch (e) {
    usedIds.delete(id)
    task.errored = true
    errors.push({
      doc: task.work.primary.doc,
      anchor: task.work.primary.anchor,
      message: `invalid generated scenario: ${(e as Error).message}`,
    })
    return null
  }
}

// --- Findings + errors -------------------------------------------------------

/** The DEFINED excerpt fields of a failure/finding, for spreading — an absent
 *  stream stays absent (never an explicit `undefined` key in the JSON). */
function excerptsOf(src: OutputExcerpts | undefined): OutputExcerpts {
  return {
    ...(src?.stdout !== undefined ? { stdout: src.stdout } : {}),
    ...(src?.stderr !== undefined ? { stderr: src.stderr } : {}),
  }
}

/**
 * A birth finding, attributed to the FAILING MILESTONE: its section is where the
 * finding pivots and its claim is the dismissal identity, so "the doc says X, the
 * code does Y" points at the sentence that disagrees rather than the flow's head.
 * `failedMilestone` + `priorMilestonesPassed` are the composition-triage pair —
 * a mid-chain break is the "milestones don't chain" category (`isCompositionFinding`).
 */
function toFinding(o: {
  candidate: BirthCandidate
  result: { failure?: { step: number; expected: string; actual: string } & OutputExcerpts; evidencePath?: string }
}): GuardBirthFinding {
  const f = o.result.failure
  const scenario = o.candidate.scenario
  const step = f?.step ?? 1
  const failedMilestone = scenario.steps[step - 1]?.milestone
  const milestone = failedMilestone
    ? o.candidate.flow.milestones.find((m) => m.order === failedMilestone)
    : undefined
  return {
    doc: milestone?.doc ?? o.candidate.section.doc,
    anchor: milestone?.anchor ?? o.candidate.section.anchor,
    scenarioId: scenario.id,
    title: scenario.title,
    step,
    expected: f?.expected ?? '',
    actual: f?.actual ?? '',
    ...(o.result.evidencePath ? { evidencePath: o.result.evidencePath } : {}),
    // Fix 1: the failing run's RAW program output rides on the finding so the retry
    // prompt (and the dashboards) see the usage error the program printed.
    ...excerptsOf(f),
    // Judge-on-one-screen (item 19): the failed candidate's exact YAML rides inline
    // so the finding detail shows the commands it ran; `claim` is the dismissal
    // identity (item 20) so the detail's Dismiss action can key on it.
    yaml: serializeScenarioYaml(scenario),
    ...(milestone ? { claim: milestone.claimTitle } : {}),
    flowId: o.candidate.flow.id,
    surface: o.candidate.surface,
    ...(failedMilestone ? { failedMilestone } : {}),
    ...(failedMilestone ? { priorMilestonesPassed: priorMilestonesPassed(scenario, step, failedMilestone) } : {}),
  }
}

/**
 * Whether every milestone BEFORE the failing one was realized by steps that already
 * RAN (the runner stops at the first failure, so a step before it passed). A true
 * here with a mid-path milestone is the "milestones don't chain" signal: the flow's
 * head worked and the composition broke, which is a synthesis defect far more often
 * than doc-vs-code drift.
 */
function priorMilestonesPassed(scenario: GuardScenario, failingStep: number, failedMilestone: number): boolean {
  const passed = new Set<number>()
  for (let i = 0; i < failingStep - 1 && i < scenario.steps.length; i++) {
    const m = scenario.steps[i].milestone
    if (typeof m === 'number') passed.add(m)
  }
  for (let order = 1; order < failedMilestone; order++) {
    if (!passed.has(order)) return false
  }
  return failedMilestone > 1
}

/**
 * The diagnosis a committed failing test carries on its manifest entry (item 80)
 * — the finding's durable fields plus the committed file, minus the inline YAML
 * (the committed `.yaml` sits beside the manifest in the same commit).
 */
function diagnosisOf(finding: GuardBirthFinding, file: string): GuardScenarioDiagnosis {
  return {
    doc: finding.doc,
    anchor: finding.anchor,
    title: finding.title,
    ...(finding.claim !== undefined ? { claim: finding.claim } : {}),
    step: finding.step,
    expected: finding.expected,
    actual: finding.actual,
    ...excerptsOf(finding),
    ...(finding.evidencePath !== undefined ? { evidencePath: finding.evidencePath } : {}),
    file,
    ...(finding.failedMilestone !== undefined ? { failedMilestone: finding.failedMilestone } : {}),
    ...(finding.priorMilestonesPassed !== undefined
      ? { priorMilestonesPassed: finding.priorMilestonesPassed }
      : {}),
    ...(finding.triage !== undefined ? { triage: finding.triage } : {}),
  }
}

/** A zeroed finding — the retry cache key only reads the evidence fields. */
function emptyFinding(): GuardBirthFinding {
  return { doc: '', anchor: '', title: '', step: 1, expected: '', actual: '' }
}

/** The retry prompt's evidence block, from the finding being re-authored. */
function retryContext(evidence: GuardBirthFinding): BirthRetryContext {
  return {
    scenarioTitle: evidence.title,
    step: evidence.step,
    expected: evidence.expected,
    actual: evidence.actual,
    ...(evidence.failedMilestone ? { milestone: evidence.failedMilestone } : {}),
    ...excerptsOf(evidence),
  }
}

/**
 * A SCENARIO's birth execution errored — it was authored, it ran, and the run could
 * not produce a verdict. `kind: 'birth'` plus the flow id keep it that: a run the
 * runner refused never reaches here (it has no scenario to name), so nothing
 * scenario-shaped is ever manufactured out of a run-level fact.
 */
function errorFrom(o: {
  candidate: BirthCandidate
  result: { failure?: { actual: string } & OutputExcerpts }
}): GuardGenerateError {
  const f = o.result.failure
  return {
    doc: o.candidate.section.doc,
    anchor: o.candidate.section.anchor,
    kind: 'birth',
    flowId: o.candidate.flow.id,
    message: `birth validation error for "${o.candidate.scenario.title}": ${f?.actual ?? 'unknown'}`,
    // The error's own output excerpts (redacted + tail-bounded by the runner) ride the
    // error: a boot failure's server stdout/stderr — so `result.json` shows WHY the
    // server never became healthy — or a step-level infra error's excerpts.
    ...excerptsOf(f),
  }
}

/** A fidelity rejection: a green scenario the reviewer judged unfaithful to its
 *  flow. Same shape as a birth failure (yaml + claim inline) with `kind: 'fidelity'`;
 *  the reviewer's mismatch is the evidence (`actual`), and there is no birth step.
 *  It is the one verdict that still refuses the commit — the test is wrong. */
function fidelityFinding(candidate: BirthCandidate, mismatch: string): GuardBirthFinding {
  return {
    doc: candidate.section.doc,
    anchor: candidate.section.anchor,
    kind: 'fidelity',
    scenarioId: candidate.scenario.id,
    title: candidate.scenario.title,
    step: 1,
    expected: "a scenario that verifies the flow's milestones",
    actual: mismatch,
    yaml: serializeScenarioYaml(candidate.scenario),
    claim: candidate.flow.milestones[0].claimTitle,
    flowId: candidate.flow.id,
    surface: candidate.surface,
  }
}

// --- Fidelity review (item 33) -----------------------------------------------

/** The reviewer's decision on one green candidate: persist, flag as a finding, or
 *  (a review that couldn't complete) surface as an error that unsettles the flow. */
type FidelityResult =
  | { verdict: 'faithful' }
  | { verdict: 'flagged'; mismatch: string; confidence?: 'high' | 'medium' | 'low' }
  | { error: string }

/**
 * Review ONE green candidate against its FLOW's milestones, cached per
 * scenario-content + flow + section content (+ the fidelity prompt) so a re-run is
 * a hit and no second call fires for an unchanged scenario+flow.
 */
async function reviewFidelity(
  repoRoot: string,
  task: AuthorTask,
  candidate: BirthCandidate,
  runner: FidelityRunner,
): Promise<FidelityResult> {
  const work = task.work
  const cacheKey = fidelityCacheKey(scenarioBehavior(candidate.scenario), work)

  const cached = await getCacheEntry(repoRoot, FIDELITY_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = FidelityReviewSchema.safeParse(cached)
    if (parsed.success) return normalizeFidelity(parsed.data)
  }

  const ctx: FidelityUserContext = {
    flow: { id: work.flow.id, title: work.flow.title, goal: work.flow.goal },
    milestones: [...work.flow.milestones]
      .sort((a, b) => a.order - b.order)
      .map((m) => {
        const section = work.sections.get(m.order)
        return {
          order: m.order,
          claim: m.claimTitle,
          doc: m.doc,
          sectionHeading: section?.headingText ?? m.anchor,
          sectionText: section?.fullText || section?.ownText || '',
        }
      }),
    scenarioYaml: serializeScenarioYaml(candidate.scenario),
  }
  const attempt = await callFidelityWithReask(ctx, runner)
  if ('error' in attempt) return { error: attempt.error }
  await setCacheEntry(repoRoot, FIDELITY_CACHE_NAME, cacheKey, attempt.review)
  return normalizeFidelity(attempt.review)
}

/** A flagged verdict always yields a non-empty mismatch (the finding's evidence);
 *  the stated confidence rides along (HIGH drives the self-heal, item 83). */
function normalizeFidelity(r: {
  verdict: 'faithful' | 'flagged'
  mismatch?: string
  confidence?: 'high' | 'medium' | 'low'
}): FidelityResult {
  if (r.verdict === 'flagged') {
    return {
      verdict: 'flagged',
      mismatch: r.mismatch?.trim() || "the scenario does not verify what the flow's milestones assert",
      ...(r.confidence ? { confidence: r.confidence } : {}),
    }
  }
  return { verdict: 'faithful' }
}

/** A scenario's BEHAVIORAL identity — the fields the reviewer judges, excluding the
 *  engine-assigned `id`/`binds`/`flow`/`journey`/`guard` bookkeeping (which churns on
 *  re-allocation without changing what the scenario verifies). */
function scenarioBehavior(scenario: GuardScenario): string {
  return JSON.stringify({
    title: scenario.title,
    driver: scenario.driver,
    setup: scenario.setup ?? null,
    steps: scenario.steps,
    normalize: scenario.normalize ?? [],
  })
}

/** Per-scenario fidelity cache key: it moves with the scenario BEHAVIOR, the flow's
 *  milestone composition, its sections' content, the format, or the fidelity prompt. */
function fidelityCacheKey(scenarioBehaviorKey: string, work: FlowWork): string {
  return createHash('sha256')
    .update(
      [
        FIDELITY_PROMPT_FINGERPRINT,
        String(GUARD_FORMAT_VERSION),
        work.flow.fingerprint,
        [...work.sectionKeys].sort().join('~'),
        scenarioBehaviorKey,
      ].join('::'),
    )
    .digest('hex')
}

type FidelityAttempt = { review: { verdict: 'faithful' | 'flagged'; mismatch?: string } } | { error: string }

/**
 * Call the fidelity runner and validate its verdict; on a schema failure re-ask
 * ONCE with the invalid output quoted back, then validate again. A thrown call is
 * not re-asked. Returns `{ error }` on a still-invalid or thrown call.
 */
async function callFidelityWithReask(ctx: FidelityUserContext, runner: FidelityRunner): Promise<FidelityAttempt> {
  let raw: unknown
  try {
    raw = await runner(ctx)
  } catch (e) {
    return { error: `call failed: ${(e as Error).message}` }
  }
  const parsed = FidelityReviewSchema.safeParse(raw)
  if (parsed.success) return { review: parsed.data }

  let reRaw: unknown
  try {
    reRaw = await runner({ ...ctx, correction: { invalidOutput: quoteInvalidOutput(raw) } })
  } catch (e) {
    return { error: `re-ask failed: ${(e as Error).message}` }
  }
  const reParsed = FidelityReviewSchema.safeParse(reRaw)
  if (reParsed.success) return { review: reParsed.data }
  return { error: `output invalid after re-ask: ${flattenZodError(reParsed.error)}` }
}
