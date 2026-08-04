/**
 * The adjudication stages, end to end through the REAL driver.
 *
 * Every other guard test injects stage runners, so the driver's own path to the
 * model — resolve the transport, resolve each stage's model, spawn each stage's
 * runner — is never exercised, and a stage that never spawned looked exactly like
 * a stage with nothing to do. This drives `guardGenerateInProcess` with NO injected
 * runner and no installed transport (the OSS Claude Code shape: the engine
 * materializes its cli default), answering every stage through a fake `claude`
 * binary. The journey catalog is still supplied — it is the deterministic analyzer
 * seam, not a runner, and holding it fixed keeps the surfaces stable.
 *
 * What it pins: a birth-FAILING flow commits with a triage verdict on its
 * diagnosis, and a GREEN one is fidelity-reviewed before it persists — each on the
 * per-stage model the driver resolved.
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

/** Every stage's answer, keyed by stage then by a substring of its user prompt. */
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
  'guard.generate': [
    {
      match: `FLOW: ${GREEN_FLOW}`,
      reply: {
        scenario: {
          title: GREEN_FLOW,
          driver: 'cli',
          steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }],
        },
      },
    },
    {
      // The fixture CLI exits 7 on `boom`, so this scenario is born red — and the
      // evidence retry (same prompt, same answer) leaves it red.
      match: `FLOW: ${RED_FLOW}`,
      reply: {
        scenario: {
          title: RED_SCENARIO,
          driver: 'cli',
          steps: [{ run: ['boom'], expect: { exit: 0 }, milestone: 1 }],
        },
      },
    },
  ],
  'guard.fidelity': [{ match: GREEN_FLOW, reply: { verdict: 'faithful' } }],
  'guard.triage': [
    {
      match: RED_SCENARIO,
      reply: {
        verdict: 'code-drift',
        confidence: 'medium',
        brief: 'The doc promises `boom` exits 0; the program exits 7.',
        recommendation: 'Make `relkit boom` exit 0, or correct the documented exit code.',
      },
    },
  ],
}

interface FakeCall {
  stage: string
  model: string
  match: string | null
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
  // The OSS shape the bug hid in: nothing installed, so the driver hands the engine
  // no transport and the engine materializes its cli default.
  setDefaultTransport(undefined)
})

afterEach(() => {
  if (originalBinary === undefined) delete process.env.CLAUDE_CODE_BINARY
  else process.env.CLAUDE_CODE_BINARY = originalBinary
  delete process.env.FAKE_CLAUDE_SCRIPT
  delete process.env.FAKE_CLAUDE_LOG
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

describe('guardGenerateInProcess — the adjudication stages reach the model', () => {
  it('triages the birth-failing test and fidelity-reviews the green one, on their own models', async () => {
    const r = seed()

    const { guard } = await guardGenerateInProcess(r, { journeys: DEFAULT_JOURNEYS(r) })

    expect(guard.status).toBe('ok')

    // Each stage reached the model exactly once, on the model the driver resolved
    // for it, over the subject it was engaged for.
    expect(calls().filter((c) => c.stage === 'guard.fidelity')).toEqual([
      { stage: 'guard.fidelity', model: resolveModel('guard.fidelity', undefined, r), match: GREEN_FLOW },
    ])
    expect(calls().filter((c) => c.stage === 'guard.triage')).toEqual([
      { stage: 'guard.triage', model: resolveModel('guard.triage', undefined, r), match: RED_SCENARIO },
    ])

    // The verdict lands where the dashboard reads it: on the COMMITTED diagnosis.
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
  })
})
