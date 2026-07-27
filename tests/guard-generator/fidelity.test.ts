import { describe, it, expect, afterEach } from 'vitest'
import { type FidelityRunner } from '@truecourse/guard-generator'
import { loadScenarios, readManifest, writeManifest } from '@truecourse/guard-runner'
import { GuardGenerateReportSchema, GUARD_FORMAT_VERSION } from '@truecourse/shared'
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
  faithfulReviewer,
  reviewBy,
  PASSING_STEPS,
  FAILING_STEPS,
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

/** version → default cli claim, background → untestable. */
const versionExtract = extractBy({ background: { untestable: 'design history' } })

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

/** The manifest entry for one flow (v2 is flow-keyed). */
function flowEntry(repoRoot: string, flowId: string) {
  return readManifest(repoRoot)?.flows.find((f) => f.flowId === flowId)
}

describe('generateGuards — fidelity review (item 33)', () => {
  it('a FAITHFUL green scenario persists exactly as today', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    })
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version.cli.1'])
  })

  it('a FLAGGED green scenario becomes a fidelity finding — nothing persisted, the flow re-runs', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: raw('weak', PASSING_STEPS) }),
      fidelityRunner: reviewBy({ weak: 'asserts exit 0 but the claim quotes exact output' }),
    })

    // Passed birth (review is post-birth) but never persisted.
    expect(res.birthPassed).toBe(1)
    expect(res.written).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])

    // Recorded as a fidelity finding: kind + the reviewer's mismatch as evidence,
    // with the yaml + claim inline exactly like a birth finding, plus the flow it
    // belongs to and the surface it was authored for.
    expect(res.birthFindings).toHaveLength(1)
    const f = res.birthFindings[0]
    expect(f.kind).toBe('fidelity')
    expect(f.anchor).toBe('version')
    expect(f.flowId).toBe('version')
    expect(f.surface).toBe('cli')
    expect(f.title).toBe('weak')
    expect(f.actual).toBe('asserts exit 0 but the claim quotes exact output')
    expect(f.yaml).toContain('title: weak')
    expect(f.claim).toBeTruthy()
    // No birth-evidence transcript — a fidelity finding never ran a failing step.
    expect(f.evidencePath).toBeUndefined()

    // The flow keeps its manifest entry (its bindings are real coverage) but records
    // NO inputs hash, so the next generate re-runs it.
    const entry = flowEntry(r, 'version')
    expect(entry?.scenarios).toEqual([])
    expect(entry?.generationInputsHash).toBeNull()
    expect(res.flows.unsettled).toBe(1)
  })

  it('a flagged flow never withholds a SIBLING flow — findings are independent', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, ['## version', 'v claim.', '', '## help', 'h claim.'].join('\n'))

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: raw('good', PASSING_STEPS), help: raw('bad', PASSING_STEPS) }),
      fidelityRunner: reviewBy({ bad: 'miscast: tests a different command than the claim' }),
    })

    // The healthy flow persisted; the flagged one is a finding. Nothing is held.
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['bad'])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version.cli.1'])
    expect(res.flows.settled).toBe(1)
    expect(res.flows.unsettled).toBe(1)
  })

  it('a retry SURVIVOR is reviewed too (round-2 pass still gets audited)', async () => {
    const r = seed()
    // Round 1 fails birth; the evidence-retry produces `fixed`, which passes birth —
    // and the fidelity review then flags it. Proves round-2 passers are reviewed.
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({
        version: { first: raw('broken', FAILING_STEPS), retry: raw('fixed', PASSING_STEPS) },
      }),
      fidelityRunner: reviewBy({ fixed: 'weak: never asserts the claimed output value' }),
    })

    expect(res.written).toEqual([])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['fixed'])
    expect(res.birthFindings[0].kind).toBe('fidelity')
    expect(loadScenarios(r).scenarios).toEqual([])
  })

  it('re-uses the fidelity cache on a re-run — no second review call for an unchanged scenario+flow', async () => {
    const r = seed()
    let calls = 0
    await runGenerate({
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(() => calls++),
    })
    expect(calls).toBe(1) // one green scenario reviewed

    // Force the whole pipeline to re-run (fresh manifest) with the SAME doc: the
    // scenario YAML + flow are byte-identical, so the fidelity review is a cache HIT.
    writeManifest(r, { version: GUARD_FORMAT_VERSION, flows: [] })
    calls = 0
    const res2 = await runGenerate({
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(() => calls++),
    })
    expect(res2.written.map((w) => w.flowId)).toEqual(['version'])
    expect(calls).toBe(0) // served from the guard/fidelity cache
  })

  it('a review that cannot complete is an error that unsettles the flow (never a finding)', async () => {
    const r = seed()
    const throwingReviewer: FidelityRunner = async () => {
      throw new Error('reviewer down')
    }
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
      fidelityRunner: throwingReviewer,
    })

    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([]) // an error is NOT a finding
    expect(res.errors.some((e) => e.message.includes('fidelity review'))).toBe(true)
    expect(flowEntry(r, 'version')?.generationInputsHash).toBeNull()
  })

  it('with NO reviewer configured (no transport, no fidelityRunner) green scenarios persist unreviewed', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.birthFindings).toEqual([])
  })

  it('reviews fan out through the shared pool, bounded by the concurrency option', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    // Four sections → four atomic flows → four scenarios → four independent reviews.
    writeDoc(r, DOC, ['## a', 'a.', '', '## b', 'b.', '', '## c', 'c.', '', '## d', 'd.'].join('\n'))
    let inFlight = 0
    let maxInFlight = 0
    const tracking: FidelityRunner = async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((res) => setTimeout(res, 20))
      inFlight--
      return { verdict: 'faithful' }
    }
    const res = await runGenerate({
      repoRoot: r,
      concurrency: 2,
      extractRunner: extractBy({}),
      fidelityRunner: tracking,
    })

    expect(res.written).toHaveLength(4)
    expect(maxInFlight).toBeGreaterThan(1) // actually ran in parallel, not serial
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })

  it('a fidelity finding round-trips through the report schema (kind: fidelity)', () => {
    const rep = {
      generatedAt: '2026-07-10T00:00:00.000Z',
      status: 'ok' as const,
      sectionsTotal: 1,
      sectionsChanged: 1,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [],
      birthFindings: [
        {
          doc: DOC,
          anchor: 'version',
          kind: 'fidelity' as const,
          title: 'weak',
          step: 1,
          expected: "a scenario that verifies the flow's milestones",
          actual: 'asserts exit 0 but the claim quotes exact output',
          yaml: 'title: weak\n',
          claim: 'the version claim',
          flowId: 'version',
          surface: 'cli' as const,
        },
      ],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    }
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
  })
})
