/**
 * THE VERDICT WRITE PATH (plan 05 step 23) — `persistAdjudication`, the fold's
 * persist half. A verdict judges ONE run's recorded actual, so it lands on that
 * run's snapshot unconditionally and on the BOARD only while the board still
 * shows that run's row: a scenario re-run since the adjudication started must
 * keep its fresh, verdict-less state rather than inherit a verdict about an
 * actual nobody is looking at any more.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  guardLatestPath,
  guardRunPath,
  writeGuardLatest,
  writeGuardRun,
} from '@truecourse/guard-runner'
import {
  GuardLatestSchema,
  type GuardLatest,
  type GuardScenarioAdjudication,
  type GuardScenarioResult,
} from '@truecourse/shared'
import { persistAdjudication } from '../../packages/core/src/services/guard-adjudicate/fold'
import type { AdjudicationItem } from '../../packages/core/src/services/guard-adjudicate/pre-pass'

let repo: string

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-adjudicate-persist-'))
})
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

function row(id: string, over: Partial<GuardScenarioResult> = {}): GuardScenarioResult {
  return {
    id,
    title: `${id} title`,
    binds: { doc: 'docs/x.md', section: `${id}/sec`, fingerprint: 'sha256:x' },
    outcome: 'fail',
    durationMs: 1,
    failure: { step: 2, expected: 'exit 0', actual: 'exit 2 — unknown flag' },
    ...over,
  }
}

function latest(runId: string, rows: GuardScenarioResult[]): GuardLatest {
  return {
    run: {
      runId,
      ranAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commit: 'deadbeef',
      recipeFingerprint: 'sha256:r',
    },
    summary: {
      total: rows.length,
      pass: 0,
      fail: rows.filter((r) => r.outcome === 'fail').length,
      stale: 0,
      orphaned: 0,
      error: 0,
      blocked: 0,
    },
    scenarios: rows,
    sections: [],
  }
}

const verdict: GuardScenarioAdjudication = {
  class: 'bug',
  mechanism: 'the flag parser drops the last token',
  code: { file: 'src/cli.ts', line: 42 },
  evidence: ['exit 2 — unknown flag'],
  control: { conclusion: 'confirms', reasoning: 'the control reproduced it', transcriptRef: 'control-1' },
  confidence: 'high',
  findings: [],
  adjudicatedAt: '2026-02-01T00:00:00.000Z',
  sessionId: 'sess-1',
}

function item(over: Partial<AdjudicationItem> = {}): AdjudicationItem {
  return {
    scenarioId: 'a',
    title: 'a title',
    outcome: 'fail',
    runId: 'r1',
    row: row('a'),
    step: 2,
    expected: 'exit 0',
    actual: 'exit 2 — unknown flag',
    surface: 'cli',
    ...over,
  }
}

const readBoard = (): GuardLatest => GuardLatestSchema.parse(JSON.parse(fs.readFileSync(guardLatestPath(repo), 'utf-8')))
const readRun = (runId: string): GuardLatest =>
  GuardLatestSchema.parse(JSON.parse(fs.readFileSync(guardRunPath(repo, runId), 'utf-8')))

describe('persistAdjudication', () => {
  it('writes the verdict onto the run snapshot AND the board that still shows that run', async () => {
    writeGuardRun(repo, latest('r1', [row('a'), row('b')]))
    // The board's envelope is a later run; `a` is a row carried from r1.
    writeGuardLatest(repo, latest('r2', [{ ...row('a'), runId: 'r1', ranAt: '2026-01-01T00:00:00.000Z' }, row('b')]))

    const result = await persistAdjudication({ repoRoot: repo, item: item(), verdict })
    expect(result).toMatchObject({ runUpdated: true, latestUpdated: true })
    expect(result.routing).toEqual({})

    expect(readRun('r1').scenarios.find((s) => s.id === 'a')!.adjudication).toEqual(verdict)
    expect(readBoard().scenarios.find((s) => s.id === 'a')!.adjudication).toEqual(verdict)
    // Only the named row is touched.
    expect(readRun('r1').scenarios.find((s) => s.id === 'b')!.adjudication).toBeUndefined()
    expect(readBoard().scenarios.find((s) => s.id === 'b')!.adjudication).toBeUndefined()
  })

  it('leaves the board alone when the row has since been re-run', async () => {
    writeGuardRun(repo, latest('r1', [row('a')]))
    // The board's `a` carries no stamp of its own, so it belongs to the envelope's
    // run — r2, not the r1 actual this verdict judged.
    writeGuardLatest(repo, latest('r2', [row('a')]))

    const result = await persistAdjudication({ repoRoot: repo, item: item(), verdict })
    expect(result).toMatchObject({ runUpdated: true, latestUpdated: false })
    expect(readRun('r1').scenarios[0].adjudication).toEqual(verdict)
    expect(readBoard().scenarios[0].adjudication).toBeUndefined()
  })

  it('does not throw when the run snapshot is gone — the board is still patched', async () => {
    // `guard/runs/` is gitignored: a fresh clone has the board and no snapshots.
    writeGuardLatest(repo, latest('r1', [row('a')]))

    const result = await persistAdjudication({ repoRoot: repo, item: item(), verdict })
    expect(result).toMatchObject({ runUpdated: false, latestUpdated: true })
    expect(fs.existsSync(guardRunPath(repo, 'r1'))).toBe(false)
    expect(readBoard().scenarios[0].adjudication).toEqual(verdict)
  })

  it('is a no-op that reports honestly when neither store holds the row', async () => {
    writeGuardLatest(repo, latest('r1', [row('other')]))
    const result = await persistAdjudication({ repoRoot: repo, item: item(), verdict })
    expect(result).toMatchObject({ runUpdated: false, latestUpdated: false, routing: {} })
  })

  it('re-adjudication overwrites the prior verdict in place', async () => {
    writeGuardRun(repo, latest('r1', [row('a')]))
    writeGuardLatest(repo, latest('r1', [row('a')]))
    await persistAdjudication({ repoRoot: repo, item: item(), verdict })

    const second: GuardScenarioAdjudication = {
      ...verdict,
      class: 'drift',
      mechanism: 'the doc promises a flag the CLI never shipped',
      adjudicatedAt: '2026-02-02T00:00:00.000Z',
    }
    await persistAdjudication({ repoRoot: repo, item: item(), verdict: second })
    expect(readBoard().scenarios[0].adjudication).toEqual(second)
    expect(readRun('r1').scenarios[0].adjudication).toEqual(second)
  })
})
