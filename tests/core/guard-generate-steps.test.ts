/**
 * SINGLE-STEP MODE — `generateGuards({ only })` plus
 * `createGuardGenerateSessionSeams({ only })`, the two halves behind the CLI's
 * `--only-extract | --only-flows | --only-worker` flags (the `spec scan`
 * template, SPEC_GUARD_PLAN item 110).
 *
 * The rules under test:
 * - each step runs ONLY its own sessions: the ENGINE returns before the next
 *   step's seam is ever called, and the SEAMS replay every prior step from its
 *   outcome cache;
 * - a prior step's cache MISS fails loud (`GenerateStepNotReadyError`, naming
 *   the step to run first) instead of silently spending its sessions — and it
 *   never even constructs a driver;
 * - every durable output (scenario files, `scenarios/manifest.json`,
 *   `scenarios/flows.json`, `guard/auto-resolutions.json`) is written only when
 *   the FINAL step (`worker`) runs; each earlier stop returns `stoppedAfter`
 *   and touches nothing.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

let constructions = 0
let sessionScript: StubScript = () => {
  throw new Error('no session script installed for this case')
}
vi.mock('../../packages/core/src/services/llm/session-driver.js', () => ({
  SESSION_MODEL_CLAUDE_CODE: 'opus',
  assertSessionBackendReady: async () => {},
  createConfiguredSessionDriver: () => {
    constructions++
    const { driver } = stubDriver((call) => sessionScript(call))
    return { driver, mode: 'claude-code', attribution: driver.attribution }
  },
}))

import {
  collectWorkDocs,
  generateGuards,
  planGuardWork,
  readFlowsFile,
  type FlowSynthesisArea,
  type GuardDoc,
} from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import {
  EXTRACT_SESSION_KIND,
  FIDELITY_SESSION_KIND,
  FLOWS_EPIC_WORK_ITEM,
  FLOWS_SESSION_KIND,
  FLOW_WORKER_SESSION_KIND,
  GenerateStepNotReadyError,
  createGuardGenerateSessionSeams,
} from '../../packages/core/src/services/guard-generate/index'
import { estimateGuardTokens } from '../../packages/core/src/services/llm/spec-estimate'
import { outcome, stubDriver, type StubCall, type StubScript } from './spec-scan-session-stub'
import {
  PASSING_STEPS,
  extractSessionBy,
  flowPerClaimSession,
  flowStageSeams,
  makeTempRepo,
  noEpicSessions,
  noWorkerSessions,
  raw,
  rmrf,
  runGenerate,
  submitWorkerSessions,
  writeCorpus,
  writeDoc,
  writeRecipe,
} from '../guard-generator/helpers.js'

// ---------------------------------------------------------------------------
// fixture — one doc with one cli-testable section, the standard guard universe
// ---------------------------------------------------------------------------

const DOC = 'docs/cli.md'
const CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')

const repos: string[] = []
let home = ''

beforeEach(() => {
  constructions = 0
  sessionScript = () => {
    throw new Error('no session script installed for this case')
  }
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gg-steps-home-'))
  process.env.TRUECOURSE_HOME = home
})
afterEach(() => {
  delete process.env.TRUECOURSE_HOME
  fs.rmSync(home, { recursive: true, force: true })
  while (repos.length) rmrf(repos.pop()!)
})

function docRepo(): string {
  const r = makeTempRepo()
  repos.push(r)
  execSync('git init -q -b main', { cwd: r })
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, CONTENT)
  return r
}

const docsOf = (r: string): GuardDoc[] => collectWorkDocs(r, planGuardWork(r))
const manifestFile = (r: string): string => path.join(r, '.truecourse', 'scenarios', 'manifest.json')
const flowsFile = (r: string): string => path.join(r, '.truecourse', 'scenarios', 'flows.json')

/** Every durable output a generate can leave behind — none of them may appear
 *  before the FINAL step runs. */
function wroteNothing(r: string): void {
  expect(fs.existsSync(manifestFile(r))).toBe(false)
  expect(fs.existsSync(flowsFile(r))).toBe(false)
  expect(fs.existsSync(path.join(r, '.truecourse', 'guard', 'auto-resolutions.json'))).toBe(false)
  const dir = path.join(r, '.truecourse', 'scenarios')
  const yamls = fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.yaml'))
    : []
  expect(yamls).toEqual([])
}

// ---------------------------------------------------------------------------
// the engine: where each step stops, and what it is allowed to write
// ---------------------------------------------------------------------------

describe('--only-extract', () => {
  it('runs extraction and returns before synthesis — nothing downstream starts, nothing is written', async () => {
    const r = docRepo()
    const seen: string[] = []
    const res = await runGenerate({
      repoRoot: r,
      only: 'extract',
      extractSession: extractSessionBy({}, (doc) => seen.push(doc)),
      flowsAreaSession: () => {
        throw new Error('flow synthesis belongs to --only-flows')
      },
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })

    expect(res.status).toBe('ok')
    expect(res.stoppedAfter).toBe('extract')
    expect(seen).toEqual([DOC])
    // Extraction's own settlements are reported; nothing flow-shaped is.
    expect(res.flows.total).toBe(0)
    expect(res.written).toEqual([])
    wroteNothing(r)
  })
})

describe('--only-flows', () => {
  it('synthesizes flows, returns before the workers, and leaves flows.json unwritten', async () => {
    const r = docRepo()
    const res = await runGenerate({
      repoRoot: r,
      only: 'flows',
      extractSession: extractSessionBy({}),
      flowsAreaSession: flowPerClaimSession(),
      flowsEpicSession: noEpicSessions,
      // `noWorkerSessions` throws if it is ever reached.
      flowWorkerSession: noWorkerSessions,
    })

    expect(res.status).toBe('ok')
    expect(res.stoppedAfter).toBe('flows')
    // The step's work really happened — the flows exist in the result…
    expect(res.flows.total).toBeGreaterThan(0)
    // …and only in the result: the committable corpus is untouched.
    expect(readFlowsFile(r)).toBeNull()
    wroteNothing(r)
  })
})

describe('--only-worker', () => {
  it('is the ONLY step that writes: flows.json, the manifest and the scenario files all land', async () => {
    const r = docRepo()
    const res = await runGenerate({
      repoRoot: r,
      only: 'worker',
      extractSession: extractSessionBy({ background: { untestable: 'design history' } }),
      flowWorkerSession: submitWorkerSessions(() => raw('v', PASSING_STEPS)),
    })

    expect(res.status).toBe('ok')
    // A completed generate never reports a stop, `only` or not.
    expect(res.stoppedAfter).toBeUndefined()
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(readFlowsFile(r)?.flows.map((f) => f.id)).toEqual(['version'])
    expect(readManifest(r)?.flows.map((f) => f.flowId)).toEqual(['version'])
  }, 60_000)
})

// ---------------------------------------------------------------------------
// the seams: prior steps replay from cache, and a miss fails loud
// ---------------------------------------------------------------------------

const EXTRACT_DRAFT = {
  claims: [
    {
      claim: '`relkit --version` prints the version',
      driver: 'cli' as const,
      sectionAnchor: 'version',
      reason: 'stdout carries the version',
      needs: [],
    },
  ],
  untestable: [],
}

/** Run the extract step for real (through the mocked driver), warming its cache. */
async function warmExtractCache(r: string, doc: GuardDoc): Promise<void> {
  sessionScript = async (call) => {
    await callTool(call, 'check_claims', EXTRACT_DRAFT)
    return outcome(EXTRACT_DRAFT)
  }
  const seams = createGuardGenerateSessionSeams({ repoRoot: r, only: 'extract' })
  const { summary } = await seams.extractSession({ docs: [doc] })
  expect(summary).toMatchObject({ ran: 1, failed: 0 })
}

/** Call a session tool the way a driver does. */
async function callTool(call: StubCall, name: string, args: unknown): Promise<void> {
  const tool = call.def.tools.find((t) => t.name === name)!
  const result = await tool.execute(args, {
    workItem: call.input.workItem,
    signal: call.input.signal,
    dispatchChild: call.input.dispatchChild,
  })
  await call.emit({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError })
}

/** The one area a `flows` session is handed for the fixture doc. */
function areaOf(docs: GuardDoc[]): FlowSynthesisArea {
  return {
    areaId: 'cli',
    docs: docs.map((d) => ({
      doc: d.doc,
      outline: d.sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
      untestable: [],
    })),
    claims: [
      {
        doc: DOC,
        anchor: 'version',
        title: '`relkit --version` prints the version',
        driver: 'cli',
      },
    ],
  }
}

describe('a prior step not yet run', () => {
  it('--only-flows on a cold extraction cache throws, naming the step and its misses', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, only: 'flows' })
    const error = await seams.extractSession({ docs: [doc] }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GenerateStepNotReadyError)
    expect((error as GenerateStepNotReadyError).step).toBe('extract')
    expect((error as GenerateStepNotReadyError).missing).toHaveLength(1)
    expect((error as GenerateStepNotReadyError).message).toContain('--only-extract')
    // A refusal to replay must not even build a driver, let alone spend.
    expect(constructions).toBe(0)
    expect(seams.runId()).toBeUndefined()
  })

  it('--only-worker on a cold flows cache throws for the FLOWS step, extraction having replayed clean', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    await warmExtractCache(r, doc)
    const built = constructions

    const seams = createGuardGenerateSessionSeams({ repoRoot: r, only: 'worker' })
    // Extraction replays from the cache the step above wrote…
    const replayed = await seams.extractSession({ docs: [doc] })
    expect(replayed.summary).toMatchObject({ ran: 0, fromCache: 1, failed: 0 })

    // …and the next step's own cache is cold, so the run stops there.
    const error = await seams
      .flowsAreaSession({ areas: [areaOf([doc])], docs: [doc] })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GenerateStepNotReadyError)
    expect((error as GenerateStepNotReadyError).step).toBe('flows')
    expect((error as GenerateStepNotReadyError).missing).toEqual(['area:cli'])
    expect(constructions).toBe(built)
  })

  it('--only-worker refuses the EPIC session too — it belongs to the flows step', async () => {
    const r = docRepo()
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, only: 'worker' })
    const error = await seams
      .flowsEpicSession({
        digests: [{ ref: 'F1', areaId: 'cli', title: 'v', goal: 'g', milestones: [] }],
        claims: [],
      })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GenerateStepNotReadyError)
    expect((error as GenerateStepNotReadyError).step).toBe('flows')
    expect((error as GenerateStepNotReadyError).missing).toEqual([FLOWS_EPIC_WORK_ITEM])
    expect(constructions).toBe(0)
  })

  it('the chosen step itself is never cache-only — --only-extract spends on a cold cache', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    await warmExtractCache(r, doc)
    expect(constructions).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// the estimate gate prices only the chosen step
// ---------------------------------------------------------------------------

describe('the pre-flight estimate', () => {
  const stagesOf = async (r: string, only?: 'extract' | 'flows' | 'worker'): Promise<string[]> =>
    ((await estimateGuardTokens(r, undefined, only ? { only } : {})).stages ?? []).map((s) => s.stage)

  it('quotes exactly the chosen step — the worker step carrying match and its fidelity child', async () => {
    const r = docRepo()
    // The whole pipeline, for contrast: every stage a full generate can spend
    // on (`guardRecipe` quotes nothing — the fixture already has a recipe).
    expect(await stagesOf(r)).toEqual([
      EXTRACT_SESSION_KIND,
      FLOWS_SESSION_KIND,
      'guardMatch',
      FLOW_WORKER_SESSION_KIND,
      FIDELITY_SESSION_KIND,
    ])
    expect(await stagesOf(r, 'extract')).toEqual([EXTRACT_SESSION_KIND])
    expect(await stagesOf(r, 'flows')).toEqual([FLOWS_SESSION_KIND])
    expect(await stagesOf(r, 'worker')).toEqual([
      'guardMatch',
      FLOW_WORKER_SESSION_KIND,
      FIDELITY_SESSION_KIND,
    ])
  })
})

// ---------------------------------------------------------------------------
// the stepwise chain, end to end through the engine
// ---------------------------------------------------------------------------

describe('the stepwise chain', () => {
  it('extract → flows replays the extraction from cache and still writes nothing', async () => {
    const r = docRepo()
    let extracted = 0

    const seams = (only: 'extract' | 'flows') =>
      createGuardGenerateSessionSeams({ repoRoot: r, only })

    sessionScript = async (call) => {
      extracted++
      await callTool(call, 'check_claims', EXTRACT_DRAFT)
      return outcome(EXTRACT_DRAFT)
    }
    const first = await generateGuards({
      ...flowStageSeams(r),
      repoRoot: r,
      only: 'extract',
      extractSession: seams('extract').extractSession,
    })
    expect(first.stoppedAfter).toBe('extract')
    expect(extracted).toBe(1)

    // The flows leg replays extraction from the cache the first leg wrote — the
    // stub would throw a second time only if a session were spent.
    const second = await generateGuards({
      ...flowStageSeams(r),
      repoRoot: r,
      only: 'flows',
      extractSession: seams('flows').extractSession,
      flowsAreaSession: flowPerClaimSession(),
    })
    expect(second.stoppedAfter).toBe('flows')
    expect(second.flows.total).toBeGreaterThan(0)
    expect(extracted).toBe(1)
    wroteNothing(r)
  })
})
