/**
 * The worker + adjudication path, end to end through the REAL driver.
 *
 * Every other guard test injects stage runners or a turn fn, so the driver's own
 * path to the model — resolve the transport, resolve each stage's model, spawn
 * each stage's runner, and drive the cli WORKER SESSIONS over the claude-code
 * turn protocol (`--session-id` on the first turn, `--resume` after) — is never
 * exercised. This drives `guardGenerateInProcess` with NO injected runner and no
 * installed transport (the OSS Claude Code shape: the engine materializes its
 * cli default), answering every stage through a fake `claude` binary that
 * speaks the turn protocol. The journey catalog is still supplied — it is the
 * deterministic analyzer seam, not a runner.
 *
 * What it pins: a worker session settles a birth-FAILING flow with ITS OWN
 * diagnosis (the triage wire shape, committed on the manifest), a GREEN one is
 * fidelity-reviewed one-shot before it persists — each on the per-stage model
 * the driver resolved — and the session's turns reached the binary as
 * `--session-id` then `--resume`.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardGenerateInProcess } from '@truecourse/core/commands/guard-in-process'
import { readManifest } from '@truecourse/guard-runner'
import { getDefaultTransport, setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm'
import { resolveModel } from '../../packages/core/src/config/llm-models.js'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, DEFAULT_JOURNEYS } from '../guard-generator/helpers.js'

const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude/claude.mjs', import.meta.url))

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

/** One fenced-JSON action reply, the shape the loop's text protocol parses. */
const action = (value: unknown): string => '```json\n' + JSON.stringify(value) + '\n```'

/** Every stage's answer, keyed by stage then by a substring of its user prompt
 *  (and, for the worker turn protocol, the session's 0-based turn index). */
const SCRIPT = {
  'guard.extract': [
    {
      reply: {
        claims: [
          { claim: 'prints the version and exits 0', driver: 'cli', sectionAnchor: 'version', reason: 'exit code is observable' },
          { claim: 'boom completes and exits 0', driver: 'cli', sectionAnchor: 'boom', reason: 'exit code is observable' },
        ],
        untestable: [],
      },
    },
  ],
  'guard.flows': [
    {
      reply: {
        flows: [
          {
            title: GREEN_FLOW,
            goal: 'read the version off the CLI',
            milestones: [{ order: 1, doc: DOC, anchor: 'version', claimTitle: 'prints the version and exits 0' }],
          },
          {
            title: RED_FLOW,
            goal: 'run the boom command to completion',
            milestones: [{ order: 1, doc: DOC, anchor: 'boom', claimTitle: 'boom completes and exits 0' }],
          },
        ],
        noFlowClaims: [],
      },
    },
  ],
  'guard.match': [
    { match: `FLOW: ${GREEN_FLOW}`, reply: { plan: [{ journeyId: 'cli/relkit', milestone: 1 }] } },
    { match: `FLOW: ${RED_FLOW}`, reply: { plan: [{ journeyId: 'cli/relkit-boom', milestone: 1 }] } },
  ],
  // The worker turn protocol: turn 0 opens with the author prompt (dispatch on
  // the FLOW line) and runs the draft; turn 1 wakes to the capture and settles
  // by its verdict — the RED flow settles FAILING with its own diagnosis.
  'guard.generate': [
    {
      turn: 0,
      match: `FLOW: ${GREEN_FLOW}`,
      replyText: action({
        tool: 'run_scenario',
        args: {
          scenario: {
            title: GREEN_FLOW,
            driver: 'cli',
            steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }],
          },
        },
      }),
    },
    {
      // The fixture CLI exits 7 on `boom`, so this scenario runs red in-session
      // and the session commits it FAILING with a diagnosis.
      turn: 0,
      match: `FLOW: ${RED_FLOW}`,
      replyText: action({
        tool: 'run_scenario',
        args: {
          scenario: {
            title: RED_SCENARIO,
            driver: 'cli',
            steps: [{ run: ['boom'], expect: { exit: 0 }, milestone: 1 }],
          },
        },
      }),
    },
    {
      turn: 1,
      match: '"verdict": "pass"',
      replyText: action({ outcome: { result: 'settled' } }),
    },
    {
      turn: 1,
      match: '"verdict": "fail"',
      replyText: action({
        outcome: {
          result: 'settled',
          failing: {
            verdict: 'code-drift',
            confidence: 'medium',
            brief: 'The doc promises `boom` exits 0; the program exits 7.',
            recommendation: 'Make `relkit boom` exit 0, or correct the documented exit code.',
          },
        },
      }),
    },
  ],
  'guard.fidelity': [{ match: GREEN_FLOW, reply: { verdict: 'faithful' } }],
}

interface FakeCall {
  stage: string
  model: string
  match: string | null
  sessionId?: string
  turn?: number
  resumed?: boolean
}

const repos: string[] = []
const dirs: string[] = []
let logPath = ''
const originalBinary = process.env.CLAUDE_CODE_BINARY
let originalTransport: LlmTransport | undefined

beforeEach(() => {
  originalTransport = getDefaultTransport()
  const io = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fake-claude-'))
  dirs.push(io)
  logPath = path.join(io, 'calls.ndjson')
  const scriptPath = path.join(io, 'script.json')
  fs.writeFileSync(scriptPath, JSON.stringify(SCRIPT))
  process.env.CLAUDE_CODE_BINARY = FAKE_CLAUDE
  process.env.FAKE_CLAUDE_SCRIPT = scriptPath
  process.env.FAKE_CLAUDE_LOG = logPath
  process.env.FAKE_CLAUDE_SESSIONS = path.join(io, 'sessions')
  // The OSS shape the bug hid in: nothing installed, so the driver hands the engine
  // no transport and the engine materializes its cli default.
  setDefaultTransport(undefined)
})

afterEach(() => {
  if (originalBinary === undefined) delete process.env.CLAUDE_CODE_BINARY
  else process.env.CLAUDE_CODE_BINARY = originalBinary
  delete process.env.FAKE_CLAUDE_SCRIPT
  delete process.env.FAKE_CLAUDE_LOG
  delete process.env.FAKE_CLAUDE_SESSIONS
  setDefaultTransport(originalTransport)
  while (repos.length) rmrf(repos.pop()!)
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

function seed(): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

function calls(): FakeCall[] {
  if (!fs.existsSync(logPath)) return []
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeCall)
}

describe('guardGenerateInProcess — the worker sessions + adjudication reach the model', () => {
  it('the sessions speak the turn protocol, settle their own verdicts, and fidelity reviews the green', async () => {
    const r = seed()

    const { guard } = await guardGenerateInProcess(r, { journeys: DEFAULT_JOURNEYS(r) })

    expect(guard.status).toBe('ok')

    // TWO worker sessions of two turns each, on the model the driver resolved for
    // guard.generate, each speaking the turn protocol: `--session-id` mints the
    // session on turn 0, `--resume` carries it on turn 1.
    const genModel = resolveModel('guard.generate', undefined, r)
    const turnCalls = calls().filter((c) => c.stage === 'guard.generate')
    expect(turnCalls).toHaveLength(4)
    expect(turnCalls.every((c) => c.model === genModel)).toBe(true)
    const bySession = new Map<string, FakeCall[]>()
    for (const c of turnCalls) {
      expect(c.sessionId).toBeTruthy()
      const list = bySession.get(c.sessionId!) ?? []
      list.push(c)
      bySession.set(c.sessionId!, list)
    }
    expect(bySession.size).toBe(2)
    for (const session of bySession.values()) {
      expect(session.map((c) => [c.turn, c.resumed])).toEqual([
        [0, false],
        [1, true],
      ])
    }

    // The green scenario was fidelity-reviewed one-shot, on its own model.
    expect(calls().filter((c) => c.stage === 'guard.fidelity')).toEqual([
      { stage: 'guard.fidelity', model: resolveModel('guard.fidelity', undefined, r), match: GREEN_FLOW },
    ])

    // The worker's OWN diagnosis lands where the dashboard reads it: on the
    // COMMITTED diagnosis (the triage wire shape, fed in-session now).
    const flows = readManifest(r)!.flows
    const red = flows.find((f) => f.flowId === 'runs-boom')!
    expect(red.scenarios[0].status).toBe('failing')
    expect(red.scenarios[0].diagnosis).toMatchObject({
      title: RED_SCENARIO,
      triage: { verdict: 'code-drift', confidence: 'medium' },
    })
    expect(guard.birthFindings.find((f) => f.scenarioId === red.scenarios[0].id)?.triage?.verdict).toBe('code-drift')

    // The reviewed green scenario persisted on its faithful verdict.
    const green = flows.find((f) => f.flowId === 'prints-the-version')!
    expect(green.scenarios[0].status).toBe('passing')

    // The transcripts landed under the run id the report names.
    expect(guard.authoringRunId).toBeTruthy()
    const transcriptDir = path.join(r, '.truecourse', 'guard', 'authoring', guard.authoringRunId!)
    expect(fs.readdirSync(transcriptDir).sort()).toEqual(['prints-the-version.cli.jsonl', 'runs-boom.cli.jsonl'])
  })
})
