/**
 * Read-surface drivers for the guard dashboard — the guard analogue of the verify
 * read routes. All route logic lives here so the Express adapter stays thin (the
 * CLAUDE.md route→driver→store rule): the per-section coverage join, the mtime
 * staleness probe, and the traversal-safe run / scenario-source / evidence reads.
 *
 * Pure composition (`composeDocCoverage`) takes already-parsed inputs so it is
 * unit-testable without I/O; the readers below route through the pluggable
 * `GuardStore` (`../lib/guard-store.js`) so the enterprise Postgres store can serve
 * the same surface. The store readers are re-exported so the dashboard depends only
 * on `@truecourse/core`.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  buildDocSectionIndex,
  computeRecipeFingerprint,
  guardLatestPath,
  guardResultPath,
  manifestPath,
  dependenciesPath,
  guardAuthoredInterfacesPath,
  guardInterfacesPath,
  mergeInterfaceCatalogs,
  readInterfaceCatalogRaw,
  readMergedInterfaceCatalog,
  RecipeSchema,
  resolveApiServers,
  scenariosDir,
  type DocSection,
  type DocSectionIndex,
} from '@truecourse/guard-runner'
import { flowsPath } from '@truecourse/guard-generator'
import {
  GUARD_SETUP_AUTHORED_INTERFACES_FILE,
  GUARD_SETUP_DEPENDENCIES_FILE,
  GUARD_SETUP_INTERFACES_FILE,
} from '../services/guard-setup/bundle.js'
import { corpusFilePath } from '@truecourse/spec-consolidator'
import {
  GUARD_COVERAGE_STATUS_PRECEDENCE,
  GUARD_DRIVERS,
  type GuardDriverDef,
  GuardFlowsFileSchema,
  GuardOutcomeSchema,
  GuardCoverageGapKindSchema,
  awaitingDriverIds,
  deriveNeedsSetup,
  describeGuardScenario,
  describeGuardScenarioSteps,
  dismissedClaimKey,
  guardGapLabel,
  isAwaitingDriver,
  isManualFlowId,
  manualFlowId,
  manualFlowScenarioId,
  parseBlockedOnCapabilities,
  runRefusalError,
  worstCoverageStatus,
  guardFindingClass,
  type GuardBirthFinding,
  type GuardTriage,
  type GuardCoverageGap,
  type GuardCoverageGapKind,
  type GuardDecisions,
  type GuardClaimIdentity,
  type GuardDismissedClaim,
  type GuardDismissedFlow,
  type GuardDocCoverage,
  type GuardDriverId,
  type GuardFailureDetail,
  type GuardFlow,
  type GuardFlowBucket,
  type GuardFlowDetail,
  type GuardFlowGap,
  type GuardFlowListItem,
  type GuardFlowMilestoneView,
  type GuardFlowScenarioRow,
  type GuardFlowSurface,
  type GuardFlowSurfaceGap,
  type GuardFlowsFile,
  type GuardFlowsView,
  type GuardGenerateError,
  type GuardArtifactSource,
  type GuardInterfaceFlowRef,
  type GuardInterfaceRow,
  type GuardInterfacesView,
  type GuardInterfaceSurface,
  type InterfaceCatalogSource,
  InterfacesFileSchema,
  type InterfacesFile,
  type GuardLatest,
  type GuardExternalSetupIndex,
  type GuardManifest,
  type GuardManifestFlow,
  guardManifestSections,
  type GuardManifestSectionView,
  type GuardNeedsSetup,
  type GuardOrphanedCoverage,
  type GuardGenerateReport,
  type GuardRecipeCard,
  type GuardRunFlow,
  type GuardScenario,
  type GuardScenarioInventory,
  type GuardScenarioListItem,
  type GuardScenarioResult,
  type GuardScenarioSource,
  type GuardTestStatus,
  type GuardSectionCoverage,
  type GuardSectionCoverageStatus,
  type GuardSectionFlow,
  type GuardHistory,
  type GuardHistoryEntry,
  type GuardSectionScenario,
  type GuardStaleness,
} from '@truecourse/shared'
import {
  getGuardStore,
  guardsMaterializeInPlace,
  loadGuardSetupBundle,
  listScenarioFiles,
  readGuardDecisions as readGuardDecisionsStore,
  readGuardEvidence as readGuardEvidenceStore,
  readGuardEvidenceAt as readGuardEvidenceAtStore,
  readGuardLatest as readGuardLatestStore,
  readGuardResult as readGuardResultStore,
  readGuardRun as readGuardRunStore,
  readGuardRunForCommit as readGuardRunForCommitStore,
  readManifest as readManifestStore,
  readRecipeRaw,
  readScenarioFile,
  writeGuardDecisions as writeGuardDecisionsStore,
  deleteGuardDecisions as deleteGuardDecisionsStore,
} from '../lib/guard-store.js'
import { readGuardExternalSetupIndex } from './guard-externals.js'
import { getGuardGateHeadsLookup } from '../lib/guard-gate-pending.js'
import { readRepoDoc } from '../lib/repo-doc-reader.js'
import { loadSpec } from '../lib/spec-store.js'
import { readLatest } from '../lib/analysis-store.js'

// The dashboard reads the whole guard surface through core (never guard-runner /
// the store directly), mirroring how spec routes read through spec-in-process.
// These pass-through delegators are the file store in OSS, Postgres in EE.
export {
  readGuardLatest,
  readGuardRunForCommit,
  readGuardHistory,
  readGuardResult,
  readManifest,
  readGuardDecisions,
  writeGuardDecisions,
} from '../lib/guard-store.js'

// ---------------------------------------------------------------------------
// Commit resolution (EE) — the guard analogue of the BL-Drift diff base.
// ---------------------------------------------------------------------------

/** The baseline commit — the default-branch anchor guard reads fall back to
 *  when no explicit ref is given (EE): the analyze LATEST's commit (the same
 *  anchor spec-in-process uses for the baseline corpus). `undefined` when no
 *  baseline exists yet. */
async function guardBaselineCommit(repoKey: string): Promise<string | undefined> {
  return (await readLatest(repoKey))?.analysis.commitHash ?? undefined
}

/**
 * The resolved read scope for a guard view:
 *  - `live`   — OSS (the in-place file store): the working tree, commit-free.
 *  - `commit` — hosted: the explicit `ref` (a PR head) or, absent one, the
 *    default-branch baseline commit.
 *  - `empty`  — hosted with NOTHING resolvable (no ref, no baseline yet). Reads
 *    MUST come back absent, never the store's newest-set fallback: the newest
 *    stored set can be a PR's regenerated corpus, which must not leak into the
 *    repo-level view (the approved no-"newest by createdAt" decision).
 */
type GuardReadScope =
  | { kind: 'live'; commit?: undefined }
  | { kind: 'commit'; commit: string }
  | { kind: 'empty'; commit?: undefined }

async function resolveGuardScope(repoKey: string, ref?: string): Promise<GuardReadScope> {
  if (guardsMaterializeInPlace()) return { kind: 'live' }
  const commit = ref ?? (await guardBaselineCommit(repoKey))
  return commit ? { kind: 'commit', commit } : { kind: 'empty' }
}

/**
 * The providable-externals index a read surface joins gaps against, or
 * `null` where it cannot exist. Externals live in the WORKING TREE (`recipe.json`
 * + the gitignored overlay + the host env), exactly like the routes that write
 * them, so a hosted store answers `null` and its `blocked-on` gaps stay plain —
 * a hosted view has no External APIs page to send anyone to.
 */
export function guardExternalSetupIndexForView(repoKey: string): GuardExternalSetupIndex | null {
  if (!guardsMaterializeInPlace()) return null
  return readGuardExternalSetupIndex(repoKey)
}

// ---------------------------------------------------------------------------
// Per-section coverage join (pure).
// ---------------------------------------------------------------------------

/** The parsed store inputs the coverage join reads (all nullable — absent stores). */
export interface GuardCoverageSources {
  manifest: GuardManifest | null
  latest: GuardLatest | null
  result: GuardGenerateReport | null
  /**
   * The synthesized flow corpus (`scenarios/flows.json`) — flow titles, goals and
   * the milestone→section map. Absent (never synthesized, or a store that does not
   * carry it) degrades to manifest-derived flows: the flow id stands in for the
   * title and no milestone positions are known. Never an error.
   */
  flows?: GuardFlowsFile | null
  /**
   * Service → provisioning state for every external the externals machinery knows
   * (`readGuardExternalSetupIndex`). It promotes a `blocked-on` gap whose
   * missing capability is a PROVIDABLE service to the `needs-setup` status. Absent
   * (a hosted store with no working tree, a repo with no recipe and no detection)
   * degrades to plain `blocked-on` — never an error, never a fabricated CTA.
   */
  externals?: GuardExternalSetupIndex | null
}

/**
 * Join a live spec doc's sections to their guard coverage. Each section (in
 * document order) carries the FLOWS that traverse it — the user-directed
 * inversion: a section click shows flows, and scenarios are reached one click
 * further, through a flow. The section status is the worst status over those
 * flows (run outcome > `guarded` > gap), falling back to a claim-level gap from
 * the last generate and then `unguarded`. Hand-written scenarios group under a
 * Manual pseudo-flow. Guards whose bound section was removed surface in
 * `orphanedSections`. Pure: `content` is the live doc text.
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

  // The flow-keyed manifest projected onto its sections — still the pivot the
  // orphaned-coverage join (a bound section that no longer exists) reads.
  const manifestByAnchor = new Map<string, GuardManifestSectionView>()
  for (const m of guardManifestSections(manifest)) {
    if (m.doc === doc) manifestByAnchor.set(m.anchor, m)
  }

  const join = buildFlowJoin(sources)

  // Gaps recorded for this doc, kept per anchor: a gap naming a flow rides that
  // flow's surface row; the rest are claim-level and paint the section directly.
  const gapsByAnchor = new Map<string, GuardCoverageGap[]>()
  for (const g of result?.coverageGaps ?? []) {
    if (g.doc === doc) push(gapsByAnchor, g.anchor, g)
  }

  const totals = emptyTotals()
  const sections = index.sections.map((sec) => {
    const cov = resolveSectionCoverage(sec, {
      doc,
      join,
      run: runByAnchor.get(sec.anchor) ?? [],
      gaps: gapsByAnchor.get(sec.anchor) ?? [],
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

/** Everything the flow join reads: the coverage sources plus (where the caller
 *  has it) the committed corpus, which names each scenario's surface and journey. */
interface FlowJoinSources extends GuardCoverageSources {
  scenarios?: readonly GuardScenario[]
}

/**
 * The flow inputs indexed together — the synthesized corpus (identity +
 * milestones), the manifest (surfaces + gaps), the committed scenarios, and the
 * last run (outcomes). ONE builder so the coverage join, the flow list, and the
 * flow detail can never disagree about what a flow's surfaces are.
 */
interface FlowJoin {
  corpus: Map<string, GuardFlow>
  manifestFlows: Map<string, GuardManifestFlow>
  scenarioById: Map<string, GuardScenario>
  runById: Map<string, GuardScenarioResult>
  /** Scenario id → the manifest flow that declares it. */
  ownerByScenario: Map<string, string>
  /** Flow id → the scenario ids attributed to it (manifest ∪ corpus ∪ run). */
  scenarioIdsByFlow: Map<string, string[]>
  /** Scenario id → the driver it runs on, when a committed scenario is loaded. */
  driverByScenario: Map<string, GuardDriverId>
  /**
   * Scenario id → the status the manifest committed it with. Guard commits tests
   * that FAILED their birth execution, so a committed test is not green by
   * construction — this is the inventory status a read paints when the current run
   * has no outcome for the scenario.
   */
  birthStatusByScenario: Map<string, GuardTestStatus>
  /** Flow id → the last generate's gaps naming it (the manifest-less fallback). */
  reportGapsByFlow: Map<string, GuardCoverageGap[]>
  /**
   * Flow id → the last generate's AUTHORING errors for it. A flow whose authoring
   * failed has no scenario and no gap, so without this join it reads as bare
   * `unguarded` ("nothing ever tried") when the truth is "generate tried and
   * failed". Birth errors and run refusals are excluded: those are reported
   * elsewhere and neither means "no test could be written".
   */
  authoringErrorsByFlow: Map<string, GuardGenerateError[]>
  /** Flow ids bound to `doc\0anchor`, corpus first then manifest, deduped. */
  flowIdsBySection: Map<string, string[]>
  /** Providable-external index; null ⇒ every `blocked-on` stays plain. */
  externals: GuardExternalSetupIndex | null
}

function buildFlowJoin(sources: FlowJoinSources): FlowJoin {
  const corpus = new Map<string, GuardFlow>()
  for (const flow of sources.flows?.flows ?? []) corpus.set(flow.id, flow)

  const manifestFlows = new Map<string, GuardManifestFlow>()
  for (const flow of sources.manifest?.flows ?? []) manifestFlows.set(flow.flowId, flow)

  const scenarioById = new Map<string, GuardScenario>()
  for (const s of sources.scenarios ?? []) scenarioById.set(s.id, s)

  const runById = new Map<string, GuardScenarioResult>()
  for (const s of sources.latest?.scenarios ?? []) runById.set(s.id, s)

  const ownerByScenario = new Map<string, string>()
  for (const flow of manifestFlows.values()) {
    for (const s of flow.scenarios) ownerByScenario.set(s.id, flow.flowId)
  }

  const driverByScenario = new Map<string, GuardDriverId>()
  for (const s of scenarioById.values()) driverByScenario.set(s.id, s.driver)
  const birthStatusByScenario = new Map<string, GuardTestStatus>()
  for (const flow of manifestFlows.values()) {
    for (const s of flow.scenarios) {
      driverByScenario.set(s.id, s.surface)
      birthStatusByScenario.set(s.id, s.status)
    }
  }

  // Every scenario the flow owns, whichever store knows it: the manifest declares
  // the generated set, the committed corpus adds hand-written work (and anything a
  // manifest write lost), the run adds a result that outlived its manifest row.
  const scenarioIdsByFlow = new Map<string, string[]>()
  const attribute = (flowId: string, scenarioId: string): void => {
    const list = scenarioIdsByFlow.get(flowId)
    if (!list) scenarioIdsByFlow.set(flowId, [scenarioId])
    else if (!list.includes(scenarioId)) list.push(scenarioId)
  }
  for (const flow of manifestFlows.values()) {
    for (const s of flow.scenarios) attribute(flow.flowId, s.id)
  }
  for (const s of scenarioById.values()) {
    attribute(s.flow?.id ?? ownerByScenario.get(s.id) ?? manualFlowId(s.id), s.id)
  }
  for (const r of runById.values()) {
    attribute(r.flowId ?? ownerByScenario.get(r.id) ?? manualFlowId(r.id), r.id)
  }

  const reportGapsByFlow = new Map<string, GuardCoverageGap[]>()
  for (const gap of sources.result?.coverageGaps ?? []) {
    if (gap.flowId) push(reportGapsByFlow, gap.flowId, gap)
  }

  // Reports written before the discriminator existed carry no `kind`; the schema
  // documents those as `authoring`, which is what they were.
  const authoringErrorsByFlow = new Map<string, GuardGenerateError[]>()
  for (const e of sources.result?.errors ?? []) {
    if (e.flowId && (e.kind === undefined || e.kind === 'authoring')) push(authoringErrorsByFlow, e.flowId, e)
  }

  const flowIdsBySection = new Map<string, string[]>()
  const bind = (doc: string, anchor: string, flowId: string): void => {
    const key = `${doc}\0${anchor}`
    const list = flowIdsBySection.get(key)
    if (!list) flowIdsBySection.set(key, [flowId])
    else if (!list.includes(flowId)) list.push(flowId)
  }
  for (const flow of corpus.values()) {
    for (const b of flow.bindings) bind(b.doc, b.anchor, flow.id)
    for (const m of flow.milestones) bind(m.doc, m.anchor, flow.id)
  }
  for (const flow of manifestFlows.values()) {
    for (const b of flow.bindings) bind(b.doc, b.anchor, flow.flowId)
  }
  // A flow whose authoring failed may have no manifest entry at all (nothing was
  // written for it), so the error's own section binding is what keeps it reachable
  // from the coverage view instead of vanishing into `unguarded`.
  for (const [flowId, errors] of authoringErrorsByFlow) {
    for (const e of errors) bind(e.doc, e.anchor, flowId)
  }

  return {
    corpus,
    manifestFlows,
    scenarioById,
    runById,
    ownerByScenario,
    scenarioIdsByFlow,
    driverByScenario,
    birthStatusByScenario,
    reportGapsByFlow,
    authoringErrorsByFlow,
    flowIdsBySection,
    externals: sources.externals ?? null,
  }
}

/** The flow a run result belongs to: its own ref, else the manifest's, else Manual. */
function flowIdOfResult(result: GuardScenarioResult, join: FlowJoin): string {
  return result.flowId ?? join.ownerByScenario.get(result.id) ?? manualFlowId(result.id)
}

/**
 * The coverage status a gap paints under: an awaiting-driver gap → its driver id,
 * a `blocked-on` gap the externals index says is PROVIDABLE → `needs-setup` (item
 * 65 — the kind stays `blocked-on`, only the read-model status is promoted), and
 * every other gap → its own kind.
 */
function gapStatus(
  gap: { kind: GuardCoverageGapKind; driver?: GuardDriverId },
  needsSetup?: GuardNeedsSetup,
): GuardSectionCoverageStatus {
  if (needsSetup) return 'needs-setup'
  if (gap.kind !== 'awaiting-driver') return gap.kind
  return gap.driver && isAwaitingDriver(gap.driver) ? gap.driver : 'unguarded'
}

/** The needs-setup derivation of a gap, or undefined when it is not a promotable one. */
function gapNeedsSetup(
  gap: { kind: GuardCoverageGapKind; reason: string },
  externals: GuardExternalSetupIndex | null,
): GuardNeedsSetup | undefined {
  if (gap.kind !== 'blocked-on') return undefined
  return deriveNeedsSetup(gap.reason, externals) ?? undefined
}

/** A gap as the UI renders it — kind + reason + the shared one-line label. */
function toFlowGap(
  gap: {
    kind: GuardCoverageGapKind
    reason: string
    driver?: GuardDriverId
  },
  externals: GuardExternalSetupIndex | null = null,
): GuardFlowGap {
  const needsSetup = gapNeedsSetup(gap, externals)
  return {
    kind: gap.kind,
    reason: gap.reason,
    ...(gap.driver ? { driver: gap.driver } : {}),
    label: guardGapLabel(gap.kind, gap.driver),
    ...(needsSetup ? { needsSetup } : {}),
  }
}

/**
 * One surface row for a scenario, painted by the run when there is one. Without a
 * run the row falls back to the test's BIRTH status: guard commits tests that
 * failed their birth execution, so `guarded` is honest only for a test that passed
 * — a committed failing test paints `fail` from the moment it is generated, and
 * the next run that covers it overrides that (a code fix simply turns it green).
 */
function scenarioSurface(
  scenarioId: string,
  surface: GuardDriverId | undefined,
  join: FlowJoin,
): GuardFlowSurface {
  const run = join.runById.get(scenarioId)
  const birthFailed = join.birthStatusByScenario.get(scenarioId) === 'failing'
  return {
    ...(surface ? { surface } : {}),
    scenarioId,
    status: run ? run.outcome : birthFailed ? 'fail' : 'guarded',
    ...(run ? { outcome: run.outcome } : {}),
    stage: run ? 'run' : 'birth',
    ...(run?.interfaceDrifted ? { interfaceDrifted: true } : {}),
  }
}

/**
 * Every surface of one flow: one row per scenario attributed to it (from the
 * manifest, the committed corpus, or the run — whichever knows it) plus one row
 * per gap. Gaps come from the manifest entry; when no manifest entry exists the
 * last generate's flow-level gaps stand in.
 */
function flowSurfaces(flowId: string, join: FlowJoin): GuardFlowSurface[] {
  const entry = join.manifestFlows.get(flowId)
  const surfaces = (join.scenarioIdsByFlow.get(flowId) ?? []).map((id) =>
    scenarioSurface(id, join.driverByScenario.get(id), join),
  )
  const gaps = entry ? entry.gaps : (join.reportGapsByFlow.get(flowId) ?? [])
  for (const gap of gaps) {
    const flowGap = toFlowGap(gap, join.externals)
    surfaces.push({
      ...(gap.surface ? { surface: gap.surface } : {}),
      status: gapStatus(gap, flowGap.needsSetup),
      gap: flowGap,
    })
  }
  // A surface generate TRIED to author and could not has neither a scenario nor a
  // gap; one `authoring-error` row per such surface keeps it out of `unguarded`.
  // A surface that already produced either is NOT re-painted — a written test or a
  // recorded gap is the newer, settled answer.
  const settled = new Set(surfaces.map((s) => s.surface ?? ''))
  for (const surface of erroredSurfaces(flowId, join)) {
    if (settled.has(surface ?? '')) continue
    settled.add(surface ?? '')
    surfaces.push({ ...(surface ? { surface } : {}), status: 'authoring-error' })
  }
  return surfaces
}

/**
 * The surfaces of a flow whose authoring errored, first-seen order. An error with
 * no recorded surface (an older report) yields one un-surfaced row, and only when
 * the flow has nothing else to show.
 */
function erroredSurfaces(flowId: string, join: FlowJoin): (GuardDriverId | undefined)[] {
  const out: (GuardDriverId | undefined)[] = []
  for (const e of join.authoringErrorsByFlow.get(flowId) ?? []) {
    if (!out.includes(e.surface)) out.push(e.surface)
  }
  return out
}

/** A flow's status + the reason behind it (the gap text, when a gap won). */
function rollUpFlow(surfaces: readonly GuardFlowSurface[]): {
  status: GuardSectionCoverageStatus
  reason?: string
  needsSetup?: GuardNeedsSetup
} {
  const status = worstCoverageStatus(surfaces.map((s) => s.status))
  const winner = surfaces.find((s) => s.status === status && s.gap)
  return {
    status,
    ...(winner?.gap ? { reason: winner.gap.reason } : {}),
    ...(winner?.gap?.needsSetup ? { needsSetup: winner.gap.needsSetup } : {}),
  }
}

/** The flows one live section carries, worst-first. */
function sectionFlows(
  doc: string,
  anchor: string,
  join: FlowJoin,
  run: readonly GuardScenarioResult[],
): GuardSectionFlow[] {
  const ids = [...(join.flowIdsBySection.get(`${doc}\0${anchor}`) ?? [])]
  // A run result bound here whose flow nothing else declares (a hand-written
  // scenario → its Manual pseudo-flow; a run that outlived its manifest entry)
  // still has to be reachable, so it joins the section's flow list.
  for (const result of run) {
    const flowId = flowIdOfResult(result, join)
    if (!ids.includes(flowId)) ids.push(flowId)
  }

  const flows = ids.map((flowId) => {
    const flow = join.corpus.get(flowId)
    const surfaces = flowSurfaces(flowId, join)
    const manual = isManualFlowId(flowId)
    return {
      flowId,
      // One title source for every surface (the list, the detail, and this row),
      // so a flow the corpus no longer names reads the same wherever it appears.
      title: flowTitle(flowId, join),
      ...rollUpFlow(surfaces),
      epic: (flow?.composedOf.length ?? 0) > 0,
      manual,
      milestonesInSection: (flow?.milestones ?? [])
        .filter((m) => m.doc === doc && m.anchor === anchor)
        .map((m) => m.order)
        .sort((a, b) => a - b),
      milestoneCount: flow?.milestones.length ?? 0,
      surfaces,
    }
  })

  return flows.sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || a.title.localeCompare(b.title),
  )
}

function statusRank(status: GuardSectionCoverageStatus): number {
  const i = GUARD_COVERAGE_STATUS_PRECEDENCE.indexOf(status)
  return i === -1 ? GUARD_COVERAGE_STATUS_PRECEDENCE.length : i
}

function resolveSectionCoverage(
  sec: DocSection,
  joins: {
    doc: string
    join: FlowJoin
    run: readonly GuardScenarioResult[]
    gaps: readonly GuardCoverageGap[]
  },
): GuardSectionCoverage {
  const { doc, join, run, gaps } = joins
  const flows = sectionFlows(doc, sec.anchor, join, run)
  const flowIds = new Set(flows.map((f) => f.flowId))

  // Claim-level gaps only: a gap naming one of the section's flows already rides
  // that flow's surface row, so counting it again would double-paint the section.
  const claimGaps = gaps.filter((g) => !(g.flowId && flowIds.has(g.flowId)))

  const candidates: Array<{
    status: GuardSectionCoverageStatus
    reason?: string
    needsSetup?: GuardNeedsSetup
  }> = [
    ...flows.map((f) => rollUpFlow(f.surfaces)),
    ...claimGaps.map((g) => {
      const needsSetup = gapNeedsSetup(g, join.externals)
      return {
        status: gapStatus(g, needsSetup),
        reason: g.reason,
        ...(needsSetup ? { needsSetup } : {}),
      }
    }),
  ]
  const status = worstCoverageStatus(candidates.map((c) => c.status))
  const winner = candidates.find((c) => c.status === status && c.reason)

  const scenarioIds = [
    ...new Set(flows.flatMap((f) => f.surfaces.flatMap((s) => (s.scenarioId ? [s.scenarioId] : [])))),
  ].sort()

  return {
    anchor: sec.anchor,
    headingText: sec.headingText,
    level: sec.level,
    fingerprint: sec.fingerprint,
    status,
    ...(winner?.reason ? { reason: winner.reason } : {}),
    ...(status === 'blocked-on' && winner?.reason
      ? { blockedOnCapabilities: parseBlockedOnCapabilities(winner.reason) }
      : {}),
    // The needs-setup promotion of the SAME winner — the section's CTA.
    ...(status === 'needs-setup'
      ? {
          needsSetup:
            candidates.find((c) => c.status === status && c.needsSetup)?.needsSetup ??
            { services: [], provided: [] },
        }
      : {}),
    flows,
    scenarioIds,
    // Deprecated flat projection — the section detail renders `flows`.
    scenarios: run.map(toSectionScenario),
  }
}

function buildOrphanedCoverage(
  orphanRun: Map<string, GuardScenarioResult[]>,
  manifestByAnchor: Map<string, GuardManifestSectionView>,
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
  // A derived status, so it has no source enum to come from — it is the
  // one bucket this list names by hand, and the backstop below keeps it honest.
  'needs-setup',
  // Also derived (from the report's authoring errors), for the same reason.
  'authoring-error',
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
export async function listGuardScenarios(repoKey: string, ref?: string): Promise<GuardScenarioInventory> {
  const corpus = await loadGuardCorpusForView(repoKey, ref)
  if (!corpus) return { recipe: null, scenarios: [] }
  const { commit, scenarios, manifest } = corpus

  const ownerByScenario = new Map<string, string>()
  // The status the generate committed each test with — guard commits failing
  // tests, so the inventory can paint a red test before anything has been run.
  const birthStatusByScenario = new Map<string, GuardTestStatus>()
  for (const flow of manifest?.flows ?? []) {
    for (const s of flow.scenarios) {
      ownerByScenario.set(s.id, flow.flowId)
      birthStatusByScenario.set(s.id, s.status)
    }
  }

  // The row shows the FIRST bound section (a flow binds several) and names the
  // flow it realizes — hand-written work under its Manual pseudo-flow, so the
  // Flows tab's drill-down covers every committed scenario.
  const headingByDocAnchor = await headingTextIndex(repoKey, scenarios.map((s) => s.binds[0].doc), commit)
  const fileById = await scenarioFilesById(repoKey, commit)
  const items: GuardScenarioListItem[] = scenarios
    .map((s) => {
      const headingText = headingByDocAnchor.get(`${s.binds[0].doc}\0${s.binds[0].section}`)
      const flowId = s.flow?.id ?? ownerByScenario.get(s.id) ?? manualFlowId(s.id)
      const status = birthStatusByScenario.get(s.id)
      return {
        id: s.id,
        title: s.title,
        doc: s.binds[0].doc,
        anchor: s.binds[0].section,
        ...(headingText ? { headingText } : {}),
        file: fileById.get(s.id) ?? '',
        handWritten: !ownerByScenario.has(s.id),
        flowId,
        surface: s.driver,
        ...(status ? { status } : {}),
      }
    })
    .sort(
      (a, b) => a.doc.localeCompare(b.doc) || a.anchor.localeCompare(b.anchor) || a.id.localeCompare(b.id),
    )

  return {
    recipe: await readGuardRecipeCard(repoKey, commit),
    scenarios: items,
    ...(commit !== undefined ? { scenariosCommit: commit } : {}),
  }
}

/** The committed corpus a (possibly PR-scoped) view reads: scenarios + manifest. */
interface GuardCorpusForView {
  /** The commit the set came from (hosted only; undefined on the live store). */
  commit?: string
  scenarios: GuardScenario[]
  manifest: GuardManifest | null
}

/**
 * Load the committed scenario set + its manifest for a view. Corpus loads are
 * RepoRef-keyed (the contract-store convention): the file store ignores the commit
 * and reads the live tree; EE reads the requested ref (a PR head) or the baseline
 * set — never the newest, which a PR regen would pollute. A pinned PR head with NO
 * stored set falls back to the baseline set (the one the gate actually executed
 * against that head); the set moves WHOLE, so scenarios and manifest always come
 * from the same snapshot. An unresolvable hosted scope (no ref, no baseline) is
 * `null` — the empty view, never a "newest" guess.
 */
async function loadGuardCorpusForView(
  repoKey: string,
  ref?: string,
): Promise<GuardCorpusForView | null> {
  const scope = await resolveGuardScope(repoKey, ref)
  if (scope.kind === 'empty') return null
  let commit = scope.commit
  let { scenarios } = await getGuardStore().loadScenarios({ repoKey, commitSha: commit ?? '' })
  let manifest = await readManifestStore(repoKey, commit)
  if (ref !== undefined && scenarios.length === 0 && manifest == null) {
    const base = await guardBaselineCommit(repoKey)
    if (base !== undefined && base !== commit) {
      const fromBase = await getGuardStore().loadScenarios({ repoKey, commitSha: base })
      const baseManifest = await readManifestStore(repoKey, base)
      if (fromBase.scenarios.length > 0 || baseManifest != null) {
        commit = base
        scenarios = fromBase.scenarios
        manifest = baseManifest
      }
    }
  }
  return { ...(commit !== undefined ? { commit } : {}), scenarios, manifest }
}

// ---------------------------------------------------------------------------
// Flows tab — the inventory drill-down (list + detail).
// ---------------------------------------------------------------------------

/** Repo-relative posix path of the flow corpus, the key the store seam reads by. */
function flowsRelPath(repoKey: string): string {
  return path.relative(repoKey, flowsPath(repoKey)).split(path.sep).join('/')
}

/**
 * The synthesized flow corpus (`scenarios/flows.json`), read through the SAME
 * store seam as the scenario files so a hosted view reads its commit's set. A
 * missing or malformed file reads as `null` — the surfaces degrade to
 * manifest-derived flows, never to an error.
 */
export async function readGuardFlowsFile(
  repoKey: string,
  commit?: string,
): Promise<GuardFlowsFile | null> {
  const raw = await readScenarioFile(repoKey, flowsRelPath(repoKey), commit)
  if (raw == null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = GuardFlowsFileSchema.safeParse(parsed)
  return result.success ? result.data : null
}

/** The flow corpus a (possibly PR-scoped) view reads — baseline fallback included. */
export function readGuardFlowsForView(repoKey: string, ref?: string): Promise<GuardFlowsFile | null> {
  return readPinnedWithBaselineFallback(repoKey, ref, (c) => readGuardFlowsFile(repoKey, c))
}

/** The stores every flow surface joins, resolved once for a view. */
interface FlowViewSources {
  commit?: string
  join: FlowJoin
  flowsFile: GuardFlowsFile | null
  latest: GuardLatest | null
  result: GuardGenerateReport | null
  scenarios: GuardScenario[]
}

async function loadFlowView(repoKey: string, ref?: string): Promise<FlowViewSources | null> {
  const corpus = await loadGuardCorpusForView(repoKey, ref)
  if (!corpus) return null
  const [flowsFile, latest, result] = await Promise.all([
    readGuardFlowsFile(repoKey, corpus.commit),
    readGuardRunForView(repoKey, ref),
    readGuardResultForView(repoKey, ref),
  ])
  return {
    ...(corpus.commit !== undefined ? { commit: corpus.commit } : {}),
    join: buildFlowJoin({
      manifest: corpus.manifest,
      latest,
      result,
      flows: flowsFile,
      scenarios: corpus.scenarios,
      externals: guardExternalSetupIndexForView(repoKey),
    }),
    flowsFile,
    latest,
    result,
    scenarios: corpus.scenarios,
  }
}

/** Every flow id the view knows, corpus order first, then manifest, then Manual. */
function allFlowIds(view: FlowViewSources): string[] {
  const ids: string[] = []
  const add = (id: string): void => {
    if (!ids.includes(id)) ids.push(id)
  }
  for (const flow of view.flowsFile?.flows ?? []) add(flow.id)
  for (const flow of view.join.manifestFlows.values()) add(flow.flowId)
  for (const id of view.join.scenarioIdsByFlow.keys()) add(id)
  return ids
}

/** The sections a flow binds: the corpus' bindings, else the manifest's, else its
 *  scenarios' own binds (a hand-written scenario declares its own). */
function flowSections(flowId: string, join: FlowJoin): Array<{ doc: string; anchor: string }> {
  const flow = join.corpus.get(flowId)
  if (flow) return flow.bindings.map((b) => ({ doc: b.doc, anchor: b.anchor }))
  const entry = join.manifestFlows.get(flowId)
  if (entry) return entry.bindings.map((b) => ({ doc: b.doc, anchor: b.anchor }))
  const out: Array<{ doc: string; anchor: string }> = []
  for (const id of join.scenarioIdsByFlow.get(flowId) ?? []) {
    const scenario = join.scenarioById.get(id)
    for (const b of scenario?.binds ?? []) {
      if (!out.some((s) => s.doc === b.doc && s.anchor === b.section)) {
        out.push({ doc: b.doc, anchor: b.section })
      }
    }
    const run = join.runById.get(id)
    if (!scenario && run && !out.some((s) => s.doc === run.binds.doc && s.anchor === run.binds.section)) {
      out.push({ doc: run.binds.doc, anchor: run.binds.section })
    }
  }
  return out
}

/**
 * A flow's coverage bucket — the tally/filter key `guard status` also counts by.
 * A Manual pseudo-flow IS its hand-written scenario, so it is `guarded` rather
 * than "never generated".
 */
function flowBucket(flowId: string, join: FlowJoin): GuardFlowBucket {
  if (isManualFlowId(flowId)) return 'guarded'
  const entry = join.manifestFlows.get(flowId)
  if (!entry) return 'ungenerated'
  if (entry.scenarios.length === 0) return 'blocked'
  return entry.gaps.length === 0 ? 'guarded' : 'partial'
}

/**
 * The flow's display title. The corpus names it; when the corpus no longer does
 * (an ORPHANED flow, kept only because its tests still run — and a Manual
 * pseudo-flow, which never had a corpus entry) the flow's own committed TEST
 * names it, then the last run's result for that test. The id is the last resort
 * only: a flow id is an engine handle — the detail header wears it as one, in
 * mono, beside the title — and a handle is never the title itself.
 */
function flowTitle(flowId: string, join: FlowJoin): string {
  const flow = join.corpus.get(flowId)
  if (flow) return flow.title
  for (const id of scenarioIdsFor(flowId, join)) {
    const title = join.scenarioById.get(id)?.title ?? join.runById.get(id)?.title
    if (title) return title
  }
  return flowId
}

/** The scenario ids a title may be read from: a Manual pseudo-flow's own test
 *  first (it IS that test), else every test attributed to the flow. */
function scenarioIdsFor(flowId: string, join: FlowJoin): string[] {
  const manual = manualFlowScenarioId(flowId)
  return manual ? [manual] : (join.scenarioIdsByFlow.get(flowId) ?? [])
}

/**
 * The generate errors that belong to this flow. An error the generator attributed to
 * a flow joins on that id exactly; an older (or genuinely section-scoped) error falls
 * back to the flow's bound sections — best effort, since many flows can bind one
 * section, and stated as such in the payload docs.
 *
 * A RUN-LEVEL refusal is attributed last and separately: it names the flows whose
 * validation it cancelled, so each of them can say what blocked it while the report
 * itself still carries the refusal exactly once.
 */
function flowErrors(
  flowId: string,
  join: FlowJoin,
  result: GuardGenerateReport | null,
): GuardGenerateError[] {
  const sections = new Set(flowSections(flowId, join).map((s) => `${s.doc}\0${s.anchor}`))
  const errors = (result?.errors ?? []).filter((e) =>
    e.flowId ? e.flowId === flowId : sections.has(`${e.doc}\0${e.anchor}`),
  )
  const refusal = result?.refusal
  if (refusal?.flowIds.includes(flowId)) errors.push(runRefusalError(refusal))
  return errors
}

function flowFindings(flowId: string, result: GuardGenerateReport | null): GuardBirthFinding[] {
  return (result?.birthFindings ?? []).filter((f) => f.flowId === flowId)
}

/**
 * The triage verdict a BIRTH-stage row carries: the last generate's finding when
 * `result.json` is present, else the diagnosis the manifest committed with the test
 * (which is tracked, so it survives a fresh clone). A row a RUN decided carries
 * none — that failure is a different event, and no verdict was reached about it.
 */
function birthTriage(
  ran: boolean,
  scenarioId: string,
  finding: GuardBirthFinding | undefined,
  diagnoses: ReadonlyMap<string, { triage?: GuardTriage }>,
): { triage?: GuardTriage } {
  if (ran) return {}
  const triage = finding?.triage ?? diagnoses.get(scenarioId)?.triage
  return triage ? { triage } : {}
}

/** A birth-stage failure as the compact failure detail the run results carry — the
 *  same shape, so one renderer serves a failure from either stage. */
function birthFailureDetail(finding: GuardBirthFinding): GuardFailureDetail {
  return {
    step: finding.step,
    expected: finding.expected,
    actual: finding.actual,
    ...(finding.stdout !== undefined ? { stdout: finding.stdout } : {}),
    ...(finding.stderr !== undefined ? { stderr: finding.stderr } : {}),
  }
}

/** The journey ids a flow's scenarios ground on, in first-seen path order. */
function flowJourneyIds(flowId: string, join: FlowJoin): string[] {
  const ids: string[] = []
  for (const scenarioId of join.scenarioIdsByFlow.get(flowId) ?? []) {
    const scenario = join.scenarioById.get(scenarioId)
    // Either spelling of the grounding ref: a scenario committed before the
    // interface rename carries it as `journey`.
    for (const id of (scenario?.interface ?? scenario?.journey)?.path ?? []) {
      if (!ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

/**
 * True when the manifest kept this flow only for its committed scenarios: it is
 * marked orphaned AND no synthesized flow carries its id. The corpus check is the
 * live half — a flow synthesis produces again is derived from the specs whatever
 * an older manifest entry says.
 */
function flowOrphaned(flowId: string, join: FlowJoin): boolean {
  return join.manifestFlows.get(flowId)?.orphaned === true && !join.corpus.has(flowId)
}

function flowListItem(
  flowId: string,
  view: FlowViewSources,
): GuardFlowListItem {
  const { join, result } = view
  const flow = join.corpus.get(flowId)
  const surfaces = flowSurfaces(flowId, join)
  const sections = flowSections(flowId, join)
  return {
    flowId,
    title: flowTitle(flowId, join),
    goal: flow?.goal ?? '',
    status: worstCoverageStatus(surfaces.map((s) => s.status)),
    bucket: flowBucket(flowId, join),
    epic: (flow?.composedOf.length ?? 0) > 0,
    composedOf: flow?.composedOf ?? [],
    manual: isManualFlowId(flowId),
    milestoneCount: flow?.milestones.length ?? 0,
    sectionCount: sections.length,
    docs: [...new Set(sections.map((s) => s.doc))].sort(),
    surfaces,
    // Only DRIFT-class findings say the flow is failing. A withheld generation
    // defect / fidelity rejection is ours, so it rides beside the status as a
    // muted marker and never paints the flow red.
    findings: flowFindings(flowId, result).filter((f) => guardFindingClass(f) !== 'defect').length,
    toolDefects: flowFindings(flowId, result).filter((f) => guardFindingClass(f) === 'defect').length,
    errors: flowErrors(flowId, join, result).length,
    interfaceDrifted: surfaces.some((s) => s.interfaceDrifted === true),
    ...(flowOrphaned(flowId, join) ? { orphaned: true } : {}),
  }
}

/**
 * The Flows tab: every synthesized flow (plus a Manual pseudo-flow per
 * hand-written scenario) joined to the manifest's surfaces and gaps, the last
 * run's outcomes, and the last generate's findings — with the preparation-recipe
 * card the tab inherited from the Scenarios tab. Every store may be missing; each
 * absence renders as an empty state, never an error.
 */
export async function listGuardFlows(repoKey: string, ref?: string): Promise<GuardFlowsView> {
  const view = await loadFlowView(repoKey, ref)
  if (!view) return emptyFlowsView()

  const flows = allFlowIds(view)
    .map((id) => flowListItem(id, view))
    .sort(
      (a, b) => statusRank(a.status) - statusRank(b.status) || a.title.localeCompare(b.title),
    )

  const totals = {
    total: flows.length,
    guarded: flows.filter((f) => f.bucket === 'guarded').length,
    partial: flows.filter((f) => f.bucket === 'partial').length,
    blocked: flows.filter((f) => f.bucket === 'blocked').length,
    ungenerated: flows.filter((f) => f.bucket === 'ungenerated').length,
    manual: flows.filter((f) => f.manual).length,
  }

  return {
    flows,
    totals,
    noFlowClaims: view.flowsFile?.noFlowClaims.length ?? 0,
    synthesized: view.flowsFile != null,
    recipe: await readGuardRecipeCard(repoKey, view.commit),
    generatedAt: view.result?.generatedAt ?? null,
    runId: view.latest?.run.runId ?? null,
    ranAt: view.latest?.run.ranAt ?? null,
    ...(view.commit !== undefined ? { flowsCommit: view.commit } : {}),
  }
}

/** The empty Flows payload — every list present, so the tab renders its CTA. */
function emptyFlowsView(): GuardFlowsView {
  return {
    flows: [],
    totals: { total: 0, guarded: 0, partial: 0, blocked: 0, ungenerated: 0, manual: 0 },
    noFlowClaims: 0,
    synthesized: false,
    recipe: null,
    generatedAt: null,
    runId: null,
    ranAt: null,
  }
}

/**
 * One flow's detail: the milestone chain joined to the LIVE spec sections (heading
 * text, live/gone, and whether the bound section drifted), the per-surface
 * scenario rows (source file, birth/run state, evidence pointer, journey path),
 * the gaps, and the findings the last generate attributed to the flow. `null` when
 * no flow (real or Manual) carries the id — the route answers 404.
 */
export async function readGuardFlowDetail(
  repoKey: string,
  flowId: string,
  ref?: string,
): Promise<GuardFlowDetail | null> {
  const view = await loadFlowView(repoKey, ref)
  if (!view) return null
  const { join } = view
  const known =
    join.corpus.has(flowId) || join.manifestFlows.has(flowId) || join.scenarioIdsByFlow.has(flowId)
  if (!known) return null

  const flow = join.corpus.get(flowId)
  const surfaces = flowSurfaces(flowId, join)
  const sections = flowSections(flowId, join)
  const indexes = await docSectionIndexes(repoKey, sections.map((s) => s.doc), view.commit)
  const boundFingerprints = new Map(
    (flow?.bindings ?? []).map((b) => [`${b.doc}\0${b.anchor}`, b.fingerprint]),
  )

  const milestones: GuardFlowMilestoneView[] = (flow?.milestones ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const live = indexes.get(m.doc)?.sections.find((s) => s.anchor === m.anchor)
      const bound = boundFingerprints.get(`${m.doc}\0${m.anchor}`)
      return {
        order: m.order,
        doc: m.doc,
        anchor: m.anchor,
        claimTitle: m.claimTitle,
        ...(m.note ? { note: m.note } : {}),
        ...(live ? { headingText: live.headingText } : {}),
        live: live != null,
        ...(bound ? { boundFingerprint: bound } : {}),
        ...(live ? { currentFingerprint: live.fingerprint } : {}),
        drifted: bound != null && live != null && bound !== live.fingerprint,
      }
    })

  const fileById = await scenarioFilesById(repoKey, view.commit)
  // The birth-stage failure results, keyed by the test they belong to — what a
  // committed failing test renders until a run covers it.
  const birthFailureById = new Map(
    (view.result?.birthFindings ?? []).flatMap((f) =>
      f.scenarioId && f.committed ? [[f.scenarioId, f] as const] : [],
    ),
  )
  // The diagnosis a failing test COMMITS with. It rides the manifest, so
  // it outlives the gitignored `result.json` — a fresh clone still reads the
  // verdict behind its red tests.
  const diagnosisByScenario = new Map(
    [...join.manifestFlows.values()].flatMap((f) =>
      f.scenarios.flatMap((s) => (s.diagnosis ? [[s.id, s.diagnosis] as const] : [])),
    ),
  )
  const rows: GuardFlowScenarioRow[] = surfaces.map((surface) => {
    if (!surface.scenarioId) {
      return {
        ...(surface.surface ? { surface: surface.surface } : {}),
        status: surface.status,
        birthPassed: false,
        hasEvidence: false,
        journeyPath: [],
        ...(surface.gap ? { gap: surface.gap } : {}),
      }
    }
    const scenario = join.scenarioById.get(surface.scenarioId)
    const run = join.runById.get(surface.scenarioId)
    const file = fileById.get(surface.scenarioId)
    // Without a run the row speaks for the BIRTH stage: a committed failing test
    // carries the failure (and evidence) its birth execution recorded.
    const birth = run ? undefined : birthFailureById.get(surface.scenarioId)
    return {
      ...(surface.surface ? { surface: surface.surface } : {}),
      scenarioId: surface.scenarioId,
      ...(scenario?.title ?? run?.title ? { title: scenario?.title ?? run?.title } : {}),
      ...(file ? { file } : {}),
      status: surface.status,
      birthPassed:
        scenario != null && join.birthStatusByScenario.get(surface.scenarioId) !== 'failing',
      ...(surface.stage ? { stage: surface.stage } : {}),
      ...(run ? { outcome: run.outcome, durationMs: run.durationMs } : {}),
      ...(run?.failure ? { failure: run.failure } : birth ? { failure: birthFailureDetail(birth) } : {}),
      ...(run?.failedMilestone
        ? { failedMilestone: run.failedMilestone }
        : birth?.failedMilestone
          ? { failedMilestone: birth.failedMilestone }
          : {}),
      ...(run?.interfaceDrifted ? { interfaceDrifted: true } : {}),
      // The blocked-precondition annotation of the RUN's failure. A birth finding
      // carries no such flag (the report schema records the milestone pair, not the
      // annotation), so a birth-stage row simply renders without it.
      ...(run?.blockedPrecondition ? { blockedPrecondition: true } : {}),
      ...(run?.evidencePath
        ? { evidencePath: run.evidencePath }
        : birth?.evidencePath
          ? { evidencePath: birth.evidencePath }
          : {}),
      hasEvidence: (run?.evidencePath ?? birth?.evidencePath) != null,
      // The verdict that committed this test red — birth stage only (a later run's
      // failure is a different event, with no verdict of its own). `result.json` is
      // gitignored, so the manifest DIAGNOSIS is the fallback: on a fresh clone the
      // committed red test still says whose fault it is.
      ...birthTriage(run != null, surface.scenarioId, birth, diagnosisByScenario),
      journeyPath: (scenario?.interface ?? scenario?.journey)?.path ?? [],
    }
  })

  const gaps: GuardFlowSurfaceGap[] = surfaces.flatMap((s) =>
    s.gap && s.surface ? [{ ...s.gap, surface: s.surface }] : [],
  )

  return {
    flowId,
    title: flowTitle(flowId, join),
    goal: flow?.goal ?? '',
    status: worstCoverageStatus(surfaces.map((s) => s.status)),
    bucket: flowBucket(flowId, join),
    epic: (flow?.composedOf.length ?? 0) > 0,
    manual: isManualFlowId(flowId),
    composedOf: flow?.composedOf ?? [],
    ...(flow?.fingerprint ? { fingerprint: flow.fingerprint } : {}),
    milestones,
    surfaces: rows,
    gaps,
    journeyIds: flowJourneyIds(flowId, join),
    findings: flowFindings(flowId, view.result),
    errors: flowErrors(flowId, join, view.result),
    // No goal and no milestones above is a FACT about an orphaned flow, not a hole:
    // the corpus it was derived from no longer carries it. The flag lets the reader
    // be told that, in one sentence, where the goal would have been.
    ...(flowOrphaned(flowId, join) ? { orphaned: true } : {}),
    generatedAt: view.result?.generatedAt ?? null,
    runId: view.latest?.run.runId ?? null,
    ranAt: view.latest?.run.ranAt ?? null,
  }
}

/**
 * The flows a RUN references, with their milestone chains — the join that lets the
 * Runs tab paint a result as a flow instance without a second fetch. Only the
 * flows the run's results name are returned (the smallest possible join); a
 * hand-written scenario names none and simply contributes nothing.
 */
export async function readGuardRunFlows(
  repoKey: string,
  latest: GuardLatest | null,
  ref?: string,
): Promise<GuardRunFlow[]> {
  const flowIds = new Set((latest?.scenarios ?? []).flatMap((s) => (s.flowId ? [s.flowId] : [])))
  if (flowIds.size === 0) return []
  const flowsFile = await readGuardFlowsForView(repoKey, ref)
  if (!flowsFile) return []
  return flowsFile.flows
    .filter((f) => flowIds.has(f.id))
    .map((f) => ({
      flowId: f.id,
      title: f.title,
      goal: f.goal,
      epic: f.composedOf.length > 0,
      milestones: f.milestones
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((m) => ({ order: m.order, doc: m.doc, anchor: m.anchor, claimTitle: m.claimTitle })),
    }))
}

// ---------------------------------------------------------------------------
// Interfaces tab — the code-side catalog, BOTH halves of it
// (`guard/interfaces.json` + `guard/interfaces.authored.json`).
// ---------------------------------------------------------------------------

/**
 * The interface catalog plus the reverse index onto the flows that ground on it.
 *
 * The catalog has two homes and this view reads the MERGE of them: the derived
 * snapshot the Map action writes (`guard/interfaces.json`, gitignored) and the
 * committed `guard/interfaces.authored.json` a human writes for the surfaces no
 * derivation produces. Only `cli` and `api` are ever derived whole, so composing
 * this view from the derived half alone would show a repo with no web tasks at
 * all. Each row carries `origin` for which half it came from.
 *
 * In DB mode there is no working tree, so the catalog is read out of the newest
 * stored setup bundle instead; a repo whose setup never ran reports
 * `unavailable: 'no-working-tree'` with an otherwise-empty payload. Neither half
 * present is likewise a clean empty payload (`mapped: false`) so the tab renders
 * its Map CTA, never a null check.
 */
export async function readGuardInterfaces(repoKey: string, ref?: string): Promise<GuardInterfacesView> {
  const catalog = guardsMaterializeInPlace()
    ? readMergedInterfaceCatalog(repoKey)
    : await bundledInterfaceCatalog(repoKey, ref)
  if (catalog === undefined) return { ...emptyInterfacesView(), unavailable: 'no-working-tree' }
  if (!catalog) return emptyInterfacesView()

  const corpus = await loadGuardCorpusForView(repoKey, ref)
  const flowsFile = corpus ? await readGuardFlowsFile(repoKey, corpus.commit) : null
  const { flowRefs, scenarioIdsByInterface } = interfaceReverseIndex(corpus, flowsFile)

  const interfaces: GuardInterfaceRow[] = catalog.interfaces.map((entry) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    // The family passes through verbatim — a catalog that established none carries
    // none, and the panel groups by what is there.
    ...(entry.group ? { group: entry.group } : {}),
    entry: entry.entry,
    steps: entry.steps,
    ...(entry.startingState ? { startingState: entry.startingState } : {}),
    ...(entry.endState ? { endState: entry.endState } : {}),
    // The location contract passes through verbatim — the registry the ids
    // resolve in travels once, on the view below.
    ...(entry.at ? { at: entry.at } : {}),
    ...(entry.to ? { to: entry.to } : {}),
    // The owning place travels the same way, and resolves in the same registry.
    ...(entry.resource ? { resource: entry.resource } : {}),
    fingerprint: entry.fingerprint,
    flows: flowRefs.get(entry.id) ?? [],
    scenarioIds: scenarioIdsByInterface.get(entry.id) ?? [],
    // How the AREA was derived, when it was. Absent for a hand-authored surface —
    // `source` describes a derivation ladder and there was no derivation to
    // describe; `origin` below is the row's own answer, and the honest one.
    ...(catalog.source?.[entry.type] ? { source: catalog.source[entry.type] } : {}),
    // Which half of the catalog this row came from, as the merge stamped it.
    ...(entry.origin ? { origin: entry.origin } : {}),
    ...(entry.specOnly ? { specOnly: true as const } : {}),
    // The contract passes through verbatim — the view renders the catalog's own
    // words, and a catalog without one simply carries none.
    ...(entry.contract ? { contract: entry.contract } : {}),
    // What this entry's steps CALL, by id — verbatim, absence included: the
    // client joins the ids against the api rows beside them, and `[]` (reaches
    // no server) must stay distinguishable from "nobody established it".
    ...(entry.apiEffects ? { apiEffects: entry.apiEffects } : {}),
  }))

  const countByType = new Map<string, number>()
  for (const entry of catalog.interfaces) countByType.set(entry.type, (countByType.get(entry.type) ?? 0) + 1)
  const surfaces = interfaceSurfaces(countByType, catalog.source, catalog.resources)

  return {
    mapped: true,
    generatedAt: catalog.generatedAt,
    recipeFingerprint: catalog.recipeFingerprint,
    interfaces,
    // The resource registry, verbatim — defined once in the catalog, joined by
    // the client (panel labels, the open row's place card).
    ...(catalog.resources ? { resources: catalog.resources } : {}),
    // The state registry travels the same way and for the same reason: the ids
    // are on the rows, the one line that says what each world IS is here.
    ...(catalog.states ? { states: catalog.states } : {}),
    surfaces,
    totals: {
      interfaces: interfaces.length,
      detectedSurfaces: surfaces.filter((surface) => surface.detected).length,
      grounded: interfaces.filter((row) => row.flows.length > 0).length,
      ungrounded: interfaces.filter((row) => row.flows.length === 0).length,
    },
  }
}

/**
 * The merged catalog out of the newest stored setup bundle — the DB-mode reading.
 * `undefined` means there is no bundle to read (setup never ran for this repo),
 * which is what the view reports as `no-working-tree`; `null` means a bundle
 * exists but carries no catalog.
 */
async function bundledInterfaceCatalog(
  repoKey: string,
  ref?: string,
): Promise<InterfacesFile | null | undefined> {
  const bundle = await loadGuardSetupBundle(repoKey, ref)
  if (!bundle) return undefined
  const derived = parseInterfacesFile(bundle[GUARD_SETUP_INTERFACES_FILE])
  const authored = parseInterfacesFile(bundle[GUARD_SETUP_AUTHORED_INTERFACES_FILE])
  if (!derived && !authored) return null
  return mergeInterfaceCatalogs(derived, authored)
}

function parseInterfacesFile(text: string | undefined): InterfacesFile | null {
  if (text === undefined) return null
  try {
    const parsed = InterfacesFileSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Which flows use each interface, and which scenarios ground on it.
 *
 * Usage is the UNION of two records, because either alone lies:
 *  - the manifest's per-flow realization record — what the PLAN referenced,
 *    written for authored AND blocked surfaces alike. This is the only trace a
 *    matched-but-unauthored flow leaves, and without it an interface the spec
 *    plainly reaches reads as "no flow uses this";
 *  - the committed scenarios' own grounding path — what actually got written.
 *    Also the FALLBACK for manifests written before the plan record existed, and
 *    the only source for hand-written scenarios (no manifest flow at all).
 *
 * A flow present in both is `realized`; a flow only the plan knows is not, and
 * carries the gap for the planning surface that explains what it waits on.
 */
function interfaceReverseIndex(
  corpus: GuardCorpusForView | null,
  flowsFile: GuardFlowsFile | null,
): { flowRefs: Map<string, GuardInterfaceFlowRef[]>; scenarioIdsByInterface: Map<string, string[]> } {
  const titleByFlow = new Map((flowsFile?.flows ?? []).map((f) => [f.id, f.title]))
  const manifestFlows = corpus?.manifest?.flows ?? []
  const ownerByScenario = new Map<string, string>()
  for (const flow of manifestFlows) {
    for (const s of flow.scenarios) ownerByScenario.set(s.id, flow.flowId)
  }

  // interfaceId → flowId → the ref being assembled.
  const byInterface = new Map<string, Map<string, GuardInterfaceFlowRef>>()
  const refFor = (interfaceId: string, flowId: string): GuardInterfaceFlowRef => {
    let flows = byInterface.get(interfaceId)
    if (!flows) byInterface.set(interfaceId, (flows = new Map()))
    let ref = flows.get(flowId)
    if (!ref) flows.set(flowId, (ref = { flowId, title: titleByFlow.get(flowId) ?? flowId, realized: false }))
    return ref
  }

  for (const flow of manifestFlows) {
    for (const planned of flow.journeys) {
      // The gap for the surface that planned it — what a blocked usage is waiting on.
      const gap = flow.gaps.find((g) => g.surface === planned.surface)
      for (const interfaceId of planned.journeyIds) {
        const ref = refFor(interfaceId, flow.flowId)
        if (gap && !ref.gap) ref.gap = toFlowGap(gap)
      }
    }
  }

  const scenarioIdsByInterface = new Map<string, string[]>()
  for (const scenario of corpus?.scenarios ?? []) {
    const flowId = scenario.flow?.id ?? ownerByScenario.get(scenario.id) ?? manualFlowId(scenario.id)
    // A scenario committed before the interface rename carries its grounding
    // under `journey`; either spelling is the same path.
    for (const interfaceId of (scenario.interface ?? scenario.journey)?.path ?? []) {
      const ref = refFor(interfaceId, flowId)
      ref.realized = true
      delete ref.gap
      const ids = scenarioIdsByInterface.get(interfaceId) ?? []
      if (!ids.includes(scenario.id)) ids.push(scenario.id)
      scenarioIdsByInterface.set(interfaceId, ids)
    }
  }

  const flowRefs = new Map<string, GuardInterfaceFlowRef[]>()
  for (const [interfaceId, flows] of byInterface) {
    flowRefs.set(
      interfaceId,
      [...flows.values()].sort((a, b) => a.flowId.localeCompare(b.flowId)),
    )
  }
  return { flowRefs, scenarioIdsByInterface }
}

/**
 * The detected-surface banner: one row per driver-registry surface, registry order.
 *
 * `source` is carried ONLY where a derivation ran, and the merged catalog keeps the
 * derived half's map verbatim rather than inventing a value for the authored half —
 * `source` answers "which ladder derived this area", which a hand-written area has
 * no answer to. So a sourceless row is read together with its interface count:
 * sourceless with interfaces is a surface a human wrote; sourceless with NONE is a
 * derivation that found nothing. Inside a mixed area the exact answer is per row
 * (`origin`), because one area can hold both.
 *
 * A surface is DETECTED when either half of it was found. A web surface can be all
 * places and no interfaces — a mapped web app has a screen per address and no
 * tasks at all, because tasks are authored and places are derived. Judging the row
 * on its interface count alone would report a repo whose every screen was just
 * derived as one where nothing was found.
 */
function interfaceSurfaces(
  countByType: ReadonlyMap<string, number>,
  source: Record<string, InterfaceCatalogSource> | undefined,
  resourcesByArea: Record<string, readonly unknown[]> | undefined,
): GuardInterfaceSurface[] {
  return GUARD_DRIVERS.map((row) => {
    const driver: GuardDriverDef = row
    const interfaces = countByType.get(driver.id) ?? 0
    const resources = resourcesByArea?.[driver.id]?.length ?? 0
    return {
      surface: driver.id as GuardDriverId,
      label: driver.label,
      runnable: driver.runnable,
      ...(driver.waitingLabel ? { waitingLabel: driver.waitingLabel } : {}),
      interfaces,
      resources,
      detected: interfaces > 0 || resources > 0,
      ...(source?.[driver.id] ? { source: source[driver.id] } : {}),
    }
  })
}

// ---------------------------------------------------------------------------
// Raw artifact slices — the second reading an artifact-backed entity offers.
// ---------------------------------------------------------------------------

/**
 * Pick ONE entry out of a store file's array by its `id` and pretty-print it.
 *
 * The file text is parsed as plain JSON, never through its Zod schema: the raw
 * reading must be what is actually STORED, so a field the schema would strip
 * still reaches the reader. A file that does not parse, or that holds no entry
 * with this id, is `null` — the surface says so rather than showing an empty
 * block. The id never touches a path (it selects inside an already-read file), so
 * these reads add no traversal surface to the store seams they go through.
 */
function artifactSlice(
  raw: string | null,
  file: string,
  key: 'interfaces' | 'dependencies',
  id: string,
  idField: 'id' | 'name' = 'id',
): GuardArtifactSource | null {
  if (raw == null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const entries = (parsed as Record<string, unknown> | null)?.[key]
  if (!Array.isArray(entries)) return null
  const entry = entries.find((e) => (e as Record<string, unknown> | null)?.[idField] === id)
  if (entry === undefined) return null
  return { id, file, content: JSON.stringify(entry, null, 2) }
}

/**
 * One catalog entry, sliced out of the committed `scenarios/dependencies.json`
 * by its name — the raw half of the Dependencies detail. A working tree reads
 * the file; a hosted repo reads it out of the setup bundle (`ref` pins a
 * commit, else the newest). The gitignored instance overlay is never part of
 * this reading: the catalog declares, the overlay holds the values.
 */
export async function readGuardDependencyRaw(
  repoKey: string,
  name: string,
  ref?: string,
): Promise<GuardArtifactSource | null> {
  const rel = path.relative(repoKey, dependenciesPath(repoKey)).split(path.sep).join('/')
  const raw = guardsMaterializeInPlace()
    ? readFileTextOr(dependenciesPath(repoKey))
    : ((await loadGuardSetupBundle(repoKey, ref))?.[GUARD_SETUP_DEPENDENCIES_FILE] ?? null)
  return artifactSlice(raw, rel, 'dependencies', name, 'name')
}

/**
 * One interface's entry, sliced out of WHICHEVER half of the catalog holds it —
 * the derived `guard/interfaces.json` or the committed
 * `guard/interfaces.authored.json`.
 *
 * The file is resolved first and only then sliced, rather than the merge being
 * serialized back out: this reading exists to show the bytes that are actually on
 * disk, so a reader sees a real file at a real path (the `file` label is what they
 * would open) and none of the fields the merge stamps on top — `origin` in
 * particular is computed, and a raw view that showed it would be showing a field
 * no file contains. The authored half is looked at LAST for the same reason it wins
 * the merge: where both name one id, it is the entry the view beside this one
 * rendered.
 *
 * Both halves live in the working tree, so a hosted repo has no file to show and
 * answers `null`, exactly as {@link readGuardInterfaces} reports `no-working-tree`.
 */
export async function readGuardInterfaceRaw(
  repoKey: string,
  id: string,
): Promise<GuardArtifactSource | null> {
  if (!guardsMaterializeInPlace()) return null
  const halves: [string, () => string | null][] = [
    [guardInterfacesPath(repoKey), () => readInterfaceCatalogRaw(repoKey)],
    [guardAuthoredInterfacesPath(repoKey), () => readFileTextOr(guardAuthoredInterfacesPath(repoKey))],
  ]
  let found: GuardArtifactSource | null = null
  for (const [file, read] of halves) {
    const rel = path.relative(repoKey, file).split(path.sep).join('/')
    found = artifactSlice(read(), rel, 'interfaces', id) ?? found
  }
  return found
}

/** A file's text, or `null` when it is absent or unreadable — a raw reading never
 *  fails a view, it simply has nothing to show. */
function readFileTextOr(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

/** The empty Interfaces payload — banner present, lists empty (the Map CTA state). */
function emptyInterfacesView(): GuardInterfacesView {
  return {
    mapped: false,
    generatedAt: null,
    recipeFingerprint: null,
    interfaces: [],
    surfaces: interfaceSurfaces(new Map(), undefined, undefined),
    totals: { interfaces: 0, detectedSurfaces: 0, grounded: 0, ungrounded: 0 },
  }
}

/**
 * `doc\0anchor` → the section's human heading text, from each live doc's section
 * index (the same index `composeDocCoverage` joins heading texts from) — slugs
 * are engine identifiers, not UI copy. A doc that no longer exists, escapes the
 * repo, or lost the section contributes nothing (the row carries no headingText).
 */
async function headingTextIndex(
  repoKey: string,
  docs: readonly string[],
  commit?: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const [doc, index] of await docSectionIndexes(repoKey, docs, commit)) {
    for (const sec of index.sections) map.set(`${doc}\0${sec.anchor}`, sec.headingText)
  }
  return map
}

/**
 * `doc` → its LIVE section index, for the joins that need more than the heading
 * (a milestone's live/gone state and the current section fingerprint). Reads go
 * through the `readRepoDoc` seam (FS in OSS, GitHub in EE) at `commit` — never
 * `fs` directly, so a hosted repo joins with no working tree. A doc that escapes
 * the repo or no longer exists contributes no entry (tolerant by design).
 */
async function docSectionIndexes(
  repoKey: string,
  docs: readonly string[],
  commit?: string,
): Promise<Map<string, DocSectionIndex>> {
  const map = new Map<string, DocSectionIndex>()
  for (const doc of new Set(docs)) {
    // Confine to the repo tree — no traversal (mirrors the coverage route's guard).
    if (path.isAbsolute(doc) || doc.split(/[\\/]/).includes('..')) continue
    const content = await readRepoDoc(repoKey, doc, commit ? { commit } : undefined)
    if (content == null) continue
    map.set(doc, buildDocSectionIndex(doc, content))
  }
  return map
}

/**
 * The last-generate report for the DASHBOARD, with each birth-stage failure result
 * enriched with its section's human `headingText` — joined at read time from the
 * live doc's section index (the same `headingTextIndex` join `listGuardScenarios`
 * uses). Without this server join every group header degrades to a slug — and slugs
 * are never UI copy. `result.json` on disk carries no `headingText`; the enrichment
 * is read-side only. A doc/section that is gone contributes no key (tolerant).
 */
export async function readGuardReport(repoKey: string, ref?: string): Promise<GuardGenerateReport | null> {
  const scope = await resolveGuardScope(repoKey, ref)
  if (scope.kind === 'empty') return null
  let commit = scope.commit
  let report = await readGuardResultStore(repoKey, commit)
  // A pinned PR head that never generated falls back to the BASELINE report —
  // the generate its gate-run scenarios came from (never "newest"; the PR-view
  // analogue of the spec route's corpus fallback). Heading joins follow `commit`
  // so they read the docs the report's sections actually live in.
  if (!report && scope.kind === 'commit' && ref !== undefined) {
    const base = await guardBaselineCommit(repoKey)
    if (base !== undefined && base !== commit) {
      const fromBase = await readGuardResultStore(repoKey, base)
      if (fromBase) {
        report = fromBase
        commit = base
      }
    }
  }
  if (!report) return report
  const held = report.heldSections ?? []
  // A held section is unsettled by definition, so — like a finding — no committed
  // scenario donates its heading client-side; join it server-side the same way.
  if (report.birthFindings.length === 0 && held.length === 0) return report
  const headingByDocAnchor = await headingTextIndex(repoKey, [
    ...report.birthFindings.map((f) => f.doc),
    ...held.map((h) => h.doc),
  ], commit)
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
 * PR-view read policy for a GENERATE-side artifact (manifest / generate result):
 * no ref → the repo-level view, resolved through `resolveGuardScope` like every
 * other reader (OSS reads the live store; hosted reads the baseline commit's row,
 * or absent when no baseline exists yet — never the store's newest row, which a
 * PR's regenerated corpus would shadow); a pinned PR head → that commit's row,
 * falling back — on a head miss — to the BASELINE commit's row (the set the gate
 * actually executed against the head; never "newest by createdAt"). Run reads
 * never route through this — a PR head's run is its own.
 */
async function readPinnedWithBaselineFallback<T>(
  repoKey: string,
  ref: string | undefined,
  load: (commit?: string) => Promise<T | null>,
): Promise<T | null> {
  if (ref === undefined) {
    const scope = await resolveGuardScope(repoKey)
    if (scope.kind === 'empty') return null
    return load(scope.commit)
  }
  const value = await load(ref)
  if (value != null || guardsMaterializeInPlace()) return value
  const base = await guardBaselineCommit(repoKey)
  if (base === undefined || base === ref) return value
  return load(base)
}

/** The manifest a (possibly PR-scoped) guard view joins classifications from. */
export function readManifestForView(repoKey: string, ref?: string): Promise<GuardManifest | null> {
  return readPinnedWithBaselineFallback(repoKey, ref, (c) => readManifestStore(repoKey, c))
}

/** The raw last-generate result a (possibly PR-scoped) guard view paints from. */
export function readGuardResultForView(repoKey: string, ref?: string): Promise<GuardGenerateReport | null> {
  return readPinnedWithBaselineFallback(repoKey, ref, (c) => readGuardResultStore(repoKey, c))
}

/**
 * The preparation-recipe card, or `null` when no (valid) `recipe.json` exists.
 * OSS: `stale` compares the current discovery-input fingerprint (a working-tree
 * hash) to the last run's recorded `recipeFingerprint` — `null` when no run.
 * Hosted: there is NO working tree to fingerprint, so the comparison is
 * unknowable — `stale` is always `null` (never a false "recipe changed"
 * warning), and the informational fingerprint is the resolved ref's run-recorded
 * one (empty when that ref never ran). The recipe content itself always comes
 * from the store at the resolved commit. An invalid `recipe.json` reads as
 * absent (the card is informational).
 */
export async function readGuardRecipeCard(repoKey: string, commit?: string): Promise<GuardRecipeCard | null> {
  const raw = await readRecipeRaw(repoKey, commit)
  if (raw == null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = RecipeSchema.safeParse(parsed)
  if (!result.success) return null
  const recipe = result.data
  // Both recipe shapes read through the one resolver, so `serve` is the
  // DEFAULT server's argv either way and a multi-server recipe additionally lists
  // every service it declares.
  const resolvedServers = resolveApiServers(recipe);
  const servers = [...resolvedServers.servers.values()].map((s) => ({
    name: s.name,
    serve: [...s.serve],
    ...(s.app ? { app: s.app } : {}),
  }));
  const card = {
    build: recipe.build,
    entry: recipe.entry ? recipe.entry.slice() : null,
    serve: recipe.api
      ? [...(resolvedServers.servers.get(resolvedServers.defaultServer)?.serve ?? [])]
      : null,
    servers: servers.length > 1 ? servers : null,
    services: recipe.api?.services
      ? { up: recipe.api.services.up, ...(recipe.api.services.down ? { down: recipe.api.services.down } : {}) }
      : null,
    env: recipe.env ?? null,
  }
  if (!guardsMaterializeInPlace()) {
    const run = await readGuardRunForView(repoKey, commit)
    return { ...card, fingerprint: run?.run.recipeFingerprint ?? '', stale: null }
  }
  const fingerprint = computeRecipeFingerprint(repoKey)
  const latest = await readGuardLatestStore(repoKey)
  return {
    ...card,
    fingerprint,
    stale: latest ? fingerprint !== latest.run.recipeFingerprint : null,
  }
}

/** Map each committed scenario id → its repo-relative YAML path (first sorted file wins, matching the loader's dedup). */
async function scenarioFilesById(repoKey: string, commit?: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const rel of await listScenarioFiles(repoKey, commit)) {
    const content = await readScenarioFile(repoKey, rel, commit)
    if (content == null) continue
    let parsed: unknown
    try {
      parsed = yaml.load(content)
    } catch {
      continue
    }
    const id = (parsed as { id?: unknown } | null)?.id
    if (typeof id === 'string' && !map.has(id)) map.set(id, rel)
  }
  return map
}

// ---------------------------------------------------------------------------
// Traversal-safe store reads.
// ---------------------------------------------------------------------------

/** Read + validate a past run snapshot, or `null` when the id is unsafe or absent. */
export function readGuardRun(repoRoot: string, runId: string): Promise<GuardLatest | null> {
  return readGuardRunStore(repoRoot, runId)
}

/**
 * The run a (possibly PR-scoped) guard view paints from: with `ref` (a PR head),
 * the run stored at exactly THAT commit — never the baseline (a PR view must not
 * show baseline data); without one, the repo baseline. The shared read behind
 * the `/status`, `/latest`, and `/coverage` routes and the hosted recipe card.
 */
export function readGuardRunForView(repoKey: string, ref?: string): Promise<GuardLatest | null> {
  return ref ? readGuardRunForCommitStore(repoKey, ref) : readGuardLatestStore(repoKey)
}

/**
 * The PR run timeline — one entry per pushed head the gate ran, oldest-first
 * (the GuardHistory convention; the panel orders for display). Heads come from
 * the gate-heads seam (EE installs it; unset ⇒ empty, the OSS answer) and join
 * to the run stored at each head; a head whose gate never stored a run (errored
 * before the run landed) is skipped — the list holds only selectable runs.
 * Baseline runs never appear: they are not this PR's heads.
 */
export async function readGuardHistoryForPr(repoKey: string, pr: number): Promise<GuardHistory> {
  const lookup = getGuardGateHeadsLookup()
  if (!lookup) return { runs: [] }
  const runs: GuardHistoryEntry[] = []
  for (const head of new Set(await lookup(repoKey, pr))) {
    const run = await readGuardRunForCommitStore(repoKey, head)
    if (!run) continue
    runs.push({
      runId: run.run.runId,
      ranAt: run.run.ranAt,
      branch: run.run.branch,
      commit: run.run.commit,
      summary: run.summary,
    })
  }
  runs.sort((a, b) => a.ranAt.localeCompare(b.ranAt))
  return { runs }
}

/** Find a committed scenario by id and return its raw YAML source, or `null`. */
export async function readGuardScenarioSource(
  repoKey: string,
  id: string,
  ref?: string,
): Promise<GuardScenarioSource | null> {
  const scope = await resolveGuardScope(repoKey, ref)
  if (scope.kind === 'empty') return null
  const commit = scope.commit
  for (const rel of await listScenarioFiles(repoKey, commit)) {
    const raw = await readScenarioFile(repoKey, rel, commit)
    if (raw == null) continue
    let parsed: unknown
    try {
      parsed = yaml.load(raw)
    } catch {
      continue
    }
    if (parsed && typeof parsed === 'object' && (parsed as { id?: unknown }).id === id) {
      // The two renderings the detail offers — the structural step list and the
      // plain-words story — both derived HERE from the one parsed file, so a
      // reader's story can never describe a step the step list does not have.
      const steps = describeGuardScenarioSteps(parsed)
      const story = describeGuardScenario(parsed)
      const driver = (parsed as { driver?: GuardDriverId }).driver
      return { id, file: rel, content: raw, ...(driver ? { driver } : {}), steps, ...(story ? { story } : {}) }
    }
  }
  return null
}

/**
 * Read one evidence file for a failed scenario. `runId` and `file` are charset-
 * validated by the store (no separators, no `..`), `scenarioId` is sanitized into a
 * dir name, and the resolved path is confined to the run's evidence dir. Returns
 * `null` for an unsafe segment or a missing file.
 */
export function readGuardEvidence(
  repoRoot: string,
  runId: string,
  scenarioId: string,
  file = 'transcript.txt',
): Promise<string | null> {
  return readGuardEvidenceStore(repoRoot, runId, scenarioId, file)
}

/**
 * Read one evidence file addressed by its repo-relative evidence DIRECTORY (a birth
 * finding's `evidencePath`, `.truecourse/guard/evidence/<runId>/<scenarioId>`) — the
 * `readGuardEvidence` sibling for findings, which store the whole pointer rather
 * than a run id. The store confines the read to the guard evidence root, so a
 * `../`-laced `evidenceDir` can never escape it. Returns `null` for an unsafe
 * segment, a path outside the evidence root, or a missing file.
 */
export function readGuardEvidenceAt(
  repoRoot: string,
  evidenceDir: string,
  file = 'transcript.txt',
): Promise<string | null> {
  return readGuardEvidenceAtStore(repoRoot, evidenceDir, file)
}

// ---------------------------------------------------------------------------
// Decisions — dismiss/undismiss (composition over the store) + PR overlay API.
// ---------------------------------------------------------------------------

/**
 * Add a dismissal (idempotent on doc+anchor+title identity — a re-dismiss refreshes
 * `dismissedAt`/`note` in place, never duplicates), returning the updated file. With
 * `opts.pr` the write targets the PR overlay scope ONLY (enterprise-only — the OSS
 * file store rejects it): inherited repo dismissals are never read into or copied
 * onto the overlay, so the merged view is the caller's job (see {@link getGuardDecisions}).
 */
export async function dismissGuardClaim(
  repoRoot: string,
  claim: GuardDismissedClaim,
  opts?: { pr?: number },
): Promise<GuardDecisions> {
  assertNoGuardPrInPlace(opts?.pr)
  const scope = opts?.pr !== undefined ? prGuardDecisionsRef(opts.pr) : undefined
  const decisions = await readGuardDecisionsStore(repoRoot, scope)
  const key = dismissedClaimKey(claim.doc, claim.anchor, claim.title)
  const dismissedClaims = decisions.dismissedClaims.filter(
    (d) => dismissedClaimKey(d.doc, d.anchor, d.title) !== key,
  )
  dismissedClaims.push(claim)
  const next: GuardDecisions = { ...decisions, dismissedClaims }
  await writeGuardDecisionsStore(repoRoot, next, scope)
  return next
}

/**
 * Remove a dismissal by identity (no-op when absent), returning the updated file.
 * With `opts.pr` the read+write target the PR overlay scope ONLY (enterprise-only —
 * the OSS file store rejects it), never the merged view. Un-dismissing a claim that
 * was dismissed at the repo scope is therefore a no-op on the overlay: the merged
 * view still shows it dismissed. Accepted v1 behavior.
 */
export async function undismissGuardClaim(
  repoRoot: string,
  identity: GuardClaimIdentity,
  opts?: { pr?: number },
): Promise<GuardDecisions> {
  assertNoGuardPrInPlace(opts?.pr)
  const scope = opts?.pr !== undefined ? prGuardDecisionsRef(opts.pr) : undefined
  const decisions = await readGuardDecisionsStore(repoRoot, scope)
  const key = dismissedClaimKey(identity.doc, identity.anchor, identity.title)
  const next: GuardDecisions = {
    ...decisions,
    dismissedClaims: decisions.dismissedClaims.filter(
      (d) => dismissedClaimKey(d.doc, d.anchor, d.title) !== key,
    ),
  }
  await writeGuardDecisionsStore(repoRoot, next, scope)
  return next
}

/**
 * Add a FLOW dismissal (idempotent on `flowId` — a re-dismiss refreshes `title`,
 * `dismissedAt` and `note` in place, never duplicates), returning the updated file.
 * The next `guard generate` drops the flow whole, with its scenarios, and settles
 * it as an explicit `dismissed` coverage gap; this write does not touch the current
 * report. The FLOW is the manual dismissal unit — a generated test's identity moves
 * on regenerate, so dismissing one would silently stop matching. `opts.pr` scopes
 * the write exactly as it does for a claim (enterprise-only).
 */
export async function dismissGuardFlow(
  repoRoot: string,
  flow: GuardDismissedFlow,
  opts?: { pr?: number },
): Promise<GuardDecisions> {
  assertNoGuardPrInPlace(opts?.pr)
  const scope = opts?.pr !== undefined ? prGuardDecisionsRef(opts.pr) : undefined
  const decisions = await readGuardDecisionsStore(repoRoot, scope)
  const dismissedFlows = decisions.dismissedFlows.filter((d) => d.flowId !== flow.flowId)
  dismissedFlows.push(flow)
  const next: GuardDecisions = { ...decisions, dismissedFlows }
  await writeGuardDecisionsStore(repoRoot, next, scope)
  return next
}

/**
 * Remove a flow dismissal by its `flowId` (no-op when absent), returning the
 * updated file. With `opts.pr` the read+write target the PR overlay ONLY, so a
 * repo-scope dismissal survives the merged view — the same accepted v1 behavior
 * {@link undismissGuardClaim} documents.
 */
export async function undismissGuardFlow(
  repoRoot: string,
  flowId: string,
  opts?: { pr?: number },
): Promise<GuardDecisions> {
  assertNoGuardPrInPlace(opts?.pr)
  const scope = opts?.pr !== undefined ? prGuardDecisionsRef(opts.pr) : undefined
  const decisions = await readGuardDecisionsStore(repoRoot, scope)
  const next: GuardDecisions = {
    ...decisions,
    dismissedFlows: decisions.dismissedFlows.filter((d) => d.flowId !== flowId),
  }
  await writeGuardDecisionsStore(repoRoot, next, scope)
  return next
}

/** The PR-overlay sentinel scope for guard decisions (`_pr/<number>`, EE-only).
 *  Exported so the EE gate/regen paths read the same overlay the writes target. */
export const prGuardDecisionsRef = (pr: number): string => `_pr/${pr}`

/** PR-scoped decisions live only in EE — a live-tree (OSS) store can't hold them. */
function assertNoGuardPrInPlace(pr?: number): void {
  if (pr !== undefined && guardsMaterializeInPlace()) {
    throw new Error('[guard] PR-scoped guard decisions require the enterprise store')
  }
}

/**
 * Merge a PR's guard decisions overlay over the repo row. Pure. `dismissedClaims`
 * union by their `dismissedClaimKey` identity (doc+anchor+title) and
 * `dismissedFlows` by their `flowId`; the overlay wins on a colliding identity.
 */
export function mergeGuardDecisions(base: GuardDecisions, overlay: GuardDecisions): GuardDecisions {
  const byKey = new Map<string, GuardDismissedClaim>()
  for (const c of base.dismissedClaims) byKey.set(dismissedClaimKey(c.doc, c.anchor, c.title), c)
  for (const c of overlay.dismissedClaims) byKey.set(dismissedClaimKey(c.doc, c.anchor, c.title), c)
  const flowsById = new Map<string, GuardDismissedFlow>()
  for (const f of base.dismissedFlows) flowsById.set(f.flowId, f)
  for (const f of overlay.dismissedFlows) flowsById.set(f.flowId, f)
  return {
    version: 1,
    dismissedClaims: [...byKey.values()],
    dismissedFlows: [...flowsById.values()],
  }
}

/**
 * The repo's current guard decisions (dashboard read) — file in OSS, Postgres in
 * EE. With `pr`, returns the effective decisions for that PR: the repo row merged
 * with the PR's overlay (the overlay wins — see {@link mergeGuardDecisions}). A PR
 * scope is enterprise-only; the OSS file store rejects it.
 */
export async function getGuardDecisions(
  repoRoot: string,
  opts?: { pr?: number },
): Promise<GuardDecisions> {
  if (opts?.pr === undefined) return readGuardDecisionsStore(repoRoot)
  assertNoGuardPrInPlace(opts.pr)
  const [base, overlay] = await Promise.all([
    readGuardDecisionsStore(repoRoot),
    readGuardDecisionsStore(repoRoot, prGuardDecisionsRef(opts.pr)),
  ])
  return mergeGuardDecisions(base, overlay)
}

/**
 * Promote a PR's guard decisions overlay onto the repo row on merge. Idempotent:
 * an empty overlay returns false and does nothing; otherwise merges the overlay
 * onto the repo row, persists it, drops the overlay, and returns true. EE-only.
 */
export async function promoteGuardDecisionsOverlay(repoRoot: string, pr: number): Promise<boolean> {
  assertNoGuardPrInPlace(pr)
  const overlay = await readGuardDecisionsStore(repoRoot, prGuardDecisionsRef(pr))
  if (overlay.dismissedClaims.length === 0) return false
  const merged = mergeGuardDecisions(await readGuardDecisionsStore(repoRoot), overlay)
  await writeGuardDecisionsStore(repoRoot, merged)
  await deleteGuardDecisionsStore(repoRoot, prGuardDecisionsRef(pr))
  return true
}

/** Discard a PR's guard decisions overlay (unmerged close). Idempotent. EE-only. */
export async function discardGuardDecisionsOverlay(repoRoot: string, pr: number): Promise<void> {
  assertNoGuardPrInPlace(pr)
  await deleteGuardDecisionsStore(repoRoot, prGuardDecisionsRef(pr))
}

// ---------------------------------------------------------------------------
// Staleness (mtime probe) — the two amber-dot signals for the Guard tab.
// ---------------------------------------------------------------------------

/**
 * Compute the guard staleness signals (the two amber dots). OSS reads store mtimes
 * off the working tree (unchanged); EE composes the same shape from store reads at
 * the same ref (a PR head, or the baseline) — no filesystem, no mtimes. `generateStale`:
 * spec corpus present but never generated. `runStale`: scenarios present but never
 * run, OR the generate is newer than the run (regenerated scenarios not yet re-run).
 */
export async function computeGuardStaleness(repoKey: string, ref?: string): Promise<GuardStaleness> {
  const scope = await resolveGuardScope(repoKey, ref)
  if (scope.kind === 'live') return fileGuardStaleness(repoKey)
  // Hosted with nothing resolvable: nothing is established — all-false, never
  // a probe against the store's newest set.
  if (scope.kind === 'empty') return EMPTY_STALENESS
  return storeGuardStaleness(repoKey, scope.commit, ref !== undefined)
}

const EMPTY_STALENESS: GuardStaleness = {
  generateStale: false,
  runStale: false,
  hasCorpus: false,
  hasScenarios: false,
  hasGenerated: false,
  hasRun: false,
}

/**
 * Hosted (Pg store) staleness — composed from store reads at the resolved commit
 * (the PR head, else the baseline). Presence + a generate-vs-run timestamp
 * compare; no working tree, no mtimes. With an explicit ref (`refPinned`), the
 * run presence is decided by THAT commit's row alone — no baseline-run fallback
 * (a never-run PR head must report hasRun:false, agreeing with `/latest?ref=`);
 * the repo-level view (baseline commit) may still fall back to the baseline row
 * (a guard run recorded at a different commit than the verify baseline).
 *
 * The GENERATE-side stores (corpus / manifest / scenario files / result) DO fall
 * back — per store — from a pinned PR head to the baseline commit: a gate run
 * executes the baseline's scenario set against the head, so those inputs ARE
 * established for the PR view even though nothing re-persisted them at the head
 * (a code-only PR). Never "newest by createdAt" — only the explicit baseline.
 */
async function storeGuardStaleness(
  repoKey: string,
  commit: string,
  refPinned: boolean,
): Promise<GuardStaleness> {
  const [result, manifest, corpus, runAtCommit, baseline, scenarioFiles] = await Promise.all([
    readGuardResultStore(repoKey, commit),
    readManifestStore(repoKey, commit),
    loadSpec(({ repoKey, commitSha: commit }), 'corpus'),
    readGuardRunForCommitStore(repoKey, commit),
    refPinned ? Promise.resolve(null) : readGuardLatestStore(repoKey),
    listScenarioFiles(repoKey, commit),
  ])
  const base = refPinned ? await guardBaselineCommit(repoKey) : undefined
  const fallback = base !== undefined && base !== commit
  const [resultF, manifestF, corpusF, scenarioFilesF] = await Promise.all([
    fallback && result == null ? readGuardResultStore(repoKey, base) : Promise.resolve(result),
    fallback && manifest == null ? readManifestStore(repoKey, base) : Promise.resolve(manifest),
    fallback && corpus == null ? loadSpec({ repoKey, commitSha: base }, 'corpus') : Promise.resolve(corpus),
    fallback && scenarioFiles.length === 0 ? listScenarioFiles(repoKey, base) : Promise.resolve(scenarioFiles),
  ])
  const run = runAtCommit ?? baseline
  const hasCorpus = corpusF != null
  const hasScenarios = (manifestF?.flows?.length ?? 0) > 0 || scenarioFilesF.length > 0
  const hasGenerated = resultF != null
  const hasRun = run != null
  const generatedAt = resultF?.generatedAt ?? null
  const ranAt = run?.run.ranAt ?? null
  return {
    generateStale: hasCorpus && !hasGenerated,
    runStale:
      hasScenarios && (!hasRun || (generatedAt != null && ranAt != null && generatedAt > ranAt)),
    hasCorpus,
    hasScenarios,
    hasGenerated,
    hasRun,
  }
}

/** OSS (file store) staleness — store mtimes off the working tree (unchanged). */
function fileGuardStaleness(repoRoot: string): GuardStaleness {
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
