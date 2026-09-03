/**
 * `guard generate` orchestration — the LLM pipeline that turns spec FLOWS into
 * committed scenarios. The generation unit is the flow (a user-goal path over
 * spec claims); sections remain the binding/staleness anchor underneath it.
 * Every LLM stage except recipe discovery and realization matching runs as
 * AGENT SESSIONS through the seams the command adapter injects (plan 04):
 *
 *   1. recipe   load `recipe.json`, or discover + verify one (proposal-only LLM —
 *               the one-shot deliberately KEPT, see section 03).
 *   2. index    deterministic doc universe + section index + change detection.
 *   3. extract  one `guard-generate.extract` agent session per document →
 *               claims + untestable notes, anchors snapped to the live index.
 *               Claims are no longer the generation unit — they are the
 *               milestone vocabulary.
 *   4. interfaces deterministic, free: the app's own surfaces, mapped from the tree.
 *   5. flows    per-area `guard-generate.flows` sessions + the epic session →
 *               `scenarios/flows.json`.
 *   6. match    per (flow, surface with a catalog): the realization plan, or an
 *               explicit `unrealizable` — the join of the two halves. Still a
 *               cached one-shot; both server-binding gates fire here, BEFORE
 *               any worker spends.
 *   7. workers  one `guard-generate.flow-worker` session per (flow, surface with
 *               a plan): the session authors, runs, revises and adjudicates in a
 *               loop over exactly two tools, with the fidelity judge as its
 *               depth-1 child. This replaced the one-shot author → birth-retry →
 *               fidelity → triage STAGES (retired, plan 04 step 20); a
 *               committed red's diagnosis is the worker's confirmed
 *               `expectedReds` prediction.
 *   8. persist  INDEPENDENTLY: every scenario is written the moment it settles —
 *               passing or failing. Only a "test is wrong" verdict (a fidelity
 *               rejection, a worker retirement) withholds one; no held state.
 *   9. manifest rewrite the flow-keyed binding record with the settled outcomes,
 *               each scenario carrying the status it was committed with.
 *
 * A flow whose `generationInputsHash` still matches the manifest is a no-op: it is
 * matched from cache (free), its committed scenarios stand, and the gaps only
 * AUTHORING could have derived are carried forward from its entry. Everything a
 * flow cannot realize lands as a per-surface gap (`no-interface` / `unrealizable` /
 * `awaiting-driver` / `blocked-on`) in both the report and the manifest.
 *
 * THE SETTLE INVARIANT binds every write: a flow that records its hash accounts for
 * each surface it PLANNED with a committed test XOR a gap. An entry that would
 * settle in silence stays unsettled with the reason recorded, and an entry already
 * violating it is treated as work (its hash disregarded) so the hole re-runs.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pLimit from 'p-limit'
import os from 'node:os'
import {
  auditTransport,
  cliTransport,
  formatStageFailure,
  type LlmTransport,
  type StageTransportTally,
  type TransportAudit,
} from '@truecourse/shared/llm'
import {
  writeManifest,
  readManifest,
  guardWorldDirtyMarkerPath,
  loadScenarios,
  readGuardDecisions,
  readGuardAutoResolutions,
  writeGuardAutoResolutions,
  mergeInterfaceLists,
  mergeRegistries,
  readAuthoredInterfaceCatalog,
  readMergedInterfaceCatalog,
  manifestPath,
  runBuild,
  DEFAULT_BUILD_TIMEOUT_MS,
  runInstall,
  resolveEntry,
  resolveApiServers,
  resolveWebSurface,
  credentialServers,
  buildRouteManifest,
  loadRecipe,
  loadDependencyCatalog,
  recipePath,
  preflightEntry,
  preflightBrowser,
  formatEntryPreflightError,
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
  createGuardSharedWorld,
} from '@truecourse/guard-runner'
import {
  DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER,
  autoResolutionKey,
  composeBlockedOnReason,
  dismissedClaimKey,
  firstInvalidMatchPattern,
  guardDriver,
  guardScenarioDrivers,
  driverRecipeKey,
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
  type GuardInterfacesReport,
  type GuardManifestFlow,
  type GuardManifestGap,
  type GuardManifestScenario,
  type GuardManifestRetiredScenario,
  settledScenariosOf,
  type GuardOrphanedDismissal,
  type GuardOrphanedFlowDismissal,
  type GuardRunRefusal,
  type GuardExpectedRed,
  type GuardFlowWorkerOutcome,
  type GuardScenario,
  type GuardScenarioResult,
  type GuardScenarioDiagnosis,
  type GuardTestStatus,
  type GuardUnadjudicatedStage,
  milestoneOrder,
  type Interface,
  type InterfaceResource,
} from '@truecourse/shared'
import {
  planGuardWork,
  collectWorkDocs,
  hasGuardUniverse,
  sectionInputsKey,
  flowGenerationInputsHash,
  type GuardDoc,
  type SectionInput,
} from './section-plan.js'
import { buildOperationIndex, matchedRequestSchemas, parseOperationSection, type OperationEntry } from './openapi-enrich.js'
import { persistExtractedClaims } from './claims-persist.js'
import {
  resolveSectionAuth,
  recipeAuthCredentials,
  validateCredentialSatisfies,
  type SatisfiedScheme,
} from './openapi-security.js'
import { parseOpenApiSpec } from '@truecourse/shared/openapi'
import {
  buildAuthorUserPrompt,
  buildFidelityUserPrompt,
  WORLD_CLASSIFY_PROMPT_FINGERPRINT,
  type AuthorMilestone,
  type AuthorUserContext,
  type InterfaceContractHint,
  type OutboundRequestHint,
  type ExternalServiceHint,
  type FidelityUserContext,
} from './prompts.js'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { WorldClassifySchema, type RawGeneratedScenario } from './schemas.js'
import { EMPTY_CLAIM_DIFF_GATE, docContentHash, rememberDocTexts, reuseCosmeticExtractions } from './claim-diff.js'
import {
  spawnRecipeRunner,
  spawnMatchRunner,
  spawnWorldClassifyRunner,
  spawnClaimDiffRunner,
  type RecipeRunner,
  type MatchRunner,
  type WorldClassifyRunner,
  type ClaimDiffRunner,
} from './runners.js'
import {
  isSystemicSessionLoss,
  type DocClaims,
  type ExtractResult,
  type ExtractSessionSeam,
  type ReuseExtractionSeam,
  type GuardSessionSummary,
} from './extract.js'
import {
  synthesizeFlows,
  isFlowSynthesisWipeout,
  buildFlowAreas,
  flowSectionKey,
  type FlowAreaDocInput,
  type FlowClaimInput,
  type FlowsAreaSessionSeam,
  type FlowsEpicSessionSeam,
  type FlowsSessionGrounding,
} from './flows.js'
import {
  buildSurfaceCatalogs,
  interfaceDigest,
  matchFlow,
  realizationLines,
  type RealizationPlan,
  type SurfaceCatalog,
} from './match.js'
import { groundProbes, type ProbeTranscript } from './ground.js'
import { scenarioCompositionDefect } from './validate.js'
import { mineExampleBlocks, exampleFidelityDefect, type DocExampleBlock } from './examples.js'
import { discoverRecipe } from './recipe-discovery.js'
import type { SeedDraftDatabase } from './seed-draft.js'
import { routesFromInterfaces } from './recipe-propose.js'
import { enrichBlockedOn } from './external-blocked.js'
import {
  buildInterfaceContractHints,
  buildOtherOperationHints,
  buildOutboundRequestHints,
  buildResourceHints,
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
  parseRawScenarioYaml,
  parseScenarioYaml,
  deleteScenarioFiles,
  scenarioFileIndex,
  existingScenarioIds,
} from './serialize.js'

/** Sentinel anchor for the single entry-preflight error — it belongs to no section. */
const ENTRY_PREFLIGHT_ANCHOR = '(entry preflight)'

/** One world-classify call covers at most this many flows — a single batched
 *  call over a whole corpus is the call most likely to time out, and a lost
 *  classification degrades the run's blast-radius protection. */
const WORLD_CLASSIFY_CHUNK_SIZE = 40

/** Phrases that mark a flow as a SUSPECT world-mutator when the classifier is
 *  unavailable — deliberately coarse (a false positive only serializes a flow;
 *  a false negative lets it poison the shared world). Matched against the
 *  flow's title and milestone titles, lowercased. */
const WORLD_MUTATION_SUSPECT_PHRASES = [
  'password',
  'credential',
  'revoke',
  'revoked',
  'deactivate',
  'delete account',
  'delete a user',
  'delete user',
  'deletes a user',
  'delete the account',
  'deletes the account',
  'remove user',
  'remove member',
  'change email',
  'changes email',
  'change username',
  'two-factor',
  '2fa',
  'sign-in method',
  'signin method',
  'instance config',
  'global config',
  'disable',
] as const

/** The fail-closed fallback for a lost classifier chunk: does the flow LOOK
 *  world-mutating? Exported for tests. */
export function looksWorldMutating(flow: { title: string; milestones: readonly string[] }): boolean {
  const text = [flow.title, ...flow.milestones].join(' ').toLowerCase()
  return WORLD_MUTATION_SUSPECT_PHRASES.some((phrase) => text.includes(phrase))
}

// ---------------------------------------------------------------------------
// Result + option types
// ---------------------------------------------------------------------------

/**
 * The generate pipeline's three SESSION steps, in pipeline order — what the
 * CLI's `--only-<step>` flags select (SPEC_GUARD_PLAN item 110, the `spec scan`
 * template). The fidelity judge is a depth-1 CHILD of a worker session, so it
 * has no step of its own; the deterministic stages between them (recipe load,
 * section planning, interface mapping, realization matching, the build) are not
 * steps either — they run as needed to feed the chosen one.
 */
export const GENERATE_SESSION_STEPS = ['extract', 'flows', 'worker'] as const
export type GenerateStep = (typeof GENERATE_SESSION_STEPS)[number]

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
  /** Of `sectionsChanged`, the sections whose edit the claim-diff gate judged
   *  cosmetic: their document's prior extraction was reused and no flow
   *  re-authored for them. Absent on the abort results. */
  cosmeticSections?: number
  /** Live claim-diff gate calls this run made (cache hits excluded). */
  claimDiffCalls?: number
  /** Prior scenarios editing workers deliberately dropped this run, with the
   *  vanished obligation each named (also persisted on the manifest flow). */
  retiredScenarios?: (GuardManifestRetiredScenario & { flowId: string })[]
  /** True when no flow needed work and none was removed — the confirm/run was a no-op. */
  noChanges: boolean
  /** Every test committed this run, passing and failing alike. */
  written: GeneratedScenarioInfo[]
  coverageGaps: GuardCoverageGap[]
  /** The birth-stage failure results: the committed failing tests
   *  (repo-blamed or untriaged), plus the withheld classes — generation-defect
   *  verdicts and fidelity rejections. For a fresh run, `written('failing').length
   *  === birthFindings committed rows` — the routing's arithmetic identity. */
  birthFindings: GuardBirthFinding[]
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
   * The ADJUDICATION stages (`guard.fidelity` / `guard.triage`) that lost EVERY
   * call, so part of this corpus shipped with no verdict about it — green tests
   * persisted unreviewed, red tests committed untriaged. Carved out of the
   * `llm-failed` abort on purpose (see the adjudication carve-out in
   * {@link generateGuards}); this row is what keeps that carve-out LOUD. Empty when
   * every verdict landed.
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
   * human task. EMPTY on the session path (worker retirements are recorded via
   * ledger + taint + the unsettled flow instead); kept for report-schema
   * compatibility and the pre-session `result.json` files that carry rows.
   */
  autoResolved: GuardAutoResolved[]
  /** The flow-led counts — the run's headline under flow-keyed generation. */
  flows: GuardFlowsReport
  /** The interface catalog the run matched against. */
  interfaces: GuardInterfacesReport
  /**
   * The third parties this repo imports — the whole detected list, not
   * only the ones a blocked flow named, so a reader sees "this repo talks to stripe
   * and sendgrid" independently of whether any flow was blocked. Empty when nothing
   * was detected OR when interface mapping degraded to the snapshot.
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
   * Present ONLY when the runner REFUSED a validation round (a broken recipe, a
   * half-configured external account, a dead world) — the latch then declined
   * every LATER round, with ONE run-level error, never one per candidate.
   * Scenarios that settled BEFORE the latch are real: each passed its own
   * confirmation run and was written (`written` counts them), so `status` stays
   * `'ok'` and readers must surface THIS field to tell a refused run from a
   * clean one. The refused flows' authoring is cached — a re-run resumes them.
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
  /**
   * Set in single-step mode ({@link GenerateGuardsOptions.only}) when the run
   * stopped BEFORE the final step: the named step ran, later steps never
   * started, and NOTHING durable was written — no scenario file, no
   * `scenarios/manifest.json`, no `scenarios/flows.json`, no
   * `guard/auto-resolutions.json` (and the command adapter writes no
   * `guard/result.json`). Absent on a completed generate, including
   * `only: 'worker'`, which runs through every write.
   */
  stoppedAfter?: GenerateStep
}

/**
 * The models of the two ONE-SHOT stages that remain (recipe discovery and
 * realization matching). Every session stage runs on the ONE configured session
 * model (§3.4) — there is no per-stage tier for them, by decision.
 */
export interface GuardGenerateModels {
  /** Realization matching (stage `guard.match`). */
  match?: string
  recipe?: string
  fallback?: string
}

/**
 * Where the interface catalog comes from. Mapping needs the ANALYZER, which lives
 * above this package, so the caller injects it (core's `mapInterfaces`). Omitted, the
 * generator falls back to the last mapping's snapshot and then to an empty catalog:
 * degradation is defined, never inherited — an empty surface settles as an honest
 * `no-interface` gap instead of failing the spec half of the pipeline.
 */
export type InterfaceProvider = () => Promise<{
  interfaces: Interface[]
  /**
   * The catalog's RESOURCE registry, per area — the places the interfaces'
   * location contract (`at`/`to`) points into, readables included. Rides this
   * seam so the authoring prompt can ground web assertions in what each place
   * really shows. Omitted (an older provider, a catalog naming none) renders
   * no PLACES block, exactly as before the registry existed.
   */
  resources?: Record<string, InterfaceResource[]>
  /**
   * The repo's detected third-party dependencies. Derived from the SAME
   * analysis pass as the interfaces — a pure read of the analyzer's import registry —
   * so it rides this seam rather than opening a second one that would re-analyze the
   * tree. Omitted (a provider that predates it, or the snapshot fallback) reads as
   * "not detected": every blocked-on reason keeps its generic noun.
   */
  externalServices?: DetectedExternalService[]
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
   * How the app constructs its OUTBOUND requests and which response fields it reads
   * back. What a `setup.http` stub must satisfy to be accepted by the app
   * it fakes for. Omitted ⇒ no outbound block, as before this grounding existed.
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
  /** Interface mapping seam — see {@link InterfaceProvider}. */
  interfaces?: InterfaceProvider
  /** Test seam for the web-browser preflight; production checks the real machine. */
  browserPreflight?: typeof preflightBrowser
  /**
   * The hard gate: refuse to run without a committed `recipe.json` instead of
   * deriving one. TRUE on every working-tree path (`truecourse guard setup` owns
   * derivation now); FALSE on the hosted/EE ephemeral-checkout paths, which have no
   * user to run setup and must stay self-sufficient. Defaults to false so the engine
   * is unchanged for any caller that does not opt in.
   */
  requireExistingRecipe?: boolean
  /**
   * INTERNAL test seam: stop after flow synthesis, before interface matching and
   * authoring. Not a user-facing option and not exposed by any command — flow
   * curation is `dismissedFlows` and cost control is the estimate gate.
   */
  stopAfterFlows?: boolean
  /**
   * SINGLE-STEP MODE (the CLI's `--only-<step>` flags): run only this session
   * step. Steps BEFORE it replay from their outcome caches — the SEAMS enforce
   * that (a miss throws `GenerateStepNotReadyError` in `@truecourse/core`
   * rather than silently spending the prior step's sessions); steps AFTER it
   * never start; and every durable write is gated on the FINAL step (`worker`)
   * running, so an earlier stop leaves the scenario corpus, `flows.json` and
   * the manifest exactly as they were and returns {@link
   * GuardGenerateResult.stoppedAfter}. The deterministic stages that feed the
   * chosen step (section planning, interface mapping, matching, the build) run
   * as needed.
   */
  only?: GenerateStep
  // --- the session seams (plan 04) — REQUIRED since the one-shot stage
  // retirement (step 20): they are THE extract / flows / author-adjudicate
  // paths. Injected by `@truecourse/core` (the engine cannot depend on it);
  // tests inject stubs.
  /** The claim-extraction session seam (`guard-generate.extract`, one session per doc). */
  extractSession: ExtractSessionSeam
  /** The per-area flow-synthesis session seam (`guard-generate.flows`). */
  flowsAreaSession: FlowsAreaSessionSeam
  /** The epic-pass session seam (one session over the flow digests). */
  flowsEpicSession: FlowsEpicSessionSeam
  /**
   * The flow-worker session seam (plan 04 steps 17 + 18): one
   * `guard-generate.flow-worker` session per (flow, surface with a plan), with
   * the fidelity judge as its depth-1 child. The worker loop IS the whole
   * author→adjudicate path (the one-shot author / birth-retry / fidelity /
   * triage stages are retired — plan 04 step 20); match, birth machinery
   * (inside the tools), persist and the settle invariant are unchanged.
   */
  flowWorkerSession: FlowWorkerSessionSeam
  // --- test seams for the two remaining one-shot stages (production injects
  // none; an injected runner bypasses the transport) ---
  recipeRunner?: RecipeRunner
  matchRunner?: MatchRunner
  /** Test seam for the batched world classification; production spawns it on
   *  the shared transport (see {@link spawnWorldClassifyRunner}). */
  worldClassifyRunner?: WorldClassifyRunner
  /** Test seam for the claim-diff gate's verdict call; production spawns it on
   *  the shared transport (see {@link spawnClaimDiffRunner}). */
  claimDiffRunner?: ClaimDiffRunner
  /**
   * The claim-diff gate's access to the extract cache (prior-outcome lookup +
   * reuse). Absent, the gate is skipped and every edited document re-extracts
   * and re-authors as before — the seam belongs to whoever owns the extraction
   * cache (core's session seams), so an injected `extractSession` with no
   * matching seam runs gate-less.
   */
  reuseExtraction?: ReuseExtractionSeam
  /**
   * The incremental-authoring escape hatch: re-author every changed flow from
   * scratch instead of briefing its committed scenarios for editing. Flows whose
   * milestone composition changed, and tainted flows, author from scratch
   * regardless.
   */
  fromScratch?: boolean
  // --- progress hooks ---
  onPlan?: (total: number, work: number) => void
  /** Extraction progress, ticking per settled doc session (cache hits included). */
  onExtractProgress?: (done: number, total: number) => void
  /** Interface mapping settled: how many interfaces were derived, across all surfaces. */
  onInterfaces?: (interfaces: number, surfaces: number) => void
  /** Flow synthesis progress, ticking per area as it settles. */
  onFlowProgress?: (done: number, total: number) => void
  /** Realization-matching progress, ticking per (flow, surface) pair. */
  onMatchProgress?: (done: number, total: number) => void
  /**
   * Flow-worker pool progress: `done`/`total` worker sessions settled (cache
   * hits included) plus the running settled/blocked outcome tallies — what the
   * CLI renders as `workers a/b · settled n · blocked m`.
   */
  onWorkerProgress?: (progress: { done: number; total: number; settled: number; blocked: number }) => void
  /** Grounding probe progress — captured vs planned probes across the worker
   *  briefings; the planned total grows as later flows enter grounding. */
  onGroundProgress?: (captured: number, planned: number) => void
  /** Build phase transition. Only `'build'` fires now — the recipe build that
   *  precedes the worker pool; every execution happens inside the worker tools.
   *  The wider signature is kept so the runner's own phase type still fits. */
  onBirthPhase?: (phase: 'build' | 'run' | 'confirm', total?: number) => void
  /** Per-FLOW settle progress: `total` = the flows this run had work for. */
  onFlowSettled?: (settled: number, total: number) => void
}

function defaultConcurrency(): number {
  const env = process.env.TRUECOURSE_MAX_CONCURRENCY
  if (env) {
    const n = parseInt(env, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return Math.min(os.cpus().length, 4)
}

/**
 * The per-(flow, surface) cache-key recipe of the flow-worker session (plan 04
 * step 17) — the retired one-shot `authorCacheKey`'s exact structure, with the
 * prompt fingerprint passed in. The key moves when the flow's milestone
 * composition changes, when any bound section's content key moves (text, a
 * suppressed quote, a referenced OpenAPI schema, its security context), when the
 * realization plan's interfaces move, when the recipe or the format version
 * changes, or when the session prompt changes. Nothing else re-authors.
 * Exported for `@truecourse/core`, which owns the session prompts and therefore
 * computes the keys (cache name `guard/generate`, kept from the one-shot stage).
 */
export function workerCacheKey(
  promptFingerprint: string,
  flow: Pick<GuardFlow, 'fingerprint'>,
  surface: GuardDriverId,
  sectionKeys: readonly string[],
  interfaceFingerprints: readonly string[],
  recipeFingerprint: string,
  edit?: { priorShas: readonly string[] },
): string {
  const parts = [
    promptFingerprint,
    recipeFingerprint,
    surface,
    flow.fingerprint,
    [...sectionKeys].sort().join('~'),
    [...interfaceFingerprints].sort().join('~'),
  ]
  // Edit mode appends the briefed priors; absent, the key is byte-identical to
  // the from-scratch recipe, so committed entries keep hitting.
  if (edit) parts.push('edit', [...edit.priorShas].sort().join('~'))
  return createHash('sha256').update(parts.join('::')).digest('hex')
}

// ---------------------------------------------------------------------------
// The FLOW-WORKER session seam (plan 04 steps 17 + 18). Typed here because the
// engine cannot depend on `@truecourse/core`, which owns the sessions; the
// command adapter injects the implementation (the extract/flows seam pattern).
//
// The split of the two halves, exactly:
//  - the ENGINE (this package) owns everything deterministic about one task —
//    the briefing (today's `buildAuthorCtx` payload, verbatim sourcing), the
//    det pre-flight checkers, the per-candidate birth execution, the
//    red-prediction done-gate, the accepted-yaml STASH, and the ledger/finding
//    bookkeeping. Each {@link FlowWorkerTask} closes over that.
//  - CORE owns everything session-shaped — the system prompts, the pool, the
//    `guard/generate` cache (key = {@link workerCacheKey} with the session
//    prompt fingerprint), and the depth-1 fidelity CHILD (`ctx.dispatchChild`),
//    which it hands the engine as the {@link WorkerFidelityJudge} argument of
//    `submitScenario`.
// ---------------------------------------------------------------------------

/** A rendered tool result the engine half hands back — mirrors the loop's
 *  `SessionToolResult` without importing the agent-loop package. */
export interface FlowWorkerToolReport {
  content: string
  isError?: boolean
}

/** What core needs to build a fidelity child's cache key and briefing —
 *  everything here is engine-derived, so the child grounds on the same
 *  material the one-shot reviewer did. */
export interface WorkerFidelityInput {
  flowFingerprint: string
  /** The flow's bound section content keys (the fidelity key's section half). */
  sectionKeys: readonly string[]
  /** The scenario's BEHAVIORAL identity — the same JSON `scenarioBehavior`
   *  string the one-shot fidelity cache keyed on. */
  scenarioBehavior: string
  /** The child's opening message: claims + section texts, the candidate yaml,
   *  and the confirmation capture — rendered by the engine. */
  briefing: string
}

export type WorkerFidelityVerdict =
  | { kind: 'faithful' }
  | { kind: 'flagged'; mismatch: string; confidence: 'high' | 'medium' | 'low' }
  /** The child session (or its dispatch) failed — the green is accepted
   *  UNREVIEWED and the run reports the stage unadjudicated (the item-88
   *  carve-out's trade: annotation, not correctness). */
  | { kind: 'unavailable'; reason: string }

/** Core's fidelity judge: cache hit → verdict; miss → one depth-1 child session. */
export type WorkerFidelityJudge = (input: WorkerFidelityInput) => Promise<WorkerFidelityVerdict>

/** The key material core folds (with its own prompt fingerprint) into
 *  {@link workerCacheKey} — every behavior-affecting input, nothing else. */
export interface FlowWorkerCacheMaterial {
  flowFingerprint: string
  sectionKeys: readonly string[]
  interfaceFingerprints: readonly string[]
  recipeFingerprint: string
  /** `edit` when the briefing carries the flow's committed scenarios to edit;
   *  `scratch` otherwise (the key then matches every pre-edit-mode entry). */
  mode: 'scratch' | 'edit'
  /** sha256 of each briefed prior yaml (edit mode; empty for scratch). */
  priorShas: readonly string[]
}

/** One (flow, surface) work unit of the worker pool — engine closures inside. */
export interface FlowWorkerTask {
  /** `flow:<id>:<surface>` — the session index / transcript work item. */
  workItem: string
  flowId: string
  surface: GuardDriverId
  /** True for an epic flow (composed of member flows) — pooled in the SECOND
   *  wave, after every member settled, so its briefing can carry their
   *  scenarios read-only. */
  epic: boolean
  /** How many distinct milestones the task's realization plan realizes — a
   *  scenario must carry a step per milestone to clear the engine pre-flight,
   *  so a seam (or a test stub) can build a passing draft without re-deriving
   *  the plan. */
  milestoneCount: number
  /** The prior-rejection taint, when the ledger carries one — core SKIPS the
   *  cache read (the entry still holds the rejected scenario) and the briefing
   *  already carries the mismatch as `priorFlag`. */
  taint?: { title: string; mismatch: string }
  /** Edit mode: the flow's committed scenarios on this surface, briefed for
   *  editing (`submit_scenario` with `replaces`, `drop_scenario`). Absent on a
   *  from-scratch author. */
  prior?: { scenarios: readonly { id: string; yaml: string }[] }
  cacheMaterial: FlowWorkerCacheMaterial
  /**
   * Render the briefing — today's `buildAuthorCtx` payload through
   * `buildAuthorUserPrompt`, plus (epics) the members' settled scenarios.
   * Async because cli briefings capture ground probes; core awaits it only for
   * cache MISSES, immediately before the wave's pool starts.
   */
  prepare(): Promise<string>
  /** The `run_scenario` engine half: det pre-flight (a defect returns isError
   *  WITHOUT execution), then one fresh-sandbox birth run, then the condensed
   *  result. Never writes repo/store state. */
  runScenario(yaml: string): Promise<FlowWorkerToolReport>
  /** The `submit_scenario` engine half — the done-gate: confirmation run in a
   *  fresh sandbox, the fidelity child (via `judge`) on a green, the
   *  red-prediction gate on a red; acceptance stashes the yaml + result
   *  engine-side and names the sha the outcome must reference. */
  submitScenario(
    yaml: string,
    expectedReds: readonly GuardExpectedRed[],
    judge: WorkerFidelityJudge,
    /** Edit mode: the prior scenario id this submission replaces (keeps the id);
     *  omitted ⇒ a new scenario. Refused outside edit mode. */
    replaces?: string,
  ): Promise<FlowWorkerToolReport>
  /** The `drop_scenario` engine half (edit mode): record that a briefed prior
   *  scenario's obligation vanished; persist deletes it and the manifest
   *  retires it with the reason. Refused for an id the briefing did not carry. */
  dropScenario(id: string, reason: string): FlowWorkerToolReport
  /** The ids `dropScenario` accepted so far — the fold cross-checks the
   *  outcome's `droppedScenarios` against them. */
  droppedIds(): string[]
  /** Whether an accepted submission with this sha is in the engine stash — the
   *  reject gate for a `settled` outcome referencing nothing. */
  hasStash(sha: string): boolean
  /** The stashed accepted yaml for the sha — what core writes into the cache
   *  entry beside a settled outcome. Returns undefined (⇒ core writes NO
   *  entry) for a green that was accepted with its fidelity review
   *  unavailable: an unreviewed green must not become a cache hit. */
  stashedYaml(sha: string): string | undefined
  /**
   * Verify a CACHED settled outcome against the live world: parse the cached
   * yaml, re-run it once in a fresh sandbox, and check the outcome against the
   * cached `expectedReds` (green ⇔ none declared; a red must reproduce every
   * prediction). True re-stashes every candidate so the fold finds them; false
   * means world drift on ANY of them — core treats the entry as a MISS and
   * runs the session. One element for a legacy entry; several for an edit-mode
   * settle.
   */
  confirmCached(scenarios: readonly { yaml: string; expectedReds: readonly GuardExpectedRed[] }[]): Promise<boolean>
}

/** One task's result as the seam reports it back for the engine's routing. */
export type FlowWorkerSessionResult =
  | { kind: 'outcome'; outcome: GuardFlowWorkerOutcome; fromCache?: boolean }
  | { kind: 'failed'; reason: string }

/**
 * The flow-worker session seam: pool wave 1 (`tasks`), then wave 2
 * (`epicTasks`) — a true barrier, so an epic worker's briefing sees its
 * members' settled scenarios. Cache-aware per task (`guard/generate` kept);
 * a cached settled outcome is re-confirmed through `confirmCached` before it
 * counts as a hit. `fidelitySummary` tallies the depth-1 fidelity children.
 */
export type FlowWorkerSessionSeam = (input: {
  tasks: readonly FlowWorkerTask[]
  epicTasks: readonly FlowWorkerTask[]
  /**
   * Wave 3: the flows the world classifier judged WORLD-MUTATING (credential
   * changes, account deletion, session revocation, global config). Run LAST and
   * SERIALIZED — one session at a time — so a destructive draft executes only
   * after every shared-world sibling has settled; the engine restores the world
   * after the wave.
   */
  mutatorTasks: readonly FlowWorkerTask[]
  /** The run's doc universe — the fidelity child's `read_claim_section` set. */
  docs: readonly GuardDoc[]
  /** Ticks once per settled task (cache hits included), carrying the task's
   *  outcome kind (`'failed'` for a failed session) so the caller can render a
   *  live `settled n · blocked m` tally beside the `done/total` counter. */
  onTask?: (done: number, total: number, outcome?: GuardFlowWorkerOutcome['kind'] | 'failed') => void
}) => Promise<{
  byTask: Map<string, FlowWorkerSessionResult>
  summary: GuardSessionSummary
  fidelitySummary?: GuardSessionSummary
}>

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function generateGuards(options: GenerateGuardsOptions): Promise<GuardGenerateResult> {
  const { repoRoot } = options
  // Birth validation runs through the injected execution seam (OSS in-process by
  // default); the recipe is the discovered/loaded one below, passed IN so the
  // executor never re-reads recipe.json.
  const executor = options.executor ?? defaultGuardExecutor
  // ONE prepared world for the whole run (see guard-runner's shared-world.ts):
  // every sandbox and birth round consumes the same booted services + seed, so
  // their lifecycles cannot race on the recipe's singleton compose project.
  // Inert until the first execution needs it; shut down before every exit of
  // the worker phase (the item-94 teardown channel backstops crashes).
  const sharedWorld = createGuardSharedWorld()
  // ONE counting seam for the transport half of the run: the two remaining
  // one-shot runners (recipe, match) are spawned on the WRAPPED transport, so
  // attempts and failures are accounted centrally instead of at each fail-soft
  // site. The session stages never touch the transport — their losses are
  // tallied from the seam summaries (`sessionTallies` below). A test that
  // injects a runner bypasses the transport entirely: that stage records no
  // attempts, which is correct — the tally answers "did this stage reach the
  // model", nothing else.
  const audit = auditTransport(options.transport ?? cliTransport())
  const transport = audit.transport

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
  // Interface mapping is memoized: the deterministic recipe proposer ranks its health
  // path over the SAME route surface stage 4 walks, so a repo with no recipe maps
  // its interfaces once, earlier — never twice.
  let mappedInterfaces: Promise<MappedSurface> | null = null
  const interfacesOnce = (): Promise<MappedSurface> => (mappedInterfaces ??= mapInterfacesSafely(repoRoot, options.interfaces))

  const recipeResult = await discoverRecipe(repoRoot, recipeRunner, {
    routes: async () => routesFromInterfaces((await interfacesOnce()).interfaces),
    // The datastore half of the SAME memoized pass — read only when a boot
    // verification failed, so the failure can name the dependency it died on.
    database: async () => {
      const db = (await interfacesOnce()).database
      return db ? { type: db.type, driver: db.driver } : null
    },
    // The connection URLs the SAME pass harvested: with no compose file in the
    // repo, the proposer derives one from them.
    datastores: async () => (await interfacesOnce()).datastoreUrls,
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
  const matchRunner =
    options.matchRunner ??
    spawnMatchRunner({ transport, model: options.models?.match, fallbackModel: options.models?.fallback })
  const worldClassifyRunner =
    options.worldClassifyRunner ??
    spawnWorldClassifyRunner({ transport, model: options.models?.match, fallbackModel: options.models?.fallback })
  const claimDiffRunner =
    options.claimDiffRunner ??
    spawnClaimDiffRunner({ transport, model: options.models?.match, fallbackModel: options.models?.fallback })

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
  // The auto-resolved rows the report carries. PERMANENTLY EMPTY on the session
  // path: a worker retirement is recorded through the ledger bump + the taint +
  // the unsettled flow instead of a report row (the reported deviation from the
  // one-shot path — whether workers should populate this is a user decision
  // routed separately). Kept only for report-schema compatibility
  // (`GuardAutoResolvedSchema` and its readers are unchanged).
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

  // THE CLAIM-DIFF GATE: an edited document whose every changed section still
  // states the same obligations keeps its PRIOR extraction (copied under its
  // new cache key, so the pool below hits) — no session, no reworded claims, and
  // the flows bound to those sections are spared a re-author further down (the
  // per-flow gate substitutes the prior fingerprints). Fail closed: no seam, no
  // recorded prior, a new or vanished section, or one `changed` verdict leaves
  // the document to extraction exactly as before.
  // Every document's text, remembered under its content hash: the next
  // generate's gate reads an edited document's OLD text from here.
  await rememberDocTexts(repoRoot, docs)
  const claimDiff = options.reuseExtraction
    ? await reuseCosmeticExtractions({
        repoRoot,
        docs,
        priorManifest: readManifest(repoRoot),
        seam: options.reuseExtraction,
        runner: claimDiffRunner,
      })
    : EMPTY_CLAIM_DIFF_GATE
  for (const message of claimDiff.errors) errors.push({ doc: '', anchor: '', message })

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

  // Session-kind failure tallies (plan 04): the session seams never pass through
  // the transport audit, so their per-kind losses are appended to every
  // `llmFailures` list this run reports (fail-open stays visible either way).
  const sessionTallies: StageTransportTally[] = []
  const recordSessionSummary = (s: GuardSessionSummary): void => {
    if (s.failed > 0) {
      sessionTallies.push({
        stage: s.kind,
        attempts: s.ran,
        failures: s.failed,
        ...(s.firstError ? { firstError: s.firstError } : {}),
      })
    }
  }
  /** The head line for a session kind that lost EVERY session (transport-class). */
  const sessionLossHead = (s: GuardSessionSummary): string =>
    `every session of the \`${s.kind}\` kind failed (${s.failed} of ${s.ran})${s.firstError ? `. First failure: ${s.firstError}` : ''}`

  // One `guard-generate.extract` session per doc (plan 04 step 15), pooled +
  // cached by the seam; the seam's fold already re-snapped every anchor.
  // Fail-open per doc — a doc with no (or a failed) result lands in
  // `extractionFailures` below.
  let extractSystemicLoss: GuardSessionSummary | null = null
  const { byDoc: extractByDoc, summary: extractSummary } = await options.extractSession({
    docs,
    onDoc: (done, total) => options.onExtractProgress?.(done, total),
  })
  recordSessionSummary(extractSummary)
  if (isSystemicSessionLoss(extractSummary)) extractSystemicLoss = extractSummary
  const extracted: { doc: (typeof docs)[number]; result: ExtractResult }[] = docs.map((doc) => ({
    doc,
    result: extractByDoc.get(doc.doc) ?? { ok: false, reason: 'the extraction session produced no result for this doc' },
  }))

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
        live.push({
          doc: s.doc,
          anchor: s.anchor,
          title: c.claim,
          driver: c.driver,
          // The extraction session's structured needs ride into flow synthesis
          // (plan 04 step 15 → 16); the one-shot path carries none.
          ...(c.needs && c.needs.length > 0 ? { needs: c.needs } : {}),
        })
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
  if (audit.isSystemicFailure('guard.extract') || extractSystemicLoss) {
    return llmFailedResult(
      audit,
      'guard.extract',
      {
        recipe: recipeMeta,
        recipeFingerprint,
        sectionsTotal: plan.sections.length,
        sectionsChanged: plan.work.length,
        skippedUnchanged: plan.sections.length - plan.work.length,
        coverageGaps,
        errors,
        extractionFailures,
        orphaned: orphanedSections,
        llmFailures: [...audit.failures(), ...sessionTallies],
      },
      // On the session path the transport tally saw nothing — the session
      // summary is the loss record, and its head line takes the tally's place.
      extractSystemicLoss ? sessionLossHead(extractSystemicLoss) : undefined,
    )
  }

  // Orphan honesty: a dismissal whose doc was extracted but whose claim text matched
  // no live claim is stale — surfaced so it is never silently honored.
  const orphanedDismissals: GuardOrphanedDismissal[] = decisions.dismissedClaims
    .filter((d) => extractedDocs.has(d.doc) && !extractedClaimKeys.has(dismissedClaimKey(d.doc, d.anchor, d.title)))
    .map((d) => ({ doc: d.doc, anchor: d.anchor, title: d.title }))

  // Single-step early return (`--only-extract`): the extraction pool ran (or
  // replayed), and nothing downstream starts — not even the free interface
  // mapping below. No corpus file is touched; the step's durable artifact is
  // its own outcome cache, which the next step replays from.
  if (options.only === 'extract') {
    return {
      status: 'ok',
      recipe: recipeMeta,
      recipeFingerprint,
      sectionsTotal: plan.sections.length,
      sectionsChanged: plan.work.length,
      skippedUnchanged: plan.sections.length - plan.work.length,
      // A warm re-run of this step spends nothing and has nothing to report.
      noChanges: extractSummary.ran === 0,
      written: [],
      coverageGaps,
      birthFindings: [],
      errors,
      extractionFailures,
      llmFailures: [...audit.failures(), ...sessionTallies],
      unadjudicated: [],
      orphaned: orphanedSections,
      birthPassed: 0,
      orphanedDismissals,
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
      interfaces: { total: 0, bySurface: {} },
      externalServices: [],
      stoppedAfter: 'extract',
    }
  }

  // Persist what extraction minted BEFORE synthesis writes the flows naming it —
  // a flow referencing a claim `scenarios/claims.json` does not hold is a load
  // error on every `guard run` (see claims-persist.ts). Additive-only, and a
  // warm re-run adds nothing, so nothing is written on a no-op.
  persistExtractedClaims(
    repoRoot,
    extracted.flatMap(({ doc, result }) => (result.ok ? [{ doc: doc.doc, outcome: result.data }] : [])),
  )

  // 4. Interfaces — deterministic, free, and independent of everything spec-side.
  const mapped = await interfacesOnce()
  const catalog = mapped.interfaces
  // The repo's own third-party dependencies, from the same pass. They name
  // the third party in an api authoring prompt and in every blocked-on gap reason.
  const externalServices = mapped.externalServices
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
  // The code-truth grounding. The inbound half needs no plumbing at all: what a
  // handler reads off the request lives ON its operation in the catalog (plan
  // item 102), so it is read per flow from the interfaces the plan walks. The
  // outbound half is repo-level and capped here, once.
  const outboundRequestHints = buildOutboundRequestHints(mapped.outboundRequests, externalServices)
  const outboundRequestsOverflow = outboundOverflow(mapped.outboundRequests)
  const catalogs = buildSurfaceCatalogs(catalog)
  // The WHOLE api surface, so a flow can reach for the operations it does
  // not itself walk when a SETUP step needs one (sign up, then sign in, then test
  // favorites). Empty for a repo with no api interfaces — the block simply renders not.
  const apiInterfaces = catalogs.get('api')?.interfaces ?? []
  // The counts describe what this run GROUNDED ON — the surface catalogs, not the
  // catalog file — which is why the total is their sum. They are read when flows
  // settle unrealized, and an entry the matcher never sees (an RPC-derived
  // operation, item 12) counted there would answer that question wrong.
  const bySurface = [...catalogs].map(([surface, c]) => [surface, c.interfaces.length] as const)
  const total = bySurface.reduce((sum, [, count]) => sum + count, 0)
  options.onInterfaces?.(total, catalogs.size)
  const interfacesReport: GuardInterfacesReport = {
    total,
    bySurface: Object.fromEntries(bySurface),
  }

  // 5. Flow synthesis — the spec-side generation unit, as `guard-generate.flows`
  // sessions (plan 04 step 16). The briefings carry interface digests + the
  // dependency catalog as grounding — read off the surface catalogs, which
  // already exclude procedure-bearing api interfaces (item 12,
  // `buildSurfaceCatalogs`), so no tRPC-derived operation ever enters a
  // synthesis briefing.
  const areas = buildFlowAreas(areaInputs)
  const flowsGrounding: FlowsSessionGrounding = {
    interfaces: [...catalogs].map(([surface, c]) => ({
      surface,
      digests: c.interfaces.map(interfaceDigest),
    })),
    dependencies: loadDependencyCatalog(repoRoot).dependencies.map((e) => ({ name: e.name, class: e.class })),
  }
  let areasDone = 0
  options.onFlowProgress?.(0, areas.length)
  const synthesis = await synthesizeFlows({
    repoRoot,
    areas,
    areaSession: options.flowsAreaSession,
    epicSession: options.flowsEpicSession,
    sessionGrounding: flowsGrounding,
    sessionDocs: docs,
    sectionFingerprints: new Map(plan.sections.map((s) => [flowSectionKey(s.doc, s.anchor), s.fingerprint])),
    // `flows.json` is a durable output, so single-step mode writes it only when
    // the FINAL step runs — `--only-flows` computes the corpus, caches the
    // sessions that produced it, and leaves the committed file alone.
    ...(options.only !== undefined && options.only !== 'worker' ? { write: false } : {}),
    onArea: () => options.onFlowProgress?.(++areasDone, areas.length),
  })
  const flowsSessionLoss = (synthesis.sessionSummaries ?? []).find(isSystemicSessionLoss)
  for (const summary of synthesis.sessionSummaries ?? []) recordSessionSummary(summary)

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
  if (audit.isSystemicFailure('guard.flows') || flowsSessionLoss || flowsWipeout) {
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
      llmFailures: [...audit.failures(), ...sessionTallies],
    }
    // Precedence mirrors the predicates: a transport wipeout's own tally is the
    // head; a session-kind wipeout states its summary (the transport audit saw
    // nothing); an answered-but-unusable loss states the unusable-output reason.
    const head = audit.isSystemicFailure('guard.flows')
      ? undefined
      : flowsSessionLoss
        ? sessionLossHead(flowsSessionLoss)
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

  const priorManifest = readManifest(repoRoot)
  const priorFlows = new Map((priorManifest?.flows ?? []).map((f) => [f.flowId, f]))
  // Carried into the final manifest write when a degraded run cannot re-judge
  // the whole universe — see writeWorkingManifest.
  const priorGapSections = priorManifest?.gapSections
  // A generationInputsHash that is not a real computed hash (a hand-stamped
  // sentinel from a staged corpus) can never match, so its flow re-authors on
  // EVERY generate — silently. Say so once per run; settling writes the real
  // one. Orphaned entries are inert carry-forwards (no live flow looks them
  // up), so they never re-author and never warrant the warning.
  const sentinelHashes = [...priorFlows.values()].filter(
    (f) =>
      !f.orphaned &&
      typeof f.generationInputsHash === 'string' &&
      !/^sha256:[0-9a-f]{64}$/.test(f.generationInputsHash),
  ).length
  if (sentinelHashes > 0) {
    console.warn(
      `[guard] ${sentinelHashes} manifest flow(s) carry a non-computed generationInputsHash (hand-stamped?) — they will re-author every generate until they settle with a real hash.`,
    )
  }

  // C-LITE ARRANGE REUSE: the committed corpus's PASSING scenarios, indexed by
  // the interfaces they walk. A worker's briefing injects up to
  // SIBLING_BRIEFING_MAX of them (by interface overlap with its own plan) so
  // arranging is copy-and-parameterize from proven neighbours — the sign-in
  // that works, the record-creation calls that work — instead of per-session
  // rediscovery. Green-only: a failing scenario's verbs prove nothing.
  const siblingIndex = buildSiblingIndex(repoRoot, priorFlows)

  // The flows stop — the internal `stopAfterFlows` test seam and single-step
  // mode's `--only-flows` share it: everything spec-side ran, nothing was
  // written (single-step mode also suppressed the `flows.json` write above).
  if (options.stopAfterFlows || options.only === 'flows') {
    return {
      status: 'ok',
      recipe: recipeMeta,
      recipeFingerprint,
      sectionsTotal: plan.sections.length,
      sectionsChanged: plan.work.length,
      skippedUnchanged: plan.sections.length - plan.work.length,
      // Single-step mode: a warm re-run of the step spends nothing on either
      // the replayed extraction or this step's own sessions.
      noChanges: options.only === 'flows' && extractSummary.ran === 0 && synthesis.calls === 0,
      written: [],
      coverageGaps,
      birthFindings: [],
      errors,
      extractionFailures,
      llmFailures: [...audit.failures(), ...sessionTallies],
      // The run stops before birth, so neither adjudication stage ever ran.
      unadjudicated: [],
      orphaned: orphanedSections,
      birthPassed: 0,
      orphanedDismissals,
      orphanedFlowDismissals,
      autoResolved: [],
      flows: flowsReport,
      interfaces: interfacesReport,
      externalServices,
      ...(options.only === 'flows' ? { stoppedAfter: 'flows' as const } : {}),
    }
  }

  // 6. Match — one (cached) verdict per (flow, surface). The surfaces a flow is
  // accounted for are the runnable ones the recipe prepares, plus any surface the
  // catalog detected: a mapped-but-unrunnable surface is honest coverage
  // accounting ("realizable on web — awaiting the web driver"), not silence.
  const surfaces = accountedSurfaces(recipe, catalogs)
  /** One flow's match outcome, folded back in flow order (item 134). */
  interface FlowMatchResult {
    work?: FlowWork
    errors: GuardGenerateError[]
    matchCalls: number
    matchCallErrors: number
    firstMatchError: string | undefined
  }

  const works: FlowWork[] = []
  const matchPairs = liveFlows.length * surfaces.filter((s) => matchable(s, recipe, catalogs)).length
  let matchDone = 0
  // Match outcomes, for the total-loss abort after the loop. A cache HIT makes no
  // call and is counted nowhere; an `unrealizable` verdict is an ANSWER, not a loss.
  let matchCalls = 0
  let matchCallErrors = 0
  let firstMatchError: string | undefined
  if (matchPairs > 0) options.onMatchProgress?.(0, matchPairs)

  /**
   * ONE flow's realization: the surface gates, the (paid) match calls, and the
   * settle bookkeeping. Pure with respect to the run — every shared counter is
   * accumulated LOCALLY and folded back in FLOW order below, so running these
   * concurrently cannot reorder a gap, an error, or the works list (item 134).
   */
  const processFlow = async (flow: GuardFlow): Promise<FlowMatchResult> => {
    const localErrors: GuardGenerateError[] = []
    let localMatchCalls = 0
    let localMatchCallErrors = 0
    let localFirstMatchError: string | undefined

    const primary = primarySection(flow, sectionByKey)
    if (!primary) {
      // Every milestone's section vanished between synthesis and here (a concurrent
      // edit): nothing can bind, so the flow is skipped with a stated reason.
      localErrors.push({
        doc: flow.milestones[0].doc,
        anchor: flow.milestones[0].anchor,
        message: `flow "${flow.id}" binds no live section — re-run generate after re-scanning the corpus`,
      })
      return { errors: localErrors, matchCalls: localMatchCalls, matchCallErrors: localMatchCallErrors, firstMatchError: localFirstMatchError }
    }
    const sections = new Map<number, SectionInput>()
    for (const m of flow.milestones) {
      const s = sectionByKey.get(flowSectionKey(m.doc, m.anchor))
      if (s) sections.set(m.order, s)
    }
    const boundSections = [...new Set(flow.bindings.map((b) => sectionByKey.get(flowSectionKey(b.doc, b.anchor))))].filter(
      (s): s is SectionInput => s !== undefined,
    )
    const sectionKeys = boundSections.map(sectionInputsKey)

    const plans = new Map<GuardDriverId, RealizationPlan>()
    const gaps: GuardManifestGap[] = []
    const serverBySurface = new Map<GuardDriverId, string>()
    for (const surface of surfaces) {
      const surfaceCatalog = catalogs.get(surface)
      const interfaceCount = surfaceCatalog?.interfaces.length ?? 0
      if (!isRunnableDriver(surface)) {
        if (interfaceCount > 0) {
          gaps.push({
            surface,
            kind: 'awaiting-driver',
            driver: surface,
            reason: `${interfaceCount} ${surface} interface(s) could realize this flow — ${guardDriver(surface)?.waitingLabel ?? `needs the ${surface} driver`}`,
          })
        }
        continue
      }
      if (!driverPrepared(recipe, surface)) {
        if (interfaceCount > 0) {
          gaps.push({
            surface,
            kind: 'blocked-on',
            reason: composeBlockedOnReason([missingPrepNoun(surface)], oneLine(flow.title)),
          })
        }
        continue
      }
      if (!surfaceCatalog || interfaceCount === 0) {
        // An EMPTY catalog never reaches the matcher: with nothing to choose from a
        // verdict would be noise. This is the extraction gap, stated as such.
        gaps.push({
          surface,
          kind: 'no-interface',
          reason: `no ${surface} interface was mapped from this repository — the flow may be realizable, but nothing was found to realize it with`,
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
      localMatchCalls++
      const outcome = await limit(() => matchFlow(repoRoot, flow, surfaceCatalog, matchRunner))
      options.onMatchProgress?.(++matchDone, matchPairs)
      if (outcome.kind === 'plan') {
        // GATE B (post-match, authoritative): the paths the plan will ACTUALLY drive
        // decide the server. A plan whose app has no server — or one that spans two
        // servers, which no single scenario can run against (R2) — is dropped rather
        // than authored, because the scenario it would produce could only ask the
        // wrong service and report a false failure.
        if (surface === 'api') {
          const bound = bindFlowServer(interfacePaths(outcome.plan), serverIndex)
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
        localMatchCallErrors++
        localFirstMatchError ??= outcome.reason
        localErrors.push({ doc: primary.doc, anchor: primary.anchor, message: `matching (${surface}) ${outcome.reason}` })
      }
    }

    const interfaceFingerprints = [...plans.values()].flatMap((p) => p.interfaces.map((j) => j.fingerprint))
    const inputsHash = flowGenerationInputsHash({
      flowFingerprint: flow.fingerprint,
      sectionKeys,
      interfaceFingerprints,
      recipeFingerprint,
    })
    const prior = priorFlows.get(flow.id)
    // A settled entry that leaves a planned surface unaccounted for (no test, no
    // gap) is a hole nothing can heal: its hash skips the flow forever. Its hash is
    // DISREGARDED, so the flow re-runs here and settles honestly — no migration.
    let changed = !prior || prior.generationInputsHash !== inputsHash || violatesSettleInvariant(prior)
    // THE PER-FLOW CLAIM-DIFF GATE: when the only inputs that moved are bound
    // sections the gate judged cosmetic (their prior extraction was reused, so
    // the claims — and this flow's fingerprint — are byte-identical), the hash
    // recomputed over the sections' PRIOR fingerprints equals the committed one
    // and the flow stays unchanged. The unchanged branch re-stamps the NEW hash,
    // so the next generate is a genuine no-op. A settle-invariant violation
    // still wins: an unaccounted surface must re-run regardless.
    if (changed && prior && prior.generationInputsHash !== null && !violatesSettleInvariant(prior) && claimDiff.cosmetic.size > 0) {
      let substituted = false
      const priorSectionKeys = boundSections.map((s) => {
        const priorFingerprint = claimDiff.cosmetic.get(flowSectionKey(s.doc, s.anchor))
        if (priorFingerprint === undefined) return sectionInputsKey(s)
        substituted = true
        return sectionInputsKey({ ...s, fingerprint: priorFingerprint })
      })
      if (
        substituted &&
        flowGenerationInputsHash({
          flowFingerprint: flow.fingerprint,
          sectionKeys: priorSectionKeys,
          interfaceFingerprints,
          recipeFingerprint,
        }) === prior.generationInputsHash
      ) {
        changed = false
      }
    }
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
    return {
      work: {
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
      },
      errors: localErrors,
      matchCalls: localMatchCalls,
      matchCallErrors: localMatchCallErrors,
      firstMatchError: localFirstMatchError,
    }
  }

  // Every flow's body starts at once; the LIMITER throttles the paid match calls
  // inside them (item 134 — `await limit(fn)` in a sequential loop only ever held
  // one call, so `concurrency` could not move this stage). The flow bodies must NOT
  // take a slot themselves: they await the very limiter they would be holding, and
  // `concurrency` flows would deadlock waiting for a slot none of them can release.
  const flowResults = await Promise.all(liveFlows.map((flow) => processFlow(flow)))
  for (const result of flowResults) {
    errors.push(...result.errors)
    matchCalls += result.matchCalls
    matchCallErrors += result.matchCallErrors
    firstMatchError ??= result.firstMatchError
    if (result.work) works.push(result.work)
  }


  // Matching decides which interfaces each flow's scenario walks: with no plan the
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
      interfaces: interfacesReport,
      externalServices,
      // The session kinds' tallies ride every abort — the transport audit never
      // sees a session, so `audit.failures()` alone under-reports here.
      llmFailures: [...audit.failures(), ...sessionTallies],
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
      })
    }
  }

  const changedWorks = works.filter((w) => w.changed)
  flowsReport.skipped = works.length - changedWorks.length

  // WORLD CLASSIFICATION (blast-radius scheduling, the generate side): batched,
  // cached calls decide which changed flows MUTATE the shared world — credential
  // changes, account deletion, session revocation, global config. Their workers
  // run as the pool's serialized third wave, after every shared-world sibling
  // settled, and the world is restored once they finish (one committed
  // delete-account scenario once cost a documenso run 452 sign-in failures
  // because nothing scheduled around it). Chunked because one call over every
  // changed flow is the call most likely to time out — and when it did, the
  // fail-open fallback removed all protection at the moment it mattered most
  // (a 300s timeout let a password rewrite run mid-pool). So a chunk that is
  // still lost after a retry fails CLOSED: its flows go through the
  // deterministic keyword fallback, and suspects join the tail. Worst case a
  // flow runs serialized that didn't need to — slow, never poisonous.
  const destructiveFlowIds = new Set<string>()
  if (changedWorks.length > 0) {
    const classifyInputs = changedWorks.map((w) => ({
      id: w.flow.id,
      title: w.flow.title,
      milestones: w.flow.milestones.map((m) => m.claimTitle),
    }))
    const WORLD_CLASSIFY_CACHE_NAME = 'guard/world-classify'
    const chunks: (typeof classifyInputs)[] = []
    for (let i = 0; i < classifyInputs.length; i += WORLD_CLASSIFY_CHUNK_SIZE) {
      chunks.push(classifyInputs.slice(i, i + WORLD_CLASSIFY_CHUNK_SIZE))
    }
    for (const chunk of chunks) {
      const chunkKey = createHash('sha256')
        .update(`${WORLD_CLASSIFY_PROMPT_FINGERPRINT}\0${JSON.stringify(chunk)}`)
        .digest('hex')
      const cached = WorldClassifySchema.safeParse(
        await getCacheEntry(repoRoot, WORLD_CLASSIFY_CACHE_NAME, chunkKey),
      )
      if (cached.success) {
        for (const id of cached.data.mutators) destructiveFlowIds.add(id)
        continue
      }
      const known = new Set(chunk.map((f) => f.id))
      let settled = false
      let lastError = 'invalid reply'
      for (let attempt = 0; attempt < 2 && !settled; attempt++) {
        try {
          const raw = await worldClassifyRunner(chunk)
          const parsed = WorldClassifySchema.safeParse(raw)
          if (parsed.success) {
            const mutators = parsed.data.mutators.filter((id) => known.has(id))
            await setCacheEntry(repoRoot, WORLD_CLASSIFY_CACHE_NAME, chunkKey, { mutators })
            for (const id of mutators) destructiveFlowIds.add(id)
            settled = true
          }
        } catch (e) {
          lastError = (e as Error).message
        }
      }
      if (!settled) {
        const suspects = chunk.filter(looksWorldMutating).map((f) => f.id)
        for (const id of suspects) destructiveFlowIds.add(id)
        errors.push({
          doc: '',
          anchor: '',
          message:
            `world classification lost a chunk of ${chunk.length} flow(s) (${lastError}) — ` +
            `the deterministic fallback scheduled ${suspects.length} suspect flow(s) into the serialized mutator tail`,
        })
      }
    }
  }
  // Announce the settle denominator before the first (slow) authoring/birth phase,
  // so the live counter is never a bare count without context.
  options.onFlowSettled?.(0, changedWorks.length)

  // 7. Workers — one `guard-generate.flow-worker` session per (flow, surface
  // with a plan). The build is kicked first: every execution inside the worker
  // tools reuses it (skipBuild).
  const authorTasks: AuthorTask[] = changedWorks.flatMap((work) =>
    [...work.plans.entries()].map(([surface, plan]) => ({
      work,
      surface,
      plan,
      ...(work.serverBySurface.get(surface) ? { server: work.serverBySurface.get(surface)! } : {}),
    })),
  )

  // THE BROWSER PREFLIGHT: every web worker execution needs Chromium, and the
  // engine never downloads a browser mid-run — so a missing one is judged ONCE,
  // before a session, the app build or the web build is paid for, not
  // discovered inside every worker (documenso 2026-08-27: 130 web sessions each
  // probed their way to the same missing binary, retired their flows, and
  // bumped the auto-resolve ledger toward escalation on a fault of the machine,
  // not the flows). One loud error, per the run-refusal doctrine; the affected
  // flows stay unsettled (`errored` ⇒ no inputs hash), so the next generate
  // re-attempts them once the browser exists. Api and cli work proceeds.
  if (authorTasks.some((t) => t.surface === 'web')) {
    const browser = await (options.browserPreflight ?? preflightBrowser)()
    if (!browser.ok) {
      const webTasks = authorTasks.filter((t) => t.surface === 'web')
      for (const t of webTasks) t.errored = true
      errors.push({
        doc: webTasks[0].work.primary.doc,
        anchor: webTasks[0].work.primary.anchor,
        message:
          `the web surface cannot be driven: ${browser.reason} — ` +
          `${webTasks.length} web flow(s) skipped, left unsettled for the next generate`,
      })
    }
  }

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
      const build = await runBuild(repoRoot, recipe.build, recipe.env)
      if (!build.ok) return build
      // The WEB surface's own build, only when this run authors for it: every
      // worker execution runs with skipBuild, so if the client is not compiled
      // HERE it never is — and every web scenario dies red for a reason no claim
      // named. Built with the SURFACE's env (`recipe.env` ⊕ `web.env`), the same
      // env the serve process gets, exactly as `guard run` does.
      const web = resolveWebSurface(recipe)
      // `!t.errored` carries the browser preflight: a run that cannot drive the
      // browser must not pay for the client compile either.
      if (web?.build && authorTasks.some((t) => t.surface === 'web' && !t.errored)) {
        const webBuild = await runBuild(repoRoot, web.build, web.env)
        if (!webBuild.ok) return webBuild
      }
      return build
    })()
    return buildMemo
  }
  if (authorTasks.some((t) => !t.errored)) void startBuild()
  let buildAnnounced = false
  const awaitBuild = async (): Promise<BuildResult> => {
    if (!buildAnnounced) {
      buildAnnounced = true
      options.onBirthPhase?.('build')
    }
    return startBuild()
  }

  // Grounded briefings: before a cli worker's briefing is rendered the engine
  // probes the real program for the commands the flow's claims name (empty
  // sandbox, cached) and injects the transcripts. A failed build skips probing
  // entirely, leaving the briefing ungrounded.
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

  // The worker pool's live outcome tallies — fed by the seam's per-task tick
  // and rendered by the caller as `workers a/b · settled n · blocked m`.
  let workerSettledCount = 0
  let workerBlockedCount = 0

  // --- Containers the worker routing fold fills and the persist stage
  // consumes: the settle invariant, the ledger reconciliation and the report
  // assembly read these and nothing else. ---
  const usedIds = existingScenarioIds(repoRoot)
  // A flow about to re-author frees its OWN prior ids (its files are deleted in
  // persist) so it reuses its stable `<flow>.<surface>.1` without stealing a
  // sibling's.
  for (const w of changedWorks) {
    for (const id of w.prior?.scenarios.map((s) => s.id) ?? []) usedIds.delete(id)
  }
  // Edit mode's priors: the committed corpus as it stands BEFORE persist
  // deletes anything, indexed by id — the yaml a worker is briefed to edit and
  // the interface fingerprints the moved-inputs summary compares against.
  const priorYamlById: PriorScenarioIndex = new Map(
    loadScenarios(repoRoot).scenarios.map((s) => [s.id, { yaml: serializeScenarioYaml(s), scenario: s }]),
  )
  // `drop_scenario` calls the fold accepted, per (flow, surface) — persist
  // deletes those files and the manifest retires them with their reasons.
  const dropsByRef = new Map<string, { id: string; reason: string }[]>()

  // The "test is wrong" verdicts — the two classes withheld from the
  // corpus: a fidelity rejection on a green candidate, and a worker RETIREMENT
  // escalated past its auto-resolve budget. Both unsettle their flow so the
  // next generate re-authors.
  const fidelityRejections = new Map<string, GuardBirthFinding[]>()
  const withheldFailures = new Map<string, GuardBirthFinding[]>()
  const persisted = new Map<string, BirthCandidate[]>()
  // Tests that FAILED their birth execution. The worker routing fold fills it
  // with the COMMIT class only — a confirmed `expectedReds` red, committed
  // exactly like a passing test with the birth result recorded, so the flow
  // settles.
  const failedTests = new Map<string, { candidate: BirthCandidate; finding: GuardBirthFinding }[]>()
  const taskByKey = new Map(authorTasks.map((t) => [taskKey(t), t]))

  /**
   * The server-binding SAFETY NET, for the flows the route gates could not classify at
   * generate time (a path the manifest did not attribute, a plan whose interfaces
   * carry no path): an execution ran the scenario, the bound server 404ed a path
   * another app serves, and the runner annotated the outcome `unservedRoute`. That is
   * the SAME fact Gate B blocks on, arriving later — so it settles as the same
   * `blocked-on` gap instead of an `errors.push`, which would leave the flow
   * unsettled and re-authoring (and re-paying) on every future generate.
   *
   * On the worker path the engine records the observation per task
   * (`unservedByRef`, inside `executeOnce`) and the tool result still carries the
   * in-session NOTE, so a live session can end early with an honest `blocked`
   * outcome; when the session instead dies or ends without settling, the ROUTING
   * FOLD sends the task through here so the flow settles anyway.
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

  // C4 — the no-op birth anomaly gate, the last line of defense against a
  // silently inert recipe that got past every preflight. Each birth execution's
  // per-driver step aggregate folds into ONE cumulative sample, and the moment
  // the sample says a driver is a do-nothing surface, generate aborts through
  // the same `recipe-failed` channel a discovery failure uses. Every fold point
  // sits BEFORE the persist stage, so nothing corpus-side has been written and
  // the abort IS the rollback: no scenario files, no manifest write, no ledger
  // write, no findings.
  let birthStepStats: GuardRunStepStats | null = null
  const foldBirthRound = (round: BirthRound): GuardNoOpAnomaly | null => {
    if (!round.stepStats) return null
    birthStepStats = birthStepStats ? foldStepStats(birthStepStats, round.stepStats) : round.stepStats
    return detectNoOpAnomaly(birthStepStats)
  }

  /**
   * The RUN-LEVEL refusal, recorded at most once (the latch lives in the worker
   * pool's `executeOnce`). The runner declined to run — nothing was built, booted
   * or executed — so it is deliberately NOT fanned out into a per-candidate error:
   * the candidates were never judged, and N copies of one config fact read as N
   * broken tests. The affected flows still stay unsettled (`task.errored`), so the
   * next generate re-attempts them once the config is fixed; the fold rewrites
   * `flowIds` off the short-circuit set so the record names EVERY cancelled flow,
   * not just the single-candidate round that first hit it.
   */
  let runRefusal: GuardRunRefusal | null = null

  // Green tests this run persisted with NO review behind them (a stage that
  // lost every call, or — on the worker path — a fidelity child that could not
  // be dispatched). Zero on a healthy run.
  let fidelityUnreviewed = 0
  // The task refs whose adjudication never happened. They must NOT settle: a
  // settled flow records its inputs hash and the next generate skips it as
  // unchanged, so a corpus that shipped unadjudicated would stay unadjudicated
  // forever. Left unsettled, the next generate re-works the flow and
  // adjudicates it for real (re-authoring is a cache hit).
  const unadjudicatedRefs = new Set<string>()
  // Failures the auto-resolve loop RETIRED this run (no committed row) — the
  // flow still re-attempts, so persist unsettles it.
  const autoRetiredRefs = new Set<string>()
  // True once the pool planned a mutator wave — the world is restored (and the
  // dirty marker cleared) after the last execution, before persist.
  let mutatorPhasePlanned = false
  // The worker path's fidelity children lost EVERY dispatch — the carve-out's
  // loud row, mirrored from the transport-audit predicate the one-shot uses.
  let workerFidelityLoss: GuardSessionSummary | null = null

  // THE FLOW-WORKER POOL (plan 04 steps 17 + 18) — since step 20 the ONLY
  // author→adjudicate path (the one-shot author / birth-retry / fidelity /
  // triage stages are retired). The worker authors, runs and adjudicates in
  // one loop over exactly two tools; every deterministic gate still runs —
  // the det pre-flight inside the tools, the confirmation run + the
  // red-prediction gate + the fidelity child inside the done-gate. Match
  // stayed a cached pre-stage (both server-binding gates fired before any
  // worker spends), and persist below consumes the containers the routing
  // fold fills, so the settle invariant and the manifest mechanics are
  // unchanged.
  if (authorTasks.some((t) => !t.errored)) {
    const build = await awaitBuild()
    if (!build.ok) {
      const message = `build failed (\`${build.command}\`)${build.timedOut ? ' — timed out' : ''}`
      for (const task of authorTasks) {
        if (task.errored) continue // the browser preflight already reported it
        task.errored = true
        errors.push({
          doc: task.work.primary.doc,
          anchor: task.work.primary.anchor,
          message: `flow worker (${task.surface}) skipped: ${message}`,
        })
      }
    } else {
      // The entry-preflight short-circuit, unchanged in meaning: a dead built
      // entry makes every cli worker's every run identical noise, so cli
      // tasks are skipped (their flows stay unsettled — the ONE loud error
      // was recorded by `deadEntry`) before a session is spent. Api tasks
      // proceed: the api server has its own preflight inside the runner.
      // `!t.errored` carries the browser preflight's web skips the same way.
      const dead = authorTasks.some((t) => t.surface !== 'api' && !t.errored) && (await deadEntry())
      const runnable = authorTasks.filter((t) => !t.errored && (!dead || t.surface === 'api'))
      if (dead) for (const t of authorTasks) if (t.surface !== 'api') t.errored = true

      // Latches. A C4 anomaly aborts AFTER the pool, before persist — nothing
      // corpus-side has been written, so the abort is still the rollback —
      // and once latched (likewise once the runner refused) every further
      // execution short-circuits, so no sandbox is spent on a world already
      // judged broken; the worker is told and should end its session.
      let anomalyLatch: GuardNoOpAnomaly | null = null
      const refusedTasks = new Set<string>()

      // THE ENGINE STASH (step 17): accepted submissions keyed by the sha256
      // of their COMMITTED-shape yaml. In-memory run state, never a store
      // file — the fold takes the yaml from HERE, never from the outcome
      // text, so a model restating its scenario cannot drift what persists.
      interface WorkerStashEntry {
        candidate: BirthCandidate
        yaml: string
        result: GuardScenarioResult
        expectedReds: GuardExpectedRed[]
        /** The fidelity child was unavailable — accepted unreviewed. */
        fidelityUnreviewed: boolean
      }
      const stash = new Map<string, WorkerStashEntry>()

      // Per-task execution observations the ROUTING FOLD reads when a task ends
      // without settling (a failed session, an outcome that settles nothing):
      //  - `unservedByRef` — an execution hit the unserved-route condition
      //    (Gate B's fact arriving at run time); the fold routes the task
      //    through `settleUnservedRoute` so the flow still settles as the
      //    missing-server gap instead of re-paying a session every generate.
      //  - `lastExecutionErrorByRef` — the last error-outcome execution, so a
      //    failed session's report error carries the runner's masked
      //    stdout/stderr excerpts structurally (`errorFrom`), not only as
      //    free text.
      const unservedByRef = new Map<string, BirthOutcome>()
      const lastExecutionErrorByRef = new Map<string, BirthOutcome>()

      interface WorkerTaskState {
        task: AuthorTask
        /** The stable engine-assigned scenario id every attempt builds with. */
        id: string
        acceptedSha?: string
        /** Edit mode: the briefed prior scenarios (id → yaml) the worker may
         *  replace or drop; empty in scratch mode. */
        priors: Map<string, string>
        /** The `drop_scenario` calls accepted so far (edit mode). */
        drops: { id: string; reason: string }[]
        /** Fidelity flags drawn so far — the first HIGH-confidence one is the
         *  in-loop self-heal; any later flag is a rejection. */
        fidelityFlags: number
        /** The finding of an unresolved fidelity rejection — cleared when a
         *  later submission is accepted, folded as a rejection otherwise. */
        pendingFidelityFinding?: GuardBirthFinding
      }
      const states = new Map<string, WorkerTaskState>()
      for (const task of runnable) {
        // EDIT MODE resolution, deterministic: the flow has a committed entry
        // with the SAME milestone composition, it is not tainted (a rejected
        // prior is authored away from, never edited), `--from-scratch` was not
        // asked, and this surface owns at least one prior whose file still
        // loads. Anything else authors from scratch exactly as before.
        const tainted = priorLedger.tainted[autoResolutionKey(task.work.flow.id, task.surface)] !== undefined
        const owned = priorScenariosBySurface(task.work).get(task.surface) ?? []
        const priors = new Map<string, string>()
        if (
          !options.fromScratch &&
          !tainted &&
          task.work.prior &&
          task.work.prior.flowFingerprint === task.work.flow.fingerprint
        ) {
          for (const s of owned) {
            const prior = priorYamlById.get(s.id)
            if (prior) priors.set(s.id, prior.yaml)
          }
        }
        states.set(taskKey(task), {
          task,
          id: assignScenarioId(task.work.flow.id, task.surface, usedIds),
          priors,
          drops: [],
          fidelityFlags: 0,
        })
      }

      const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex')

      // The flow's doc-example blocks, mined once per flow for the byte-
      // fidelity pre-flight (the same mining the briefing's DOC EXAMPLE
      // blocks come from, so the checker and the prompt can never disagree).
      const exampleBlocksMemo = new Map<string, DocExampleBlock[]>()
      const exampleBlocksOf = (work: FlowWork): DocExampleBlock[] => {
        let blocks = exampleBlocksMemo.get(work.flow.id)
        if (!blocks) {
          blocks = [...new Set(work.sections.values())].flatMap((s) =>
            mineExampleBlocks(s.fullText || s.ownText).map((b) => ({ ...b, doc: s.doc, anchor: s.anchor })),
          )
          exampleBlocksMemo.set(work.flow.id, blocks)
        }
        return blocks
      }

      /** The det pre-flight — the SAME four checks the one-shot re-ask loop
       *  corrected on, returned as one model-facing line; a defect costs one
       *  tool turn instead of a sandbox run. */
      const preflightDefect = (task: AuthorTask, raw: RawGeneratedScenario): string | null => {
        const uncovered = uncoveredMilestones(task.work.flow, raw)
        const unknown = unknownMilestones(task.work.flow, raw)
        if (uncovered.length > 0 || unknown.length > 0) {
          const parts: string[] = []
          if (uncovered.length > 0) {
            parts.push(
              `milestone(s) ${uncovered.join(', ')} are realized by no step — every flow milestone needs a step carrying its \`milestone\` number`,
            )
          }
          if (unknown.length > 0) {
            parts.push(`step \`milestone\` value(s) ${unknown.join(', ')} match no milestone of this flow`)
          }
          return parts.join('; ')
        }
        const composition = compositionDefectOf(raw, recipe)
        if (composition) return composition
        const exampleDefect = exampleFidelityDefect(
          { steps: raw.steps, ...(raw.setup ? { setup: raw.setup } : {}) },
          exampleBlocksOf(task.work),
        )
        if (exampleDefect) return exampleDefect
        const badRe = firstInvalidMatchPattern(raw.steps)
        if (badRe) {
          return `step ${badRe.step} ${badRe.where}: /${badRe.pattern}/ is not a valid regular expression — ${badRe.error}`
        }
        return null
      }

      // Tasks whose worker drafted a `world: mutates` scenario OUTSIDE the
      // serialized mutator tail — the tool refused the execution, and the pool
      // re-dispatches each one into a second, tail-only invocation after the
      // waves finish (unless the session settled anyway with a rewrite that
      // does not mutate).
      const deferredMutatorRefs = new Set<string>()

      /**
       * The DETERMINISTIC mutator gate, enforced where execution happens — the
       * classifier only advises scheduling, but a draft that DECLARES
       * `world: mutates` states the fact itself, and this run proved workers
       * declare honestly while a timed-out classifier scheduled nothing (a
       * password rewrite then ran mid-pool and cost the run 431 sign-in
       * failures). Returns the refusal report, or null to let the run proceed.
       * Two rules, both fail-closed:
       *  - no `api.services.reset` in the recipe ⇒ a mutation nobody can
       *    repair never runs, anywhere;
       *  - outside the mutator tail ⇒ deferred, and the pool re-runs the flow
       *    in a serialized tail-only invocation this same generate.
       */
      const mutatorDraftGate = (task: AuthorTask, raw: RawGeneratedScenario): FlowWorkerToolReport | null => {
        if (raw.world !== 'mutates') return null
        if (!recipe.api?.services?.reset) {
          return {
            content:
              'not executed — this draft declares `world: mutates`, but the recipe declares no `api.services.reset`, ' +
              'and the engine refuses to run a mutation it cannot repair. If the claim can be tested WITHOUT mutating ' +
              'shared state (mint your own principal or record with ${unique} and mutate that), rewrite the scenario ' +
              'that way and run it. Otherwise end the session with outcome kind "blocked" and the capability ' +
              '"a recipe api.services.reset command (world-mutating tests are barred until the recipe can restore the world)".',
            isError: true,
          }
        }
        if (destructiveFlowIds.has(task.work.flow.id)) return null
        deferredMutatorRefs.add(taskKey(task))
        return {
          content:
            'not executed — this draft declares `world: mutates`, and mutating drafts execute only in the run\'s ' +
            'serialized final wave, after every shared-world sibling has settled. If the claim can be tested WITHOUT ' +
            'mutating shared state (mint your own principal or record with ${unique} and mutate that), rewrite the ' +
            'scenario that way and run it here. Otherwise end the session with outcome kind "blocked" and the ' +
            'capability "deferred to the serialized mutator wave" — the engine re-runs this flow there before this ' +
            'generate ends.',
          isError: true,
        }
      }

      const buildCandidate = (
        state: WorkerTaskState,
        raw: RawGeneratedScenario,
        id: string = state.id,
      ): { candidate: BirthCandidate } | { error: string } => {
        const task = state.task
        try {
          const scenario = buildFlowScenario({
            flow: task.work.flow,
            interfaces: task.plan.interfaces,
            raw,
            id,
            surface: task.surface,
            ...(task.server ? { server: task.server } : {}),
            defaultServer: defaultApiServer,
          })
          return {
            candidate: {
              flow: task.work.flow,
              surface: task.surface,
              section: task.work.primary,
              scenario,
              ref: taskKey(task),
            },
          }
        } catch (e) {
          return { error: (e as Error).message }
        }
      }

      /** One fresh-sandbox execution with the refusal + anomaly latches
       *  applied — every worker run and every confirmation goes through here. */
      const executeOnce = async (
        candidate: BirthCandidate,
        task: AuthorTask,
      ): Promise<{ report: FlowWorkerToolReport } | { result: GuardScenarioResult }> => {
        if (anomalyLatch) {
          return { report: { content: `run skipped — the run was aborted: ${noOpAnomalyReason(anomalyLatch, recipe)}`, isError: true } }
        }
        if (runRefusal) {
          refusedTasks.add(taskKey(task))
          task.errored = true
          return { report: { content: workerRefusalMessage(runRefusal), isError: true } }
        }
        const round = await birthValidate(repoRoot, [candidate], {
          executor,
          sharedWorld,
          recipe,
          skipBuild: true,
          noOpThresholdMs: options.noOpThresholdMs,
        })
        if (round.refusal) {
          if (!runRefusal) {
            runRefusal = round.refusal
            errors.push(runRefusalError(round.refusal))
          }
          refusedTasks.add(taskKey(task))
          task.errored = true
          return { report: { content: workerRefusalMessage(round.refusal), isError: true } }
        }
        const anomaly = foldBirthRound(round)
        if (anomaly) {
          anomalyLatch = anomaly
          return { report: { content: `run aborted: ${noOpAnomalyReason(anomaly, recipe)}`, isError: true } }
        }
        const outcome = round.outcomes[0]
        if (!outcome) return { report: { content: 'the runner produced no result for the scenario', isError: true } }
        if (outcome.result.unservedRoute) unservedByRef.set(taskKey(task), outcome)
        if (outcome.result.outcome === 'error') lastExecutionErrorByRef.set(taskKey(task), outcome)
        return { result: outcome.result }
      }

      /** Whether a run outcome reproduces the declared red predictions
       *  (green ⇔ none declared; a red must match its one observable step). */
      const redPredictionHolds = (
        result: GuardScenarioResult,
        expectedReds: readonly GuardExpectedRed[],
      ): boolean => {
        if (result.outcome === 'pass') return expectedReds.length === 0
        if (result.outcome !== 'fail') return false
        if (expectedReds.length === 0) return false
        const step = result.failure?.step ?? 1
        if (expectedReds.some((r) => r.step !== step)) return false
        const declared = expectedReds.find((r) => r.step === step)
        return (
          declared !== undefined &&
          actualMatchesPrediction(result.failure?.actual ?? '', declared.predictedActual)
        )
      }

      const acceptSubmission = (
        state: WorkerTaskState,
        candidate: BirthCandidate,
        result: GuardScenarioResult,
        expectedReds: readonly GuardExpectedRed[],
        unreviewed: boolean,
        note?: string,
      ): FlowWorkerToolReport => {
        const yamlText = serializeScenarioYaml(candidate.scenario)
        const sha = sha256Hex(yamlText)
        stash.set(sha, {
          candidate,
          yaml: yamlText,
          result,
          expectedReds: [...expectedReds],
          fidelityUnreviewed: unreviewed,
        })
        state.acceptedSha = sha
        state.pendingFidelityFinding = undefined
        // A CONVERGED heal: the acceptance retracts the taint an earlier flag in
        // THIS session recorded, exactly as it retracts the pending finding — the
        // flow did not end rejected, and a stale taint would cost the next
        // generate a needless cache bypass and a full worker session. A flag on
        // the FINAL state (rejection, retirement, no later acceptance) keeps its
        // taint: nothing re-adds after the pool except the fold's `retired` arm.
        flaggedFlows.delete(autoResolutionKey(candidate.flow.id, candidate.surface))
        const outcomeHint = JSON.stringify({ kind: 'settled', scenarioYamlSha: sha, expectedReds })
        return {
          content:
            `accepted — the engine stashed this exact yaml under sha ${sha}.` +
            (note ? `\n${note}` : '') +
            `\nEnd the session by producing the outcome: ${outcomeHint}`,
        }
      }

      /** The done-gate on one submission whose confirmation run settled. */
      const settleSubmission = async (
        state: WorkerTaskState,
        candidate: BirthCandidate,
        result: GuardScenarioResult,
        expectedReds: readonly GuardExpectedRed[],
        judge: WorkerFidelityJudge,
      ): Promise<FlowWorkerToolReport> => {
        const task = state.task
        const condensed = renderCondensedResult(result)
        if (result.outcome !== 'pass' && result.outcome !== 'fail') {
          return {
            content: `not accepted — the confirmation run did not settle pass/fail:\n${condensed}`,
            isError: true,
          }
        }
        if (result.outcome === 'pass') {
          if (expectedReds.length > 0) {
            return {
              content:
                `not accepted — you declared ${expectedReds.length} expected red(s) but the confirmation run is GREEN:\n${condensed}\n` +
                'Drop the predictions, or investigate why the red no longer reproduces.',
              isError: true,
            }
          }
          // Step 18 — the fidelity CHILD (fresh context is the independence).
          const verdict = await judge({
            flowFingerprint: task.work.flow.fingerprint,
            sectionKeys: task.work.sectionKeys,
            scenarioBehavior: scenarioBehavior(candidate.scenario),
            briefing: workerFidelityBriefing(task.work, candidate, condensed),
          })
          if (verdict.kind === 'flagged') {
            const key = autoResolutionKey(candidate.flow.id, candidate.surface)
            const firstFlag = state.fidelityFlags === 0
            state.fidelityFlags++
            taintFlow(candidate.flow.id, candidate.surface, candidate.scenario.title, verdict.mismatch)
            const finding = fidelityFinding(candidate, verdict.mismatch)
            if (firstFlag && verdict.confidence === 'high' && autoResolveCount(key) < escalateAfter) {
              // The in-loop self-heal (no separate re-author round — the
              // WORKER revises); the ledger bump keeps the budget honest.
              bumpLedger(key, 'fidelity')
              state.pendingFidelityFinding = finding
              return {
                content:
                  `not accepted — the fidelity judge flagged the scenario (high confidence): ${verdict.mismatch}\n` +
                  'Revise the scenario so it truly verifies the flagged milestone, then submit again.',
                isError: true,
              }
            }
            if (autoResolveCount(key) >= escalateAfter) {
              finding.autoResolveEscalation = { count: autoResolveCount(key), source: 'fidelity' }
            }
            state.pendingFidelityFinding = finding
            return {
              content:
                `REJECTED — the fidelity judge flagged this candidate${firstFlag ? '' : ' too'} (${verdict.confidence}): ${verdict.mismatch}\n` +
                'Either author a scenario that genuinely verifies the milestones, or end the session with a `retired` outcome.',
              isError: true,
            }
          }
          const unreviewed = verdict.kind === 'unavailable'
          return acceptSubmission(
            state,
            candidate,
            result,
            [],
            unreviewed,
            unreviewed
              ? `NOTE: the fidelity judge was unavailable (${verdict.reason}); the green is accepted UNREVIEWED and the run will report it unadjudicated.`
              : undefined,
          )
        }
        // A red confirmation — accepted only with predictions that reproduce.
        const step = result.failure?.step ?? 1
        if (expectedReds.length === 0) {
          return {
            content:
              `not accepted — the confirmation run is RED and you declared no expectedReds:\n${condensed}\n` +
              `Either fix the scenario, or — when the doc and the code genuinely disagree — re-submit with expectedReds declaring step ${step}, the observed actual, a verdict (doc-drift | code-drift), and a brief.`,
            isError: true,
          }
        }
        const extra = expectedReds.filter((r) => r.step !== step)
        if (extra.length > 0) {
          return {
            content: `not accepted — execution stops at the FIRST red step (step ${step}); expectedReds may declare only that step, but you also declared step(s) ${extra.map((r) => r.step).join(', ')}.`,
            isError: true,
          }
        }
        const declared = expectedReds.find((r) => r.step === step)!
        const actual = result.failure?.actual ?? ''
        if (!actualMatchesPrediction(actual, declared.predictedActual)) {
          return {
            content:
              `not accepted — the confirmation's actual at step ${step} does not match your predictedActual.\n` +
              `predicted: ${declared.predictedActual}\nobserved:  ${actual}\n` +
              'Copy the observed actual into predictedActual (the prediction proves you ran it), then submit again.',
            isError: true,
          }
        }
        return acceptSubmission(state, candidate, result, expectedReds, false)
      }

      // The scenarios of an epic's member flows that have SETTLED — read off
      // the stash, so the epic wave's briefings (built after the first wave's
      // barrier) carry them read-only.
      const memberScenarios = (flow: GuardFlow): { flowId: string; surface: GuardDriverId; yaml: string }[] => {
        const out: { flowId: string; surface: GuardDriverId; yaml: string }[] = []
        for (const memberId of flow.composedOf) {
          for (const state of states.values()) {
            if (state.task.work.flow.id !== memberId || !state.acceptedSha) continue
            const entry = stash.get(state.acceptedSha)
            if (entry) out.push({ flowId: memberId, surface: state.task.surface, yaml: entry.yaml })
          }
        }
        return out
      }

      const makeWorkerTask = (state: WorkerTaskState): FlowWorkerTask => {
        const task = state.task
        const ref = taskKey(task)
        const taint = priorLedger.tainted[autoResolutionKey(task.work.flow.id, task.surface)]
        const epic = task.work.flow.composedOf.length > 0
        const priorScenarios = [...state.priors.entries()].map(([id, yaml]) => ({ id, yaml }))
        const editMode = priorScenarios.length > 0
        return {
          workItem: `flow:${task.work.flow.id}:${task.surface}`,
          flowId: task.work.flow.id,
          surface: task.surface,
          epic,
          milestoneCount: new Set(task.plan.steps.map((s) => s.milestone)).size,
          ...(taint ? { taint: { title: taint.title, mismatch: taint.mismatch } } : {}),
          ...(editMode ? { prior: { scenarios: priorScenarios } } : {}),
          cacheMaterial: {
            flowFingerprint: task.work.flow.fingerprint,
            sectionKeys: task.work.sectionKeys,
            interfaceFingerprints: task.plan.interfaces.map((j) => j.fingerprint),
            recipeFingerprint,
            mode: editMode ? 'edit' : 'scratch',
            priorShas: priorScenarios.map((p) => sha256Hex(p.yaml)),
          },
          prepare: async () => {
            const probes =
              task.surface === 'cli'
                ? await groundClaims(task.work.flow.milestones.map((m) => m.claimTitle))
                : []
            const ctx: AuthorUserContext = {
              ...assembleAuthorCtx({
                task,
                recipe,
                probes,
                opIndex,
                docText,
                externalServices: externalServiceHints,
                apiInterfaces,
                outboundRequests: outboundRequestHints,
                outboundRequestsOverflow,
                ...(mapped.resources ? { resources: mapped.resources } : {}),
                serverIndex,
              }),
              ...(taint ? { priorFlag: { title: taint.title, mismatch: taint.mismatch } } : {}),
              // Edit mode and the taint are exclusive by construction (a tainted
              // task never resolves to edit mode above), so the two blocks never
              // contradict each other in one briefing.
              ...(editMode
                ? {
                    priorScenarios,
                    movedInputs: {
                      sections: movedSectionsFor(task.work),
                      interfaces: movedInterfacesFor(
                        task.plan,
                        priorScenarios.flatMap((p) => priorYamlById.get(p.id)?.scenario ?? []),
                      ),
                    },
                  }
                : {}),
            }
            const lines = [buildAuthorUserPrompt(ctx)]
            if (epic) {
              const members = memberScenarios(task.work.flow)
              if (members.length > 0) {
                lines.push(
                  '',
                  "MEMBER FLOWS' SETTLED SCENARIOS (read-only — this epic chains those flows; reuse their working verbs and world, never edit them):",
                )
                for (const m of members) lines.push('', `--- member flow ${m.flowId} (${m.surface})`, m.yaml)
              }
            }
            const siblings = settledSiblings(siblingIndex, task)
            if (siblings.length > 0) {
              lines.push(
                '',
                'SETTLED SIBLING SCENARIOS (read-only — committed GREEN tests that already walk interfaces your flow shares; REUSE their proven arrange verbs — the sign-in they perform, the records they create, the endpoints and field shapes that verifiably work — never copy their assertions, and mint your own ${unique} identities):',
              )
              for (const s of siblings) lines.push('', `--- sibling ${s.id}`, s.yaml)
            }
            lines.push(
              '',
              'Work the loop: draft the scenario as YAML, `run_scenario` it, revise on the evidence, then `submit_scenario`; end the session with the outcome object.',
            )
            return lines.join('\n')
          },
          runScenario: async (yamlText) => {
            const parsed = parseRawScenarioYaml(yamlText, task.surface)
            if ('error' in parsed) return { content: parsed.error, isError: true }
            const defect = preflightDefect(task, parsed.raw)
            if (defect) return { content: `pre-flight defect (not executed): ${defect}`, isError: true }
            const gate = mutatorDraftGate(task, parsed.raw)
            if (gate) return gate
            const built = buildCandidate(state, parsed.raw)
            if ('error' in built) return { content: `the scenario does not build: ${built.error}`, isError: true }
            const run = await executeOnce(built.candidate, task)
            if ('report' in run) return run.report
            return {
              content: renderCondensedResult(run.result),
              ...(run.result.outcome === 'pass' ? {} : { isError: true }),
            }
          },
          submitScenario: async (yamlText, expectedReds, judge, replaces) => {
            // Id resolution. Scratch mode: the pre-assigned id, every attempt
            // (`replaces` is meaningless there). Edit mode: `replaces` keeps a
            // briefed prior's id; omitted, the submission is a NEW scenario
            // and takes the next free id — strictly, so "add one and drop the
            // old one" stays expressible and a kept prior is always named.
            let id = state.id
            if (state.priors.size > 0) {
              if (replaces !== undefined) {
                if (!state.priors.has(replaces)) {
                  return {
                    content: `not accepted — \`replaces\` names "${replaces}", which is not a prior scenario of this flow on this surface (briefed: ${[...state.priors.keys()].join(', ')})`,
                    isError: true,
                  }
                }
                if (state.drops.some((d) => d.id === replaces)) {
                  return { content: `not accepted — "${replaces}" was dropped earlier in this session; drop OR replace a prior, not both`, isError: true }
                }
                id = replaces
              } else {
                id = assignScenarioId(task.work.flow.id, task.surface, usedIds)
              }
            } else if (replaces !== undefined) {
              return { content: 'not accepted — `replaces` is for editing committed scenarios, and this flow has none to edit', isError: true }
            }
            const parsed = parseRawScenarioYaml(yamlText, task.surface)
            if ('error' in parsed) return { content: parsed.error, isError: true }
            const defect = preflightDefect(task, parsed.raw)
            if (defect) return { content: `pre-flight defect (not executed): ${defect}`, isError: true }
            const gate = mutatorDraftGate(task, parsed.raw)
            if (gate) return gate
            const built = buildCandidate(state, parsed.raw, id)
            if ('error' in built) return { content: `the scenario does not build: ${built.error}`, isError: true }
            const run = await executeOnce(built.candidate, task)
            if ('report' in run) return run.report
            return settleSubmission(state, built.candidate, run.result, expectedReds, judge)
          },
          hasStash: (sha) => stash.get(sha)?.candidate.ref === ref,
          stashedYaml: (sha) => {
            const entry = stash.get(sha)
            if (!entry || entry.candidate.ref !== ref) return undefined
            // An UNREVIEWED green never enters the cache (core skips the
            // write when no yaml is returned): a later hit would
            // short-circuit the fidelity dispatch forever, and "accepted
            // unreviewed" is a fact about THIS run's failed child, not about
            // the scenario. The next generate re-works the flow and reviews
            // it for real — the one-shot path's lost-review rule, kept.
            return entry.fidelityUnreviewed ? undefined : entry.yaml
          },
          dropScenario: (id, reason) => {
            if (state.priors.size === 0) {
              return { content: 'not accepted — `drop_scenario` is for editing committed scenarios, and this flow has none to edit', isError: true }
            }
            if (!state.priors.has(id)) {
              return {
                content: `not accepted — "${id}" is not a prior scenario of this flow on this surface (briefed: ${[...state.priors.keys()].join(', ')})`,
                isError: true,
              }
            }
            if (state.drops.some((d) => d.id === id)) {
              return { content: `not accepted — "${id}" is already dropped in this session`, isError: true }
            }
            if ([...stash.values()].some((e) => e.candidate.ref === ref && e.candidate.scenario.id === id)) {
              return { content: `not accepted — "${id}" was already replaced by an accepted submission in this session; a scenario is replaced OR dropped, not both`, isError: true }
            }
            state.drops.push({ id, reason: reason.trim() })
            return {
              content:
                `recorded — "${id}" will be deleted at persist and retired with that reason. ` +
                `List it under "droppedScenarios" in your settled outcome. At least one scenario must still be accepted.`,
            }
          },
          droppedIds: () => state.drops.map((d) => d.id),
          confirmCached: async (cached) => {
            // World drift check for a cache hit (the recipe-cache-verifies
            // mirror): every cached scenario re-runs once, fresh, and the hit
            // stands only when each verdict still reproduces. One element for
            // a legacy entry; several for an edit-mode settle.
            if (cached.length === 0) return false
            const stashed: { sha: string; entry: WorkerStashEntry }[] = []
            for (const { yaml: scenarioYaml, expectedReds } of cached) {
              const scenario = parseScenarioYaml(scenarioYaml)
              if (!scenario) return false
              // A cached MUTATOR must not execute outside the serialized tail
              // (or at all without a declared reset) — a confirmation run is an
              // execution like any other. Treated as a miss: the session runs,
              // and the draft gate rules there.
              if (
                scenario.world === 'mutates' &&
                (!recipe.api?.services?.reset || !destructiveFlowIds.has(task.work.flow.id))
              ) {
                return false
              }
              const candidate: BirthCandidate = {
                flow: task.work.flow,
                surface: task.surface,
                section: task.work.primary,
                scenario,
                ref,
              }
              const run = await executeOnce(candidate, task)
              if ('report' in run) {
                // Refusal/anomaly: the world (not the entry) is broken — count
                // the hit so no session is spent chasing it; routing unsettles
                // refused tasks and an anomaly aborts before persist.
                if (runRefusal || anomalyLatch) {
                  stashed.push({
                    sha: sha256Hex(scenarioYaml),
                    entry: {
                      candidate,
                      yaml: scenarioYaml,
                      result: {
                        id: scenario.id,
                        title: scenario.title,
                        binds: scenario.binds[0],
                        outcome: 'error',
                        durationMs: 0,
                      },
                      expectedReds: [...expectedReds],
                      fidelityUnreviewed: false,
                    },
                  })
                  continue
                }
                return false
              }
              if (!redPredictionHolds(run.result, expectedReds)) return false
              stashed.push({
                sha: sha256Hex(scenarioYaml),
                entry: {
                  candidate,
                  yaml: scenarioYaml,
                  result: run.result,
                  expectedReds: [...expectedReds],
                  fidelityUnreviewed: false,
                },
              })
            }
            // All reproduced: the hit stands, every candidate is stashed for
            // the fold, and their ids are reserved exactly as a session would.
            for (const { sha, entry } of stashed) {
              usedIds.add(entry.candidate.scenario.id)
              stash.set(sha, entry)
            }
            state.acceptedSha = stashed[0]!.sha
            return true
          },
        }
      }

      const workerStates = [...states.values()]
      const isMutatorState = (s: WorkerTaskState): boolean =>
        destructiveFlowIds.has(s.task.work.flow.id)
      const waveTasks = workerStates
        .filter((s) => s.task.work.flow.composedOf.length === 0 && !isMutatorState(s))
        .map(makeWorkerTask)
      const epicTasks = workerStates
        .filter((s) => s.task.work.flow.composedOf.length > 0 && !isMutatorState(s))
        .map(makeWorkerTask)
      // The serialized third wave: destructive flows (epics included — their
      // members settled in the earlier waves). The dirty marker outlives a
      // crash mid-wave so the next world boot resets before building on the
      // damage; the reset after persist clears it.
      const mutatorTasks = workerStates.filter(isMutatorState).map(makeWorkerTask)
      if (mutatorTasks.length > 0) {
        mutatorPhasePlanned = true
        fs.mkdirSync(path.dirname(guardWorldDirtyMarkerPath(repoRoot)), { recursive: true })
        fs.writeFileSync(guardWorldDirtyMarkerPath(repoRoot), 'guard-generate\n')
      }

      const mergeSummaries = (a: GuardSessionSummary, b: GuardSessionSummary): GuardSessionSummary => ({
        kind: a.kind,
        ran: a.ran + b.ran,
        fromCache: a.fromCache + b.fromCache,
        failed: a.failed + b.failed,
        allTransport: a.allTransport && b.allTransport,
        spent: {
          turns: a.spent.turns + b.spent.turns,
          tokens: a.spent.tokens + b.spent.tokens,
          costUsd: a.spent.costUsd + b.spent.costUsd,
        },
        ...(a.firstError ?? b.firstError ? { firstError: a.firstError ?? b.firstError } : {}),
      })

      const phaseA = await options.flowWorkerSession({
        tasks: waveTasks,
        epicTasks,
        mutatorTasks,
        docs,
        onTask: (done, total, outcome) => {
          if (outcome === 'settled') workerSettledCount++
          else if (outcome === 'blocked') workerBlockedCount++
          options.onWorkerProgress?.({ done, total, settled: workerSettledCount, blocked: workerBlockedCount })
        },
      })
      const byTask = phaseA.byTask
      let summary = phaseA.summary
      let fidelitySummary = phaseA.fidelitySummary

      // THE DEFERRED-MUTATOR RE-DISPATCH: tasks whose worker drafted a
      // `world: mutates` scenario mid-wave (the tool refused the execution)
      // re-run in a SECOND, tail-only seam invocation — serialized by the
      // seam's mutator-wave contract — unless the session settled anyway with
      // a rewrite that does not mutate. The gate opens for them by adding
      // their flow ids to `destructiveFlowIds` first.
      const deferredStates = [...states.values()].filter((s) => {
        if (!deferredMutatorRefs.has(taskKey(s.task))) return false
        const result = byTask.get(`flow:${s.task.work.flow.id}:${s.task.surface}`)
        return !(result?.kind === 'outcome' && result.outcome.kind === 'settled')
      })
      if (deferredStates.length > 0 && !anomalyLatch && !runRefusal) {
        for (const s of deferredStates) destructiveFlowIds.add(s.task.work.flow.id)
        if (!mutatorPhasePlanned) {
          mutatorPhasePlanned = true
          fs.mkdirSync(path.dirname(guardWorldDirtyMarkerPath(repoRoot)), { recursive: true })
          fs.writeFileSync(guardWorldDirtyMarkerPath(repoRoot), 'guard-generate\n')
        }
        const phaseB = await options.flowWorkerSession({
          tasks: [],
          epicTasks: [],
          mutatorTasks: deferredStates.map(makeWorkerTask),
          docs,
          onTask: (done, total, outcome) => {
            if (outcome === 'settled') workerSettledCount++
            else if (outcome === 'blocked') workerBlockedCount++
            options.onWorkerProgress?.({ done, total, settled: workerSettledCount, blocked: workerBlockedCount })
          },
        })
        for (const [workItem, result] of phaseB.byTask) byTask.set(workItem, result)
        summary = mergeSummaries(summary, phaseB.summary)
        if (phaseB.fidelitySummary) {
          fidelitySummary = fidelitySummary
            ? mergeSummaries(fidelitySummary, phaseB.fidelitySummary)
            : phaseB.fidelitySummary
        }
      }
      recordSessionSummary(summary)
      if (fidelitySummary) {
        recordSessionSummary(fidelitySummary)
        if (isSystemicSessionLoss(fidelitySummary)) workerFidelityLoss = fidelitySummary
      }

      // The C4 abort — before persist, so nothing corpus-side moved.
      if (anomalyLatch) {
        await sharedWorld.shutdown()
        return emptyResult('recipe-failed', {
          llmFailures: [...audit.failures(), ...sessionTallies],
          reason: noOpAnomalyReason(anomalyLatch, recipe),
        })
      }

      // The systemic-loss abort: every worker session died transport-class
      // and NOTHING completed (cache hits included) — persisting would let
      // an outage delete each changed flow's prior scenarios. Mirrors the
      // one-shot authoring wipeout, through the same channel.
      const anyCompleted = [...byTask.values()].some((r) => r.kind === 'outcome')
      if (!anyCompleted && isSystemicSessionLoss(summary)) {
        await sharedWorld.shutdown()
        return llmFailedResult(
          audit,
          'guard.generate',
          {
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
            interfaces: interfacesReport,
            externalServices,
            llmFailures: [...audit.failures(), ...sessionTallies],
          },
          sessionLossHead(summary),
        )
      }

      // THE ROUTING FOLD — strictly serial, in works order (the report reads
      // like the plan). Fills the same containers the one-shot stages fill;
      // persist below is byte-identical mechanics.
      //
      // A task that ends WITHOUT settling but whose executions observed the
      // unserved-route condition settles through `settleUnservedRoute` instead:
      // the world (a server the recipe does not declare) is the reason, and no
      // session — this one or the next generate's — can author past it.
      const settleIfUnserved = (ref: string, task: AuthorTask): boolean => {
        const observed = unservedByRef.get(ref)
        return observed ? settleUnservedRoute(task, observed) : false
      }
      for (const work of changedWorks) {
        for (const [surface] of work.plans) {
          const ref = `${work.flow.id}\0${surface}`
          const state = states.get(ref)
          if (!state) continue // build-failed / dead-entry: already errored above
          const task = state.task
          if (refusedTasks.has(ref)) {
            // The one recorded refusal is the record; the flow stays
            // unsettled (task.errored) and nothing settles or gaps here.
            task.errored = true
            continue
          }
          const result = byTask.get(`flow:${work.flow.id}:${surface}`)
          if (!result) {
            task.errored = true
            errors.push({
              doc: work.primary.doc,
              anchor: work.primary.anchor,
              kind: 'authoring',
              flowId: work.flow.id,
              surface,
              message: `flow worker (${surface}) never ran`,
            })
            continue
          }
          if (result.kind === 'failed') {
            if (settleIfUnserved(ref, task)) continue
            task.errored = true
            // When an execution errored, the error is built off the ENGINE's
            // birth capture (`errorFrom`) so the runner's masked stdout/stderr
            // excerpts ride the structured fields; the session's own failure
            // reason stays the message either way.
            const capture = lastExecutionErrorByRef.get(ref)
            const message = `flow worker (${surface}) ${result.reason}`
            errors.push(
              capture
                ? { ...errorFrom(capture), surface, message }
                : {
                    doc: work.primary.doc,
                    anchor: work.primary.anchor,
                    kind: 'authoring',
                    flowId: work.flow.id,
                    surface,
                    message,
                  },
            )
            if (state.pendingFidelityFinding) pushInto(fidelityRejections, ref, state.pendingFidelityFinding)
            continue
          }
          // The outcome schema is a flattened object (kind + optional payload
          // halves, paired by its superRefine — provider tool schemas need an
          // object root), so narrowing on `kind` no longer narrows the payload
          // fields: the `!`s below stand on the parse the loop already did.
          const outcome = result.outcome
          // A TAINTED flow whose worker completed a fresh answer (accepted
          // scenario or an honest block) overwrote the poisoned cache entry —
          // its taint clears at run end unless the session re-flagged it
          // (`taintFlow` re-adds through `flaggedFlows`, which wins the
          // ledger reconciliation). Mirrors the one-shot path's
          // `freshlyAuthoredTaints` discipline exactly.
          if (
            priorLedger.tainted[autoResolutionKey(work.flow.id, surface)] &&
            (outcome.kind === 'settled' || outcome.kind === 'blocked')
          ) {
            freshlyAuthoredTaints.add(autoResolutionKey(work.flow.id, surface))
          }
          if (outcome.kind === 'settled') {
            // Every accepted scenario, primary first — one for a from-scratch
            // author, several for an edit-mode settle. Each sha must be a stash
            // entry of THIS task; the seam's reject hook already converts a
            // foreign sha to `malformed`, this is belt-and-braces.
            const accepted = settledScenariosOf(outcome).map((s) => ({ s, entry: stash.get(s.scenarioYamlSha) }))
            const foreign = accepted.find(({ entry }) => !entry || entry.candidate.ref !== ref)
            if (foreign || accepted.length === 0) {
              task.errored = true
              errors.push({
                doc: work.primary.doc,
                anchor: work.primary.anchor,
                kind: 'authoring',
                flowId: work.flow.id,
                surface,
                message: `flow worker (${surface}) settled with a sha the engine never accepted`,
              })
              continue
            }
            // The outcome may only list drops the engine recorded through
            // `drop_scenario`; an invented one unsettles the flow.
            const recorded = new Set(states.get(ref)?.drops.map((d) => d.id) ?? [])
            const invented = (outcome.droppedScenarios ?? []).filter((d) => !recorded.has(d.id))
            if (invented.length > 0) {
              task.errored = true
              errors.push({
                doc: work.primary.doc,
                anchor: work.primary.anchor,
                kind: 'authoring',
                flowId: work.flow.id,
                surface,
                message: `flow worker (${surface}) reported dropping ${invented.map((d) => d.id).join(', ')} without a \`drop_scenario\` call the engine accepted`,
              })
              continue
            }
            const drops = states.get(ref)?.drops ?? []
            if (drops.length > 0) dropsByRef.set(ref, drops.map((d) => ({ ...d })))
            for (const { entry } of accepted) {
              if (entry!.result.outcome === 'pass') {
                if (entry!.fidelityUnreviewed) {
                  fidelityUnreviewed++
                  unadjudicatedRefs.add(ref)
                }
                pushInto(persisted, ref, entry!.candidate)
              } else {
                // A committed red: its diagnosis is the WORKER's confirmed
                // prediction — the session path's triage.
                const finding = toFinding({ candidate: entry!.candidate, result: entry!.result })
                const declared = entry!.expectedReds.find(
                  (r) => r.step === (entry!.result.failure?.step ?? 1),
                )
                if (declared) finding.expectedRed = declared
                pushInto(failedTests, ref, { candidate: entry!.candidate, finding })
              }
            }
            continue
          }
          if (outcome.kind === 'blocked') {
            const capabilities = [
              ...new Set(outcome.perMilestone!.map((m) => m.capability.trim().toLowerCase()).filter(Boolean)),
            ]
            const blockedOn = enrichBlockedOn(
              capabilities.length > 0 ? capabilities : ['world-state the sandbox cannot provide'],
              externalServices,
            )
            const reason = composeBlockedOnReason(blockedOn, oneLine(work.flow.title))
            work.gaps.push({ surface, kind: 'blocked-on', reason })
            coverageGaps.push({
              doc: work.primary.doc,
              anchor: work.primary.anchor,
              kind: 'blocked-on',
              flowId: work.flow.id,
              surface,
              reason,
            })
            continue
          }
          if (outcome.kind === 'journey-defect') {
            if (settleIfUnserved(ref, task)) continue
            task.errored = true
            errors.push({
              doc: work.primary.doc,
              anchor: work.primary.anchor,
              kind: 'authoring',
              flowId: work.flow.id,
              surface,
              message: `flow worker (${surface}) reported a journey defect on interface "${outcome.report!.interfaceId}": ${oneLine(outcome.report!.detail)} — the flow stays unsettled until the catalog (or its derivation) is fixed`,
            })
            continue
          }
          // `retired` — the worker gave the flow up this run. A retirement the
          // unserved-route condition explains settles as the missing-server gap
          // (the world, not the test, is what defeated the worker); otherwise
          // the ledger is the record — a pending fidelity rejection owns the
          // bump instead (one auto-resolution per flow per run, as on the
          // one-shot path).
          if (settleIfUnserved(ref, task)) continue
          taintFlow(work.flow.id, surface, work.flow.title, oneLine(outcome.lastEvidence!))
          if (state.pendingFidelityFinding) {
            pushInto(fidelityRejections, ref, state.pendingFidelityFinding)
            continue
          }
          const key = autoResolutionKey(work.flow.id, surface)
          if (autoResolveCount(key) < escalateAfter) {
            bumpLedger(key, 'worker')
            autoRetiredRefs.add(ref)
          } else {
            const finding: GuardBirthFinding = {
              doc: work.primary.doc,
              anchor: work.primary.anchor,
              title: work.flow.title,
              step: 1,
              expected: "a scenario that verifies the flow's milestones",
              actual: `the flow worker retired the flow after ${outcome.attempts} attempt(s): ${outcome.lastEvidence}`,
              flowId: work.flow.id,
              surface,
              claim: work.flow.milestones[0].claimTitle,
              autoResolveEscalation: { count: autoResolveCount(key), source: 'worker' },
            }
            pushInto(withheldFailures, ref, finding)
          }
        }
      }

      // The refusal record names EVERY flow it short-circuited. Worker rounds
      // are single-candidate, so the round that hit the refusal (birth.ts)
      // names one flow; the latch's short-circuit set holds the rest — every
      // task whose execution was declined or skipped after the latch. (The
      // cast re-widens the read: the latch is set inside `executeOnce`, an
      // assignment TS's narrowing cannot see, so it believes the initializer.)
      const latchedRefusal = runRefusal as GuardRunRefusal | null
      if (latchedRefusal && refusedTasks.size > 0) {
        runRefusal = {
          ...latchedRefusal,
          flowIds: [
            ...new Set([...latchedRefusal.flowIds, ...[...refusedTasks].map((ref) => ref.split('\0')[0])]),
          ],
        }
      }
    }
  }

  // THE ADJUDICATION CARVE-OUT (plan item 88), fidelity half. Every OTHER
  // stage aborts the run (`llm-failed`, nothing written) when it loses every
  // call, because those stages gate CONTENT: a blind extraction or a blind
  // worker pool would rewrite the committed corpus with an outage's noise. The
  // fidelity children gate VERDICTS about greens the confirmation run already
  // executed against the real app — a lost review means a green test persists
  // unreviewed. That costs ANNOTATION, not correctness, and it is the LAST
  // spend of a generate: aborting here would throw away the whole run's
  // authoring + execution spend over an outage that started after the user's
  // confirm. So a total child loss never aborts — it is recorded here, rides
  // `guard/result.json`, and every surface that renders the generate summary
  // says the corpus shipped unadjudicated. (The TRIAGE stage is gone — plan 04
  // step 20: a committed red's adjudication is the worker's own confirmed
  // `expectedReds` prediction, made before the red was ever accepted, so there
  // is no triage verdict to lose.)
  const unadjudicated: GuardUnadjudicatedStage[] = []
  // `workerFidelityLoss`: every fidelity CHILD dispatch died transport-class,
  // so the greens they should have reviewed persisted unreviewed.
  if (workerFidelityLoss) {
    unadjudicated.push({ stage: 'guard.fidelity', affected: fidelityUnreviewed })
  }

  // The last execution is behind us — tear the shared world down BEFORE persist,
  // so the write phase can never race a live compose project (and a refused or
  // clean run alike leaves the host swept; crashes fall to the item-94 channel).
  await sharedWorld.shutdown()

  // The mutator wave ran against that world: restore it so its damage (a changed
  // password, a deleted account) reaches no later run. A recipe with no `reset`
  // leaves the marker standing — the honest record that the world is dirty.
  if (mutatorPhasePlanned && recipe.api?.services?.reset) {
    const reset = await runBuild(repoRoot, recipe.api.services.reset, recipe.env, DEFAULT_BUILD_TIMEOUT_MS)
    if (reset.ok) fs.rmSync(guardWorldDirtyMarkerPath(repoRoot), { force: true })
  }

  // 8. Persist — INDEPENDENTLY, per scenario, whatever its confirmation run said.
  // A test that passed is written; a test that FAILED is written too, with its
  // worker-predicted diagnosis recorded and `status: 'failing'` in the manifest —
  // a committed failing test is a decision surface, so its flow SETTLES. Only a
  // fidelity rejection (the test itself is wrong), a retirement, or an error
  // withholds work and leaves the flow unsettled for the next generate.
  const written: GeneratedScenarioInfo[] = []
  const retiredReport: (GuardManifestRetiredScenario & { flowId: string })[] = []
  const birthFindings: GuardBirthFinding[] = []
  const workingManifest = new Map<string, GuardManifestFlow>()
  let flowsSettled = 0
  const settleTotal = changedWorks.length
  const writeWorkingManifest = (): void => {
    const flows = [...workingManifest.values()].sort((a, b) => a.flowId.localeCompare(b.flowId))
    // The persisted gap record: every LIVE section no flow binds, so the next
    // planner can tell "seen and deliberately uncovered" from "never seen" —
    // without it those sections re-enter the work set on every generate. Only a
    // run that judged the whole universe may recompute it (no extraction
    // failures, no unsettled areas); a degraded run carries the prior record
    // forward so pins are never lost to a transient failure. Sections that
    // vanished or became bound drop out naturally.
    const wholeUniverseJudged = extractionFailures.length === 0 && synthesis.unsettled.length === 0
    const boundKeys = new Set(flows.flatMap((f) => f.bindings.map((b) => `${b.doc}\0${b.anchor}`)))
    const gapSections = wholeUniverseJudged
      ? plan.sections
          .filter((s) => !boundKeys.has(`${s.doc}\0${s.anchor}`))
          .map((s) => ({ doc: s.doc, anchor: s.anchor, fingerprint: s.fingerprint }))
      : (priorGapSections ?? []).filter((g) => !boundKeys.has(`${g.doc}\0${g.anchor}`))
    // Every document extraction read, with the content hash its cache entry is
    // keyed on — what the next generate's claim-diff gate needs to find the
    // prior extraction of a document whose text has since moved.
    const manifestDocs = docs.map((d) => ({ doc: d.doc, contentHash: docContentHash(d.content) }))
    writeManifest(repoRoot, { flows, gapSections, docs: manifestDocs })
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
    // The flow re-authored. Its survivors land first; its prior files are
    // deleted AFTER the commit loop, minus the ids re-written (an edited prior
    // keeps its id and is simply overwritten) and minus the priors CARRIED on
    // a surface that produced nothing this run (a worker that blocked or
    // retired must not erase real coverage) — so a failed edit never leaves
    // the flow with less than it had.
    const slug = areaOrDocSlug(work.primary)
    const scenarios: GuardManifestScenario[] = []
    const retired: GuardManifestRetiredScenario[] = []
    const priorIds = new Set(work.prior?.scenarios.map((s) => s.id) ?? [])
    // Where each prior file lives NOW — captured before any write, so an edited
    // prior re-homed under a new area slug still has its old file removed.
    const priorFiles = scenarioFileIndex(repoRoot)
    const keptIds = new Set<string>()
    const writtenFiles = new Map<string, string>()
    const priorsOnSurface = priorScenariosBySurface(work)
    let unsettledFlow = false
    for (const [surface] of work.plans) {
      const ref = `${work.flow.id}\0${surface}`
      const task = taskByKey.get(ref)
      const committedHere: string[] = []
      const dropsHere = dropsByRef.get(ref) ?? []
      for (const d of dropsHere) retired.push({ id: d.id, surface, reason: d.reason })
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
        // A failing test COMMITS WITH its diagnosis: the manifest entry
        // is the durable record — it travels with the corpus and survives every
        // no-op generate, so the report's committed row re-derives from it.
        // The drivers are read off the STEPS the model actually authored, not off
        // the surface the flow was authored FOR: a cli plan whose scenario ends up
        // driving the browser records both, and every per-driver tally follows.
        scenarios.push({
          id: c.scenario.id,
          drivers: guardScenarioDrivers(c.scenario),
          status,
          ...(finding ? { diagnosis: diagnosisOf(finding, file) } : {}),
        })
        keptIds.add(c.scenario.id)
        committedHere.push(c.scenario.id)
        writtenFiles.set(c.scenario.id, path.resolve(repoRoot, file))
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
      if (
        rejections.length > 0 ||
        withheld.length > 0 ||
        autoRetiredRefs.has(ref) ||
        unadjudicatedRefs.has(ref) ||
        task?.errored
      ) {
        unsettledFlow = true
      }
      // A surface that committed nothing and dropped nothing CARRIES the priors
      // it owns: their files stay and their rows re-list, so a blocked or
      // retired edit never erases coverage (the flow is unsettled anyway when
      // the worker did not settle). An id a sibling surface re-wrote this run
      // is that sibling's now, not a carried prior.
      if (committedHere.length === 0 && dropsHere.length === 0) {
        for (const s of priorsOnSurface.get(surface) ?? []) {
          if (keptIds.has(s.id)) continue
          scenarios.push(s)
          keptIds.add(s.id)
        }
      }
      if (committedHere.length > 0) {
        for (const r of retired) if (r.surface === surface) r.replacedBy = [...committedHere]
      }
    }
    // Now the deletions: every prior id neither re-written nor carried, plus
    // the OLD file of a re-written id whose path moved.
    const stale: string[] = []
    for (const id of priorIds) {
      const oldFile = priorFiles.get(id)
      if (!oldFile) continue
      const newFile = writtenFiles.get(id)
      if (!keptIds.has(id) || (newFile !== undefined && newFile !== oldFile)) stale.push(oldFile)
    }
    for (const file of stale) if (fs.existsSync(file)) fs.rmSync(file)
    // A flow left unsettled on some surface keeps a manifest entry (its committed
    // tests are real coverage) but records NO inputs hash, so the next generate
    // re-runs it. A committed failing test is NOT such a surface — it settled.
    for (const r of retired) retiredReport.push({ flowId: work.flow.id, ...r })
    const entry = enforceSettleInvariant(manifestEntry(work, scenarios, unsettledFlow ? null : work.inputsHash, retired))
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

  // Reconcile the durable ledger ONCE — counts and taints together:
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
  // reported bucket — a committed passing test or a fidelity rejection. (The
  // one-shot path also counted fidelity-discard rows; on the session path a
  // discarded green is revised in-loop or ends `retired`, which reaches no
  // bucket.) A pass whose review could not complete reaches no bucket and is
  // not counted.
  const birthPassed =
    written.filter((w) => w.status === 'passing').length +
    [...fidelityRejections.values()].reduce((n, list) => n + list.length, 0)

  return {
    status: 'ok',
    recipe: recipeMeta,
    recipeFingerprint,
    sectionsTotal: plan.sections.length,
    sectionsChanged: plan.work.length,
    skippedUnchanged: plan.sections.length - plan.work.length,
    // A prune rewrites a committed file, so it is never a no-op run.
    noChanges: changedWorks.length === 0 && removedFlows === 0 && prunedFlows === 0,
    cosmeticSections: claimDiff.cosmetic.size,
    claimDiffCalls: claimDiff.calls,
    retiredScenarios: retiredReport,
    written,
    coverageGaps,
    birthFindings,
    errors,
    extractionFailures,
    llmFailures: [...audit.failures(), ...sessionTallies],
    unadjudicated,
    orphaned: orphanedSections,
    birthPassed,
    orphanedDismissals,
    orphanedFlowDismissals,
    autoResolved,
    flows: flowsReport,
    interfaces: interfacesReport,
    externalServices,
    manifestPath: manifestPath(repoRoot),
    ...(entryPreflightFailure ? { entryPreflight: entryPreflightFailure } : {}),
    ...(runRefusal ? { refusal: runRefusal } : {}),
  }
}

/** Every path a plan's interfaces enter through — what the flow will actually drive,
 *  and therefore what decides its server (Gate B, the post-match server binding). */
function interfacePaths(plan: RealizationPlan): string[] {
  const paths: string[] = []
  for (const iface of plan.interfaces) {
    const entry = iface.entry as { path?: string }
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

/** A committed scenario's yaml + parsed form, indexed by id for edit mode. */
type PriorScenarioIndex = ReadonlyMap<string, { yaml: string; scenario: GuardScenario }>

/**
 * Which surface each of the flow's committed scenarios belongs to — the
 * deterministic owner rule for edit mode: the first runnable driver (registry
 * order) that both the scenario drives and the flow planned this run; a
 * scenario driving no planned surface falls to the first planned surface, so
 * every prior is briefed somewhere and never twice.
 */
function priorScenariosBySurface(work: FlowWork): Map<GuardDriverId, GuardManifestScenario[]> {
  const out = new Map<GuardDriverId, GuardManifestScenario[]>()
  const planned = [...work.plans.keys()]
  if (planned.length === 0) return out
  for (const s of work.prior?.scenarios ?? []) {
    const owner = runnableDriverIds.find((d) => s.drivers.includes(d) && work.plans.has(d)) ?? planned[0]!
    const list = out.get(owner)
    if (list) list.push(s)
    else out.set(owner, [s])
  }
  return out
}

/** The bound sections whose text moved since the flow's committed entry. */
function movedSectionsFor(work: FlowWork): { doc: string; anchor: string; heading: string }[] {
  const priorFp = new Map((work.prior?.bindings ?? []).map((b) => [flowSectionKey(b.doc, b.anchor), b.fingerprint]))
  const out: { doc: string; anchor: string; heading: string }[] = []
  for (const b of work.flow.bindings) {
    if (priorFp.get(flowSectionKey(b.doc, b.anchor)) === b.fingerprint) continue
    const section = [...work.sections.values()].find((s) => s.doc === b.doc && s.anchor === b.anchor)
    out.push({ doc: b.doc, anchor: b.anchor, heading: section?.headingText ?? b.anchor })
  }
  return out
}

/** The plan's interfaces whose fingerprint differs from what a prior scenario recorded. */
function movedInterfacesFor(plan: RealizationPlan, priors: readonly GuardScenario[]): string[] {
  const live = new Map(plan.interfaces.map((j) => [j.id, j.fingerprint]))
  const moved = new Set<string>()
  for (const s of priors) {
    const path = s.interface?.path ?? []
    const fps = s.interface?.fingerprints ?? []
    path.forEach((id, i) => {
      const now = live.get(id)
      if (now !== undefined && fps[i] !== undefined && fps[i] !== now) moved.add(id)
    })
  }
  return [...moved].sort()
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
}

const taskKey = (task: { work: FlowWork; surface: GuardDriverId }): string => `${task.work.flow.id}\0${task.surface}`

function manifestEntry(
  work: FlowWork,
  scenarios: GuardManifestScenario[],
  generationInputsHash: string | null,
  retiredScenarios: GuardManifestRetiredScenario[] = [],
): GuardManifestFlow {
  return {
    flowId: work.flow.id,
    flowFingerprint: work.flow.fingerprint,
    bindings: work.flow.bindings,
    scenarios: scenarios.slice().sort((a, b) => a.id.localeCompare(b.id)),
    retiredScenarios: retiredScenarios.slice().sort((a, b) => a.id.localeCompare(b.id)),
    // Every surface that got a PLAN records the interfaces it walks — including the
    // surfaces that then failed to author (blocked-on / errored) and contribute no
    // scenario. That is the only record that the spec DOES reach this code path,
    // so the interfaces view never calls a matched-but-blocked path unmentioned.
    interfaces: [...work.plans.entries()]
      .map(([surface, plan]) => ({ surface, interfaceIds: plan.interfaces.map((j) => j.id) }))
      .filter((j) => j.interfaceIds.length > 0)
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
 * (where a scenario could exist) UNION every surface the interface mapper detected
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
  return isRunnableDriver(surface) && driverPrepared(recipe, surface) && (catalogs.get(surface)?.interfaces.length ?? 0) > 0
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

/** What ONE analysis pass of the working tree yields this run — see {@link InterfaceProvider}. */
interface MappedSurface {
  interfaces: Interface[]
  /** The catalog's resource registry, when the catalog carries one — see
   *  {@link InterfaceProvider}. Rides both the provider and snapshot paths. */
  resources?: Record<string, InterfaceResource[]>
  externalServices: DetectedExternalService[]
  /** The app's own outbound request construction — the stub-fidelity grounding. */
  outboundRequests: OutboundRequest[]
  /** The detected datastore + its parsed schema — the seed draft's whole grounding. */
  database: SeedDraftDatabase | null
  /** The connection URLs the app writes down — the generated datastore's source. */
  datastoreUrls: DatastoreUrlRef[]
}

/**
 * The interface catalog for this run: the injected mapper, else the last mapping's
 * snapshot, else empty — and, on EITHER path, the hand-authored catalog merged
 * over the top. A mapper that throws degrades to the snapshot for the same
 * reason it degrades to empty — the spec half of the pipeline must keep working on
 * a repo the mapper chokes on.
 *
 * The authored merge is on the SUCCESS path deliberately (2026-08-17). Before it,
 * this function reached for the on-disk catalog only when the mapper THREW, so a
 * healthy mapping — which derives `cli` and `api` and no other surface — simply
 * replaced every hand-authored web task, and the flows that grounded on them
 * settled as `no-interface` while the run stayed green. Reaching for the authored
 * file only on failure protected exactly the case that never happens.
 *
 * Exported for the test that pins that: the seam is one function, and what it
 * merges is the whole difference between an authored surface reaching the
 * generator and vanishing.
 */
export async function mapInterfacesSafely(repoRoot: string, provider?: InterfaceProvider): Promise<MappedSurface> {
  // A present-but-broken authored file THROWS out of here rather than reading as
  // empty (see `readAuthoredInterfaceCatalog`): losing the surface quietly is the
  // failure being fixed, so it is not a degradation this path offers.
  const authored = readAuthoredInterfaceCatalog(repoRoot)
  if (provider) {
    try {
      const mapped = await provider()
      return {
        interfaces: mergeInterfaceLists(mapped.interfaces, authored?.interfaces ?? []),
        ...withResources(mergeRegistries(mapped.resources, authored?.resources)),
        externalServices: mapped.externalServices ?? [],
        database: mapped.database ?? null,
        datastoreUrls: mapped.datastoreUrls ?? [],
        outboundRequests: mapped.outboundRequests ?? [],
      }
    } catch {
      /* fall through to the snapshot */
    }
  }
  // The snapshot carries interfaces (and their resource registry) only — external
  // services are derived from the working tree, never persisted, so a degraded
  // run reports none rather than a stale list.
  const snapshot = readMergedInterfaceCatalog(repoRoot)
  return {
    interfaces: snapshot?.interfaces ?? [],
    ...withResources(snapshot?.resources),
    externalServices: [],
    database: null,
    datastoreUrls: [],
    outboundRequests: [],
  }
}

/** A registry rides along only when there is one — an absent one is not empty. */
function withResources(
  resources: Record<string, InterfaceResource[]> | undefined,
): { resources?: Record<string, InterfaceResource[]> } {
  return resources && Object.keys(resources).length > 0 ? { resources } : {}
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
      `was aborted before writing anything — no scenario file, manifest, ledger or finding was touched. Fix the ` +
      `recipe entry (it likely names a stale build output or a placeholder such as \`true\`) and re-run ` +
      `\`truecourse guard generate\`.`
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
    `writing anything — no scenario file, manifest, ledger or finding was touched. Fix the recipe's api serve ` +
    `command (it likely boots a placeholder or the wrong service) and re-run \`truecourse guard generate\`.`
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
    interfaces: { total: 0, bySurface: {} },
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
  // The registry row names the block that prepares the surface, so a driver
  // landing needs no edit here (item 132: web shipped its runner, and these
  // hardcoded branches kept answering `false` for it).
  const key = driverRecipeKey(driver)
  return key !== undefined && recipe[key] !== undefined
}

/** The capability noun a prep-missing blocked-on gap names. */
function missingPrepNoun(driver: GuardDriverId): string {
  const key = driverRecipeKey(driver)
  return key === undefined || key === 'entry' ? 'a recipe `entry`' : `a recipe \`${key}\` block`
}

/** The `dismissed` coverage-gap reason: the subject one-liner, plus the note if any. */
function dismissedReason(subject: string, note?: string): string {
  const base = `dismissed: ${oneLine(subject)}`
  return note ? `${base} — ${oneLine(note)}` : base
}

// --- Worker pre-flight checkers ---------------------------------------------

/**
 * One authored scenario's composition defect against THIS recipe, or null. The
 * cli rule needs the entrypoint (a step's `run` is argv appended to it); the api
 * rules are self-contained (an interface has to chain with itself).
 */
function compositionDefectOf(scenario: RawGeneratedScenario, recipe: Recipe): string | null {
  return scenarioCompositionDefect(
    { steps: scenario.steps, ...(scenario.setup ? { setup: scenario.setup } : {}) },
    recipe.entry,
  )
}

/** The flow milestones no step of the scenario realizes. */
function uncoveredMilestones(flow: GuardFlow, scenario: RawGeneratedScenario): number[] {
  const covered = new Set(
    scenario.steps.map((s) => milestoneOrder(s.milestone)).filter((m): m is number => typeof m === 'number'),
  )
  return flow.milestones.map((m) => m.order).filter((order) => !covered.has(order))
}

/** `milestone` values on the scenario's steps that match no milestone of the flow. */
function unknownMilestones(flow: GuardFlow, scenario: RawGeneratedScenario): number[] {
  const known = new Set(flow.milestones.map((m) => m.order))
  const out: number[] = []
  for (const step of scenario.steps) {
    const order = milestoneOrder(step.milestone)
    if (typeof order === 'number' && !known.has(order) && !out.includes(order)) out.push(order)
  }
  return out
}

/**
 * Assemble the FULL authoring context for one task — the grounding block
 * (interface contracts, the bound server's reachable other-operations, outbound
 * hints, places) plus `buildAuthorCtx`'s payload. ONE assembly for both authoring
 * paths: the one-shot runner call and the flow-worker session's briefing (plan
 * 04 step 17 — "today's `buildAuthorCtx` payload, verbatim sourcing").
 *
 * The setup catalog is the BOUND server's own surface. An operation the route
 * manifest positively attributes to ANOTHER app is unreachable from this
 * scenario, and advertising it is exactly how cal.com's `/v2/...` paths ended up
 * in a scenario bound to `apps/web`. An operation nobody claims stays offered —
 * unknown is not foreign (R6). The flow's OWN operations need no such filter:
 * Gate B already bound the server from those very paths. Note `apiInterfaces`
 * arrives pre-gated: it is read off the surface catalogs, which exclude every
 * procedure-bearing interface (item 12, `buildSurfaceCatalogs`).
 */
function assembleAuthorCtx(opts: {
  task: AuthorTask
  recipe: Recipe
  probes: ProbeTranscript[]
  opIndex: OperationEntry[]
  docText: ReadonlyMap<string, string>
  externalServices: ExternalServiceHint[]
  apiInterfaces: Interface[]
  outboundRequests: OutboundRequestHint[]
  outboundRequestsOverflow: number
  resources?: Record<string, InterfaceResource[]>
  serverIndex: ServerRouteIndex
}): AuthorUserContext {
  const { task } = opts
  const interfaceContracts = buildInterfaceContractHints(task.plan.interfaces)
  const boundApp = appDirOfServer(opts.serverIndex, task.server)
  const reachableInterfaces = boundApp
    ? opts.apiInterfaces.filter((j) => !servedByOtherApp(opts.serverIndex, boundApp, interfaceEntryPath(j)))
    : opts.apiInterfaces
  const other = buildOtherOperationHints(reachableInterfaces, interfaceContracts)
  return buildAuthorCtx(
    task.work,
    task.surface,
    task.plan,
    opts.recipe,
    opts.probes,
    opts.opIndex,
    opts.docText,
    opts.externalServices,
    opts.serverIndex,
    {
      interfaceContracts,
      otherOperations: other.operations,
      otherOperationsOverflow: other.overflow,
      outboundRequests: opts.outboundRequests,
      outboundRequestsOverflow: opts.outboundRequestsOverflow,
      resources: buildResourceHints(task.plan.interfaces, opts.resources),
    },
  )
}

// --- Flow-worker helpers (plan 04 step 17) -----------------------------------

/** Indent every line of a program-output excerpt so it reads as one nested block. */
function indentExcerpt(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

/** Cap a tool-result excerpt — the worker sees the head, never a flood. */
function capExcerpt(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}…(truncated)` : text
}

/**
 * The condensed run report a worker tool returns: the outcome, the failing step
 * with expected/actual, the focus excerpts (tail-bounded by the runner, capped
 * again here), and the failed milestone — enough to revise on, never the whole
 * transcript.
 */
function renderCondensedResult(result: GuardScenarioResult): string {
  if (result.outcome === 'pass') return `PASS — every step met its expectation (${result.durationMs}ms).`
  const f = result.failure
  const lines = [
    `${result.outcome.toUpperCase()} at step ${f?.step ?? '?'}${
      result.failedMilestone ? ` (milestone ${result.failedMilestone})` : ''
    } (${result.durationMs}ms).`,
  ]
  if (f) {
    lines.push(`expected: ${f.expected}`, `actual:   ${f.actual}`)
    if (f.stdout) lines.push('stdout:', indentExcerpt(capExcerpt(f.stdout)))
    if (f.stderr) lines.push('stderr:', indentExcerpt(capExcerpt(f.stderr)))
  }
  if (result.unservedRoute) {
    lines.push(
      'NOTE: the failing request 404ed on a path another workspace app serves — the recipe declares no server for it. Nothing you author can reach it; end the session with a `blocked` outcome naming the missing server.',
    )
  }
  if (result.blockedOn) {
    lines.push(
      `BLOCKED — the scenario binds the supplied dependency "${result.blockedOn.dependency}" and no instance is registered. End the session with a \`blocked\` outcome naming it.`,
    )
  }
  return lines.join('\n')
}

/** The refusal message a worker tool returns once the runner declined the run —
 *  a WORLD defect, stated as one; no scenario the worker authors can get past it. */
function workerRefusalMessage(refusal: GuardRunRefusal): string {
  return (
    `the runner REFUSED the run before any scenario executed: ${refusal.message}\n` +
    'This is a configuration/world defect (recorded once, run-level) — nothing you author can run this generate. ' +
    'Stop executing and end the session with the outcome that best states your findings; the flow stays unsettled until the configuration is fixed.'
  )
}

/**
 * Whether the confirmation's observed actual matches a declared prediction:
 * whitespace-normalized equality or containment. Containment, deliberately —
 * the worker copies `predictedActual` off its own run, and the runner's display
 * truncation must not fail an honest prediction.
 */
function actualMatchesPrediction(actual: string, predicted: string): boolean {
  const norm = (t: string): string => t.replace(/\s+/g, ' ').trim()
  const na = norm(actual)
  const np = norm(predicted)
  return na === np || na.includes(np)
}

/**
 * The fidelity CHILD's opening message (plan 04 step 18): the flow's claims with
 * their section texts and the candidate yaml — the exact material the one-shot
 * reviewer saw (`buildFidelityUserPrompt`, verbatim sourcing) — plus the
 * engine's confirmation capture, which only the session path has.
 */
function workerFidelityBriefing(work: FlowWork, candidate: BirthCandidate, capture: string): string {
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
  return [
    buildFidelityUserPrompt(ctx),
    '',
    'CONFIRMATION CAPTURE (the engine ran this scenario in a fresh sandbox just now):',
    capture,
  ].join('\n')
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
    interfaceContracts: InterfaceContractHint[]
    otherOperations: InterfaceContractHint[]
    otherOperationsOverflow: number
    outboundRequests: OutboundRequestHint[]
    outboundRequestsOverflow: number
    /** The plan's own places, `of`-ancestors included — see `buildResourceHints`. */
    resources: InterfaceResource[]
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
  return {
    flow: { id: work.flow.id, title: work.flow.title, goal: work.flow.goal },
    milestones: authorMilestones(work, plan, surface),
    interfacePath: plan.interfaces.map((j) => j.id),
    // The plan's PLACES — surface-agnostic (a web plan authors as a cli-driver
    // scenario with web steps), and gated on non-empty like every grounding block.
    ...(grounding.resources.length > 0 ? { resources: grounding.resources } : {}),
    areaTags: [...new Set(sections.flatMap((s) => s.areaTags))],
    driver: surface,
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
          ...(grounding.interfaceContracts.length > 0 ? { interfaceContracts: grounding.interfaceContracts } : {}),
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
      : surface === 'web'
        ? webPreparationCtx(recipe)
        : { recipeEntry: recipe.entry }),
    recipeBuild: recipe.build,
    probes,
  }
}

/** The web batch's preparation framing: how the surface is served and probed, plus
 *  the cli entrypoint when the repo has one (a web scenario's seeding `run` steps
 *  append to it). Defaults come from `resolveWebSurface` — the ONE place the web
 *  block's defaults exist — so the prompt can never disagree with the runner.
 *  The seed's FIXTURE catalog rides here too: it is how a web scenario learns a
 *  login principal exists at all — without it every auth-gated flow blocks on
 *  the word "credentials" while the seeded user sits in the database (documenso
 *  2026-08-28: 114 of 119 web flows). */
function webPreparationCtx(
  recipe: Recipe,
): Pick<AuthorUserContext, 'recipeServe' | 'recipeHealthPath' | 'recipeEntry' | 'fixtures'> {
  const web = resolveWebSurface(recipe)
  const fixtures = recipeFixtureCatalog(recipe)
  return {
    ...(web ? { recipeServe: [...web.serve], recipeHealthPath: web.healthPath } : {}),
    ...(recipe.entry ? { recipeEntry: recipe.entry } : {}),
    ...(fixtures.length > 0 ? { fixtures } : {}),
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
        .flatMap((s) => realizationLines(s.interface, surface))
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

/** One interface's entry path (`''` when it has none) — the route-manifest lookup key. */
function interfaceEntryPath(iface: Interface): string {
  const entry = iface.entry as { path?: string }
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
  const failedMilestone = milestoneOrder(scenario.steps[step - 1]?.milestone)
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
    const m = milestoneOrder(scenario.steps[i].milestone)
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
    // The worker path's adjudication (plan 04 step 17) — the confirmed red
    // prediction takes the triage verdict's place on session-generated reds.
    ...(finding.expectedRed !== undefined ? { expectedRed: finding.expectedRed } : {}),
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

// --- Fidelity (worker-child) helpers ------------------------------------------

/** A scenario's BEHAVIORAL identity — the fields the reviewer judges, excluding the
 *  engine-assigned `id`/`binds`/`flow`/`interface`/`guard` bookkeeping (which churns on
 *  re-allocation without changing what the scenario verifies). */
function scenarioBehavior(scenario: GuardScenario): string {
  return JSON.stringify({
    title: scenario.title,
    setup: scenario.setup ?? null,
    steps: scenario.steps,
    normalize: scenario.normalize ?? [],
  })
}

// --- C-lite sibling briefings ------------------------------------------------

/** How many green siblings a worker briefing carries, and how big one may be —
 *  grounding for the arrange verbs, never a second corpus. */
const SIBLING_BRIEFING_MAX = 3
const SIBLING_YAML_MAX_CHARS = 6_000

interface SiblingScenario {
  id: string
  flowId?: string
  interfaces: readonly string[]
  yaml: string
}

/** The committed corpus's PASSING scenarios with the interfaces they walk —
 *  what a worker may copy proven arrange verbs from. */
function buildSiblingIndex(
  repoRoot: string,
  priorFlows: ReadonlyMap<string, GuardManifestFlow>,
): SiblingScenario[] {
  const status = new Map<string, string>()
  for (const flow of priorFlows.values()) {
    for (const s of flow.scenarios) status.set(s.id, s.status)
  }
  const out: SiblingScenario[] = []
  for (const scenario of loadScenarios(repoRoot).scenarios) {
    if (status.get(scenario.id) !== 'passing') continue
    const interfaces = scenario.interface?.path ?? []
    if (interfaces.length === 0) continue
    const yamlText = serializeScenarioYaml(scenario)
    if (yamlText.length > SIBLING_YAML_MAX_CHARS) continue
    out.push({
      id: scenario.id,
      ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
      interfaces,
      yaml: yamlText,
    })
  }
  return out
}

/** The task's best-overlapping green siblings, most shared interfaces first. */
function settledSiblings(index: readonly SiblingScenario[], task: AuthorTask): SiblingScenario[] {
  const wanted = new Set(task.plan.interfaces.map((j) => j.id))
  return index
    .map((s) => ({ s, overlap: s.interfaces.filter((id) => wanted.has(id)).length }))
    .filter((o) => o.overlap > 0 && o.s.flowId !== task.work.flow.id)
    .sort((a, b) => b.overlap - a.overlap || a.s.id.localeCompare(b.s.id))
    .slice(0, SIBLING_BRIEFING_MAX)
    .map((o) => o.s)
}

