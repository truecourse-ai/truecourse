/**
 * PER-WORKER EXECUTION AND MULTI-FLOW ATTRIBUTION.
 *
 * The BATCHED birth-validation layer this file used to cover is gone (plan 04
 * step 17): a worker runs exactly one scenario per `run_scenario` /
 * `submit_scenario` call, in its own fresh sandbox. That also removes the
 * isolated RE-CONFIRMATION layer and its `isolationCap` — batch pollution is
 * unconstructible when every batch is size 1, so there is nothing to
 * re-confirm. The structural invariant that replaces those cases ("every
 * worker-path execution carries exactly one scenario") is pinned in
 * `tests/guard-generator/flow-worker.test.ts` → `describe('isolation')`.
 *
 * What survives here is what is still real: two independent flows are attributed
 * correctly (one green, one red), and an INFRA error settles as an error rather
 * than a finding.
 */
import { describe, it, expect, afterEach } from 'vitest'
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
  FAILING_STEPS,
  PASSING_STEPS,
  extractSessionBy,
  makeTempRepo,
  raw,
  rmrf,
  runGenerate,
  submitWorkerSessions,
  writeCorpus,
  writeDoc,
  writeRecipe,
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

/** A mock executor that reports every scenario as an infra ERROR. */
function erroringExecutor(): { exec: GuardExecutor; calls: GuardExecInput[] } {
  const calls: GuardExecInput[] = []
  const exec: GuardExecutor = async (input) => {
    calls.push(input)
    const scenarios: GuardScenarioResult[] = input.scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      binds: s.binds[0],
      durationMs: 0,
      outcome: 'error',
      failure: { step: 1, expected: 'ok', actual: 'infra boom' },
    }))
    return { status: 'ok', latest: { scenarios } } as unknown as GuardExecReport
  }
  return { exec, calls }
}

/** Two docs → two independent single-claim cli flows. */
function twoDocs(r: string): void {
  writeRecipe(r)
  writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
  writeDoc(r, 'docs/a.md', '## alpha\n`relkit --version` exits 0.\n')
  writeDoc(r, 'docs/b.md', '## beta\n`relkit --version` exits 0.\n')
}

describe('generateGuards — multi-flow attribution', () => {
  it('attributes each flow’s verdict to that flow and commits BOTH tests', async () => {
    const r = repo()
    twoDocs(r)
    const { exec, calls } = countingExecutor()

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractSession: extractSessionBy({}),
      // alpha passes; beta always fails → beta is committed RED, alpha green.
      flowWorkerSession: submitWorkerSessions((task) =>
        task.flowId === 'alpha' ? raw('a-good', PASSING_STEPS) : { red: raw('b-bad', FAILING_STEPS) },
      ),
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
      scenarioId: 'beta',
      committed: true,
    })
    expect(loadScenarios(r).scenarios.map((s) => s.id).sort()).toEqual(['alpha', 'beta'])
    const flows = new Map(readManifest(r)!.flows.map((f) => [f.flowId, f]))
    expect(flows.get('alpha')!.scenarios).toEqual([{ id: 'alpha', drivers: ['cli'], status: 'passing' }])
    expect(flows.get('alpha')!.generationInputsHash).toBeTruthy()
    // beta's test is committed with its failing status, so its flow SETTLED too.
    expect(flows.get('beta')!.scenarios).toMatchObject([
      { id: 'beta', drivers: ['cli'], status: 'failing', diagnosis: { title: 'b-bad' } },
    ])
    expect(flows.get('beta')!.generationInputsHash).toBeTruthy()
    expect(res.flows).toMatchObject({ settled: 2, unsettled: 0 })

    // Every execution the run made carried exactly ONE scenario — there is no
    // batch on the worker path, so nothing can pollute a sibling.
    expect(calls.every((c) => c.scenarios.length === 1)).toBe(true)
  }, 90_000)

  it('an infra error settles as an error, not a finding, and nothing is committed', async () => {
    const r = repo()
    twoDocs(r)
    const { exec } = erroringExecutor()

    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      concurrency: 4,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions((task) => raw(task.flowId, PASSING_STEPS)),
    })

    expect(res.birthFindings).toEqual([])
    expect(res.errors.some((e) => e.anchor === 'alpha')).toBe(true)
    expect(res.errors.some((e) => e.anchor === 'beta')).toBe(true)
    expect(res.written).toEqual([])
    // Neither flow settled: an infra error leaves the work for the next generate.
    expect(readManifest(r)!.flows.every((f) => f.generationInputsHash === null)).toBe(true)
  }, 90_000)
})
