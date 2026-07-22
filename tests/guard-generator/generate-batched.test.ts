import { describe, it, expect, afterEach } from 'vitest'
import { generateGuards } from '@truecourse/guard-generator'
import {
  defaultGuardExecutor,
  loadScenarios,
  readManifest,
  type GuardExecutor,
  type GuardExecInput,
  type GuardExecReport,
} from '@truecourse/guard-runner'
import type { GuardScenarioResult } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  raw,
  rawApi,
  extractBy,
  authorBy,
  PASSING_STEPS,
  FAILING_STEPS,
  FAILING_API_STEPS,
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

/** A GuardExecutor that records every invocation and delegates to the real one. */
function countingExecutor(): { exec: GuardExecutor; calls: GuardExecInput[] } {
  const calls: GuardExecInput[] = []
  const exec: GuardExecutor = (input) => {
    calls.push(input)
    return defaultGuardExecutor(input)
  }
  return { exec, calls }
}

/**
 * A mock executor that decides each scenario's outcome from its TITLE and the batch
 * SIZE — so a scenario can "fail in a batch, pass alone" (shared-state pollution) or
 * always fail. Records every invocation. `fail` evidence names whether the run was a
 * batch or an isolated (size-1) re-confirmation, so a finding's `actual` proves which
 * run it came from.
 */
function mockExecutor(decide: (title: string, batchSize: number) => 'pass' | 'fail' | 'error'): {
  exec: GuardExecutor
  calls: GuardExecInput[]
} {
  const calls: GuardExecInput[] = []
  const exec: GuardExecutor = async (input) => {
    calls.push(input)
    const size = input.scenarios.length
    const scenarios: GuardScenarioResult[] = input.scenarios.map((s) => {
      const base = { id: s.id, title: s.title, binds: s.binds, durationMs: 0 }
      const verdict = decide(s.title, size)
      if (verdict === 'pass') return { ...base, outcome: 'pass' }
      if (verdict === 'error') return { ...base, outcome: 'error', failure: { step: 1, expected: 'ok', actual: 'infra boom' } }
      return { ...base, outcome: 'fail', failure: { step: 1, expected: 'ok', actual: size === 1 ? 'ISOLATED-FAIL' : 'BATCH-FAIL' } }
    })
    return { status: 'ok', latest: { scenarios } } as unknown as GuardExecReport
  }
  return { exec, calls }
}

/** Isolation-call count: birthValidate invocations carrying exactly one scenario. */
function isolationCalls(calls: GuardExecInput[]): GuardExecInput[] {
  return calls.filter((c) => c.scenarios.length === 1)
}

/** Two docs → two independent single-claim api sections (recipe prepares the api driver). */
function twoApiDocs(r: string): void {
  writeApiRecipe(r)
  writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
  writeDoc(r, 'docs/a.md', '## alpha\nGET /a returns 200.\n')
  writeDoc(r, 'docs/b.md', '## beta\nGET /b returns 200.\n')
}
const apiExtract = extractBy({
  alpha: [{ driver: 'api', claim: 'GET /a returns 200', reason: 'status' }],
  beta: [{ driver: 'api', claim: 'GET /b returns 200', reason: 'status' }],
})

/** Two docs → two independent single-claim cli sections. */
function twoDocs(r: string): void {
  writeRecipe(r)
  writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
  writeDoc(r, 'docs/a.md', '## alpha\n`relkit --version` exits 0.\n')
  writeDoc(r, 'docs/b.md', '## beta\n`relkit --version` exits 0.\n')
}

describe('generateGuards — batched birth validation (layer a)', () => {
  it('births EVERY section\'s round-1 candidates in ONE executor invocation', async () => {
    const r = repo()
    twoDocs(r)
    const { exec, calls } = countingExecutor()

    const res = await generateGuards({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ alpha: [raw('a', PASSING_STEPS)], beta: [raw('b', PASSING_STEPS)] }),
    })

    expect(res.written.map((w) => w.anchor).sort()).toEqual(['alpha', 'beta'])
    // Two sections, both pass at birth → exactly ONE round-1 executor invocation
    // (not one per section), no retry round, no isolation.
    expect(calls).toHaveLength(1)
    expect(calls[0].scenarios).toHaveLength(2)
  }, 60_000)

  it('pools the retry round too: one round-1 + one retry invocation across sections', async () => {
    const r = repo()
    twoDocs(r)
    const { exec, calls } = countingExecutor()

    // Both sections fail birth in round 1; each retry (evidence attached) fixes it.
    const res = await generateGuards({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      generateRunner: async ({ claims }) =>
        claims.map((c) => ({ ref: c.ref, scenarios: c.retry ? [raw('fixed', PASSING_STEPS)] : [raw('broken', FAILING_STEPS)] })),
    })

    expect(res.written.map((w) => w.title).sort()).toEqual(['fixed', 'fixed'])
    expect(res.birthFindings).toEqual([])
    // One pooled round-1 invocation + one pooled retry invocation = 2 (no per-section).
    expect(calls).toHaveLength(2)
    expect(calls[0].scenarios).toHaveLength(2) // round 1: both sections' broken candidates
    expect(calls[1].scenarios).toHaveLength(2) // retry: both sections' fixed candidates
  }, 60_000)

  it('attributes a finding to the right section when batched with a passing sibling', async () => {
    const r = repo()
    twoDocs(r)
    const { exec, calls } = countingExecutor()

    const res = await generateGuards({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      // alpha passes; beta always fails → a birth finding on `beta`, alpha persists.
      generateRunner: authorBy({ alpha: [raw('a-good', PASSING_STEPS)], beta: [raw('b-bad', FAILING_STEPS)] }),
    })

    expect(res.written.map((w) => w.anchor)).toEqual(['alpha'])
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].anchor).toBe('beta')
    expect(res.birthFindings[0].title).toBe('b-bad')
    // alpha committed; beta unsettled (no manifest entry).
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['alpha.1'])
    expect(readManifest(r)!.sections.find((s) => s.anchor === 'beta')).toBeUndefined()
    expect(readManifest(r)!.sections.find((s) => s.anchor === 'alpha')!.scenarioIds).toEqual(['alpha.1'])
  }, 60_000)
})

describe('generateGuards — isolated re-confirmation of birth findings (layer d)', () => {
  it('a candidate that fails in the batch but PASSES in isolation is kept, with no finding', async () => {
    const r = repo()
    twoApiDocs(r)
    // flipA: fails only when batched (pollution), passes alone → a false negative.
    // flipB: fails always → a genuine finding, confirmed in isolation. (api-only, since
    // layer d never isolates the already-sandbox-isolated cli driver.)
    const { exec, calls } = mockExecutor((title, size) => {
      if (title === 'flipA') return size === 1 ? 'pass' : 'fail'
      return 'fail' // flipB
    })

    const res = await generateGuards({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: apiExtract,
      generateRunner: authorBy({ alpha: [rawApi('flipA', FAILING_API_STEPS)], beta: [rawApi('flipB', FAILING_API_STEPS)] }),
    })

    // flipA flipped to a pass in isolation → alpha is committed, no finding.
    expect(res.written.map((w) => w.anchor)).toEqual(['alpha'])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['flipB'])
    // The confirmed finding's evidence is the ISOLATED run's, not the polluted batch's.
    expect(res.birthFindings[0].actual).toBe('ISOLATED-FAIL')
    // round-1 (2) + retry (2) + one isolation per would-be finding (flipA, flipB).
    expect(isolationCalls(calls)).toHaveLength(2)
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['alpha.1'])
  }, 60_000)

  it('caps isolated re-confirmations; beyond the cap findings carry the batch evidence', async () => {
    const r = repo()
    twoApiDocs(r)
    // Both sections fail always → two would-be findings, but the cap is 1.
    const { exec, calls } = mockExecutor(() => 'fail')

    const res = await generateGuards({
      repoRoot: r,
      executor: exec,
      isolationCap: 1,
      concurrency: 4,
      extractRunner: apiExtract,
      generateRunner: authorBy({ alpha: [rawApi('fa', FAILING_API_STEPS)], beta: [rawApi('fb', FAILING_API_STEPS)] }),
    })

    expect(res.birthFindings).toHaveLength(2)
    // Exactly ONE isolated re-confirmation ran (the cap); the other used batch evidence.
    expect(isolationCalls(calls)).toHaveLength(1)
    const actuals = res.birthFindings.map((f) => f.actual).sort()
    expect(actuals).toEqual(['BATCH-FAIL', 'ISOLATED-FAIL'])
    // Deterministic cap selection: the plan-first section (docs/a.md → alpha) is the
    // one always isolated, never dependent on LLM/authoring completion order.
    expect(res.birthFindings.find((f) => f.actual === 'ISOLATED-FAIL')!.anchor).toBe('alpha')
  }, 60_000)

  it('isolates ONLY api would-be findings; cli fails go straight to findings (batch evidence)', async () => {
    const r = repo()
    // One doc, one cli section + one api section; the recipe prepares both drivers.
    writeApiRecipe(r)
    writeCorpus(r, [{ ref: 'docs/mix.md' }])
    writeDoc(r, 'docs/mix.md', '## clis\n`relkit --version` exits 0.\n\n## apis\nGET /todos returns 200.\n')
    const { exec, calls } = mockExecutor(() => 'fail') // both always fail

    const res = await generateGuards({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({ apis: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: authorBy({ clis: [raw('cliFail', FAILING_STEPS)], apis: [rawApi('apiFail', FAILING_API_STEPS)] }),
    })

    expect(res.birthFindings.map((f) => f.anchor).sort()).toEqual(['apis', 'clis'])
    // Only the api finding was re-confirmed in isolation — cli never triggers a boot.
    expect(isolationCalls(calls)).toHaveLength(1)
    expect(res.birthFindings.find((f) => f.anchor === 'apis')!.actual).toBe('ISOLATED-FAIL')
    expect(res.birthFindings.find((f) => f.anchor === 'clis')!.actual).toBe('BATCH-FAIL')
  }, 60_000)

  it('an infra error never triggers isolation and settles as an error, not a finding', async () => {
    const r = repo()
    twoDocs(r) // two sections → the round-1 batch is size 2 (not itself size-1)
    const { exec, calls } = mockExecutor(() => 'error')

    const res = await generateGuards({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ alpha: [raw('boomA', PASSING_STEPS)], beta: [raw('boomB', PASSING_STEPS)] }),
    })

    expect(res.birthFindings).toEqual([])
    expect(res.errors.some((e) => e.anchor === 'alpha')).toBe(true)
    expect(res.errors.some((e) => e.anchor === 'beta')).toBe(true)
    // Only the round-1 batch ran — an infra error is never re-confirmed in isolation.
    expect(isolationCalls(calls)).toHaveLength(0)
    expect(res.written).toEqual([])
  }, 60_000)
})
