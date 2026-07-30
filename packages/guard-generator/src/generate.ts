/**
 * `guard generate` orchestration — the LLM pipeline that turns spec sections into
 * committed scenarios. Sections remain the binding/staleness unit; the LLM reads
 * WHOLE documents. Stages, all output-only (the model returns content; the engine
 * writes):
 *
 *   1. recipe   load `recipe.json`, or discover + verify one (proposal-only LLM).
 *   2. index    deterministic doc universe + section index + change detection.
 *   3. extract  one cached call per work document → claims + untestable notes,
 *               anchors snapped to the live index; per-section coverage derived.
 *   4. author   the cli claims from changed sections, in batches carrying the
 *               whole-document context (cached per claim) → scenario arrays.
 *   5. birth    run every candidate once; retry a failing CLAIM ONCE with its
 *               evidence; still-failing candidates are birth findings, never kept.
 *   6. manifest rewrite the binding record with the settled outcomes.
 *
 * Unchanged sections are skipped entirely; awaiting-driver (api/web/tui/library),
 * untestable, and no-claim sections land in the result + manifest as visible
 * coverage gaps.
 */

import { createHash } from 'node:crypto'
import pLimit from 'p-limit'
import os from 'node:os'
import { z } from 'zod'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
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
  readGuardDecisions,
  writeGuardDecisions,
  readGuardAutoResolutions,
  writeGuardAutoResolutions,
  manifestPath,
  runBuild,
  runInstall,
  resolveEntry,
  preflightEntry,
  formatEntryPreflightError,
  isSetupDefectResult,
  detectNoOpAnomaly,
  defaultGuardExecutor,
  type GuardExecutor,
  type Recipe,
  type BuildResult,
  type EntryPreflightResult,
  type GuardRunStepStats,
  type GuardNoOpAnomaly,
} from '@truecourse/guard-runner'
import {
  DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER,
  DEFAULT_INPUT_NAME,
  GUARD_FORMAT_VERSION,
  composeBlockedOnReason,
  dismissedClaimKey,
  isRunnableDriver,
  type GuardAutoResolutionEntry,
  type GuardClaimTaint,
  type GuardAutoResolved,
  type GuardBirthFinding,
  type GuardFamilyEscalation,
  type GuardFamilyMember,
  type GuardTriage,
  type OutputExcerpts,
  type GuardCoverageGap,
  type GuardDismissedClaim,
  type GuardEntryPreflight,
  type GuardManifestSection,
  type GuardOrphanedDismissal,
  type GuardScenario,
  type GuardScenarioDiagnosis,
} from '@truecourse/shared'
import {
  planGuardWork,
  collectWorkDocs,
  hasGuardUniverse,
  generationInputsHash,
  type GuardDoc,
  type SectionInput,
} from './section-plan.js'
import {
  GENERATE_PROMPT_FINGERPRINT,
  FIDELITY_PROMPT_FINGERPRINT,
  buildAuthorDocContext,
  type AuthorClaim,
  type AuthorUserContext,
  type FidelityUserContext,
} from './prompts.js'
import {
  AuthoredBatchSchema,
  RawGeneratedScenarioSchema,
  FidelityReviewSchema,
  type AuthoredClaim,
  type ExtractedClaim,
  type RawGeneratedScenario,
  type TestabilityVerdict,
  type UntestableNote,
} from './schemas.js'
import {
  spawnExtractRunner,
  spawnGenerateRunner,
  spawnRecipeRunner,
  spawnFidelityRunner,
  spawnTriageRunner,
  spawnExemplarRunner,
  spawnClusterRunner,
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
  type FidelityRunner,
  type TriageRunner,
  type ExemplarRunner,
  type ClusterRunner,
} from './runners.js'
import { runTriage, triageCacheKey } from './triage.js'
import { clusterDefects, type ClusterFamily } from './cluster.js'
import { seedSupportPack, defaultSupportPackSize } from './exemplars.js'
import { extractDocClaims, countExtractViews, type DocClaims } from './extract.js'
import { groundProbes, type ProbeTranscript } from './ground.js'
import { flattenZodError, quoteInvalidOutput, scenarioCompositionDefect } from './validate.js'
import { discoverRecipe } from './recipe-discovery.js'
import { birthValidate, type BirthCandidate } from './birth.js'
import {
  assignScenarioId,
  buildScenario,
  areaOrDocSlug,
  writeScenarioFile,
  serializeScenarioYaml,
  deleteScenarioFiles,
  existingScenarioIds,
} from './serialize.js'
import { seedInvariantPack } from './invariant.js'

export const GENERATE_CACHE_NAME = 'guard/generate'
export const FIDELITY_CACHE_NAME = 'guard/fidelity'

/** Sentinel anchor for the single entry-preflight error — it belongs to no section. */
const ENTRY_PREFLIGHT_ANCHOR = '(entry preflight)'

// ---------------------------------------------------------------------------
// Result + option types
// ---------------------------------------------------------------------------

export interface GeneratedScenarioInfo {
  id: string
  title: string
  doc: string
  anchor: string
  /** Repo-relative path of the written `.yaml`. */
  file: string
  /**
   * Present ONLY when this scenario was committed in a FAILING state (item 3) — real
   * drift the run reproduces. Carries the birth expected/actual and the triage verdict
   * + recommendation so the run's failing row explains itself. Absent for a clean pass.
   */
  diagnosis?: GuardScenarioDiagnosis
}

/**
 * A candidate that failed birth validation twice — either a generation defect or
 * REAL existing drift. The single definition lives in `@truecourse/shared`
 * (`GuardBirthFindingSchema`); re-exported here so the generator's public API is
 * unchanged. It carries the failing run's raw `stdout`/`stderr` excerpts (Fix 1).
 */
export type { GuardBirthFinding } from '@truecourse/shared'

export interface GuardGenerateError {
  doc: string
  anchor: string
  message: string
}

/**
 * A document whose claim extraction could not complete — the model returned
 * invalid output even after one corrective re-ask, or a call threw. An error
 * state, NOT an empty extraction: the doc's work sections are left unsettled (no
 * manifest entry, nothing cached for the failing view) so the next run re-attempts
 * only the missing views.
 */
export interface GuardExtractionFailure {
  doc: string
  /** One-line reason — the flattened Zod message or the thrown error text. */
  reason: string
}

export interface GuardGenerateResult {
  /**
   * `llm-failed` = a stage that gates the run's output lost EVERY LLM call, so
   * nothing was generated and nothing on disk was rewritten (never reported as
   * `ok` with an empty result — see {@link generateGuards}).
   */
  status: 'no-docs' | 'recipe-failed' | 'llm-failed' | 'ok'
  /** For `no-docs` / `recipe-failed` / `llm-failed`: the user-facing reason. */
  reason?: string
  recipe?: { status: 'exists' | 'discovered'; entry: string[]; wrotePath?: string }
  sectionsTotal: number
  sectionsChanged: number
  skippedUnchanged: number
  /** True when nothing changed (no work sections) — the confirm/run was a no-op. */
  noChanges: boolean
  written: GeneratedScenarioInfo[]
  coverageGaps: GuardCoverageGap[]
  birthFindings: GuardBirthFinding[]
  errors: GuardGenerateError[]
  extractionFailures: GuardExtractionFailure[]
  /**
   * Stages that lost LLM calls this run — attempts, failures, and the first error.
   * Every stage absorbs an isolated failure somewhere (a failed extraction view
   * lowers coverage, a failed fidelity review leaves its section unsettled), so
   * without this a partially failed run reads as a clean one. Empty on a clean run.
   */
  llmFailures: StageTransportTally[]
  orphaned: { doc: string; anchor: string; scenarioIds: string[] }[]
  /**
   * Birth passes that SURVIVED to a reported bucket — a written scenario, a fidelity
   * finding, or an auto-resolved fidelity discard. Counted once per surviving
   * candidate: a round-1 pass discarded when a sibling forced a whole-claim retry
   * does not count (only the retry's own passes do), and a birth pass whose fidelity
   * review could not complete does not count (its section re-attempts). Since item 15
   * every birth+fidelity-clean candidate COMMITS (no held-ready bucket), so the run
   * reconciles as `birthPassed === written.length + fidelity findings + fidelity
   * discards`.
   */
  birthPassed: number
  /**
   * Dismissals in `scenarios/decisions.json` whose claim text matched nothing in a
   * doc this run re-extracted — stale entries surfaced (never silently honored).
   * Empty when every dismissal matched a live claim (or its doc wasn't re-read).
   */
  orphanedDismissals: GuardOrphanedDismissal[]
  /**
   * The auto-resolved ledger — high-confidence machine judgments the tool acted on
   * itself instead of raising a human task (a visible record, never silence). Today:
   * HIGH-confidence fidelity flags discarded + re-authored once. Empty when nothing
   * auto-resolved this run.
   */
  autoResolved: GuardAutoResolved[]
  /**
   * The TOOL-LIMITATION notices (item 4) — families of same-diagnosis tool-defects a
   * family-level self-heal re-author could not converge, each ONE dismissible row.
   * NOT findings about the user's repo (the taxonomy): surfaced beside the auto-resolved
   * ledger, never in findings lists/counts. Empty when nothing escalated this run.
   */
  familyEscalations: GuardFamilyEscalation[]
  manifestPath?: string
  /**
   * Present ONLY when the built entry failed to start — the birth phase was
   * short-circuited into ONE loud error (in `errors`), so every changed section
   * stayed unsettled. Zero birth findings.
   */
  entryPreflight?: GuardEntryPreflight
}

/**
 * One failed authoring attempt, surfaced live (item 2) the moment it happens — a
 * timeout or invalid output, for one section, on one attempt of an authoring call.
 * The CLI renders it immediately (the section's unsettled work never ticks the
 * settle counter, so a timing-out call is otherwise indistinguishable from a slow
 * one). Fired once per affected section per failed attempt; a batch spanning
 * several sections fires one event each.
 */
export interface AuthorFailure {
  doc: string
  anchor: string
  /** One-line reason — e.g. `timed out after 10m`, `invalid output twice`. */
  reason: string
  /** 1-based attempt index within this authoring call sequence (1 = first call, 2 = the re-ask). */
  attempt: number
  /** True when another attempt will follow (a corrective re-ask); false on the final failure. */
  willRetry: boolean
}

export interface GuardGenerateModels {
  extract?: string
  generate?: string
  /** Evidence-retry re-authoring (stage `guard.retry`); defaults to `generate`. */
  retry?: string
  /** Fidelity review (stage `guard.fidelity`) — a cheap-tier adversarial pass. */
  fidelity?: string
  /** Finding triage (stage `guard.triage`) — the top-tier post-settle judgment pass. */
  triage?: string
  /** Support-claim exemplar generation (stage `guard.exemplars`) — the diversity pack
   *  generator (item 9), a generation stage on the sonnet tier. */
  exemplars?: string
  /** Family clustering (stage `guard.cluster`) — the cheap item-4 classification that
   *  groups tool-defect briefs by diagnosis, on the sonnet tier. */
  cluster?: string
  recipe?: string
  fallback?: string
}

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
  /** Claims per authoring call — `TRUECOURSE_GENERATE_BATCH` env, else 4. */
  batchSize?: number
  /** Exemplars a support claim's generated pack holds (item 9) —
   *  `TRUECOURSE_SUPPORT_PACK_SIZE` env, else 40. */
  supportPackSize?: number
  // --- test seams (production injects none) ---
  extractRunner?: ExtractRunner
  generateRunner?: GenerateRunner
  recipeRunner?: RecipeRunner
  fidelityRunner?: FidelityRunner
  triageRunner?: TriageRunner
  /** Support-claim exemplar-pack generator (item 9). Injected in tests; production
   *  spawns it from the transport when one is available (like fidelity/triage). */
  exemplarRunner?: ExemplarRunner
  /** Family-clustering classifier (item 4). Injected in tests; production spawns it
   *  from the transport (sonnet tier), like the other aux runners. */
  clusterRunner?: ClusterRunner
  /** Forwarded to birth validation — the no-op step threshold (a test seam). */
  noOpThresholdMs?: number
  /**
   * Item-14 escalation threshold: how many times a finding identity may auto-resolve
   * across generates before it surfaces to the human ("re-generation is not fixing
   * this"). Defaults to {@link DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER} (2); tests lower
   * it to observe escalation in fewer runs.
   */
  escalateAutoResolveAfter?: number
  // --- progress hooks ---
  onPlan?: (total: number, work: number) => void
  onExtractProgress?: (done: number, total: number) => void
  /** Per-VIEW extraction progress (a chunked doc is many view calls) — the live
   *  counter. Fires `(0, total)` as soon as the view plan is known (views are
   *  planned per doc upfront), then once per completed view. */
  onExtractViewProgress?: (done: number, total: number) => void
  onAuthorProgress?: (done: number, total: number) => void
  /** Fired the moment an authoring attempt fails (item 2) — a timeout or invalid
   *  output. One event per affected section per failed attempt; the CLI surfaces it
   *  immediately as a warn line and bumps its live failed-section counter. Optional,
   *  so callers that don't surface failures (the dashboard popup) pass nothing. */
  onAuthorFailure?: (failure: AuthorFailure) => void
  /** Grounding probe progress — captured vs planned probes across all authoring
   *  batches; the planned total grows as later sections enter grounding. */
  onGroundProgress?: (captured: number, planned: number) => void
  /** Birth build/run phase transitions (forwarded from the runner) — for a "building…" detail. */
  onBirthPhase?: (phase: 'build' | 'run', total?: number) => void
  /** Birth progress, ticking per settled scenario across both rounds. */
  onBirthProgress?: (done: number, total: number) => void
  /** Retry-authoring progress: `total` = failed claims being re-authored, bumped as each settles. */
  onRetryProgress?: (done: number, total: number) => void
  /** Fidelity-review progress: `reviewed` = green scenarios reviewed so far, `planned`
   *  = green scenarios queued for review (grows as later sections reach persist). */
  onFidelityProgress?: (reviewed: number, planned: number) => void
  /** Finding-triage progress: `done` = findings triaged so far, `total` = the run's
   *  finding count (known once every section settles — the triage stage runs last). */
  onTriageProgress?: (done: number, total: number) => void
  /** Per-section settle progress: `total` = the run's work-section count, fixed at
   *  indexing. Unsettled sections (extraction/authoring/birth failures) never tick,
   *  so `settled` may honestly end below `total`. */
  onSectionSettled?: (settled: number, total: number) => void
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
 * The speed-vs-cost dial for scenario authoring (item 5). `economical` batches
 * claims into one call (fewest calls, cheapest, slowest); `fast` authors one claim
 * per call (parallel, re-paying the shared document context per call — fastest,
 * ~1.4× cost). Only authoring (the one stage where independent claims share a call)
 * has a batch to dial.
 */
export type GenerateMode = 'fast' | 'economical'

// Scenario authoring is output-heavy (full YAML bodies per claim) — larger batches
// blow the per-call output budget and time out; 4 stays well inside it.
const ECONOMICAL_BATCH = 4

/** The raw `TRUECOURSE_GENERATE_BATCH` override (a batch size ≥ 1), or null when
 *  unset/invalid. When set it wins for both modes AND skips the mode ask (item 5). */
export function generateBatchOverride(): number | null {
  const env = process.env.TRUECOURSE_GENERATE_BATCH
  if (env) {
    const n = parseInt(env, 10)
    if (Number.isFinite(n) && n >= 1) return n
  }
  return null
}

/**
 * Claims per authoring call for the chosen mode. `TRUECOURSE_GENERATE_BATCH` is the
 * raw override and wins for BOTH modes; otherwise `fast` is one claim per call and
 * `economical` batches. The estimate and the pipeline both resolve the batch here,
 * so they can never drift.
 */
export function resolveGenerateBatch(mode: GenerateMode): number {
  return generateBatchOverride() ?? (mode === 'fast' ? 1 : ECONOMICAL_BATCH)
}

/** The default (economical) claims-per-authoring-call, honoring the env override. */
export function defaultGenerateBatch(): number {
  return resolveGenerateBatch('economical')
}

/** Per-claim authoring cache key: it moves when the claim, its section, the
 *  recipe, the format, or the authoring prompt changes. */
function authorCacheKey(claim: ExtractedClaim, section: SectionInput, recipeFingerprint: string): string {
  return createHash('sha256')
    .update(
      [
        GENERATE_PROMPT_FINGERPRINT,
        recipeFingerprint,
        String(GUARD_FORMAT_VERSION),
        section.fingerprint,
        claim.claim.replace(/\s+/g, ' ').trim(),
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
  // One counting seam for the whole run: every stage's runner is spawned on the
  // WRAPPED transport, so attempts/failures are accounted centrally instead of at
  // each fail-soft site. The default is materialized here (rather than per runner)
  // so no stage can bypass the accounting; it is the same `cliTransport()` each
  // spawn would otherwise have built. Tests that inject a runner bypass the
  // transport entirely — such a stage records no attempts, which is correct.
  const audit = auditTransport(options.transport ?? cliTransport())
  const transport = audit.transport

  if (!hasGuardUniverse(repoRoot)) {
    return emptyResult('no-docs', {
      reason: 'No corpus found. Run `truecourse spec scan` to curate the spec docs first.',
    })
  }

  // 1. Recipe — the shared entrypoint every scenario runs against. A failed
  // proposal call already aborts the run loudly (`recipe-failed`), so it needs no
  // systemic check of its own; the tally rides along for the report.
  const recipeRunner =
    options.recipeRunner ??
    spawnRecipeRunner({ transport, model: options.models?.recipe, fallbackModel: options.models?.fallback })
  const recipeResult = await discoverRecipe(repoRoot, recipeRunner)
  if (recipeResult.status === 'verify-failed') {
    return emptyResult('recipe-failed', { reason: recipeResult.reason, llmFailures: audit.failures() })
  }
  const recipe: Recipe = recipeResult.recipe
  const recipeFingerprint = recipeResult.fingerprint
  const recipeMeta = {
    status: recipeResult.status,
    entry: recipe.entry,
    ...(recipeResult.status === 'discovered' ? { wrotePath: recipeResult.wrotePath } : {}),
  }

  // 2. Index — deterministic universe + work detection.
  const plan = planGuardWork(repoRoot, recipeFingerprint)
  options.onPlan?.(plan.sections.length, plan.work.length)
  const orphaned = plan.orphaned.map((e) => ({ doc: e.doc, anchor: e.anchor, scenarioIds: e.scenarioIds }))

  if (plan.work.length === 0) {
    return {
      status: 'ok',
      recipe: recipeMeta,
      sectionsTotal: plan.sections.length,
      sectionsChanged: 0,
      skippedUnchanged: plan.sections.length,
      noChanges: true,
      written: [],
      coverageGaps: [],
      birthFindings: [],
      errors: [],
      extractionFailures: [],
      llmFailures: audit.failures(),
      orphaned,
      birthPassed: 0,
      orphanedDismissals: [],
      autoResolved: [],
      familyEscalations: [],
    }
  }

  const limit = pLimit(Math.max(1, options.concurrency ?? defaultConcurrency()))
  const batchSize = Math.max(1, options.batchSize ?? defaultGenerateBatch())
  const extractRunner =
    options.extractRunner ??
    spawnExtractRunner({ transport, model: options.models?.extract, fallbackModel: options.models?.fallback })
  const generateRunner =
    options.generateRunner ??
    spawnGenerateRunner({
      transport,
      model: options.models?.generate,
      retryModel: options.models?.retry,
      fallbackModel: options.models?.fallback,
    })
  // The fidelity reviewer, triage judge, and exemplar generator spawn exactly like
  // the extract/generate runners: unconditionally, with the spawn falling back to
  // the claude CLI transport when no explicit transport is handed in. The OSS CLI
  // passes NO transport (only EE installs a process default), so gating any of
  // these on `options.transport` silently disables the stage in every OSS run —
  // fidelity audits skipped, findings shipped without a verdict, and every support
  // claim erroring for lack of a pack. Tests inject stub runners, never transports.
  const fidelityRunner: FidelityRunner =
    options.fidelityRunner ??
    spawnFidelityRunner({
      transport,
      model: options.models?.fidelity,
      fallbackModel: options.models?.fallback,
    })
  const triageRunner: TriageRunner =
    options.triageRunner ??
    spawnTriageRunner({
      transport,
      model: options.models?.triage,
      fallbackModel: options.models?.fallback,
    })
  const exemplarRunner: ExemplarRunner =
    options.exemplarRunner ??
    spawnExemplarRunner({
      transport,
      model: options.models?.exemplars,
      fallbackModel: options.models?.fallback,
    })
  const clusterRunner: ClusterRunner =
    options.clusterRunner ??
    spawnClusterRunner({
      transport,
      model: options.models?.cluster,
      fallbackModel: options.models?.fallback,
    })
  const supportPackSize = Math.max(1, options.supportPackSize ?? defaultSupportPackSize())

  const coverageGaps: GuardCoverageGap[] = []
  const errors: GuardGenerateError[] = []
  const extractionFailures: GuardExtractionFailure[] = []

  // The user's dismissals (committable `scenarios/decisions.json`). A dismissed
  // claim (identity = doc + anchor + the extracted claim's stable text) is skipped
  // BEFORE authoring — never re-authored, never re-findinged — and recorded as a
  // `dismissed` coverage gap so it settles visibly and RELEASES its held siblings.
  const decisions = readGuardDecisions(repoRoot)
  const dismissalByKey = new Map<string, GuardDismissedClaim>(
    decisions.dismissedClaims.map((d) => [dismissedClaimKey(d.doc, d.anchor, d.title), d]),
  )

  // The durable guard ledger (item 14 escalation counts + item 2 claim taints), read
  // once and rewritten once at run end. A tainted claim (its scenario ended a prior run
  // flagged) bypasses the author cache below and re-authors fresh; the flagged/cleared
  // reconciliation happens after settle.
  const priorLedger = readGuardAutoResolutions(repoRoot)
  const now = new Date().toISOString()
  // Claims flagged THIS run (scenario defects) → their taint (re)recorded at run end,
  // keyed by claim-taint identity.
  const flaggedClaims = new Map<string, GuardClaimTaint>()
  // Claims whose ROUND-1 author cache was freshly (over)written this run — their prior
  // taint is cleared (the poisoned cache entry is gone), unless they re-flag below.
  const freshlyAuthoredClaimKeys = new Set<string>()
  // Record a claim's scenario as a run-end defect (fidelity/generation-defect). A
  // finding with no claim identity can't be keyed, so it's skipped (as auto-dismiss is).
  const taintClaim = (doc: string, anchor: string, claim: string | undefined, title: string, mismatch: string): void => {
    if (!claim) return
    flaggedClaims.set(claimTaintKey(doc, anchor, claim), { doc, anchor, claim, title, mismatch, updatedAt: now })
  }
  // Orphan honesty: a dismissal whose claim text matched NOTHING in a doc actually
  // re-extracted this run is stale — surfaced, never silently honored. Only docs we
  // re-read can be judged, so track the extracted claim identities + the docs read.
  const extractedClaimKeys = new Set<string>()
  const extractedDocs = new Set<string>()

  // 3. Extract — one (cached) whole-document read per work doc. Anchors are snapped
  // to the live index; a doc whose extraction fails leaves its work sections
  // unsettled (re-attempted next run). Claims/notes are matched to WORK sections
  // only — an unchanged section's existing scenarios stand.
  const workDocs = collectWorkDocs(repoRoot, plan)
  const workKeys = new Set(plan.work.map(key))
  const workDocByPath = new Map(workDocs.map((d) => [d.doc, d]))

  // Each doc's VIEWS go through the shared limit (a big doc is a dozen parallel
  // calls); the doc-level map is NOT a limit slot, so a doc holding view slots
  // can never deadlock the pool (mirrors the extractor's area/view split).
  let extractDone = 0
  const viewTotal = workDocs.reduce((n, d) => n + countExtractViews(d), 0)
  let viewDone = 0
  // Announce the planned denominator before the first (possibly slow) view
  // resolves so the live counter is never a bare count without context.
  options.onExtractViewProgress?.(0, viewTotal)
  const extracted = await Promise.all(
    workDocs.map(async (doc) => {
      const result = await extractDocClaims(repoRoot, doc, extractRunner, limit, () =>
        options.onExtractViewProgress?.(++viewDone, viewTotal),
      )
      options.onExtractProgress?.(++extractDone, workDocs.length)
      return { doc, result }
    }),
  )

  // Per-work-section outcome: cli claims to author, a coverage gap, or unsettled
  // (its doc's extraction failed). Derive the manifest classification summary too.
  const classificationByKey = new Map<string, TestabilityVerdict>()
  const extractFailedKeys = new Set<string>() // work sections whose doc extraction failed
  const authTasks: AuthTask[] = []
  let refSeq = 0

  for (const { doc, result } of extracted) {
    if (!result.ok) {
      // Every view failed — the doc yielded nothing; all its work sections re-attempt.
      extractionFailures.push({ doc: doc.doc, reason: result.reason })
      for (const s of doc.sections) if (workKeys.has(key(s))) extractFailedKeys.add(key(s))
      continue
    }
    // A partially-failed doc (some views failed) still contributes the claims it
    // got; but a work section that received NOTHING can't be settled as a genuine
    // gap — its view may have failed — so it is left unsettled to re-attempt.
    if (!result.complete) {
      extractionFailures.push({
        doc: doc.doc,
        reason: `${result.failedViews} extraction view(s) failed — re-run to complete coverage for affected sections`,
      })
    }
    // Record every extracted claim identity (all sections of this re-read doc) so
    // orphan detection below can tell a stale dismissal from an un-read section.
    extractedDocs.add(doc.doc)
    for (const c of result.data.claims) {
      extractedClaimKeys.add(dismissedClaimKey(doc.doc, c.sectionAnchor, c.claim))
    }
    const { claimsByAnchor, noteByAnchor } = groupExtraction(result.data)
    for (const s of doc.sections) {
      if (!workKeys.has(key(s))) continue
      const claims = claimsByAnchor.get(s.anchor) ?? []
      const cliAll = claims.filter((c) => isRunnableDriver(c.driver))
      const others = claims.filter((c) => !isRunnableDriver(c.driver))
      const note = noteByAnchor.get(s.anchor)

      // A dismissed cli claim is not authored, not birthed, never a finding: record
      // it as an explicit `dismissed` gap and drop it from the authoring set. Its
      // section can then settle on its remaining (live) claims alone.
      const cli = cliAll.filter((c) => !dismissalByKey.has(dismissedClaimKey(s.doc, s.anchor, c.claim)))
      const dismissed = cliAll.filter((c) => dismissalByKey.has(dismissedClaimKey(s.doc, s.anchor, c.claim)))
      for (const d of dismissed) {
        const entry = dismissalByKey.get(dismissedClaimKey(s.doc, s.anchor, d.claim))
        coverageGaps.push({ doc: s.doc, anchor: s.anchor, kind: 'dismissed', reason: dismissedReason(d.claim, entry?.note) })
      }

      // Every non-runnable-driver claim is a recorded coverage gap (its driver isn't
      // authored yet) — one un-conflated `awaiting-driver` kind carrying the driver.
      for (const o of others) {
        coverageGaps.push({ doc: s.doc, anchor: s.anchor, kind: 'awaiting-driver', driver: o.driver, reason: o.reason })
      }
      if (cli.length === 0 && others.length === 0) {
        // A section whose only cli claims were all dismissed settles on those
        // `dismissed` gaps alone — never re-classified as no-claim/untestable.
        if (dismissed.length === 0) {
          // No claim and no note. In a COMPLETE doc that's an honest gap; in an
          // incomplete doc the section may live in a failed view — don't settle it.
          if (!result.complete && !note) {
            extractFailedKeys.add(key(s))
            continue
          }
          coverageGaps.push({
            doc: s.doc,
            anchor: s.anchor,
            kind: note ? 'untestable' : 'no-claim',
            reason: note?.reason ?? 'the section states no CLI-assertable claim',
          })
        }
      }
      classificationByKey.set(key(s), deriveClassification(cli, others, note))
      for (const c of cli) {
        // An invariant claim (item 8) seeds its input-corpus pack NOW — before birth,
        // which sweeps the rule over it — from the section's example blocks. The
        // seeded pack id rides on the task so the built scenario binds to it.
        const pack = c.flavor === 'invariant' ? seedInvariantPack(repoRoot, s, c) ?? undefined : undefined
        authTasks.push({ ref: `c${refSeq++}`, section: s, claim: c, ...(pack ? { pack } : {}) })
      }
    }
  }

  // Extraction is the stage everything downstream reads: when EVERY extract call
  // failed there are no claims, so authoring, birth, and the manifest would run
  // over nothing and the run would report `ok` with an empty result — a run that
  // verified nothing, indistinguishable from a clean no-op. Abort here instead,
  // before any scenario file or manifest write: the committed scenarios and
  // `manifest.json` stay exactly as they were, and the next run re-attempts the
  // failed views (a failed view is never cached). The per-doc reasons ride along so
  // the report names the affected documents.
  if (audit.isSystemicFailure('guard.extract')) {
    return llmFailedResult(audit, 'guard.extract', {
      recipe: recipeMeta,
      sectionsTotal: plan.sections.length,
      sectionsChanged: plan.work.length,
      skippedUnchanged: plan.sections.length - plan.work.length,
      extractionFailures,
      orphaned,
    })
  }

  // Orphan honesty: a dismissal whose doc was re-extracted but whose claim text
  // matched no live claim is stale — surfaced so it is never silently honored. A
  // dismissal for a doc we did NOT re-read (unchanged) is left alone (can't judge).
  const orphanedDismissals: GuardOrphanedDismissal[] = decisions.dismissedClaims
    .filter(
      (d) =>
        extractedDocs.has(d.doc) &&
        !extractedClaimKeys.has(dismissedClaimKey(d.doc, d.anchor, d.title)),
    )
    .map((d) => ({ doc: d.doc, anchor: d.anchor, title: d.title }))

  // 4. Kick the recipe build ONCE, parallel with authoring — every birth round
  // reuses it (skipBuild). The build phase is announced the first time a section
  // reaches birth; a build failure turns that section's candidates into error
  // outcomes (mirroring the runner's build-failed mapping) so the section unsettles.
  // The optional recipe install runs first; a failed install IS the build result
  // (same BuildResult shape, carrying the install command), exactly as in `runGuard`.
  const buildPromise = (async (): Promise<BuildResult> => {
    if (recipe.install) {
      const install = await runInstall(repoRoot, recipe.install, recipe.env)
      if (!install.ok) return install
    }
    return runBuild(repoRoot, recipe.build, recipe.env)
  })()
  let buildAnnounced = false
  const awaitBuild = async (): Promise<BuildResult> => {
    if (!buildAnnounced) {
      buildAnnounced = true
      options.onBirthPhase?.('build')
    }
    return buildPromise
  }

  // Grounded authoring: before an authoring call the engine probes the real program
  // for the commands the claims name (empty sandbox, cached) and injects the
  // transcripts. Probes need the built entrypoint — await the shared build silently
  // (it overlapped extraction, so it's usually already done); a failed build skips
  // probing entirely, leaving authoring ungrounded exactly as before. The build's
  // birth-phase announcement stays owned by the birth path (`awaitBuild`).
  let resolvedEntryMemo: string[] | null = null
  // Grounding progress: probes are counted as PLANNED when a batch enters grounding
  // (the total grows as later sections arrive) and as CAPTURED as each transcript
  // resolves (cache hit or fresh run). Surfaced on the author step so the pre-author
  // probe sweep never looks like a hang.
  let groundPlanned = 0
  let groundCaptured = 0
  const groundClaims = async (claimTexts: string[]): Promise<ProbeTranscript[]> => {
    const build = await buildPromise
    if (!build.ok) return []
    resolvedEntryMemo ??= resolveEntry(repoRoot, recipe.entry)
    // Two-phase grounding (static probes → help-surface expansion). The planned
    // total grows per phase; captured ticks per resolved transcript.
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
  // candidate runs against it. A dead entry short-circuits the whole birth phase into
  // ONE loud error; the judgment is GENERAL (no string matching) — see
  // `@truecourse/guard-runner` `preflightEntry`. Null when the build failed (that has
  // its own error path).
  let entryPreflightMemo: Promise<EntryPreflightResult | null> | null = null
  const preflightEntryOnce = (): Promise<EntryPreflightResult | null> => {
    entryPreflightMemo ??= (async () => {
      const build = await buildPromise
      if (!build.ok) return null
      resolvedEntryMemo ??= resolveEntry(repoRoot, recipe.entry)
      return preflightEntry({ resolvedEntry: resolvedEntryMemo, displayEntry: recipe.entry, recipeEnv: recipe.env, repoRoot })
    })()
    return entryPreflightMemo
  }

  // Id allocation seeds with EVERY existing id (hand-written + all work-owned). A
  // section frees its OWN prior ids at its settle — its files are about to be
  // deleted — before assigning, so it reuses its stable `<leaf>.<n>` yet can never
  // grab an id whose file still lives under a sibling that hasn't settled.
  const priorSections = readPriorManifest(repoRoot)
  const manifestByKey = new Map(priorSections.map((e) => [`${e.doc}\0${e.anchor}`, e]))
  const usedIds = existingScenarioIds(repoRoot)
  const priorIdsOf = (k: string): string[] => manifestByKey.get(k)?.scenarioIds ?? []

  // The manifest working copy holds ALL sections; each settle upserts its entry and
  // writes the whole file; unsettled work sections are dropped at run end.
  const workingManifest = new Map<string, GuardManifestSection>(
    priorSections.map((e) => [`${e.doc}\0${e.anchor}`, e]),
  )
  // Sections that COMMITTED a manifest entry this run — their committed files are
  // spared by the run-end sweep. Two flavors, told apart only by the entry's
  // generationInputsHash (see `upsertSection`): a fully-settled section (no
  // finding/error) stamps the current hash and is skipped as unchanged next run; a
  // PARTIAL section (committed ≥1 scenario but left a sibling finding/error — item 15)
  // records its committed ids with a NULL hash, so it re-detects as WORK and
  // re-attempts its outstanding claim(s) next generate.
  const settledKeys = new Set<string>()
  const writeWorkingManifest = (): void => {
    const sections = [...workingManifest.values()].sort(
      (a, b) => a.doc.localeCompare(b.doc) || a.anchor.localeCompare(b.anchor),
    )
    writeManifest(repoRoot, { guard: GUARD_FORMAT_VERSION, sections })
  }
  // `settled: false` (a PARTIAL section) leaves generationInputsHash null so the
  // section re-works next run — its committed ids are still recorded (partial coverage
  // is real coverage) and its files spared, but its outstanding finding re-attempts.
  const upsertSection = (section: SectionInput, scenarioIds: string[], opts: { settled: boolean } = { settled: true }): void => {
    const k = key(section)
    const classification = classificationByKey.get(k)
    workingManifest.set(k, {
      doc: section.doc,
      anchor: section.anchor,
      fingerprint: section.fingerprint,
      scenarioIds: scenarioIds.slice().sort(),
      generationInputsHash: opts.settled
        ? generationInputsHash(section.fingerprint, recipeFingerprint, section.suppressionFingerprint)
        : null,
      ...(classification ? { classification } : {}),
    })
    settledKeys.add(k)
    writeWorkingManifest()
    options.onSectionSettled?.(settledKeys.size, plan.work.length)
  }

  // Result accumulators + progress counters — appended/bumped as sections settle.
  const written: GeneratedScenarioInfo[] = []
  const birthFindings: GuardBirthFinding[] = []
  // Item 3 — the birth candidate behind each finding, retained so a finding triage
  // judged real DRIFT can be committed to disk (its `.scenario` + `.section`) after
  // the post-settle triage, instead of being withheld. Keyed by the finding instance.
  const findingCandidates = new Map<GuardBirthFinding, BirthCandidate>()
  // The auto-resolved ledger — high-confidence fidelity flags the pipeline discarded
  // and re-authored itself (a visible record, never a human task).
  const autoResolved: GuardAutoResolved[] = []
  // Set the first time a section reaches birth and finds the entry can't start; from
  // then on every cli section short-circuits (no birth, unsettled) and the failure is
  // recorded ONCE, in `errors`, never as per-section findings.
  let entryPreflightFailure: GuardEntryPreflight | null = null
  // Cumulative round-1 birth step aggregate across ALL sections. When it crosses the
  // no-op anomaly threshold the recipe entry is a do-nothing binary (it ignores its
  // arguments): set `noOpAnomaly`, from then on every section short-circuits before
  // any retry/fidelity spend, and the whole generate aborts as `recipe-failed`.
  const birthStepStats: GuardRunStepStats = { executedSteps: 0, noOpSteps: 0, thresholdMs: options.noOpThresholdMs ?? 0 }
  let noOpAnomaly: GuardNoOpAnomaly | null = null
  let birthTotal = 0
  let birthSettled = 0
  let birthPassed = 0
  const bumpBirth = (): void => options.onBirthProgress?.(++birthSettled, birthTotal)
  // A build failure settles no scenarios through the runner; catch the counter up.
  const reconcileBirth = (): void => {
    if (birthSettled < birthTotal) options.onBirthProgress?.((birthSettled = birthTotal), birthTotal)
  }
  // Retry-authoring progress accumulates across sections as each settles.
  let retryTotal = 0
  let retryDone = 0
  // Fidelity-review progress accumulates across sections: `planned` grows at CANDIDATE
  // time — the moment a round's candidates enter review alongside birth (not at green
  // time) — so it counts every candidate reviewed, including the ~35% birth later
  // rejects; `reviewed` ticks per completed review.
  let fidelityPlanned = 0
  let fidelityReviewed = 0
  // Review a round's candidates for fidelity CONCURRENTLY with birth (fidelity needs
  // nothing from the birth run). Fans them through the shared pool, bumps `planned`
  // for the whole set up front and ticks `reviewed` per verdict, and returns each
  // candidate's result keyed by the candidate so the settle can pair it with birth.
  const runFidelity = async (candidates: BirthCandidate[]): Promise<Map<BirthCandidate, FidelityResult>> => {
    if (candidates.length === 0) return new Map()
    fidelityPlanned += candidates.length
    options.onFidelityProgress?.(fidelityReviewed, fidelityPlanned)
    const entries = await Promise.all(
      candidates.map((c) =>
        limit(async () => {
          const review = await reviewFidelity(repoRoot, c, fidelityRunner)
          options.onFidelityProgress?.(++fidelityReviewed, fidelityPlanned)
          return [c, review] as const
        }),
      ),
    )
    return new Map(entries)
  }

  // Per-section state: the cli claims to author, and the raw scenarios they land.
  const taskByRef = new Map(authTasks.map((t) => [t.ref, t]))
  const refsBySection = new Map<string, string[]>()
  const sectionByKey = new Map<string, SectionInput>()
  for (const t of authTasks) {
    pushInto(refsBySection, key(t.section), t.ref)
    sectionByKey.set(key(t.section), t.section)
  }
  const cliSectionKeys = new Set(refsBySection.keys())
  const rawByRef = new Map<string, RawGeneratedScenario[]>()
  // Refs whose claim authored zero scenarios because it needs world-state the
  // sandbox can't provide — the normalized capability nouns, for a blocked-on gap.
  const blockedByRef = new Map<string, string[]>()

  // A work section with NO cli claim (an api/web gap, untestable, no-claim, or a
  // fully-blocked claim's driver row) settles NOW — a manifest entry with the
  // classification, no birth. Extraction-failed sections stay unsettled.
  for (const section of plan.work) {
    const k = key(section)
    if (extractFailedKeys.has(k) || cliSectionKeys.has(k)) continue
    for (const id of priorIdsOf(k)) usedIds.delete(id)
    deleteScenarioFiles(repoRoot, priorIdsOf(k))
    upsertSection(section, [])
  }

  // 5. Author + birth + persist, PER SECTION. A claim resolves on a cache hit or
  // when its batch call completes (success or error). When a section's last claim
  // resolves it either unsettles (any authoring error) or enters a SERIAL settle
  // chain — birth round 1 → one retry per failing claim → birth round 2 → persist.
  const pendingBySection = new Map<string, number>()
  for (const [k, refs] of refsBySection) pendingBySection.set(k, refs.length)
  const sectionAuthError = new Set<string>()

  let settleChain: Promise<void> = Promise.resolve()
  const resolveClaim = (t: AuthTask, hadError: boolean): void => {
    const k = key(t.section)
    if (hadError) sectionAuthError.add(k)
    const remaining = (pendingBySection.get(k) ?? 0) - 1
    pendingBySection.set(k, remaining)
    if (remaining > 0) return
    // Item 15 — a sibling claim's authoring error no longer short-circuits the whole
    // section: it still enters the settle chain so its OTHER claims' candidates can
    // birth + commit on their own merits. The authoring errors are already in the
    // top-level `errors[]`; settleCliSection reads `sectionAuthError` so a section
    // carrying one commits PARTIAL (its outstanding claim re-attempts), never clean.
    settleChain = settleChain.then(() => settleCliSection(sectionByKey.get(k)!, refsBySection.get(k)!))
  }

  // True when the built entry cannot start — the memoized pre-flight verdict. On the
  // FIRST dead detection it records the ONE loud entry-level error (with the full,
  // untruncated startup stderr) and the structured `entryPreflight` record; later
  // calls short-circuit silently. Never true when the build itself failed.
  const deadEntry = async (): Promise<boolean> => {
    const preflight = await preflightEntryOnce()
    if (!preflight || preflight.ok) return false
    if (!entryPreflightFailure) {
      entryPreflightFailure = { entry: preflight.entry, buildCommand: recipe.build, stderr: preflight.stderr }
      errors.push({
        doc: preflight.entry,
        anchor: ENTRY_PREFLIGHT_ANCHOR,
        message: formatEntryPreflightError(entryPreflightFailure),
      })
    }
    return true
  }

  // Settle one cli section: birth its authored scenarios, retry the failing claims
  // once, and persist green survivors — or record findings/errors and leave it
  // unsettled (its prior files/entry are cleared at run end for a clean re-attempt).
  async function settleCliSection(section: SectionInput, refs: string[]): Promise<void> {
    // The recipe entry was already judged a do-nothing no-op — every remaining
    // section short-circuits before spending any birth/retry/fidelity call; the run
    // aborts as `recipe-failed` at the end.
    if (noOpAnomaly) return
    const k = key(section)
    for (const id of priorIdsOf(k)) usedIds.delete(id)

    const localErrors: GuardGenerateError[] = []
    const localFindings: GuardBirthFinding[] = []
    // The candidate behind each local finding — merged into the run-level
    // `findingCandidates` at settle end so a drift finding can be committed post-triage.
    const localFindingCandidates: [GuardBirthFinding, BirthCandidate][] = []
    const recordFinding = (finding: GuardBirthFinding, candidate: BirthCandidate): void => {
      localFindings.push(finding)
      localFindingCandidates.push([finding, candidate])
    }
    const localAutoResolved: GuardAutoResolved[] = []
    const persistedHere: BirthCandidate[] = []
    // Round-1 birth-passing candidates the fidelity reviewer flagged at HIGH
    // confidence: discarded and re-authored ONCE below (never a human task).
    const selfHeal: { candidate: BirthCandidate; mismatch: string }[] = []

    // Route a ROUND-1 birth-passing candidate by its (concurrently-computed) fidelity
    // verdict: faithful → persist; flagged at HIGH confidence → SELF-HEAL (discard +
    // re-author once — an auto-resolved ledger entry, never a human task); flagged at
    // medium/low → a finding, as today; an incomplete review → the section re-attempts.
    // Every completed review is one reconciled birth pass — a high-confidence discard
    // counts too (it reaches the auto-resolved ledger) — keeping the item-15 invariant
    // `birthPassed === written + fidelityFlagged + fidelityDiscards`.
    const applyFidelityR1 = (candidate: BirthCandidate, review: FidelityResult): void => {
      if ('error' in review) {
        localErrors.push({ doc: section.doc, anchor: section.anchor, message: `fidelity review ${review.error}` })
        return
      }
      birthPassed++
      if (review.verdict === 'flagged') {
        if (review.confidence === 'high') selfHeal.push({ candidate, mismatch: review.mismatch })
        else recordFinding(fidelityFinding(candidate, review.mismatch), candidate)
      } else persistedHere.push(candidate)
    }

    // Route a birth-passing candidate when NO further self-heal is allowed — a round-2
    // birth-retry survivor or a round-3 self-heal re-author: a flag at ANY confidence
    // is a finding (at most one extra authoring round per scenario). Returns the
    // candidate's disposition so the self-heal round can classify its ledger outcome.
    const applyFidelityFinal = (candidate: BirthCandidate, review: FidelityResult): 'persist' | 'finding' | 'error' => {
      if ('error' in review) {
        localErrors.push({ doc: section.doc, anchor: section.anchor, message: `fidelity review ${review.error}` })
        return 'error'
      }
      birthPassed++
      if (review.verdict === 'flagged') {
        recordFinding(fidelityFinding(candidate, review.mismatch), candidate)
        return 'finding'
      }
      persistedHere.push(candidate)
      return 'persist'
    }

    // Round-1 candidates; an empty-scenario claim is a recorded gap, not a blocker.
    const round1: BirthCandidate[] = []
    const round1ByRef = new Map<string, BirthCandidate[]>()
    for (const ref of refs) {
      const t = taskByRef.get(ref)!
      const scs = rawByRef.get(ref)
      if (scs === undefined) continue
      if (scs.length === 0) {
        const blocked = blockedByRef.get(ref)
        coverageGaps.push(
          blocked && blocked.length > 0
            ? { doc: section.doc, anchor: section.anchor, kind: 'blocked-on', reason: composeBlockedOnReason(blocked, oneLine(t.claim.claim)) }
            : { doc: section.doc, anchor: section.anchor, kind: 'no-claim', reason: `authoring produced no CLI scenario for the claim: ${oneLine(t.claim.claim)}` },
        )
        continue
      }
      for (const rawS of scs) {
        const built = safeBuild(section, rawS, usedIds, localErrors, t.claim.claim, t.pack)
        if (built) {
          const cand: BirthCandidate = { section, scenario: built, ref, claim: t.claim }
          round1.push(cand)
          pushInto(round1ByRef, ref, cand)
        }
      }
    }

    if (round1.length > 0) {
      const build = await awaitBuild()
      if (!build.ok) {
        const message = `build failed (\`${build.command}\`)${build.timedOut ? ' — timed out' : ''}`
        for (const c of round1) localErrors.push(errorFrom({ candidate: c, result: { failure: { actual: message } } }))
      } else if (await deadEntry()) {
        // The built entry can't start — birthing anything against it would produce N
        // indistinguishable failures. Leave THIS section unsettled (run-end cleanup
        // drops it for a re-attempt) and return; the ONE loud error was recorded once.
        return
      } else {
        // Birth (the wall-time long pole) and fidelity run CONCURRENTLY — fidelity
        // judges the YAML against the claim and needs nothing from the birth run, so
        // reviewing WHILE birth executes makes a candidate's cost max(birth, fidelity),
        // not their sum. A candidate commits only when BOTH are green.
        birthTotal += round1.length
        const [birth1, fid1] = await Promise.all([
          birthValidate(repoRoot, round1, {
            executor,
            recipe,
            skipBuild: true,
            noOpThresholdMs: options.noOpThresholdMs,
            onPhase: options.onBirthPhase,
            onScenarioSettled: bumpBirth,
          }),
          runFidelity(round1),
        ])
        reconcileBirth()

        // No-op anomaly gate (item: birth anomaly detection). Fold THIS round's step
        // stats into the cumulative aggregate; once enough steps have run and almost
        // all did nothing, the recipe entry is a do-nothing binary. Abort NOW — before
        // this section's retries — leaving it (and every later section) unsettled; the
        // run returns `recipe-failed` at the end.
        birthStepStats.executedSteps += birth1.stepStats.executedSteps
        birthStepStats.noOpSteps += birth1.stepStats.noOpSteps
        birthStepStats.thresholdMs = birth1.stepStats.thresholdMs
        const anomaly = detectNoOpAnomaly(birthStepStats)
        if (anomaly) {
          noOpAnomaly = anomaly
          return
        }

        const r1 = birth1.outcomes
        const r1ByRef = new Map<string, typeof r1>()
        for (const o of r1) pushInto(r1ByRef, o.candidate.ref, o)

        const retryEntries: { task: AuthTask; evidence: GuardBirthFinding }[] = []
        for (const [ref, outcomes] of r1ByRef) {
          // A birth `fail` OR a setup-declaration defect (a capability/materialization
          // error caught before any step ran — e.g. `setup.git` naming an unseeded
          // file) is a generation defect: regenerate the whole claim ONCE with the
          // failure as evidence. The capability message ("declared file does not
          // exist… seed it via setup.files or an earlier commit") is exactly what the
          // model needs. A genuine infra error is surfaced as-is, never retried.
          const retriable = outcomes.find(
            (o) => o.result.outcome === 'fail' || isSetupDefectResult(o.result),
          )
          if (retriable) {
            // Precedence: a birth failure WINS over any fidelity verdict on this claim's
            // candidates. The whole claim regenerates; the round-1 candidates AND their
            // (now moot) fidelity verdicts in `fid1` are discarded — never a finding.
            retryEntries.push({ task: taskByRef.get(ref)!, evidence: toFinding(retriable) })
            continue
          }
          for (const o of outcomes) {
            if (o.result.outcome === 'pass') applyFidelityR1(o.candidate, fid1.get(o.candidate)!)
            else localErrors.push(errorFrom(o))
          }
        }

        if (retryEntries.length > 0) {
          // Free the discarded round-1 ids so retries reuse the stable `<leaf>.<n>`.
          for (const e of retryEntries) for (const c of round1ByRef.get(e.task.ref) ?? []) usedIds.delete(c.scenario.id)

          retryTotal += retryEntries.length
          options.onRetryProgress?.(retryDone, retryTotal)
          const gd = workDocByPath.get(section.doc)!
          const retryCandidates: BirthCandidate[] = []
          await Promise.all(
            retryEntries.map((entry) =>
              limit(async () => {
                try {
                  const retryScs = await authorRetry(repoRoot, gd, entry, section, recipe, recipeFingerprint, generateRunner, localErrors, groundClaims, options.onAuthorFailure)
                  for (const rawS of retryScs) {
                    const built = safeBuild(section, rawS, usedIds, localErrors, entry.task.claim.claim, entry.task.pack)
                    if (built) retryCandidates.push({ section, scenario: built, ref: entry.task.ref, claim: entry.task.claim })
                  }
                } finally {
                  options.onRetryProgress?.(++retryDone, retryTotal)
                }
              }),
            ),
          )

          if (retryCandidates.length > 0) {
            // Re-authored candidates get BOTH checks again, also in parallel.
            birthTotal += retryCandidates.length
            const [birth2, fid2] = await Promise.all([
              birthValidate(repoRoot, retryCandidates, {
                executor,
                recipe,
                skipBuild: true,
                noOpThresholdMs: options.noOpThresholdMs,
                onPhase: options.onBirthPhase,
                onScenarioSettled: bumpBirth,
              }),
              runFidelity(retryCandidates),
            ])
            reconcileBirth()
            for (const o of birth2.outcomes) {
              if (o.result.outcome === 'pass') applyFidelityFinal(o.candidate, fid2.get(o.candidate)!)
              else if (o.result.outcome === 'fail') recordFinding(toFinding(o), o.candidate)
              else localErrors.push(errorFrom(o))
            }
          }
        }
      }
    }

    // Self-heal (item 13): a HIGH-confidence fidelity flag is the system's own mess to
    // clean up, not a human task. Discard the candidate and re-author its claim ONCE
    // with the mismatch as correction evidence (the birth-retry machinery), then run
    // the replacement through birth + fidelity again — flagged again (any confidence)
    // or a birth fail becomes a finding (no second self-heal). Every discard is an
    // auditable ledger entry, never silent.
    if (selfHeal.length > 0) {
      const gd = workDocByPath.get(section.doc)!
      // Dedupe by ref: re-author each claim once even if several of its candidates
      // flagged high (the first flag's mismatch is the correction evidence).
      const healByRef = new Map<string, { task: AuthTask; discarded: { candidate: BirthCandidate; mismatch: string }[] }>()
      for (const item of selfHeal) {
        const e = healByRef.get(item.candidate.ref)
        if (e) e.discarded.push(item)
        else healByRef.set(item.candidate.ref, { task: taskByRef.get(item.candidate.ref)!, discarded: [item] })
      }
      // Free the discarded ids so the re-author reuses the stable `<leaf>.<n>`.
      for (const { candidate } of selfHeal) usedIds.delete(candidate.scenario.id)

      retryTotal += healByRef.size
      options.onRetryProgress?.(retryDone, retryTotal)
      const replacementsByRef = new Map<string, BirthCandidate[]>()
      await Promise.all(
        [...healByRef.values()].map((e) =>
          limit(async () => {
            try {
              const evidence = fidelityFinding(e.discarded[0].candidate, e.discarded[0].mismatch)
              const scs = await authorRetry(repoRoot, gd, { task: e.task, evidence }, section, recipe, recipeFingerprint, generateRunner, localErrors, groundClaims, options.onAuthorFailure)
              for (const rawS of scs) {
                const built = safeBuild(section, rawS, usedIds, localErrors, e.task.claim.claim, e.task.pack)
                if (built) pushInto(replacementsByRef, e.task.ref, { section, scenario: built, ref: e.task.ref, claim: e.task.claim })
              }
            } finally {
              options.onRetryProgress?.(++retryDone, retryTotal)
            }
          }),
        ),
      )

      // Birth + fidelity the replacements in parallel (per item 16); a flag at ANY
      // confidence — or a birth fail — on a re-author is a finding.
      const disposition = new Map<BirthCandidate, 'persist' | 'finding' | 'error'>()
      const replacements = [...replacementsByRef.values()].flat()
      if (replacements.length > 0) {
        birthTotal += replacements.length
        const [birth3, fid3] = await Promise.all([
          birthValidate(repoRoot, replacements, {
            executor,
            recipe,
            skipBuild: true,
            noOpThresholdMs: options.noOpThresholdMs,
            onPhase: options.onBirthPhase,
            onScenarioSettled: bumpBirth,
          }),
          runFidelity(replacements),
        ])
        reconcileBirth()
        for (const o of birth3.outcomes) {
          if (o.result.outcome === 'pass') disposition.set(o.candidate, applyFidelityFinal(o.candidate, fid3.get(o.candidate)!))
          else if (o.result.outcome === 'fail') {
            recordFinding(toFinding(o), o.candidate)
            disposition.set(o.candidate, 'finding')
          } else {
            localErrors.push(errorFrom(o))
            disposition.set(o.candidate, 'error')
          }
        }
      }

      // Ledger the discards — one entry per discarded scenario, carrying its own
      // mismatch and the ref's re-author outcome.
      for (const e of healByRef.values()) {
        const outcome = selfHealOutcome(replacementsByRef.get(e.task.ref) ?? [], disposition)
        for (const { candidate, mismatch } of e.discarded) {
          localAutoResolved.push({
            kind: 'fidelity-discard',
            doc: section.doc,
            anchor: section.anchor,
            title: candidate.scenario.title,
            mismatch,
            outcome,
          })
        }
        // Item 2 — a self-heal that did NOT converge leaves the claim re-attempting with
        // its round-1 author cache still poisoned; taint it so next generate re-authors
        // fresh. A `resolved` self-heal settles the section clean (skipped next run), so
        // it needs no taint.
        if (outcome !== 'resolved') {
          taintClaim(section.doc, section.anchor, e.task.claim.claim, e.discarded[0].candidate.scenario.title, e.discarded[0].mismatch)
        }
      }
    }

    errors.push(...localErrors)
    birthFindings.push(...localFindings)
    for (const [f, c] of localFindingCandidates) findingCandidates.set(f, c)
    autoResolved.push(...localAutoResolved)

    // Item 15 — every candidate that cleared birth AND fidelity COMMITS on its own
    // merits, regardless of what happened to its sibling claims. Per-scenario
    // persistence, not all-or-nothing: a section commits its greens whether it also
    // produced a finding/error (a PARTIAL section) or came out clean. Replace this
    // section's OWN prior files with the green survivors and upsert its manifest entry.
    // A sibling claim whose AUTHORING errored (recorded in the top-level `errors[]`,
    // flagged by `sectionAuthError`) also keeps the section partial.
    const clean = !sectionAuthError.has(k) && localErrors.length === 0 && localFindings.length === 0
    if (clean || persistedHere.length > 0) {
      deleteScenarioFiles(repoRoot, priorIdsOf(k))
      const slug = areaOrDocSlug(section)
      const ids: string[] = []
      for (const c of persistedHere) {
        const file = writeScenarioFile(repoRoot, slug, c.scenario)
        written.push({ id: c.scenario.id, title: c.scenario.title, doc: section.doc, anchor: section.anchor, file })
        ids.push(c.scenario.id)
      }
      // A clean section stamps the current inputs hash and is skipped next run; a
      // PARTIAL section (a sibling finding/error remains) records its committed ids
      // but leaves the hash null so its outstanding claim re-attempts next generate.
      upsertSection(section, ids, { settled: clean })
    }
    // A ZERO-SURVIVOR section (committed nothing, only findings/errors) upserts no
    // entry — the run-end sweep drops its prior files so it re-attempts wholesale.
  }

  // Support-claim exemplar packs (item 9): each support claim generates a diverse
  // input pack via ONE cached LLM call. Seeded HERE — before any birth sweeps the
  // pack — so the built scenario binds to a pack that exists on disk; the generated
  // exemplars are content-cached on the claim, so a re-generate re-materializes the
  // same pack with no second call. A claim whose generation can't complete (no
  // runner, thrown, or still-invalid after one re-ask) is recorded failed; its
  // section then errors in the author loop below and unsettles (re-attempted next
  // run) — never authoring a pack-less support scenario.
  const supportSeedFailed = new Map<string, string>()
  const supportTasks = authTasks.filter((t) => t.claim.flavor === 'support')
  if (supportTasks.length > 0) {
    await Promise.all(
      supportTasks.map((t) =>
        limit(async () => {
          const seeded = await seedSupportPack(repoRoot, t.section, t.claim, exemplarRunner, supportPackSize)
          if (seeded.ok) t.pack = seeded.packId
          else supportSeedFailed.set(t.ref, seeded.reason)
        }),
      ),
    )
  }

  // Author progress.
  const authorTotal = authTasks.length
  let authorDone = 0
  const bumpAuthor = (n: number): void => options.onAuthorProgress?.((authorDone += n), authorTotal)
  // Establish the author denominator before grounding fires — the grounding counter
  // rides the author step's detail, which needs the claim total up front (on a cold
  // run every batch grounds before its first author tick).
  if (authorTotal > 0) options.onAuthorProgress?.(authorDone, authorTotal)

  // Per-claim cache read up front; a hit resolves the claim immediately (its
  // section can settle without waiting on the LLM), only misses are sent.
  const missTasks: AuthTask[] = []
  for (const t of authTasks) {
    // A support claim whose exemplar pack could not be generated never authors —
    // its section errors WITH the seed failure's concrete reason and unsettles
    // for a clean re-attempt.
    const seedFailure = supportSeedFailed.get(t.ref)
    if (seedFailure !== undefined) {
      errors.push({
        doc: t.section.doc,
        anchor: t.section.anchor,
        message: `support-claim exemplar generation failed for "${oneLine(t.claim.claim)}": ${seedFailure}`,
      })
      resolveClaim(t, true)
      continue
    }
    // Item 2 — a TAINTED claim (its scenario ended a prior run flagged) bypasses the
    // author cache: the cache still holds the rejected scenario, so re-serving it would
    // re-flag it and treadmill. Force a miss → fresh author, carrying the prior flag.
    const isTainted = priorLedger.tainted[claimTaintKey(t.section.doc, t.section.anchor, t.claim.claim)] !== undefined
    const cached = isTainted ? null : await readAuthorCache(repoRoot, t.claim, t.section, recipeFingerprint)
    if (cached) {
      rawByRef.set(t.ref, cached.scenarios)
      if (cached.scenarios.length === 0 && cached.blockedOn && cached.blockedOn.length > 0) {
        blockedByRef.set(t.ref, cached.blockedOn)
      }
      bumpAuthor(1)
      resolveClaim(t, false)
    } else {
      missTasks.push(t)
    }
  }

  const missByDoc = new Map<string, AuthTask[]>()
  for (const t of missTasks) pushInto(missByDoc, t.section.doc, t)

  const authoring = Promise.all(
    [...missByDoc].flatMap(([docPath, tasks]) => {
      const gd = workDocByPath.get(docPath)!
      return chunk(tasks, batchSize).map((batch) =>
        limit(async () => {
          const probes = await groundClaims(batch.map((t) => t.claim.claim))
          const attempt = await callAuthorWithReask(
            buildAuthorCtx(gd, batch, recipe, probes, priorLedger.tainted),
            generateRunner,
            authorFailureEmitter(batch, options.onAuthorFailure),
          )
          if ('error' in attempt) {
            for (const t of batch) {
              errors.push({ doc: t.section.doc, anchor: t.section.anchor, message: `authoring ${attempt.error}` })
              resolveClaim(t, true)
            }
          } else {
            const byRef = new Map(attempt.authored.map((a) => [a.ref, a]))
            for (const t of batch) {
              const authored = byRef.get(t.ref)
              if (authored === undefined) {
                errors.push({ doc: t.section.doc, anchor: t.section.anchor, message: `authoring returned no output for claim "${oneLine(t.claim.claim)}"` })
                resolveClaim(t, true)
                continue
              }
              // `blockedOn` is meaningful only for an empty-scenarios claim.
              const blocked =
                authored.scenarios.length === 0 ? normalizeBlockedOn(authored.blockedOn ?? []) : []
              rawByRef.set(t.ref, authored.scenarios)
              if (blocked.length > 0) blockedByRef.set(t.ref, blocked)
              await writeAuthorCache(repoRoot, t.claim, t.section, recipeFingerprint, authored.scenarios, blocked)
              // The round-1 cache was (over)written — any prior taint on this claim is
              // cleared at run end unless the fresh scenario re-flags below.
              freshlyAuthoredClaimKeys.add(claimTaintKey(t.section.doc, t.section.anchor, t.claim.claim))
              resolveClaim(t, false)
            }
          }
          bumpAuthor(batch.length)
        }),
      )
    }),
  )

  await authoring
  await settleChain

  // No-op anomaly abort: the recipe entry ran birth candidates as do-nothing steps,
  // so nothing produced this run is trustworthy. Roll back — delete every scenario
  // file written this run AND every work section's prior files, drop the work
  // sections from the manifest (they re-generate once the recipe is fixed), and fail
  // loudly. No scenarios written, no findings reported, no retries/fidelity spent.
  if (noOpAnomaly) {
    deleteScenarioFiles(repoRoot, written.map((w) => w.id))
    for (const section of plan.work) {
      const k = key(section)
      deleteScenarioFiles(repoRoot, priorIdsOf(k))
      workingManifest.delete(k)
    }
    writeWorkingManifest()
    return emptyResult('recipe-failed', { reason: noOpAnomalyReason(noOpAnomaly, recipe.entry) })
  }

  // Triage — one judgment call per birth/fidelity finding, AFTER they all
  // settle. Each verdict + recommendation is attached to its finding in place (the
  // report carries it). Fail-soft and cached per finding identity, so a re-generate
  // re-triages only new/changed findings; a finding simply ships without triage when
  // no triage runner is configured or a call can't complete. The verdict is a
  // recommendation with quoted evidence — advisory, never auto-applied. The section
  // text + grounding probes it needs come from the settle-time state (probes are a
  // cache hit — authoring already grounded the finding's claim).
  if (birthFindings.length > 0) {
    let triaged = 0
    options.onTriageProgress?.(triaged, birthFindings.length)
    await Promise.all(
      birthFindings.map((finding) =>
        limit(async () => {
          const section = sectionByKey.get(key(finding))
          const probes = finding.claim ? await groundClaims([finding.claim]) : []
          const triage = await runTriage(
            repoRoot,
            finding,
            {
              sectionHeading: section?.headingText ?? finding.anchor,
              sectionText: section ? section.fullText || section.ownText : '',
              probes,
            },
            triageRunner,
          )
          if (triage) finding.triage = triage
          options.onTriageProgress?.(++triaged, birthFindings.length)
        }),
      ),
    )
  }

  // Item 14: high-confidence triage recommendations auto-resolve — the human sees
  // only real questions. A finding whose triage said `environment` or
  // `generation-defect` at HIGH confidence is not a human question; the tool acts on
  // it itself and records a ledger entry (never silence, never a task):
  //   - environment       → auto-DISMISS the claim into scenarios/decisions.json
  //     (marked `auto`, brief as the reason) — it is untestable in this sandbox, so
  //     generate skips it next run.
  //   - generation-defect → retire the FINDING to the ledger; the claim is fine, our
  //     scenario was bad, so the claim re-attempts next generate.
  // Drift (doc/code, any confidence) and any verdict below HIGH stay HUMAN findings —
  // drift is the product's value; it is never auto-resolved. Escalation guard: a
  // finding identity that keeps auto-resolving without converging (default 2) surfaces
  // to the human with a "re-generation is not fixing this" note — auto-resolution is
  // never an infinite silent loop. The durable per-identity count lives in the
  // gitignored `guard/auto-resolutions.json` (the triage cache key IS the identity).
  // The escalation counts carried forward (rebuilt from scratch when findings exist,
  // else left untouched) — written to the durable ledger at run end alongside taints.
  // `hadFindings` captures the pre-reassignment count so the write below still fires
  // when EVERY finding auto-resolved (birthFindings is then empty but entries changed).
  const hadFindings = birthFindings.length > 0
  let nextEntries: Record<string, GuardAutoResolutionEntry> = priorLedger.entries
  if (birthFindings.length > 0) {
    const escalateAfter = Math.max(1, options.escalateAutoResolveAfter ?? DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER)
    nextEntries = {}
    const humanFindings: GuardBirthFinding[] = []
    const autoDismissals: GuardDismissedClaim[] = []

    for (const finding of birthFindings) {
      const action = finding.triage ? triageAutoResolution(finding.triage) : null
      if (!action) {
        // Drift, a medium/low verdict, or no triage — a human task, exactly as today.
        humanFindings.push(finding)
        continue
      }
      const key = triageCacheKey(finding)
      const prior = priorLedger.entries[key]
      const priorCount = prior?.count ?? 0
      // Escalation: this identity already auto-resolved enough times without
      // converging — surface it to the human and keep the count so it stays escalated.
      if (priorCount >= escalateAfter) {
        finding.autoResolveEscalation = { verdict: finding.triage!.verdict, count: priorCount }
        humanFindings.push(finding)
        nextEntries[key] = { count: priorCount, verdict: finding.triage!.verdict, updatedAt: prior?.updatedAt ?? now }
        continue
      }
      if (action === 'dismiss') {
        // environment: auto-dismiss the claim. Needs the claim identity to key on; a
        // finding without one (an older internal finding) can't be dismissed — human.
        if (!finding.claim) {
          humanFindings.push(finding)
          continue
        }
        autoDismissals.push({
          doc: finding.doc,
          anchor: finding.anchor,
          title: finding.claim,
          dismissedAt: now,
          auto: true,
          reason: finding.triage!.brief,
        })
        autoResolved.push({
          kind: 'triage-dismiss',
          doc: finding.doc,
          anchor: finding.anchor,
          title: finding.title,
          verdict: finding.triage!.verdict,
          brief: finding.triage!.brief,
          claim: finding.claim,
        })
      } else {
        // generation-defect: retire the finding; the claim re-attempts next generate.
        autoResolved.push({
          kind: 'triage-resolve',
          doc: finding.doc,
          anchor: finding.anchor,
          title: finding.title,
          verdict: finding.triage!.verdict,
          brief: finding.triage!.brief,
        })
        // Item 2 — the claim re-attempts, so taint it: its round-1 author cache still
        // holds the rejected scenario, and re-serving it would treadmill.
        taintClaim(finding.doc, finding.anchor, finding.claim, finding.title, finding.triage!.brief)
      }
      nextEntries[key] = { count: priorCount + 1, verdict: finding.triage!.verdict, updatedAt: now }
    }

    // Item 2 — taint every claim that STAYS a scenario-defect finding this run (a
    // fidelity finding, or a generation-defect triage that didn't auto-resolve —
    // including an escalated one) so its next re-attempt bypasses the poisoned author
    // cache. Real doc/code drift is NOT tainted — the scenario is correct; re-authoring
    // won't help.
    for (const finding of humanFindings) {
      const isFidelity = finding.kind === 'fidelity'
      const isGenDefect = finding.triage?.verdict === 'generation-defect'
      if (isFidelity || isGenDefect) {
        taintClaim(finding.doc, finding.anchor, finding.claim, finding.title, isFidelity ? finding.actual : finding.triage?.brief ?? finding.actual)
      }
    }

    // Land the auto-dismissals in scenarios/decisions.json (read once, merge, write
    // once) so generate honors them on the next run. Idempotent on the (doc, anchor,
    // title) identity — an auto-dismissal refreshes a matching entry in place.
    if (autoDismissals.length > 0) {
      const byKey = new Map(
        decisions.dismissedClaims.map((d) => [dismissedClaimKey(d.doc, d.anchor, d.title), d]),
      )
      for (const d of autoDismissals) byKey.set(dismissedClaimKey(d.doc, d.anchor, d.title), d)
      writeGuardDecisions(repoRoot, { ...decisions, dismissedClaims: [...byKey.values()] })
    }

    // The returned findings are the HUMAN-needed ones only; the auto-resolved ones now
    // ride the `autoResolved` ledger, not the task list.
    birthFindings.length = 0
    birthFindings.push(...humanFindings)
  }

  // Item 3 — commit by default. A residual finding that is REAL DRIFT (triage verdict
  // doc/code-drift, or NO triage) COMMITS as a normal failing scenario carrying its
  // diagnosis; it fails at `guard run` until the drift is fixed. Tool-fault findings (a
  // `fidelity` flag, or a generation-defect/environment triage that did not auto-resolve
  // — medium/low or escalated) never commit: they stay in the item-1/2 fix loop (tainted
  // above, re-authored next generate) and remain the quiet tool-defect residue. A finding
  // with no retained candidate can't be committed, so it stays residue too.
  const canCommitFinding = (f: GuardBirthFinding): boolean =>
    f.kind !== 'fidelity' &&
    f.triage?.verdict !== 'generation-defect' &&
    f.triage?.verdict !== 'environment' &&
    findingCandidates.has(f)
  const driftFindings = birthFindings.filter(canCommitFinding)
  if (driftFindings.length > 0) {
    const residue = birthFindings.filter((f) => !canCommitFinding(f))
    const errorAnchors = new Set(errors.map((e) => `${e.doc}\0${e.anchor}`))
    const driftByKey = new Map<string, GuardBirthFinding[]>()
    for (const f of driftFindings) pushInto(driftByKey, key(f), f)
    for (const [k, findings] of driftByKey) {
      const section = findingCandidates.get(findings[0])!.section
      // A zero-survivor section never deleted its prior files at settle; replace them now
      // so the committed drift stands alone (delete-before-write, since a drift candidate
      // may reuse a freed prior id). A partial/clean section already deleted them.
      if (!settledKeys.has(k)) deleteScenarioFiles(repoRoot, priorIdsOf(k))
      const slug = areaOrDocSlug(section)
      const priorCommitted = workingManifest.get(k)?.scenarioIds ?? []
      const driftIds: string[] = []
      for (const f of findings) {
        const candidate = findingCandidates.get(f)!
        const file = writeScenarioFile(repoRoot, slug, candidate.scenario)
        written.push({
          id: candidate.scenario.id,
          title: candidate.scenario.title,
          doc: section.doc,
          anchor: section.anchor,
          file,
          diagnosis: diagnosisOf(f),
        })
        driftIds.push(candidate.scenario.id)
      }
      // A committed drift is a fully-processed outcome — the section settles CLEAN (hash
      // stamped, skipped next generate) unless it still carries a tool-fault residue or an
      // error, which keeps it PARTIAL so the outstanding claim re-attempts.
      const hasResidue = residue.some((f) => key(f) === k)
      const hasError = sectionAuthError.has(k) || errorAnchors.has(k)
      upsertSection(section, [...priorCommitted, ...driftIds], { settled: !hasResidue && !hasError })
    }
    birthFindings.length = 0
    birthFindings.push(...residue)
  }

  // Item 4 — family-level self-heal. After triage + the item-3 commit, the remaining
  // `birthFindings` are the TOOL-DEFECT residue (weak fidelity flags + generation-defect/
  // environment triage that neither auto-resolved nor committed as drift). A burst of
  // them is near-always a FEW mistakes repeated, so cluster by diagnosis similarity via
  // ONE cheap sonnet call and give each family (≥ 3 members) ONE shared re-author pass —
  // the model fixes the recurring pattern, not each instance blindly. A member that now
  // passes birth + fidelity commits clean (item-3 rules); a family that still won't
  // converge escalates as ONE tool-limitation row (a count + a plain-language
  // description + Dismiss), never a finding. Small clusters (< 3) keep the per-claim
  // path. Fail-soft: a thrown/invalid cluster call leaves the whole residue per-claim.
  const familyEscalations: GuardFamilyEscalation[] = []
  const taskByClaimKey = new Map<string, AuthTask>()
  for (const t of authTasks) taskByClaimKey.set(dismissedClaimKey(t.section.doc, t.section.anchor, t.claim.claim), t)
  const residueClaimKey = (f: GuardBirthFinding): string => dismissedClaimKey(f.doc, f.anchor, f.claim ?? '')
  // A residue finding is family-eligible only when it carries a claim (so it can be
  // both re-authored AND dismissed) whose authoring task is still around to re-run.
  const clusterEligible = birthFindings.filter((f) => f.claim && taskByClaimKey.has(residueClaimKey(f)))
  if (clusterEligible.length >= 3) {
    const briefs = clusterEligible.map((f) => f.triage?.brief ?? f.actual)
    const families = await clusterDefects(briefs, clusterRunner)
    // Cross-family de-dup (each eligible brief joins the first family that claims it),
    // then keep only families that still hold ≥ 3 members — the rest keep the per-claim
    // path (stay in `birthFindings`).
    type Fam = { correction: string; exemplars: string[]; description: string; members: GuardBirthFinding[] }
    const assigned = new Set<number>()
    const fams: Fam[] = []
    for (const fam of families ?? []) {
      const idxs = fam.members.filter((i) => !assigned.has(i))
      if (idxs.length < 3) continue
      for (const i of idxs) assigned.add(i)
      const members = idxs.map((i) => clusterEligible[i])
      const exemplars = dedupeStrings(members.map((m) => m.triage?.brief ?? m.actual)).slice(0, 2)
      fams.push({ correction: fam.correction, exemplars, description: fam.description, members })
    }

    if (fams.length > 0) {
      const errorAnchors = new Set(errors.map((e) => `${e.doc}\0${e.anchor}`))
      const clustered = new Set(fams.flatMap((f) => f.members))

      // Re-author every member of every family fresh, carrying the family's shared
      // correction + up to 2 exemplar mismatches. Free each rejected finding's reserved
      // id first so the fresh survivor reuses the stable `<leaf>.<n>`.
      type MemberState = { finding: GuardBirthFinding; fam: Fam; task: AuthTask; candidates: BirthCandidate[] }
      const memberStates: MemberState[] = []
      for (const fam of fams)
        for (const finding of fam.members) {
          const task = taskByClaimKey.get(residueClaimKey(finding))!
          const fc = findingCandidates.get(finding)
          if (fc) usedIds.delete(fc.scenario.id)
          memberStates.push({ finding, fam, task, candidates: [] })
        }
      retryTotal += memberStates.length
      options.onRetryProgress?.(retryDone, retryTotal)
      await Promise.all(
        memberStates.map((ms) =>
          limit(async () => {
            try {
              const gd = workDocByPath.get(ms.finding.doc)!
              const scs = await authorFamily(repoRoot, gd, ms.task, recipe, recipeFingerprint, generateRunner, { correction: ms.fam.correction, exemplars: ms.fam.exemplars }, errors, groundClaims, options.onAuthorFailure)
              for (const rawS of scs) {
                const built = safeBuild(ms.task.section, rawS, usedIds, errors, ms.task.claim.claim, ms.task.pack)
                if (built) ms.candidates.push({ section: ms.task.section, scenario: built, ref: ms.task.ref, claim: ms.task.claim })
              }
            } finally {
              options.onRetryProgress?.(++retryDone, retryTotal)
            }
          }),
        ),
      )

      // Birth + fidelity every member's candidates in ONE parallel pass (as elsewhere).
      const allCandidates = memberStates.flatMap((ms) => ms.candidates)
      const birthPass = new Set<BirthCandidate>()
      let famFid = new Map<BirthCandidate, FidelityResult>()
      if (allCandidates.length > 0) {
        birthTotal += allCandidates.length
        const [birthF, fidF] = await Promise.all([
          birthValidate(repoRoot, allCandidates, {
            executor,
            recipe,
            skipBuild: true,
            noOpThresholdMs: options.noOpThresholdMs,
            onPhase: options.onBirthPhase,
            onScenarioSettled: bumpBirth,
          }),
          runFidelity(allCandidates),
        ])
        reconcileBirth()
        for (const o of birthF.outcomes) if (o.result.outcome === 'pass') birthPass.add(o.candidate)
        famFid = fidF
      }

      // A member CONVERGES when it produced ≥ 1 candidate and EVERY one passed birth AND
      // was judged faithful — then it commits clean (its claim's taint clears). Otherwise
      // its fresh candidates are discarded (ids freed) and it stays in the family, which
      // escalates as one tool-limitation row.
      const faithful = (c: BirthCandidate): boolean => {
        const fr = famFid.get(c)
        return fr !== undefined && !('error' in fr) && fr.verdict === 'faithful'
      }
      const survivorsBySection = new Map<string, { section: SectionInput; candidates: BirthCandidate[] }>()
      const escalatedByFam = new Map<Fam, GuardBirthFinding[]>()
      for (const ms of memberStates) {
        const converged = ms.candidates.length > 0 && ms.candidates.every((c) => birthPass.has(c) && faithful(c))
        if (converged) {
          const k = key(ms.finding)
          const entry = survivorsBySection.get(k) ?? { section: ms.task.section, candidates: [] }
          for (const c of ms.candidates) {
            entry.candidates.push(c)
            birthPassed++
          }
          survivorsBySection.set(k, entry)
          const tk = claimTaintKey(ms.finding.doc, ms.finding.anchor, ms.finding.claim!)
          flaggedClaims.delete(tk)
          freshlyAuthoredClaimKeys.add(tk)
        } else {
          for (const c of ms.candidates) usedIds.delete(c.scenario.id)
          const list = escalatedByFam.get(ms.fam) ?? []
          list.push(ms.finding)
          escalatedByFam.set(ms.fam, list)
        }
      }

      // Every clustered member leaves `birthFindings` — a converged one committed, a
      // non-converged one now rides its family escalation (never a finding, never counted).
      const kept = birthFindings.filter((f) => !clustered.has(f))
      birthFindings.length = 0
      birthFindings.push(...kept)

      // One escalation row per non-converged family: the plain-language description + the
      // member count; the member identities ride along ONLY so a Dismiss can fan out to
      // each member's claim dismissal (never rendered). `id` is a stable hash of them.
      for (const [fam, members] of escalatedByFam) {
        if (members.length === 0) continue
        const memberIds: GuardFamilyMember[] = members.map((m) => ({ doc: m.doc, anchor: m.anchor, title: m.claim! }))
        const id = createHash('sha256')
          .update(memberIds.map((i) => dismissedClaimKey(i.doc, i.anchor, i.title)).sort().join('|'))
          .digest('hex')
          .slice(0, 16)
        familyEscalations.push({ id, description: fam.description, count: memberIds.length, members: memberIds })
      }

      // Commit the converged survivors — mirror the item-3 per-section commit. A section
      // settles CLEAN only when it has no residue left, no escalated member, and no error.
      const escalatedKeys = new Set([...escalatedByFam.values()].flat().map((f) => key(f)))
      for (const [k, entry] of survivorsBySection) {
        if (!settledKeys.has(k)) deleteScenarioFiles(repoRoot, priorIdsOf(k))
        const slug = areaOrDocSlug(entry.section)
        const priorCommitted = workingManifest.get(k)?.scenarioIds ?? []
        const ids: string[] = []
        for (const c of entry.candidates) {
          const file = writeScenarioFile(repoRoot, slug, c.scenario)
          written.push({ id: c.scenario.id, title: c.scenario.title, doc: entry.section.doc, anchor: entry.section.anchor, file })
          ids.push(c.scenario.id)
        }
        const stillOpen = birthFindings.some((f) => key(f) === k) || escalatedKeys.has(k) || sectionAuthError.has(k) || errorAnchors.has(k)
        upsertSection(entry.section, [...priorCommitted, ...ids], { settled: !stillOpen })
      }
    }
  }

  // Item 2 — reconcile the durable claim-taint set and write the ledger ONCE (escalation
  // counts + taints together). A claim FRESHLY re-authored this run had its poisoned
  // cache overwritten, so its old taint clears; a claim that ended flagged (a scenario
  // defect) is (re)tainted with the latest evidence. A claim neither re-authored nor
  // flagged (its section unchanged, or its author call errored so the cache still holds
  // the bad scenario) keeps its prior taint. Written only when something is (or was) in
  // the ledger, so a clean no-taint run never creates the file.
  const nextTainted: Record<string, GuardClaimTaint> = { ...priorLedger.tainted }
  for (const k of freshlyAuthoredClaimKeys) delete nextTainted[k]
  for (const [k, taint] of flaggedClaims) nextTainted[k] = taint
  if (
    hadFindings ||
    Object.keys(nextTainted).length > 0 ||
    Object.keys(priorLedger.tainted).length > 0
  ) {
    writeGuardAutoResolutions(repoRoot, { version: 1, entries: nextEntries, tainted: nextTainted })
  }

  // Every authoring call failed and nothing was committed — same shape as the
  // extraction abort, one stage later. Returning `ok` here would report a run that
  // authored nothing as a clean no-op, and the zero-survivor sweep below would
  // delete each changed section's PRIOR scenarios over an LLM outage. Abort before
  // the sweep: prior scenarios and manifest entries survive, and the sections stay
  // work for the next run. A run that DID commit scenarios (some claims were cached)
  // is never an abort — its failures are reported in `llmFailures` instead.
  if (audit.isSystemicFailure('guard.generate') && written.length === 0) {
    return llmFailedResult(audit, 'guard.generate', {
      recipe: recipeMeta,
      sectionsTotal: plan.sections.length,
      sectionsChanged: plan.work.length,
      skippedUnchanged: plan.sections.length - plan.work.length,
      coverageGaps,
      errors,
      extractionFailures,
      orphaned,
      orphanedDismissals,
    })
  }

  // 6. Run end — the zero-survivor sweep. Under per-scenario commit (item 15) a work
  // section committed a manifest entry (`settledKeys`) the moment it landed ≥1 green,
  // whether it settled clean or PARTIAL (a sibling finding/error still open). Only a
  // ZERO-SURVIVOR section — committed nothing this run (an extraction failure, an
  // authoring error, or every claim a birth finding) — reaches here; it drops its
  // prior files + manifest entry so the next run re-attempts it wholesale. A section
  // that committed 2 of 3 claims is in `settledKeys`, so its 2 greens are NEVER
  // deleted just because claim 3 is still a finding (the partial entry's null
  // generationInputsHash is what re-attempts claim 3 next run). Final manifest write.
  for (const section of plan.work) {
    const k = key(section)
    if (settledKeys.has(k)) continue
    deleteScenarioFiles(repoRoot, priorIdsOf(k))
    workingManifest.delete(k)
  }
  writeWorkingManifest()

  return {
    status: 'ok',
    recipe: recipeMeta,
    sectionsTotal: plan.sections.length,
    sectionsChanged: plan.work.length,
    skippedUnchanged: plan.sections.length - plan.work.length,
    noChanges: false,
    written,
    coverageGaps,
    birthFindings,
    errors,
    extractionFailures,
    llmFailures: audit.failures(),
    orphaned,
    birthPassed,
    orphanedDismissals,
    autoResolved,
    familyEscalations,
    manifestPath: manifestPath(repoRoot),
    ...(entryPreflightFailure ? { entryPreflight: entryPreflightFailure } : {}),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** One cli claim queued for authoring, with the ref the model echoes back. */
interface AuthTask {
  ref: string
  section: SectionInput
  claim: ExtractedClaim
  /** The input-corpus pack id stamped onto the built scenario's `inputs`, for a claim
   *  the engine seeds a pack for: an invariant claim's seeded pack (item 8) or a
   *  support claim's GENERATED exemplar pack (item 9, set by the async seeding phase).
   *  Absent for a normal/example claim, or an invariant claim with no seed blocks (it
   *  then authors as a single-input scenario). */
  pack?: string
}

const key = (s: { doc: string; anchor: string }): string => `${s.doc}\0${s.anchor}`

/** The durable claim-taint key (item 2): a hash of the claim identity — the same
 *  (doc, anchor, claim-text) trio a dismissal keys on. The ledger stores the identity
 *  fields in the entry, so the hashed key stays opaque and JSON-clean. */
function claimTaintKey(doc: string, anchor: string, claim: string): string {
  return createHash('sha256').update(dismissedClaimKey(doc, anchor, claim)).digest('hex')
}

/**
 * The auto-resolution action a triage verdict warrants (item 14), or `null` when the
 * finding stays a human task. Only a HIGH-confidence non-drift verdict auto-resolves:
 * `environment` → `dismiss` (the claim is untestable here), `generation-defect` →
 * `resolve` (our scenario was bad; the claim re-attempts). Drift (doc/code) at ANY
 * confidence, and everything below HIGH, stays human — drift is never auto-resolved.
 */
function triageAutoResolution(triage: GuardTriage): 'dismiss' | 'resolve' | null {
  if (triage.confidence !== 'high') return null
  if (triage.verdict === 'environment') return 'dismiss'
  if (triage.verdict === 'generation-defect') return 'resolve'
  return null
}

function oneLine(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 120 ? `${t.slice(0, 120)}…` : t
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Trim, drop empties, and de-dupe (first-seen order) a list of strings — used to pick
 *  a family's exemplar mismatches without repeating an identical brief. */
function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of items) {
    const t = s.trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

/** Group a doc's snapped extraction by anchor: claims per section + notes per section. */
function groupExtraction(data: DocClaims): {
  claimsByAnchor: Map<string, ExtractedClaim[]>
  noteByAnchor: Map<string, UntestableNote>
} {
  const claimsByAnchor = new Map<string, ExtractedClaim[]>()
  for (const c of data.claims) pushInto(claimsByAnchor, c.sectionAnchor, c)
  const noteByAnchor = new Map(data.untestable.map((n) => [n.sectionAnchor, n]))
  return { claimsByAnchor, noteByAnchor }
}

/**
 * The per-section manifest classification summary, derived from extraction: cli
 * when any claim is CLI-testable, else the first other driver, else untestable.
 */
function deriveClassification(
  cli: ExtractedClaim[],
  others: ExtractedClaim[],
  note: UntestableNote | undefined,
): TestabilityVerdict {
  if (cli.length > 0) {
    return { driver: 'cli', reason: cli.length === 1 ? cli[0].reason : `${cli.length} CLI claims; e.g. ${oneLine(cli[0].reason)}` }
  }
  if (others.length > 0) return { driver: others[0].driver, reason: others[0].reason }
  if (note) return { untestable: true, reason: note.reason }
  return { untestable: true, reason: 'no externally-observable claim stated' }
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
    orphaned: [],
    birthPassed: 0,
    orphanedDismissals: [],
    autoResolved: [],
    familyEscalations: [],
    llmFailures: [],
    ...extra,
  }
}

/**
 * The `llm-failed` abort for a stage that lost EVERY call: the stage's own tally
 * becomes the user-facing reason, and every stage tally of the run rides along.
 * Nothing this run produced is claimed as output — the caller returns it INSTEAD of
 * writing scenarios or the manifest.
 */
function llmFailedResult(
  audit: TransportAudit,
  stage: string,
  known: Partial<GuardGenerateResult>,
): GuardGenerateResult {
  return emptyResult('llm-failed', {
    reason: `${formatStageFailure(audit.tally(stage))} Nothing was generated; the committed scenarios and manifest are unchanged.`,
    llmFailures: audit.failures(),
    ...known,
  })
}

/**
 * The `recipe-failed` reason for a do-nothing recipe entry: names the suspicion, the
 * entry argv, and the counts that tripped detection. The percentage rounds the
 * anomaly fraction; the threshold explains why instant steps looked like no-ops.
 */
function noOpAnomalyReason(anomaly: GuardNoOpAnomaly, entry: readonly string[]): string {
  const pct = Math.round(anomaly.fraction * 100)
  return (
    `The recipe entry \`${entry.join(' ')}\` behaves like a do-nothing binary: ${anomaly.noOpSteps} of ` +
    `${anomaly.executedSteps} birth steps (${pct}%) exited 0 with no output in under ${anomaly.thresholdMs}ms, ` +
    `so it ignores its arguments. Every scenario validated against it would be a silent no-op, so generation ` +
    `was aborted before writing any scenarios or spending a retry round. Fix the recipe entry (it likely ` +
    `names a stale build output or a placeholder such as \`true\`) and re-run \`truecourse guard generate\`.`
  )
}

function readPriorManifest(repoRoot: string): GuardManifestSection[] {
  return readManifest(repoRoot)?.sections ?? []
}

/** Append `value` to the array at `map[key]`, creating it on first use. */
function pushInto<T>(map: Map<string, T[]>, k: string, value: T): void {
  const list = map.get(k)
  if (list) list.push(value)
  else map.set(k, [value])
}

// --- Authoring context + caching -------------------------------------------

/** The example payload to thread to authoring, present only for an example claim
 *  (extraction `flavor: 'example'`) that actually carries its block bytes. */
function exampleOf(claim: ExtractedClaim): Pick<AuthorClaim, 'example'> {
  return claim.flavor === 'example' && claim.example ? { example: claim.example } : {}
}

/** The invariant payload to thread to authoring, present only for an invariant claim
 *  (extraction `flavor: 'invariant'`) whose pack was seeded — the sample inputs let
 *  the model shape the property assertion over the corpus (item 8). */
function invariantOf(task: AuthTask): Pick<AuthorClaim, 'invariant'> {
  if (task.claim.flavor !== 'invariant' || !task.pack) return {}
  return { invariant: { pack: task.pack, samples: task.claim.examples ?? [] } }
}

/** The support payload to thread to authoring, present only for a support claim
 *  (extraction `flavor: 'support'`) — the subject + class + optional extension tell
 *  the model to author ONE rule over the engine-generated exemplar corpus (item 9).
 *  The pack itself is engine-seeded; the model never authors it. */
function supportOf(task: AuthTask): Pick<AuthorClaim, 'support'> {
  if (task.claim.flavor !== 'support' || !task.claim.support) return {}
  const s = task.claim.support
  return { support: { kind: s.kind, subject: s.subject, ...(s.extension ? { extension: s.extension } : {}) } }
}

/** The prior-flag payload to thread to a round-1 author call, present only for a
 *  TAINTED claim (item 2): the rejected scenario's title + why it was rejected, so the
 *  fresh author avoids reproducing the flagged shape. */
function priorFlagOf(task: AuthTask, tainted: Record<string, GuardClaimTaint>): Pick<AuthorClaim, 'priorFlag'> {
  const t = tainted[claimTaintKey(task.section.doc, task.section.anchor, task.claim.claim)]
  return t ? { priorFlag: { title: t.title, mismatch: t.mismatch } } : {}
}

/** Author context for a batch of AuthTasks (round 1). Tainted claims (item 2) carry
 *  their prior flag's evidence as correction. */
function buildAuthorCtx(
  gd: GuardDoc,
  batch: AuthTask[],
  recipe: Recipe,
  probes: ProbeTranscript[],
  tainted: Record<string, GuardClaimTaint>,
): AuthorUserContext {
  const claims: AuthorClaim[] = batch.map((t) => ({ ref: t.ref, claim: t.claim.claim, section: t.section, ...exampleOf(t.claim), ...invariantOf(t), ...supportOf(t), ...priorFlagOf(t, tainted) }))
  return buildAuthorCtxFor(gd, claims, recipe, probes)
}

/** Author context for explicit AuthorClaims (round 2 carries retry evidence). */
function buildAuthorCtxFor(gd: GuardDoc, claims: AuthorClaim[], recipe: Recipe, probes: ProbeTranscript[]): AuthorUserContext {
  return {
    doc: gd.doc,
    docContext: buildAuthorDocContext(gd),
    areaTags: gd.sections[0]?.areaTags ?? [],
    recipeEntry: recipe.entry,
    recipeBuild: recipe.build,
    claims,
    probes,
  }
}

type AuthorAttempt = { authored: AuthoredClaim[] } | { error: string }

/** A validated reply, or the two pieces a corrective re-ask needs: the text to quote
 *  back (a composition defect embeds its own explanation) and the final error. */
type AuthoredValidation = { authored: AuthoredClaim[] } | { correction: string; reason: string }

/**
 * Validate one authoring reply against BOTH the schema and the run[]-composition rule
 * (a step's `run` must be argv-only — never the entrypoint or a foreign binary). A
 * defect on either front yields the corrective text to quote back and the final error.
 */
function validateAuthored(raw: unknown, entry: readonly string[]): AuthoredValidation {
  const parsed = AuthoredBatchSchema.safeParse(raw)
  if (!parsed.success) {
    return { correction: quoteInvalidOutput(raw), reason: `output invalid after re-ask: ${flattenZodError(parsed.error)}` }
  }
  const defect = scenarioCompositionDefect(parsed.data, entry)
  if (defect) {
    return {
      correction: `${defect}\n\nYour previous output was:\n${quoteInvalidOutput(raw)}`,
      reason: `scenario composition invalid after re-ask: ${defect}`,
    }
  }
  return { authored: parsed.data }
}

/** One failed authoring attempt, sunk to the live surface (item 2). */
type AttemptFailSink = (info: { reason: string; attempt: number; willRetry: boolean }) => void

/** A clean one-line reason for a thrown authoring call — a timeout collapses to
 *  `timed out after Nm`, anything else to its trimmed message. */
function authorFailureReason(raw: string): string {
  const m = /timed out(?: after (\d+)\s*ms)?/i.exec(raw)
  if (m) {
    const mins = m[1] ? Math.round(parseInt(m[1], 10) / 60000) : 0
    return mins > 0 ? `timed out after ${mins}m` : 'timed out'
  }
  return oneLine(raw)
}

/**
 * Call the author runner and validate its batch output (schema + run[]-composition);
 * on a defect re-ask ONCE with the corrective text quoted back, then validate again.
 * A thrown call is not re-asked. Returns `{ error }` on a still-invalid or thrown call.
 * `onAttemptFail` (item 2) fires the moment each attempt fails so the caller can
 * surface it live before the whole call sequence resolves.
 */
async function callAuthorWithReask(
  ctx: AuthorUserContext,
  runner: GenerateRunner,
  onAttemptFail?: AttemptFailSink,
): Promise<AuthorAttempt> {
  let raw: unknown
  try {
    raw = await runner(ctx)
  } catch (e) {
    onAttemptFail?.({ reason: authorFailureReason((e as Error).message), attempt: 1, willRetry: false })
    return { error: `call failed: ${(e as Error).message}` }
  }
  const first = validateAuthored(raw, ctx.recipeEntry)
  if ('authored' in first) return { authored: first.authored }
  // Invalid output on the first call — a corrective re-ask follows.
  onAttemptFail?.({ reason: 'invalid output', attempt: 1, willRetry: true })

  let reRaw: unknown
  try {
    reRaw = await runner({ ...ctx, correction: { invalidOutput: first.correction } })
  } catch (e) {
    onAttemptFail?.({ reason: authorFailureReason((e as Error).message), attempt: 2, willRetry: false })
    return { error: `re-ask failed: ${(e as Error).message}` }
  }
  const second = validateAuthored(reRaw, ctx.recipeEntry)
  if ('authored' in second) return { authored: second.authored }
  onAttemptFail?.({ reason: 'invalid output twice', attempt: 2, willRetry: false })
  return { error: second.reason }
}

/**
 * The per-attempt failure sink for one authoring call: fans each failed attempt out
 * to `onAuthorFailure` once per distinct section in the batch (item 2). Returns
 * undefined when no sink is wired (the common non-CLI path) so the call stays cheap.
 */
function authorFailureEmitter(
  batch: AuthTask[],
  onAuthorFailure?: (f: AuthorFailure) => void,
): AttemptFailSink | undefined {
  if (!onAuthorFailure) return undefined
  const seen = new Set<string>()
  const sections: { doc: string; anchor: string }[] = []
  for (const t of batch) {
    const k = key(t.section)
    if (seen.has(k)) continue
    seen.add(k)
    sections.push({ doc: t.section.doc, anchor: t.section.anchor })
  }
  return (info) => {
    for (const s of sections) onAuthorFailure({ doc: s.doc, anchor: s.anchor, ...info })
  }
}

async function readAuthorCache(
  repoRoot: string,
  claim: ExtractedClaim,
  section: SectionInput,
  recipeFingerprint: string,
): Promise<AuthoredCacheEntry | null> {
  const cached = await getCacheEntry(repoRoot, GENERATE_CACHE_NAME, authorCacheKey(claim, section, recipeFingerprint))
  if (!cached) return null
  const parsed = AuthoredCacheSchema.safeParse(cached)
  return parsed.success ? parsed.data : null
}

async function writeAuthorCache(
  repoRoot: string,
  claim: ExtractedClaim,
  section: SectionInput,
  recipeFingerprint: string,
  scenarios: RawGeneratedScenario[],
  blockedOn: string[],
): Promise<void> {
  const entry: AuthoredCacheEntry = { scenarios, ...(blockedOn.length > 0 ? { blockedOn } : {}) }
  await setCacheEntry(repoRoot, GENERATE_CACHE_NAME, authorCacheKey(claim, section, recipeFingerprint), entry)
}

/** The cached authored output for one claim: its scenarios plus, when it authored
 *  none because it needs unavailable world-state, the capabilities it's blocked on. */
const AuthoredCacheSchema = z.object({
  scenarios: z.array(RawGeneratedScenarioSchema),
  blockedOn: z.array(z.string().min(1)).optional(),
})
type AuthoredCacheEntry = z.infer<typeof AuthoredCacheSchema>

/** Lowercase, trim, and dedupe (first-seen order) the capability nouns a blocked claim named. */
function normalizeBlockedOn(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const t = n.trim().toLowerCase()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

/** Build a scenario, recording a validation failure as an error rather than throwing.
 *  `claim` is the extracted claim text persisted onto the committed scenario. `pack`
 *  (item 8) is the seeded invariant pack id — when present, the built scenario binds
 *  its `inputs` to that pack, with the staged name the model authored (`inputs.as`). */
function safeBuild(
  section: SectionInput,
  raw: RawGeneratedScenario,
  usedIds: Set<string>,
  errors: GuardGenerateError[],
  claim: string,
  pack?: string,
): GuardScenario | null {
  const id = assignScenarioId(section.anchor, usedIds)
  try {
    const inputs = pack ? { pack, as: raw.inputs?.as ?? DEFAULT_INPUT_NAME } : undefined
    return buildScenario(section, raw, id, claim, inputs)
  } catch (e) {
    usedIds.delete(id)
    errors.push({ doc: section.doc, anchor: section.anchor, message: `invalid generated scenario: ${(e as Error).message}` })
    return null
  }
}

/** The DEFINED excerpt fields of a failure/finding, for spreading — an absent
 *  stream stays absent (never an explicit `undefined` key in the JSON). */
function excerptsOf(src: OutputExcerpts | undefined): OutputExcerpts {
  return {
    ...(src?.stdout !== undefined ? { stdout: src.stdout } : {}),
    ...(src?.stderr !== undefined ? { stderr: src.stderr } : {}),
  }
}

/** The diagnosis stamped onto a committed FAILING scenario (item 3) — the birth
 *  expected/actual + raw output, its evidence pointer, and the triage verdict +
 *  recommendation, so the run's failing row explains the drift. */
function diagnosisOf(f: GuardBirthFinding): GuardScenarioDiagnosis {
  return {
    step: f.step,
    expected: f.expected,
    actual: f.actual,
    ...excerptsOf(f),
    ...(f.evidencePath ? { evidencePath: f.evidencePath } : {}),
    ...(f.triage ? { triage: f.triage } : {}),
  }
}

function toFinding(o: {
  candidate: BirthCandidate
  result: { failure?: { step: number; expected: string; actual: string } & OutputExcerpts; evidencePath?: string }
}): GuardBirthFinding {
  const f = o.result.failure
  return {
    doc: o.candidate.section.doc,
    anchor: o.candidate.section.anchor,
    title: o.candidate.scenario.title,
    step: f?.step ?? 1,
    expected: f?.expected ?? '',
    actual: f?.actual ?? '',
    ...(o.result.evidencePath ? { evidencePath: o.result.evidencePath } : {}),
    // Fix 1: the failing run's RAW program output rides on the finding so the retry
    // prompt (and the dashboards) see the usage error the program printed.
    ...excerptsOf(f),
    // Judge-on-one-screen (item 19): the failed candidate's exact YAML rides inline
    // so the finding detail shows the commands it ran; `claim` is the dismissal
    // identity (item 20) so the detail's Dismiss action can key on it.
    yaml: serializeScenarioYaml(o.candidate.scenario),
    claim: o.candidate.claim.claim,
  }
}

/** The `dismissed` coverage-gap reason: the claim one-liner, plus the note if any. */
function dismissedReason(claim: string, note?: string): string {
  const base = `dismissed: ${oneLine(claim)}`
  return note ? `${base} — ${oneLine(note)}` : base
}

function errorFrom(o: { candidate: BirthCandidate; result: { failure?: { actual: string } } }): GuardGenerateError {
  return {
    doc: o.candidate.section.doc,
    anchor: o.candidate.section.anchor,
    message: `birth validation error for "${o.candidate.scenario.title}": ${o.result.failure?.actual ?? 'unknown'}`,
  }
}

// --- Fidelity review (item 33) -----------------------------------------------

/** The reviewer's decision on one green candidate: persist, flag (with a confidence
 *  that decides self-heal vs finding), or (a review that couldn't complete) surface
 *  as an error that unsettles the section. */
type FidelityConfidence = 'high' | 'medium' | 'low'
type FidelityResult =
  | { verdict: 'faithful' }
  | { verdict: 'flagged'; mismatch: string; confidence: FidelityConfidence }
  | { error: string }

/**
 * Review ONE green candidate for fidelity, cached per scenario-content +
 * section-content (+ the claim + the fidelity prompt) so a re-run is a hit and no
 * second call fires for an unchanged scenario+section. A cache HIT never calls the
 * runner; a validated verdict (faithful or flagged) is cached, an error is not.
 */
async function reviewFidelity(
  repoRoot: string,
  candidate: BirthCandidate,
  runner: FidelityRunner,
): Promise<FidelityResult> {
  const scenarioYaml = serializeScenarioYaml(candidate.scenario)
  const section = candidate.section
  const claimText = candidate.claim.claim
  const cacheKey = fidelityCacheKey(scenarioBehavior(candidate.scenario), section, claimText)

  const cached = await getCacheEntry(repoRoot, FIDELITY_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = FidelityReviewSchema.safeParse(cached)
    if (parsed.success) return normalizeFidelity(parsed.data)
  }

  const ctx: FidelityUserContext = {
    doc: section.doc,
    sectionHeading: section.headingText,
    sectionText: section.fullText || section.ownText,
    claim: claimText,
    scenarioYaml,
  }
  const attempt = await callFidelityWithReask(ctx, runner)
  if ('error' in attempt) return { error: attempt.error }
  await setCacheEntry(repoRoot, FIDELITY_CACHE_NAME, cacheKey, attempt.review)
  return normalizeFidelity(attempt.review)
}

/** A flagged verdict always yields a non-empty mismatch (the finding's evidence) and
 *  a confidence — a missing one reads conservatively as `medium` (a finding, never an
 *  auto-discard without an explicit high signal). */
function normalizeFidelity(r: {
  verdict: 'faithful' | 'flagged'
  mismatch?: string
  confidence?: FidelityConfidence
}): FidelityResult {
  if (r.verdict === 'flagged') {
    return {
      verdict: 'flagged',
      mismatch: r.mismatch?.trim() || 'the scenario does not verify what the claim asserts',
      confidence: r.confidence ?? 'medium',
    }
  }
  return { verdict: 'faithful' }
}

/** A scenario's BEHAVIORAL identity — the fields the reviewer judges, excluding the
 *  engine-assigned `id`/`binds`/`guard` bookkeeping (which churns on re-allocation
 *  without changing what the scenario verifies), so the cache is stable across id
 *  reassignment. */
function scenarioBehavior(scenario: GuardScenario): string {
  return JSON.stringify({
    title: scenario.title,
    driver: scenario.driver,
    setup: scenario.setup ?? null,
    steps: scenario.steps,
    normalize: scenario.normalize ?? [],
  })
}

/** Per-scenario fidelity cache key: it moves with the scenario BEHAVIOR, the section
 *  content, the claim, the format, or the fidelity prompt — nothing machine-specific. */
function fidelityCacheKey(scenarioBehaviorKey: string, section: SectionInput, claim: string): string {
  return createHash('sha256')
    .update(
      [
        FIDELITY_PROMPT_FINGERPRINT,
        String(GUARD_FORMAT_VERSION),
        section.fingerprint,
        claim.replace(/\s+/g, ' ').trim(),
        scenarioBehaviorKey,
      ].join('::'),
    )
    .digest('hex')
}

type FidelityAttempt =
  | { review: { verdict: 'faithful' | 'flagged'; mismatch?: string; confidence?: FidelityConfidence } }
  | { error: string }

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

/** Classify a self-heal ref's outcome from its re-authored replacements: `resolved`
 *  (all persisted faithfully), `finding` (any replacement flagged again / failed
 *  birth), or `unresolved` (no replacement authored, or a review couldn't complete). */
function selfHealOutcome(
  replacements: BirthCandidate[],
  disposition: Map<BirthCandidate, 'persist' | 'finding' | 'error'>,
): 'resolved' | 'finding' | 'unresolved' {
  if (replacements.length === 0) return 'unresolved'
  const ds = replacements.map((c) => disposition.get(c))
  if (ds.some((d) => d === 'finding')) return 'finding'
  if (ds.some((d) => d === 'error' || d === undefined)) return 'unresolved'
  return 'resolved'
}

/** A fidelity finding: a green scenario the reviewer judged unfaithful. Same shape
 *  as a birth finding (yaml + claim inline) with `kind: 'fidelity'`; the reviewer's
 *  mismatch is the evidence (`actual`), and there is no birth step/evidence file. */
function fidelityFinding(candidate: BirthCandidate, mismatch: string): GuardBirthFinding {
  return {
    doc: candidate.section.doc,
    anchor: candidate.section.anchor,
    kind: 'fidelity',
    title: candidate.scenario.title,
    step: 1,
    expected: 'a scenario that verifies what the claim asserts',
    actual: mismatch,
    yaml: serializeScenarioYaml(candidate.scenario),
    claim: candidate.claim.claim,
  }
}

/**
 * Re-author ONE failed claim with its birth evidence, cached per claim + evidence
 * so a stopped/re-run generate never re-pays the retry round. On a cache hit the
 * runner is not called; a validated output (including empty/blocked) is cached.
 */
async function authorRetry(
  repoRoot: string,
  gd: GuardDoc,
  entry: { task: AuthTask; evidence: GuardBirthFinding },
  section: SectionInput,
  recipe: Recipe,
  recipeFingerprint: string,
  runner: GenerateRunner,
  errors: GuardGenerateError[],
  ground: (claimTexts: string[]) => Promise<ProbeTranscript[]>,
  onAuthorFailure?: (f: AuthorFailure) => void,
): Promise<RawGeneratedScenario[]> {
  const cached = await readRetryCache(repoRoot, entry.task.claim, section, recipeFingerprint, entry.evidence)
  if (cached) return cached.scenarios

  // Same transcripts as round 1 (cached by argv) — derived from this claim only.
  const probes = await ground([entry.task.claim.claim])
  const claim: AuthorClaim = {
    ref: entry.task.ref,
    claim: entry.task.claim.claim,
    section,
    ...exampleOf(entry.task.claim),
    ...invariantOf(entry.task),
    ...supportOf(entry.task),
    retry: {
      scenarioTitle: entry.evidence.title,
      step: entry.evidence.step,
      expected: entry.evidence.expected,
      actual: entry.evidence.actual,
      // The failing run's raw program output — the evidence the retry prompt renders.
      ...excerptsOf(entry.evidence),
    },
  }
  const attempt = await callAuthorWithReask(
    buildAuthorCtxFor(gd, [claim], recipe, probes),
    runner,
    authorFailureEmitter([entry.task], onAuthorFailure),
  )
  if ('error' in attempt) {
    errors.push({ doc: section.doc, anchor: section.anchor, message: `retry authoring ${attempt.error}` })
    return []
  }
  const authored = new Map(attempt.authored.map((a) => [a.ref, a])).get(entry.task.ref)
  const scenarios = authored?.scenarios ?? []
  const blocked = scenarios.length === 0 ? normalizeBlockedOn(authored?.blockedOn ?? []) : []
  await writeRetryCache(repoRoot, entry.task.claim, section, recipeFingerprint, entry.evidence, scenarios, blocked)
  return scenarios
}

/** Per-retry cache key: the round-1 key plus the birth evidence that drove the re-ask.
 *  The evidence hash folds the raw program-output excerpts (Fix 1) so a pre-change
 *  cached retry (keyed on title/step/expected/actual alone) can never shadow a
 *  re-ask that now carries the failing run's stdout/stderr. */
export function retryCacheKey(
  claim: ExtractedClaim,
  section: SectionInput,
  recipeFingerprint: string,
  evidence: GuardBirthFinding,
): string {
  const evidenceHash = createHash('sha256')
    .update(
      [
        evidence.title,
        String(evidence.step),
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
        GENERATE_PROMPT_FINGERPRINT,
        recipeFingerprint,
        String(GUARD_FORMAT_VERSION),
        section.fingerprint,
        claim.claim.replace(/\s+/g, ' ').trim(),
        evidenceHash,
      ].join('::'),
    )
    .digest('hex')
}

async function readRetryCache(
  repoRoot: string,
  claim: ExtractedClaim,
  section: SectionInput,
  recipeFingerprint: string,
  evidence: GuardBirthFinding,
): Promise<AuthoredCacheEntry | null> {
  const cached = await getCacheEntry(repoRoot, GENERATE_CACHE_NAME, retryCacheKey(claim, section, recipeFingerprint, evidence))
  if (!cached) return null
  const parsed = AuthoredCacheSchema.safeParse(cached)
  return parsed.success ? parsed.data : null
}

async function writeRetryCache(
  repoRoot: string,
  claim: ExtractedClaim,
  section: SectionInput,
  recipeFingerprint: string,
  evidence: GuardBirthFinding,
  scenarios: RawGeneratedScenario[],
  blockedOn: string[],
): Promise<void> {
  const entry: AuthoredCacheEntry = { scenarios, ...(blockedOn.length > 0 ? { blockedOn } : {}) }
  await setCacheEntry(repoRoot, GENERATE_CACHE_NAME, retryCacheKey(claim, section, recipeFingerprint, evidence), entry)
}

/**
 * Re-author ONE family member (item 4) fresh, carrying the family's SHARED correction +
 * exemplar mismatches so the model fixes the recurring pattern. Cached per claim + the
 * shared correction, so a stopped/re-run generate never re-pays the family round while
 * the same correction stands. On a cache hit the runner is not called.
 */
async function authorFamily(
  repoRoot: string,
  gd: GuardDoc,
  task: AuthTask,
  recipe: Recipe,
  recipeFingerprint: string,
  runner: GenerateRunner,
  familyCorrection: { correction: string; exemplars: string[] },
  errors: GuardGenerateError[],
  ground: (claimTexts: string[]) => Promise<ProbeTranscript[]>,
  onAuthorFailure?: (f: AuthorFailure) => void,
): Promise<RawGeneratedScenario[]> {
  const section = task.section
  const cached = await readFamilyCache(repoRoot, task.claim, section, recipeFingerprint, familyCorrection)
  if (cached) return cached.scenarios

  // Same transcripts as round 1 (cached by argv) — derived from this claim only.
  const probes = await ground([task.claim.claim])
  const claim: AuthorClaim = {
    ref: task.ref,
    claim: task.claim.claim,
    section,
    ...exampleOf(task.claim),
    ...invariantOf(task),
    ...supportOf(task),
    familyCorrection,
  }
  const attempt = await callAuthorWithReask(
    buildAuthorCtxFor(gd, [claim], recipe, probes),
    runner,
    authorFailureEmitter([task], onAuthorFailure),
  )
  if ('error' in attempt) {
    errors.push({ doc: section.doc, anchor: section.anchor, message: `family authoring ${attempt.error}` })
    return []
  }
  const authored = new Map(attempt.authored.map((a) => [a.ref, a])).get(task.ref)
  const scenarios = authored?.scenarios ?? []
  const blocked = scenarios.length === 0 ? normalizeBlockedOn(authored?.blockedOn ?? []) : []
  await writeFamilyCache(repoRoot, task.claim, section, recipeFingerprint, familyCorrection, scenarios, blocked)
  return scenarios
}

/** Per-family-re-author cache key: the round-1 key plus a hash of the shared correction
 *  + exemplars that drove it, so a changed correction re-authors fresh and an unchanged
 *  one is a cache hit. */
function familyCacheKey(
  claim: ExtractedClaim,
  section: SectionInput,
  recipeFingerprint: string,
  familyCorrection: { correction: string; exemplars: string[] },
): string {
  const correctionHash = createHash('sha256')
    .update([familyCorrection.correction, ...familyCorrection.exemplars].join('|'))
    .digest('hex')
  return createHash('sha256')
    .update(
      [
        GENERATE_PROMPT_FINGERPRINT,
        recipeFingerprint,
        String(GUARD_FORMAT_VERSION),
        section.fingerprint,
        claim.claim.replace(/\s+/g, ' ').trim(),
        'family',
        correctionHash,
      ].join('::'),
    )
    .digest('hex')
}

async function readFamilyCache(
  repoRoot: string,
  claim: ExtractedClaim,
  section: SectionInput,
  recipeFingerprint: string,
  familyCorrection: { correction: string; exemplars: string[] },
): Promise<AuthoredCacheEntry | null> {
  const cached = await getCacheEntry(repoRoot, GENERATE_CACHE_NAME, familyCacheKey(claim, section, recipeFingerprint, familyCorrection))
  if (!cached) return null
  const parsed = AuthoredCacheSchema.safeParse(cached)
  return parsed.success ? parsed.data : null
}

async function writeFamilyCache(
  repoRoot: string,
  claim: ExtractedClaim,
  section: SectionInput,
  recipeFingerprint: string,
  familyCorrection: { correction: string; exemplars: string[] },
  scenarios: RawGeneratedScenario[],
  blockedOn: string[],
): Promise<void> {
  const entry: AuthoredCacheEntry = { scenarios, ...(blockedOn.length > 0 ? { blockedOn } : {}) }
  await setCacheEntry(repoRoot, GENERATE_CACHE_NAME, familyCacheKey(claim, section, recipeFingerprint, familyCorrection), entry)
}
