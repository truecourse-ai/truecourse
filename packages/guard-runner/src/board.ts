/**
 * The BOARD — `guard/LATEST.json`, the materialized current-state view — and the
 * merge that keeps it whole across a mix of full and scoped runs.
 *
 * A run's own record (`runs/<runId>.json`, the evidence dir, the history row) is
 * scoped to what actually executed: it answers "what did this run do". The board
 * answers a different question — "what is the latest known verdict per scenario" —
 * so a run does not REPLACE it, it merges into it: the scenarios this run settled
 * take their new verdicts, every other scenario keeps the verdict (and the run
 * identity) it already had, and a scenario that has left the corpus drops out
 * instead of surviving as a stale row.
 */

import {
  worstOutcome,
  type GuardLatest,
  type GuardOutcome,
  type GuardScenarioResult,
  type GuardSectionRollup,
  type GuardSummary,
} from '@truecourse/shared'

/** Tally a result set under the six outcomes — the board's summary and a run's alike. */
export function summarizeResults(results: readonly GuardScenarioResult[]): GuardSummary {
  const summary: GuardSummary = {
    total: results.length,
    pass: 0,
    fail: 0,
    stale: 0,
    orphaned: 0,
    error: 0,
    blocked: 0,
  }
  for (const r of results) summary[r.outcome] += 1
  return summary
}

/**
 * Merge a run into the recorded board.
 *
 * - Every scenario THIS RUN settled takes its new verdict, whatever that verdict is.
 *   A `blocked` scenario included: the dependency gate is a settlement (the run
 *   looked, and the instance it needs is not registered), so it replaces the prior
 *   verdict rather than letting a stale green stand behind it. Same for
 *   `stale`/`orphaned`, which the binding check settles before execution.
 * - Every scenario it did NOT touch keeps its recorded row verbatim — outcome,
 *   failure detail, evidence pointer — stamped with the run it came from so the
 *   board stays self-describing (see `runId`/`ranAt` on the result schema).
 * - A scenario absent from `corpusIds` drops out: it is no longer committed, and a
 *   deleted test's last verdict is not current state.
 * - `summary` and `sections` are recomputed over the MERGED set, so a scoped run can
 *   never make the board's tallies describe its subset.
 * - No prior board (a first run, or a deleted LATEST) bootstraps one holding exactly
 *   what ran — the run's own record, unchanged.
 *
 * The `run` envelope is the LAST run's: it names which run wrote the board, never
 * which scenarios it executed (each row carries that itself).
 */
export function mergeGuardBoard(
  prior: GuardLatest | null,
  run: GuardLatest,
  corpusIds: ReadonlySet<string>,
): GuardLatest {
  if (!prior) return run

  const ranIds = new Set(run.scenarios.map((s) => s.id))
  const carried = prior.scenarios
    .filter((s) => !ranIds.has(s.id) && corpusIds.has(s.id))
    .map((s) => ({
      ...s,
      // Its own stamp when it was itself carried into the prior board; otherwise the
      // run that wrote that board. Either way the row keeps pointing at the run whose
      // evidence dir holds its transcript.
      runId: s.runId ?? prior.run.runId,
      ranAt: s.ranAt ?? prior.run.ranAt,
    }))

  const scenarios = [...run.scenarios, ...carried].sort((a, b) => a.id.localeCompare(b.id))
  const outcomeById = new Map(scenarios.map((s) => [s.id, s.outcome]))

  return {
    run: run.run,
    summary: summarizeResults(scenarios),
    scenarios,
    sections: mergeSections(prior.sections, run.sections, outcomeById, new Set(carried.map((s) => s.id))),
  }
}

/**
 * Recompute the per-section rollup over the merged set. Prior entries contribute only
 * their CARRIED scenarios — a scenario this run settled re-enters through the run's own
 * rollup, so a binding that moved between runs follows its scenario instead of
 * lingering under the old section. A section left with no scenario disappears.
 */
function mergeSections(
  prior: readonly GuardSectionRollup[],
  run: readonly GuardSectionRollup[],
  outcomeById: ReadonlyMap<string, GuardOutcome>,
  carriedIds: ReadonlySet<string>,
): GuardSectionRollup[] {
  const byKey = new Map<string, { doc: string; section: string; ids: Set<string> }>()
  const add = (rollup: GuardSectionRollup, ids: readonly string[]): void => {
    if (ids.length === 0) return
    const key = `${rollup.doc}\x00${rollup.section}`
    let entry = byKey.get(key)
    if (!entry) {
      entry = { doc: rollup.doc, section: rollup.section, ids: new Set() }
      byKey.set(key, entry)
    }
    for (const id of ids) entry.ids.add(id)
  }
  for (const rollup of prior) add(rollup, rollup.scenarioIds.filter((id) => carriedIds.has(id)))
  for (const rollup of run) add(rollup, rollup.scenarioIds.filter((id) => outcomeById.has(id)))

  return [...byKey.values()]
    .map((e) => {
      const ids = [...e.ids].sort()
      return {
        doc: e.doc,
        section: e.section,
        status: worstOutcome(ids.map((id) => outcomeById.get(id)!)),
        scenarioIds: ids,
      }
    })
    .sort((a, b) => a.doc.localeCompare(b.doc) || a.section.localeCompare(b.section))
}
