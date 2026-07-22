import { describe, it, expect, afterEach } from 'vitest'
import { generateGuards, runTriage, triageCacheKey, type TriageRunner } from '@truecourse/guard-generator'
import { writeManifest } from '@truecourse/guard-runner'
import { GuardGenerateReportSchema, GUARD_FORMAT_VERSION, type GuardBirthFinding, type GuardTriage } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  triageBy,
  FAILING_STEPS,
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
const DOC_CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')

const versionExtract = extractBy({})
/** An author runner that always produces a birth-FAILING scenario (boom, expects exit 0)
 *  — round 1 + retry both fail, so `version` births a finding for triage to judge. */
const alwaysFails = authorBy({ version: [raw('boom', FAILING_STEPS)] })

const CODE_DRIFT: GuardTriage = {
  verdict: 'code-drift',
  confidence: 'high',
  brief: 'The program prints a different message than the section promises.',
  recommendation: 'Observed exit 7 where the doc promises exit 0 — fix the command or the doc.',
}

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

describe('generateGuards — finding triage', () => {
  // Item 3 — a code-drift verdict is REAL DRIFT: the failing scenario COMMITS (no longer
  // a withheld birth finding), carrying the triage verdict on its `written` diagnosis.
  it('attaches an Opus triage verdict to the committed drift scenario', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: alwaysFails,
      triageRunner: triageBy(CODE_DRIFT),
    })
    expect(res.birthFindings).toHaveLength(0)
    expect(res.written).toHaveLength(1)
    expect(res.written[0].diagnosis?.triage).toEqual(CODE_DRIFT)
  })

  it('a committed drift scenario ships WITHOUT triage when no triage runner is configured', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: alwaysFails,
    })
    expect(res.birthFindings).toHaveLength(0)
    expect(res.written).toHaveLength(1)
    expect(res.written[0].diagnosis).toBeDefined()
    expect(res.written[0].diagnosis?.triage).toBeUndefined()
  })

  it('re-triages only new/changed drift — an unchanged one is a cache hit', async () => {
    const r = seed()
    let calls = 0
    const res1 = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: alwaysFails,
      triageRunner: triageBy(CODE_DRIFT, () => calls++),
    })
    expect(res1.written[0].diagnosis?.triage).toEqual(CODE_DRIFT)
    expect(calls).toBe(1)

    // Force the whole pipeline to re-run (fresh manifest) with the SAME doc: birth
    // re-produces the identical finding (same doc/anchor/claim/expected/actual), so
    // triage is served from the guard/triage cache — no second call.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    calls = 0
    const res2 = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: alwaysFails,
      triageRunner: triageBy(CODE_DRIFT, () => calls++),
    })
    expect(res2.written[0].diagnosis?.triage).toEqual(CODE_DRIFT)
    expect(calls).toBe(0)
  })

  it('re-asks ONCE on invalid output, then attaches the valid verdict', async () => {
    const r = seed()
    let calls = 0
    const reaskRunner: TriageRunner = async () => {
      calls++
      if (calls === 1) return { verdict: 'not-a-verdict' } // invalid → triggers the re-ask
      return CODE_DRIFT
    }
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: alwaysFails,
      triageRunner: reaskRunner,
    })
    expect(calls).toBe(2)
    expect(res.written[0].diagnosis?.triage).toEqual(CODE_DRIFT)
  })

  it('fail-soft: a committed scenario ships without triage when output stays invalid after the re-ask', async () => {
    const r = seed()
    const badRunner: TriageRunner = async () => ({ verdict: 'nonsense' })
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: alwaysFails,
      triageRunner: badRunner,
    })
    expect(res.written).toHaveLength(1)
    expect(res.written[0].diagnosis?.triage).toBeUndefined()
  })

  it('fail-soft: a thrown triage call leaves the committed scenario without triage', async () => {
    const r = seed()
    const throwing: TriageRunner = async () => {
      throw new Error('triage down')
    }
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionExtract,
      generateRunner: alwaysFails,
      triageRunner: throwing,
    })
    expect(res.written[0].diagnosis?.triage).toBeUndefined()
  })

  it('a triaged finding round-trips through the report schema', () => {
    const rep = {
      generatedAt: '2026-07-15T00:00:00.000Z',
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
          title: 'boom',
          step: 1,
          expected: 'exit 0',
          actual: 'exit 7',
          claim: 'version claim',
          triage: CODE_DRIFT,
        },
      ],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    }
    const parsed = GuardGenerateReportSchema.parse(rep)
    expect(parsed.birthFindings[0].triage).toEqual(CODE_DRIFT)
  })

  it('a committed FAILING scenario (written diagnosis) round-trips; an old report parses', () => {
    const base = {
      generatedAt: '2026-07-21T00:00:00.000Z',
      status: 'ok' as const,
      sectionsTotal: 1,
      sectionsChanged: 1,
      skippedUnchanged: 0,
      noChanges: false,
      coverageGaps: [],
      birthFindings: [],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    }
    // Item 3 — a written entry carrying a diagnosis (real drift the run reproduces).
    const withDiagnosis = GuardGenerateReportSchema.parse({
      ...base,
      written: [
        {
          id: 'version.1',
          title: 'boom',
          doc: DOC,
          anchor: 'version',
          file: 'x.yaml',
          diagnosis: { step: 1, expected: 'exit 0', actual: 'exit 7', stderr: 'fatal', triage: CODE_DRIFT },
        },
      ],
    })
    expect(withDiagnosis.written[0].diagnosis?.triage).toEqual(CODE_DRIFT)
    expect(withDiagnosis.written[0].diagnosis?.actual).toBe('exit 7')

    // An OLD report — a written entry with NO diagnosis (all passing) — still parses.
    const legacy = GuardGenerateReportSchema.parse({
      ...base,
      written: [{ id: 'version.1', title: 'ok', doc: DOC, anchor: 'version', file: 'x.yaml' }],
    })
    expect(legacy.written[0].diagnosis).toBeUndefined()
  })
})

describe('triageCacheKey', () => {
  const base: GuardBirthFinding = {
    doc: DOC,
    anchor: 'version',
    title: 'boom',
    step: 1,
    expected: 'exit 0',
    actual: 'exit 7',
    claim: 'version claim',
  }

  it('is stable for the same finding identity', () => {
    expect(triageCacheKey(base)).toBe(triageCacheKey({ ...base }))
  })

  it('moves when any identity field (doc/anchor/claim/expected/actual) changes', () => {
    const k = triageCacheKey(base)
    expect(triageCacheKey({ ...base, doc: 'docs/other.md' })).not.toBe(k)
    expect(triageCacheKey({ ...base, anchor: 'other' })).not.toBe(k)
    expect(triageCacheKey({ ...base, claim: 'a different claim' })).not.toBe(k)
    expect(triageCacheKey({ ...base, expected: 'exit 1' })).not.toBe(k)
    expect(triageCacheKey({ ...base, actual: 'exit 9' })).not.toBe(k)
  })

  it('ignores non-identity fields (title/yaml) — those never move the key', () => {
    const k = triageCacheKey(base)
    expect(triageCacheKey({ ...base, title: 'renamed' })).toBe(k)
    expect(triageCacheKey({ ...base, yaml: 'title: boom\n' })).toBe(k)
  })
})

describe('runTriage', () => {
  const finding: GuardBirthFinding = {
    doc: DOC,
    anchor: 'version',
    title: 'boom',
    step: 1,
    expected: 'exit 0',
    actual: 'exit 7',
    claim: 'version claim',
  }
  const section = { sectionHeading: 'version', sectionText: 'the version claim', probes: [] }

  it('returns the validated verdict and caches it (second call is a hit)', async () => {
    const r = repo()
    let calls = 0
    const first = await runTriage(r, finding, section, triageBy(CODE_DRIFT, () => calls++))
    expect(first).toEqual(CODE_DRIFT)
    expect(calls).toBe(1)

    // Same finding identity → served from the cache, runner not called again.
    const second = await runTriage(r, finding, section, triageBy(CODE_DRIFT, () => calls++))
    expect(second).toEqual(CODE_DRIFT)
    expect(calls).toBe(1)
  })

  it('returns null (fail-soft) when the runner throws', async () => {
    const r = repo()
    const throwing: TriageRunner = async () => {
      throw new Error('down')
    }
    expect(await runTriage(r, finding, section, throwing)).toBeNull()
  })
})
