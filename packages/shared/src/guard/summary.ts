/**
 * Pure, LLM-free composition for the guard read surfaces (`guard status`,
 * `guard drifts`, the dashboard). ONE copy, imported by core, the CLI, and the
 * client alike — no mirrored twins. No I/O here: the caller reads
 * `scenarios/manifest.json`, `guard/LATEST.json`, and `guard/result.json`; these
 * functions only shape the parsed structures.
 *
 * Driver-scoped tallies (`classification`, `coverageGapsByKind`) are keyed off the
 * driver registry, so a new driver joins the counts by adding a registry row.
 */

import {
  awaitingDriverIds,
  guardDriverIds,
  type GuardDriverId,
} from './drivers.js'
import {
  emptyGapDisplayTotals,
  gapDisplayKind,
  guardErrorSubject,
  isGuardAdjudicationError,
  parseBlockedOnCapabilities,
  type GuardCoverageGapKind,
  type GuardGapDisplayKind,
  type GuardGenerateReport,
  type GuardGenerateUsage,
  type GuardUnadjudicatedStage,
} from './report.js'
import type { StageTransportTally } from '../llm/tally.js'
import {
  guardManifestSections,
  unaccountedSurfaces,
  type GuardManifest,
  type GuardManifestFlow,
  type GuardManifestGap,
} from './manifest.js'
import type {
  GuardLatest,
  GuardOutcome,
  GuardScenarioResult,
  GuardSummary,
} from './result.js'

/**
 * Flow-coverage rollup from the flow-keyed manifest — the FLOW is the generation
 * unit, so this is the headline count the `guard status` flows line renders.
 * `guarded` + `partial` + `blocked` = `total`.
 */
export interface GuardFlowsCoverageSummary {
  /** Flows the manifest recorded. */
  total: number
  /** Flows whose every target surface settled into a scenario — no gaps left. */
  guarded: number
  /** Flows realized on some surface but not others (≥1 scenario AND ≥1 gap). */
  partial: number
  /** Flows with no scenario at all — every surface ended in a gap (or none was tried). */
  blocked: number
  /** The gap labels behind the partial/blocked flows, most common first (top 3). */
  gapLabels: string[]
}

/** One reason a flow surface has no scenario, with how many units it explains. */
export interface GuardSettleReason {
  label: string
  count: number
}

/**
 * The settled-vs-unsettled breakdown over FLOW×SURFACE units — the one honest
 * line every closing surface renders, so a run that ends `ok` with untested
 * flows can never read like "nothing pending". A unit is SETTLED when a
 * committed test realizes it (a partial scenario's milestone-scoped sibling gap
 * does not unsettle it — settled-with-gap counts once); every other unit is
 * UNSETTLED with a reason: its gap's label (`blocked-on` gaps aggregate by their
 * parsed capability nouns, a retirement reads `retired`), or — for a flow whose
 * hash is unrecorded and a planned surface has neither test nor gap — the
 * pending-work label (`pending next generate`).
 */
export interface GuardSettleBreakdown {
  /** Flow×surface units the manifest tracks. `settled` + Σ`unsettled` = `total`. */
  total: number
  /** Units realized by a committed test. */
  settled: number
  /** The untested units by reason, most common first (count desc, then label). */
  unsettled: GuardSettleReason[]
}

/** Section-coverage rollup from `scenarios/manifest.json`. */
export interface GuardCoverageSummary {
  /** Sections the manifest's flows bind. */
  totalSections: number
  /** Sections whose flows own at least one scenario. */
  withScenarios: number
  /**
   * Testability-classification counts: one per driver id (registry-derived) plus
   * `untestable` and `unclassified` (recorded without a verdict). Derived from the
   * flows binding each section: a section counts under the driver its flows'
   * scenarios run on, else under the driver an `awaiting-driver` gap names.
   */
  classification: Record<GuardDriverId, number> & { untestable: number; unclassified: number }
  /** The flow-led rollup over the same manifest. */
  flows: GuardFlowsCoverageSummary
  /** The flow×surface settle breakdown over the same manifest. */
  settle: GuardSettleBreakdown
}

/** Last-run rollup from `guard/LATEST.json`. */
export interface GuardLastRunSummary {
  ranAt: string
  branch: string | null
  commit: string | null
  summary: GuardSummary
}

/** Last-generate rollup from `guard/result.json`. */
export interface GuardLastGenerateSummary {
  generatedAt: string
  status: GuardGenerateReport['status']
  noChanges: boolean
  written: number
  /**
   * The written tests split by the status they were committed with — guard commits
   * every authored test, so `testsPassing + testsFailing = written`. A report
   * written before failing tests were committed records no status, so every one of
   * its written rows counts as passing.
   */
  testsPassing: number
  testsFailing: number
  /** Null on older reports written before birth counting existed. */
  birthPassed: number | null
  /** Counts keyed by the flat display kind (awaiting-driver gaps split per driver). */
  coverageGapsByKind: Record<GuardGapDisplayKind, number>
  /** Per-capability tally across the `blocked-on` gaps (e.g. `{ git: 9, db: 3 }`). */
  blockedOnCapabilities: Record<string, number>
  /** Birth-stage failure results — the committed failing tests plus the rejections. */
  birthFindings: number
  /**
   * Fidelity rejections inside `birthFindings`: the candidates a birth PASS still
   * withheld because the reviewer judged the test itself wrong. The rest of
   * `birthFindings` are committed failing tests (already counted in `testsFailing`).
   */
  fidelityRejections: number
  /**
   * Errors that cost WORK — authoring, birth, a run refusal. Adjudication losses
   * are excluded on purpose: they are counted and named by `unreviewedTests` /
   * `untriagedTests` below, and every surface words this one as "nothing was
   * written for these units", which a lost verdict never means.
   */
  errors: number
  /**
   * Green tests whose fidelity review was lost, by name — the suspect class the
   * reviewer exists to catch, shipped with nobody's judgment on it. Empty on a run
   * whose reviews all landed.
   */
  unreviewedTests: string[]
  /** Failing tests whose triage verdict was lost, by name — committed red with no
   *  word on whether the repo or the test is wrong. */
  untriagedTests: string[]
  /**
   * Ready-but-held scenarios: birth-passed candidates a section's unsettled state
   * withheld (the `M` in `N written · M ready but held (F findings · E errors)`).
   * `heldByFindings`/`heldByErrors` are the blockers OF the held sections — the
   * findings/errors that hold those scenarios back (a finding/error in a section
   * with no ready work counts in neither). 0 on older reports (no `heldSections`).
   */
  readyButHeld: number
  heldByFindings: number
  heldByErrors: number
  /**
   * Stages that lost LLM calls, so a partially failed generate never reads as a
   * clean one (and an `llm-failed` abort names the stage that lost everything).
   * Empty when every call landed — or when the report predates the field.
   */
  llmFailures: StageTransportTally[]
  /**
   * The adjudication stages (fidelity / triage) that lost EVERY call, so part of
   * this corpus shipped with no verdict about it. Empty on a run whose verdicts all
   * landed — or on a report written before the field existed.
   */
  unadjudicated: GuardUnadjudicatedStage[]
  usage?: GuardGenerateUsage
}

export interface GuardStatusSummary {
  coverage: GuardCoverageSummary | null
  lastRun: GuardLastRunSummary | null
  lastGenerate: GuardLastGenerateSummary | null
}

/** Compose the three store reads into the compact status summary. */
export function composeGuardStatus(
  manifest: GuardManifest | null,
  latest: GuardLatest | null,
  result: GuardGenerateReport | null,
): GuardStatusSummary {
  return {
    coverage: manifest ? summarizeCoverage(manifest) : null,
    lastRun: latest
      ? { ranAt: latest.run.ranAt, branch: latest.run.branch, commit: latest.run.commit, summary: latest.summary }
      : null,
    lastGenerate: result ? summarizeGenerate(result) : null,
  }
}

/** A zeroed per-driver classification record (plus untestable + unclassified). */
function emptyClassification(): GuardCoverageSummary['classification'] {
  const byDriver = {} as Record<GuardDriverId, number>
  for (const id of guardDriverIds) byDriver[id] = 0
  return { ...byDriver, untestable: 0, unclassified: 0 }
}

/**
 * One line naming a gap, the SINGLE copy the CLI (`guard flows`, the generate
 * summary, `guard status`) and the dashboard both render: an `awaiting-driver`
 * gap names the driver it waits on, every other kind reads as its own kind with
 * the hyphens spelled out (`no-journey` → `no journey`).
 */
export function guardGapLabel(kind: GuardCoverageGapKind, driver?: GuardDriverId): string {
  if (kind === 'awaiting-driver') return driver ? `awaiting ${driver} driver` : 'awaiting driver'
  return kind.replace(/-/g, ' ')
}

/** {@link guardGapLabel} for a flat DISPLAY kind (awaiting drivers already split out). */
export function guardGapDisplayLabel(kind: GuardGapDisplayKind): string {
  const driver = awaitingDriverIds.find((id) => id === kind)
  return driver ? guardGapLabel('awaiting-driver', driver) : kind.replace(/-/g, ' ')
}

/**
 * What shipped without the verdicts of an adjudication stage that lost EVERY call
 * — ONE copy, rendered verbatim by the CLI generate summary and the dashboard
 * generate overview. Two surfaces wording this independently is exactly how an
 * unreviewed corpus starts reading as a reviewed one on one of them.
 */
export function guardUnadjudicatedEffect(entry: GuardUnadjudicatedStage): string {
  const subjects = `${entry.affected} scenario${entry.affected === 1 ? '' : 's'}`
  return entry.stage === 'guard.fidelity'
    ? `${subjects} persisted passing, never reviewed against their flow`
    : `${subjects} committed failing and untriaged — nothing says whether the repo or the scenario is wrong`
}

/**
 * What the user does about it, said the same way everywhere. The flows are left
 * UNSETTLED for exactly this reason (a settled flow carries its inputs hash and the
 * next generate skips it), and authoring is cached per flow+sections+journeys+recipe,
 * so an unchanged corpus re-adjudicates without paying for authoring again.
 */
export const GUARD_UNADJUDICATED_REMEDY =
  'The scenarios are committed and their flows were left unsettled, so re-running `truecourse guard generate` once the model is reachable adjudicates them — authoring is cached, so the re-run pays for the verdicts, not for writing the scenarios again.'

/** What a section's flows say about the driver it would be tested on. */
interface SectionSurfaces {
  /** Drivers the section's flows actually own a scenario on. */
  scenarios: Set<GuardDriverId>
  /** Drivers an `awaiting-driver` gap on the section's flows waits for. */
  awaiting: Set<GuardDriverId>
  /** True when a flow binding this section settled as untestable / no-claim. */
  untestable: boolean
}

/** The manifest's per-section surface view, keyed `doc\0anchor`. */
function sectionSurfaces(manifest: GuardManifest): Map<string, SectionSurfaces> {
  const bySection = new Map<string, SectionSurfaces>()
  for (const flow of manifest.flows) {
    for (const binding of flow.bindings) {
      const key = `${binding.doc}\0${binding.anchor}`
      let view = bySection.get(key)
      if (!view) {
        view = { scenarios: new Set(), awaiting: new Set(), untestable: false }
        bySection.set(key, view)
      }
      for (const s of flow.scenarios) view.scenarios.add(s.surface)
      for (const gap of flow.gaps) {
        if (gap.kind === 'awaiting-driver' && gap.driver) view.awaiting.add(gap.driver)
        else if (gap.kind === 'untestable' || gap.kind === 'no-claim') view.untestable = true
      }
    }
  }
  return bySection
}

/** The first driver of `candidates` in registry order — the section's primary surface. */
function primaryDriver(candidates: ReadonlySet<GuardDriverId>): GuardDriverId | null {
  for (const id of guardDriverIds) if (candidates.has(id)) return id
  return null
}

/** The reason label for a flow whose surface is pending work (hash unrecorded,
 *  no test and no gap): it re-runs on the next generate. */
const PENDING_SETTLE_LABEL = 'pending next generate'

/** One unsettled unit's reason label — a `blocked-on` gap names its capability
 *  nouns, every other kind reads its shared gap label. */
function settleReasonLabel(gap: GuardManifestGap): string {
  if (gap.kind === 'blocked-on') {
    const caps = parseBlockedOnCapabilities(gap.reason)
    if (caps.length > 0) return `blocked on ${caps.join(' + ')}`
    return 'blocked'
  }
  return guardGapLabel(gap.kind, gap.driver)
}

/**
 * The flow×surface settle breakdown over the manifest — see
 * {@link GuardSettleBreakdown}. Pure and deterministic, so the CLI generate
 * summary, `guard status` and the dashboard compose identical numbers.
 */
export function summarizeFlowSettle(manifest: GuardManifest): GuardSettleBreakdown {
  let settled = 0
  const reasons = new Map<string, number>()
  const bump = (label: string): void => {
    reasons.set(label, (reasons.get(label) ?? 0) + 1)
  }
  for (const flow of manifest.flows) {
    const tested = new Set(flow.scenarios.map((s) => s.surface))
    settled += tested.size
    // One unit per gap-only surface; a gap beside a test on the same surface is
    // partial coverage (settled-with-gap) and never double-counts.
    const gapped = new Set<string>()
    for (const gap of flow.gaps) {
      if (tested.has(gap.surface) || gapped.has(gap.surface)) continue
      gapped.add(gap.surface)
      bump(settleReasonLabel(gap))
    }
    if (flow.generationInputsHash === null) {
      // Pending work: planned surfaces that recorded neither a test nor a gap
      // re-run next generate — and a flow with nothing recorded at all is one
      // pending unit, so it never disappears from the accounting.
      const pending = Math.max(
        unaccountedSurfaces(flow).length,
        tested.size === 0 && gapped.size === 0 ? 1 : 0,
      )
      for (let i = 0; i < pending; i++) bump(PENDING_SETTLE_LABEL)
    }
  }
  const unsettled = [...reasons.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const total = settled + unsettled.reduce((n, r) => n + r.count, 0)
  return { total, settled, unsettled }
}

/**
 * The settle breakdown as the ONE closing line — `37/60 settled · 23 unsettled:
 * 14 blocked on anthropic, 8 blocked on dotnet-sdk, 1 retired`. An all-settled
 * corpus stays terse (`60/60 settled`, no unsettled segment). `extras` (run
 * bookkeeping like `12 unchanged`) slot between the head and the unsettled tail
 * so the reason list always closes the line.
 */
export function guardSettleLine(b: GuardSettleBreakdown, extras: readonly string[] = []): string {
  const head = [`${b.settled}/${b.total} settled`, ...extras].join(' · ')
  const unsettledTotal = b.total - b.settled
  if (unsettledTotal === 0) return head
  const reasons = b.unsettled.map((r) => `${r.count} ${r.label}`).join(', ')
  return `${head} · ${unsettledTotal} unsettled: ${reasons}`
}

function summarizeCoverage(manifest: GuardManifest): GuardCoverageSummary {
  const classification = emptyClassification()
  const sections = guardManifestSections(manifest)
  const surfaces = sectionSurfaces(manifest)
  let withScenarios = 0
  for (const s of sections) {
    if (s.scenarioIds.length > 0) withScenarios++
    // Each section counts ONCE, under the surface that best describes it: the
    // driver its flows' scenarios run on, else the driver they await, else
    // untestable — and `unclassified` only when the flows recorded neither.
    const view = surfaces.get(`${s.doc}\0${s.anchor}`)
    const driver = view && (primaryDriver(view.scenarios) ?? primaryDriver(view.awaiting))
    if (driver) classification[driver]++
    else if (view?.untestable) classification.untestable++
    else classification.unclassified++
  }
  return {
    totalSections: sections.length,
    withScenarios,
    classification,
    flows: summarizeFlows(manifest),
    settle: summarizeFlowSettle(manifest),
  }
}

/** A flow's coverage bucket: fully guarded, partly guarded, or nothing realized. */
function flowBucket(flow: GuardManifestFlow): 'guarded' | 'partial' | 'blocked' {
  if (flow.scenarios.length === 0) return 'blocked'
  return flow.gaps.length === 0 ? 'guarded' : 'partial'
}

function summarizeFlows(manifest: GuardManifest): GuardFlowsCoverageSummary {
  let guarded = 0
  let partial = 0
  let blocked = 0
  const labels = new Map<string, number>()
  for (const flow of manifest.flows) {
    const bucket = flowBucket(flow)
    if (bucket === 'guarded') {
      guarded++
      continue
    }
    if (bucket === 'partial') partial++
    else blocked++
    for (const gap of dedupeGaps(flow.gaps)) {
      const label = guardGapLabel(gap.kind, gap.driver)
      labels.set(label, (labels.get(label) ?? 0) + 1)
    }
  }
  const gapLabels = [...labels.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([label]) => label)
  return { total: manifest.flows.length, guarded, partial, blocked, gapLabels }
}

/** One gap per (kind, driver) — a flow that awaits the same driver twice counts once. */
function dedupeGaps(gaps: readonly GuardManifestGap[]): GuardManifestGap[] {
  const seen = new Map<string, GuardManifestGap>()
  for (const g of gaps) seen.set(`${g.kind}\0${g.driver ?? ''}`, g)
  return [...seen.values()]
}

function summarizeGenerate(r: GuardGenerateReport): GuardLastGenerateSummary {
  const coverageGapsByKind = emptyGapDisplayTotals()
  const blockedOnCapabilities: Record<string, number> = {}
  for (const g of r.coverageGaps) {
    const kind = gapDisplayKind(g)
    if (kind) coverageGapsByKind[kind]++
    if (g.kind === 'blocked-on') {
      for (const cap of parseBlockedOnCapabilities(g.reason)) {
        blockedOnCapabilities[cap] = (blockedOnCapabilities[cap] ?? 0) + 1
      }
    }
  }
  const heldSections = r.heldSections ?? []
  const heldKeys = new Set(heldSections.map((h) => `${h.doc}\0${h.anchor}`))
  const readyButHeld = heldSections.reduce((n, h) => n + h.readyScenarios.length, 0)
  const heldByFindings = r.birthFindings.filter((f) => heldKeys.has(`${f.doc}\0${f.anchor}`)).length
  const heldByErrors = r.errors.filter((e) => heldKeys.has(`${e.doc}\0${e.anchor}`)).length

  return {
    generatedAt: r.generatedAt,
    status: r.status,
    noChanges: r.noChanges,
    written: r.written.length,
    testsFailing: r.written.filter((w) => w.status === 'failing').length,
    testsPassing: r.written.filter((w) => w.status !== 'failing').length,
    birthPassed: r.birthPassed ?? null,
    coverageGapsByKind,
    blockedOnCapabilities,
    birthFindings: r.birthFindings.length,
    fidelityRejections: r.birthFindings.filter((f) => f.kind === 'fidelity').length,
    errors: r.errors.filter((e) => !isGuardAdjudicationError(e)).length,
    unreviewedTests: r.errors.filter((e) => e.kind === 'fidelity').map(guardErrorSubject),
    untriagedTests: r.errors.filter((e) => e.kind === 'triage').map(guardErrorSubject),
    readyButHeld,
    heldByFindings,
    heldByErrors,
    llmFailures: r.llmFailures ?? [],
    unadjudicated: r.unadjudicated ?? [],
    ...(r.usage ? { usage: r.usage } : {}),
  }
}

/** Non-pass outcomes, most severe first. */
export const GUARD_DRIFT_ORDER: readonly GuardOutcome[] = ['fail', 'error', 'stale', 'orphaned']

/**
 * A run's non-pass scenarios, ordered by outcome severity (fail → error → stale →
 * orphaned) with original order preserved within each tier (`Array.sort` is
 * stable). Empty for a missing run or an all-pass run. Accepts the scenarios array
 * directly so any run (not just LATEST) can be ordered.
 */
export function orderGuardDrifts(
  scenarios: readonly GuardScenarioResult[] | null | undefined,
): GuardScenarioResult[] {
  if (!scenarios) return []
  const rank = (o: GuardOutcome): number => {
    const i = GUARD_DRIFT_ORDER.indexOf(o)
    return i === -1 ? GUARD_DRIFT_ORDER.length : i
  }
  return scenarios.filter((s) => s.outcome !== 'pass').sort((a, b) => rank(a.outcome) - rank(b.outcome))
}
