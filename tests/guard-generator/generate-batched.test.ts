import { describe, it, expect, afterEach } from 'vitest'
import { type GenerateRunner } from '@truecourse/guard-generator'
import {
  defaultGuardExecutor,
  loadScenarios,
  readManifest,
  type GuardExecutor,
  type GuardExecInput,
  type GuardExecReport,
} from '@truecourse/guard-runner'
import { type GuardScenarioResult } from '@truecourse/shared'
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
  runGenerate,
  journeysOf,
  cliJourney,
  apiJourney,
  stampMilestones,
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
      const base = { id: s.id, title: s.title, binds: s.binds[0], durationMs: 0 }
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

/** Two docs → two independent single-claim api flows (api is the only prepared surface). */
function twoApiDocs(r: string): void {
  writeApiRecipe(r, { entry: null })
  writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
  writeDoc(r, 'docs/a.md', '## alpha\nGET /a returns 200.\n')
  writeDoc(r, 'docs/b.md', '## beta\nGET /b returns 200.\n')
}
const apiExtract = extractBy({
  alpha: [{ driver: 'api', claim: 'GET /a returns 200', reason: 'status' }],
  beta: [{ driver: 'api', claim: 'GET /b returns 200', reason: 'status' }],
})
const apiJourneys = (r: string) => journeysOf(r, apiJourney('GET', '/a'), apiJourney('GET', '/b'))

/** Two docs → two independent single-claim cli flows. */
function twoDocs(r: string): void {
  writeRecipe(r)
  writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
  writeDoc(r, 'docs/a.md', '## alpha\n`relkit --version` exits 0.\n')
  writeDoc(r, 'docs/b.md', '## beta\n`relkit --version` exits 0.\n')
}

describe('generateGuards — batched birth validation (layer a)', () => {
  it('births EVERY flow\'s round-1 candidates in ONE executor invocation', async () => {
    const r = repo()
    twoDocs(r)
    const { exec, calls } = countingExecutor()

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ alpha: raw('a', PASSING_STEPS), beta: raw('b', PASSING_STEPS) }),
    })

    expect(res.written.map((w) => w.flowId).sort()).toEqual(['alpha', 'beta'])
    // Two flows, both pass at birth → exactly ONE round-1 executor invocation
    // (not one per flow), no retry round, no isolation.
    expect(calls).toHaveLength(1)
    expect(calls[0].scenarios).toHaveLength(2)
  }, 60_000)

  it('pools the retry round too: one round-1 + one retry invocation across flows', async () => {
    const r = repo()
    twoDocs(r)
    const { exec, calls } = countingExecutor()

    // Both flows fail birth in round 1; each retry (evidence attached) fixes it.
    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      generateRunner: authorBy({
        alpha: { first: raw('broken', FAILING_STEPS), retry: raw('fixed', PASSING_STEPS) },
        beta: { first: raw('broken', FAILING_STEPS), retry: raw('fixed', PASSING_STEPS) },
      }),
    })

    expect(res.written.map((w) => w.title).sort()).toEqual(['fixed', 'fixed'])
    expect(res.birthFindings).toEqual([])
    // One pooled round-1 invocation + one pooled retry invocation = 2 (no per-flow).
    expect(calls).toHaveLength(2)
    expect(calls[0].scenarios).toHaveLength(2) // round 1: both flows' broken candidates
    expect(calls[1].scenarios).toHaveLength(2) // retry: both flows' fixed candidates
  }, 60_000)

  it('attributes a birth failure to the right flow and commits BOTH tests', async () => {
    const r = repo()
    twoDocs(r)
    const { exec } = countingExecutor()

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      // alpha passes; beta always fails → beta is committed RED, alpha green.
      generateRunner: authorBy({ alpha: raw('a-good', PASSING_STEPS), beta: raw('b-bad', FAILING_STEPS) }),
    })

    expect(res.written.map((w) => [w.flowId, w.status]).sort()).toEqual([
      ['alpha', 'passing'],
      ['beta', 'failing'],
    ])
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0]).toMatchObject({
      anchor: 'beta',
      flowId: 'beta',
      surface: 'cli',
      title: 'b-bad',
      scenarioId: 'beta.cli.1',
      committed: true,
    })
    expect(loadScenarios(r).scenarios.map((s) => s.id).sort()).toEqual(['alpha.cli.1', 'beta.cli.1'])
    const flows = new Map(readManifest(r)!.flows.map((f) => [f.flowId, f]))
    expect(flows.get('alpha')!.scenarios).toEqual([{ id: 'alpha.cli.1', surface: 'cli', status: 'passing' }])
    expect(flows.get('alpha')!.generationInputsHash).toBeTruthy()
    // beta's test is committed with its failing status, so its flow SETTLED too.
    expect(flows.get('beta')!.scenarios).toMatchObject([
      { id: 'beta.cli.1', surface: 'cli', status: 'failing', diagnosis: { title: 'b-bad' } },
    ])
    expect(flows.get('beta')!.generationInputsHash).toBeTruthy()
    expect(res.flows).toMatchObject({ settled: 2, unsettled: 0 })
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

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      journeys: apiJourneys(r),
      extractRunner: apiExtract,
      generateRunner: authorBy({ alpha: rawApi('flipA', FAILING_API_STEPS), beta: rawApi('flipB', FAILING_API_STEPS) }),
    })

    // flipA flipped to a pass in isolation → alpha is committed GREEN; flipB's
    // confirmed failure is committed RED.
    expect(res.written.map((w) => [w.flowId, w.status]).sort()).toEqual([
      ['alpha', 'passing'],
      ['beta', 'failing'],
    ])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['flipB'])
    // The confirmed failure's evidence is the ISOLATED run's, not the polluted batch's.
    expect(res.birthFindings[0].actual).toBe('ISOLATED-FAIL')
    // round-1 (2) + retry (2) + one isolation per round-2 failure (flipA, flipB).
    expect(isolationCalls(calls)).toHaveLength(2)
    expect(loadScenarios(r).scenarios.map((s) => s.id).sort()).toEqual(['alpha.api.1', 'beta.api.1'])
  }, 60_000)

  it('caps isolated re-confirmations; beyond the cap findings carry the batch evidence', async () => {
    const r = repo()
    twoApiDocs(r)
    // Both flows fail always → two would-be findings, but the cap is 1.
    const { exec, calls } = mockExecutor(() => 'fail')

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      isolationCap: 1,
      concurrency: 4,
      journeys: apiJourneys(r),
      extractRunner: apiExtract,
      generateRunner: authorBy({ alpha: rawApi('fa', FAILING_API_STEPS), beta: rawApi('fb', FAILING_API_STEPS) }),
    })

    expect(res.birthFindings).toHaveLength(2)
    // Exactly ONE isolated re-confirmation ran (the cap); the other used batch evidence.
    expect(isolationCalls(calls)).toHaveLength(1)
    const actuals = res.birthFindings.map((f) => f.actual).sort()
    expect(actuals).toEqual(['BATCH-FAIL', 'ISOLATED-FAIL'])
    // Deterministic cap selection: the plan-first flow (docs/a.md → alpha) is the one
    // always isolated, never dependent on LLM/authoring completion order.
    expect(res.birthFindings.find((f) => f.actual === 'ISOLATED-FAIL')!.flowId).toBe('alpha')
  }, 60_000)

  it('isolates ONLY the api candidate of a flow; its cli fail goes straight to a finding', async () => {
    const r = repo()
    // One section → one flow, realized on BOTH prepared surfaces.
    writeApiRecipe(r)
    writeCorpus(r, [{ ref: 'docs/mix.md' }])
    writeDoc(r, 'docs/mix.md', '## mixed\n`relkit --version` exits 0 and GET /todos returns 200.\n')
    const { exec, calls } = mockExecutor(() => 'fail') // both surfaces always fail

    const perSurface: GenerateRunner = async (ctx) => ({
      scenario: stampMilestones(
        ctx.driver === 'api' ? rawApi('apiFail', FAILING_API_STEPS) : raw('cliFail', FAILING_STEPS),
        ctx.milestones.length,
      ),
    })

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      journeys: journeysOf(r, cliJourney(['relkit']), apiJourney('GET', '/todos')),
      extractRunner: extractBy({}),
      generateRunner: perSurface,
    })

    expect(res.birthFindings.map((f) => f.surface).sort()).toEqual(['api', 'cli'])
    expect(res.birthFindings.every((f) => f.flowId === 'mixed')).toBe(true)
    // Only the api finding was re-confirmed in isolation — cli never triggers a boot.
    expect(isolationCalls(calls)).toHaveLength(1)
    expect(res.birthFindings.find((f) => f.surface === 'api')!.actual).toBe('ISOLATED-FAIL')
    expect(res.birthFindings.find((f) => f.surface === 'cli')!.actual).toBe('BATCH-FAIL')
  }, 60_000)

  it('an infra error never triggers isolation and settles as an error, not a finding', async () => {
    const r = repo()
    twoDocs(r) // two flows → the round-1 batch is size 2 (not itself size-1)
    const { exec, calls } = mockExecutor(() => 'error')

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ alpha: raw('boomA', PASSING_STEPS), beta: raw('boomB', PASSING_STEPS) }),
    })

    expect(res.birthFindings).toEqual([])
    expect(res.errors.some((e) => e.anchor === 'alpha')).toBe(true)
    expect(res.errors.some((e) => e.anchor === 'beta')).toBe(true)
    // Only the round-1 batch ran — an infra error is never re-confirmed in isolation.
    expect(isolationCalls(calls)).toHaveLength(0)
    expect(res.written).toEqual([])
  }, 60_000)
})
