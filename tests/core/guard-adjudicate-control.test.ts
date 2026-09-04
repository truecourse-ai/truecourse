/**
 * THE VERIFICATION CHILD — `guard-adjudicate.control` (plan 05 step 22): the
 * depth-1 session a suspected `bug` must survive, and the `verify_bug` tool
 * that dispatches it.
 *
 * Three things are load-bearing and each has its own describe:
 *  - `run_control`'s PARSE GATE and its execution cap — a malformed experiment
 *    must cost a turn, never a sandbox, and a control is one or two
 *    discriminating runs rather than a search;
 *  - the DISPATCH — the child runs through the real loop (its ctx is the
 *    shell's, so `dispatchChild` is the production path), its conclusion comes
 *    back under an ENGINE-minted reference, and that reference is what the
 *    engine stashes;
 *  - PERSIST NOTHING — a control that really executed against the `relkit`
 *    fixture leaves the board and the run store byte-identical.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  loadRecipe,
  recipePath,
  defaultGuardExecutor,
  writeGuardLatest,
  writeGuardRun,
  guardDir,
  type GuardExecInput,
  type GuardExecReport,
} from '@truecourse/guard-runner'
import type { GuardScenarioResult } from '@truecourse/shared'
import type { SessionRunInput, ToolContext } from '../../packages/agent-loop/src/index'
import { runAgentLoop } from '../../packages/agent-loop/src/index'
import {
  CONTROL_BUDGET,
  CONTROL_MAX_EXECUTIONS,
  CONTROL_SESSION_KIND,
  controlSessionDef,
} from '../../packages/core/src/services/guard-adjudicate/control'
import {
  adjudicationSessionDef,
  ADJUDICATE_BUDGET,
  ADJUDICATE_SESSION_KIND,
} from '../../packages/core/src/services/guard-adjudicate/session'
import { newSessionState } from '../../packages/core/src/services/guard-adjudicate/tools'
import type { AdjudicationExecution } from '../../packages/core/src/services/guard-adjudicate/execute'
import { board, failRow, item, makeRepo, rmrf, RUN_ID, scenarioDoc } from './guard-adjudicate-helpers'
import { memoryPersistence, outcome, stubDriver, transportFailure, type StubCall } from './spec-scan-session-stub'
import { writeRecipe, specBinds, FIXTURE_BIN } from '../guard-runner/helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeRepo()
  repos.push(r)
  return r
}

const CTX: ToolContext = {
  workItem: 'scn.a',
  signal: new AbortController().signal,
  dispatchChild: () => {
    throw new Error('run_control dispatches nothing')
  },
}

function exec(
  executor: (input: GuardExecInput) => Promise<GuardExecReport>,
  over: Partial<AdjudicationExecution> = {},
): AdjudicationExecution {
  return {
    executor,
    recipe: { build: 'true', entry: ['node', 'nothing.mjs'] } as AdjudicationExecution['recipe'],
    repoRoot: '/nowhere',
    branch: null,
    commit: null,
    built: false,
    ...over,
  }
}

function okReport(id: string): GuardExecReport {
  const row: GuardScenarioResult = {
    id,
    title: `${id} title`,
    binds: { doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' },
    outcome: 'pass',
    durationMs: 2,
  }
  return {
    status: 'ok',
    latest: board([row]),
    latestPath: '/nowhere/LATEST.json',
    loadErrors: [],
    manifest: null,
  } as GuardExecReport
}

/** A valid control experiment, as the child would hand it over. */
const CONTROL_YAML = yaml.dump(scenarioDoc('ctl.experiment'))

// ---------------------------------------------------------------------------
// run_control — the parse gate and the cap
// ---------------------------------------------------------------------------

describe('run_control — a malformed experiment costs a turn, never a sandbox', () => {
  function control(executor: (input: GuardExecInput) => Promise<GuardExecReport>) {
    const def = controlSessionDef(exec(executor))
    const tool = def.tools.find((t) => t.name === 'run_control')!
    return { def, run: (args: unknown) => tool.execute(args, CTX) }
  }

  it('refuses unparseable YAML without reaching the executor', async () => {
    let runs = 0
    const { run } = control(async () => {
      runs++
      return okReport('ctl.experiment')
    })

    const result = await run({ yaml: 'id: [unclosed\n  steps: -\n' })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('YAML parse error')
    expect(runs).toBe(0)
  })

  it('refuses a document the scenario schema rejects, naming the paths', async () => {
    let runs = 0
    const { run } = control(async () => {
      runs++
      return okReport('ctl.experiment')
    })
    const { binds: _dropped, ...noBinds } = scenarioDoc('ctl.experiment') as Record<string, unknown>

    const result = await run({ yaml: yaml.dump(noBinds) })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('does not parse')
    expect(result.content).toContain('binds')
    expect(runs).toBe(0)
  })

  it('refuses a matcher whose regex does not compile, naming the step and the pattern', async () => {
    let runs = 0
    const { run } = control(async () => {
      runs++
      return okReport('ctl.experiment')
    })
    const bad = scenarioDoc('ctl.experiment', {
      steps: [{ run: ['--version'], expect: { exit: 0, stdout: { matches: '(' } } }],
    } as never)

    const result = await run({ yaml: yaml.dump(bad) })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('step 1')
    expect(result.content).toContain('expect.stdout')
    expect(result.content).toContain('not a valid regular expression')
    expect(runs).toBe(0)
  })

  it(`executes at most ${CONTROL_MAX_EXECUTIONS} times per child`, async () => {
    let runs = 0
    const { run } = control(async () => {
      runs++
      return okReport('ctl.experiment')
    })

    for (let i = 0; i < CONTROL_MAX_EXECUTIONS; i++) {
      expect((await run({ yaml: CONTROL_YAML })).isError, `call ${i + 1}`).toBe(false)
    }
    const overflow = await run({ yaml: CONTROL_YAML })

    expect(overflow.isError).toBe(true)
    expect(overflow.content).toContain('cap reached')
    expect(runs).toBe(CONTROL_MAX_EXECUTIONS)
  })

  it('is proof-class: one tool, its own budget, and no conclusion without a run', () => {
    const def = controlSessionDef(exec(async () => okReport('ctl.experiment')))

    expect(def.kind).toBe(CONTROL_SESSION_KIND)
    expect(CONTROL_SESSION_KIND).toBe('guard-adjudicate.control')
    expect(def.tools.map((t) => t.name)).toEqual(['run_control'])
    expect(def.budget).toEqual(CONTROL_BUDGET)
    expect(CONTROL_BUDGET).toEqual({ turns: 8, maxResumes: 0, tokenCeiling: 100_000 })
    expect(def.outcomePrecondition?.tool).toBe('run_control')
  })
})

// ---------------------------------------------------------------------------
// verify_bug — the dispatch, through the real loop
// ---------------------------------------------------------------------------

describe('verify_bug — the engine mints the reference and keeps the record', () => {
  /** Call a tool the way a driver does, recording the tool-result event. */
  async function callTool(input: SessionRunInput, name: string, args: unknown) {
    const tool = input.def.tools.find((t) => t.name === name)!
    const result = await tool.execute(args, CTX)
    input.onEvent({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError })
    return result
  }

  /** Run one parent adjudication session over a scripted parent + child. */
  async function drive(script: {
    child: (call: StubCall) => ReturnType<typeof outcome> | ReturnType<typeof transportFailure>
    onVerify: (result: { content: string; isError?: boolean }) => unknown
  }) {
    const r = repo()
    // A real bundle, so the parent satisfies its `read_evidence` precondition
    // and runs exactly once (the shell would otherwise refuse the outcome and
    // hand the session another turn, dispatching a second control).
    const evidenceDir = path.join('.truecourse', 'guard', 'evidence', RUN_ID, 'scn.a')
    fs.mkdirSync(path.join(r, evidenceDir), { recursive: true })
    fs.writeFileSync(path.join(r, evidenceDir, 'transcript.txt'), 'step 3 failed\n')
    const state = newSessionState()
    const def = adjudicationSessionDef({
      repoRoot: r,
      item: item({ scenario: scenarioDoc('scn.a'), scenarioYaml: CONTROL_YAML, evidenceDir }),
      exec: exec(async () => okReport('ctl.experiment')),
      state,
    })
    const persistence = memoryPersistence()
    const { driver, calls } = stubDriver(async (call) => {
      if (call.kind === CONTROL_SESSION_KIND) {
        await callTool(call.input, 'run_control', { yaml: CONTROL_YAML })
        return script.child(call)
      }
      await callTool(call.input, 'read_evidence', { file: 'transcript.txt' })
      const verify = await callTool(call.input, 'verify_bug', {
        mechanism: 'src/api/todos.ts:42 drops the filter',
        disprove: 'a request with no filter returns the same rows',
      })
      return script.onVerify(verify) as never
    })

    const handle = runAgentLoop({
      def,
      workItem: 'scn.a',
      initialMessages: ['the briefing'],
      driver,
      persistence: persistence.persistence,
      sessionId: 'parent-1',
    })
    return { result: await handle.outcome, state, calls, events: persistence.events }
  }

  it('returns a refuting conclusion with a control-<id> reference, and stashes it', async () => {
    let verifyResult = { content: '', isError: undefined as boolean | undefined }
    const { result, state, calls } = await drive({
      child: () => outcome({ conclusion: 'refutes', reasoning: 'the control behaved as correct code predicts' }),
      onVerify: (v) => {
        verifyResult = v as typeof verifyResult
        // A `drift` verdict may cite the control; a `bug` one may not (fold).
        return outcome({
          class: 'drift',
          mechanism: 'the doc and the code disagree',
          evidence: ['a verbatim line'],
          confidence: 'medium',
          findings: [],
        })
      },
    })

    expect(result.status).toBe('completed')
    expect(verifyResult.isError).toBeUndefined()
    expect(verifyResult.content).toContain('control concluded: refutes')
    expect(verifyResult.content).toContain('must not be `bug`')
    const ref = /control-[0-9a-f]{8}/.exec(verifyResult.content)?.[0]
    expect(ref, verifyResult.content).toBeTruthy()
    // The ENGINE's record, under the ENGINE's reference — never the model's word.
    expect(state.controls.get(ref!)).toEqual({
      conclusion: 'refutes',
      reasoning: 'the control behaved as correct code predicts',
    })
    // The child really ran as a depth-1 session of the same driver.
    expect(calls.map((c) => c.kind)).toEqual([ADJUDICATE_SESSION_KIND, CONTROL_SESSION_KIND])
  })

  it('reports a dead control as a tool error and lets the parent continue', async () => {
    let verifyResult = { content: '', isError: undefined as boolean | undefined }
    const { result, state } = await drive({
      child: () => transportFailure(),
      onVerify: (v) => {
        verifyResult = v as typeof verifyResult
        return outcome({
          class: 'infrastructure',
          mechanism: 'nothing about the repo is in dispute',
          evidence: ['a verbatim line'],
          confidence: 'low',
          findings: [],
        })
      },
    })

    expect(verifyResult.isError).toBe(true)
    expect(verifyResult.content).toContain('the control session failed')
    expect(verifyResult.content).toContain('the provider failed (provider): the provider is gone')
    // Nothing was stashed, so no outcome can cite a control from this session.
    expect(state.controls.size).toBe(0)
    // The parent survived its child's death and produced its verdict.
    expect(result.status).toBe('completed')
  })

  it('states the parent budget and the read-evidence precondition it runs under', () => {
    const def = adjudicationSessionDef({
      repoRoot: '/nowhere',
      item: item(),
      exec: exec(async () => okReport('x')),
      state: newSessionState(),
    })

    expect(def.kind).toBe('guard-adjudicate.failure')
    expect(def.budget).toEqual(ADJUDICATE_BUDGET)
    expect(ADJUDICATE_BUDGET).toEqual({ turns: 15, maxResumes: 1, tokenCeiling: 150_000 })
    expect(def.outcomePrecondition?.tool).toBe('read_evidence')
    expect(def.tools.map((t) => t.name)).toContain(def.outcomePrecondition!.tool)
  })
})

// ---------------------------------------------------------------------------
// Persist nothing — a real execution against the `relkit` fixture
// ---------------------------------------------------------------------------

describe('run_control — persist:false is structural, not advisory', () => {
  it('leaves the board and the run store byte-identical after a real execution', async () => {
    const r = repo()
    writeRecipe(r, { entry: ['node', FIXTURE_BIN] })
    const priorBoard = board([failRow('scn.a')], RUN_ID)
    writeGuardLatest(r, priorBoard)
    writeGuardRun(r, priorBoard)
    const latestPath = path.join(guardDir(r), 'LATEST.json')
    const runsDir = path.join(guardDir(r), 'runs')
    const latestBefore = fs.readFileSync(latestPath, 'utf-8')
    const runsBefore = fs.readdirSync(runsDir)

    const def = controlSessionDef({
      executor: defaultGuardExecutor,
      recipe: loadRecipe(r, recipePath(r))!.recipe,
      repoRoot: r,
      branch: null,
      commit: null,
      built: false,
    })
    const experiment = scenarioDoc('ctl.real', {
      binds: specBinds('cli/version'),
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
    } as never)

    const result = await def.tools
      .find((t) => t.name === 'run_control')!
      .execute({ yaml: yaml.dump(experiment) }, CTX)

    // It really executed — the fixture CLI answered.
    expect(result.isError).toBe(false)
    expect(result.content).toContain('outcome: pass')
    // …and nothing about the repo's guard store moved.
    expect(fs.readFileSync(latestPath, 'utf-8')).toBe(latestBefore)
    expect(fs.readdirSync(runsDir)).toEqual(runsBefore)
  }, 120_000)
})
