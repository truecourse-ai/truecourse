/**
 * THE BOARD — `guard/LATEST.json` as the merged current-state view.
 *
 * The contract: a run does not REPLACE the board, it merges into it. A scoped run
 * (`guard run --scenario <id>`) updates the scenarios it actually ran and leaves
 * every other scenario's last verdict AND its run identity standing, so the board
 * always shows the latest known verdict per scenario whatever mix of full and
 * scoped runs produced it. Its own record — the `runs/<id>.json` snapshot, the
 * evidence dir, the history row — stays scoped to what executed.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  runGuard,
  mergeGuardBoard,
  withScenarioAdjudication,
  guardLatestPath,
  guardRunPath,
  readGuardHistory,
  readGuardLatest,
  sourceGuardRunInputs,
} from '@truecourse/guard-runner'
import {
  GuardLatestSchema,
  guardResultRanAt,
  guardResultRunId,
  type GuardLatest,
  type GuardScenarioAdjudication,
} from '@truecourse/shared'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** A three-scenario corpus: two that pass, one that fails. */
function writeCorpus(r: string): void {
  writeRecipe(r)
  writeScenario(
    r,
    'cli/version.yaml',
    scenario({
      id: 'ver',
      binds: specBinds('cli/version'),
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
    }),
  )
  writeScenario(
    r,
    'cli/who.yaml',
    scenario({ id: 'who', binds: specBinds('cli/whoami'), steps: [{ run: ['whoami'], expect: { exit: 0 } }] }),
  )
  writeScenario(
    r,
    'cli/boom.yaml',
    scenario({ id: 'boom', binds: specBinds('cli/boom'), steps: [{ run: ['boom'], expect: { exit: 0 } }] }),
  )
}

function board(r: string): GuardLatest {
  const onDisk = JSON.parse(fs.readFileSync(guardLatestPath(r), 'utf-8'))
  // The board is a LATEST like any other — a merge that broke the schema would be
  // read back as `null` by every surface.
  return GuardLatestSchema.parse(onDisk)
}

function outcomes(latest: GuardLatest): Record<string, string> {
  return Object.fromEntries(latest.scenarios.map((s) => [s.id, s.outcome]))
}

describe('the board — a scoped run merges instead of replacing', () => {
  it('keeps every untouched scenario’s verdict, and stamps it with the run it came from', async () => {
    const r = repo()
    writeCorpus(r)

    const full = await runGuard({ repoRoot: r, skipBuild: true })
    expect(full.status).toBe('ok')
    if (full.status !== 'ok') return
    expect(outcomes(board(r))).toEqual({ ver: 'pass', who: 'pass', boom: 'fail' })
    const firstRun = full.latest.run

    const scoped = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'boom' })
    expect(scoped.status).toBe('ok')
    if (scoped.status !== 'ok') return
    // The run's OWN record is the one scenario it ran.
    expect(scoped.latest.scenarios.map((s) => s.id)).toEqual(['boom'])

    // The board is all three, with the two untouched verdicts intact.
    const merged = board(r)
    expect(outcomes(merged)).toEqual({ ver: 'pass', who: 'pass', boom: 'fail' })
    expect(merged.scenarios.map((s) => s.id)).toEqual(['boom', 'ver', 'who'])

    // …and each carried row records WHICH run last touched it — the envelope names
    // only the scoped run, so without this the board would claim it ran all three.
    for (const id of ['ver', 'who']) {
      const row = merged.scenarios.find((s) => s.id === id)!
      expect(guardResultRunId(row, merged.run)).toBe(firstRun.runId)
      expect(guardResultRanAt(row, merged.run)).toBe(firstRun.ranAt)
      // The evidence pointer travels with it, so its transcript is still addressable.
      expect(row.evidencePath).toContain(firstRun.runId)
    }
    // The scenario this run settled carries no stamp: it IS the envelope's run.
    const boom = merged.scenarios.find((s) => s.id === 'boom')!
    expect(boom.runId).toBeUndefined()
    expect(guardResultRunId(boom, merged.run)).toBe(scoped.latest.run.runId)
    expect(merged.run.runId).toBe(scoped.latest.run.runId)
  })

  it('recomputes the summary over the merged set, not the scoped subset', async () => {
    const r = repo()
    writeCorpus(r)

    await runGuard({ repoRoot: r, skipBuild: true })
    expect(board(r).summary).toMatchObject({ total: 3, pass: 2, fail: 1 })

    // Re-author the failing test so the scoped re-run passes: the board's tally has
    // to follow the MERGED rows (3 pass), not carry the old counts and not report
    // the subset's (1 pass).
    writeScenario(
      r,
      'cli/boom.yaml',
      scenario({ id: 'boom', binds: specBinds('cli/boom'), steps: [{ run: ['boom'], expect: { exit: 7 } }] }),
    )
    const scoped = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'boom' })
    expect(scoped.status).toBe('ok')
    if (scoped.status !== 'ok') return
    expect(scoped.latest.summary).toMatchObject({ total: 1, pass: 1, fail: 0 })

    const merged = board(r)
    expect(outcomes(merged)).toEqual({ ver: 'pass', who: 'pass', boom: 'pass' })
    expect(merged.summary).toEqual({
      total: 3,
      pass: 3,
      fail: 0,
      stale: 0,
      orphaned: 0,
      error: 0,
      blocked: 0,
    })
    // The returned `board` is the same view that was written.
    expect(scoped.board).toEqual(merged)
  })

  it('re-rolls the per-section view over the merged set', async () => {
    const r = repo()
    writeCorpus(r)
    await runGuard({ repoRoot: r, skipBuild: true })
    await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'ver' })

    const merged = board(r)
    // Every bound section is still on the board, each with the worst outcome of the
    // scenarios that bind it — a scoped run must not shrink the coverage view.
    expect(merged.sections.map((s) => `${s.section}:${s.status}`).sort()).toEqual([
      'cli/boom:fail',
      'cli/version:pass',
      'cli/whoami:pass',
    ])
    expect(merged.sections.flatMap((s) => s.scenarioIds).sort()).toEqual(['boom', 'ver', 'who'])
  })

  it('leaves the run snapshot, the evidence dir and the history row scoped to what ran', async () => {
    const r = repo()
    writeCorpus(r)
    const full = await runGuard({ repoRoot: r, skipBuild: true })
    const scoped = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'who' })
    expect(full.status === 'ok' && scoped.status === 'ok').toBe(true)
    if (full.status !== 'ok' || scoped.status !== 'ok') return

    // The run's own record: one scenario, and it is NOT the board.
    const snapshot = JSON.parse(fs.readFileSync(guardRunPath(r, scoped.latest.run.runId), 'utf-8'))
    expect(snapshot.scenarios.map((s: { id: string }) => s.id)).toEqual(['who'])
    expect(snapshot.summary.total).toBe(1)
    expect(snapshot).toEqual(scoped.latest)

    // The history is an honest per-run log: a full run of 3, then a scoped run of 1.
    expect(readGuardHistory(r).runs.map((e) => e.summary.total)).toEqual([3, 1])
    expect(readGuardHistory(r).runs.map((e) => e.runId)).toEqual([
      full.latest.run.runId,
      scoped.latest.run.runId,
    ])
  })

  it('drops a scenario that has left the corpus instead of keeping a stale verdict', async () => {
    const r = repo()
    writeCorpus(r)
    await runGuard({ repoRoot: r, skipBuild: true })
    expect(board(r).scenarios).toHaveLength(3)

    fs.rmSync(path.join(r, '.truecourse', 'scenarios', 'cli', 'who.yaml'))
    await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'ver' })

    const merged = board(r)
    expect(outcomes(merged)).toEqual({ ver: 'pass', boom: 'fail' })
    expect(merged.summary).toMatchObject({ total: 2, pass: 1, fail: 1 })
    // …and the section it was the only scenario of goes with it.
    expect(merged.sections.map((s) => s.section)).toEqual(['cli/boom', 'cli/version'])
  })

  it('bootstraps a board holding only what ran when there is no prior LATEST', async () => {
    const r = repo()
    writeCorpus(r)

    const scoped = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'ver' })
    expect(scoped.status).toBe('ok')
    if (scoped.status !== 'ok') return

    const merged = board(r)
    expect(outcomes(merged)).toEqual({ ver: 'pass' })
    expect(merged.summary.total).toBe(1)
    // Nothing to merge means the board IS the run's record, byte for byte.
    expect(merged).toEqual(scoped.latest)
    expect(scoped.board).toEqual(scoped.latest)

    // A deleted board is the same case: the next scoped run rebuilds from what ran.
    fs.rmSync(guardLatestPath(r))
    const again = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'boom' })
    expect(again.status).toBe('ok')
    expect(outcomes(board(r))).toEqual({ boom: 'fail' })
  })

  it('records a scoped BLOCKED run over the prior verdict — it ran and it blocked', async () => {
    const r = repo()
    writeCorpus(r)
    await runGuard({ repoRoot: r, skipBuild: true })
    expect(outcomes(board(r))).toMatchObject({ who: 'pass' })

    // The scenario now binds a supplied dependency no instance is registered for.
    // Nothing executes, but the gate IS a settlement: a stale green must not stand.
    fs.writeFileSync(
      path.join(r, '.truecourse', 'scenarios', 'dependencies.json'),
      JSON.stringify({
        dependencies: [
          {
            name: 'analysis-target',
            class: 'supplied',
            summary: 'a real project to analyze',
            registration: { kind: 'path', description: 'path to a checked-out project' },
            needs: [{ flowId: 'f', need: 'a project with one high finding' }],
          },
        ],
      }),
    )
    writeScenario(
      r,
      'cli/who.yaml',
      scenario({
        id: 'who',
        binds: specBinds('cli/whoami'),
        needs: ['analysis-target'],
        steps: [{ run: ['whoami'], expect: { exit: 0 } }],
      }),
    )

    const scoped = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'who' })
    expect(scoped.status).toBe('ok')
    const merged = board(r)
    expect(outcomes(merged)).toEqual({ ver: 'pass', who: 'blocked', boom: 'fail' })
    expect(merged.summary).toMatchObject({ total: 3, pass: 1, fail: 1, blocked: 1 })
    expect(merged.scenarios.find((s) => s.id === 'who')!.blockedOn?.dependency).toBe('analysis-target')
  })

  it('merges into an OLD-shape LATEST — rows with no run identity of their own', async () => {
    const r = repo()
    writeCorpus(r)
    await runGuard({ repoRoot: r, skipBuild: true })

    // Rewrite the recorded board the way every pre-merge run wrote it: no per-row
    // `runId`/`ranAt` anywhere (and, on an old enough file, no `blocked` tally).
    const prior = board(r)
    const legacy = {
      ...prior,
      summary: {
        total: prior.summary.total,
        pass: prior.summary.pass,
        fail: prior.summary.fail,
        stale: 0,
        orphaned: 0,
        error: 0,
      },
      scenarios: prior.scenarios.map(({ runId: _runId, ranAt: _ranAt, ...rest }) => rest),
    }
    fs.writeFileSync(guardLatestPath(r), JSON.stringify(legacy, null, 2))
    expect(readGuardLatest(r)).not.toBeNull()

    const scoped = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'boom' })
    expect(scoped.status).toBe('ok')
    const merged = board(r)
    expect(outcomes(merged)).toEqual({ ver: 'pass', who: 'pass', boom: 'fail' })
    // A carried row with no stamp of its own inherits the envelope of the board it
    // came from — never the scoped run that did not touch it.
    for (const id of ['ver', 'who']) {
      expect(merged.scenarios.find((s) => s.id === id)!.runId).toBe(prior.run.runId)
    }
  })
})

describe('mergeGuardBoard — the merge itself', () => {
  const envelope = (runId: string, ranAt: string): GuardLatest['run'] => ({
    runId,
    ranAt,
    branch: 'main',
    commit: 'abc123',
    recipeFingerprint: 'sha256:deadbeef',
  })
  const row = (id: string, outcome: 'pass' | 'fail'): GuardLatest['scenarios'][number] => ({
    id,
    title: id,
    binds: { doc: 'docs/spec.md', section: id, fingerprint: `sha256:${id}` },
    outcome,
    durationMs: 1,
  })
  const latest = (
    runId: string,
    ranAt: string,
    rows: GuardLatest['scenarios'],
  ): GuardLatest => ({
    run: envelope(runId, ranAt),
    summary: {
      total: rows.length,
      pass: rows.filter((s) => s.outcome === 'pass').length,
      fail: rows.filter((s) => s.outcome === 'fail').length,
      stale: 0,
      orphaned: 0,
      error: 0,
      blocked: 0,
    },
    scenarios: rows,
    sections: rows.map((s) => ({
      doc: s.binds.doc,
      section: s.binds.section,
      status: s.outcome,
      scenarioIds: [s.id],
    })),
  })

  it('is the run itself when there is no prior board', () => {
    const run = latest('r1', '2026-01-01T00:00:00.000Z', [row('a', 'pass')])
    expect(mergeGuardBoard(null, run, new Set(['a', 'b']))).toEqual(run)
  })

  it('keeps a prior row’s own stamp when it was already carried once', () => {
    const prior = latest('r2', '2026-01-02T00:00:00.000Z', [
      { ...row('a', 'pass'), runId: 'r1', ranAt: '2026-01-01T00:00:00.000Z' },
      row('b', 'fail'),
    ])
    const run = latest('r3', '2026-01-03T00:00:00.000Z', [row('c', 'pass')])
    const merged = mergeGuardBoard(prior, run, new Set(['a', 'b', 'c']))

    expect(merged.scenarios.map((s) => [s.id, s.runId])).toEqual([
      ['a', 'r1'],
      ['b', 'r2'],
      ['c', undefined],
    ])
    expect(merged.run.runId).toBe('r3')
    expect(merged.summary).toMatchObject({ total: 3, pass: 2, fail: 1 })
  })

  // --- Adjudication verdicts across a scoped run (plan 05 step 23) ----------
  //
  // A verdict judges ONE recorded actual. A row nobody re-ran still shows that
  // actual, so its verdict carries; a row this run re-executed shows a new one,
  // so whatever verdict it arrived with is dropped rather than re-attached to a
  // failure it never looked at.
  const verdict = (mechanism: string): GuardScenarioAdjudication => ({
    class: 'bug',
    mechanism,
    code: { file: 'src/thing.ts', line: 12 },
    evidence: ['exit 2 — unknown flag'],
    confidence: 'high',
    findings: [],
    adjudicatedAt: '2026-02-01T00:00:00.000Z',
  })

  it('carries an untouched row’s adjudication verbatim, stamped with the run it judged', () => {
    const prior = latest('r1', '2026-01-01T00:00:00.000Z', [
      { ...row('a', 'fail'), adjudication: verdict('the flag parser drops the last token') },
      row('b', 'pass'),
    ])
    const run = latest('r2', '2026-01-02T00:00:00.000Z', [row('b', 'fail')])
    const merged = mergeGuardBoard(prior, run, new Set(['a', 'b']))

    const a = merged.scenarios.find((s) => s.id === 'a')!
    expect(a.adjudication).toEqual(verdict('the flag parser drops the last token'))
    // The verdict and the run identity travel together: the evidence the verdict
    // cites lives in r1's bundle.
    expect(guardResultRunId(a, merged.run)).toBe('r1')
  })

  it('drops the adjudication of a row THIS run re-executed — a new actual needs a new verdict', () => {
    const prior = latest('r1', '2026-01-01T00:00:00.000Z', [
      { ...row('a', 'fail'), adjudication: verdict('the flag parser drops the last token') },
      row('b', 'pass'),
    ])
    // The run row arrives carrying a verdict (nothing in the runner writes one —
    // the strip is the stated invariant, so state it).
    const run = latest('r2', '2026-01-02T00:00:00.000Z', [
      { ...row('a', 'fail'), adjudication: verdict('a stale verdict riding a fresh row') },
    ])
    const merged = mergeGuardBoard(prior, run, new Set(['a', 'b']))

    const a = merged.scenarios.find((s) => s.id === 'a')!
    expect(a.adjudication).toBeUndefined()
    expect('adjudication' in a).toBe(false)
    // The carried row is untouched by the strip.
    expect(merged.scenarios.find((s) => s.id === 'b')!.outcome).toBe('pass')
  })

  it('strips a run row’s adjudication even when there is no prior board', () => {
    const run = latest('r1', '2026-01-01T00:00:00.000Z', [
      { ...row('a', 'fail'), adjudication: verdict('nothing has judged this run yet') },
    ])
    const merged = mergeGuardBoard(null, run, new Set(['a']))
    expect(merged.scenarios[0].adjudication).toBeUndefined()
  })

  describe('withScenarioAdjudication — the pure verdict patch', () => {
    it('patches the named row and only it, leaving the tallies alone', () => {
      const board = latest('r1', '2026-01-01T00:00:00.000Z', [row('a', 'fail'), row('b', 'fail')])
      const patched = withScenarioAdjudication(board, 'a', verdict('the mechanism'))!
      expect(patched).not.toBeNull()
      expect(patched.scenarios.find((s) => s.id === 'a')!.adjudication).toEqual(verdict('the mechanism'))
      expect(patched.scenarios.find((s) => s.id === 'b')!.adjudication).toBeUndefined()
      // An adjudication is an annotation, never an outcome.
      expect(patched.summary).toBe(board.summary)
      expect(patched.sections).toBe(board.sections)
      // …and the input is not mutated.
      expect(board.scenarios.find((s) => s.id === 'a')!.adjudication).toBeUndefined()
    })

    it('returns null when the board holds no such scenario', () => {
      const board = latest('r1', '2026-01-01T00:00:00.000Z', [row('a', 'fail')])
      expect(withScenarioAdjudication(board, 'nope', verdict('m'))).toBeNull()
    })

    it('holds the patch to the row’s EFFECTIVE run — its own stamp, else the envelope', () => {
      const board = latest('r2', '2026-01-02T00:00:00.000Z', [
        { ...row('a', 'fail'), runId: 'r1', ranAt: '2026-01-01T00:00:00.000Z' },
        row('b', 'fail'),
      ])
      // `a` was carried from r1: the envelope's r2 must not match it.
      expect(withScenarioAdjudication(board, 'a', verdict('m'), { onlyIfRunId: 'r2' })).toBeNull()
      const byOwnStamp = withScenarioAdjudication(board, 'a', verdict('m'), { onlyIfRunId: 'r1' })
      expect(byOwnStamp?.scenarios.find((s) => s.id === 'a')!.adjudication).toEqual(verdict('m'))

      // `b` has no stamp of its own, so the envelope answers for it.
      expect(withScenarioAdjudication(board, 'b', verdict('m'), { onlyIfRunId: 'r1' })).toBeNull()
      expect(
        withScenarioAdjudication(board, 'b', verdict('m'), { onlyIfRunId: 'r2' })?.scenarios.find(
          (s) => s.id === 'b',
        )!.adjudication,
      ).toEqual(verdict('m'))
    })
  })

  it('follows a scenario whose binding moved between runs', () => {
    const prior = latest('r1', '2026-01-01T00:00:00.000Z', [row('a', 'pass')])
    const moved = {
      ...row('a', 'fail'),
      binds: { doc: 'docs/spec.md', section: 'elsewhere', fingerprint: 'sha256:new' },
    }
    const run = latest('r2', '2026-01-02T00:00:00.000Z', [moved])
    const merged = mergeGuardBoard(prior, run, new Set(['a']))

    // The old section is not left holding a scenario that no longer binds it.
    expect(merged.sections).toEqual([
      { doc: 'docs/spec.md', section: 'elsewhere', status: 'fail', scenarioIds: ['a'] },
    ])
  })
})

describe('sourceGuardRunInputs — the corpus a scoped run merges against', () => {
  it('reports every committed id, not just the selected one', () => {
    const r = repo()
    writeCorpus(r)
    const sourced = sourceGuardRunInputs(r, 'ver')
    expect('early' in sourced).toBe(false)
    if ('early' in sourced) return
    expect(sourced.selected.map((s) => s.id)).toEqual(['ver'])
    expect(sourced.corpusIds.sort()).toEqual(['boom', 'ver', 'who'])
  })
})
