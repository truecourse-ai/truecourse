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
 * Unchanged sections are skipped entirely; api/web/tui/untestable and no-claim
 * sections land in the result + manifest as visible coverage gaps.
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
  manifestPath,
  runBuild,
  resolveEntry,
  preflightEntry,
  formatEntryPreflightError,
  type Recipe,
  type BuildResult,
  type EntryPreflightResult,
} from '@truecourse/guard-runner'
import {
  GUARD_FORMAT_VERSION,
  composeBlockedOnReason,
  isRunnableDriver,
  type GuardCoverageGap,
  type GuardEntryPreflight,
  type GuardManifestSection,
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
  buildAuthorDocContext,
  type AuthorClaim,
  type AuthorUserContext,
} from './prompts.js'
import {
  AuthoredBatchSchema,
  RawGeneratedScenarioSchema,
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
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
} from './runners.js'
import { extractDocClaims, countExtractViews, type DocClaims } from './extract.js'
import { deriveProbes, captureProbes, type ProbeTranscript } from './ground.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import { discoverRecipe } from './recipe-discovery.js'
import { birthValidate, type BirthCandidate } from './birth.js'
import {
  assignScenarioId,
  buildScenario,
  areaOrDocSlug,
  writeScenarioFile,
  deleteScenarioFiles,
  existingScenarioIds,
} from './serialize.js'

export const GENERATE_CACHE_NAME = 'guard/generate'

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
 * REAL existing drift. Surfaced for the user to resolve (fix code / edit spec);
 * never persisted, never an exit failure.
 */
export interface GuardBirthFinding {
  doc: string
  anchor: string
  /** The scenario title — the claim it was asserting. */
  title: string
  step: number
  expected: string
  actual: string
  /** Repo-relative pointer into `guard/evidence/`, when a transcript was written. */
  evidencePath?: string
}

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
   * Birth outcomes that passed across BOTH validation rounds — counted regardless
   * of whether the scenario's section ultimately settled, so it diverges above
   * `written.length` when a passing scenario's section is left unsettled (a sibling
   * birth finding / authoring error). The honest "N passed" for the closing detail.
   */
  birthPassed: number
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
  recipe?: string
  fallback?: string
}

export interface GenerateGuardsOptions {
  repoRoot: string
  transport?: LlmTransport
  models?: GuardGenerateModels
  concurrency?: number
  /** Claims per authoring call — `TRUECOURSE_GENERATE_BATCH` env, else 4. */
  batchSize?: number
  // --- test seams (production injects none) ---
  extractRunner?: ExtractRunner
  generateRunner?: GenerateRunner
  recipeRunner?: RecipeRunner
  // --- progress hooks ---
  onPlan?: (total: number, work: number) => void
  onExtractProgress?: (done: number, total: number) => void
  /** Per-VIEW extraction progress (a chunked doc is many view calls) — the live counter. */
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

  const coverageGaps: GuardCoverageGap[] = []
  const errors: GuardGenerateError[] = []
  const extractionFailures: GuardExtractionFailure[] = []

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
    const { claimsByAnchor, noteByAnchor } = groupExtraction(result.data)
    for (const s of doc.sections) {
      if (!workKeys.has(key(s))) continue
      const claims = claimsByAnchor.get(s.anchor) ?? []
      const cli = claims.filter((c) => isRunnableDriver(c.driver))
      const others = claims.filter((c) => !isRunnableDriver(c.driver))
      const note = noteByAnchor.get(s.anchor)

      // Every non-runnable-driver claim is a recorded coverage gap (its driver isn't
      // authored yet) — one un-conflated `awaiting-driver` kind carrying the driver.
      for (const o of others) {
        coverageGaps.push({ doc: s.doc, anchor: s.anchor, kind: 'awaiting-driver', driver: o.driver, reason: o.reason })
      }
      if (cli.length === 0 && others.length === 0) {
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
      classificationByKey.set(key(s), deriveClassification(cli, others, note))
      for (const c of cli) authTasks.push({ ref: `c${refSeq++}`, section: s, claim: c })
    }
  }

  // 4. Kick the recipe build ONCE, parallel with authoring — every birth round
  // reuses it (skipBuild). The build phase is announced the first time a section
  // reaches birth; a build failure turns that section's candidates into error
  // outcomes (mirroring the runner's build-failed mapping) so the section unsettles.
  const buildPromise = runBuild(repoRoot, recipe.build, recipe.env)
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
    const probes = deriveProbes(claimTexts, recipe.entry)
    const build = await buildPromise
    if (!build.ok || probes.length === 0) return []
    groundPlanned += probes.length
    options.onGroundProgress?.(groundCaptured, groundPlanned)
    resolvedEntryMemo ??= resolveEntry(repoRoot, recipe.entry)
    return captureProbes({
      repoRoot,
      probes,
      resolvedEntry: resolvedEntryMemo,
      displayEntry: recipe.entry,
      recipeFingerprint,
      recipeEnv: recipe.env,
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
      return preflightEntry({ resolvedEntry: resolvedEntryMemo, displayEntry: recipe.entry, recipeEnv: recipe.env })
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
      generationInputsHash: generationInputsHash(section.fingerprint, recipeFingerprint),
      ...(classification ? { classification } : {}),
    })
    settledKeys.add(k)
    writeWorkingManifest()
    options.onSectionSettled?.(settledKeys.size, plan.work.length)
  }

  // Result accumulators + progress counters — appended/bumped as sections settle.
  const written: GeneratedScenarioInfo[] = []
  const birthFindings: GuardBirthFinding[] = []
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
    const persistedHere: BirthCandidate[] = []

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
      } else if (await deadEntry()) {
        // The built entry can't start — birthing anything against it would produce N
        // indistinguishable failures. Leave THIS section unsettled (run-end cleanup
        // drops it for a re-attempt) and return; the ONE loud error was recorded once.
        return
      } else {
        birthTotal += round1.length
        const r1 = await birthValidate(repoRoot, round1, { skipBuild: true, onPhase: options.onBirthPhase, onScenarioSettled: bumpBirth })
        reconcileBirth()
        birthPassed += r1.filter((o) => o.result.outcome === 'pass').length
        const r1ByRef = new Map<string, typeof r1>()
        for (const o of r1) pushInto(r1ByRef, o.candidate.ref, o)

        const retryEntries: { task: AuthTask; evidence: GuardBirthFinding }[] = []
        for (const [ref, outcomes] of r1ByRef) {
          const fail = outcomes.find((o) => o.result.outcome === 'fail')
          if (fail) {
            retryEntries.push({ task: taskByRef.get(ref)!, evidence: toFinding(fail) })
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
            const r2 = await birthValidate(repoRoot, retryCandidates, { skipBuild: true, onPhase: options.onBirthPhase, onScenarioSettled: bumpBirth })
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

/** Author context for a batch of AuthTasks (round 1). */
function buildAuthorCtx(gd: GuardDoc, batch: AuthTask[], recipe: Recipe, probes: ProbeTranscript[]): AuthorUserContext {
  const claims: AuthorClaim[] = batch.map((t) => ({ ref: t.ref, claim: t.claim.claim, section: t.section }))
  return buildAuthorCtxFor(gd, claims, recipe, probes)
}

/** Author context for explicit AuthorClaims (round 2 carries retry evidence). */
function buildAuthorCtxFor(gd: GuardDoc, claims: AuthorClaim[], recipe: Recipe, probes: ProbeTranscript[]): AuthorUserContext {
  return {
    doc: gd.doc,
    docContext: buildAuthorDocContext(gd, claims.map((c) => c.section.anchor)),
    areaTags: gd.sections[0]?.areaTags ?? [],
    recipeEntry: recipe.entry,
    recipeBuild: recipe.build,
    claims,
    probes,
  }
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

function toFinding(o: { candidate: BirthCandidate; result: { failure?: { step: number; expected: string; actual: string }; evidencePath?: string } }): GuardBirthFinding {
  const f = o.result.failure
  return {
    doc: o.candidate.section.doc,
    anchor: o.candidate.section.anchor,
    title: o.candidate.scenario.title,
    step: f?.step ?? 1,
    expected: f?.expected ?? '',
    actual: f?.actual ?? '',
    ...(o.result.evidencePath ? { evidencePath: o.result.evidencePath } : {}),
  }
}

function errorFrom(o: { candidate: BirthCandidate; result: { failure?: { actual: string } } }): GuardGenerateError {
  return {
    doc: o.candidate.section.doc,
    anchor: o.candidate.section.anchor,
    message: `birth validation error for "${o.candidate.scenario.title}": ${o.result.failure?.actual ?? 'unknown'}`,
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

  // Same transcripts as round 1 (cached by argv) — derived from this claim only.
  const probes = await ground([entry.task.claim.claim])
  const claim: AuthorClaim = {
    ref: entry.task.ref,
    claim: entry.task.claim.claim,
    section,
    retry: {
      scenarioTitle: entry.evidence.title,
      step: entry.evidence.step,
      expected: entry.evidence.expected,
      actual: entry.evidence.actual,
    },
  }
  const attempt = await callAuthorWithReask(buildAuthorCtxFor(gd, [claim], recipe, probes), runner)
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

/** Per-retry cache key: the round-1 key plus the birth evidence that drove the re-ask. */
function retryCacheKey(
  claim: ExtractedClaim,
  section: SectionInput,
  recipeFingerprint: string,
  evidence: GuardBirthFinding,
): string {
  const evidenceHash = createHash('sha256')
    .update([evidence.title, String(evidence.step), evidence.expected, evidence.actual].join('|'))
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
