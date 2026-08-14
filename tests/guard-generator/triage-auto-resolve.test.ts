/**
 * HIGH-confidence `generation-defect` verdicts auto-retire to the
 * ledger: no committed test, no human task, an auditable `triage-resolve` row,
 * and the flow re-attempts next generate with its author cache bypassed. The
 * durable ledger (`guard/auto-resolutions.json`) is the safety valve: past the
 * escalation threshold the same flow surfaces as a human task instead
 * ("re-generation is not fixing this").
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { GuardTriage } from '@truecourse/shared'
import { autoResolutionKey } from '@truecourse/shared'
import {
  readGuardAutoResolutions,
  writeGuardAutoResolutions,
  readManifest,
  loadScenarios,
} from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  runGenerate,
  FAILING_STEPS,
  PASSING_STEPS,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

const versionCliBgUntestable = extractBy({ background: { untestable: 'design history' } })
const KEY = autoResolutionKey('version', 'cli')

const genDefect = (confidence: GuardTriage['confidence']): GuardTriage => ({
  verdict: 'generation-defect',
  confidence,
  brief: 'The scenario asserts an exit code the section never states.',
  recommendation: 'Author against the documented behavior instead.',
})

describe('generation-defect auto-retire', () => {
  it('HIGH under budget: retired to the ledger — no test, no task, a visible row, the flow re-attempts', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
      triageRunner: async () => genDefect('high'),
    })

    // Nothing committed, and — unlike a medium/low verdict — no finding row either:
    // the ledger row IS the record.
    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.autoResolved).toEqual([
      {
        kind: 'triage-resolve',
        flowId: 'version',
        surface: 'cli',
        doc: DOC,
        anchor: 'version',
        title: 'always broken',
        verdict: 'generation-defect',
        brief: genDefect('high').brief,
      },
    ])
    // The flow re-attempts next generate.
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()
    expect(res.flows).toMatchObject({ settled: 0, unsettled: 1 })

    // The durable ledger counted it AND tainted the flow (the author cache still
    // holds the rejected scenario).
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toMatchObject({ count: 1, source: 'triage' })
    expect(ledger.tainted[KEY]).toMatchObject({
      flowId: 'version',
      surface: 'cli',
      title: 'always broken',
      mismatch: genDefect('high').brief,
    })
  })

  it('medium/low: withheld as a HUMAN finding — never auto-resolved, still tainted', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
      triageRunner: async () => genDefect('medium'),
    })
    expect(res.written).toEqual([])
    expect(res.autoResolved).toEqual([])
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].committed).toBeUndefined()
    expect(res.birthFindings[0].autoResolveEscalation).toBeUndefined()
    expect(readGuardAutoResolutions(r).entries[KEY]).toBeUndefined()
    expect(readGuardAutoResolutions(r).tainted[KEY]).toBeTruthy()
  })

  it('past the threshold: escalates as a human task — "re-generation is not fixing this"', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: { [KEY]: { count: 2, source: 'triage', updatedAt: '2026-07-01T00:00:00Z' } },
      tainted: {},
    })
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
      triageRunner: async () => genDefect('high'),
    })
    // No further auto-resolution: a withheld finding carrying the escalation note.
    expect(res.autoResolved).toEqual([])
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].autoResolveEscalation).toEqual({ count: 2, source: 'triage' })
    // The count is kept (still escalated next run), not bumped.
    expect(readGuardAutoResolutions(r).entries[KEY]).toMatchObject({ count: 2 })
  })

  it('the whole loop, three generates: retire, retire, escalate (escalateAutoResolveAfter honored)', async () => {
    const r = seed()
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractRunner: versionCliBgUntestable,
        generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
        triageRunner: async () => genDefect('high'),
        escalateAutoResolveAfter: 2,
      })

    const first = await run()
    expect(first.autoResolved).toHaveLength(1)
    expect(readGuardAutoResolutions(r).entries[KEY]!.count).toBe(1)

    const second = await run()
    expect(second.autoResolved).toHaveLength(1)
    expect(readGuardAutoResolutions(r).entries[KEY]!.count).toBe(2)

    const third = await run()
    expect(third.autoResolved).toEqual([])
    expect(third.birthFindings).toHaveLength(1)
    expect(third.birthFindings[0].autoResolveEscalation).toEqual({ count: 2, source: 'triage' })
  })

  it('a flow that CONVERGES clears its budget — the count never haunts a later regression', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: { [KEY]: { count: 2, source: 'triage', updatedAt: '2026-07-01T00:00:00Z' } },
      tainted: {},
    })
    await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('now green', PASSING_STEPS) }),
    })
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
    expect(readGuardAutoResolutions(r).entries[KEY]).toBeUndefined()
  })
})
