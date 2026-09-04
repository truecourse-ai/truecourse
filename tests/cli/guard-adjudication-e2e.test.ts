/**
 * ADJUDICATION, end to end through `guardGenerateInProcess` (plan 04 steps
 * 17–20).
 *
 * Every other guard test injects the seams, so the command adapter's own wiring
 * — resolve the transport, build the session seams, hand them to the engine,
 * dispatch the fidelity CHILD from inside `submit_scenario` — is never
 * exercised, and a stage that never ran looked exactly like a stage with
 * nothing to do. This drives the command with NO injected seam: the session
 * driver is scripted at the module core imports it from, and the ONE remaining
 * one-shot stage (`guard.match`) answers through a real transport so its
 * per-stage model resolution is still covered.
 *
 * What it pins, on the session path:
 *  - a red flow commits with the WORKER's own confirmed `expectedRed` as its
 *    diagnosis, and NO `triage` verdict — the triage stage is retired;
 *  - a green flow is reviewed by a real depth-1 `guard-generate.fidelity` child
 *    before it persists;
 *  - the retired stages (`guard.extract`, `guard.flows`, `guard.generate`,
 *    `guard.retry`, `guard.fidelity`, `guard.triage`) make NO transport call.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The generate seams build their driver through core's own module; there is no
 * production driver seam on `guardGenerateInProcess`, so the module is mocked
 * where the BUILT core imports it from and each case scripts it.
 */
let sessionScript: StubScript = () => {
  throw new Error('no session script installed for this case')
}
vi.mock('../../packages/core/dist/services/llm/session-driver.js', () => ({
  SESSION_MODEL_CLAUDE_CODE: 'opus',
  assertSessionBackendReady: async () => {},
  createConfiguredSessionDriver: () => {
    const { driver } = stubDriver((call) => sessionScript(call))
    return { driver, mode: 'claude-code', attribution: driver.attribution }
  },
}))

import { guardGenerateInProcess } from '@truecourse/core/commands/guard-in-process'
import { readManifest } from '@truecourse/guard-runner'
import { setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm'
import { resolveModel } from '../../packages/core/src/config/llm-models.js'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, DEFAULT_INTERFACES } from '../guard-generator/helpers.js'
import { outcome, stubDriver, type StubCall, type StubScript } from '../core/spec-scan-session-stub'

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## boom',
  '`relkit boom` completes successfully and exits 0.',
].join('\n')

const GREEN_FLOW = 'prints the version'
const RED_FLOW = 'runs boom'
const RED_SCENARIO = 'boom exits zero'

const repos: string[] = []
let home = ''
let priorHome: string | undefined

/** Every transport request the run made (the one-shot stages). */
let transportCalls: { stage?: string; model?: string }[] = []

beforeEach(() => {
  priorHome = process.env.TRUECOURSE_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-adjudication-home-'))
  process.env.TRUECOURSE_HOME = home
  transportCalls = []
})

afterEach(() => {
  setDefaultTransport(undefined)
  if (priorHome === undefined) delete process.env.TRUECOURSE_HOME
  else process.env.TRUECOURSE_HOME = priorHome
  fs.rmSync(home, { recursive: true, force: true })
  while (repos.length) rmrf(repos.pop()!)
})

function seed(): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

/** Call one of a session's tools the way a driver does. */
async function callTool(call: StubCall, name: string, args: unknown): Promise<{ content: string; isError?: boolean }> {
  const tool = call.def.tools.find((t) => t.name === name)!
  const result = await tool.execute(args, {
    workItem: call.input.workItem,
    signal: call.input.signal,
    dispatchChild: call.input.dispatchChild,
  })
  await call.emit({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError })
  return result
}

/** The matcher is the one remaining one-shot: answer it off the prompt. */
function matchOnlyTransport(): LlmTransport {
  return async (req) => {
    transportCalls.push({ stage: req.stage, model: req.model })
    if (req.stage === 'guard.match') {
      const interfaceId = /^--- id: (.+)$/m.exec(req.user)?.[1] ?? ''
      return JSON.stringify({ plan: [{ interfaceId, milestone: 1 }] })
    }
    return '{}'
  }
}

const CLAIMS = {
  version: 'prints the version and exits 0',
  boom: 'boom completes and exits 0',
}

const scenarioYaml = (title: string, argv: string[]): string =>
  [`title: ${title}`, 'steps:', `  - run: ${JSON.stringify(argv)}`, '    expect: { exit: 0 }', '    milestone: 1'].join('\n')

/** Which flow a worker session is for, read off its briefing. */
const flowOf = (call: StubCall): string => (call.briefing.includes(RED_FLOW) ? RED_FLOW : GREEN_FLOW)

describe('guardGenerateInProcess — adjudication on the session path', () => {
  it('commits the red with the worker’s expectedRed (no triage) and reviews the green with a real child', async () => {
    const r = seed()
    const kinds: string[] = []

    sessionScript = async (call) => {
      kinds.push(call.def.kind)
      if (call.def.kind === 'guard-generate.extract') {
        const draft = {
          claims: [
            { claim: CLAIMS.version, driver: 'cli', sectionAnchor: 'version', reason: 'exit code is observable', needs: [] },
            { claim: CLAIMS.boom, driver: 'cli', sectionAnchor: 'boom', reason: 'exit code is observable', needs: [] },
          ],
          untestable: [],
        }
        await callTool(call, 'check_claims', draft)
        return outcome(draft)
      }
      if (call.def.kind === 'guard-generate.flows') {
        // The epic session shares the kind; only the AREA session has read_section.
        if (!call.def.tools.some((t) => t.name === 'read_section')) {
          await callTool(call, 'check_flows', { epics: [] })
          return outcome({ epics: [] })
        }
        const draft = {
          flows: [
            {
              title: GREEN_FLOW,
              goal: 'read the version off the CLI',
              milestones: [{ order: 1, doc: DOC, anchor: 'version', claimTitle: CLAIMS.version }],
            },
            {
              title: RED_FLOW,
              goal: 'run the boom command to completion',
              milestones: [{ order: 1, doc: DOC, anchor: 'boom', claimTitle: CLAIMS.boom }],
            },
          ],
          noFlowClaims: [],
        }
        await callTool(call, 'check_flows', draft)
        return outcome(draft)
      }
      if (call.def.kind === 'guard-generate.fidelity') {
        return outcome({ verdict: 'faithful' })
      }
      // The flow worker. `run_scenario` first — the outcome precondition
      // refuses a verdict from a session that never executed anything.
      if (flowOf(call) === RED_FLOW) {
        const yamlText = scenarioYaml(RED_SCENARIO, ['boom'])
        await callTool(call, 'run_scenario', { yaml: yamlText })
        // The fixture CLI exits 7 on `boom`: observe the red, then declare it.
        const probe = await callTool(call, 'submit_scenario', { yaml: yamlText, expectedReds: [] })
        const actual = /^actual:\s+(.*)$/m.exec(probe.content)?.[1] ?? ''
        const expectedReds = [
          {
            step: 1,
            predictedActual: actual,
            verdict: 'code-drift' as const,
            brief: 'The doc promises `boom` exits 0; the program exits 7.',
          },
        ]
        const accepted = await callTool(call, 'submit_scenario', { yaml: yamlText, expectedReds })
        const sha = /under sha ([0-9a-f]{64})/.exec(accepted.content)?.[1]
        if (!sha) throw new Error(`the red submission was refused: ${accepted.content}`)
        return outcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds })
      }
      await callTool(call, 'run_scenario', { yaml: scenarioYaml(GREEN_FLOW, ['--version']) })
      const accepted = await callTool(call, 'submit_scenario', {
        yaml: scenarioYaml(GREEN_FLOW, ['--version']),
        expectedReds: [],
      })
      const sha = /under sha ([0-9a-f]{64})/.exec(accepted.content)?.[1]
      if (!sha) throw new Error(`the green submission was refused: ${accepted.content}`)
      return outcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [] })
    }
    setDefaultTransport(matchOnlyTransport())

    const { guard } = await guardGenerateInProcess(r, { interfaces: DEFAULT_INTERFACES(r) })

    expect(guard.status).toBe('ok')

    // Every content stage ran as a SESSION — including a real depth-1 fidelity
    // child for the green (and only for the green: a red never reaches a judge).
    expect(kinds.filter((k) => k === 'guard-generate.flow-worker')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'guard-generate.fidelity')).toHaveLength(1)

    // The ONE surviving one-shot reached the model on the tier the driver
    // resolved for it; no retired stage made a call at all.
    const matchModel = resolveModel('guard.match', undefined, r)
    expect(transportCalls.filter((c) => c.stage === 'guard.match').every((c) => c.model === matchModel)).toBe(true)
    for (const retired of ['guard.extract', 'guard.flows', 'guard.generate', 'guard.retry', 'guard.fidelity', 'guard.triage']) {
      expect(transportCalls.some((c) => c.stage === retired)).toBe(false)
    }

    // The verdict lands where the dashboard reads it: on the COMMITTED diagnosis
    // — and it is the WORKER's own confirmed prediction, never a triage verdict.
    const flows = readManifest(r)!.flows
    const red = flows.find((f) => f.flowId === 'runs-boom')!
    expect(red.scenarios[0].status).toBe('failing')
    expect(red.scenarios[0].diagnosis).toMatchObject({ title: RED_SCENARIO })
    expect(red.scenarios[0].diagnosis!.triage).toBeUndefined()
    expect(red.scenarios[0].diagnosis!.expectedRed).toMatchObject({ step: 1, verdict: 'code-drift' })
    const finding = guard.birthFindings.find((f) => f.scenarioId === red.scenarios[0].id)!
    expect(finding.triage).toBeUndefined()
    expect(finding.expectedRed?.brief).toContain('exits 7')

    // The reviewed green scenario persisted on its faithful verdict, and the run
    // reports nothing unadjudicated.
    const green = flows.find((f) => f.flowId === 'prints-the-version')!
    expect(green.scenarios[0].status).toBe('passing')
    expect(guard.unadjudicated).toEqual([])
  }, 120_000)
})
