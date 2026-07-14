/**
 * Read-surface drivers for the guard dashboard — the guard analogue of the verify
 * read routes. All route logic lives here so the Express adapter stays thin (the
 * CLAUDE.md route→driver→store rule): the per-section coverage join, the mtime
 * staleness probe, and the traversal-safe run / scenario-source / evidence reads.
 *
 * Pure composition (`composeDocCoverage`) takes already-parsed inputs so it is
 * unit-testable without I/O; the readers below wrap the guard store. The guard
 * store readers are re-exported so the dashboard depends only on `@truecourse/core`.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  buildDocSectionIndex,
  guardDir,
  evidenceRunDir,
  evidenceScenarioDir,
  guardLatestPath,
  guardResultPath,
  guardRunPath,
  loadRecipe,
  loadScenarios,
  manifestPath,
  readGuardLatest as readGuardLatestStore,
  readGuardResult as readGuardResultStore,
  readManifest as readManifestStore,
  recipePath,
  scenariosDir,
  type DocSection,
  type LoadedRecipe,
} from '@truecourse/guard-runner'
import { corpusFilePath } from '@truecourse/spec-consolidator'
import {
  GuardLatestSchema,
  GuardOutcomeSchema,
  GuardCoverageGapKindSchema,
  awaitingDriverIds,
  isAwaitingDriver,
  parseBlockedOnCapabilities,
  worstOutcome,
  type GuardCoverageGap,
  type GuardCoverageGapKind,
  type GuardDocCoverage,
  type GuardLatest,
  type GuardManifest,
  type GuardManifestSection,
  type GuardOrphanedCoverage,
  type GuardGenerateReport,
  type GuardRecipeCard,
  type GuardScenarioInventory,
  type GuardScenarioListItem,
  type GuardScenarioResult,
  type GuardScenarioSource,
  type GuardSectionCoverage,
  type GuardSectionCoverageStatus,
  type GuardSectionScenario,
  type GuardStaleness,
} from '@truecourse/shared'

// The dashboard reads the whole guard surface through core (never guard-runner
// directly), mirroring how verify routes read through spec-in-process.
export { readGuardLatest, readGuardHistory, readGuardResult, readManifest } from '@truecourse/guard-runner'
// The committable guard decisions file (dismissed claims) — read + mutated through
// core so the dashboard depends only on `@truecourse/core`.
export {
  readGuardDecisions,
  writeGuardDecisions,
  dismissGuardClaim,
  undismissGuardClaim,
} from '@truecourse/guard-runner'

// ---------------------------------------------------------------------------
// Per-section coverage join (pure).
// ---------------------------------------------------------------------------

/** The parsed store inputs the coverage join reads (all nullable — absent stores). */
export interface GuardCoverageSources {
  manifest: GuardManifest | null
  latest: GuardLatest | null
  result: GuardGenerateReport | null
}

/**
 * Join a live spec doc's sections to their guard coverage. For each section
 * (in document order) the status is resolved by precedence: a run outcome wins,
 * then a guarded-but-not-run marker, then a coverage gap, then a bare
 * classification, else `unguarded`. Scenarios whose bound section was removed from
 * the doc surface in `orphanedSections`. Pure: `content` is the live doc text.
 */
export function composeDocCoverage(
  doc: string,
  content: string,
  sources: GuardCoverageSources,
): GuardDocCoverage {
  const { manifest, latest, result } = sources
  const index = buildDocSectionIndex(doc, content)
  const liveAnchors = new Set(index.sections.map((s) => s.anchor))

  // Run results for this doc, grouped by their effective LIVE anchor (a moved
  // section carries `remappedTo`); results whose section is gone are orphaned.
  const runByAnchor = new Map<string, GuardScenarioResult[]>()
  const orphanRun = new Map<string, GuardScenarioResult[]>()
  for (const s of latest?.scenarios ?? []) {
    if (s.binds.doc !== doc) continue
    const effective = s.remappedTo ?? s.binds.section
    push(liveAnchors.has(effective) ? runByAnchor : orphanRun, effective, s)
  }

  const manifestByAnchor = new Map<string, GuardManifestSection>()
  for (const m of manifest?.sections ?? []) {
    if (m.doc === doc) manifestByAnchor.set(m.anchor, m)
  }

  const gapByAnchor = new Map<string, GuardCoverageGap>()
  for (const g of result?.coverageGaps ?? []) {
    if (g.doc === doc) gapByAnchor.set(g.anchor, g)
  }

  const totals = emptyTotals()
  const sections = index.sections.map((sec) => {
    const cov = resolveSectionCoverage(sec, {
      run: runByAnchor.get(sec.anchor) ?? [],
      manifest: manifestByAnchor.get(sec.anchor),
      gap: gapByAnchor.get(sec.anchor),
    })
    totals[cov.status]++
    return cov
  })

  return {
    doc,
    markdown: index.markdown,
    sections,
    orphanedSections: buildOrphanedCoverage(orphanRun, manifestByAnchor, liveAnchors),
    totals,
    runId: latest?.run.runId ?? null,
    ranAt: latest?.run.ranAt ?? null,
    generatedAt: result?.generatedAt ?? null,
  }
}

function resolveSectionCoverage(
  sec: DocSection,
  joins: { run: GuardScenarioResult[]; manifest?: GuardManifestSection; gap?: GuardCoverageGap },
): GuardSectionCoverage {
  const base = {
    anchor: sec.anchor,
    headingText: sec.headingText,
    level: sec.level,
    fingerprint: sec.fingerprint,
    scenarioIds: [] as string[],
    scenarios: [] as GuardSectionScenario[],
  }
  const { run, manifest, gap } = joins
  const verdict = manifest?.classification
  const withVerdict = verdict ? { classification: verdict } : {}

  // 1. Ran — the worst scenario outcome paints the section.
  if (run.length > 0) {
    return {
      ...base,
      status: worstOutcome(run.map((s) => s.outcome)),
      scenarioIds: run.map((s) => s.id),
      scenarios: run.map(toSectionScenario),
      ...withVerdict,
    }
  }

  // 2. Guarded but absent from the current run (run stale / never run).
  if (manifest && manifest.scenarioIds.length > 0) {
    return { ...base, status: 'guarded', scenarioIds: manifest.scenarioIds.slice(), ...withVerdict }
  }

  // 3. A coverage gap from the last generate. An awaiting-driver gap paints under
  // its driver id (api/web/tui) so the drivers stay separate; other kinds paint as
  // themselves. (Tolerant of an old-shape in-memory gap whose kind IS a driver id.)
  if (gap) {
    const status: GuardSectionCoverageStatus =
      gap.kind === 'awaiting-driver'
        ? gap.driver && isAwaitingDriver(gap.driver)
          ? gap.driver
          : 'unguarded'
        : gap.kind
    return {
      ...base,
      status,
      reason: gap.reason,
      ...(gap.kind === 'blocked-on' ? { blockedOnCapabilities: parseBlockedOnCapabilities(gap.reason) } : {}),
      ...withVerdict,
    }
  }

  // 4. A bare classification (no scenario authored, no recorded gap).
  if (verdict) {
    if ('untestable' in verdict) return { ...base, status: 'untestable', reason: verdict.reason, ...withVerdict }
    // A non-runnable driver awaits its driver; paint under the driver id.
    if (isAwaitingDriver(verdict.driver)) return { ...base, status: verdict.driver, reason: verdict.reason, ...withVerdict }
    // Classified guardable (a runnable driver) but nothing authored yet — still unguarded.
    return { ...base, status: 'unguarded', ...withVerdict }
  }

  // 5. Nothing binds this section.
  return { ...base, status: 'unguarded' }
}

function buildOrphanedCoverage(
  orphanRun: Map<string, GuardScenarioResult[]>,
  manifestByAnchor: Map<string, GuardManifestSection>,
  liveAnchors: Set<string>,
): GuardOrphanedCoverage[] {
  const byAnchor = new Map<string, { ids: Set<string>; scenarios: GuardSectionScenario[] }>()
  const ensure = (anchor: string) => {
    let e = byAnchor.get(anchor)
    if (!e) byAnchor.set(anchor, (e = { ids: new Set(), scenarios: [] }))
    return e
  }
  for (const [anchor, results] of orphanRun) {
    const e = ensure(anchor)
    for (const r of results) {
      e.ids.add(r.id)
      e.scenarios.push(toSectionScenario(r))
    }
  }
  // Manifest-declared guards whose section is gone and that the run never touched.
  for (const [anchor, m] of manifestByAnchor) {
    if (liveAnchors.has(anchor) || m.scenarioIds.length === 0) continue
    const e = ensure(anchor)
    for (const id of m.scenarioIds) e.ids.add(id)
  }
  return [...byAnchor.entries()]
    .map(([anchor, e]) => ({ anchor, scenarioIds: [...e.ids].sort(), scenarios: e.scenarios }))
    .sort((a, b) => a.anchor.localeCompare(b.anchor))
}

function toSectionScenario(s: GuardScenarioResult): GuardSectionScenario {
  return {
    id: s.id,
    title: s.title,
    outcome: s.outcome,
    durationMs: s.durationMs,
    ...(s.failure ? { failure: s.failure } : {}),
    ...(s.evidencePath ? { evidencePath: s.evidencePath } : {}),
    ...(s.remappedTo ? { remappedTo: s.remappedTo } : {}),
    ...(s.currentFingerprint ? { currentFingerprint: s.currentFingerprint } : {}),
  }
}

// The non-driver gap kinds (`untestable | no-claim | blocked-on`) — the gap kinds
// that paint under themselves, derived from the kind schema minus `awaiting-driver`.
const RESIDUAL_GAP_KINDS = GuardCoverageGapKindSchema.options.filter(
  (k): k is Exclude<GuardCoverageGapKind, 'awaiting-driver'> => k !== 'awaiting-driver',
)

// Every coverage status, DERIVED from its component sources (run outcomes ∪ the
// awaiting driver ids ∪ the residual gap kinds ∪ guarded/unguarded) so a new
// outcome, driver, or gap kind joins the totals buckets automatically — the
// NaN-from-a-missing-bucket class dies at the source.
const COVERAGE_STATUSES = [
  ...GuardOutcomeSchema.options,
  ...awaitingDriverIds,
  ...RESIDUAL_GAP_KINDS,
  'guarded',
  'unguarded',
] as const satisfies readonly GuardSectionCoverageStatus[]

// Compile-time backstop: if a new `GuardSectionCoverageStatus` is ever added
// without a bucket above, `_MissingStatus` becomes non-`never` and this fails to
// build — a missing totals bucket can never ship silently.
type _MissingStatus = Exclude<GuardSectionCoverageStatus, (typeof COVERAGE_STATUSES)[number]>
const _allStatusesBucketed: _MissingStatus extends never ? true : never = true
void _allStatusesBucketed

function emptyTotals(): Record<GuardSectionCoverageStatus, number> {
  return Object.fromEntries(COVERAGE_STATUSES.map((k) => [k, 0])) as Record<GuardSectionCoverageStatus, number>
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

// ---------------------------------------------------------------------------
// Scenario inventory + recipe card (the Scenarios tab).
// ---------------------------------------------------------------------------

/**
 * List every committed scenario for the Scenarios-tab inventory, plus the
 * preparation-recipe card. Generated AND hand-written scenarios are included:
 * hand-written = an id no manifest section binds (the manifest lists the ids the
 * generator authored). The last-run outcome / orphaned flag are joined
 * client-side from the run store — this list is run-independent so a fresh clone
 * shows its committed guards before any local run.
 */
export function listGuardScenarios(repoRoot: string): GuardScenarioInventory {
  const { scenarios } = loadScenarios(repoRoot)
  const manifest = readManifestStore(repoRoot)
  const manifestIds = new Set<string>()
  for (const sec of manifest?.sections ?? []) for (const id of sec.scenarioIds) manifestIds.add(id)

  const headingByDocAnchor = headingTextIndex(repoRoot, scenarios.map((s) => s.binds.doc))
  const fileById = scenarioFilesById(repoRoot)
  const items: GuardScenarioListItem[] = scenarios
    .map((s) => {
      const headingText = headingByDocAnchor.get(`${s.binds.doc}\0${s.binds.section}`)
      return {
        id: s.id,
        title: s.title,
        doc: s.binds.doc,
        anchor: s.binds.section,
        ...(headingText ? { headingText } : {}),
        file: fileById.get(s.id) ?? '',
        handWritten: !manifestIds.has(s.id),
      }
    })
    .sort(
      (a, b) => a.doc.localeCompare(b.doc) || a.anchor.localeCompare(b.anchor) || a.id.localeCompare(b.id),
    )

  return { recipe: readGuardRecipeCard(repoRoot), scenarios: items }
}

/**
 * `doc\0anchor` → the section's human heading text, from each live doc's section
 * index (the same index `composeDocCoverage` joins heading texts from) — slugs
 * are engine identifiers, not UI copy. A doc that no longer exists, escapes the
 * repo, or lost the section contributes nothing (the row carries no headingText).
 */
function headingTextIndex(repoRoot: string, docs: readonly string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const doc of new Set(docs)) {
    // Confine to the repo tree — no traversal (mirrors the coverage route's guard).
    if (path.isAbsolute(doc) || doc.split(/[\\/]/).includes('..')) continue
    let content: string
    try {
      content = fs.readFileSync(path.join(repoRoot, doc), 'utf-8')
    } catch {
      continue
    }
    for (const sec of buildDocSectionIndex(doc, content).sections) {
      map.set(`${doc}\0${sec.anchor}`, sec.headingText)
    }
  }
  return map
}

/**
 * The last-generate report for the DASHBOARD, with each birth finding enriched
 * with its section's human `headingText` — joined at read time from the live doc's
 * section index (the same `headingTextIndex` join `listGuardScenarios` uses). A
 * finding's section is unsettled by definition (it persists no scenario), so it
 * NEVER has a committed scenario to donate the heading client-side; without this
 * server join every findings group header degrades to a slug — and slugs are never
 * UI copy. `result.json` on disk carries no `headingText`; the enrichment is
 * read-side only. A doc/section that is gone contributes no key (tolerant).
 */
export function readGuardReport(repoRoot: string): GuardGenerateReport | null {
  const report = readGuardResultStore(repoRoot)
  if (!report) return report
  const held = report.heldSections ?? []
  // A held section is unsettled by definition, so — like a finding — no committed
  // scenario donates its heading client-side; join it server-side the same way.
  if (report.birthFindings.length === 0 && held.length === 0) return report
  const headingByDocAnchor = headingTextIndex(repoRoot, [
    ...report.birthFindings.map((f) => f.doc),
    ...held.map((h) => h.doc),
  ])
  return {
    ...report,
    birthFindings: report.birthFindings.map((f) => {
      const headingText = headingByDocAnchor.get(`${f.doc}\0${f.anchor}`)
      return { ...f, ...(headingText ? { headingText } : {}) }
    }),
    ...(held.length > 0
      ? {
          heldSections: held.map((h) => {
            const headingText = headingByDocAnchor.get(`${h.doc}\0${h.anchor}`)
            return { ...h, ...(headingText ? { headingText } : {}) }
          }),
        }
      : {}),
  }
}

/**
 * The preparation-recipe card, or `null` when no (valid) `recipe.json` exists.
 * `stale` compares the current discovery-input fingerprint to the last run's
 * recorded `recipeFingerprint` (the only stored baseline) — `null` when no run.
 * An invalid `recipe.json` reads as absent (the card is informational).
 */
export function readGuardRecipeCard(repoRoot: string): GuardRecipeCard | null {
  let loaded: LoadedRecipe | null
  try {
    loaded = loadRecipe(repoRoot, recipePath(repoRoot))
  } catch {
    return null
  }
  if (!loaded) return null
  const latest = readGuardLatestStore(repoRoot)
  return {
    build: loaded.recipe.build,
    entry: loaded.recipe.entry.slice(),
    env: loaded.recipe.env ?? null,
    fingerprint: loaded.fingerprint,
    stale: latest ? loaded.fingerprint !== latest.run.recipeFingerprint : null,
  }
}

/** Map each committed scenario id → its repo-relative YAML path (first sorted file wins, matching the loader's dedup). */
function scenarioFilesById(repoRoot: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const file of collectYamlFiles(scenariosDir(repoRoot)).sort()) {
    let parsed: unknown
    try {
      parsed = yaml.load(fs.readFileSync(file, 'utf-8'))
    } catch {
      continue
    }
    const id = (parsed as { id?: unknown } | null)?.id
    if (typeof id === 'string' && !map.has(id)) map.set(id, path.relative(repoRoot, file))
  }
  return map
}

// ---------------------------------------------------------------------------
// Traversal-safe store reads.
// ---------------------------------------------------------------------------

/** `<iso>_<short-uuid>` run ids and plain evidence filenames — no separators, no `..`. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

/** Read + validate a past run snapshot, or `null` when the id is unsafe or absent. */
export function readGuardRun(repoRoot: string, runId: string): GuardLatest | null {
  if (!SAFE_SEGMENT.test(runId)) return null
  return readJson(guardRunPath(repoRoot, runId), (data) => {
    const parsed = GuardLatestSchema.safeParse(data)
    return parsed.success ? parsed.data : null
  })
}

/** Find a committed scenario by id and return its raw YAML source, or `null`. */
export function readGuardScenarioSource(repoRoot: string, id: string): GuardScenarioSource | null {
  for (const file of collectYamlFiles(scenariosDir(repoRoot))) {
    let raw: string
    try {
      raw = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    let parsed: unknown
    try {
      parsed = yaml.load(raw)
    } catch {
      continue
    }
    if (parsed && typeof parsed === 'object' && (parsed as { id?: unknown }).id === id) {
      return { id, file: path.relative(repoRoot, file), content: raw }
    }
  }
  return null
}

/**
 * Read one evidence file for a failed scenario. `runId` and `file` are charset-
 * validated (no separators, no `..`); `scenarioId` is sanitized into a dir name by
 * the store; and the resolved path is confined to the run's evidence dir. Returns
 * `null` for an unsafe segment or a missing file.
 */
export function readGuardEvidence(
  repoRoot: string,
  runId: string,
  scenarioId: string,
  file = 'transcript.txt',
): string | null {
  if (!SAFE_SEGMENT.test(runId) || !SAFE_SEGMENT.test(file)) return null
  const full = path.resolve(evidenceScenarioDir(repoRoot, runId, scenarioId), file)
  const runDir = path.resolve(evidenceRunDir(repoRoot, runId))
  if (full !== runDir && !full.startsWith(runDir + path.sep)) return null
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null
  return fs.readFileSync(full, 'utf-8')
}

/**
 * Read one evidence file addressed by its repo-relative evidence DIRECTORY (a birth
 * finding's `evidencePath`, `.truecourse/guard/evidence/<runId>/<scenarioId>`) — the
 * `readGuardEvidence` sibling for findings, which store the whole pointer rather
 * than a run id. `file` is charset-validated and the resolved path is confined to
 * the guard evidence root (`guard/evidence/`), the same traversal guard, so a
 * `../`-laced `evidenceDir` can never escape it. Returns `null` for an unsafe
 * segment, a path outside the evidence root, or a missing file.
 */
export function readGuardEvidenceAt(
  repoRoot: string,
  evidenceDir: string,
  file = 'transcript.txt',
): string | null {
  if (!SAFE_SEGMENT.test(file)) return null
  const evidenceRoot = path.resolve(guardDir(repoRoot), 'evidence')
  const dir = path.resolve(repoRoot, evidenceDir)
  if (dir !== evidenceRoot && !dir.startsWith(evidenceRoot + path.sep)) return null
  const full = path.resolve(dir, file)
  if (!full.startsWith(dir + path.sep)) return null
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null
  return fs.readFileSync(full, 'utf-8')
}

// ---------------------------------------------------------------------------
// Staleness (mtime probe) — the two amber-dot signals for the Guard tab.
// ---------------------------------------------------------------------------

/**
 * Compute the guard staleness signals from store mtimes (the guard analogue of
 * the verify staleness probe). `generateStale`: the spec corpus is newer than the
 * last generate. `runStale`: the scenarios are newer than the last run.
 */
export function computeGuardStaleness(repoRoot: string): GuardStaleness {
  const corpusMtime = mtimeIfExists(corpusFilePath(repoRoot))
  const generatedMtime = mtimeIfExists(guardResultPath(repoRoot))
  const runMtime = mtimeIfExists(guardLatestPath(repoRoot))
  const scenariosMtime = newestScenarioMtime(repoRoot)

  return {
    generateStale: corpusMtime !== null && (generatedMtime === null || corpusMtime > generatedMtime),
    runStale: scenariosMtime !== null && (runMtime === null || scenariosMtime > runMtime),
    hasCorpus: corpusMtime !== null,
    hasScenarios: scenariosMtime !== null,
    hasGenerated: generatedMtime !== null,
    hasRun: runMtime !== null,
  }
}

/** Newest mtime among the scenario YAMLs and the manifest — the "scenarios changed" marker. */
function newestScenarioMtime(repoRoot: string): number | null {
  let newest = mtimeIfExists(manifestPath(repoRoot))
  for (const file of collectYamlFiles(scenariosDir(repoRoot))) {
    const m = mtimeIfExists(file)
    if (m !== null && (newest === null || m > newest)) newest = m
  }
  return newest
}

// ---------------------------------------------------------------------------
// Small fs helpers.
// ---------------------------------------------------------------------------

function collectYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectYamlFiles(full))
    else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) out.push(full)
  }
  return out
}

function mtimeIfExists(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return null
  }
}

function readJson<T>(file: string, map: (data: unknown) => T | null): T | null {
  if (!fs.existsSync(file)) return null
  try {
    return map(JSON.parse(fs.readFileSync(file, 'utf-8')))
  } catch {
    return null
  }
}
