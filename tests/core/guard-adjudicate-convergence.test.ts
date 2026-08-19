/**
 * THE READ VIEW AND CONVERGENCE (plan 05 step 23) — `readGuardAdjudicationView`.
 *
 * "documenso ran 9 times" is the cost this computes instead of counting by hand:
 * a corpus has CONVERGED when the last two runs produced the same per-scenario
 * outcomes AND every failure standing on the board carries a verdict. Both
 * halves are load-bearing — identical outcomes with an unclassified failure is a
 * corpus that has stopped moving without anyone knowing why, and a fully
 * adjudicated board whose last two runs disagree is still in flight.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendGuardHistory,
  guardRunPath,
  writeGuardLatest,
  writeGuardRun,
} from '@truecourse/guard-runner'
import type { GuardLatest, GuardScenarioAdjudication, GuardScenarioResult, GuardSummary } from '@truecourse/shared'
import { readGuardAdjudicationView } from '../../packages/core/src/commands/guard-adjudicate'

let repo: string

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-adjudicate-converge-'))
})
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

const VERDICT: GuardScenarioAdjudication = {
  class: 'drift',
  mechanism: 'the doc promises a flag the CLI never shipped',
  evidence: ['exit 2 — unknown flag'],
  confidence: 'high',
  findings: [],
  adjudicatedAt: '2026-02-01T00:00:00.000Z',
}

function row(id: string, outcome: GuardScenarioResult['outcome'], over: Partial<GuardScenarioResult> = {}): GuardScenarioResult {
  return {
    id,
    title: `${id} title`,
    binds: { doc: 'docs/x.md', section: `${id}/sec`, fingerprint: 'sha256:x' },
    outcome,
    durationMs: 1,
    ...(outcome === 'fail' || outcome === 'error'
      ? { failure: { step: 2, expected: 'exit 0', actual: 'exit 2 — unknown flag' } }
      : {}),
    ...over,
  }
}

function summarize(rows: readonly GuardScenarioResult[]): GuardSummary {
  const summary: GuardSummary = { total: rows.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0, blocked: 0 }
  for (const r of rows) summary[r.outcome] += 1
  return summary
}

function latest(runId: string, rows: GuardScenarioResult[]): GuardLatest {
  return {
    run: {
      runId,
      ranAt: `2026-01-0${runId.slice(-1)}T00:00:00.000Z`,
      branch: 'main',
      commit: 'deadbeef',
      recipeFingerprint: 'sha256:r',
    },
    summary: summarize(rows),
    scenarios: rows,
    sections: [],
  }
}

/** Record one run: its snapshot under `runs/` plus its history row. */
function record(runId: string, rows: GuardScenarioResult[]): void {
  const snapshot = latest(runId, rows)
  writeGuardRun(repo, snapshot)
  appendGuardHistory(repo, {
    runId,
    ranAt: snapshot.run.ranAt,
    branch: 'main',
    commit: 'deadbeef',
    summary: snapshot.summary,
  })
}

/** The board as the two runs left it, with `b` adjudicated unless told otherwise. */
function seedBoard(adjudicated = true): void {
  writeGuardLatest(
    repo,
    latest('r2', [row('a', 'pass'), row('b', 'fail', adjudicated ? { adjudication: VERDICT } : {})]),
  )
}

describe('readGuardAdjudicationView', () => {
  it('reports nothing at all when there is no board', async () => {
    expect(await readGuardAdjudicationView(repo)).toEqual({
      runId: null,
      failures: [],
      unadjudicated: 0,
      converged: false,
    })
  })

  it('lists every fail/error row with its failure detail and its verdict', async () => {
    writeGuardLatest(
      repo,
      latest('r1', [
        row('a', 'pass'),
        row('b', 'fail', { adjudication: VERDICT }),
        row('c', 'error'),
        // Never executed: nothing about the repo is in dispute, but it is not a
        // failure the board shows either.
        row('d', 'blocked'),
      ]),
    )
    const view = await readGuardAdjudicationView(repo)
    expect(view.runId).toBe('r1')
    expect(view.failures.map((f) => f.scenarioId)).toEqual(['b', 'c'])
    expect(view.failures[0]).toEqual({
      scenarioId: 'b',
      title: 'b title',
      outcome: 'fail',
      step: 2,
      expected: 'exit 0',
      actual: 'exit 2 — unknown flag',
      adjudication: VERDICT,
    })
    expect(view.unadjudicated).toBe(1)
  })
})

describe('convergence', () => {
  it('is true when the last two runs agree per scenario and every failure is judged', async () => {
    record('r1', [row('a', 'pass'), row('b', 'fail')])
    record('r2', [row('a', 'pass'), row('b', 'fail')])
    seedBoard()
    expect((await readGuardAdjudicationView(repo)).converged).toBe(true)
  })

  it('is false on a single run — one run agrees with nothing', async () => {
    record('r1', [row('a', 'pass'), row('b', 'fail')])
    seedBoard()
    expect((await readGuardAdjudicationView(repo)).converged).toBe(false)
  })

  it('is false when the tallies differ — the cheap gate', async () => {
    record('r1', [row('a', 'pass'), row('b', 'pass')])
    record('r2', [row('a', 'pass'), row('b', 'fail')])
    seedBoard()
    expect((await readGuardAdjudicationView(repo)).converged).toBe(false)
  })

  it('is false when the SAME tallies hide a per-scenario swap', async () => {
    // One pass and one fail both times: only the per-scenario set catches this.
    record('r1', [row('a', 'pass'), row('b', 'fail')])
    record('r2', [row('a', 'fail'), row('b', 'pass')])
    writeGuardLatest(repo, latest('r2', [row('a', 'fail', { adjudication: VERDICT }), row('b', 'pass')]))
    expect((await readGuardAdjudicationView(repo)).converged).toBe(false)
  })

  it('is false when a run snapshot is missing — absence cannot prove identity', async () => {
    record('r1', [row('a', 'pass'), row('b', 'fail')])
    record('r2', [row('a', 'pass'), row('b', 'fail')])
    seedBoard()
    expect((await readGuardAdjudicationView(repo)).converged).toBe(true)

    // `guard/runs/` is gitignored: on a teammate's clone the snapshot is simply
    // not there, and a guess would be worse than a "not converged".
    fs.rmSync(guardRunPath(repo, 'r1'))
    expect((await readGuardAdjudicationView(repo)).converged).toBe(false)
  })

  it('is false while any current failure carries no verdict', async () => {
    record('r1', [row('a', 'pass'), row('b', 'fail')])
    record('r2', [row('a', 'pass'), row('b', 'fail')])
    seedBoard(false)
    const view = await readGuardAdjudicationView(repo)
    expect(view.unadjudicated).toBe(1)
    expect(view.converged).toBe(false)
  })

  it('is true on an all-green board with two agreeing runs', async () => {
    record('r1', [row('a', 'pass')])
    record('r2', [row('a', 'pass')])
    writeGuardLatest(repo, latest('r2', [row('a', 'pass')]))
    const view = await readGuardAdjudicationView(repo)
    expect(view.failures).toEqual([])
    expect(view.converged).toBe(true)
  })
})
