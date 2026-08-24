/**
 * The flow worker (the agentic authoring session): scripted turn backends
 * drive deterministic sessions over fake and REAL sandboxes. The canonical
 * convergence script — author with a wrong flag, read the usage error, fix,
 * settle — plus every structured ending and the settle gate's honesty rules.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  runFlowWorker,
  buildFlowScenario,
  type WorkerFlowInput,
} from '@truecourse/guard-generator'
import { defaultGuardExecutor } from '@truecourse/guard-runner'
import type {
  GuardFlow,
  GuardScenario,
  GuardScenarioResult,
  Journey,
} from '@truecourse/shared'
import type { LlmTurnFn, LlmTurnReply, LlmTurnRequest } from '@truecourse/shared/llm'
import { flowFingerprint, journeyFingerprint } from '@truecourse/shared'
import { bindsFor, makeTempRepo, rmrf, writeDoc, writeRecipe, FIXTURE_BIN } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

// --- scripted turn backend -------------------------------------------------

type Step = LlmTurnReply | Error | ((req: LlmTurnRequest) => LlmTurnReply)

function scriptedTurn(steps: Step[]): { turn: LlmTurnFn; requests: LlmTurnRequest[] } {
  const requests: LlmTurnRequest[] = []
  let i = 0
  const turn: LlmTurnFn = async (req) => {
    requests.push({ ...req, messages: [...req.messages] })
    const step = steps[i++]
    if (!step) throw new Error(`scripted turn exhausted after ${i - 1} steps`)
    if (step instanceof Error) throw step
    if (typeof step === 'function') return step(req)
    return step
  }
  return { turn, requests }
}

const action = (obj: unknown): LlmTurnReply => ({
  text: '```json\n' + JSON.stringify(obj) + '\n```',
  usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.01 },
})

// --- fixtures ---------------------------------------------------------------

function makeFlow(): GuardFlow {
  const milestones = [
    { order: 1, doc: 'docs/cli.md', anchor: 'cli/version', claimTitle: '`version` prints the version' },
    { order: 2, doc: 'docs/cli.md', anchor: 'cli/boom', claimTitle: '`boom` exits 7' },
  ]
  const flow = {
    id: 'check-version-and-boom',
    title: 'Version then boom',
    goal: 'The version prints and boom fails loudly',
    fingerprint: '',
    milestones,
    bindings: [{ doc: 'docs/cli.md', anchor: 'cli/version', fingerprint: 'sha256:1' }],
    composedOf: [],
    synthesisInputsHash: 'sha256:x',
  }
  return { ...flow, fingerprint: flowFingerprint(milestones) }
}

function fixtureJourney(): Journey {
  const j: Journey = {
    id: 'cli/relkit-version',
    type: 'cli',
    title: 'relkit version',
    entry: { command: ['relkit', 'version'] },
    steps: [{ kind: 'invoke', command: ['relkit', 'version'], flags: [] }],
    fingerprint: '',
  }
  return { ...j, fingerprint: journeyFingerprint(j) }
}

const GOOD_SCENARIO = {
  title: 'Version prints and boom fails',
  driver: 'cli' as const,
  steps: [
    { run: ['version'], expect: { exit: 0, stdout: { contains: '2.4.1' } }, milestone: 1 },
    { run: ['boom'], expect: { exit: 7 }, milestone: 2 },
  ],
}

const WRONG_FLAG_SCENARIO = {
  ...GOOD_SCENARIO,
  steps: [
    { run: ['version', '--porcelain'], expect: { exit: 0, stdout: { contains: '2.4.1' } }, milestone: 1 },
    { run: ['boom'], expect: { exit: 7 }, milestone: 2 },
  ],
}

/** A fake sandbox: wrong flag → usage error (exit 64), else both steps pass. */
async function fakeRun(scenario: GuardScenario): Promise<GuardScenarioResult> {
  const first = scenario.steps[0] as { run?: string[] }
  const failed = first.run?.includes('--porcelain')
  return {
    id: scenario.id,
    title: scenario.title,
    binds: scenario.binds[0]!,
    flowId: scenario.flow?.id,
    outcome: failed ? 'fail' : 'pass',
    durationMs: 5,
    ...(failed
      ? {
          failure: {
            step: 1,
            expected: 'exit 0',
            actual: 'exit 64',
            stderr: 'unknown flag: --porcelain',
          },
          failedMilestone: 1,
        }
      : {}),
  }
}

function workerInput(
  turn: LlmTurnFn,
  overrides: Partial<WorkerFlowInput> = {},
): WorkerFlowInput {
  const flow = makeFlow()
  return {
    flow,
    surface: 'cli',
    userPrompt: 'FLOW CONTEXT BLOCKS',
    turn,
    buildScenario: (raw) =>
      buildFlowScenario({ flow, journeys: [fixtureJourney()], raw, id: `${flow.id}.cli.1` }),
    validate: () => null,
    runScenario: fakeRun,
    stage: 'guard.generate',
    subject: flow.id,
    ...overrides,
  }
}

// --- the canonical convergence script ---------------------------------------

describe('runFlowWorker — convergence', () => {
  it('authors with a wrong flag, reads the usage error, fixes it, settles passing', async () => {
    const { turn, requests } = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: WRONG_FLAG_SCENARIO } }),
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({ outcome: { result: 'settled' } }),
    ])
    const result = await runFlowWorker(workerInput(turn))

    expect(result.kind).toBe('settled')
    if (result.kind !== 'settled') return
    expect(result.runResult.outcome).toBe('pass')
    expect(result.failing).toBeUndefined()
    expect(result.blockedMilestones).toEqual([])
    expect(result.scenario.id).toBe('check-version-and-boom.cli.1')
    // The engine owns identity: flow + binds stamped from engine state.
    expect(result.scenario.flow).toEqual({ id: 'check-version-and-boom', fingerprint: makeFlow().fingerprint })
    expect(result.session.usage.turns).toBe(3)

    // Turn 2 saw the usage error in the tool result.
    const turn2Tail = requests[1]!.messages[requests[1]!.messages.length - 1]!
    expect(turn2Tail.text).toContain('unknown flag: --porcelain')
    expect(turn2Tail.text).toContain('"verdict": "fail"')
  })

  it('settles FAILING with a diagnosis when code and doc disagree', async () => {
    const { turn } = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: WRONG_FLAG_SCENARIO } }),
      action({
        outcome: {
          result: 'settled',
          failing: {
            verdict: 'code-drift',
            confidence: 'high',
            brief: 'The program rejects the documented flag.',
            recommendation: 'Support --porcelain as documented, or fix the doc.',
          },
        },
      }),
    ])
    const result = await runFlowWorker(workerInput(turn))
    expect(result.kind).toBe('settled')
    if (result.kind !== 'settled') return
    expect(result.runResult.outcome).toBe('fail')
    expect(result.failing?.verdict).toBe('code-drift')
  })
})

// --- the settle gate --------------------------------------------------------

describe('runFlowWorker — the settle gate', () => {
  it('re-asks a settle before any run, then accepts after one', async () => {
    const { turn, requests } = scriptedTurn([
      action({ outcome: { result: 'settled' } }),
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({ outcome: { result: 'settled' } }),
    ])
    const result = await runFlowWorker(workerInput(turn))
    expect(result.kind).toBe('settled')
    const reask = requests[1]!.messages[requests[1]!.messages.length - 1]!
    expect(reask.text).toContain('nothing has been executed')
  })

  it('re-asks a passing settle whose last run failed', async () => {
    const { turn, requests } = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: WRONG_FLAG_SCENARIO } }),
      action({ outcome: { result: 'settled' } }),
      action({
        outcome: {
          result: 'settled',
          failing: { verdict: 'doc-drift', confidence: 'medium', brief: 'b', recommendation: 'r' },
        },
      }),
    ])
    const result = await runFlowWorker(workerInput(turn))
    expect(result.kind).toBe('settled')
    if (result.kind !== 'settled') return
    expect(result.failing?.verdict).toBe('doc-drift')
    const reask = requests[2]!.messages[requests[2]!.messages.length - 1]!
    expect(reask.text).toContain('did not pass')
  })

  it('re-asks a failing settle whose last run passed', async () => {
    const { turn } = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({
        outcome: {
          result: 'settled',
          failing: { verdict: 'code-drift', confidence: 'high', brief: 'b', recommendation: 'r' },
        },
      }),
      action({ outcome: { result: 'settled' } }),
    ])
    const result = await runFlowWorker(workerInput(turn))
    expect(result.kind).toBe('settled')
    if (result.kind !== 'settled') return
    expect(result.failing).toBeUndefined()
  })

  it('re-asks when the settle leaves a milestone unrealized, accepts it named blocked', async () => {
    const oneStep = {
      title: 'Only the version',
      driver: 'cli' as const,
      steps: [{ run: ['version'], expect: { exit: 0 }, milestone: 1 }],
    }
    const { turn, requests } = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: oneStep } }),
      action({ outcome: { result: 'settled' } }),
      action({
        outcome: {
          result: 'settled',
          blockedMilestones: [{ milestone: 2, blockedOn: ['missing-data', 'a boom fixture'] }],
        },
      }),
    ])
    const result = await runFlowWorker(workerInput(turn))
    expect(result.kind).toBe('settled')
    if (result.kind !== 'settled') return
    expect(result.blockedMilestones).toEqual([
      { milestone: 2, blockedOn: ['missing-data', 'a boom fixture'] },
    ])
    const reask = requests[2]!.messages[requests[2]!.messages.length - 1]!
    expect(reask.text).toContain('milestone(s) 2 unrealized')
  })

  it('rejects a settle that blocks every milestone', async () => {
    const { turn, requests } = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({
        outcome: {
          result: 'settled',
          blockedMilestones: [
            { milestone: 1, blockedOn: ['network'] },
            { milestone: 2, blockedOn: ['network'] },
          ],
        },
      }),
      action({ outcome: { result: 'blocked', blockedOn: ['network'] } }),
    ])
    const result = await runFlowWorker(workerInput(turn))
    expect(result.kind).toBe('blocked')
    const reask = requests[2]!.messages[requests[2]!.messages.length - 1]!
    expect(reask.text).toContain('`blocked` outcome')
  })
})

// --- other endings ----------------------------------------------------------

describe('runFlowWorker — endings', () => {
  it('blocked, with per-milestone detail', async () => {
    const { turn } = scriptedTurn([
      action({
        outcome: {
          result: 'blocked',
          blockedOn: ['anthropic', 'credentials'],
          blockedMilestones: [{ milestone: 1, blockedOn: ['anthropic'] }],
        },
      }),
    ])
    const result = await runFlowWorker(workerInput(turn))
    expect(result.kind).toBe('blocked')
    if (result.kind !== 'blocked') return
    expect(result.blockedOn).toEqual(['anthropic', 'credentials'])
    expect(result.blockedMilestones).toHaveLength(1)
  })

  it('journey-defect, with the promised-vs-observed report', async () => {
    const { turn } = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: WRONG_FLAG_SCENARIO } }),
      action({
        outcome: {
          result: 'journey-defect',
          argv: ['version', '--porcelain'],
          promised: 'the grammar lists --porcelain on `version`',
          observed: 'unknown flag: --porcelain (exit 64)',
        },
      }),
    ])
    const result = await runFlowWorker(workerInput(turn))
    expect(result.kind).toBe('journey-defect')
    if (result.kind !== 'journey-defect') return
    expect(result.argv).toEqual(['version', '--porcelain'])
    expect(result.observed).toContain('unknown flag')
  })

  it('exhausts the turn budget honestly, session state intact', async () => {
    const loop = action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } })
    const { turn } = scriptedTurn([loop, loop, loop])
    const result = await runFlowWorker(workerInput(turn, { budget: { maxTurns: 3 } }))
    expect(result.kind).toBe('exhausted')
    if (result.kind !== 'exhausted') return
    expect(result.reason).toBe('turn-budget')
    expect(result.session.usage.turns).toBe(3)
    expect(result.session.lastRun?.result.outcome).toBe('pass')
  })

  it('a validation-failed draft costs no sandbox run', async () => {
    let sandboxRuns = 0
    let validations = 0
    const { turn, requests } = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({ outcome: { result: 'settled' } }),
    ])
    const result = await runFlowWorker(
      workerInput(turn, {
        validate: () => (validations++ === 0 ? 'step 1 restates the program name' : null),
        runScenario: async (s) => {
          sandboxRuns++
          return fakeRun(s)
        },
      }),
    )
    expect(result.kind).toBe('settled')
    expect(sandboxRuns).toBe(1)
    const seen = requests[1]!.messages[requests[1]!.messages.length - 1]!
    expect(seen.text).toContain('restates the program name')
    expect(seen.text).toContain('"verdict": "invalid"')
  })
})

// --- resume -----------------------------------------------------------------

describe('runFlowWorker — resume', () => {
  it('continues a settled session on a fidelity flag and re-settles after a re-run', async () => {
    const first = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({ outcome: { result: 'settled' } }),
    ])
    const r1 = await runFlowWorker(workerInput(first.turn))
    expect(r1.kind).toBe('settled')
    if (r1.kind !== 'settled') return

    const second = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({ outcome: { result: 'settled' } }),
    ])
    const r2 = await runFlowWorker(
      workerInput(second.turn, {
        resume: {
          messages: r1.session.messages,
          sessionId: r1.session.sessionId,
          observation: 'A reviewer flagged the assertion as vacuous: strengthen it.',
          lastRun: r1.session.lastRun,
        },
      }),
    )
    expect(r2.kind).toBe('settled')
    const opening = second.requests[0]!.messages[second.requests[0]!.messages.length - 1]!
    expect(opening.text).toContain('flagged the assertion')
    expect(second.requests[0]!.messages.length).toBeGreaterThan(1)
  })

  it('a confirmation flip can settle failing WITHOUT a re-run (seeded lastRun)', async () => {
    const first = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({ outcome: { result: 'settled' } }),
    ])
    const r1 = await runFlowWorker(workerInput(first.turn))
    if (r1.kind !== 'settled') throw new Error('setup')

    // The engine's confirmation run failed; it seeds the flip as lastRun.
    const flipped: GuardScenarioResult = {
      ...r1.runResult,
      outcome: 'fail',
      failure: { step: 2, expected: 'exit 7', actual: 'exit 0' },
    }
    const second = scriptedTurn([
      action({
        outcome: {
          result: 'settled',
          failing: {
            verdict: 'code-drift',
            confidence: 'medium',
            brief: 'boom no longer fails',
            recommendation: 'boom should exit 7 per the doc',
          },
        },
      }),
    ])
    const r2 = await runFlowWorker(
      workerInput(second.turn, {
        resume: {
          messages: r1.session.messages,
          sessionId: r1.session.sessionId,
          observation: 'The confirmation run failed: step 2 expected exit 7, got exit 0.',
          lastRun: { ...r1.session.lastRun!, result: flipped },
        },
      }),
    )
    expect(r2.kind).toBe('settled')
    if (r2.kind !== 'settled') return
    expect(r2.failing?.verdict).toBe('code-drift')
    expect(r2.runResult.outcome).toBe('fail')
  })
})

// --- the REAL sandbox -------------------------------------------------------

describe('runFlowWorker — real executor against relkit', () => {
  it('converges through the real sandbox: wrong flag fails, corrected scenario passes', async () => {
    const repo = makeTempRepo()
    repos.push(repo)
    writeRecipe(repo)
    const recipe = { build: 'true', entry: ['node', FIXTURE_BIN] }
    // The runner's binding check only executes scenarios whose bound sections
    // exist at their recorded fingerprints — seed a real doc and bind live.
    writeDoc(repo, 'docs/cli.md', '# version\nprints the version\n\n# boom\nexits 7\n')
    const liveBindings = [
      ...bindsFor(repo, 'docs/cli.md', 'version'),
      ...bindsFor(repo, 'docs/cli.md', 'boom'),
    ].map((b) => ({ doc: b.doc, anchor: b.section, fingerprint: b.fingerprint }))
    const flow = { ...makeFlow(), bindings: liveBindings }

    const runScenario = async (scenario: GuardScenario): Promise<GuardScenarioResult> => {
      const res = await defaultGuardExecutor({
        checkoutDir: repo,
        recipe,
        scenarios: [scenario],
        persist: false,
        runTimeoutMs: 120_000,
      })
      if (res.status !== 'ok') throw new Error(`runner refused: ${res.status}`)
      return res.latest.scenarios.find((s) => s.id === scenario.id)!
    }

    // relkit answers `--porcelain` as an unknown COMMAND (exit 64) — the real
    // usage error the worker must read and converge on.
    const wrongInvocation = {
      ...GOOD_SCENARIO,
      steps: [
        { run: ['--porcelain'], expect: { exit: 0, stdout: { contains: '2.4.1' } }, milestone: 1 },
        { run: ['boom'], expect: { exit: 7 }, milestone: 2 },
      ],
    }
    const { turn, requests } = scriptedTurn([
      action({ tool: 'run_scenario', args: { scenario: wrongInvocation } }),
      action({ tool: 'run_scenario', args: { scenario: GOOD_SCENARIO } }),
      action({ outcome: { result: 'settled' } }),
    ])
    const result = await runFlowWorker(
      workerInput(turn, {
        flow,
        runScenario,
        buildScenario: (rawScenario) =>
          buildFlowScenario({ flow, journeys: [fixtureJourney()], raw: rawScenario, id: `${flow.id}.cli.1` }),
      }),
    )

    expect(result.kind).toBe('settled')
    if (result.kind !== 'settled') return
    expect(result.runResult.outcome).toBe('pass')
    // The real relkit rejected the invented flag; the worker read the capture.
    const observed = requests[1]!.messages[requests[1]!.messages.length - 1]!
    expect(observed.text).toContain('"verdict": "fail"')
  }, 120_000)
})
