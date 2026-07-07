import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import { guardGenerateInProcess } from '@truecourse/core/commands/guard-in-process'
import { composeGuardStatus, orderGuardDrifts } from '@truecourse/shared'
import {
  writeGuardLatest,
  writeGuardResult,
  readGuardResult,
  guardResultPath,
} from '@truecourse/guard-runner'
import {
  GuardGenerateReportSchema,
  GUARD_FORMAT_VERSION,
  type GuardManifest,
  type GuardManifestSection,
  type GuardLatest,
  type GuardScenarioResult,
  type GuardOutcome,
  type GuardGenerateReport,
} from '@truecourse/shared'
import { runGuardStatus, runGuardDrifts, printGuardGenerateSummary } from '../../tools/cli/src/commands/guard'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  authorBy,
  raw,
  PASSING_STEPS,
} from '../guard-generator/helpers.js'

const repos: string[] = []
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')

// ---------------------------------------------------------------------------
// Report persisted at the end of a generate (runner-injection, no real LLM).
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — persisted report', () => {
  it('writes a schema-valid guard/result.json after a completed generate', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { guard } = await guardGenerateInProcess(r, {
      extractRunner: extractBy({ background: { untestable: 'design history' } }),
      generateRunner: authorBy({ version: [raw('relkit --version exits 0', PASSING_STEPS)] }),
    })

    expect(guard.status).toBe('ok')
    expect(fs.existsSync(guardResultPath(r))).toBe(true)

    const report = readGuardResult(r)
    expect(report).not.toBeNull()
    expect(() => GuardGenerateReportSchema.parse(report)).not.toThrow()
    expect(report!.status).toBe('ok')
    expect(report!.written.map((w) => w.anchor)).toEqual(['version'])
    expect(report!.birthPassed).toBe(1)
    expect(report!.coverageGaps.map((g) => g.kind)).toContain('untestable')
    expect(report!.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    // Injected runners bypass the transport, so no usage is recorded.
    expect(report!.usage).toBeUndefined()
  })

  it('writes the report even on a noChanges no-op', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const runners = {
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    }
    await guardGenerateInProcess(r, runners)
    fs.rmSync(guardResultPath(r)) // prove the second run rewrites it

    const { guard } = await guardGenerateInProcess(r, runners)
    expect(guard.noChanges).toBe(true)
    expect(fs.existsSync(guardResultPath(r))).toBe(true)
    expect(readGuardResult(r)!.noChanges).toBe(true)
  })

  it('does NOT write the report when the estimate gate declines', async () => {
    const r = repo()
    // No recipe.json → the estimate carries a recipe-discovery stage → the gate fires.
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    await expect(
      guardGenerateInProcess(r, { onLlmEstimate: async () => false }),
    ).rejects.toThrow(/declined/)

    expect(fs.existsSync(guardResultPath(r))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Pure composition — composeGuardStatus.
// ---------------------------------------------------------------------------

function section(over: Partial<GuardManifestSection>): GuardManifestSection {
  return {
    doc: 'docs/x.md',
    anchor: 'a',
    fingerprint: 'sha256:x',
    scenarioIds: [],
    generationInputsHash: null,
    ...over,
  }
}

function report(over: Partial<GuardGenerateReport> = {}): GuardGenerateReport {
  return {
    generatedAt: '2026-01-02T03:04:05.000Z',
    status: 'ok',
    sectionsTotal: 0,
    sectionsChanged: 0,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    ...over,
  }
}

describe('composeGuardStatus', () => {
  it('returns all-null when every store file is absent', () => {
    const s = composeGuardStatus(null, null, null)
    expect(s).toEqual({ coverage: null, lastRun: null, lastGenerate: null })
  })

  it('summarizes coverage: guarded count + classification counts', () => {
    const manifest: GuardManifest = {
      guard: GUARD_FORMAT_VERSION,
      sections: [
        section({ anchor: 'a', scenarioIds: ['a.1'], classification: { driver: 'cli', reason: 'x' } }),
        section({ anchor: 'b', scenarioIds: [], classification: { driver: 'api', reason: 'x' } }),
        section({ anchor: 'c', scenarioIds: [], classification: { untestable: true, reason: 'x' } }),
        section({ anchor: 'd', scenarioIds: ['d.1'] }), // no classification → unclassified
      ],
    }
    const s = composeGuardStatus(manifest, null, null)
    expect(s.coverage).toEqual({
      totalSections: 4,
      withScenarios: 2,
      classification: { cli: 1, api: 1, web: 0, tui: 0, untestable: 1, unclassified: 1 },
    })
    expect(s.lastRun).toBeNull()
    expect(s.lastGenerate).toBeNull()
  })

  it('summarizes the last generate: written, birthPassed, gaps-by-kind, findings, errors', () => {
    const rep = report({
      written: [{ id: 'v.1', title: 't', doc: DOC, anchor: 'version', file: 'x.yaml' }],
      birthPassed: 3,
      coverageGaps: [
        { doc: DOC, anchor: 'a', kind: 'untestable', reason: 'r' },
        { doc: DOC, anchor: 'b', kind: 'awaiting-driver', driver: 'api', reason: 'r' },
        { doc: DOC, anchor: 'c', kind: 'untestable', reason: 'r' },
      ],
      birthFindings: [{ doc: DOC, anchor: 'a', title: 't', step: 1, expected: 'e', actual: 'a' }],
      errors: [{ doc: DOC, anchor: 'a', message: 'boom' }],
      usage: { calls: 5, inputTokens: 100, outputTokens: 40, costUsd: 0.42 },
    })
    const s = composeGuardStatus(null, null, rep)
    expect(s.lastGenerate).toMatchObject({
      written: 1,
      birthPassed: 3,
      coverageGapsByKind: { api: 1, web: 0, tui: 0, untestable: 2, 'no-claim': 0 },
      birthFindings: 1,
      errors: 1,
      usage: { calls: 5, costUsd: 0.42 },
    })
  })

  it('counts blocked-on gaps and aggregates their capability nouns', () => {
    const rep = report({
      coverageGaps: [
        { doc: DOC, anchor: 'a', kind: 'blocked-on', reason: 'blocked on git: needs a repo' },
        { doc: DOC, anchor: 'b', kind: 'blocked-on', reason: 'blocked on git, db: needs both' },
        { doc: DOC, anchor: 'c', kind: 'no-claim', reason: 'nothing assertable' },
      ],
    })
    const s = composeGuardStatus(null, null, rep)
    expect(s.lastGenerate).toMatchObject({
      coverageGapsByKind: { 'blocked-on': 2, 'no-claim': 1 },
      blockedOnCapabilities: { git: 2, db: 1 },
    })
  })

  it('round-trips a blocked-on coverage gap through the report schema', () => {
    const rep = report({
      coverageGaps: [{ doc: DOC, anchor: 'a', kind: 'blocked-on', reason: 'blocked on git, db: c' }],
    })
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
  })

  it('composes a partial view (only the last run present)', () => {
    const s = composeGuardStatus(null, sampleLatest([scn('a', 'pass'), scn('b', 'fail')]), null)
    expect(s.coverage).toBeNull()
    expect(s.lastGenerate).toBeNull()
    expect(s.lastRun?.summary).toMatchObject({ total: 2, pass: 1, fail: 1 })
  })
})

// ---------------------------------------------------------------------------
// Pure ordering — orderGuardDrifts.
// ---------------------------------------------------------------------------

function scn(id: string, outcome: GuardOutcome, over: Partial<GuardScenarioResult> = {}): GuardScenarioResult {
  return {
    id,
    title: `${id} title`,
    binds: { doc: 'docs/x.md', section: `${id}/sec`, fingerprint: 'sha256:x' },
    outcome,
    durationMs: 1,
    ...over,
  }
}

function sampleLatest(scenarios: GuardScenarioResult[]): GuardLatest {
  const summary = { total: scenarios.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 }
  for (const s of scenarios) summary[s.outcome]++
  return {
    run: {
      runId: '2026-01-01_abc',
      ranAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commit: 'deadbeefcafef00d',
      recipeFingerprint: 'sha256:r',
      scenarioFormat: GUARD_FORMAT_VERSION,
    },
    summary,
    scenarios,
    sections: [],
  }
}

describe('orderGuardDrifts', () => {
  it('returns [] when there is no run', () => {
    expect(orderGuardDrifts(null)).toEqual([])
  })

  it('excludes passes and orders fail → error → stale → orphaned', () => {
    const latest = sampleLatest([
      scn('p', 'pass'),
      scn('o', 'orphaned'),
      scn('s', 'stale'),
      scn('f', 'fail'),
      scn('e', 'error'),
    ])
    expect(orderGuardDrifts(latest.scenarios).map((d) => d.id)).toEqual(['f', 'e', 's', 'o'])
  })

  it('preserves original order within the same outcome tier', () => {
    const latest = sampleLatest([scn('f2', 'fail'), scn('f1', 'fail'), scn('f3', 'fail')])
    expect(orderGuardDrifts(latest.scenarios).map((d) => d.id)).toEqual(['f2', 'f1', 'f3'])
  })
})

// ---------------------------------------------------------------------------
// CLI printers — runGuardStatus / runGuardDrifts.
// ---------------------------------------------------------------------------

describe('runGuardStatus (printer)', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('prints a helpful pointer on a fresh repo (all three files absent)', async () => {
    const r = repo()
    await runGuardStatus({ cwd: r })
    expect(out).toContain('No guard data yet')
    expect(out).toContain('guard generate')
    expect(out).toContain('guard run')
  })

  it('renders coverage + last-run blocks when present', async () => {
    const r = repo()
    writeGuardLatest(r, sampleLatest([scn('a', 'pass'), scn('b', 'fail')]))
    await runGuardStatus({ cwd: r })
    expect(out).toContain('last run')
    expect(out).toContain('1 pass')
    expect(out).toContain('1 fail')
    // coverage file (manifest) still absent → its block reads (none)
    expect(out).toContain('coverage    (none)')
  })

  it('renders the blocked-on gap count with its capability breakdown', async () => {
    const r = repo()
    writeGuardResult(
      r,
      report({
        sectionsChanged: 2,
        coverageGaps: [
          { doc: DOC, anchor: 'a', kind: 'blocked-on', reason: 'blocked on git: c1' },
          { doc: DOC, anchor: 'b', kind: 'blocked-on', reason: 'blocked on git, db: c2' },
        ],
      }),
    )
    await runGuardStatus({ cwd: r })
    expect(out).toContain('2 blocked-on (git 2, db 1)')
  })
})

describe('runGuardDrifts (printer)', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('points at `guard run` when there is no run', async () => {
    const r = repo()
    await runGuardDrifts({ cwd: r })
    expect(out).toContain('No guard run yet')
    expect(out).toContain('guard run')
  })

  it('reports no drift when every scenario passed', async () => {
    const r = repo()
    writeGuardLatest(r, sampleLatest([scn('a', 'pass'), scn('b', 'pass')]))
    await runGuardDrifts({ cwd: r })
    expect(out).toContain('No drift')
  })

  it('lists non-pass scenarios most-severe-first with the section anchor', async () => {
    const r = repo()
    writeGuardLatest(
      r,
      sampleLatest([
        scn('p', 'pass'),
        scn('o', 'orphaned'),
        scn('f', 'fail', {
          failure: { step: 2, expected: 'exit 0', actual: 'exit 7' },
          evidencePath: '.truecourse/guard/evidence/run/f',
        }),
      ]),
    )
    await runGuardDrifts({ cwd: r })
    expect(out).toContain('[fail] f')
    expect(out).toContain('f/sec')
    expect(out).toContain('step 2')
    expect(out).toContain('evidence:')
    // fail is listed before orphaned; pass is excluded.
    expect(out.indexOf('[fail] f')).toBeLessThan(out.indexOf('[orphaned] o'))
    expect(out).not.toContain('[pass]')
    expect(out).toContain('Showing 1–2 of 2')
  })

  it('--json emits { total, drifts[] } in severity order, passes excluded', async () => {
    const r = repo()
    writeGuardLatest(
      r,
      sampleLatest([
        scn('p', 'pass'),
        scn('s', 'stale'),
        scn('f', 'fail', { failure: { step: 1, expected: 'e', actual: 'a' }, evidencePath: 'ev/f' }),
      ]),
    )
    // JSON goes to console.log (vitest intercepts it, so capture it directly).
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runGuardDrifts({ cwd: r, json: true })
    const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    logSpy.mockRestore()

    const parsed = JSON.parse(printed)
    expect(parsed.total).toBe(2)
    expect(parsed.drifts.map((d: { outcome: string }) => d.outcome)).toEqual(['fail', 'stale'])
    expect(parsed.drifts[0]).toMatchObject({
      id: 'f',
      outcome: 'fail',
      doc: 'docs/x.md',
      section: 'f/sec',
      failure: { step: 1 },
      evidencePath: 'ev/f',
    })
    // No clack intro/outro decoration reaches stdout in JSON mode.
    expect(out).toBe('')
  })

  it('paginates with --offset / --all like `drifts list`', async () => {
    const r = repo()
    const many = Array.from({ length: 25 }, (_, i) => scn(`f${i}`, 'fail'))
    writeGuardLatest(r, sampleLatest(many))
    await runGuardDrifts({ cwd: r, limit: 20, offset: 0 })
    expect(out).toContain('5 more')
    expect(out).toContain('guard drifts --offset 20')
    expect(out).toContain('Showing 1–20 of 25')
  })
})

// ---------------------------------------------------------------------------
// Generate closing summary — printGuardGenerateSummary (counts + top-3 + pointers).
// ---------------------------------------------------------------------------

describe('printGuardGenerateSummary', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('renders a compact counts block reusing the status summary', () => {
    const rep = report({
      sectionsChanged: 5,
      skippedUnchanged: 40,
      written: [{ id: 'v.1', title: 't', doc: DOC, anchor: 'version', file: 'x.yaml' }],
      birthPassed: 3,
      coverageGaps: [
        { doc: DOC, anchor: 'a', kind: 'untestable', reason: 'r' },
        { doc: DOC, anchor: 'b', kind: 'blocked-on', reason: 'blocked on git: needs a repo' },
      ],
      birthFindings: [{ doc: DOC, anchor: 'cli/version', title: 'prints semver', step: 1, expected: 'e', actual: 'a' }],
      errors: [{ doc: DOC, anchor: 'cli/build', message: 'authoring returned no output' }],
      usage: { calls: 5, inputTokens: 100, outputTokens: 40, costUsd: 0.42 },
    })
    printGuardGenerateSummary(rep, '.truecourse/guard/result.json')

    // Two distinct unsettled sections (version + build) out of 5 changed → 3 settled.
    expect(out).toContain('5 changed · 3 settled · 2 unsettled · 40 unchanged')
    expect(out).toContain('1 written · 3 passed birth')
    expect(out).toContain('2 not guarded')
    expect(out).toContain('blocked-on (git 1)')
    expect(out).toContain('1 birth finding')
    expect(out).toContain('1 authoring error')
    expect(out).toContain('$0.42')
    // Pointers to the detail surfaces.
    expect(out).toContain('truecourse guard drifts')
    expect(out).toContain('truecourse guard status')
    expect(out).toContain('.truecourse/guard/result.json')
  })

  it('shows at most the top 3 birth findings, then a truncation pointer', () => {
    const birthFindings = Array.from({ length: 10 }, (_, i) => ({
      doc: DOC,
      anchor: `sec/f${i}`,
      title: `finding ${i}`,
      step: 1,
      expected: 'e',
      actual: 'a',
    }))
    printGuardGenerateSummary(report({ sectionsChanged: 10, birthFindings }), 'p')

    expect(out).toContain('finding 0 — f0')
    expect(out).toContain('finding 2 — f2')
    expect(out).not.toContain('finding 3')
    expect(out).toContain('… and 7 more — see `truecourse guard drifts`')
  })

  it('shows at most the top 3 authoring errors, then a truncation pointer', () => {
    const errors = Array.from({ length: 5 }, (_, i) => ({ doc: DOC, anchor: `sec/e${i}`, message: `boom ${i}` }))
    printGuardGenerateSummary(report({ sectionsChanged: 5, errors }), 'p')

    expect(out).toContain('e0: boom 0')
    expect(out).toContain('e2: boom 2')
    expect(out).not.toContain('boom 3')
    expect(out).toContain('… and 2 more')
  })

  it('prints only the counts block and pointers when there are no findings or errors', () => {
    printGuardGenerateSummary(
      report({
        sectionsChanged: 2,
        written: [{ id: 'a.1', title: 't', doc: DOC, anchor: 'a', file: 'a.yaml' }],
        birthPassed: 1,
      }),
      'REPORT_PATH',
    )
    expect(out).toContain('2 changed · 2 settled · 0 unsettled')
    expect(out).not.toContain('Top birth finding')
    expect(out).not.toContain('Top authoring error')
    expect(out).toContain('REPORT_PATH')
  })
})
