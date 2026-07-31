/**
 * Fidelity runs in PARALLEL with birth, not after it. Birth (sandbox build + run) is
 * the wall-time long pole; fidelity judges the YAML against the claim and needs
 * nothing from the birth run, so the two start concurrently the moment authoring
 * returns and a candidate commits only when BOTH are green. When both go wrong a
 * birth FAILURE wins — the candidate goes to the evidence-retry path and its
 * (concurrently-computed) fidelity verdict is dropped, never a finding.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { generateGuards, type GenerateRunner, type FidelityRunner, type GuardGenerateResult } from '@truecourse/guard-generator'
import { loadScenarios, type GuardExecInput, type GuardExecReport } from '@truecourse/guard-runner'
import {
  GUARD_FORMAT_VERSION,
  type GuardLatest,
  type GuardScenarioResult,
} from '@truecourse/shared'
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
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## help',
  '`relkit --help` prints usage and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')

/** version + help → default cli claims, background → untestable. */
const twoSectionExtract = extractBy({ background: { untestable: 'design history' } })

function seed(content = DOC_CONTENT): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, content)
  return r
}

/** birthPassed reconciles: passed === CLEAN written + fidelity-flagged + auto-resolved.
 *  Item 3 — a committed DRIFT (a `written` entry with a diagnosis) never passed birth. */
function reconciles(res: GuardGenerateResult): boolean {
  const flagged = res.birthFindings.filter((f) => f.kind === 'fidelity').length
  const writtenClean = res.written.filter((w) => w.diagnosis === undefined).length
  return res.birthPassed === writtenClean + flagged + res.autoResolved.length
}

/** An all-pass executor that blocks on `gate` before it produces its verdicts, so a
 *  test can prove fidelity started while birth was still running. */
function gatedPassingExecutor(gate: Promise<void>, onStart: () => void, onDone: () => void) {
  return async (input: GuardExecInput): Promise<GuardExecReport> => {
    onStart()
    await gate
    onDone()
    const scenarios: GuardScenarioResult[] = input.scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      binds: s.binds,
      outcome: 'pass',
      durationMs: 1,
    }))
    const latest: GuardLatest = {
      run: {
        runId: 'r',
        ranAt: new Date().toISOString(),
        branch: null,
        commit: null,
        recipeFingerprint: 'sha256:x',
        scenarioFormat: GUARD_FORMAT_VERSION,
      },
      summary: { total: scenarios.length, pass: scenarios.length, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios,
      sections: [],
    }
    return { status: 'ok', latest, latestPath: '', loadErrors: [], manifest: null }
  }
}

describe('generateGuards — fidelity runs in parallel with birth (item 16)', () => {
  it('starts the fidelity review before birth completes — the two overlap', async () => {
    const r = seed('## version\n`relkit --version` prints the version and exits 0.\n')
    const events: string[] = []
    let releaseBirth!: () => void
    const birthGate = new Promise<void>((res) => {
      releaseBirth = res
    })

    // Birth blocks until the fidelity review has STARTED. Were the two sequential
    // (birth THEN fidelity) this would deadlock — the fidelity runner would never run
    // to release the gate. The test completing at all proves they overlap.
    const executor = gatedPassingExecutor(
      birthGate,
      () => events.push('birth-start'),
      () => events.push('birth-done'),
    )
    const fidelityRunner: FidelityRunner = async () => {
      events.push('fidelity-start')
      releaseBirth()
      return { verdict: 'faithful' }
    }

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      executor,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner,
    })

    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    expect(events).toContain('birth-start')
    // Fidelity started while birth was still blocked (before it finished).
    expect(events.indexOf('fidelity-start')).toBeLessThan(events.indexOf('birth-done'))
  })

  it('commit requires BOTH green: a birth-passing but flagged candidate never commits', async () => {
    const r = seed('## version\n`relkit --version` prints the version and exits 0.\n')
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: [raw('weak', PASSING_STEPS)] }),
      fidelityRunner: reviewBy({ weak: 'asserts exit 0 but the claim quotes exact output' }),
    })
    expect(res.written).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])
    expect(res.birthFindings.map((f) => f.kind)).toEqual(['fidelity'])
    expect(reconciles(res)).toBe(true)
  })

  it('birth-fail + fidelity-flag on the SAME candidate → retry path, fidelity verdict dropped, no finding', async () => {
    const r = seed('## version\n`relkit --version` prints the version and exits 0.\n')
    // Round 1 authors `broken` (fails birth); the evidence-retry authors `fixed`
    // (passes). Fidelity would FLAG the round-1 `broken` — but birth fails first, so
    // that verdict is discarded with the candidate. `fixed` is faithful → commits.
    const retryRunner: GenerateRunner = async ({ claims }) =>
      authored(claims.map((c) => ({ ref: c.ref, scenarios: c.retry ? [raw('fixed', PASSING_STEPS)] : [raw('broken', FAILING_STEPS)] })))

    let maxPlanned = 0
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: retryRunner,
      fidelityRunner: reviewBy({ broken: 'weak: never asserts the claimed output value' }),
      onFidelityProgress: (_reviewed, planned) => {
        maxPlanned = Math.max(maxPlanned, planned)
      },
    })

    // The flag on the discarded round-1 candidate is NOT a finding; the retry commits.
    expect(res.birthFindings).toEqual([])
    expect(res.written.map((w) => w.title)).toEqual(['fixed'])
    // Planned counts every reviewed candidate — the birth-rejected `broken` AND the
    // retry `fixed` — proving `planned` grows at candidate time, not at green time.
    expect(maxPlanned).toBe(2)
    expect(reconciles(res)).toBe(true)
  })

  it('a retry survivor gets BOTH checks again in parallel — flagged round-2 → finding', async () => {
    const r = seed('## version\n`relkit --version` prints the version and exits 0.\n')
    const retryRunner: GenerateRunner = async ({ claims }) =>
      authored(claims.map((c) => ({ ref: c.ref, scenarios: c.retry ? [raw('fixed', PASSING_STEPS)] : [raw('broken', FAILING_STEPS)] })))

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: retryRunner,
      fidelityRunner: reviewBy({ fixed: 'weak: never asserts the claimed output value' }),
    })

    expect(res.written).toEqual([])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['fixed'])
    expect(res.birthFindings[0].kind).toBe('fidelity')
    expect(reconciles(res)).toBe(true)
  })

  it('counters reconcile across a mixed run: one faithful (written) + one flagged (finding)', async () => {
    const r = seed()
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: twoSectionExtract,
      generateRunner: authorBy({
        version: [raw('good', PASSING_STEPS)],
        help: [raw('vacuous', PASSING_STEPS)],
      }),
      fidelityRunner: reviewBy({ vacuous: 'vacuous: passes regardless of the claimed behavior' }),
    })

    expect(res.written.map((w) => w.title)).toEqual(['good'])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['vacuous'])
    // Two candidates cleared birth AND were reviewed → birthPassed 2 = 1 written +
    // 1 fidelity-flagged.
    expect(res.birthPassed).toBe(2)
    expect(reconciles(res)).toBe(true)
  })

  it('a review that cannot complete on a birth-passing candidate does not count as a birth pass', async () => {
    const r = seed('## version\n`relkit --version` prints the version and exits 0.\n')
    const throwingReviewer: FidelityRunner = async () => {
      throw new Error('reviewer down')
    }
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      fidelityRunner: throwingReviewer,
    })
    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.birthPassed).toBe(0)
    expect(reconciles(res)).toBe(true)
  })
})
