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
import type { LlmTransport } from '@truecourse/shared/llm'
import {
  writeManifest,
  readManifest,
  readGuardDecisions,
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
  GUARD_FORMAT_VERSION,
  composeBlockedOnReason,
  dismissedClaimKey,
  isRunnableDriver,
  type GuardBirthFinding,
  type OutputExcerpts,
  type GuardCoverageGap,
  type GuardDismissedClaim,
  type GuardEntryPreflight,
  type GuardHeldSection,
  type GuardManifestSection,
  type GuardOrphanedDismissal,
  type GuardScenario,
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
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
  type FidelityRunner,
  type TriageRunner,
} from './runners.js'
import { runTriage } from './triage.js'
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
  status: 'no-docs' | 'recipe-failed' | 'ok'
  /** For `no-docs` / `recipe-failed`: the user-facing reason. */
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
  orphaned: { doc: string; anchor: string; scenarioIds: string[] }[]
  /**
   * Birth passes that SURVIVED to a reported bucket — written, held-ready, or a
   * fidelity finding. Counted once per surviving candidate: a round-1 pass discarded
   * when a sibling forced a whole-claim retry does not count (only the retry's own
   * passes do), and a birth pass whose fidelity review could not complete does not
   * count (its section re-attempts). So the run reconciles exactly —
   * `birthPassed === written.length + Σ heldSections.readyScenarios + fidelity findings`
   * — while still diverging above `written.length` when a passing scenario's section
   * is left unsettled (a sibling birth finding / authoring error).
   */
  birthPassed: number
  /**
   * Unsettled sections whose birth-passed candidates were withheld by the
   * all-or-nothing persist — the ready-but-held scenarios (with their authored YAML
   * inline). Empty when every changed section either settled or had nothing pass at
   * birth. The blockers live in `birthFindings`/`errors` (same doc+anchor).
   */
  heldSections: GuardHeldSection[]
  /**
   * Dismissals in `scenarios/decisions.json` whose claim text matched nothing in a
   * doc this run re-extracted — stale entries surfaced (never silently honored).
   * Empty when every dismissal matched a live claim (or its doc wasn't re-read).
   */
  orphanedDismissals: GuardOrphanedDismissal[]
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
  // --- test seams (production injects none) ---
  extractRunner?: ExtractRunner
  generateRunner?: GenerateRunner
  recipeRunner?: RecipeRunner
  fidelityRunner?: FidelityRunner
  triageRunner?: TriageRunner
  /** Forwarded to birth validation — the no-op step threshold (a test seam). */
  noOpThresholdMs?: number
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

  if (!hasGuardUniverse(repoRoot)) {
    return emptyResult('no-docs', {
      reason: 'No corpus found. Run `truecourse spec scan` to curate the spec docs first.',
    })
  }

  // 1. Recipe — the shared entrypoint every scenario runs against.
  const recipeRunner =
    options.recipeRunner ??
    spawnRecipeRunner({ transport: options.transport, model: options.models?.recipe, fallbackModel: options.models?.fallback })
  const recipeResult = await discoverRecipe(repoRoot, recipeRunner)
  if (recipeResult.status === 'verify-failed') {
    return emptyResult('recipe-failed', { reason: recipeResult.reason })
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
      orphaned,
      birthPassed: 0,
      heldSections: [],
      orphanedDismissals: [],
    }
  }

  const limit = pLimit(Math.max(1, options.concurrency ?? defaultConcurrency()))
  const batchSize = Math.max(1, options.batchSize ?? defaultGenerateBatch())
  const extractRunner =
    options.extractRunner ??
    spawnExtractRunner({ transport: options.transport, model: options.models?.extract, fallbackModel: options.models?.fallback })
  const generateRunner =
    options.generateRunner ??
    spawnGenerateRunner({
      transport: options.transport,
      model: options.models?.generate,
      retryModel: options.models?.retry,
      fallbackModel: options.models?.fallback,
    })
  // The fidelity reviewer and triage judge spawn exactly like the extract/generate
  // runners: unconditionally, with the spawn falling back to the claude CLI transport
  // when no explicit transport is handed in. The OSS CLI passes NO transport (only EE
  // installs a process default), so gating either on `options.transport` silently
  // disables the stage in every OSS run — fidelity audits skipped, findings shipped
  // without a verdict. Tests inject stub runners, never transports.
  const fidelityRunner: FidelityRunner =
    options.fidelityRunner ??
    spawnFidelityRunner({
      transport: options.transport,
      model: options.models?.fidelity,
      fallbackModel: options.models?.fallback,
    })
  const triageRunner: TriageRunner =
    options.triageRunner ??
    spawnTriageRunner({
      transport: options.transport,
      model: options.models?.triage,
      fallbackModel: options.models?.fallback,
    })

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
      for (const c of cli) authTasks.push({ ref: `c${refSeq++}`, section: s, claim: c })
    }
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
  const settledKeys = new Set<string>()
  const writeWorkingManifest = (): void => {
    const sections = [...workingManifest.values()].sort(
      (a, b) => a.doc.localeCompare(b.doc) || a.anchor.localeCompare(b.anchor),
    )
    writeManifest(repoRoot, { guard: GUARD_FORMAT_VERSION, sections })
  }
  const upsertSection = (section: SectionInput, scenarioIds: string[]): void => {
    const k = key(section)
    const classification = classificationByKey.get(k)
    workingManifest.set(k, {
      doc: section.doc,
      anchor: section.anchor,
      fingerprint: section.fingerprint,
      scenarioIds: scenarioIds.slice().sort(),
      generationInputsHash: generationInputsHash(section.fingerprint, recipeFingerprint, section.suppressionFingerprint),
      ...(classification ? { classification } : {}),
    })
    settledKeys.add(k)
    writeWorkingManifest()
    options.onSectionSettled?.(settledKeys.size, plan.work.length)
  }

  // Result accumulators + progress counters — appended/bumped as sections settle.
  const written: GeneratedScenarioInfo[] = []
  const birthFindings: GuardBirthFinding[] = []
  // Sections left unsettled (a sibling finding/error) whose candidates ALL passed
  // birth — recorded so the report/UI can surface the withheld validated work.
  const heldSections: GuardHeldSection[] = []
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
  // Fidelity-review progress accumulates across sections: `planned` grows as each
  // section's green candidates reach review; `reviewed` ticks per completed review.
  let fidelityPlanned = 0
  let fidelityReviewed = 0

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
    if (sectionAuthError.has(k)) return // unsettled — errors already recorded
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
    let persistedHere: BirthCandidate[] = []

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
        const built = safeBuild(section, rawS, usedIds, localErrors, t.claim.claim)
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
        birthTotal += round1.length
        const birth1 = await birthValidate(repoRoot, round1, {
          executor,
          recipe,
          skipBuild: true,
          noOpThresholdMs: options.noOpThresholdMs,
          onPhase: options.onBirthPhase,
          onScenarioSettled: bumpBirth,
        })
        reconcileBirth()

        // No-op anomaly gate (item: birth anomaly detection). Fold THIS round's step
        // stats into the cumulative aggregate; once enough steps have run and almost
        // all did nothing, the recipe entry is a do-nothing binary. Abort NOW — before
        // this section's retries/fidelity — leaving it (and every later section)
        // unsettled; the run returns `recipe-failed` at the end.
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
            retryEntries.push({ task: taskByRef.get(ref)!, evidence: toFinding(retriable) })
            continue // whole claim is regenerated; round-1 candidates are discarded
          }
          for (const o of outcomes) {
            if (o.result.outcome === 'pass') persistedHere.push(o.candidate)
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
                    const built = safeBuild(section, rawS, usedIds, localErrors, entry.task.claim.claim)
                    if (built) retryCandidates.push({ section, scenario: built, ref: entry.task.ref, claim: entry.task.claim })
                  }
                } finally {
                  options.onRetryProgress?.(++retryDone, retryTotal)
                }
              }),
            ),
          )

          if (retryCandidates.length > 0) {
            birthTotal += retryCandidates.length
            const birth2 = await birthValidate(repoRoot, retryCandidates, {
              executor,
              recipe,
              skipBuild: true,
              noOpThresholdMs: options.noOpThresholdMs,
              onPhase: options.onBirthPhase,
              onScenarioSettled: bumpBirth,
            })
            const r2 = birth2.outcomes
            reconcileBirth()
            for (const o of r2) {
              if (o.result.outcome === 'pass') persistedHere.push(o.candidate)
              else if (o.result.outcome === 'fail') localFindings.push(toFinding(o))
              else localErrors.push(errorFrom(o))
            }
          }
        }
      }
    }

    // Fidelity review (item 33): every green candidate — a round-1 pass OR a retry
    // survivor — is audited BEFORE it may persist. A flagged candidate becomes a
    // fidelity FINDING (its section then unsettles like any birth finding, and the
    // faithful siblings drop to `heldSections` below); a review that can't complete
    // is a local error (re-attempted next run — faithful reviews are cached). Only
    // faithful candidates stay in the persist set.
    if (persistedHere.length > 0) {
      fidelityPlanned += persistedHere.length
      options.onFidelityProgress?.(fidelityReviewed, fidelityPlanned)
      // The green candidates are reviewed independently — fan them through the
      // shared LLM pool (bounded by `TRUECOURSE_MAX_CONCURRENCY`) instead of one at
      // a time; verdicts are consumed in candidate order so findings stay stable.
      const reviews = await Promise.all(
        persistedHere.map((c) =>
          limit(async () => {
            const review = await reviewFidelity(repoRoot, c, fidelityRunner)
            options.onFidelityProgress?.(++fidelityReviewed, fidelityPlanned)
            return { c, review }
          }),
        ),
      )
      const faithful: BirthCandidate[] = []
      for (const { c, review } of reviews) {
        if ('error' in review) {
          // Passed birth but the fidelity review could not complete — the candidate is
          // neither persisted, held, nor a finding this run (its section re-attempts),
          // so it is NOT a reconciled birth pass.
          localErrors.push({ doc: section.doc, anchor: section.anchor, message: `fidelity review ${review.error}` })
          continue
        }
        // A candidate that cleared birth AND reached a reported bucket — written, held,
        // or a fidelity finding — is one birth pass. A round-1 pass discarded when a
        // sibling forced a whole-claim retry never reaches here, so it never inflates
        // the count: birthPassed === written + heldReady + fidelityFlagged for the run.
        birthPassed++
        if (review.verdict === 'flagged') localFindings.push(fidelityFinding(c, review.mismatch))
        else faithful.push(c)
      }
      persistedHere = faithful
    }

    errors.push(...localErrors)
    birthFindings.push(...localFindings)

    // Settled ⇒ persist now: replace this section's OWN prior files with the green
    // survivors and upsert its manifest entry. A partial persist would leave a
    // scenario with no manifest ownership, so an unsettled section persists nothing.
    if (localErrors.length === 0 && localFindings.length === 0) {
      deleteScenarioFiles(repoRoot, priorIdsOf(k))
      const slug = areaOrDocSlug(section)
      const ids: string[] = []
      for (const c of persistedHere) {
        const file = writeScenarioFile(repoRoot, slug, c.scenario)
        written.push({ id: c.scenario.id, title: c.scenario.title, doc: section.doc, anchor: section.anchor, file })
        ids.push(c.scenario.id)
      }
      upsertSection(section, ids)
    } else if (persistedHere.length > 0) {
      // Unsettled (a sibling finding/error), but these candidates passed at birth in
      // one of the rounds — record them as ready-but-held so the validated work is
      // visible. Their YAML rides inline (they were never written to disk).
      heldSections.push({
        doc: section.doc,
        anchor: section.anchor,
        readyScenarios: persistedHere.map((c) => ({
          id: c.scenario.id,
          title: c.scenario.title,
          yaml: serializeScenarioYaml(c.scenario),
        })),
      })
    }
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
    const cached = await readAuthorCache(repoRoot, t.claim, t.section, recipeFingerprint)
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
            buildAuthorCtx(gd, batch, recipe, probes),
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

  // Triage — one Opus judgment call per birth/fidelity finding, AFTER they all
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

  // 6. Run end — every work section still unsettled (extraction failure, authoring
  // error, birth finding, birth error) drops its prior files + manifest entry so the
  // next run re-attempts it. Final whole-manifest write.
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
    orphaned,
    birthPassed,
    heldSections,
    orphanedDismissals,
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
}

const key = (s: { doc: string; anchor: string }): string => `${s.doc}\0${s.anchor}`

function oneLine(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 120 ? `${t.slice(0, 120)}…` : t
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
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
    heldSections: [],
    orphanedDismissals: [],
  }
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
    `was aborted before writing any scenarios or spending retry/fidelity calls. Fix the recipe entry (it likely ` +
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

/** Author context for a batch of AuthTasks (round 1). */
function buildAuthorCtx(gd: GuardDoc, batch: AuthTask[], recipe: Recipe, probes: ProbeTranscript[]): AuthorUserContext {
  const claims: AuthorClaim[] = batch.map((t) => ({ ref: t.ref, claim: t.claim.claim, section: t.section, ...exampleOf(t.claim) }))
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
 *  `claim` is the extracted claim text persisted onto the committed scenario. */
function safeBuild(
  section: SectionInput,
  raw: RawGeneratedScenario,
  usedIds: Set<string>,
  errors: GuardGenerateError[],
  claim: string,
): GuardScenario | null {
  const id = assignScenarioId(section.anchor, usedIds)
  try {
    return buildScenario(section, raw, id, claim)
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

/** The reviewer's decision on one green candidate: persist, flag as a finding, or
 *  (a review that couldn't complete) surface as an error that unsettles the section. */
type FidelityResult =
  | { verdict: 'faithful' }
  | { verdict: 'flagged'; mismatch: string }
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

/** A flagged verdict always yields a non-empty mismatch (the finding's evidence). */
function normalizeFidelity(r: { verdict: 'faithful' | 'flagged'; mismatch?: string }): FidelityResult {
  if (r.verdict === 'flagged') {
    return { verdict: 'flagged', mismatch: r.mismatch?.trim() || 'the scenario does not verify what the claim asserts' }
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
