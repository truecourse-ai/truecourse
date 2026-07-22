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
 *   4. author   the runnable-driver claims (cli, api) from changed sections, in
 *               per-driver batches carrying the whole-document context (cached
 *               per claim) → scenario arrays.
 *   5. birth    run every candidate once; retry a failing CLAIM ONCE with its
 *               evidence; still-failing candidates are birth findings, never kept.
 *   6. manifest rewrite the binding record with the settled outcomes.
 *
 * Unchanged sections are skipped entirely; awaiting-driver (web/tui/library),
 * untestable, no-claim, and prep-missing (a runnable claim whose driver has no
 * recipe preparation) sections land in the result + manifest as visible coverage gaps.
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
  defaultGuardExecutor,
  type GuardExecutor,
  type Recipe,
  type BuildResult,
  type EntryPreflightResult,
} from '@truecourse/guard-runner'
import {
  GUARD_FORMAT_VERSION,
  composeBlockedOnReason,
  dismissedClaimKey,
  isRunnableDriver,
  runnableDriverIds,
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
  GENERATE_API_PROMPT_FINGERPRINT,
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
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
  type FidelityRunner,
} from './runners.js'
import { extractDocClaims, countExtractViews, type DocClaims } from './extract.js'
import { groundProbes, type ProbeTranscript } from './ground.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
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
  /** `entry` is the cli preparation (absent on an api-only recipe); `serve` the api one. */
  recipe?: { status: 'exists' | 'discovered'; entry?: string[]; serve?: string[]; wrotePath?: string }
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
   * Birth outcomes that passed across BOTH validation rounds — counted regardless
   * of whether the scenario's section ultimately settled, so it diverges above
   * `written.length` when a passing scenario's section is left unsettled (a sibling
   * birth finding / authoring error). The honest "N passed" for the closing detail.
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

export interface GuardGenerateModels {
  extract?: string
  generate?: string
  /** Evidence-retry re-authoring (stage `guard.retry`); defaults to `generate`. */
  retry?: string
  /** Fidelity review (stage `guard.fidelity`) — a cheap-tier adversarial pass. */
  fidelity?: string
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
  // --- progress hooks ---
  onPlan?: (total: number, work: number) => void
  onExtractProgress?: (done: number, total: number) => void
  /** Per-VIEW extraction progress (a chunked doc is many view calls) — the live
   *  counter. Fires `(0, total)` as soon as the view plan is known (views are
   *  planned per doc upfront), then once per completed view. */
  onExtractViewProgress?: (done: number, total: number) => void
  onAuthorProgress?: (done: number, total: number) => void
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

export function defaultGenerateBatch(): number {
  const env = process.env.TRUECOURSE_GENERATE_BATCH
  if (env) {
    const n = parseInt(env, 10)
    if (Number.isFinite(n) && n >= 1) return n
  }
  // Scenario authoring is output-heavy (full YAML bodies per claim) — larger
  // batches blow the per-call output budget and time out; 4 stays well inside it.
  return 4
}

/** The authoring system-prompt fingerprint for a claim's driver — each driver has
 *  its own prompt, so a claim's cache entry moves only when ITS prompt changes. */
function authorPromptFingerprint(driver: ExtractedClaim['driver']): string {
  return driver === 'api' ? GENERATE_API_PROMPT_FINGERPRINT : GENERATE_PROMPT_FINGERPRINT
}

/** Per-claim authoring cache key: it moves when the claim, its section, the
 *  recipe, the format, or the claim's driver-specific authoring prompt changes. */
function authorCacheKey(claim: ExtractedClaim, section: SectionInput, recipeFingerprint: string): string {
  return createHash('sha256')
    .update(
      [
        authorPromptFingerprint(claim.driver),
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
    ...(recipe.entry ? { entry: recipe.entry } : {}),
    ...(recipe.api ? { serve: recipe.api.serve } : {}),
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
  // The fidelity reviewer (item 33) audits each green scenario before it persists.
  // It needs an LLM: production (`guardGenerateInProcess`) always supplies a
  // transport, so the review always runs there. A caller supplying NEITHER a
  // transport NOR a `fidelityRunner` (only the pre-feature unit tests) has no model
  // access, so the audit is skipped and green scenarios persist unreviewed.
  const fidelityRunner: FidelityRunner | undefined =
    options.fidelityRunner ??
    (options.transport
      ? spawnFidelityRunner({
          transport: options.transport,
          model: options.models?.fidelity,
          fallbackModel: options.models?.fallback,
        })
      : undefined)

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
      const runnableAll = claims.filter((c) => isRunnableDriver(c.driver))
      const others = claims.filter((c) => !isRunnableDriver(c.driver))
      const note = noteByAnchor.get(s.anchor)

      // A dismissed claim is not authored, not birthed, never a finding: record
      // it as an explicit `dismissed` gap and drop it from the authoring set. Its
      // section can then settle on its remaining (live) claims alone.
      const live = runnableAll.filter((c) => !dismissalByKey.has(dismissedClaimKey(s.doc, s.anchor, c.claim)))
      const dismissed = runnableAll.filter((c) => dismissalByKey.has(dismissedClaimKey(s.doc, s.anchor, c.claim)))
      for (const d of dismissed) {
        const entry = dismissalByKey.get(dismissedClaimKey(s.doc, s.anchor, d.claim))
        coverageGaps.push({ doc: s.doc, anchor: s.anchor, kind: 'dismissed', reason: dismissedReason(d.claim, entry?.note) })
      }

      // A runnable claim whose driver has no recipe preparation (a cli claim with
      // no `entry`, an api claim with no `api` block) is an honest blocked-on gap —
      // never authored to die at birth, never silently dropped.
      const prepared = live.filter((c) => driverPrepared(recipe, c.driver))
      const unprepared = live.filter((c) => !driverPrepared(recipe, c.driver))
      for (const u of unprepared) {
        coverageGaps.push({
          doc: s.doc,
          anchor: s.anchor,
          kind: 'blocked-on',
          reason: composeBlockedOnReason([missingPrepNoun(u.driver)], oneLine(u.claim)),
        })
      }

      // Every non-runnable-driver claim is a recorded coverage gap (its driver isn't
      // authored yet) — one un-conflated `awaiting-driver` kind carrying the driver.
      for (const o of others) {
        coverageGaps.push({ doc: s.doc, anchor: s.anchor, kind: 'awaiting-driver', driver: o.driver, reason: o.reason })
      }
      if (live.length === 0 && others.length === 0) {
        // A section whose only runnable claims were all dismissed settles on those
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
            reason: note?.reason ?? 'the section states no claim a runnable driver can assert',
          })
        }
      }
      classificationByKey.set(key(s), deriveClassification(live, others, note))
      for (const c of prepared) authTasks.push({ ref: `c${refSeq++}`, section: s, claim: c })
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
    // Probes are a cli-driver affair (they invoke the entry) — an api-only recipe
    // has nothing to probe; api batches never call this.
    if (!recipe.entry) return []
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
      // No entry ⇒ nothing to preflight (an api-only recipe); the api server gets
      // its own loud preflight inside the runner, per birth round.
      if (!recipe.entry) return null
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
        const built = safeBuild(section, rawS, usedIds, localErrors)
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
      } else if (round1.some((c) => c.scenario.driver === 'cli') && (await deadEntry())) {
        // The built entry can't start — birthing anything against it would produce N
        // indistinguishable failures. Leave THIS section unsettled (run-end cleanup
        // drops it for a re-attempt) and return; the ONE loud error was recorded once.
        // (Api-only sections skip this — the api server has its own preflight inside
        // the runner, which surfaces through birth as an entry-preflight failure.)
        return
      } else {
        birthTotal += round1.length
        const r1 = await birthValidate(repoRoot, round1, { executor, recipe, skipBuild: true, onPhase: options.onBirthPhase, onScenarioSettled: bumpBirth })
        reconcileBirth()
        birthPassed += r1.filter((o) => o.result.outcome === 'pass').length
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
                  const retryScs = await authorRetry(repoRoot, gd, entry, section, recipe, recipeFingerprint, generateRunner, localErrors, groundClaims)
                  for (const rawS of retryScs) {
                    const built = safeBuild(section, rawS, usedIds, localErrors)
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
            const r2 = await birthValidate(repoRoot, retryCandidates, { executor, recipe, skipBuild: true, onPhase: options.onBirthPhase, onScenarioSettled: bumpBirth })
            reconcileBirth()
            birthPassed += r2.filter((o) => o.result.outcome === 'pass').length
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
    // faithful candidates stay in the persist set. Skipped when no reviewer is
    // configured (a caller with no transport + no `fidelityRunner`).
    if (fidelityRunner && persistedHere.length > 0) {
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
          localErrors.push({ doc: section.doc, anchor: section.anchor, message: `fidelity review ${review.error}` })
        } else if (review.verdict === 'flagged') {
          localFindings.push(fidelityFinding(c, review.mismatch))
        } else {
          faithful.push(c)
        }
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

  // Batches never mix drivers — each driver has its own system prompt + schema.
  const missByDocDriver = new Map<string, AuthTask[]>()
  for (const t of missTasks) pushInto(missByDocDriver, `${t.section.doc}\0${t.claim.driver}`, t)

  const authoring = Promise.all(
    [...missByDocDriver].flatMap(([docDriver, tasks]) => {
      const docPath = docDriver.slice(0, docDriver.indexOf('\0'))
      const gd = workDocByPath.get(docPath)!
      return chunk(tasks, batchSize).map((batch) =>
        limit(async () => {
          // Probes ground CLI commands against the built entry — api batches are
          // authored ungrounded (birth evidence supplies the real responses).
          const probes =
            batch[0].claim.driver === 'cli' ? await groundClaims(batch.map((t) => t.claim.claim)) : []
          const attempt = await callAuthorWithReask(buildAuthorCtx(gd, batch, recipe, probes), generateRunner)
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
 * The per-section manifest classification summary, derived from extraction: the
 * first runnable driver (registry order) with a claim, else the first other
 * driver, else untestable.
 */
function deriveClassification(
  runnable: ExtractedClaim[],
  others: ExtractedClaim[],
  note: UntestableNote | undefined,
): TestabilityVerdict {
  for (const id of runnableDriverIds) {
    const mine = runnable.filter((c) => c.driver === id)
    if (mine.length === 0) continue
    return {
      driver: id,
      reason:
        mine.length === 1
          ? mine[0].reason
          : `${mine.length} ${id.toUpperCase()} claims; e.g. ${oneLine(mine[0].reason)}`,
    }
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

/** Author context for a batch of AuthTasks (round 1). A batch is single-driver. */
function buildAuthorCtx(gd: GuardDoc, batch: AuthTask[], recipe: Recipe, probes: ProbeTranscript[]): AuthorUserContext {
  const claims: AuthorClaim[] = batch.map((t) => ({ ref: t.ref, claim: t.claim.claim, section: t.section }))
  return buildAuthorCtxFor(gd, claims, authorDriver(batch[0].claim), recipe, probes)
}

/** The driver a claim's authoring batch runs under (only runnable drivers author). */
function authorDriver(claim: ExtractedClaim): 'cli' | 'api' {
  return claim.driver === 'api' ? 'api' : 'cli'
}

/** Author context for explicit AuthorClaims (round 2 carries retry evidence). */
function buildAuthorCtxFor(
  gd: GuardDoc,
  claims: AuthorClaim[],
  driver: 'cli' | 'api',
  recipe: Recipe,
  probes: ProbeTranscript[],
): AuthorUserContext {
  return {
    doc: gd.doc,
    docContext: buildAuthorDocContext(gd, claims.map((c) => c.section.anchor)),
    areaTags: gd.sections[0]?.areaTags ?? [],
    driver,
    ...(driver === 'api'
      ? {
          recipeServe: recipe.api?.serve,
          recipeHealthPath: recipe.api?.healthPath,
          credentials: recipeCredentialCapabilities(recipe),
          fixtures: recipeFixtureCatalog(recipe),
        }
      : { recipeEntry: recipe.entry }),
    recipeBuild: recipe.build,
    claims,
    probes,
  }
}

/**
 * The recipe's credentials as authoring capabilities — name + header + optional role
 * description (never the secret value), sorted for a stable prompt. Both the directly
 * `api.credentials` and the seed-provided `api.seed.provides.credentials` are advertised
 * together: to the author they are the same `{{cred:<name>}}` handle, differing only in
 * how the runner mints the value. Names are guaranteed distinct (the recipe schema
 * refuses a collision).
 */
function recipeCredentialCapabilities(recipe: Recipe): { name: string; header: string; description?: string }[] {
  const out: { name: string; header: string; description?: string }[] = []
  for (const [name, cred] of Object.entries(recipe.api?.credentials ?? {})) {
    out.push({ name, header: cred.header, ...(cred.description ? { description: cred.description } : {}) })
  }
  for (const [name, cred] of Object.entries(recipe.api?.seed?.provides.credentials ?? {})) {
    out.push({ name, header: cred.header, ...(cred.description ? { description: cred.description } : {}) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The seed stage's fixture catalog as an authoring capability — name + field names
 *  only (never runtime values), sorted for a stable prompt. Empty when no seed stage. */
function recipeFixtureCatalog(recipe: Recipe): { name: string; fields: string[] }[] {
  const declared = recipe.api?.seed?.provides.fixtures
  if (!declared) return []
  return Object.entries(declared)
    .map(([name, fields]) => ({ name, fields }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** True when the recipe carries a driver's preparation layer. */
function driverPrepared(recipe: Recipe, driver: ExtractedClaim['driver']): boolean {
  if (driver === 'cli') return recipe.entry !== undefined
  if (driver === 'api') return recipe.api !== undefined
  return false
}

/** The capability noun a prep-missing blocked-on gap names. */
function missingPrepNoun(driver: ExtractedClaim['driver']): string {
  return driver === 'api' ? 'a recipe `api` block' : 'a recipe `entry`'
}

type AuthorAttempt = { authored: AuthoredClaim[] } | { error: string }

/**
 * Call the author runner and validate its batch output; on a schema failure
 * re-ask ONCE with the invalid output quoted back, then validate again. A thrown
 * call is not re-asked. Returns `{ error }` on a still-invalid or thrown call.
 */
async function callAuthorWithReask(ctx: AuthorUserContext, runner: GenerateRunner): Promise<AuthorAttempt> {
  let raw: unknown
  try {
    raw = await runner(ctx)
  } catch (e) {
    return { error: `call failed: ${(e as Error).message}` }
  }
  const parsed = AuthoredBatchSchema.safeParse(raw)
  if (parsed.success) return { authored: parsed.data }

  let reRaw: unknown
  try {
    reRaw = await runner({ ...ctx, correction: { invalidOutput: quoteInvalidOutput(raw) } })
  } catch (e) {
    return { error: `re-ask failed: ${(e as Error).message}` }
  }
  const reParsed = AuthoredBatchSchema.safeParse(reRaw)
  if (reParsed.success) return { authored: reParsed.data }
  return { error: `output invalid after re-ask: ${flattenZodError(reParsed.error)}` }
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

/** Build a scenario, recording a validation failure as an error rather than throwing. */
function safeBuild(
  section: SectionInput,
  raw: RawGeneratedScenario,
  usedIds: Set<string>,
  errors: GuardGenerateError[],
): GuardScenario | null {
  const id = assignScenarioId(section.anchor, usedIds)
  try {
    return buildScenario(section, raw, id)
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
): Promise<RawGeneratedScenario[]> {
  const cached = await readRetryCache(repoRoot, entry.task.claim, section, recipeFingerprint, entry.evidence)
  if (cached) return cached.scenarios

  // Same transcripts as round 1 (cached by argv), cli claims only — api retries
  // carry the failing run's response body as their evidence instead.
  const probes = entry.task.claim.driver === 'cli' ? await ground([entry.task.claim.claim]) : []
  const claim: AuthorClaim = {
    ref: entry.task.ref,
    claim: entry.task.claim.claim,
    section,
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
    buildAuthorCtxFor(gd, [claim], authorDriver(entry.task.claim), recipe, probes),
    runner,
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
        authorPromptFingerprint(claim.driver),
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
