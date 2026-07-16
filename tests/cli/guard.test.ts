import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import { guardGenerateInProcess, GUARD_GENERATE_STEPS } from '@truecourse/core/commands/guard-in-process'
import { StepTracker, type AnalysisProgressPayload } from '@truecourse/core/progress'
import { composeGuardStatus, orderGuardDrifts } from '@truecourse/shared'
import {
  writeGuardLatest,
  writeGuardResult,
  readGuardResult,
  guardResultPath,
  writeManifest,
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
import { runGuardRun, runGuardStatus, runGuardDrifts, runGuardFindings, printGuardGenerateSummary } from '../../tools/cli/src/commands/guard'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  authorBy,
  raw,
  faithfulReviewer,
  PASSING_STEPS,
  FAILING_STEPS,
} from '../guard-generator/helpers.js'
import {
  writeRecipe as writeRunRecipe,
  writeScenario as writeRunScenario,
  scenario as scenarioDef,
  specBinds,
} from '../guard-runner/helpers.js'
import { execSync } from 'node:child_process'
import { recordStageUsage } from '@truecourse/shared/llm'
import type { GenerateRunner, FidelityRunner } from '@truecourse/guard-generator'

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
      fidelityRunner: faithfulReviewer(),
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
      fidelityRunner: faithfulReviewer(),
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
// Grounding progress reaches the tracker (CLI + dashboard consume the same one).
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — grounding progress on the author step', () => {
  /** Collect every distinct detail the author step showed across the run. */
  function trackAuthorDetails(): { tracker: StepTracker; details: string[] } {
    const details: string[] = []
    const tracker = new StepTracker((payload: AnalysisProgressPayload) => {
      const author = payload.steps?.find((s) => s.key === 'author')
      if (author?.detail && details[details.length - 1] !== author.detail) details.push(author.detail)
    }, GUARD_GENERATE_STEPS.map((s) => ({ ...s })))
    return { tracker, details }
  }

  it('surfaces "grounding probes X/Y · authoring Z/W claims" on the author detail', async () => {
    const r = repo()
    writeRecipe(r) // build 'true' → probing runs
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { tracker, details } = trackAuthorDetails()
    await guardGenerateInProcess(r, {
      tracker,
      extractRunner: extractBy({
        version: [{ claim: '`--version` prints the version and exits 0' }],
        background: { untestable: 'design history' },
      }),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: faithfulReviewer(),
    })

    // The grounding counter rode the author step's detail line at least once.
    expect(details.some((d) => /grounding probes \d+\/\d+ · authoring \d+\/\d+ claim/.test(d))).toBe(true)
  })

  it('shows the plain claim counter (no grounding prefix) when no probes run', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const runners = {
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: faithfulReviewer(),
    }
    await guardGenerateInProcess(r, runners) // warm the authoring cache

    // Re-work `version` (empty manifest); authoring is now a per-claim cache HIT, so
    // no batch enters grounding and no probes run.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    const { tracker, details } = trackAuthorDetails()
    await guardGenerateInProcess(r, { tracker, ...runners })

    expect(details.some((d) => d.includes('grounding'))).toBe(false)
    expect(details.some((d) => /\d+\/\d+ claim/.test(d))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Extract step units: live "views X/Y" (planned denominator from the first
// tick), completed "N doc(s) · M view(s)" — the same units end to end.
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — extract step units', () => {
  /** Collect every distinct extract detail, split by live vs completed. */
  function trackExtractDetails(): { tracker: StepTracker; live: string[]; done: string[] } {
    const live: string[] = []
    const done: string[] = []
    const tracker = new StepTracker((payload: AnalysisProgressPayload) => {
      const step = payload.steps?.find((s) => s.key === 'extract')
      if (!step?.detail) return
      const bucket = step.status === 'done' ? done : live
      if (bucket[bucket.length - 1] !== step.detail) bucket.push(step.detail)
    }, GUARD_GENERATE_STEPS.map((s) => ({ ...s })))
    return { tracker, live, done }
  }

  it('live counter shows "views X/Y" with the planned denominator from the start; completion reports docs AND views', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { tracker, live, done } = trackExtractDetails()
    await guardGenerateInProcess(r, {
      tracker,
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: faithfulReviewer(),
    })

    // Every live tick carries the denominator — never a bare count.
    expect(live.length).toBeGreaterThan(0)
    for (const d of live) expect(d).toMatch(/^views \d+\/\d+/)
    // The planned total is visible before the first view resolves (0/N).
    expect(live[0]).toMatch(/^views 0\/\d+/)
    // Completed line keeps both units: one doc read, one extraction view called.
    expect(done).toHaveLength(1)
    expect(done[0]).toMatch(/^1 doc · 1 view\b/)
  })
})

// ---------------------------------------------------------------------------
// `guard run` output: passes stay in the live counter, non-pass results stream
// inline as they settle, the close is a counts summary (+ drift pointers on
// non-green runs); `--verbose` restores the full per-scenario listing.
// ---------------------------------------------------------------------------

describe('runGuardRun — output shape', () => {
  function gitInit(r: string): void {
    execSync('git init -q -b main', { cwd: r })
  }

  /** Run `guard run` capturing stdout (clack) + stderr (renderer) and the exit code. */
  async function captureRun(
    r: string,
    opts: { verbose?: boolean } = {},
  ): Promise<{ out: string; err: string; exitCode: number | null }> {
    let exitCode: number | null = null
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${code})`)
    }) as never)
    const capture = (chunks: string[]) =>
      ((chunk: unknown, ...rest: unknown[]) => {
        chunks.push(typeof chunk === 'string' ? chunk : String(chunk))
        const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined
        cb?.()
        return true
      }) as never
    const outChunks: string[] = []
    const errChunks: string[] = []
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(capture(outChunks))
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(capture(errChunks))
    try {
      await runGuardRun({ cwd: r, verbose: opts.verbose })
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e
    } finally {
      outSpy.mockRestore()
      errSpy.mockRestore()
      exitSpy.mockRestore()
    }
    return { out: outChunks.join(''), err: errChunks.join(''), exitCode }
  }

  it('default: no per-pass lines; non-pass results stream inline; drift close = counts + pointers', async () => {
    const r = repo()
    gitInit(r)
    writeRunRecipe(r)
    writeRunScenario(
      r,
      'cli/ver.yaml',
      scenarioDef({ id: 'ver', title: 'prints the version', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    writeRunScenario(
      r,
      'cli/boom.yaml',
      scenarioDef({ id: 'boom.fail', title: 'boom exits clean', binds: specBinds('cli/boom'), steps: [{ run: ['boom'], expect: { exit: 0 } }] }),
    )
    writeRunScenario(
      r,
      'cli/stale.yaml',
      scenarioDef({
        id: 'stale1',
        title: 'edited section',
        binds: { ...specBinds('cli/whoami'), fingerprint: 'sha256:bogus' },
        steps: [{ run: ['whoami'], expect: { exit: 0 } }],
      }),
    )

    const { out, err, exitCode } = await captureRun(r)

    // Passing scenarios never print a ✓ line — they live in the counter + counts.
    expect(out).not.toContain('✓ ver')
    expect(err).not.toContain('✓ ver')
    // Non-pass results streamed inline (renderer log), a full line each with icon.
    expect(err).toMatch(/✗ boom\.fail — boom exits clean {2}\(\d+ms\)/)
    expect(err).toContain('~ stale1 — edited section  — section edited since binding')
    // The close: counts per outcome + pointers; the expected/actual dump is gone.
    expect(out).toContain('1 passed · 1 failed · 1 stale')
    expect(out).toContain('truecourse guard drifts')
    expect(out).not.toContain('expected:')
    expect(exitCode).toBe(1)
  })

  it('green run: terse close — counts + outro, no scenario listing, no drift pointers', async () => {
    const r = repo()
    gitInit(r)
    writeRunRecipe(r)
    writeRunScenario(
      r,
      'cli/ver.yaml',
      scenarioDef({ id: 'ver', title: 'prints the version', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    writeRunScenario(
      r,
      'cli/who.yaml',
      scenarioDef({ id: 'who', title: 'whoami works', binds: specBinds('cli/whoami'), steps: [{ run: ['whoami'], expect: { exit: 0 } }] }),
    )

    const { out, err, exitCode } = await captureRun(r)

    expect(out).toContain('2 passed')
    expect(out).toContain('All sections guarded.')
    expect(out).not.toMatch(/✓ (ver|who) —/)
    expect(err).not.toMatch(/✓ (ver|who) —/)
    expect(out).not.toContain('truecourse guard drifts')
    expect(exitCode).toBeNull()
  })

  it('--verbose restores the per-scenario ✓ listing', async () => {
    const r = repo()
    gitInit(r)
    writeRunRecipe(r)
    writeRunScenario(
      r,
      'cli/ver.yaml',
      scenarioDef({ id: 'ver', title: 'prints the version', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )

    const { out } = await captureRun(r, { verbose: true })
    expect(out).toMatch(/✓ ver — prints the version {2}\(\d+ms\)/)
  })
})

// ---------------------------------------------------------------------------
// Sections-led birth line + retry spend attribution (stage guard.retry).
// ---------------------------------------------------------------------------

describe('guardGenerateInProcess — sections-led birth line + retry usage', () => {
  /** Collect every distinct detail the validate (birth) step showed across the run. */
  function trackValidateDetails(): { tracker: StepTracker; details: string[] } {
    const details: string[] = []
    const tracker = new StepTracker((payload: AnalysisProgressPayload) => {
      const step = payload.steps?.find((s) => s.key === 'validate')
      if (step?.detail && details[details.length - 1] !== step.detail) details.push(step.detail)
    }, GUARD_GENERATE_STEPS.map((s) => ({ ...s })))
    return { tracker, details }
  }

  it('leads the birth line with the fixed sections denominator and a plain birth count', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { tracker, details } = trackValidateDetails()
    await guardGenerateInProcess(r, {
      tracker,
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: faithfulReviewer(),
    })

    // Every live line leads with the fixed work-section denominator (2 for DOC).
    const live = details.filter((d) => /^sections /.test(d))
    expect(live.length).toBeGreaterThan(0)
    expect(live.every((d) => /^sections \d+\/2 · (building…|birth \d+)/.test(d))).toBe(true)
    // The birth count carries NO denominator — its total grows per section.
    expect(live.some((d) => /birth \d+\//.test(d))).toBe(false)
  })

  it('shows retrying R/T with the live guard.retry usage tag, and totals retry spend in the report', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // Round 1 fails birth, the evidence-retry fixes it. The runner records usage
    // the way the transport would: round 1 under guard.generate, the retry under
    // guard.retry.
    const runner: GenerateRunner = async ({ claims }) => {
      const isRetry = claims.some((c) => c.retry)
      recordStageUsage(isRetry ? 'guard.retry' : 'guard.generate', {
        model: isRetry ? 'retry-model' : 'gen-model',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: isRetry ? 0.5 : 0.25,
      })
      return claims.map((c) => ({ ref: c.ref, scenarios: c.retry ? [raw('fixed', PASSING_STEPS)] : [raw('broken', FAILING_STEPS)] }))
    }

    const { tracker, details } = trackValidateDetails()
    const { guard } = await guardGenerateInProcess(r, {
      tracker,
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      generateRunner: runner,
      fidelityRunner: faithfulReviewer(),
    })
    expect(guard.written.map((w) => w.title)).toEqual(['fixed'])

    // The retry counter and the guard.retry usage (model recorded on the retry
    // call) ride the SAME birth line.
    expect(details.some((d) => /^sections \d+\/2 · birth \d+ · retrying \d+\/\d+ · retry-model/.test(d))).toBe(true)

    // result.json totals include the retry spend under the new stage.
    const report = readGuardResult(r)!
    expect(report.usage).toEqual({ calls: 2, inputTokens: 200, outputTokens: 100, costUsd: 0.75 })
  })

  it('shows the fidelity counter on the birth line and totals fidelity spend under guard.fidelity', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The reviewer records usage the way the transport would — under guard.fidelity.
    const reviewer: FidelityRunner = async () => {
      recordStageUsage('guard.fidelity', { model: 'fidelity-model', inputTokens: 80, outputTokens: 10, costUsd: 0.1 })
      return { verdict: 'faithful' }
    }

    const { tracker, details } = trackValidateDetails()
    const { guard } = await guardGenerateInProcess(r, {
      tracker,
      extractRunner: extractBy({ background: { untestable: 'history' } }),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: reviewer,
    })
    expect(guard.written.map((w) => w.anchor)).toEqual(['version'])

    // The fidelity counter rides the SAME validate (birth) line.
    expect(details.some((d) => /^sections \d+\/2 · .*fidelity 1/.test(d))).toBe(true)

    // result.json totals include the fidelity-review spend under the new stage.
    const report = readGuardResult(r)!
    expect(report.usage).toEqual({ calls: 1, inputTokens: 80, outputTokens: 10, costUsd: 0.1 })
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
      classification: { cli: 1, api: 1, web: 0, tui: 0, library: 0, untestable: 1, unclassified: 1 },
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

  it('surfaces the ready-but-held count in the last-generate block', async () => {
    const r = repo()
    writeGuardResult(
      r,
      report({
        sectionsChanged: 2,
        written: [{ id: 'v.1', title: 't', doc: DOC, anchor: 'version', file: 'x.yaml' }],
        birthPassed: 2,
        errors: [{ doc: DOC, anchor: 'auth/login', message: 'boom' }],
        heldSections: [{ doc: DOC, anchor: 'auth/login', readyScenarios: [{ id: 'login.1', title: 'g', yaml: 'y' }] }],
      }),
    )
    await runGuardStatus({ cwd: r })
    expect(out).toContain('1 ready but held')
  })

  it('mentions the dismissed count as a gaps segment', async () => {
    const r = repo()
    writeGuardResult(
      r,
      report({
        sectionsChanged: 1,
        coverageGaps: [{ doc: DOC, anchor: 'version', kind: 'dismissed', reason: 'dismissed: the --version claim' }],
      }),
    )
    await runGuardStatus({ cwd: r })
    expect(out).toContain('1 dismissed')
  })
})

describe('printGuardGenerateSummary (printer)', () => {
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

  it('surfaces orphaned dismissals (stale decisions) as a line', () => {
    printGuardGenerateSummary(
      report({
        sectionsChanged: 1,
        orphanedDismissals: [{ doc: DOC, anchor: 'version', title: 'a claim that no longer exists' }],
      }),
      '.truecourse/guard/result.json',
    )
    expect(out).toContain('1 orphaned')
    expect(out).toContain('decisions.json')
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

  it('renders the "doc says" claim line so a failure reads as doc-vs-code', async () => {
    const r = repo()
    writeGuardLatest(
      r,
      sampleLatest([
        scn('f', 'fail', {
          claim: 'the fixer never corrupts a valid file',
          failure: { step: 1, expected: 'exit 0', actual: 'exit 2' },
        }),
      ]),
    )
    await runGuardDrifts({ cwd: r })
    expect(out).toContain('doc says: the fixer never corrupts a valid file')
  })

  it('omits the claim line for a drift that carries no claim (pre-claim scenario)', async () => {
    const r = repo()
    writeGuardLatest(r, sampleLatest([scn('f', 'fail')]))
    await runGuardDrifts({ cwd: r })
    expect(out).not.toContain('doc says:')
  })

  it('--json carries the claim on a drift', async () => {
    const r = repo()
    writeGuardLatest(
      r,
      sampleLatest([scn('f', 'fail', { claim: 'never corrupts a valid file', failure: { step: 1, expected: 'e', actual: 'a' } })]),
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runGuardDrifts({ cwd: r, json: true })
    const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    logSpy.mockRestore()
    expect(JSON.parse(printed).drifts[0].claim).toBe('never corrupts a valid file')
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

  it('lists ALL failed authoring sections (deduped by doc+anchor), no top-3 cap', () => {
    const errors = Array.from({ length: 5 }, (_, i) => ({ doc: DOC, anchor: `sec/e${i}`, message: `boom ${i}` }))
    printGuardGenerateSummary(report({ sectionsChanged: 5, errors }), 'p')

    // Every failed section, one line each — no truncation pointer.
    for (let i = 0; i < 5; i++) expect(out).toContain(`✗ e${i} — boom ${i}`)
    expect(out).not.toContain('… and')
    expect(out).toContain('re-run generate to retry')
  })

  it('collapses a section\'s repeated errors into one line with an attempt count', () => {
    const errors = [
      // Two timed-out claims under one section → "timed out (2 attempts)".
      { doc: DOC, anchor: 'cli/slow', message: 'authoring call failed: claude timed out after 600000ms' },
      { doc: DOC, anchor: 'cli/slow', message: 'authoring call failed: claude timed out after 600000ms' },
      // A section whose model returned invalid output on both tries.
      { doc: DOC, anchor: 'cli/bad', message: 'authoring output invalid after re-ask: bad shape' },
    ]
    printGuardGenerateSummary(report({ sectionsChanged: 2, errors }), 'p')

    expect(out).toContain('✗ slow — timed out (2 attempts)')
    expect(out).toContain('✗ bad — invalid output twice')
    // Deduped to two section lines, not four raw entries.
    expect(out).not.toContain('600000ms')
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
    expect(out).not.toContain('ready but held')
    expect(out).toContain('REPORT_PATH')
  })

  it('renders the ready-but-held line, blamed on its sections\' findings + errors', () => {
    const rep = report({
      sectionsChanged: 3,
      written: [{ id: 'v.1', title: 't', doc: DOC, anchor: 'version', file: 'x.yaml' }],
      birthPassed: 4,
      birthFindings: [{ doc: DOC, anchor: 'auth/login', title: 'f', step: 1, expected: 'e', actual: 'a' }],
      errors: [{ doc: DOC, anchor: 'auth/logout', message: 'boom' }],
      heldSections: [
        {
          doc: DOC,
          anchor: 'auth/login',
          readyScenarios: [
            { id: 'login.1', title: 'g1', yaml: 'y' },
            { id: 'login.2', title: 'g2', yaml: 'y' },
          ],
        },
        { doc: DOC, anchor: 'auth/logout', readyScenarios: [{ id: 'logout.1', title: 'g3', yaml: 'y' }] },
      ],
    })
    printGuardGenerateSummary(rep, 'p')
    // 3 held (2 + 1); blocked by 1 finding (auth/login) and 1 error (auth/logout).
    expect(out).toContain('3 ready but held (1 finding · 1 error)')
  })
})

// ---------------------------------------------------------------------------
// `truecourse guard findings` — grouped/numbered review list over result.json,
// with `--kind`/`--doc` filters and a raw `--json` array.
// ---------------------------------------------------------------------------

const WRITTEN = [{ id: 'v.1', title: 't', doc: DOC, anchor: 'cli/version', file: 'x.yaml' }]

/** Three findings across two sections: two under docs/cli.md › cli/version
 *  (one birth, one fidelity), one birth under docs/api.md › api/auth. */
function findingsReport(): GuardGenerateReport {
  return report({
    sectionsTotal: 12,
    sectionsChanged: 3,
    written: WRITTEN,
    birthPassed: 5,
    birthFindings: [
      {
        doc: DOC,
        anchor: 'cli/version',
        kind: 'birth',
        title: 'prints semver',
        step: 1,
        expected: 'exit 0',
        actual: 'exit 7',
        evidencePath: '.truecourse/guard/evidence/run/f1',
        triage: {
          verdict: 'code-drift',
          confidence: 'high',
          brief: 'The command exits 7 where the doc promises 0.',
          recommendation: 'Fix the exit code to 0 to match the documented contract.',
        },
      },
      { doc: DOC, anchor: 'cli/version', kind: 'fidelity', title: 'weak assertion', step: 1, expected: 'n/a', actual: 'reviewer: vacuous' },
      { doc: 'docs/api.md', anchor: 'api/auth', kind: 'birth', title: 'rejects bad token', step: 2, expected: '401', actual: '200' },
    ],
  })
}

describe('runGuardFindings (printer)', () => {
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

  it('groups findings by doc+anchor, numbers them globally, and shows the header + evidence', async () => {
    const r = repo()
    writeGuardResult(r, findingsReport())
    await runGuardFindings({ cwd: r })

    // Header — generatedAt + counts straight from the report.
    expect(out).toContain('2026-01-02T03:04:05.000Z')
    expect(out).toContain('12 total · 3 changed')
    expect(out).toContain('1 written · 5 passed birth')
    expect(out).toContain('3 total')

    // Section group headers.
    expect(out).toContain(`${DOC} › cli/version`)
    expect(out).toContain('docs/api.md › api/auth')

    // Numbered, kinded lines with a compact expected→actual + evidence pointer.
    expect(out).toContain('1. [birth] prints semver')
    expect(out).toContain('exit 0 → exit 7')
    expect(out).toContain('evidence: .truecourse/guard/evidence/run/f1')
    expect(out).toContain('2. [fidelity] weak assertion')
    // Numbering continues across groups (third finding is in the second group).
    expect(out).toContain('3. [birth] rejects bad token')
  })

  it('renders the triage verdict + recommendation for a triaged finding', async () => {
    const r = repo()
    writeGuardResult(r, findingsReport())
    await runGuardFindings({ cwd: r })

    // The triaged finding shows its verdict/confidence and the concrete recommendation.
    expect(out).toContain('verdict: code-drift (high confidence)')
    expect(out).toContain('recommend: Fix the exit code to 0 to match the documented contract.')
    // A finding with no triage prints no verdict line.
    const rejectsIdx = out.indexOf('rejects bad token')
    expect(out.slice(rejectsIdx)).not.toContain('verdict:')
  })

  it('--kind filters to one kind', async () => {
    const r = repo()
    writeGuardResult(r, findingsReport())
    await runGuardFindings({ cwd: r, kind: 'fidelity' })

    expect(out).toContain('1. [fidelity] weak assertion')
    expect(out).not.toContain('prints semver')
    expect(out).not.toContain('rejects bad token')
    expect(out).toContain('1 match filter')
  })

  it('--doc filters to one doc, composable with --kind', async () => {
    const r = repo()
    writeGuardResult(r, findingsReport())

    await runGuardFindings({ cwd: r, doc: 'docs/api.md' })
    expect(out).toContain('rejects bad token')
    expect(out).not.toContain('prints semver')
    expect(out).not.toContain('weak assertion')

    // Composed: docs/cli.md + birth → only the version birth finding survives.
    out = ''
    await runGuardFindings({ cwd: r, doc: DOC, kind: 'birth' })
    expect(out).toContain('prints semver')
    expect(out).not.toContain('weak assertion')
    expect(out).not.toContain('rejects bad token')
  })

  it('--json emits the exact filtered findings array with no decoration', async () => {
    const r = repo()
    const rep = findingsReport()
    writeGuardResult(r, rep)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runGuardFindings({ cwd: r, json: true })
    const unfiltered = JSON.parse(logSpy.mock.calls.map((c) => c.join(' ')).join('\n'))
    expect(unfiltered).toEqual(rep.birthFindings)

    logSpy.mockClear()
    await runGuardFindings({ cwd: r, json: true, kind: 'fidelity' })
    const filtered = JSON.parse(logSpy.mock.calls.map((c) => c.join(' ')).join('\n'))
    logSpy.mockRestore()
    expect(filtered).toEqual([rep.birthFindings[1]])

    // JSON mode prints no clack intro/outro decoration to stdout.
    expect(out).toBe('')
  })

  it('prints the empty state when the report has no findings', async () => {
    const r = repo()
    writeGuardResult(r, report({ sectionsChanged: 2, written: WRITTEN, birthPassed: 1 }))
    await runGuardFindings({ cwd: r })

    expect(out).toContain('No findings in the last generate')
    expect(out).toContain('1 scenario written')
  })

  it('exits nonzero with a run-generate message when no report exists', async () => {
    const r = repo()
    let exitCode: number | null = null
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${code})`)
    }) as never)
    try {
      await runGuardFindings({ cwd: r })
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e
    } finally {
      exitSpy.mockRestore()
    }
    expect(exitCode).toBe(1)
    expect(out).toContain('guard generate')
  })
})
