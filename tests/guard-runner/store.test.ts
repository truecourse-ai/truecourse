import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import {
  guardRunPath,
  guardRunsDir,
  guardHistoryPath,
  guardResultPath,
  guardLatestPath,
  writeGuardLatest,
  readGuardLatest,
  writeGuardRun,
  readGuardHistory,
  appendGuardHistory,
  writeGuardResult,
  readGuardResult,
} from '@truecourse/guard-runner'
import {
  GuardLatestSchema,
  GuardHistorySchema,
  guardResultStage,
  type GuardGenerateReport,
  type GuardHistoryEntry,
  type GuardLatest,
} from '@truecourse/shared'
import { makeTempRepo, rmrf } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function makeLatest(runId: string): GuardLatest {
  return {
    run: {
      runId,
      ranAt: new Date().toISOString(),
      branch: 'main',
      commit: 'abc123',
      recipeFingerprint: 'sha256:deadbeef',
      scenarioFormat: 3,
    },
    summary: { total: 2, pass: 1, fail: 1, stale: 0, orphaned: 0, error: 0, blocked: 0 },
    scenarios: [],
    sections: [],
  }
}

function entryFrom(latest: GuardLatest): GuardHistoryEntry {
  return {
    runId: latest.run.runId,
    ranAt: latest.run.ranAt,
    branch: latest.run.branch,
    commit: latest.run.commit,
    summary: latest.summary,
  }
}

describe('guard store — run snapshots', () => {
  it('writes a run snapshot named `<runId>.json` that reads back schema-valid', () => {
    const r = repo()
    const runId = '2026-01-02T03-04-05Z_abcd1234'
    const latest = makeLatest(runId)

    const written = writeGuardRun(r, latest)
    expect(written).toBe(guardRunPath(r, runId))
    expect(fs.existsSync(guardRunPath(r, runId))).toBe(true)
    // The filename is exactly the runId plus `.json`.
    expect(fs.readdirSync(guardRunsDir(r))).toEqual([`${runId}.json`])

    const onDisk = JSON.parse(fs.readFileSync(guardRunPath(r, runId), 'utf-8'))
    expect(() => GuardLatestSchema.parse(onDisk)).not.toThrow()
    expect(onDisk).toEqual(latest)
  })
})

describe('guard store — history', () => {
  it('appends across two runs, preserving order', () => {
    const r = repo()
    const a = makeLatest('2026-01-01T00-00-00Z_aaaaaaaa')
    const b = makeLatest('2026-01-02T00-00-00Z_bbbbbbbb')

    appendGuardHistory(r, entryFrom(a))
    appendGuardHistory(r, entryFrom(b))

    const history = readGuardHistory(r)
    expect(() => GuardHistorySchema.parse(history)).not.toThrow()
    expect(history.runs.map((e) => e.runId)).toEqual([a.run.runId, b.run.runId])
    expect(history.runs[0].summary).toEqual(a.summary)
  })

  it('reads {runs: []} for a missing history file', () => {
    const r = repo()
    expect(fs.existsSync(guardHistoryPath(r))).toBe(false)
    expect(readGuardHistory(r)).toEqual({ runs: [] })
  })

  it('tolerates a corrupt history file (reads {runs: []})', () => {
    const r = repo()
    fs.mkdirSync(guardRunsDir(r), { recursive: true })
    fs.writeFileSync(guardHistoryPath(r), 'not json {{{')
    expect(readGuardHistory(r)).toEqual({ runs: [] })
  })
})

describe('guard store — LATEST', () => {
  it('round-trips a written LATEST and returns null when absent', () => {
    const r = repo()
    expect(readGuardLatest(r)).toBeNull()

    const latest = makeLatest('2026-01-03T00-00-00Z_cccccccc')
    const path = writeGuardLatest(r, latest)
    expect(path).toBe(guardLatestPath(r))
    expect(readGuardLatest(r)).toEqual(latest)
  })

  it('returns null for an unparseable LATEST', () => {
    const r = repo()
    fs.mkdirSync(guardRunsDir(r), { recursive: true })
    fs.writeFileSync(guardLatestPath(r), '{ broken')
    expect(readGuardLatest(r)).toBeNull()
  })

  it('round-trips the result STAGE, and a pre-stage snapshot still parses (reads as a run)', () => {
    const r = repo()
    const latest = makeLatest('2026-01-03T00-00-00Z_dddddddd')
    latest.scenarios = [
      {
        id: 'flow.cli.1',
        title: 'born red',
        binds: { doc: 'docs/x.md', section: 'x', fingerprint: 'sha256:x' },
        outcome: 'fail',
        stage: 'birth',
        durationMs: 12,
        failure: { step: 1, expected: 'exit 0', actual: 'exit 7' },
      },
      // Written before the stage existed — no field at all.
      {
        id: 'flow.cli.2',
        title: 'from a run',
        binds: { doc: 'docs/x.md', section: 'y', fingerprint: 'sha256:y' },
        outcome: 'pass',
        durationMs: 8,
      },
    ]
    writeGuardLatest(r, latest)

    const read = readGuardLatest(r)!
    expect(read.scenarios[0].stage).toBe('birth')
    expect(read.scenarios[1].stage).toBeUndefined()
    // Absent reads as `run` through the shared accessor — never as "unknown".
    expect(read.scenarios.map(guardResultStage)).toEqual(['birth', 'run'])
  })
})

describe('guard store — generate report', () => {
  const report: GuardGenerateReport = {
    generatedAt: '2026-01-04T00:00:00.000Z',
    status: 'ok',
    recipe: { status: 'exists', entry: ['node', 'dist/index.js'] },
    sectionsTotal: 3,
    sectionsChanged: 1,
    skippedUnchanged: 2,
    noChanges: false,
    written: [{ id: 'x.1', title: 'X', doc: 'docs/x.md', anchor: 'x', file: '.truecourse/scenarios/x/x.1.yaml' }],
    coverageGaps: [{ doc: 'docs/x.md', anchor: 'y', kind: 'untestable', reason: 'no CLI-assertable claim' }],
    birthFindings: [
      { doc: 'docs/x.md', anchor: 'z', title: 'Z fails', step: 1, expected: 'exit 0', actual: 'exit 1' },
    ],
    errors: [],
    extractionFailures: [{ doc: 'docs/broken.md', reason: 'invalid output after re-ask' }],
    orphaned: [{ doc: 'docs/gone.md', anchor: 'g', scenarioIds: ['g.1'] }],
    usage: { calls: 4, inputTokens: 1200, outputTokens: 800, costUsd: 0.42 },
  }

  it('writes and reads a report unchanged', () => {
    const r = repo()
    const path = writeGuardResult(r, report)
    expect(path).toBe(guardResultPath(r))
    expect(readGuardResult(r)).toEqual(report)
  })

  it('rejects OLD-shape driver gaps (kind "api") — the store speaks only the new syntax', () => {
    const r = repo()
    fs.mkdirSync(guardRunsDir(r), { recursive: true })
    // Pre-un-conflation rows (flat `kind:'api'`) are NOT silently translated: any
    // legacy file must be migrated on disk once (as the dogfood store was); a
    // tolerant read here would be a permanent workaround for a one-time problem.
    const legacy = {
      generatedAt: '2026-01-05T00:00:00.000Z',
      status: 'ok',
      sectionsTotal: 1,
      sectionsChanged: 1,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [{ doc: 'docs/x.md', anchor: 'a', kind: 'api', reason: 'needs the api driver' }],
      birthFindings: [],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    }
    fs.writeFileSync(guardResultPath(r), JSON.stringify(legacy))
    // Tolerant-read convention: schema-invalid → null, never a throw.
    expect(readGuardResult(r)).toBeNull()

    // The NEW shape reads cleanly.
    const migrated = {
      ...legacy,
      coverageGaps: [
        { doc: 'docs/x.md', anchor: 'a', kind: 'awaiting-driver', driver: 'api', reason: 'needs the api driver' },
      ],
    }
    fs.writeFileSync(guardResultPath(r), JSON.stringify(migrated))
    expect(readGuardResult(r)!.coverageGaps[0]).toMatchObject({ kind: 'awaiting-driver', driver: 'api' })
  })

  it('returns null when absent, and tolerates a corrupt file', () => {
    const r = repo()
    expect(readGuardResult(r)).toBeNull()
    fs.mkdirSync(guardRunsDir(r), { recursive: true })
    fs.writeFileSync(guardResultPath(r), '<<<not json')
    expect(readGuardResult(r)).toBeNull()
  })
})
