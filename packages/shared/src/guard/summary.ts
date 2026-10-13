/**
 * Pure, LLM-free composition for the guard read surfaces. ONE copy, imported by
 * core and the client alike — no mirrored twins. No I/O here: the caller reads
 * `scenarios/manifest.json`, `guard/LATEST.json`, and `guard/result.json`; these
 * functions only shape the parsed structures.
 *
 * Driver-scoped tallies (`coverageGapsByKind`) are keyed off the driver
 * registry, so a new driver joins the counts by adding a registry row.
 */

import {
  awaitingDriverIds,
  type GuardDriverId,
} from './drivers.js'
import {
  GUARD_COVERAGE_PLAIN_ORDER,
  guardCoveragePlainStatus,
  worstCoverageStatus,
  type GuardCoveragePlainStatus,
  type GuardCoverageStatus,
} from './dashboard.js'
import {
  emptyGapDisplayTotals,
  gapDisplayKind,
  parseBlockedOnCapabilities,
  type GuardCoverageGapKind,
  type GuardGapDisplayKind,
  type GuardGenerateReport,
  type GuardGenerateUsage,
  type GuardUnadjudicatedStage,
} from './report.js'
import type { StageTransportTally } from '../llm/tally.js'
import type { GuardManifest, GuardManifestFlow, GuardManifestGap } from './manifest.js'
import type {
  GuardLatest,
  GuardOutcome,
  GuardScenarioResult,
  GuardSummary,
} from './result.js'

/**
 * Flow-coverage rollup from the flow-keyed manifest — the FLOW is the generation
 * unit, so this is the headline count the Flows surfaces render.
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
  /**
   * The flows counted under the coverage words a flow wears — the tally every user-facing
   * surface renders. The buckets above are the manifest's own shape (how much of a
   * flow was realized); this is what a reader is told, and it is the same
   * derivation the dashboard's Flows list uses.
   */
  byStatus: Record<GuardCoveragePlainStatus, number>
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
  /**
   * The runner-refusal status id (`seed-failed`, `missing-external-env`, …) when
   * the run latched a REFUSAL mid-validation — `status` alone reads `ok` on such
   * a run (the scenarios settled before the latch are real), so a status surface
   * that omits this line reports a refused generate as a clean one.
   */
  refused: string | null
  noChanges: boolean
  written: number
  /**
   * The written tests split by the status they were committed with — guard commits
   * every authored test, so `testsPassing + testsFailing + testsNeverRun = written`.
   * A report written before failing tests were committed records no status, so every
   * one of its written rows counts as passing.
   */
  testsPassing: number
  testsFailing: number
  /**
   * Written but NEVER EXECUTED — a hand-authored corpus, which has no birth
   * execution behind it. Counted apart from `testsPassing` because a test nothing
   * ever ran has earned no verdict, and rolling it into the green would be the one
   * lie an inventory line must not tell.
   */
  testsNeverRun: number
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
  errors: number
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

/**
 * The ALL-claims tally: every claim of every kept spec doc, counted under the
 * five coverage words through the SAME per-claim derivation the Claims view
 * renders — so the overview bar and the claim list can never disagree, and it
 * always sums to the real claim count — the whole-corpus truth, where the
 * manifest's flow rollup counts only the flows that bind something.
 */
export interface GuardClaimTotals {
  /** Every claim across the kept docs — the bar's denominator. */
  total: number
  byStatus: Record<GuardCoveragePlainStatus, number>
}

export interface GuardStatusSummary {
  /** The flow-led rollup over the manifest; null without a manifest. */
  flows: GuardFlowsCoverageSummary | null
  /** Null when the caller could not derive it (no corpus / doc reads unavailable). */
  claims: GuardClaimTotals | null
  lastRun: GuardLastRunSummary | null
  lastGenerate: GuardLastGenerateSummary | null
}

/** Compose the three store reads into the compact status summary. */
export function composeGuardStatus(
  manifest: GuardManifest | null,
  latest: GuardLatest | null,
  result: GuardGenerateReport | null,
  claims: GuardClaimTotals | null = null,
): GuardStatusSummary {
  return {
    flows: manifest ? summarizeFlows(manifest, runOutcomeLookup(latest)) : null,
    claims,
    lastRun: latest
      ? { ranAt: latest.run.ranAt, branch: latest.run.branch, commit: latest.run.commit, summary: latest.summary }
      : null,
    lastGenerate: result ? summarizeGenerate(result) : null,
  }
}

/**
 * One line naming a gap, the SINGLE copy every surface renders: an
 * `awaiting-driver` gap names the driver it waits on, every other kind reads as
 * its own kind with the hyphens spelled out (`no-interface` → `no interface`).
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
 * — ONE copy, rendered verbatim by the dashboard's generate overview. Wording
 * this in more than one place is exactly how an unreviewed corpus starts
 * reading as a reviewed one.
 */
export function guardUnadjudicatedEffect(entry: GuardUnadjudicatedStage): string {
  const tests = `${entry.affected} test${entry.affected === 1 ? '' : 's'}`
  return entry.stage === 'guard.fidelity'
    ? `${tests} persisted passing, never reviewed against their flow`
    : `${tests} committed failing and untriaged — nothing says whether the repo or the test is wrong`
}

/**
 * What the user does about it, said the same way everywhere. The flows are left
 * UNSETTLED for exactly this reason (a settled flow carries its inputs hash and the
 * next generate skips it), and authoring is cached per flow+sections+interfaces+recipe,
 * so an unchanged corpus re-adjudicates without paying for authoring again.
 */
export const GUARD_UNADJUDICATED_REMEDY =
  'The tests are committed and their flows were left unsettled, so re-running Flow generation once the model is reachable adjudicates them — authoring is cached, so the re-run pays for the verdicts, not for writing the tests again.'

/** A zeroed count per coverage word. */
function emptyPlainTotals(): Record<GuardCoveragePlainStatus, number> {
  const out = {} as Record<GuardCoveragePlainStatus, number>
  for (const key of GUARD_COVERAGE_PLAIN_ORDER) out[key] = 0
  return out
}

/** Each scenario's outcome in the last run, or `undefined` when no run covered it. */
function runOutcomeLookup(latest: GuardLatest | null): (id: string) => GuardOutcome | undefined {
  const byId = new Map((latest?.scenarios ?? []).map((s) => [s.id, s.outcome]))
  return (id) => byId.get(id)
}

/**
 * A manifest flow's coverage status: the worst over its realized surfaces and its
 * gaps. A scenario paints its RUN outcome when a run covered it, else the status
 * it was committed with — `never-run` for a test nothing ever executed, `fail` for
 * one committed red, `guarded` for one that passed its birth. Gaps paint under
 * their display kind. It is the manifest-only twin of the core read join, and both
 * fold through the same precedence, so the two can only ever agree on the WORD.
 */
function manifestFlowCoverageStatus(
  flow: GuardManifestFlow,
  outcomeOf: (id: string) => GuardOutcome | undefined,
): GuardCoverageStatus {
  const statuses: GuardCoverageStatus[] = [
    ...flow.scenarios.map((s): GuardCoverageStatus => {
      const outcome = outcomeOf(s.id)
      if (outcome) return outcome
      return s.status === 'never-run' ? 'never-run' : s.status === 'failing' ? 'fail' : 'guarded'
    }),
    ...flow.gaps.flatMap((g): GuardCoverageStatus[] => {
      const kind = gapDisplayKind(g)
      return kind ? [kind] : []
    }),
  ]
  return worstCoverageStatus(statuses)
}

/** A flow's coverage bucket: fully guarded, partly guarded, or nothing realized. */
function flowBucket(flow: GuardManifestFlow): 'guarded' | 'partial' | 'blocked' {
  if (flow.scenarios.length === 0) return 'blocked'
  return flow.gaps.length === 0 ? 'guarded' : 'partial'
}

function summarizeFlows(
  manifest: GuardManifest,
  outcomeOf: (id: string) => GuardOutcome | undefined,
): GuardFlowsCoverageSummary {
  let guarded = 0
  let partial = 0
  let blocked = 0
  const byStatus = emptyPlainTotals()
  const labels = new Map<string, number>()
  for (const flow of manifest.flows) {
    byStatus[guardCoveragePlainStatus(manifestFlowCoverageStatus(flow, outcomeOf))]++
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
  return { total: manifest.flows.length, guarded, partial, blocked, gapLabels, byStatus }
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
  return {
    generatedAt: r.generatedAt,
    status: r.status,
    refused: r.refusal?.status ?? null,
    noChanges: r.noChanges,
    written: r.written.length,
    testsFailing: r.written.filter((w) => w.status === 'failing').length,
    testsNeverRun: r.written.filter((w) => w.status === 'never-run').length,
    testsPassing: r.written.filter((w) => w.status !== 'failing' && w.status !== 'never-run').length,
    birthPassed: r.birthPassed ?? null,
    coverageGapsByKind,
    blockedOnCapabilities,
    birthFindings: r.birthFindings.length,
    fidelityRejections: r.birthFindings.filter((f) => f.kind === 'fidelity').length,
    errors: r.errors.length,
    llmFailures: r.llmFailures ?? [],
    unadjudicated: r.unadjudicated ?? [],
    ...(r.usage ? { usage: r.usage } : {}),
  }
}

/** Non-pass outcomes, most severe first. */
export const GUARD_DRIFT_ORDER: readonly GuardOutcome[] = ['fail', 'error', 'stale', 'orphaned']

/**
 * A run's DRIFT scenarios, ordered by outcome severity (fail → error → stale →
 * orphaned) with original order preserved within each tier (`Array.sort` is
 * stable). Empty for a missing run or an all-pass run. Accepts the scenarios array
 * directly so any run (not just LATEST) can be ordered.
 *
 * `blocked` is excluded with `pass`: the scenario never executed for want of a
 * registered supplied dependency, so it has no expected/actual and nothing about
 * the repo is in dispute. Listing it as drift would send a reader to the drift
 * detail to inspect a comparison that was never made; its home is the coverage
 * surfaces, which name the dependency to register.
 */
export function orderGuardDrifts(
  scenarios: readonly GuardScenarioResult[] | null | undefined,
): GuardScenarioResult[] {
  if (!scenarios) return []
  const rank = (o: GuardOutcome): number => {
    const i = GUARD_DRIFT_ORDER.indexOf(o)
    return i === -1 ? GUARD_DRIFT_ORDER.length : i
  }
  return scenarios
    .filter((s) => s.outcome !== 'pass' && s.outcome !== 'blocked')
    .sort((a, b) => rank(a.outcome) - rank(b.outcome))
}
