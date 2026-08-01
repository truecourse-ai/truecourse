/**
 * High-confidence fidelity flags self-heal — discard, re-author once, never a task.
 * A vacuous scenario the reviewer is SURE about is the system's own mess to clean up,
 * not a report: the candidate is discarded and its claim re-authored ONCE with the
 * mismatch as correction evidence, the re-author gets birth + fidelity again, and
 * every discard is an auditable `autoResolved` ledger entry. Medium/low flags become
 * findings exactly as today.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { generateGuards, type GenerateRunner, type GuardGenerateResult } from '@truecourse/guard-generator'
import { loadScenarios } from '@truecourse/guard-runner'
import { GuardGenerateReportSchema } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  reviewBy,
  stubAuxRunners,
  PASSING_STEPS,
  FAILING_STEPS,
  authored,
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
const DOC_CONTENT = '## version\n`relkit --version` prints the version and exits 0.\n'

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

/** version → one default cli claim. */
const versionExtract = extractBy({})

/** Round 1 authors `first`; the re-author (c.retry) authors `second`. */
function twoRound(first: string, firstSteps = PASSING_STEPS, second = 'fixed', secondSteps = PASSING_STEPS): GenerateRunner {
  return async ({ claims }) =>
    authored(claims.map((c) => ({ ref: c.ref, scenarios: c.retry ? [raw(second, secondSteps)] : [raw(first, firstSteps)] })))
}

/** birthPassed reconciles: passed === CLEAN written + fidelity-flagged + auto-resolved.
 *  Item 3 — a committed DRIFT (a `written` entry with a diagnosis) never passed birth,
 *  so it is excluded; only clean (birth-passing) commits count. */
function reconciles(res: GuardGenerateResult): boolean {
  const flagged = res.birthFindings.filter((f) => f.kind === 'fidelity').length
  const writtenClean = res.written.filter((w) => w.diagnosis === undefined).length
  return res.birthPassed === writtenClean + flagged + res.autoResolved.length
}

describe('generateGuards — high-confidence fidelity self-heal (item 13)', () => {
  it('a HIGH-confidence flag discards + re-authors once; a faithful re-author commits with no finding', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: twoRound('weak'),
      // `weak` flagged HIGH → self-heal; the re-authored `fixed` is faithful.
      fidelityRunner: reviewBy({ weak: { mismatch: 'vacuous: passes regardless of the claimed behavior', confidence: 'high' } }),
    })

    expect(res.birthFindings).toEqual([])
    expect(res.written.map((w) => w.title)).toEqual(['fixed'])
    expect(loadScenarios(r).scenarios.map((s) => s.title)).toEqual(['fixed'])

    // The discard is a ledger entry, never silent — with the re-author's outcome.
    expect(res.autoResolved).toHaveLength(1)
    expect(res.autoResolved[0]).toMatchObject({
      kind: 'fidelity-discard',
      doc: DOC,
      anchor: 'version',
      title: 'weak',
      mismatch: 'vacuous: passes regardless of the claimed behavior',
      outcome: 'resolved',
    })
    // weak (discard) + fixed (written) both passed birth → birthPassed 2.
    expect(res.birthPassed).toBe(2)
    expect(reconciles(res)).toBe(true)
  })

  it('a re-author flagged AGAIN becomes a finding (no second self-heal) — ledger outcome finding', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: twoRound('weak', PASSING_STEPS, 'stillWeak'),
      fidelityRunner: reviewBy({
        weak: { mismatch: 'vacuous', confidence: 'high' },
        stillWeak: { mismatch: 'still vacuous', confidence: 'high' },
      }),
    })

    expect(res.written).toEqual([])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['stillWeak'])
    expect(res.birthFindings[0].kind).toBe('fidelity')
    expect(res.autoResolved).toHaveLength(1)
    expect(res.autoResolved[0]).toMatchObject({ title: 'weak', outcome: 'finding' })
    expect(res.birthPassed).toBe(2)
    expect(reconciles(res)).toBe(true)
  })

  it('a re-author that FAILS birth COMMITS as drift — ledger outcome finding', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: twoRound('weak', PASSING_STEPS, 'broken', FAILING_STEPS),
      fidelityRunner: reviewBy({ weak: { mismatch: 'vacuous', confidence: 'high' } }),
    })

    // The re-authored `broken` births fail; no triage ⇒ real drift, so it COMMITS with a
    // diagnosis (item 3) rather than being withheld as a finding.
    expect(res.birthFindings).toEqual([])
    expect(res.written.map((w) => w.title)).toEqual(['broken'])
    expect(res.written[0].diagnosis).toBeDefined()
    // The self-heal ledger still records that the re-author did not cleanly resolve.
    expect(res.autoResolved.map((a) => a.outcome)).toEqual(['finding'])
    // Only `weak` passed birth; `broken` failed → birthPassed 1.
    expect(res.birthPassed).toBe(1)
    expect(reconciles(res)).toBe(true)
  })

  it('a MEDIUM-confidence flag becomes a finding as today — no discard, no re-author', async () => {
    const r = seed()
    let authorCalls = 0
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: [raw('weak', PASSING_STEPS)] }, () => authorCalls++),
      fidelityRunner: reviewBy({ weak: { mismatch: 'weak but arguable', confidence: 'medium' } }),
    })

    expect(res.written).toEqual([])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['weak'])
    expect(res.birthFindings[0].kind).toBe('fidelity')
    expect(res.autoResolved).toEqual([])
    expect(authorCalls).toBe(1) // authored once — never re-authored
    expect(res.birthPassed).toBe(1)
    expect(reconciles(res)).toBe(true)
  })

  it('a flag with NO stated confidence is read conservatively as a finding (never auto-discarded)', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: authorBy({ version: [raw('weak', PASSING_STEPS)] }),
      fidelityRunner: reviewBy({ weak: 'no confidence stated' }),
    })

    expect(res.birthFindings.map((f) => f.title)).toEqual(['weak'])
    expect(res.autoResolved).toEqual([])
    expect(reconciles(res)).toBe(true)
  })

  it('a birth-retry survivor flagged HIGH is a finding, not a second self-heal (at most one extra round)', async () => {
    const r = seed()
    // Round 1 `broken` FAILS birth → birth retry authors `fixed` (passes), which the
    // reviewer then flags HIGH. That is the claim's one extra round already, so the
    // flag is a finding — never another self-heal.
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: twoRound('broken', FAILING_STEPS, 'fixed'),
      fidelityRunner: reviewBy({ fixed: { mismatch: 'still vacuous', confidence: 'high' } }),
    })

    expect(res.written).toEqual([])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['fixed'])
    expect(res.birthFindings[0].kind).toBe('fidelity')
    expect(res.autoResolved).toEqual([])
    expect(res.birthPassed).toBe(1)
    expect(reconciles(res)).toBe(true)
  })

  it('an auto-resolved ledger entry round-trips through the report schema', () => {
    const rep = {
      generatedAt: '2026-07-16T00:00:00.000Z',
      status: 'ok' as const,
      sectionsTotal: 1,
      sectionsChanged: 1,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [],
      birthFindings: [],
      errors: [],
      extractionFailures: [],
      orphaned: [],
      autoResolved: [
        {
          kind: 'fidelity-discard' as const,
          doc: DOC,
          anchor: 'version',
          title: 'weak',
          mismatch: 'vacuous: passes regardless of the claimed behavior',
          outcome: 'resolved' as const,
        },
      ],
    }
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
    // Absent autoResolved (an older report) still parses.
    const { autoResolved: _drop, ...older } = rep
    expect(() => GuardGenerateReportSchema.parse(older)).not.toThrow()
  })
})
