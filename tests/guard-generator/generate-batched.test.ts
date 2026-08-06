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
  workerTurnBy,
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

/** The layer-d isolation phase's own signal: `confirm` fires once per generate,
 *  carrying how many would-be findings are re-checked in clean rooms. A cli
 *  candidate never enters it (its worker session already ran it alone). */
function isolationPhases(phases: { phase: string; total?: number }[]): { phase: string; total?: number }[] {
  return phases.filter((p) => p.phase === 'confirm')
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

describe('generateGuards — batched confirmation of worker settles (layer a)', () => {
  it('confirms EVERY flow\'s settled candidate in ONE executor invocation', async () => {
    const r = repo()
    twoDocs(r)
    const { exec, calls } = countingExecutor()

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ alpha: raw('a', PASSING_STEPS), beta: raw('b', PASSING_STEPS) }),
    })

    expect(res.written.map((w) => w.flowId).sort()).toEqual(['alpha', 'beta'])
    // Each session executes its own draft alone (one single-candidate invocation
    // per flow), then EVERY settle joins ONE shared confirmation batch — the gate
    // of record — never one confirmation per flow.
    expect(calls).toHaveLength(3)
    expect(isolationCalls(calls)).toHaveLength(2) // the two in-session runs
    const batch = calls[calls.length - 1]
    expect(batch.scenarios.map((s) => s.id).sort()).toEqual(['alpha.cli.1', 'beta.cli.1'])
  }, 60_000)

  it('a session that revises in-loop runs twice, and both flows still share ONE confirmation', async () => {
    const r = repo()
    twoDocs(r)
    const { exec, calls } = countingExecutor()

    // Each session's first draft fails in the sandbox; it revises to `fixed`, runs
    // that, and settles on it.
    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({
        alpha: { first: raw('broken', FAILING_STEPS), retry: raw('fixed', PASSING_STEPS) },
        beta: { first: raw('broken', FAILING_STEPS), retry: raw('fixed', PASSING_STEPS) },
      }),
    })

    expect(res.written.map((w) => w.title).sort()).toEqual(['fixed', 'fixed'])
    expect(res.birthFindings).toEqual([])
    // Two in-session runs per flow (draft, then revision) + ONE pooled confirmation.
    expect(calls).toHaveLength(5)
    expect(isolationCalls(calls)).toHaveLength(4)
    expect(calls[4].scenarios).toHaveLength(2) // the confirmation: both flows' settles
  }, 60_000)

  it('attributes a confirmation failure to the right flow and commits BOTH tests', async () => {
    const r = repo()
    twoDocs(r)
    const { exec } = countingExecutor()

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      // alpha passes; beta always fails → beta is committed RED, alpha green.
      turnFn: workerTurnBy({ alpha: raw('a-good', PASSING_STEPS), beta: raw('b-bad', FAILING_STEPS) }),
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
    // beta's test is committed with its failing status, so its flow SETTLED too —
    // and the session's own diagnosis rides the durable manifest entry.
    expect(flows.get('beta')!.scenarios).toMatchObject([
      {
        id: 'beta.cli.1',
        surface: 'cli',
        status: 'failing',
        diagnosis: { title: 'b-bad', triage: { verdict: 'code-drift' } },
      },
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
    // ONE round-1 batch (both api candidates) + one isolation per failure (flipA, flipB).
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

  it('isolates ONLY the api candidate of a flow; its cli fail is diagnosed by the session', async () => {
    const r = repo()
    // One section → one flow, realized on BOTH prepared surfaces.
    writeApiRecipe(r)
    writeCorpus(r, [{ ref: 'docs/mix.md' }])
    writeDoc(r, 'docs/mix.md', '## mixed\n`relkit --version` exits 0 and GET /todos returns 200.\n')
    const { exec } = mockExecutor(() => 'fail') // both surfaces always fail
    const phases: { phase: string; total?: number }[] = []

    const apiAuthor: GenerateRunner = async (ctx) => ({
      scenario: stampMilestones(rawApi('apiFail', FAILING_API_STEPS), ctx.milestones.length),
    })

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      journeys: journeysOf(r, cliJourney(['relkit']), apiJourney('GET', '/todos')),
      extractRunner: extractBy({}),
      generateRunner: apiAuthor,
      turnFn: workerTurnBy({ mixed: raw('cliFail', FAILING_STEPS) }),
      onBirthPhase: (phase, total) => phases.push({ phase, total }),
    })

    expect(res.birthFindings.map((f) => f.surface).sort()).toEqual(['api', 'cli'])
    expect(res.birthFindings.every((f) => f.flowId === 'mixed')).toBe(true)
    // Exactly ONE candidate entered the isolated re-confirmation — the api one. A cli
    // scenario already ran alone in its session's sandbox, so it never enters layer d.
    expect(isolationPhases(phases)).toEqual([{ phase: 'confirm', total: 1 }])
    expect(res.birthFindings.find((f) => f.surface === 'api')!.actual).toBe('ISOLATED-FAIL')
    // The cli failure is committed with the SESSION's diagnosis instead — the
    // judgment was made while the flow was still open.
    expect(res.birthFindings.find((f) => f.surface === 'cli')!.triage).toMatchObject({ verdict: 'code-drift' })
  }, 60_000)

  it('an infra error never triggers isolation and settles as an error, not a finding', async () => {
    const r = repo()
    twoDocs(r)
    const { exec } = mockExecutor(() => 'error')
    const phases: { phase: string; total?: number }[] = []

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ alpha: raw('boomA', PASSING_STEPS), beta: raw('boomB', PASSING_STEPS) }),
      onBirthPhase: (phase, total) => phases.push({ phase, total }),
    })

    expect(res.birthFindings).toEqual([])
    expect(res.errors.some((e) => e.anchor === 'alpha')).toBe(true)
    expect(res.errors.some((e) => e.anchor === 'beta')).toBe(true)
    // An infra error is never re-confirmed in isolation — nothing entered layer d.
    expect(isolationPhases(phases)).toEqual([])
    expect(res.written).toEqual([])
  }, 60_000)
})
