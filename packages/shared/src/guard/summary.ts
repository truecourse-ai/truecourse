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
  guardDriverIds,
  type GuardDriverId,
} from './drivers.js'
import {
  emptyGapDisplayTotals,
  gapDisplayKind,
  parseBlockedOnCapabilities,
  type GuardGapDisplayKind,
  type GuardGenerateReport,
  type GuardGenerateUsage,
} from './report.js'
import type { GuardManifest } from './manifest.js'
import type {
  GuardLatest,
  GuardOutcome,
  GuardScenarioResult,
  GuardSummary,
} from './result.js'

/** Section-coverage rollup from `scenarios/manifest.json`. */
export interface GuardCoverageSummary {
  /** Sections recorded in the manifest. */
  totalSections: number
  /** Sections that own at least one scenario. */
  withScenarios: number
  /**
   * Testability-classification counts: one per driver id (registry-derived) plus
   * `untestable` and `unclassified` (recorded without a verdict).
   */
  classification: Record<GuardDriverId, number> & { untestable: number; unclassified: number }
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
  status: 'ok' | 'no-docs' | 'recipe-failed' | 'open-conflicts'
  noChanges: boolean
  written: number
  /**
   * How many of `written` were committed in a FAILING state (item 3) — real drift the
   * run will reproduce (a `written` entry carrying a `diagnosis`). The generate summary
   * reads it for "N scenarios written (M failing — see guard run/drifts)". 0 on older
   * all-passing reports.
   */
  writtenFailing: number
  /** Null on older reports written before birth counting existed. */
  birthPassed: number | null
  /** Counts keyed by the flat display kind (awaiting-driver gaps split per driver). */
  coverageGapsByKind: Record<GuardGapDisplayKind, number>
  /** Per-capability tally across the `blocked-on` gaps (e.g. `{ git: 9, db: 3 }`). */
  blockedOnCapabilities: Record<string, number>
  birthFindings: number
  errors: number
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

function summarizeCoverage(manifest: GuardManifest): GuardCoverageSummary {
  const classification = emptyClassification()
  let withScenarios = 0
  for (const s of manifest.sections) {
    if (s.scenarioIds.length > 0) withScenarios++
    const c = s.classification
    if (!c) classification.unclassified++
    else if ('untestable' in c) classification.untestable++
    else classification[c.driver]++
  }
  return { totalSections: manifest.sections.length, withScenarios, classification }
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
    noChanges: r.noChanges,
    written: r.written.length,
    writtenFailing: r.written.filter((w) => w.diagnosis !== undefined).length,
    birthPassed: r.birthPassed ?? null,
    coverageGapsByKind,
    blockedOnCapabilities,
    birthFindings: r.birthFindings.length,
    errors: r.errors.length,
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
