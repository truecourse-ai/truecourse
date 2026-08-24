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
 *   7. author   one WORKER SESSION per (flow, surface with a plan) — an
 *               agentic loop that drafts, executes in the sandbox, revises, and
 *               settles a structured outcome (the scenario, a blocked verdict, a
 *               journey defect, or an honest exhaustion the ledger escalates);
 *               a settled-failing scenario carries the worker's own diagnosis.
 *               The fidelity review runs IN-LOOP: a high-confidence flag resumes
 *               the still-open session once. Epic flows (non-empty `composedOf`)
 *               schedule as a second wave, their prompts carrying the settled
 *               members' scenarios read-only.
 *   8. confirm  the gate of record: every worker-settled candidate executes once
 *               in a sandbox the session never touched; a flip re-opens the
 *               session once with the evidence. cli candidates batch into one
 *               run (each already gets its own fresh sandbox); api candidates
 *               confirm ALONE in a fresh runner invocation each (they would
 *               share datastore state in a batch), bounded by the isolation cap.
 *   9. persist  INDEPENDENTLY: every scenario is written the moment its
 *               confirmation settles — passing or failing. Only a "test is wrong"
 *               verdict (a fidelity rejection, a twice-unconfirmed green settle)
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

import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import pLimit from 'p-limit'
import os from 'node:os'
import { z } from 'zod'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import {
  auditTransport,
  cliTransport,
  formatStageFailure,
  turnFnOf,
  type LlmTransport,
  type LlmTurnFn,
  type StageTransportTally,
  type TransportAudit,
} from '@truecourse/shared/llm'
import {
  writeManifest,
  readManifest,
  appendAuthoringEvent,
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
  retiredGapReason,
  runRefusalError,
  GuardTriageSchema,
  type GuardAutoResolutionEntry,
  type GuardAutoResolutionSource,
  type GuardAutoResolved,
  type GuardAutoResolvedAttempt,
  type GuardFlowRetirement,
  type GuardBirthFinding,
  type GuardBlockedMilestone,
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
  type GuardJourneyDefect,
  type GuardJourneysReport,
  type GuardManifestFlow,
  type GuardManifestGap,
  type GuardManifestScenario,
  type GuardOrphanedDismissal,
  type GuardOrphanedFlowDismissal,
  type GuardRunRefusal,
  type GuardScenario,
  type GuardScenarioDiagnosis,
  type GuardScenarioResult,
  type GuardTestStatus,
  type GuardTriage,
  type GuardUnadjudicatedStage,
  type Journey,
  type JourneyDiagnostic,
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
  WORKER_CLI_PROMPT_FINGERPRINT,
  WORKER_API_PROMPT_FINGERPRINT,
  FIDELITY_PROMPT_FINGERPRINT,
  buildAuthorUserPrompt,
  type AuthorMilestone,
  type AuthorUserContext,
  type CommandGrammarEntry,
  type JourneyContractHint,
  type OutboundRequestHint,
  type ExternalServiceHint,
  type FidelityUserContext,
} from './prompts.js'
import {
  RawGeneratedScenarioSchema,
  FidelityReviewSchema,
  type RawGeneratedScenario,
} from './schemas.js'
import {
  spawnExtractRunner,
  spawnRecipeRunner,
  spawnFidelityRunner,
  spawnFlowsRunner,
  spawnFlowsEpicRunner,
  spawnMatchRunner,
  type ExtractRunner,
  type RecipeRunner,
  type FidelityRunner,
  type FlowsRunner,
  type FlowsEpicRunner,
  type MatchRunner,
} from './runners.js'
import {
  runFlowWorker,
  type WorkerBlockedMilestone,
  type WorkerFlowResult,
  type WorkerSessionState,
} from './worker.js'
import { extractDocClaims, countExtractViews, type DocClaims } from './extract.js'
import {
  synthesizeFlows,
  isFlowSynthesisWipeout,
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
import type { ProbeTranscript } from './ground.js'
import {
  callWithRetry,
  flattenZodError,
  quoteInvalidOutput,
  scenarioCompositionDefect,
  uncoveredMilestones,
  unknownMilestones,
} from './validate.js'
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
import { birthValidate, birthRunTimeoutMs, type BirthCandidate, type BirthOutcome, type BirthRound } from './birth.js'
import {
  apiJourneyHealProbe,
  cliJourneyHealProbe,
  type JourneyHealProbe,
  type JourneyHealVerdict,
} from './journey-heal.js'
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
import { flowHttpSignal, NO_HTTP_SIGNAL_REASON } from './http-signal.js'
import {
  assignScenarioId,
  buildFlowScenario,
  areaOrDocSlug,
  writeScenarioFile,
  serializeScenarioYaml,
  scenarioFileIndex,
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
  /** The flow milestone orders covered, present ONLY for a PARTIAL scenario (the
   *  flow's other milestones settled as a milestone-scoped blocked-on gap). */
  milestones?: number[]
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
  /**
   * `llm-failed` = a stage whose loss REWRITES what lands on disk lost EVERY LLM
   * call — the call threw, or it answered and its output failed validation even
   * after the corrective re-ask. Nothing was generated and nothing on disk was
   * rewritten (see {@link generateGuards}); never reported as `ok` with an empty
   * result, because a run that verified nothing must not read as a clean no-op.
   */
  status: 'no-docs' | 'recipe-failed' | 'llm-failed' | 'ok'
  /** For `no-docs` / `recipe-failed` / `llm-failed`: the user-facing reason. */
  reason?: string
  /** `entry` is the cli preparation (absent on an api-only recipe); `serve` the api one. */
  recipe?: {
    status: 'exists' | 'discovered'
    entry?: string[]
    serve?: string[]
    wrotePath?: string
    /** The datastore compose file discovery GENERATED beside the recipe,
     *  repo-root-relative. Both files are artifacts the user reviews and commits. */
    composePath?: string
    /** Which proposer produced a freshly discovered recipe (absent for `exists`). */
    source?: 'deterministic' | 'llm'
    /** Fill-ins the proposer could not decide — printed, never silently dropped. */
    todos?: string[]
    /**
     * Advisory recipe diagnostics that did NOT stop the run: a credential
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
  /** The confirmation-stage failure results: the committed failing tests (each
   *  carrying the worker's diagnosis, or none when it committed untriaged), plus
   *  the withheld classes — twice-unconfirmed green settles and fidelity
   *  rejections. For a fresh run, `written('failing').length === birthFindings
   *  committed rows` — the routing's arithmetic identity. */
  birthFindings: GuardBirthFinding[]
  /**
   * The journey defects authoring workers reported: the sandbox contradicted the
   * derived command grammar (a promised flag rejected, or a demanded flag the
   * grammar lacks). First-class run outputs — each is a journey-mapper bug with a
   * reproduction attached. A `healed` row was verified against the live program
   * in-run and its session resumed to completion; an unhealed row's flow stays
   * unsettled.
   */
  journeyDefects: GuardJourneyDefect[]
  /**
   * The authoring-transcript run id: worker sessions append their transcript
   * events under `guard/authoring/<id>/<flowId>.<surface>.jsonl`. Present only
   * when at least one worker session ran this generate.
   */
  authoringRunId?: string
  errors: GuardGenerateError[]
  extractionFailures: GuardExtractionFailure[]
  /**
   * Stages that lost LLM calls this run — attempts, failures, and the first error.
   * Every stage absorbs an isolated failure somewhere (a failed extraction view
   * lowers coverage, a failed fidelity review leaves its flow unsettled), so
   * without this a partially failed run reads as a clean one. Empty on a clean run.
   */
  llmFailures: StageTransportTally[]
  /**
   * The ADJUDICATION stage (`guard.fidelity`) when it lost EVERY call, so green
   * tests persisted unreviewed. Carved out of the `llm-failed` abort on purpose
   * (see the adjudication carve-out in {@link generateGuards}); this row is what
   * keeps that carve-out LOUD. Empty when every verdict landed.
   */
  unadjudicated: GuardUnadjudicatedStage[]
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
   * The auto-resolved rows this run — high-confidence machine judgments
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
   * The third parties this repo imports — the whole detected list, not
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
  /** Fidelity review (stage `guard.fidelity`) — a cheap-tier adversarial pass. */
  fidelity?: string
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
   * The repo's detected third-party dependencies. Derived from the SAME
   * analysis pass as the journeys — a pure read of the analyzer's import registry —
   * so it rides this seam rather than opening a second one that would re-analyze the
   * tree. Omitted (a provider that predates it, or the snapshot fallback) reads as
   * "not detected": every blocked-on reason keeps its generic noun.
   */
  externalServices?: DetectedExternalService[]
  /**
   * The repo's OWN product names, resolved by the same pass. Detection already
   * dropped them; they ride along so a blocked-on reason cannot canonicalize a
   * refusal onto the product itself. Omitted ⇒ no second lock, only the first.
   */
  ownProductNames?: string[]
  /**
   * The repo's datastore + its PARSED schema, off the same analysis pass
   * for the same reason. Omitted (an older provider, the snapshot fallback) reads as
   * "no database detected": the seed-drafting stage skips with exactly that reason.
   */
  database?: SeedDraftDatabase | null
  /**
   * The datastore connection URLs the tree declares, off the same pass again. They
   * are what the recipe proposer GENERATES a compose file from when the repo needs a
   * database and ships none. Omitted (an older provider, the snapshot fallback) ⇒
   * nothing is generated, and such a repo's boot failure instead names the database
   * it depends on plus the ways to supply one.
   */
  datastoreUrls?: DatastoreUrlRef[]
  /**
   * What each api operation's handler reads off the request, off the same pass
   * again — the exact paths + required body fields the authoring prompt shows
   * per journey. Omitted (an older provider, the snapshot fallback) ⇒ the prompt
   * renders no contract block, exactly as it did before this grounding existed.
   */
  requestContracts?: ApiRequestContract[]
  /**
   * How the app constructs its OUTBOUND requests and which response fields it reads
   * back. What a `setup.http` stub must satisfy to be accepted by the app
   * it fakes for. Omitted ⇒ no outbound block, as before this grounding existed.
   */
  outboundRequests?: OutboundRequest[]
  /**
   * The mapping's static-vs-runtime disagreements (the cli tree∪probe cross-
   * check). Pure provenance for the journeys report; omitted reads as none.
   */
  diagnostics?: JourneyDiagnostic[]
}>

/** The authoring lifecycle states {@link GenerateGuardsOptions.onFlowState}
 *  reports per (flow, surface) task. 'queued'/'active' are progress; the other
 *  four are terminals, exactly one of which ends every task. */
export type FlowAuthoringState = 'queued' | 'active' | 'settled' | 'blocked' | 'retired' | 'error'

export interface GenerateGuardsOptions {
  repoRoot: string
  transport?: LlmTransport
  /**
   * The turn seam WORKER SESSIONS run on. Defaults to the transport's own
   * `.turn` (the claude-code session backend, or the api transport's native
   * tool-calling turn). A transport without one cannot run workers: each
   * authoring task then records an authoring error instead of a session.
   * Injected directly by tests (a scripted turn function).
   */
  turnFn?: LlmTurnFn
  /** Per-session worker budget; defaults to the worker's own defaults. */
  workerBudget?: { maxTurns?: number; maxTotalTokens?: number }
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
   * Auto-resolve escalation threshold: how many times a flow's test may auto-resolve
   * (a fidelity self-heal, a generation-defect retirement) before it surfaces as
   * a human task instead. Defaults to {@link DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER};
   * tests lower it to observe escalation in fewer runs.
   */
  escalateAutoResolveAfter?: number
  /** Journey mapping seam — see {@link JourneyProvider}. */
  journeys?: JourneyProvider
  /**
   * INTERNAL test seam: the journey self-heal's live re-verification, replacing
   * BOTH per-surface adapters (`cliJourneyHealProbe` / `apiJourneyHealProbe`).
   * Production builds the real adapter per task from the recipe and the task's
   * bound journeys.
   */
  journeyHealProbe?: JourneyHealProbe
  /**
   * The hard gate: refuse to run without a committed `recipe.json` instead of
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
  recipeRunner?: RecipeRunner
  fidelityRunner?: FidelityRunner
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
  /** Birth build/run phase transitions (forwarded from the runner) — for a "building…"
   *  detail. `confirm` is the generator's own isolated re-confirmation phase (layer d),
   *  carrying the number of would-be findings being re-checked in clean rooms. */
  onBirthPhase?: (phase: 'build' | 'run' | 'confirm', total?: number) => void
  /** Birth progress, ticking per settled scenario across both rounds. */
  onBirthProgress?: (done: number, total: number) => void
  /** Worker session RESUMES (a confirmation flip re-opening its session, an
   *  in-loop fidelity heal): `total` grows as resumes are queued. */
  onRetryProgress?: (done: number, total: number) => void
  /** Fidelity-review progress: `reviewed` = green scenarios reviewed so far, `planned`
   *  = green scenarios queued for review. */
  onFidelityProgress?: (reviewed: number, planned: number) => void
  /** Per-FLOW settle progress: `total` = the flows this run had work for. */
  onFlowSettled?: (settled: number, total: number) => void
  /** Fired the moment an authoring attempt fails — a thrown call, invalid output, or
   *  a rejected scenario. One event per failed attempt; the CLI renders it live and
   *  counts the flows that gave up. Optional, so callers that surface nothing (the
   *  dashboard popup) pass nothing and behave exactly as before. */
  onAuthorFailure?: (failure: AuthorFailure) => void
  /**
   * Per-flow authoring state, for a live display. The unit is the (flow, surface)
   * authoring task: every task emits 'queued' up front (unchanged flows included,
   * their terminal following immediately), 'active' when its worker session starts
   * (or its cache adjudication begins), then EXACTLY ONE terminal —
   * 'settled' (scenario committed; detail 'passing' or 'failing: <verdict>'),
   * 'blocked' (gap recorded; detail names the capability nouns),
   * 'retired' (the ledger retired the flow this run), or
   * 'error' (authoring error, journey defect, or an exhaustion that did not
   * retire; detail states the reason). The states always sum: queued tasks all
   * reach a terminal, so a counter over the events never drifts.
   */
  onFlowState?: (flowId: string, surface: GuardDriverId, state: FlowAuthoringState, detail?: string) => void
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
 *  worker prompt, so a scenario's cache entry moves only when ITS prompt changes. */
function authorPromptFingerprint(surface: GuardDriverId): string {
  return surface === 'api' ? WORKER_API_PROMPT_FINGERPRINT : WORKER_CLI_PROMPT_FINGERPRINT
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

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function generateGuards(options: GenerateGuardsOptions): Promise<GuardGenerateResult> {
  const { repoRoot } = options
  // Birth validation runs through the injected execution seam (OSS in-process by
  // default); the recipe is the discovered/loaded one below, passed IN so the
  // executor never re-reads recipe.json.
  const executor = options.executor ?? defaultGuardExecutor
  // ONE counting seam for the whole run: every one-shot stage's runner is spawned
  // on the WRAPPED transport, so attempts and failures are accounted centrally
  // instead of at each fail-soft site. The default is materialized HERE (rather
  // than inside each runner) so no stage can bypass the accounting — it is the
  // same `cliTransport()` each spawn would otherwise have built. A test that
  // injects a runner bypasses the transport entirely: that stage records no
  // attempts, which is correct — the tally answers "did this stage reach the
  // model", nothing else. Worker TURNS run on the raw transport's turn seam
  // (`turnFnOf`) — session usage still accounts under `guard.generate` through
  // the turn requests' stage field.
  const rawTransport = options.transport ?? cliTransport()
  const audit = auditTransport(rawTransport)
  const transport = audit.transport
  const workerTurn = options.turnFn ?? turnFnOf(rawTransport)

  if (!hasGuardUniverse(repoRoot)) {
    return emptyResult('no-docs', {
      reason: 'No corpus found. Run `truecourse spec scan` to curate the spec docs first.',
    })
  }

  // 1. Recipe — the shared entrypoint every scenario runs against.
  //
  // On the WORKING-TREE path generate no longer DERIVES one. `truecourse
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
    spawnRecipeRunner({ transport, model: options.models?.recipe, fallbackModel: options.models?.fallback })
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
    // repo, the proposer derives one from them.
    datastores: async () => (await journeysOnce()).datastoreUrls,
  })
  if (recipeResult.status === 'verify-failed') {
    // A failed proposal call already aborts the run loudly through this channel, so
    // the recipe stage needs no systemic check of its own; the tally rides along.
    return emptyResult('recipe-failed', { reason: recipeResult.reason, llmFailures: audit.failures() })
  }
  const recipe: Recipe = recipeResult.recipe
  const recipeFingerprint = recipeResult.fingerprint
  const recipeMeta: NonNullable<GuardGenerateResult['recipe']> = {
    status: recipeResult.status,
    ...(recipe.entry ? { entry: recipe.entry } : {}),
    // Either recipe shape reports the DEFAULT server's argv — the report
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

  // Which workspace app serves which path, joined to the recipe's declared
  // servers. Derived from the working tree alone (no LLM, nothing persisted, nothing
  // fingerprinted), so it costs a directory walk and answers, per flow, "does this
  // path's app even have a server?". A repo with one package yields an empty join
  // and every gate below degrades to the behaviour guard had before it existed.
  const serverIndex = buildServerRouteIndex(buildRouteManifest(repoRoot), recipe)
  /** The server a scenario means when it stamps none — the stamping baseline. */
  const defaultApiServer = resolveApiServers(recipe).defaultServer

  // 2. Index — the deterministic section universe + spec-side change detection.
  const plan = planGuardWork(repoRoot, recipeFingerprint)
  // The cross-doc OpenAPI operation index, built once from the whole
  // section universe. api authoring matches its sections against it to inject the
  // authoritative request-body schemas.
  const opIndex = buildOperationIndex(plan.sections, plan.basePaths)
  options.onPlan?.(plan.sections.length, plan.work.length)
  const orphanedSections = plan.orphaned.map((e) => ({ doc: e.doc, anchor: e.anchor, scenarioIds: e.scenarioIds }))

  const limit = pLimit(Math.max(1, options.concurrency ?? defaultConcurrency()))
  const isolationCap = Math.max(0, options.isolationCap ?? ISOLATION_CAP)
  const extractRunner =
    options.extractRunner ??
    spawnExtractRunner({ transport, model: options.models?.extract, fallbackModel: options.models?.fallback })
  const flowsRunner =
    options.flowsRunner ??
    spawnFlowsRunner({ transport, model: options.models?.flows, fallbackModel: options.models?.fallback })
  const flowsEpicRunner =
    options.flowsEpicRunner ??
    spawnFlowsEpicRunner({ transport, model: options.models?.flows, fallbackModel: options.models?.fallback })
  const matchRunner =
    options.matchRunner ??
    spawnMatchRunner({ transport, model: options.models?.match, fallbackModel: options.models?.fallback })
  // The ADJUDICATION runner — the fidelity reviewer that audits each green
  // scenario before it persists — spawns exactly like the stages above:
  // unconditionally, on the SAME materialized transport. Its construction is
  // never conditional. An absent `options.transport` does NOT mean "this caller
  // has no model access": the orchestrator materializes the cli default for every
  // other stage a few lines up, and the OSS CLI installs no default transport, so
  // gating on it disables the stage in every OSS run — green scenarios would
  // persist unreviewed. A caller that genuinely cannot reach a model loses every
  // call and lands in the adjudication carve-out below. Tests inject stub
  // runners, never transports.
  const fidelityRunner: FidelityRunner =
    options.fidelityRunner ??
    spawnFidelityRunner({
      transport,
      model: options.models?.fidelity,
      fallbackModel: options.models?.fallback,
    })

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

  // The durable auto-resolve ledger — escalation counts + the flow-taint
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
  // This run's auto-resolution bumps, applied to the ledger at run end. Each bump
  // records its verdict too, so a later retirement can show WHAT was judged wrong.
  // `autoResolveCount` reads prior + bumps, so the escalation budget holds WITHIN
  // a run too (a fidelity discard and a triage retirement of the same flow count).
  const ledgerBumps = new Map<
    string,
    { times: number; source: GuardAutoResolutionSource; attempts: GuardAutoResolvedAttempt[] }
  >()
  const bumpLedger = (
    key: string,
    source: GuardAutoResolutionSource,
    attempt: { title: string; detail: string },
  ): void => {
    const record: GuardAutoResolvedAttempt = { source, title: attempt.title, detail: attempt.detail, at: nowIso }
    const bump = ledgerBumps.get(key)
    if (bump) {
      bump.times++
      bump.source = source
      bump.attempts.push(record)
    } else ledgerBumps.set(key, { times: 1, source, attempts: [record] })
  }
  const autoResolveCount = (key: string): number =>
    (priorLedger.entries[key]?.count ?? 0) + (ledgerBumps.get(key)?.times ?? 0)
  // The auto-resolved rows this run — the report's visible record of what the
  // ledger counted.
  const autoResolved: GuardAutoResolved[] = []

  // RETIREMENT — the flows authoring has given up on (the ledger budget
  // exhausted). An ACTIVE retirement settles its surface as a `retired` gap with
  // zero calls; exactly three resets clear it (and its ledger count): the flow's
  // bound spec content moved, the surface's authoring prompt moved (the engine
  // improved), or a newer `reenabledFlows` entry in `scenarios/decisions.json`.
  const sectionsContentKey = (keys: readonly string[]): string =>
    createHash('sha256').update([...keys].sort().join('~')).digest('hex')
  const reenabledAtMs = (flowId: string, surface: GuardDriverId): number => {
    let at = -Infinity
    for (const r of decisions.reenabledFlows) {
      if (r.flowId !== flowId || (r.surface !== undefined && r.surface !== surface)) continue
      const t = Date.parse(r.reenabledAt)
      if (Number.isFinite(t) && t > at) at = t
    }
    return at
  }
  const retirementResets = (r: GuardFlowRetirement, sectionsKey: string): boolean =>
    r.sectionsKey !== sectionsKey ||
    r.promptFingerprint !== authorPromptFingerprint(r.surface) ||
    reenabledAtMs(r.flowId, r.surface) >= Date.parse(r.retiredAt)
  /** Retirements a reset cleared this run — dropped from the ledger (with their
   *  counts) at run end; their flows are forced back into work. */
  const clearedRetirements = new Set<string>()
  /** Retirements recorded this run, written to the ledger at run end. */
  const newRetirements = new Map<string, GuardFlowRetirement>()

  // 3. Extract — one (cached) read per document VIEW, across the WHOLE universe: a
  // flow spans sections, and its area's synthesis needs the complete claim
  // inventory, not only the changed sections'. Extraction is content-cached, so an
  // unchanged document costs nothing.
  const docs = collectWorkDocs(repoRoot, { ...plan, work: plan.sections })
  // Doc path → its raw text: the OpenAPI security resolution the api authoring prompt
  // carries needs the WHOLE document (schemes + the doc-level `security` fallback).
  const docText = new Map(docs.map((d) => [d.doc, d.content]))
  const sectionByKey = new Map(plan.sections.map((s) => [flowSectionKey(s.doc, s.anchor), s]))

  // A credential's `satisfies` naming a scheme NO OpenAPI doc in
  // the corpus declares can never bind — the matcher would silently fall through to
  // the header heuristic (or block the operation) with no diagnostic anywhere. It is
  // a recipe defect, so it stops the run HERE: before the first (paid) extraction
  // call, and reported through the same `recipe-failed` channel a discovery failure
  // uses. A key present in SOME doc is fine (schemes resolve per doc).
  const satisfiesCheck = validateCredentialSatisfies(recipeAuthCredentials(recipe), docs)
  if (satisfiesCheck.errors.length > 0) {
    return emptyResult('recipe-failed', { reason: satisfiesCheck.errors.join(' '), llmFailures: audit.failures() })
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

  // Extraction is the stage everything downstream reads: when EVERY extract call
  // failed there are no claims, so synthesis, authoring, and the manifest would run
  // over nothing and the run would report `ok` with an empty result — a run that
  // verified nothing, indistinguishable from a clean no-op. Abort here instead,
  // before any scenario file or manifest write: the committed scenarios and
  // `manifest.json` stay exactly as they were, and the next run re-attempts the
  // failed views (a failed view is never cached). The per-doc reasons ride along so
  // the report names the affected documents.
  if (audit.isSystemicFailure('guard.extract')) {
    return llmFailedResult(audit, 'guard.extract', {
      recipe: recipeMeta,
      recipeFingerprint,
      sectionsTotal: plan.sections.length,
      sectionsChanged: plan.work.length,
      skippedUnchanged: plan.sections.length - plan.work.length,
      coverageGaps,
      errors,
      extractionFailures,
      orphaned: orphanedSections,
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
  // The repo's own third-party dependencies, from the same pass. They name
  // the third party in an api authoring prompt and in every blocked-on gap reason.
  const externalServices = mapped.externalServices
  // The repo's own product names, from the same pass — the identity a blocked-on
  // reason may never canonicalize onto (see `enrichBlockedOn`).
  const ownProductNames = mapped.ownProductNames
  // The AUTHORING hint per service: its canonical name plus, when one was detected, the
  // env var that overrides its base URL — the precondition for a `setup.http` stub.
  // The user-provided external accounts are joined onto the detected list. A
  // PROVIDED service flips from blocker to capability (the runner points the app at
  // it); a declared-but-unprovided one changes nothing. A declared external the
  // detector never saw is still advertised when PROVIDED — the user knows about an
  // integration import scanning cannot see, and an account they supplied is a real
  // capability regardless of how the dependency is reached.
  const providedExternals = resolveProvidedExternals(repoRoot, recipe)
  const externalServiceHints = buildExternalServiceHints(externalServices, providedExternals)
  // The code-truth grounding, off the SAME mapping pass. The inbound half is
  // joined per flow (the operations its plan walks); the outbound half is repo-level
  // and capped here, once.
  const requestContracts = mapped.requestContracts
  const outboundRequestHints = buildOutboundRequestHints(mapped.outboundRequests, externalServices)
  const outboundRequestsOverflow = outboundOverflow(mapped.outboundRequests)
  const catalogs = buildSurfaceCatalogs(catalog)
  // The WHOLE api surface, so a flow can reach for the operations it does
  // not itself walk when a SETUP step needs one (sign up, then sign in, then test
  // favorites). Empty for a repo with no api journeys — the block simply renders not.
  const apiJourneys = catalogs.get('api')?.journeys ?? []
  options.onJourneys?.(catalog.length, catalogs.size)
  const journeysReport: GuardJourneysReport = {
    total: catalog.length,
    bySurface: Object.fromEntries([...catalogs].map(([surface, c]) => [surface, c.journeys.length])),
    ...(mapped.diagnostics.length > 0 ? { diagnostics: mapped.diagnostics } : {}),
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

  // Flow synthesis is the flows line's generation unit: with no flows there is
  // nothing to match, nothing to author, and — worse — the manifest pass below reads
  // "synthesis no longer produces this flow" and marks EVERY committed flow orphaned
  // (or prunes the test-less ones). An outage must never rewrite the corpus that
  // way, so a stage that lost everything aborts before the first write. Two ways to
  // lose it all: the calls THREW (the tally), or they answered and every area's
  // reply failed validation twice (no tally records that — the result's own
  // `unsettled` areas with not one flow to show for the spend do).
  // `synthesizeFlows` already refused to rewrite `flows.json` on this same predicate.
  const flowsWipeout = isFlowSynthesisWipeout(synthesis)
  if (audit.isSystemicFailure('guard.flows') || flowsWipeout) {
    const known = {
      recipe: recipeMeta,
      recipeFingerprint,
      sectionsTotal: plan.sections.length,
      sectionsChanged: plan.work.length,
      skippedUnchanged: plan.sections.length - plan.work.length,
      coverageGaps,
      errors,
      extractionFailures,
      orphaned: orphanedSections,
      orphanedDismissals,
    }
    const head = audit.isSystemicFailure('guard.flows')
      ? undefined
      : unusableOutputReason('guard.flows', 'area synthesis', synthesis.calls, synthesis.unsettled[0]?.reason)
    return llmFailedResult(audit, 'guard.flows', known, head)
  }

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
      journeyDefects: [],
      errors,
      extractionFailures,
      llmFailures: audit.failures(),
      // The run stops before birth, so the adjudication stage never ran.
      unadjudicated: [],
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
  // THE HTTP TRANSPORT GATE: the api surface is a candidate only for the flows whose
  // own spec names an HTTP transport. A request/response contract over stdio (or any
  // other pipe) is a real, testable contract, but not one an `api` recipe block could
  // ever describe — pairing it with the api surface can only produce an unsatisfiable
  // ask, so it never becomes a candidate here and the surface simply does not appear
  // in the flow's accounting. See {@link flowHttpSignal}.
  const apiEligible = new Set(
    liveFlows
      .filter(
        (flow) =>
          flowHttpSignal({
            flow,
            sections: boundSections(flow, sectionByKey),
            basePaths: plan.basePaths,
            apiJourneys,
          }) !== null,
      )
      .map((f) => f.id),
  )
  const candidateSurfaces = (flow: GuardFlow): GuardDriverId[] =>
    surfaces.filter((s) => s !== 'api' || apiEligible.has(flow.id))
  const matchPairs = liveFlows.reduce(
    (total, flow) => total + candidateSurfaces(flow).filter((s) => matchable(s, recipe, catalogs)).length,
    0,
  )
  let matchDone = 0
  // Match outcomes, for the total-loss abort after the loop. A cache HIT makes no
  // call and is counted nowhere; an `unrealizable` verdict is an ANSWER, not a loss.
  let matchCalls = 0
  let matchCallErrors = 0
  let firstMatchError: string | undefined
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
    const candidates = candidateSurfaces(flow)
    for (const surface of candidates) {
      // A RETIRED surface settles as its gap with ZERO calls — no match, no
      // author — unless a reset fires, which clears the record (and its ledger
      // count) and forces the flow back into work below.
      const retirement = priorLedger.retired[autoResolutionKey(flow.id, surface)]
      if (retirement) {
        if (!retirementResets(retirement, sectionsContentKey(sectionKeys))) {
          gaps.push({ surface, kind: 'retired', reason: retiredGapReason(retirement.attempts) })
          continue
        }
        clearedRetirements.add(autoResolutionKey(flow.id, surface))
      }
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
      // GATE A (pre-match): the flow's own documented paths all belong to
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
      matchCalls++
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
        matchCallErrors++
        firstMatchError ??= outcome.reason
        errors.push({ doc: primary.doc, anchor: primary.anchor, message: `matching (${surface}) ${outcome.reason}` })
      }
    }

    // The gate may take away a flow's LAST candidate — a repo whose only surface is
    // the api one, over a spec that never names HTTP. Coverage honesty holds either
    // way: the flow settles with a stated `unrealizable` reason instead of silently
    // recording no test and no gap at all. A flow the gate merely re-routed (another
    // surface still accounts for it) records nothing here.
    if (candidates.length === 0 && surfaces.length > 0) {
      gaps.push({ surface: 'api', kind: 'unrealizable', reason: NO_HTTP_SIGNAL_REASON })
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
    // So is the hash of a flow whose retirement RESET this run (the gap it settled
    // with no longer stands), and of one whose prior `retired` gap lost its ledger
    // record (the ledger is safe to delete — deleting it earns a fresh attempt).
    const retirementCleared = candidates.some((s) => clearedRetirements.has(autoResolutionKey(flow.id, s)))
    const staleRetiredGap = (prior?.gaps ?? []).some(
      (g) => g.kind === 'retired' && !priorLedger.retired[autoResolutionKey(flow.id, g.surface)],
    )
    const changed =
      !prior ||
      prior.generationInputsHash !== inputsHash ||
      violatesSettleInvariant(prior) ||
      retirementCleared ||
      staleRetiredGap
    if (!changed && prior) {
      // Unchanged ⇒ authoring does not run, so the gaps the AUTHOR stage settled last
      // time (a refusal: "blocked on world-state the sandbox cannot provide") cannot
      // be re-derived — only the MATCH-stage gaps above can. Carrying them forward is
      // what keeps the settle outcome and the settle hash together; without it the
      // first no-op re-run erases the reason while keeping the hash that skips it.
      // A `retired` gap is never carried: an active retirement re-derived it above
      // from the ledger, and anything else means the retirement ended.
      for (const gap of prior.gaps) {
        if (gap.kind === 'retired') continue
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

  // Matching decides which journeys each flow's scenario walks: with no plan the
  // flow authors nothing, and persist below DELETES its prior scenario files before
  // settling it as "nothing to test" — an outage silently erasing coverage and then
  // skipping the flow forever on its recorded hash. So a stage that lost every call
  // aborts here, before the first write. `unrealizable` is an ANSWER and never
  // counts as a loss; only a thrown call (the tally) or a reply that failed
  // validation twice (the error counters) does.
  const matchWipeout = matchCalls > 0 && matchCallErrors === matchCalls
  if (audit.isSystemicFailure('guard.match') || matchWipeout) {
    const known = {
      recipe: recipeMeta,
      recipeFingerprint,
      sectionsTotal: plan.sections.length,
      sectionsChanged: plan.work.length,
      skippedUnchanged: plan.sections.length - plan.work.length,
      coverageGaps,
      errors,
      extractionFailures,
      orphaned: orphanedSections,
      orphanedDismissals,
      orphanedFlowDismissals,
      flows: flowsReport,
      journeys: journeysReport,
      externalServices,
    }
    const head = audit.isSystemicFailure('guard.match')
      ? undefined
      : unusableOutputReason('guard.match', 'realization match', matchCalls, firstMatchError)
    return llmFailedResult(audit, 'guard.match', known, head)
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
        ...(gap.blockedMilestones ? { blockedMilestones: gap.blockedMilestones } : {}),
      })
    }
  }

  const changedWorks = works.filter((w) => w.changed)
  flowsReport.skipped = works.length - changedWorks.length
  // Announce the settle denominator before the first (slow) authoring/birth phase,
  // so the live counter is never a bare count without context.
  options.onFlowSettled?.(0, changedWorks.length)

  // 7. Author — every surface authors through per-flow WORKER SESSIONS (one
  // agentic session per task: draft → run in the sandbox → observe → revise →
  // settle a structured outcome). The build starts here, in parallel: every
  // sandbox run reuses it (skipBuild).
  const authorTasks: AuthorTask[] = changedWorks.flatMap((work) =>
    [...work.plans.entries()].map(([surface, plan]) => ({
      work,
      surface,
      plan,
      ...(work.serverBySurface.get(surface) ? { server: work.serverBySurface.get(surface)! } : {}),
    })),
  )
  const taskByKey = new Map(authorTasks.map((t) => [taskKey(t), t]))

  // The per-task authoring state feed (`onFlowState`) — the unit is the
  // (flow, surface with a plan) pair, changed AND unchanged alike, so a counter
  // over the events always sums. The map keeps the LAST state per task; a
  // terminal is emitted exactly once (later attempts are dropped), and the epic
  // wave below reads member states out of the same map.
  const flowStates = new Map<string, { state: FlowAuthoringState; detail?: string }>()
  const emitFlowState = (
    flowId: string,
    surface: GuardDriverId,
    state: FlowAuthoringState,
    detail?: string,
  ): void => {
    const key = `${flowId}\0${surface}`
    const prior = flowStates.get(key)
    // Last write wins — a settle is emitted the moment the SESSION settles
    // (flows settle continuously, not at persist), and a later resume (a
    // fidelity flag, a confirmation flip) re-activates the same task before
    // its final terminal. Only exact repeats and a late `queued` are dropped.
    if (prior && (prior.state === state && prior.detail === detail)) return
    if (prior && state === 'queued') return
    flowStates.set(key, { state, ...(detail !== undefined ? { detail } : {}) })
    options.onFlowState?.(flowId, surface, state, detail)
  }
  // Every task is queued first (deterministic order: flow corpus, then surface)…
  for (const work of works) {
    for (const [surface] of work.plans) emitFlowState(work.flow.id, surface, 'queued')
  }
  // …and an unchanged flow's tasks settle immediately: its committed scenarios
  // stand (or its carried gap does), so the terminal states are already known.
  for (const work of works) {
    if (work.changed) continue
    for (const [surface] of work.plans) {
      const scenario = work.prior?.scenarios.find((s) => s.surface === surface)
      if (scenario) {
        emitFlowState(work.flow.id, surface, 'settled', scenario.status)
      } else {
        const gap = work.gaps.find((g) => g.surface === surface)
        emitFlowState(work.flow.id, surface, 'blocked', gap?.reason ?? 'unchanged, no scenario recorded')
      }
    }
  }

  /**
   * The MILESTONE-SCOPED blocked-on gap a partially-blocked flow settles alongside
   * its partial scenario: the blocked milestones with their (per-service enriched)
   * nouns, and a reason that states the split — "K of N claims blocked, the rest
   * tested". Idempotent per gap identity, so a resume that re-settles the same
   * split never doubles the record.
   */
  const settlePartialGap = (task: AuthorTask, partial: TaskPartition): void => {
    const blockedMilestones: GuardBlockedMilestone[] = partial.blocked.map((b) => ({
      milestone: b.milestone,
      claim: oneLine(b.claim),
      blockedOn: enrichBlockedOn(b.blockedOn, externalServices, { ownProductNames }),
    }))
    const nouns: string[] = []
    for (const b of blockedMilestones) {
      for (const noun of b.blockedOn) if (!nouns.includes(noun)) nouns.push(noun)
    }
    const total = task.work.flow.milestones.length
    const reason = composeBlockedOnReason(
      nouns,
      `${blockedMilestones.length} of ${total} claims of ${oneLine(task.work.flow.title)} — the other ${partial.covered.length} are covered`,
    )
    const gap: GuardManifestGap = { surface: task.surface, kind: 'blocked-on', reason, blockedMilestones }
    if (task.work.gaps.some((g) => sameGap(g, gap))) return
    task.work.gaps.push(gap)
    coverageGaps.push({
      doc: task.work.primary.doc,
      anchor: task.work.primary.anchor,
      kind: 'blocked-on',
      flowId: task.work.flow.id,
      surface: task.surface,
      reason,
      blockedMilestones,
    })
  }

  /** The whole-flow blocked settle — the api refusal and the worker's `blocked`
   *  outcome both land here. Nouns are normalized (lowercased, trimmed, deduped)
   *  exactly as the one-shot path always did, then service-enriched. */
  const settleBlocked = (task: AuthorTask, nouns: readonly string[]): void => {
    const blockedOn = enrichBlockedOn(normalizeBlockedOn([...nouns]), externalServices, { ownProductNames })
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
    emitFlowState(task.work.flow.id, task.surface, 'blocked', blockedOn.join(', '))
  }

  // The build is kicked ONCE, as soon as there is anything to author, so it overlaps
  // authoring; every sandbox run then reuses it (skipBuild). A run with no authoring
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

  // Pre-flight the built entry ONCE (after the build succeeds), before any worker
  // session runs against it. A dead entry short-circuits every cli session into
  // ONE loud error; the judgment is GENERAL (no string matching).
  let resolvedEntryMemo: string[] | null = null
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

  // The scenario-id allocator, up front: a worker's id is assigned ONCE per task
  // and reused for every run of its session. A flow about to re-author frees its
  // OWN prior ids (its files are deleted at persist) so it reuses its stable
  // `<flow>.<surface>.1` without stealing a sibling's.
  const usedIds = existingScenarioIds(repoRoot)
  for (const w of changedWorks) {
    for (const id of w.prior?.scenarios.map((s) => s.id) ?? []) usedIds.delete(id)
  }

  /**
   * The RUN-LEVEL refusal, recorded at most once. The runner declined to run —
   * nothing was built, booted or executed — so this is deliberately NOT fanned out
   * into a per-candidate error: the candidates were never judged, and N copies of
   * one config fact read as N broken tests.
   */
  let runRefusal: GuardRunRefusal | null = null
  const recordRefusal = (refusal: GuardRunRefusal): void => {
    if (runRefusal) return
    runRefusal = refusal
    errors.push(runRefusalError(refusal))
  }
  const settleRefusal = (round: BirthRound, pool: readonly BirthCandidate[]): void => {
    if (!round.refusal) return
    recordRefusal(round.refusal)
    for (const c of pool) taskByKey.get(c.ref)!.errored = true
  }

  let birthTotal = 0
  let birthSettled = 0
  const bumpBirth = (): void => options.onBirthProgress?.(++birthSettled, birthTotal)
  const reconcileBirth = (): void => {
    if (birthSettled < birthTotal) options.onBirthProgress?.((birthSettled = birthTotal), birthTotal)
  }

  // C4 — the no-op birth anomaly gate, the last line of defense against a
  // silently inert recipe that got past every preflight. Each CONFIRMATION
  // round's per-driver step aggregate folds into ONE cumulative sample (fresh
  // candidates only — worker in-session runs and the isolated re-confirmations
  // are not folded), and the moment the sample says a driver is a do-nothing
  // surface, generate aborts through the same `recipe-failed` channel a
  // discovery failure uses. Every fold point sits BEFORE persist, so nothing
  // corpus-side has been written and the abort IS the rollback.
  let birthStepStats: GuardRunStepStats | null = null
  const foldBirthRound = (round: BirthRound): GuardNoOpAnomaly | null => {
    if (!round.stepStats) return null
    birthStepStats = birthStepStats ? foldStepStats(birthStepStats, round.stepStats) : round.stepStats
    return detectNoOpAnomaly(birthStepStats)
  }

  // The "test is wrong" verdicts — the classes withheld from the corpus: a
  // fidelity rejection on a green candidate, and a green settle whose fresh-
  // sandbox confirmation failed twice. Both unsettle their flow so the next
  // generate re-authors.
  const fidelityRejections = new Map<string, GuardBirthFinding[]>()
  const withheldFailures = new Map<string, GuardBirthFinding[]>()
  const persisted = new Map<string, BirthCandidate[]>()
  // Tests that COMMIT FAILING: the confirmation run failed and the worker's own
  // diagnosis (or the conservative untriaged default) rides the finding.
  const failedTests = new Map<string, { candidate: BirthCandidate; finding: GuardBirthFinding }[]>()
  const settleFailedTest = (task: AuthorTask, o: BirthOutcome, diagnosis?: GuardTriage): void => {
    const finding = toFinding(o)
    if (diagnosis) finding.triage = diagnosis
    pushInto(failedTests, taskKey(task), { candidate: o.candidate, finding })
  }

  /**
   * The escalation → retirement transition, at settle time: the ledger budget is
   * exhausted and the verdict is once more "the test is wrong" (or the worker
   * exhausted yet another session), so the surface stops burning spend and
   * SETTLES as a quiet `retired` gap — never a finding, never a task. The
   * retirement record absorbs the entry's count and verdict history (the entry
   * itself is dropped at run end, so a reset starts the budget over) plus the
   * reset anchors: the flow's spec-content key and the surface's authoring-prompt
   * fingerprint.
   */
  const retireFlow = (
    task: AuthorTask,
    surface: GuardDriverId,
    title: string,
    source: GuardAutoResolutionSource,
    detail: string,
  ): void => {
    const key = autoResolutionKey(task.work.flow.id, surface)
    const attempts = autoResolveCount(key) + 1
    const history: GuardAutoResolvedAttempt[] = [
      ...(priorLedger.entries[key]?.attempts ?? []),
      ...(ledgerBumps.get(key)?.attempts ?? []),
      { source, title, detail, at: nowIso },
    ]
    newRetirements.set(key, {
      flowId: task.work.flow.id,
      surface,
      title,
      doc: task.work.primary.doc,
      anchor: task.work.primary.anchor,
      attempts,
      history,
      retiredAt: nowIso,
      sectionsKey: sectionsContentKey(task.work.sectionKeys),
      promptFingerprint: authorPromptFingerprint(surface),
    })
    autoResolved.push({
      kind: 'retire',
      flowId: task.work.flow.id,
      surface,
      doc: task.work.primary.doc,
      anchor: task.work.primary.anchor,
      title,
      source,
      detail,
      attempts,
    })
    const reason = retiredGapReason(attempts)
    task.work.gaps.push({ surface, kind: 'retired', reason })
    coverageGaps.push({
      doc: task.work.primary.doc,
      anchor: task.work.primary.anchor,
      kind: 'retired',
      flowId: task.work.flow.id,
      surface,
      reason,
    })
    emitFlowState(task.work.flow.id, surface, 'retired', detail)
  }

  /**
   * The server-binding SAFETY NET, for the flows the route gates could not classify at
   * generate time (a path the manifest did not attribute, a plan whose journeys
   * carry no path): the sandbox ran the scenario, the bound server 404ed a path
   * another app serves, and the runner annotated the outcome `unservedRoute`. That
   * is the SAME fact Gate B blocks on, arriving later — so it settles as the same
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

  // -------------------------------------------------------------------------
  // The worker plumbing (cli surface)
  // -------------------------------------------------------------------------

  const journeyDefects: GuardJourneyDefect[] = []
  // One transcript run id per generate: every worker session appends its events
  // under guard/authoring/<runId>/<flowId>.<surface>.jsonl.
  const authoringRunId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}`
  let workerSessionsRan = false

  // Session-resume accounting (a confirmation flip re-opening its session, an
  // in-loop fidelity heal) — the `onRetryProgress` hook's meaning under workers.
  let resumesDone = 0
  let resumesTotal = 0
  const noteResumeQueued = (): void => options.onRetryProgress?.(resumesDone, ++resumesTotal)
  const noteResumeDone = (): void => options.onRetryProgress?.(++resumesDone, resumesTotal)

  // Fidelity accounting — the cli review runs IN-LOOP (inside the worker's settle
  // flow); the api review runs as a batch after its birth round.
  let fidelityReviewed = 0
  let fidelityPlanned = 0
  // Green tests persisted with NO review behind them, because the stage lost every
  // call (the adjudication carve-out below).
  let fidelityUnreviewed = 0
  // The task refs whose adjudication never happened because the stage lost EVERY
  // call. They must NOT settle: a settled flow records its inputs hash and the next
  // generate skips it as unchanged, so a corpus that shipped unadjudicated would
  // stay unadjudicated forever. Left unsettled, the next generate re-works the flow
  // and adjudicates it for real — a cache hit, so the re-run pays for the verdicts
  // and nothing else.
  const unadjudicatedRefs = new Set<string>()

  /** One worker-settled candidate awaiting the CONFIRMATION round — the gate of
   *  record. `session` present only when a live session ran this generate (a
   *  cache-served candidate has none to resume). */
  interface SettledCandidate {
    task: AuthorTask
    candidate: BirthCandidate
    raw: RawGeneratedScenario
    /** The worker's diagnosis when it settled the scenario FAILING. */
    failing?: GuardTriage
    session?: WorkerSessionState
  }
  const settledCandidates: SettledCandidate[] = []

  const authorTotal = authorTasks.length
  let authorDone = 0
  const bumpAuthor = (): void => options.onAuthorProgress?.(++authorDone, authorTotal)
  if (authorTotal > 0) options.onAuthorProgress?.(0, authorTotal)

  // Authoring outcomes, for the total-loss abort below. The unit is the TASK (one
  // flow × surface), counted only when it actually reached the model — a cache hit
  // authors without a session and is neither an attempt nor a loss. A worker
  // session that ended EXHAUSTED (turn budget, token budget, malformed, a dead
  // transport) counts as a loss; a settled/blocked/journey-defect ending is an
  // ANSWER.
  let authorCalls = 0
  let authorCallErrors = 0
  let firstAuthorCallError: string | undefined

  const workerAuthoringError = (task: AuthorTask, message: string): void => {
    errors.push({
      doc: task.work.primary.doc,
      anchor: task.work.primary.anchor,
      kind: 'authoring',
      flowId: task.work.flow.id,
      surface: task.surface,
      message,
    })
    task.errored = true
    emitFlowState(task.work.flow.id, task.surface, 'error', message)
  }

  const authorKeyOf = (task: AuthorTask): string =>
    authorCacheKey(
      task.work.flow,
      task.surface,
      task.work.sectionKeys,
      task.plan.journeys.map((j) => j.fingerprint),
      recipeFingerprint,
    )

  /** The settled outcome IS the cache: a later run replays it (re-validated)
   *  without a session. */
  const writeWorkerCache = (cacheKey: string, res: Extract<WorkerFlowResult, { kind: 'settled' }>): Promise<void> =>
    setCacheEntry(repoRoot, GENERATE_CACHE_NAME, cacheKey, {
      scenario: res.raw,
      blockedOn: [],
      ...(res.blockedMilestones.length > 0 ? { blockedMilestones: res.blockedMilestones } : {}),
      ...(res.failing ? { failing: res.failing } : {}),
    })

  /** A settle's blocked milestones mapped onto the manifest `milestones` wire
   *  shape (the partial-coverage record read surfaces already render). Null when
   *  nothing is blocked — or everything is (that is the `blocked` outcome). */
  const partialOf = (task: AuthorTask, blocked: readonly WorkerBlockedMilestone[]): TaskPartition | null => {
    if (blocked.length === 0) return null
    const orders = task.work.flow.milestones.map((m) => m.order)
    const claimOf = new Map(task.work.flow.milestones.map((m) => [m.order, m.claimTitle]))
    const blockedOrders = new Set(blocked.map((b) => b.milestone))
    const covered = orders.filter((o) => !blockedOrders.has(o)).sort((a, b) => a - b)
    if (covered.length === 0) return null
    const rows = [...blocked]
      .sort((a, b) => a.milestone - b.milestone)
      .map((b) => ({ milestone: b.milestone, claim: claimOf.get(b.milestone) ?? '', blockedOn: [...b.blockedOn] }))
    return { refusedOn: [...new Set(rows.flatMap((b) => b.blockedOn))], covered, blocked: rows }
  }

  /** The flow's doc-example blocks, mined once per task for the byte-fidelity
   *  validator (the same mining feeds the per-milestone DOC EXAMPLE prompt blocks). */
  const exampleDefectFor = (task: AuthorTask): ((raw: RawGeneratedScenario) => string | null) => {
    const blocks: DocExampleBlock[] = [...new Set(task.work.sections.values())].flatMap((s) =>
      mineExampleBlocks(s.fullText || s.ownText).map((b) => ({ ...b, doc: s.doc, anchor: s.anchor })),
    )
    return (raw) =>
      exampleFidelityDefect(
        raw.driver === 'api'
          ? { driver: 'api', steps: raw.steps, ...(raw.setup ? { setup: raw.setup } : {}) }
          : { driver: 'cli', steps: raw.steps, ...(raw.setup ? { setup: raw.setup } : {}) },
        blocks,
      )
  }

  /** The cheap pre-sandbox validators — a defective draft costs no run. */
  const draftDefect = (
    raw: RawGeneratedScenario,
    exampleDefectOf: (raw: RawGeneratedScenario) => string | null,
  ): string | null => {
    const composition = compositionDefectOf(raw, recipe)
    if (composition) return composition
    const badRe = firstInvalidMatchPattern(raw.steps)
    if (badRe) {
      return `invalid \`matches\` regex (step ${badRe.step} ${badRe.where}: /${badRe.pattern}/ — ${badRe.error})`
    }
    return exampleDefectOf(raw)
  }

  /** One sandbox execution for a worker's draft — the SAME executor seam birth
   *  uses, one candidate per run. A run-level refusal is recorded once and THROWN
   *  so the tool feeds it back to the still-open session. */
  const runWorkerScenario = async (task: AuthorTask, scenario: GuardScenario): Promise<GuardScenarioResult> => {
    // A recorded refusal reproduces identically on every run until the config
    // changes — never spawn another sandbox against it.
    if (runRefusal) throw new Error(runRefusal.message)
    const round = await birthValidate(
      repoRoot,
      [{ flow: task.work.flow, surface: task.surface, section: task.work.primary, scenario, ref: taskKey(task) }],
      {
        executor,
        recipe,
        skipBuild: true,
        noOpThresholdMs: options.noOpThresholdMs,
        runTimeoutMs: birthRunTimeoutMs(1),
      },
    )
    if (round.refusal) {
      recordRefusal(round.refusal)
      throw new Error(round.refusal.message)
    }
    const result = round.outcomes[0]?.result
    if (!result) throw new Error('the sandbox produced no result for the scenario')
    return result
  }

  const workerBudget = options.workerBudget
  /** 15 min per turn — the authoring tier's ceiling (heavy reasoning tails). */
  const WORKER_TURN_TIMEOUT_MS = 900_000

  /** One task's surface + engine closures for `runFlowWorker` — shared by the
   *  fresh session and every resume, so the two can never drift. `buildScenario`
   *  stamps the bound server exactly as the confirmation build does. */
  const workerClosures = (
    task: AuthorTask,
    scenarioId: string,
  ): Pick<Parameters<typeof runFlowWorker>[0], 'surface' | 'buildScenario' | 'validate' | 'runScenario'> => {
    const exampleDefectOf = exampleDefectFor(task)
    return {
      surface: task.surface === 'api' ? 'api' : 'cli',
      buildScenario: (raw) =>
        buildFlowScenario({
          flow: task.work.flow,
          journeys: task.plan.journeys,
          raw,
          id: scenarioId,
          ...(task.server ? { server: task.server } : {}),
          defaultServer: defaultApiServer,
        }),
      validate: (raw) => draftDefect(raw, exampleDefectOf),
      runScenario: (scenario) => runWorkerScenario(task, scenario),
    }
  }

  /** Resume a prior worker session with a new observation (a fidelity flag, a
   *  confirmation flip) — same closures, same scenario id, same transcript. */
  const resumeWorker = (
    task: AuthorTask,
    scenarioId: string,
    session: WorkerSessionState,
    observation: string,
    seededLastRun?: { raw: RawGeneratedScenario; scenario: GuardScenario; result: GuardScenarioResult },
  ): Promise<WorkerFlowResult> => {
    workerSessionsRan = true
    // A resumed session re-opens the task on the live board until it re-settles.
    emitFlowState(task.work.flow.id, task.surface, 'active', 'resumed')
    return runFlowWorker({
      flow: task.work.flow,
      ...workerClosures(task, scenarioId),
      userPrompt: observation,
      turn: workerTurn!,
      ...(workerBudget ? { budget: workerBudget } : {}),
      stage: 'guard.generate',
      subject: task.work.flow.id,
      model: options.models?.generate,
      fallbackModel: options.models?.fallback,
      timeoutMs: WORKER_TURN_TIMEOUT_MS,
      onEvent: (ev) => appendAuthoringEvent(repoRoot, authoringRunId, task.work.flow.id, task.surface, ev),
      resume: {
        messages: session.messages,
        ...(session.sessionId ? { sessionId: session.sessionId } : {}),
        observation,
        lastRun: seededLastRun ?? session.lastRun,
      },
    })
  }

  /** An EXHAUSTED worker session (turn budget, token budget, malformed, a dead
   *  transport): an authoring error + the taint, and the ledger's `author` budget
   *  — past the threshold the flow retires exactly like every other exhausted
   *  auto behavior. */
  const settleExhausted = (task: AuthorTask, res: Extract<WorkerFlowResult, { kind: 'exhausted' }>): void => {
    if (runRefusal) {
      // The session died of the RUN-LEVEL refusal (already recorded once): a
      // config fact, not an authoring loss — the flow stays unsettled with no
      // ledger bump, no taint, and no per-flow error copy of the one refusal.
      // The refusal record still NAMES every flow it cancelled.
      if (!runRefusal.flowIds.includes(task.work.flow.id)) {
        runRefusal.flowIds.push(task.work.flow.id)
      }
      task.errored = true
      emitFlowState(task.work.flow.id, task.surface, 'error', 'the runner refused the run')
      return
    }
    const detail = res.detail ? `${res.reason} — ${authorFailureReason(res.detail)}` : res.reason
    options.onAuthorFailure?.({
      flowId: task.work.flow.id,
      flowTitle: task.work.flow.title,
      surface: task.surface,
      doc: task.work.primary.doc,
      anchor: task.work.primary.anchor,
      reason: `worker session ended: ${detail}`,
      attempt: 1,
      willRetry: false,
    })
    authorCallErrors++
    firstAuthorCallError ??= detail
    taintFlow(task.work.flow.id, task.surface, task.work.flow.title, `authoring session ended without settling (${detail})`)
    errors.push({
      doc: task.work.primary.doc,
      anchor: task.work.primary.anchor,
      kind: 'authoring',
      flowId: task.work.flow.id,
      surface: task.surface,
      message: `authoring (${task.surface}) worker session ended: ${detail}`,
    })
    const key = autoResolutionKey(task.work.flow.id, task.surface)
    if (autoResolveCount(key) < escalateAfter) {
      bumpLedger(key, 'author', { title: task.work.flow.title, detail })
      task.errored = true
      emitFlowState(task.work.flow.id, task.surface, 'error', `worker session ended: ${detail}`)
    } else {
      retireFlow(task, task.surface, task.work.flow.title, 'author', detail)
    }
  }

  // JOURNEY SELF-HEAL — a worker's `journey-defect` ending is verified against
  // the LIVE program before it may error the task: the surface adapter re-probes
  // the disputed grammar/contract in a fresh sandbox (cli: the command's
  // `--help`, re-parsed and unioned into the journey grammar; api: a fresh boot
  // of the bound server answering the disputed operation) and the SAME session
  // resumes once with the verdict, so the flow completes in-run. ONE heal per
  // task; a second defect from the resumed session errors exactly as before.
  const journeyHealAttempted = new Set<string>()
  const healProbeFor = (task: AuthorTask): JourneyHealProbe => {
    if (options.journeyHealProbe) return options.journeyHealProbe
    if (task.surface === 'api') {
      return apiJourneyHealProbe({
        repoRoot,
        recipe,
        ...(task.server ? { server: task.server } : {}),
        journeys: task.plan.journeys,
      })
    }
    return cliJourneyHealProbe({
      repoRoot,
      journeys: task.plan.journeys,
      resolvedEntry: (resolvedEntryMemo ??= resolveEntry(repoRoot, recipe.entry ?? [])),
      displayEntry: recipe.entry ?? [],
      ...(recipe.env ? { recipeEnv: recipe.env } : {}),
    })
  }

  /** Record one journey-defect report row. Recorded for EVERY defect ending,
   *  healed or not — the row is the journey-mapper's feedback loop. */
  const recordJourneyDefect = (
    task: AuthorTask,
    res: Extract<WorkerFlowResult, { kind: 'journey-defect' }>,
    extra: { healed?: boolean; corrected?: string } = {},
  ): void => {
    journeyDefects.push({
      flowId: task.work.flow.id,
      surface: task.surface,
      ...(res.argv ? { argv: res.argv } : {}),
      promised: res.promised,
      observed: res.observed,
      ...extra,
    })
  }

  /** The defect's terminal ending — the pre-heal behavior: the row + the task
   *  error; the flow stays unsettled. A failed heal probe appends its reason. */
  const journeyDefectTerminal = (
    task: AuthorTask,
    res: Extract<WorkerFlowResult, { kind: 'journey-defect' }>,
    probeFailure?: string,
  ): 'error' => {
    task.errored = true
    const detail = probeFailure
      ? `journey defect: ${oneLine(res.promised)} (heal probe failed: ${oneLine(probeFailure)})`
      : `journey defect: ${oneLine(res.promised)}`
    emitFlowState(task.work.flow.id, task.surface, 'error', detail)
    return 'error'
  }

  /**
   * A worker's `journey-defect` ending: a first-class run output (a mapper bug
   * with a reproduction attached) — and a dispute the run VERIFIES before it
   * errors. The surface's heal probe re-derives the disputed grammar from the
   * live program; the session then resumes once with the corrected grammar
   * (probe sided with the worker) or the confirmation (probe sided with the
   * grammar), and the resumed result routes through the normal outcome routing.
   * A failed probe skips the heal and takes the terminal path with the failure
   * appended. Returns the final routing word so the caller can free the
   * scenario id on a non-settle.
   */
  const settleJourneyDefect = async (
    task: AuthorTask,
    scenarioId: string,
    res: Extract<WorkerFlowResult, { kind: 'journey-defect' }>,
  ): Promise<'settled' | 'blocked' | 'error'> => {
    const healKey = taskKey(task)
    if (journeyHealAttempted.has(healKey)) {
      // The resumed session contradicted the grammar AGAIN: the one heal is
      // spent, so this ending errors exactly as it did before the heal existed.
      recordJourneyDefect(task, res)
      return journeyDefectTerminal(task, res)
    }
    journeyHealAttempted.add(healKey)
    let verdict: JourneyHealVerdict
    try {
      verdict = await healProbeFor(task).probe({
        ...(res.argv ? { argv: res.argv } : {}),
        promised: res.promised,
        observed: res.observed,
      })
    } catch (e) {
      verdict = { verdict: 'probe-failed', detail: e instanceof Error ? e.message : String(e) }
    }
    if (verdict.verdict === 'probe-failed') {
      // The dispute could not be verified: no resume — the terminal path, with
      // the probe failure appended so the loss is diagnosable.
      recordJourneyDefect(task, res)
      return journeyDefectTerminal(task, res, verdict.detail)
    }
    const observation =
      verdict.verdict === 'grammar-confirmed'
        ? [
            verdict.observed,
            'Trust the given grammar: compose the invocation exactly from the facts it lists, and continue from your last draft.',
          ].join(' ')
        : verdict.corrected
          ? [
              'The grammar was re-derived from the live program and corrected. Corrected grammar:',
              ...verdict.corrected.rendered,
              'Continue from your last draft.',
            ].join('\n')
          : [
              `Your report was verified against the live program: ${verdict.observed}`,
              'The grammar layer will be fixed from this report. Finish this flow now:',
              'settle your last-run scenario with a failing diagnosis recording this',
              'disagreement, or report blocked if nothing remains provable.',
            ].join('\n')
    recordJourneyDefect(task, res, {
      healed: true,
      ...(verdict.verdict === 'defect-confirmed' && verdict.corrected
        ? { corrected: verdict.corrected.summary }
        : {}),
    })
    noteResumeQueued()
    let resumed: WorkerFlowResult
    try {
      resumed = await resumeWorker(task, scenarioId, res.session, observation)
    } finally {
      noteResumeDone()
    }
    const cacheKey = authorKeyOf(task)
    switch (resumed.kind) {
      case 'settled':
        await routeSettled(task, cacheKey, resumed, true)
        return 'settled'
      case 'blocked':
        await settleBlockedOutcome(task, cacheKey, resumed)
        return 'blocked'
      case 'journey-defect':
        return settleJourneyDefect(task, scenarioId, resumed)
      case 'exhausted':
        return (await settleExhaustedOrImplicit(task, cacheKey, resumed, false)) ? 'settled' : 'error'
    }
  }

  /** A worker's `blocked` ending: cache the refusal (a later run replays it for
   *  free) and settle the whole-flow blocked-on gap. */
  const settleBlockedOutcome = async (
    task: AuthorTask,
    cacheKey: string,
    res: Extract<WorkerFlowResult, { kind: 'blocked' }>,
  ): Promise<void> => {
    await setCacheEntry(repoRoot, GENERATE_CACHE_NAME, cacheKey, {
      scenario: null,
      blockedOn: res.blockedOn,
      ...(res.blockedMilestones.length > 0 ? { blockedMilestones: res.blockedMilestones } : {}),
    })
    settleBlocked(task, [...res.blockedOn, ...res.blockedMilestones.flatMap((b) => b.blockedOn)])
  }

  /**
   * The in-loop fidelity heal: the still-open session revises against the flag —
   * ONE resume, then ONE more review (a second flag is a rejection at any
   * confidence). Returns the ledger row's outcome word.
   */
  const healFlagged = async (
    task: AuthorTask,
    cacheKey: string,
    candidate: BirthCandidate,
    session: WorkerSessionState,
    mismatch: string,
  ): Promise<'resolved' | 'finding' | 'unresolved'> => {
    noteResumeQueued()
    let res: WorkerFlowResult
    try {
      res = await resumeWorker(
        task,
        candidate.scenario.id,
        session,
        [
          'A fresh-context reviewer read the settled scenario against its flow and',
          'FLAGGED it: it does not truly verify what the flow promises. Revise the',
          'scenario to CLOSE the gap below (assert the exact values the claims quote,',
          'on the exact observables they name), run it, and settle again. The flag:',
          `  ${mismatch}`,
        ].join('\n'),
      )
    } finally {
      noteResumeDone()
    }
    switch (res.kind) {
      case 'settled': {
        await writeWorkerCache(cacheKey, res)
        const partial = partialOf(task, res.blockedMilestones)
        if (partial) {
          task.partial = partial
          settlePartialGap(task, partial)
        }
        const revised: BirthCandidate = { ...candidate, scenario: res.scenario }
        if (res.failing) {
          settledCandidates.push({ task, candidate: revised, raw: res.raw, failing: res.failing, session: res.session })
          return 'finding'
        }
        options.onFidelityProgress?.(fidelityReviewed, ++fidelityPlanned)
        const second = await reviewFidelity(repoRoot, task, revised, fidelityRunner)
        options.onFidelityProgress?.(++fidelityReviewed, fidelityPlanned)
        if ('error' in second) {
          errors.push(adjudicationError('fidelity', task, revised.scenario.id, second.error))
          task.errored = true
          return 'unresolved'
        }
        if (second.verdict === 'flagged') {
          pushInto(fidelityRejections, revised.ref, fidelityFinding(revised, second.mismatch))
          return 'finding'
        }
        settledCandidates.push({ task, candidate: revised, raw: res.raw, session: res.session })
        return 'resolved'
      }
      case 'blocked':
        await settleBlockedOutcome(task, cacheKey, res)
        return 'unresolved'
      case 'journey-defect':
        // The defect takes the heal path (verify, resume once, route) exactly
        // like a fresh session's; a heal that re-settles resolves the flag.
        return (await settleJourneyDefect(task, candidate.scenario.id, res)) === 'settled'
          ? 'resolved'
          : 'unresolved'
      case 'exhausted':
        return (await settleExhaustedOrImplicit(task, cacheKey, res, false)) ? 'resolved' : 'unresolved'
    }
  }

  /**
   * The IN-LOOP fidelity review of a green settle: independence by context, not
   * by sequencing — a fresh-context judge reads the candidate while the worker's
   * session is still resumable, and a high-confidence flag returns to it as an
   * observation (ONE heal). A candidate with no session (a cache hit) takes the
   * rejection path instead. A faithful verdict queues the candidate for the
   * confirmation round.
   */
  const adjudicateGreen = async (
    task: AuthorTask,
    cacheKey: string,
    candidate: BirthCandidate,
    raw: RawGeneratedScenario,
    session: WorkerSessionState | undefined,
    allowHeal: boolean,
  ): Promise<void> => {
    options.onFidelityProgress?.(fidelityReviewed, ++fidelityPlanned)
    const review = await reviewFidelity(repoRoot, task, candidate, fidelityRunner)
    options.onFidelityProgress?.(++fidelityReviewed, fidelityPlanned)
    if ('error' in review) {
      errors.push(adjudicationError('fidelity', task, candidate.scenario.id, review.error))
      if (audit.isSystemicFailure('guard.fidelity')) {
        // The adjudication carve-out (live): the stage has lost every call so far —
        // the candidate persists unreviewed and its flow stays unsettled, so the
        // next generate reviews it for real.
        fidelityUnreviewed++
        unadjudicatedRefs.add(candidate.ref)
        settledCandidates.push({ task, candidate, raw, ...(session ? { session } : {}) })
      } else {
        task.errored = true
      }
      return
    }
    if (review.verdict !== 'flagged') {
      settledCandidates.push({ task, candidate, raw, ...(session ? { session } : {}) })
      return
    }
    const key = autoResolutionKey(candidate.flow.id, candidate.surface)
    if (review.confidence === 'high' && allowHeal && session && autoResolveCount(key) < escalateAfter) {
      bumpLedger(key, 'fidelity', { title: candidate.scenario.title, detail: review.mismatch })
      const outcome = await healFlagged(task, cacheKey, candidate, session, review.mismatch)
      autoResolved.push({
        kind: 'fidelity-discard',
        flowId: candidate.flow.id,
        surface: candidate.surface,
        doc: candidate.section.doc,
        anchor: candidate.section.anchor,
        title: candidate.scenario.title,
        mismatch: review.mismatch,
        outcome,
      })
      if (outcome !== 'resolved') {
        taintFlow(candidate.flow.id, candidate.surface, candidate.scenario.title, review.mismatch)
      }
      return
    }
    if (review.confidence === 'high' && autoResolveCount(key) >= escalateAfter) {
      // Budget exhausted: the flow RETIRES — a settled gap, never a task.
      retireFlow(task, candidate.surface, candidate.scenario.title, 'fidelity', review.mismatch)
      taintFlow(candidate.flow.id, candidate.surface, candidate.scenario.title, review.mismatch)
      return
    }
    // Medium/low — and a high flag with no session to heal (a cache-served
    // candidate): the rejection finding + taint; the re-author is owed to the
    // next generate. A session-less high flag still bumps the ledger so repeated
    // flags eventually retire.
    if (review.confidence === 'high') {
      bumpLedger(key, 'fidelity', { title: candidate.scenario.title, detail: review.mismatch })
    }
    pushInto(fidelityRejections, candidate.ref, fidelityFinding(candidate, review.mismatch))
    taintFlow(candidate.flow.id, candidate.surface, candidate.scenario.title, review.mismatch)
  }

  /**
   * A turn-budget death whose LAST run PASSED with full milestone coverage is
   * a settle the session had no turn left to declare: the last run is the
   * answer (the settle gate's own rule), applied engine-side. Verification
   * still follows in full — fidelity now, the confirmation round after.
   * Returns true when the implicit settle ran.
   */
  const settleExhaustedOrImplicit = async (
    task: AuthorTask,
    cacheKey: string,
    res: Extract<WorkerFlowResult, { kind: 'exhausted' }>,
    allowHeal: boolean,
  ): Promise<boolean> => {
    const last = res.session.lastRun
    if (
      !runRefusal &&
      res.reason === 'turn-budget' &&
      last &&
      last.result.outcome === 'pass' &&
      uncoveredMilestones(task.work.flow, last.raw).length === 0 &&
      unknownMilestones(task.work.flow, last.raw).length === 0
    ) {
      await routeSettled(
        task,
        cacheKey,
        {
          kind: 'settled',
          raw: last.raw,
          scenario: last.scenario,
          runResult: last.result,
          blockedMilestones: [],
          session: res.session,
        },
        allowHeal,
      )
      return true
    }
    settleExhausted(task, res)
    return false
  }

  /** Route one worker SETTLE: cache it, map partial blocks, and hand the
   *  candidate to fidelity (green) or straight to the confirmation pool (failing,
   *  with the worker's diagnosis). */
  const routeSettled = async (
    task: AuthorTask,
    cacheKey: string,
    res: Extract<WorkerFlowResult, { kind: 'settled' }>,
    allowHeal: boolean,
  ): Promise<void> => {
    // The session settling IS the settle the live board reports — flows settle
    // continuously. Fidelity, a heal, or a confirmation flip may re-activate
    // this task; the persist stage re-emits the final word.
    emitFlowState(
      task.work.flow.id,
      task.surface,
      'settled',
      res.failing ? `failing: ${res.failing.verdict}` : 'passing',
    )
    await writeWorkerCache(cacheKey, res)
    const partial = partialOf(task, res.blockedMilestones)
    if (partial) {
      task.partial = partial
      settlePartialGap(task, partial)
    }
    const candidate: BirthCandidate = {
      flow: task.work.flow,
      surface: task.surface,
      section: task.work.primary,
      scenario: res.scenario,
      ref: taskKey(task),
    }
    if (res.failing) {
      settledCandidates.push({ task, candidate, raw: res.raw, failing: res.failing, session: res.session })
      return
    }
    await adjudicateGreen(task, cacheKey, candidate, res.raw, res.session, allowHeal)
  }

  /** The per-flow user prompt context: the same blocks the pre-worker author
   *  consumed, minus authoring-time probes — journeys carry the grammar (cli)
   *  and the operation contracts (api) now. The api grounding blocks (inbound
   *  contracts, the rest of the surface, outbound construction) are built per
   *  task because the setup catalog is the BOUND server's own surface: an
   *  operation the route manifest positively attributes to ANOTHER app is
   *  unreachable from this scenario, and advertising it is exactly how foreign
   *  paths ended up in scenarios. An operation nobody claims stays offered —
   *  unknown is not foreign (R6). */
  const workerContext = (task: AuthorTask, taint?: GuardFlowTaint): AuthorUserContext => {
    const { work, surface, plan } = task
    const grounding =
      surface === 'api'
        ? (() => {
            const journeyContracts = buildJourneyContractHints(plan.journeys, requestContracts)
            const boundApp = appDirOfServer(serverIndex, task.server)
            const reachableJourneys = boundApp
              ? apiJourneys.filter((j) => !servedByOtherApp(serverIndex, boundApp, journeyEntryPath(j)))
              : apiJourneys
            const other = buildOtherOperationHints(reachableJourneys, requestContracts, journeyContracts)
            return {
              journeyContracts,
              otherOperations: other.operations,
              otherOperationsOverflow: other.overflow,
              outboundRequests: outboundRequestHints,
              outboundRequestsOverflow: outboundRequestsOverflow,
            }
          })()
        : {
            journeyContracts: [],
            otherOperations: [],
            otherOperationsOverflow: 0,
            outboundRequests: [],
            outboundRequestsOverflow: 0,
          }
    return {
      ...buildAuthorCtx(work, surface, plan, recipe, [], opIndex, docText, externalServiceHints, serverIndex, grounding),
      ...(taint ? { priorFlag: { title: taint.title, mismatch: taint.mismatch } } : {}),
    }
  }

  // --- Epic scheduling (the dependency DAG, two waves) -----------------------
  // An epic flow (non-empty `composedOf`) authors AFTER its members, and its
  // prompt carries the settled members' scenarios read-only. `composedOf` is one
  // level deep by construction, so two waves realize the whole DAG.
  const workByFlowId = new Map(works.map((w) => [w.flow.id, w]))
  let scenarioFilesMemo: Map<string, string> | null = null
  const scenarioFiles = (): Map<string, string> => (scenarioFilesMemo ??= scenarioFileIndex(repoRoot))

  /** One member's contribution to an epic prompt: its settled scenario's YAML
   *  (from this run's settles, or the committed file of an unchanged flow), or
   *  the state line an unsettled member is listed with. */
  const memberReference = (memberId: string, surface: GuardDriverId): { yaml: string } | { state: string } => {
    const settled = settledCandidates.find(
      (sc) => sc.candidate.flow.id === memberId && sc.candidate.surface === surface,
    )
    if (settled) return { yaml: serializeScenarioYaml(settled.candidate.scenario) }
    const memberWork = workByFlowId.get(memberId)
    if (memberWork && !memberWork.changed) {
      const id = memberWork.prior?.scenarios.find((s) => s.surface === surface)?.id
      const file = id ? scenarioFiles().get(id) : undefined
      if (file && fs.existsSync(file)) return { yaml: fs.readFileSync(file, 'utf-8') }
    }
    const st = flowStates.get(`${memberId}\0${surface}`)
    if (!st) return { state: 'no scenario on this surface' }
    if (st.state === 'blocked') return { state: `blocked on ${st.detail ?? 'world-state the sandbox cannot provide'}` }
    return { state: st.detail ? `${st.state} (${st.detail})` : st.state }
  }

  /** The read-only member block an epic task's user prompt ends with. */
  const epicMemberBlock = (task: AuthorTask): string => {
    const lines = [
      '',
      'MEMBER SCENARIOS (settled, read-only) — this flow is an EPIC: it chains the',
      'member flows below. Their settled scenarios are given verbatim for reference',
      "(never modify or re-author them; author THIS flow's own scenario, which walks",
      'the chained path end to end). A member without a settled scenario is listed',
      'with its state instead — judge whether the epic path is still walkable, and',
      'name what blocks it otherwise.',
    ]
    for (const memberId of task.work.flow.composedOf) {
      const ref = memberReference(memberId, task.surface)
      if ('yaml' in ref) lines.push('', `--- member ${memberId} (settled)`, ref.yaml.trimEnd())
      else lines.push('', `--- member ${memberId}: ${ref.state}`)
    }
    return lines.join('\n')
  }

  /** One authoring task: cache first (a hit re-validates and skips the
   *  session), else ONE worker session to a structured end. */
  const runAuthorWorker = async (task: AuthorTask): Promise<void> => {
    const { work, surface } = task
    emitFlowState(work.flow.id, surface, 'active')
    const taintKey = autoResolutionKey(work.flow.id, surface)
    const taint = priorLedger.tainted[taintKey]
    const cacheKey = authorKeyOf(task)
    const exampleDefectOf = exampleDefectFor(task)

    // A prior rejection poisons the cache entry (it IS the rejected scenario) —
    // skip the read; the fresh session's settle overwrites it under the same key.
    const cached = taint ? null : await getCacheEntry(repoRoot, GENERATE_CACHE_NAME, cacheKey)
    if (cached) {
      const parsed = AuthoredCacheSchema.safeParse(cached)
      if (parsed.success) {
        if (!parsed.data.scenario) {
          settleBlocked(task, [
            ...parsed.data.blockedOn,
            ...(parsed.data.blockedMilestones ?? []).flatMap((b) => b.blockedOn),
          ])
          return
        }
        if (parsed.data.scenario.driver === surface) {
          const raw = parsed.data.scenario
          const partial = partialOf(task, parsed.data.blockedMilestones ?? [])
          const allowed = partial ? new Set(partial.covered) : undefined
          if (
            uncoveredMilestones(work.flow, raw, allowed).length === 0 &&
            unknownMilestones(work.flow, raw, allowed).length === 0 &&
            !firstInvalidMatchPattern(raw.steps) &&
            !compositionDefectOf(raw, recipe) &&
            !exampleDefectOf(raw)
          ) {
            const built = safeBuild(task, raw, usedIds, errors, defaultApiServer)
            if (!built) {
              emitFlowState(work.flow.id, surface, 'error', 'the cached scenario failed to build')
              return
            }
            if (partial) {
              task.partial = partial
              settlePartialGap(task, partial)
            }
            if (parsed.data.failing) {
              settledCandidates.push({ task, candidate: built, raw, failing: parsed.data.failing })
            } else {
              await adjudicateGreen(task, cacheKey, built, raw, undefined, false)
            }
            return
          }
        }
      }
    }

    if (!workerTurn) {
      workerAuthoringError(
        task,
        `authoring (${surface}) needs a turn-capable LLM transport — the configured transport supports one-shot calls only, so no worker session can run; use the claude-code or api transport`,
      )
      return
    }
    // The session runs against the BUILT program: a failed build (or a dead
    // entry) ends the task before a turn is spent — the flow stays unsettled.
    const build = await awaitBuild()
    if (!build.ok) {
      workerAuthoringError(
        task,
        `authoring (${surface}) could not run: build failed (\`${build.command}\`)${build.timedOut ? ' — timed out' : ''}`,
      )
      return
    }
    if (await deadEntry()) {
      task.errored = true
      emitFlowState(work.flow.id, surface, 'error', 'the built entry failed to start')
      return
    }

    const ctx = workerContext(task, taint)
    const userPrompt =
      buildAuthorUserPrompt(ctx) + (work.flow.composedOf.length > 0 ? epicMemberBlock(task) : '')
    const scenarioId = assignScenarioId(work.flow.id, surface, usedIds)
    authorCalls++
    workerSessionsRan = true
    const result = await runFlowWorker({
      flow: work.flow,
      ...workerClosures(task, scenarioId),
      userPrompt,
      turn: workerTurn,
      ...(workerBudget ? { budget: workerBudget } : {}),
      stage: 'guard.generate',
      subject: work.flow.id,
      model: options.models?.generate,
      fallbackModel: options.models?.fallback,
      timeoutMs: WORKER_TURN_TIMEOUT_MS,
      onEvent: (ev) => appendAuthoringEvent(repoRoot, authoringRunId, work.flow.id, surface, ev),
    })
    switch (result.kind) {
      case 'settled':
        if (taint) freshlyAuthoredTaints.add(taintKey)
        await routeSettled(task, cacheKey, result, true)
        break
      case 'blocked':
        usedIds.delete(scenarioId)
        if (taint) freshlyAuthoredTaints.add(taintKey)
        await settleBlockedOutcome(task, cacheKey, result)
        break
      case 'journey-defect': {
        // The heal path: verify against the live program, resume once, route
        // the resumed outcome normally. Only a settle keeps the scenario id; an
        // unhealed defect leaves the flow unsettled ('pending next generate')
        // with the defect row as the record, exactly as before the heal.
        const final = await settleJourneyDefect(task, scenarioId, result)
        if (final !== 'error' && taint) freshlyAuthoredTaints.add(taintKey)
        if (final !== 'settled') usedIds.delete(scenarioId)
        break
      }
      case 'exhausted': {
        const settled = await settleExhaustedOrImplicit(task, cacheKey, result, true)
        if (settled) {
          if (taint) freshlyAuthoredTaints.add(taintKey)
        } else {
          usedIds.delete(scenarioId)
        }
        break
      }
    }
  }

  // The author fan-out: one shared pLimit slot per task — a task's whole
  // session (turns, sandbox runs, in-loop review, heal) occupies its slot.
  // TWO WAVES: every non-epic task first, then the epics, so an epic's prompt
  // can carry its settled members' scenarios. Order within a wave follows the
  // flow corpus, so scheduling is deterministic; members' outcomes are settled
  // records by the time an epic reads them and are never changed by it.
  const runTask = (task: AuthorTask): Promise<void> =>
    limit(async () => {
      try {
        await runAuthorWorker(task)
      } finally {
        bumpAuthor()
      }
    })
  await Promise.all(authorTasks.filter((t) => t.work.flow.composedOf.length === 0).map(runTask))
  await Promise.all(authorTasks.filter((t) => t.work.flow.composedOf.length > 0).map(runTask))

  // Every authoring unit was lost and nothing was authored. Returning `ok` here
  // would report a run that authored nothing as a clean no-op — and persist below
  // would then DELETE each changed flow's prior scenarios over an LLM outage. Abort
  // before anything is written: prior scenarios and manifest entries survive
  // untouched, the flows stay work for the next run. A run that authored ANYTHING
  // (some flows were cache hits, some sessions settled) is never an abort — its
  // losses are reported in `llmFailures` and `errors` instead.
  const authoringWipeout = authorCalls > 0 && authorCallErrors === authorCalls
  if (settledCandidates.length === 0 && (audit.isSystemicFailure('guard.generate') || authoringWipeout)) {
    const known = {
      recipe: recipeMeta,
      recipeFingerprint,
      sectionsTotal: plan.sections.length,
      sectionsChanged: plan.work.length,
      skippedUnchanged: plan.sections.length - plan.work.length,
      coverageGaps,
      errors,
      extractionFailures,
      orphaned: orphanedSections,
      orphanedDismissals,
      orphanedFlowDismissals,
      flows: flowsReport,
      journeys: journeysReport,
      externalServices,
    }
    // A thrown-call wipeout reads its reason off the tally; a worker/unusable-
    // output one has no tally to read, so it states the loss itself.
    const head = audit.isSystemicFailure('guard.generate')
      ? undefined
      : unusableOutputReason('guard.generate', 'authoring call', authorCalls, firstAuthorCallError)
    return llmFailedResult(audit, 'guard.generate', known, head)
  }

  // 8. Confirmation — the gate of record: every worker-settled candidate
  // (passing and failing alike) executes ONCE in a sandbox the session never
  // touched. cli candidates batch into ONE run (each already gets its own fresh
  // sandbox inside it); api candidates would share datastore state in a batched
  // run, so each confirms ALONE in a fresh runner invocation (services.up +
  // seed + boot per candidate), bounded by the isolation cap — beyond it the
  // remainder confirms in one batched run and settles on that (possibly
  // polluted) evidence. A worker-settled-FAILING candidate whose confirmation
  // PASSES drops its diagnosis and commits passing; a worker-settled-PASSING
  // candidate that FAILS confirmation re-opens its session once with the
  // evidence — ONE flip-resume routing serves both surfaces.
  // The api order (and thus the cap selection) is DETERMINISTIC — flow order,
  // then scenario id — never authoring completion order.
  const flowOrder = new Map(works.map((w, i) => [w.flow.id, i]))
  const confirmOrder = (a: SettledCandidate, b: SettledCandidate): number =>
    (flowOrder.get(a.candidate.flow.id) ?? 0) - (flowOrder.get(b.candidate.flow.id) ?? 0) ||
    a.candidate.scenario.id.localeCompare(b.candidate.scenario.id)
  let isolationLeft = isolationCap

  /** One confirmation round over a mixed pool: the cli batch, then the isolated
   *  api runs, then the api overflow batch. Returns the settled outcomes, or
   *  the no-op anomaly that aborts the run; a refusal unsettles the candidates
   *  it cancelled. */
  const confirmRound = async (
    pool: readonly SettledCandidate[],
  ): Promise<{ anomaly: GuardNoOpAnomaly } | { outcomes: BirthOutcome[] }> => {
    const outcomes: BirthOutcome[] = []
    const runBatch = async (batch: BirthCandidate[]): Promise<GuardNoOpAnomaly | null> => {
      const run = await birthValidate(repoRoot, batch, {
        executor,
        recipe,
        skipBuild: true,
        noOpThresholdMs: options.noOpThresholdMs,
        onPhase: options.onBirthPhase,
        onScenarioSettled: bumpBirth,
      })
      settleRefusal(run, batch)
      const anomaly = foldBirthRound(run)
      if (!anomaly) outcomes.push(...run.outcomes)
      return anomaly
    }
    const cli = pool.filter((sc) => sc.candidate.surface !== 'api').map((sc) => sc.candidate)
    if (cli.length > 0) {
      const anomaly = await runBatch(cli)
      if (anomaly) return { anomaly }
    }
    const api = [...pool.filter((sc) => sc.candidate.surface === 'api')].sort(confirmOrder)
    const isolate = api.slice(0, Math.max(0, isolationLeft))
    isolationLeft -= isolate.length
    if (isolate.length > 0) options.onBirthPhase?.('confirm', isolate.length)
    for (const sc of isolate) {
      if (runRefusal) {
        // A recorded refusal reproduces identically until the config changes:
        // the remaining candidates were never judged, so they stay unsettled.
        sc.task.errored = true
        emitFlowState(sc.task.work.flow.id, sc.task.surface, 'error', 'the runner refused the run')
        continue
      }
      const run = await birthValidate(repoRoot, [sc.candidate], {
        executor,
        recipe,
        skipBuild: true,
        noOpThresholdMs: options.noOpThresholdMs,
      })
      settleRefusal(run, [sc.candidate])
      const anomaly = foldBirthRound(run)
      if (anomaly) return { anomaly }
      const outcome = run.outcomes[0]
      if (outcome) {
        outcomes.push(outcome)
        bumpBirth()
      }
    }
    const overflow = api.slice(isolate.length).map((sc) => sc.candidate)
    if (overflow.length > 0) {
      const anomaly = await runBatch(overflow)
      if (anomaly) return { anomaly }
    }
    return { outcomes }
  }

  /**
   * Route ONE confirmation outcome — the same routing for a cli batch verdict
   * and an api isolated one. A pass persists; a fail commits failing with the
   * worker's diagnosis, flips into a session resume (`flips` given, session
   * live), commits untriaged (a cache-served candidate has no session), or —
   * on the SECOND round (`flips` null) — is withheld: the session re-settled
   * PASSING and the fresh sandbox still disagrees, so the scenario is defective
   * (state-dependent or nondeterministic), never committed, and the flow
   * re-authors next generate with its cache bypassed. An api setup-declaration
   * defect taints the flow so the next generate bypasses the poisoned cache.
   */
  const routeConfirmed = (
    sc: SettledCandidate,
    o: BirthOutcome,
    flips: { sc: SettledCandidate; outcome: BirthOutcome }[] | null,
  ): void => {
    const task = sc.task
    if (o.result.outcome === 'pass') {
      // A worker-settled-FAILING candidate whose fresh sandbox PASSES commits
      // passing — the confirmation is the evidence of record, so the
      // diagnosis is dropped with the failure it explained.
      pushInto(persisted, o.candidate.ref, o.candidate)
    } else if (o.result.outcome === 'fail') {
      if (sc.failing) {
        settleFailedTest(task, o, sc.failing)
      } else if (flips && sc.session) {
        flips.push({ sc, outcome: o })
      } else if (flips) {
        // A cache-served candidate has no session to resume: the flip commits
        // failing on the confirmation evidence (the conservative default —
        // red drift is never silently withheld), untriaged.
        settleFailedTest(task, o)
      } else {
        pushInto(withheldFailures, o.candidate.ref, toFinding(o))
        taintFlow(
          o.candidate.flow.id,
          o.candidate.surface,
          o.candidate.scenario.title,
          o.result.failure?.actual ?? 'the confirmation run failed twice against a scenario the session settled passing',
        )
      }
    } else if (o.candidate.surface === 'api' && isSetupDefectResult(o.result)) {
      // A setup-declaration defect is a rejected test: taint the flow so the
      // next generate bypasses the author cache still holding the bad setup.
      taintFlow(
        o.candidate.flow.id,
        o.candidate.surface,
        o.candidate.scenario.title,
        o.result.failure?.actual ?? 'setup failed to materialize',
      )
      task.errored = true
      errors.push(errorFrom(o))
      emitFlowState(o.candidate.flow.id, o.candidate.surface, 'error', 'the declared setup failed to materialize')
    } else if (!settleUnservedRoute(task, o)) {
      task.errored = true
      errors.push(errorFrom(o))
    }
  }

  if (settledCandidates.length > 0) {
    const build = await awaitBuild()
    if (!build.ok) {
      const message = `build failed (\`${build.command}\`)${build.timedOut ? ' — timed out' : ''}`
      for (const sc of settledCandidates) {
        sc.task.errored = true
        errors.push(errorFrom({ candidate: sc.candidate, result: { failure: { actual: message } } }))
        emitFlowState(sc.task.work.flow.id, sc.task.surface, 'error', 'the recipe build failed before confirmation')
      }
    } else if (await deadEntry()) {
      for (const sc of settledCandidates) {
        sc.task.errored = true
        emitFlowState(sc.task.work.flow.id, sc.task.surface, 'error', 'the built entry failed to start')
      }
    } else {
      const byId = new Map(settledCandidates.map((sc) => [sc.candidate.scenario.id, sc]))
      birthTotal += settledCandidates.length
      const first = await confirmRound(settledCandidates)
      reconcileBirth()
      if ('anomaly' in first) {
        return emptyResult('recipe-failed', { llmFailures: audit.failures(), reason: noOpAnomalyReason(first.anomaly, recipe) })
      }

      const flips: { sc: SettledCandidate; outcome: BirthOutcome }[] = []
      for (const o of first.outcomes) {
        routeConfirmed(byId.get(o.candidate.scenario.id)!, o, flips)
      }

      // ONE resume per flipped candidate — the session wakes to the fresh-sandbox
      // evidence — then the revised settles get ONE more confirmation round.
      if (flips.length > 0) {
        const revised: SettledCandidate[] = []
        await Promise.all(
          flips.map(({ sc, outcome }) =>
            limit(async () => {
              noteResumeQueued()
              let res: WorkerFlowResult
              try {
                res = await resumeWorker(
                  sc.task,
                  sc.candidate.scenario.id,
                  sc.session!,
                  confirmObservation(outcome),
                  { raw: sc.raw, scenario: sc.candidate.scenario, result: outcome.result },
                )
              } finally {
                noteResumeDone()
              }
              const cacheKey = authorKeyOf(sc.task)
              switch (res.kind) {
                case 'settled': {
                  await writeWorkerCache(cacheKey, res)
                  const partial = partialOf(sc.task, res.blockedMilestones)
                  if (partial) {
                    sc.task.partial = partial
                    settlePartialGap(sc.task, partial)
                  }
                  revised.push({
                    task: sc.task,
                    candidate: { ...sc.candidate, scenario: res.scenario },
                    raw: res.raw,
                    ...(res.failing ? { failing: res.failing } : {}),
                    session: res.session,
                  })
                  break
                }
                case 'blocked':
                  await settleBlockedOutcome(sc.task, cacheKey, res)
                  break
                case 'journey-defect':
                  // No heal after a confirmation flip: the confirmation pools
                  // are closed, so a heal-resumed settle would have no round
                  // left to confirm in — the defect records and errors as it
                  // always did, and the next generate re-authors the flow.
                  recordJourneyDefect(sc.task, res)
                  journeyDefectTerminal(sc.task, res)
                  break
                case 'exhausted':
                  // No implicit settle here: the confirmation pools are closed,
                  // so a session-passing last run would have no round left to
                  // confirm in — the exhaustion records as it always did.
                  settleExhausted(sc.task, res)
                  break
              }
            }),
          ),
        )
        if (revised.length > 0) {
          const revisedById = new Map(revised.map((sc) => [sc.candidate.scenario.id, sc]))
          birthTotal += revised.length
          const second = await confirmRound(revised)
          reconcileBirth()
          if ('anomaly' in second) {
            return emptyResult('recipe-failed', { llmFailures: audit.failures(), reason: noOpAnomalyReason(second.anomaly, recipe) })
          }
          for (const o of second.outcomes) {
            routeConfirmed(revisedById.get(o.candidate.scenario.id)!, o, null)
          }
        }
      }
    }
  }

  // THE ADJUDICATION CARVE-OUT (plan item 88). Every OTHER stage aborts the run
  // (`llm-failed`, nothing written) when it loses every call, because those stages
  // gate CONTENT: a blind extraction or a blind authoring pass would rewrite the
  // committed corpus with an outage's noise. Fidelity gates VERDICTS ABOUT content
  // that already exists and that the sandbox has already executed against the real
  // app — a lost review means a green test persists unreviewed. That costs
  // ANNOTATION, not correctness, and aborting would throw away the whole run's
  // authoring spend — strictly more expensive than shipping it annotated. So the
  // collapse never aborts. It is not silent either: the stage is recorded here,
  // rides the persisted `guard/result.json`, and every surface that renders the
  // generate summary says the corpus shipped unadjudicated.
  const unadjudicated: GuardUnadjudicatedStage[] = []
  if (audit.isSystemicFailure('guard.fidelity')) {
    unadjudicated.push({ stage: 'guard.fidelity', affected: fidelityUnreviewed })
  }

  // 11. Persist — INDEPENDENTLY, per scenario, whatever its birth execution said.
  // A test that passed is written; a test that FAILED is written too, with its
  // birth result recorded and `status: 'failing'` in the manifest — a
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
        // A PARTIAL scenario records the milestone orders it covers — the honest
        // "N of M claims tested" half; the blocked rest is on the sibling gap.
        const covered = task?.partial ? { milestones: task.partial.covered } : {}
        written.push({
          id: c.scenario.id,
          title: c.scenario.title,
          doc: work.primary.doc,
          anchor: work.primary.anchor,
          file,
          flowId: work.flow.id,
          surface,
          status,
          ...covered,
        })
        // A failing test COMMITS WITH its diagnosis: the manifest entry
        // is the durable record — it travels with the corpus and survives every
        // no-op generate, so the report's committed row re-derives from it.
        scenarios.push({
          id: c.scenario.id,
          surface,
          status,
          ...covered,
          ...(finding ? { diagnosis: diagnosisOf(finding, file) } : {}),
        })
        return file
      }
      for (const c of persisted.get(ref) ?? []) {
        commit(c, 'passing')
        emitFlowState(work.flow.id, surface, 'settled', 'passing')
      }
      for (const { candidate, finding } of failedTests.get(ref) ?? []) {
        const file = commit(candidate, 'failing', finding)
        // The birth result rides the report keyed on the test it belongs to, so
        // every failure now names a scenario the user can open, re-run, or delete.
        birthFindings.push({ ...finding, scenarioId: candidate.scenario.id, committed: true, file })
        emitFlowState(
          work.flow.id,
          surface,
          'settled',
          finding.triage ? `failing: ${finding.triage.verdict}` : 'failing',
        )
      }
      const rejections = fidelityRejections.get(ref) ?? []
      const withheld = withheldFailures.get(ref) ?? []
      birthFindings.push(...rejections, ...withheld)
      if (
        rejections.length > 0 ||
        withheld.length > 0 ||
        unadjudicatedRefs.has(ref) ||
        task?.errored
      ) {
        unsettledFlow = true
      }
      // The terminal backstop, so the state feed's counters always sum. A
      // rejection or a withhold OVERRIDES a session-time settle (the flow did
      // not, in the end, settle); a task that already carries its own terminal
      // (retired, an authoring error) keeps it.
      if (rejections.length > 0) {
        emitFlowState(work.flow.id, surface, 'error', 'the scenario was rejected as not verifying its flow')
      } else if (withheld.length > 0) {
        emitFlowState(work.flow.id, surface, 'error', 'withheld: the confirmation run failed twice')
      } else if (unadjudicatedRefs.has(ref)) {
        emitFlowState(work.flow.id, surface, 'error', 'no fidelity verdict landed')
      } else {
        // Generic backstop: only a task that never reached ANY terminal —
        // a settled state here means the surface genuinely settled; keep it.
        const current = flowStates.get(`${work.flow.id}\0${surface}`)?.state
        if (!current || current === 'queued' || current === 'active') {
          emitFlowState(work.flow.id, surface, 'error', 'the flow did not settle this run')
        }
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

  // Post-generate seed drafting used to run HERE. It is gone: `truecourse guard
  // setup` writes the seed BEFORE the first extraction call, and the drafting gate
  // refused to overwrite an existing `api.seed` — so the stage was dead by
  // construction the moment setup became a prerequisite.

  // Reconcile the durable ledger ONCE — counts, taints and retirements together:
  //  - counts: prior entries carry; this run's auto-resolutions bump theirs; a
  //    flow that CONVERGED (committed a passing test) clears its budget, and a
  //    cleared retirement clears its count too (the budget starts over).
  //  - taints: a tainted flow freshly re-authored this run clears (the poisoned
  //    cache entry was overwritten) unless it re-flagged; a flow that ended
  //    rejected is (re)tainted with the latest evidence; a flow neither
  //    re-authored nor cleared keeps its prior taint.
  //  - retirements: a reset drops its record; a new retirement lands with the
  //    count + history it absorbed, and its entry is dropped with it.
  // Written only when something is (or was) in the ledger, so a clean run never
  // creates the file.
  const nextEntries: Record<string, GuardAutoResolutionEntry> = { ...priorLedger.entries }
  for (const key of clearedRetirements) delete nextEntries[key]
  for (const [key, bump] of ledgerBumps) {
    const carried = clearedRetirements.has(key) ? undefined : priorLedger.entries[key]
    nextEntries[key] = {
      count: (carried?.count ?? 0) + bump.times,
      source: bump.source,
      updatedAt: nowIso,
      attempts: [...(carried?.attempts ?? []), ...bump.attempts],
    }
  }
  for (const w of written) {
    if (w.status === 'passing') delete nextEntries[autoResolutionKey(w.flowId, w.surface)]
  }
  const nextTainted: Record<string, GuardFlowTaint> = { ...priorLedger.tainted }
  for (const key of freshlyAuthoredTaints) delete nextTainted[key]
  for (const [key, taint] of flaggedFlows) nextTainted[key] = taint
  const nextRetired: Record<string, GuardFlowRetirement> = { ...priorLedger.retired }
  for (const key of clearedRetirements) delete nextRetired[key]
  for (const [key, retirement] of newRetirements) {
    nextRetired[key] = retirement
    delete nextEntries[key]
  }
  if (
    Object.keys(nextEntries).length > 0 ||
    Object.keys(nextTainted).length > 0 ||
    Object.keys(nextRetired).length > 0 ||
    Object.keys(priorLedger.entries).length > 0 ||
    Object.keys(priorLedger.tainted).length > 0 ||
    Object.keys(priorLedger.retired).length > 0
  ) {
    writeGuardAutoResolutions(repoRoot, {
      version: 1,
      entries: nextEntries,
      tainted: nextTainted,
      retired: nextRetired,
    })
  }

  // The surviving-pass identity (B6): one count per birth pass that reached a
  // reported bucket — a committed passing test, a fidelity rejection, a
  // fidelity-discard ledger row, or a fidelity-driven retirement. A pass whose
  // review could not complete reaches no bucket and is not counted.
  const birthPassed =
    written.filter((w) => w.status === 'passing').length +
    [...fidelityRejections.values()].reduce((n, list) => n + list.length, 0) +
    autoResolved.filter((a) => a.kind === 'fidelity-discard').length +
    autoResolved.filter((a) => a.kind === 'retire' && a.source === 'fidelity').length

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
    journeyDefects,
    ...(workerSessionsRan ? { authoringRunId } : {}),
    errors,
    extractionFailures,
    llmFailures: audit.failures(),
    unadjudicated,
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
 *  and therefore what decides its server (Gate B, the post-match server binding). */
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
   * The recipe server each surface's plan binds to, when the route
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
  /** The recipe server this scenario runs against, when the binding knows
   *  it. Absent ⇒ the recipe's default server, and no `server` is stamped. */
  server?: string
  /** Set when authoring/birth/fidelity errored — the flow stays unsettled. */
  errored?: boolean
  /**
   * Set when the worker settled this flow PARTIALLY (some milestones named
   * blocked): the scenario covers `covered` only, and every later stage of this
   * task (fidelity, confirmation, manifest) reads the split from here.
   */
  partial?: TaskPartition
}

/** A partially-blocked flow's settled split — covered subset + blocked rest.
 *  The manifest `milestones` wire shape derives from it, unchanged. */
interface TaskPartition {
  /** The blocked milestones' capability nouns, deduped. */
  refusedOn: string[]
  /** The flow milestone orders the scenario covers, ascending. */
  covered: number[]
  /** The blocked milestones, nouns as the worker named them (enriched at the gap). */
  blocked: { milestone: number; claim: string; blockedOn: string[] }[]
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

/** Every live section the flow binds — its milestones' and its bindings', deduped. */
function boundSections(flow: GuardFlow, byKey: ReadonlyMap<string, SectionInput>): SectionInput[] {
  const out = new Map<string, SectionInput>()
  for (const ref of [...flow.milestones, ...flow.bindings]) {
    const key = flowSectionKey(ref.doc, ref.anchor)
    const section = byKey.get(key)
    if (section) out.set(key, section)
  }
  return [...out.values()]
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
 * The user-provided external accounts that are actually USABLE this run:
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
      // Every detected override variable rides along — a stub has to point
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
  /** The repo's own product names — never a third party, never a blocked-on noun. */
  ownProductNames: string[]
  /** Per-operation inbound request contracts — the per-journey authoring grounding. */
  requestContracts: ApiRequestContract[]
  /** The app's own outbound request construction — the stub-fidelity grounding. */
  outboundRequests: OutboundRequest[]
  /** The detected datastore + its parsed schema — the seed draft's whole grounding. */
  database: SeedDraftDatabase | null
  /** The connection URLs the app writes down — the generated datastore's source. */
  datastoreUrls: DatastoreUrlRef[]
  /** The mapping's static-vs-runtime disagreements; the journeys report carries them. */
  diagnostics: JourneyDiagnostic[]
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
        ownProductNames: mapped.ownProductNames ?? [],
        database: mapped.database ?? null,
        datastoreUrls: mapped.datastoreUrls ?? [],
        requestContracts: mapped.requestContracts ?? [],
        outboundRequests: mapped.outboundRequests ?? [],
        diagnostics: mapped.diagnostics ?? [],
      }
    } catch {
      /* fall through to the snapshot */
    }
  }
  // The snapshot carries journeys only — external services are derived from the
  // working tree, never persisted, so a degraded run reports none rather than a
  // stale list.
  const snapshot = readJourneyCatalog(repoRoot)
  return {
    journeys: snapshot?.journeys ?? [],
    externalServices: [],
    ownProductNames: [],
    database: null,
    datastoreUrls: [],
    requestContracts: [],
    outboundRequests: [],
    diagnostics: snapshot?.diagnostics ?? [],
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

/**
 * A run that produced no scenarios, carrying the user-facing reason. `extra` may
 * also carry what IS known at the abort point (the section counts, the recipe, the
 * per-doc extraction failures, the stage tallies) — an `llm-failed` abort knows
 * more than a `no-docs` one.
 */
function emptyResult(
  status: 'no-docs' | 'recipe-failed' | 'llm-failed',
  extra: { reason: string } & Partial<GuardGenerateResult>,
): GuardGenerateResult {
  return {
    status,
    sectionsTotal: 0,
    sectionsChanged: 0,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    journeyDefects: [],
    errors: [],
    extractionFailures: [],
    llmFailures: [],
    unadjudicated: [],
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
    ...extra,
  }
}

/**
 * The `llm-failed` abort for a stage that lost EVERY call: the stage's own tally
 * becomes the user-facing reason (`head` overrides it for a stage whose calls
 * ANSWERED and came back unusable, which no tally records), and every stage tally
 * of the run rides along. Nothing this run produced is claimed as output — the
 * caller returns this INSTEAD of writing scenarios or the manifest, so the
 * committed corpus is exactly what it was before the run.
 */
function llmFailedResult(
  audit: TransportAudit,
  stage: string,
  known: Partial<GuardGenerateResult>,
  head = formatStageFailure(audit.tally(stage)),
  tail = 'Nothing was generated; the committed scenarios and manifest are unchanged.',
): GuardGenerateResult {
  return emptyResult('llm-failed', {
    reason: `${head.endsWith('.') ? head : `${head}.`} ${tail}`,
    llmFailures: audit.failures(),
    ...known,
  })
}

/**
 * The `llm-failed` reason for calls that all ANSWERED and were all unusable —
 * output that failed validation twice, once per corrective re-ask. The transport
 * tally counts those calls as successes, so the reason states the loss in the same
 * words {@link formatStageFailure} uses for a thrown-call wipeout.
 */
function unusableOutputReason(stage: string, unit: string, calls: number, firstError?: string): string {
  const head = `every ${unit} in the \`${stage}\` stage came back unusable (${calls} of ${calls}) — the stage produced nothing`
  return firstError ? `${head}. First failure: ${firstError}.` : `${head}.`
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

/**
 * The cached authored output for one (flow, surface): its scenario (with the
 * blocked-milestone split and the failing diagnosis the settle carried), or the
 * capabilities the flow is blocked on. Entries the pre-worker path wrote carry
 * only the first two fields, and still parse.
 */
const AuthoredCacheSchema = z.object({
  scenario: RawGeneratedScenarioSchema.nullable(),
  blockedOn: z.array(z.string().min(1)).default([]),
  blockedMilestones: z
    .array(z.object({ milestone: z.number().int().positive(), blockedOn: z.array(z.string().min(1)).min(1) }))
    .optional(),
  failing: GuardTriageSchema.optional(),
})

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
): AuthorUserContext {
  const sections = [...new Set([...work.sections.values()])]
  // The server this flow's scenario runs against. The prompt describes THAT
  // service — its serve argv, its health path, and only the credentials that
  // authenticate against it — so the model is never shown a surface the scenario
  // cannot reach. Absent binding ⇒ the recipe's default server, which is exactly
  // what every single-server repo's prompt has always described.
  const serverName = work.serverBySurface.get(surface)
  const bound = serverName ? resolveApiServers(recipe).servers.get(serverName) : undefined
  const commandGrammar = surface === 'api' ? [] : commandGrammarOf(plan.journeys)
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
          // The code-truth grounding blocks — each gated on non-empty, so a repo the
          // extractors read nothing out of renders exactly the prompt it did before.
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
      : {
          recipeEntry: recipe.entry,
          // The bound commands' parsed flag grammar — gated on non-empty, so a
          // mapping that derived no cli grammar renders the prompt it always did.
          ...(commandGrammar.length > 0 ? { commandGrammar } : {}),
        }),
    recipeBuild: recipe.build,
    probes,
  }
}

/**
 * The parsed grammar of the commands a plan's cli journeys invoke, one entry per
 * command path. Journeys derived before the option schema existed still render:
 * their bare flag list degrades to name-only options.
 */
function commandGrammarOf(journeys: readonly Journey[]): CommandGrammarEntry[] {
  const byPath = new Map<string, CommandGrammarEntry>()
  for (const journey of journeys) {
    if (journey.type !== 'cli') continue
    for (const step of journey.steps) {
      if (step.kind !== 'invoke') continue
      const key = step.command.join(' ')
      if (byPath.has(key)) continue
      const options = step.options ?? step.flags.map((flag) => ({ flag }))
      byPath.set(key, {
        command: [...step.command],
        ...(step.label ? { label: step.label } : {}),
        options,
      })
    }
  }
  return [...byPath.values()]
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
 * The OpenAPI write-op request schemas the flow's sections reference, deduped by
 * `method path` and sorted stably. Empty when no section matches a write op.
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
 * The DEFAULT api server's serve argv, whichever shape the recipe uses.
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
   * The server the scenario is bound to. A credential's `servers`
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
    // Judge-on-one-screen: the failed candidate's exact YAML rides inline so the
    // finding detail shows the commands it ran; `claim` is the dismissal identity,
    // so the detail's Dismiss action can key on it.
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
 * The diagnosis a committed failing test carries on its manifest entry — the
 * finding's durable fields plus the committed file, minus the inline YAML
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

/**
 * The observation a CONFIRMATION FLIP re-opens its worker session with: the
 * fresh-sandbox evidence, and the same doc-first discipline the session already
 * works under — fix mechanics, never weaken an assertion; a genuine
 * disagreement settles FAILING with a diagnosis.
 */
function confirmObservation(o: BirthOutcome): string {
  const f = o.result.failure
  const indent = (text: string): string =>
    text
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')
  const lines = [
    'The CONFIRMATION run failed: the scenario you settled was executed once more',
    'in a fresh sandbox this session never touched, and it did not pass there.',
    'Fix COMMANDS, ARGUMENTS, and SETUP when the scenario is at fault — but when',
    "the evidence shows a genuine doc-vs-code disagreement, keep the claim's",
    'assertion and settle FAILING with a diagnosis. The evidence:',
    `  failing step: ${f?.step ?? 1}${o.result.failedMilestone ? ` (milestone ${o.result.failedMilestone})` : ''}`,
    `  expected: ${f?.expected ?? ''}`,
    `  actual:   ${f?.actual ?? ''}`,
  ]
  if (f?.stdout) lines.push('  program stdout:', indent(f.stdout))
  if (f?.stderr) lines.push('  program stderr:', indent(f.stderr))
  return lines.join('\n')
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

/**
 * One lost ADJUDICATION call, as an error row that NAMES what it was judging. The
 * work itself is intact — the test was authored and birth ran it — so this row is
 * never counted or worded as an authoring failure; what is missing is the verdict,
 * and the only useful thing it can say is WHICH test now carries none.
 */
function adjudicationError(
  kind: 'fidelity',
  task: AuthorTask,
  scenarioId: string,
  error: string,
): GuardGenerateError {
  return {
    doc: task.work.primary.doc,
    anchor: task.work.primary.anchor,
    kind,
    flowId: task.work.flow.id,
    surface: task.surface,
    scenarioId,
    message: `fidelity review (${task.surface}) ${error}`,
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

// --- Fidelity review ---------------------------------------------------------

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
  // A PARTIAL scenario is judged against its covered subset only — reviewing it
  // against the whole flow would flag the blocked milestones' absence as a gap.
  const partial = task.partial
  const coveredSet = partial ? new Set(partial.covered) : null
  const cacheKey = fidelityCacheKey(scenarioBehavior(candidate.scenario), work, partial?.covered)

  const cached = await getCacheEntry(repoRoot, FIDELITY_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = FidelityReviewSchema.safeParse(cached)
    if (parsed.success) return normalizeFidelity(parsed.data)
  }

  const ctx: FidelityUserContext = {
    flow: { id: work.flow.id, title: work.flow.title, goal: work.flow.goal },
    milestones: [...work.flow.milestones]
      .sort((a, b) => a.order - b.order)
      .filter((m) => !coveredSet || coveredSet.has(m.order))
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
    ...(partial
      ? { blocked: partial.blocked.map((b) => ({ order: b.milestone, blockedOn: b.blockedOn })) }
      : {}),
    scenarioYaml: serializeScenarioYaml(candidate.scenario),
    scenarioId: candidate.scenario.id,
    surface: candidate.surface,
  }
  const attempt = await callFidelityWithReask(ctx, runner)
  if ('error' in attempt) return { error: attempt.error }
  await setCacheEntry(repoRoot, FIDELITY_CACHE_NAME, cacheKey, attempt.review)
  return normalizeFidelity(attempt.review)
}

/** A flagged verdict always yields a non-empty mismatch (the finding's evidence);
 *  the stated confidence rides along (HIGH drives the self-heal). */
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
 *  milestone composition, its sections' content, the format, or the fidelity prompt.
 *  A PARTIAL scenario's covered subset joins the key (the review context differs);
 *  a full scenario's key is byte-identical to before partial flows existed. */
function fidelityCacheKey(scenarioBehaviorKey: string, work: FlowWork, covered?: readonly number[]): string {
  return createHash('sha256')
    .update(
      [
        FIDELITY_PROMPT_FINGERPRINT,
        String(GUARD_FORMAT_VERSION),
        work.flow.fingerprint,
        [...work.sectionKeys].sort().join('~'),
        scenarioBehaviorKey,
        ...(covered ? [`covered:${[...covered].sort((a, b) => a - b).join(',')}`] : []),
      ].join('::'),
    )
    .digest('hex')
}

type FidelityAttempt = { review: { verdict: 'faithful' | 'flagged'; mismatch?: string } } | { error: string }

/**
 * Call the fidelity runner and validate its verdict; a call that THREW is retried
 * once (an unreviewed green is the suspect class the reviewer exists for — far
 * dearer than a second call), and a call that answered unusably is re-asked ONCE
 * with the invalid output quoted back, then validated again. Returns `{ error }`
 * when both attempts threw or the re-ask was still invalid.
 */
async function callFidelityWithReask(ctx: FidelityUserContext, runner: FidelityRunner): Promise<FidelityAttempt> {
  const attempt = await callWithRetry(runner, ctx)
  if ('error' in attempt) return { error: `call failed: ${attempt.error}` }
  const parsed = FidelityReviewSchema.safeParse(attempt.raw)
  if (parsed.success) return { review: parsed.data }

  const reAttempt = await callWithRetry(runner, {
    ...ctx,
    correction: { invalidOutput: quoteInvalidOutput(attempt.raw) },
  })
  if ('error' in reAttempt) return { error: `re-ask failed: ${reAttempt.error}` }
  const reParsed = FidelityReviewSchema.safeParse(reAttempt.raw)
  if (reParsed.success) return { review: reParsed.data }
  return { error: `output invalid after re-ask: ${flattenZodError(reParsed.error)}` }
}
