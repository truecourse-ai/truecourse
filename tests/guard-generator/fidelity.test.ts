import { describe, it, expect, afterEach } from 'vitest'
import { generateGuards, type GenerateRunner, type FidelityRunner } from '@truecourse/guard-generator'
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
  faithfulReviewer,
  reviewBy,
  PASSING_STEPS,
  FAILING_STEPS,
  authored,
} from './helpers.js'
import { stubAuxRunners } from './helpers.js'

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

describe('generateGuards — fidelity review (item 33)', () => {
  it('a FAITHFUL green scenario persists exactly as today', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: faithfulReviewer(),
    })
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version.1'])
  })

  it('a FLAGGED green scenario becomes a fidelity finding — section unsettled, nothing persisted', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: [raw('weak', PASSING_STEPS)] }),
      fidelityRunner: reviewBy({ weak: 'asserts exit 0 but the claim quotes exact output' }),
    })

    // Passed birth (review is post-birth) but never persisted.
    expect(res.birthPassed).toBe(1)
    expect(res.written).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])

    // Recorded as a fidelity finding: kind + the reviewer's mismatch as evidence,
    // with the yaml + claim inline exactly like a birth finding.
    expect(res.birthFindings).toHaveLength(1)
    const f = res.birthFindings[0]
    expect(f.kind).toBe('fidelity')
    expect(f.anchor).toBe('version')
    expect(f.title).toBe('weak')
    expect(f.actual).toBe('asserts exit 0 but the claim quotes exact output')
    expect(f.yaml).toContain('title: weak')
    expect(f.claim).toBeTruthy()
    // No birth-evidence transcript — a fidelity finding never ran a failing step.
    expect(f.evidencePath).toBeUndefined()

    // The section stayed unsettled → re-attempted next run.
    expect(readManifest(r)!.sections.find((s) => s.anchor === 'version')).toBeUndefined()
  })

  it('a flagged scenario COMMITS its faithful sibling and reports itself (item 15)', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      // One claim, two green scenarios: `good` is faithful, `bad` is flagged.
      generateRunner: authorBy({ version: [raw('good', PASSING_STEPS), raw('bad', PASSING_STEPS)] }),
      fidelityRunner: reviewBy({ bad: 'miscast: tests a different command than the claim' }),
    })

    // The faithful sibling COMMITS on its own merits — no longer withheld.
    expect(res.written.map((w) => w.title)).toEqual(['good'])
    expect(loadScenarios(r).scenarios.map((s) => s.title)).toEqual(['good'])
    // The flagged one is still a fidelity finding, reported alongside.
    expect(res.birthFindings.map((f) => f.title)).toEqual(['bad'])
    expect(res.birthFindings[0].kind).toBe('fidelity')

    // The PARTIAL section records its committed id with a NULL hash, so `bad`
    // re-attempts next run while `good` stays committed.
    const entry = readManifest(r)!.sections.find((s) => s.anchor === 'version')!
    expect(entry.scenarioIds).toEqual(['version.1'])
    expect(entry.generationInputsHash).toBeNull()
  })

  it('a retry SURVIVOR is reviewed too (round-2 pass still gets audited)', async () => {
    const r = seed()
    // Round 1 fails birth; the evidence-retry produces `fixed`, which passes birth —
    // and the fidelity review then flags it. Proves round-2 passers are reviewed.
    const retryRunner: GenerateRunner = async ({ claims }) =>
      authored(claims.map((c) => ({ ref: c.ref, scenarios: c.retry ? [raw('fixed', PASSING_STEPS)] : [raw('broken', FAILING_STEPS)] })))

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: retryRunner,
      fidelityRunner: reviewBy({ fixed: 'weak: never asserts the claimed output value' }),
    })

    expect(res.written).toEqual([])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['fixed'])
    expect(res.birthFindings[0].kind).toBe('fidelity')
    expect(loadScenarios(r).scenarios).toEqual([])
  })

  it('re-uses the fidelity cache on a re-run — no second review call for an unchanged scenario+section', async () => {
    const r = seed()
    let calls = 0
    await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: faithfulReviewer(() => calls++),
    })
    expect(calls).toBe(1) // one green scenario reviewed

    // Force the whole pipeline to re-run (fresh manifest) with the SAME doc: the
    // scenario YAML + section are byte-identical, so the fidelity review is a cache HIT.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    calls = 0
    const res2 = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: faithfulReviewer(() => calls++),
    })
    expect(res2.written.map((w) => w.anchor)).toEqual(['version'])
    expect(calls).toBe(0) // served from the guard/fidelity cache
  })

  it('a review that cannot complete is an error that unsettles the section (never a finding)', async () => {
    const r = seed()
    const throwingReviewer: FidelityRunner = async () => {
      throw new Error('reviewer down')
    }
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: throwingReviewer,
    })

    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([]) // an error is NOT a finding
    expect(res.errors.some((e) => e.message.includes('fidelity review'))).toBe(true)
    expect(readManifest(r)!.sections.find((s) => s.anchor === 'version')).toBeUndefined()
  })

  it('with NO reviewer configured (no transport, no fidelityRunner) green scenarios persist unreviewed', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    expect(res.birthFindings).toEqual([])
  })

  it('reviews fan out through the shared pool, bounded by the concurrency option', async () => {
    const r = seed()
    // One claim → four green scenarios → four independent fidelity reviews. A tracking
    // reviewer records the peak in-flight count; with the bound at 2 it must never spike
    // past 2, and all four still complete (all faithful → all persist).
    let inFlight = 0
    let maxInFlight = 0
    const tracking: FidelityRunner = async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((res) => setTimeout(res, 20))
      inFlight--
      return { verdict: 'faithful' }
    }
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      concurrency: 2,
      extractRunner: versionExtract,
      generateRunner: authorBy({
        version: [
          raw('a', PASSING_STEPS),
          raw('b', PASSING_STEPS),
          raw('c', PASSING_STEPS),
          raw('d', PASSING_STEPS),
        ],
      }),
      fidelityRunner: tracking,
    })

    expect(res.written).toHaveLength(4)
    expect(maxInFlight).toBeGreaterThan(1) // actually ran in parallel, not serial
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })

  it('TRUECOURSE_MAX_CONCURRENCY caps the fidelity reviews when no option is passed', async () => {
    const r = seed()
    let inFlight = 0
    let maxInFlight = 0
    const tracking: FidelityRunner = async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((res) => setTimeout(res, 20))
      inFlight--
      return { verdict: 'faithful' }
    }
    const saved = process.env.TRUECOURSE_MAX_CONCURRENCY
    process.env.TRUECOURSE_MAX_CONCURRENCY = '2'
    try {
      const res = await generateGuards({
      ...stubAuxRunners(),
        repoRoot: r,
        extractRunner: versionExtract,
        generateRunner: authorBy({
          version: [
            raw('a', PASSING_STEPS),
            raw('b', PASSING_STEPS),
            raw('c', PASSING_STEPS),
            raw('d', PASSING_STEPS),
          ],
        }),
        fidelityRunner: tracking,
      })
      expect(res.written).toHaveLength(4)
      expect(maxInFlight).toBeLessThanOrEqual(2)
    } finally {
      if (saved === undefined) delete process.env.TRUECOURSE_MAX_CONCURRENCY
      else process.env.TRUECOURSE_MAX_CONCURRENCY = saved
    }
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
          expected: 'a scenario that verifies what the claim asserts',
          actual: 'asserts exit 0 but the claim quotes exact output',
          yaml: 'title: weak\n',
          claim: 'the version claim',
        },
      ],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    }
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
  })
})
