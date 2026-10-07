/**
 * SINGLE-STEP MODE — `generateGuards({ only })` plus
 * `createGuardGenerateSessionSeams({ only })`, the two halves behind
 * single-step generation (`only: extract | flows | worker`), on the
 * `spec scan` template.
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
  assertSessionBackendReady: async () => {},
  createClaudeCodeSessionDriver: () => {
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
  claimsBy,
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
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache'
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs'

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

beforeEach(() => {
  constructions = 0
  sessionScript = () => {
    throw new Error('no session script installed for this case')
  }
  installMemoryKvCache()
  installMemorySessionRuns()
})
afterEach(() => {
  resetKvCacheStore()
  resetSessionRuns()
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

describe('only: flows', () => {
  it('synthesizes flows, returns before the workers, and leaves flows.json unwritten', async () => {
    const r = docRepo()
    const res = await runGenerate({
      repoRoot: r,
      only: 'flows',
      claims: claimsBy({}),
      flowsAreaSession: flowPerClaimSession(),
      flowsEpicSession: noEpicSessions,
      // `noWorkerSessions` throws if it is ever reached.
      flowWorkerSession: noWorkerSessions,
    })

    expect(res.status).toBe('ok')
    expect(res.stoppedAfter).toBe('flows')
    // The step's work really happened — the flows exist in the result…
    expect(res.flows.total).toBeGreaterThan(0)
    // …and only in the result: the stored corpus is untouched.
    expect(readFlowsFile(r)).toBeNull()
    wroteNothing(r)
  })
})

describe('only: worker', () => {
  it('is the ONLY step that writes: flows.json, the manifest and the scenario files all land', async () => {
    const r = docRepo()
    const res = await runGenerate({
      repoRoot: r,
      only: 'worker',
      claims: claimsBy({ background: { untestable: 'design history' } }),
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
      verification: { scope: 'configuration', method: 'behavior', observable: 'Version on stdout', cases: [{ id: 'version-text', claim: 'Prints the version', method: 'behavior', requires: ['process'], conditions: [] }] },
      needs: [],
    },
  ],
  untestable: [],
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
  it('only: worker on a cold flows cache throws for the FLOWS step', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    const built = constructions

    const seams = createGuardGenerateSessionSeams({ repoRoot: r, only: 'worker' })
    // The flows step's own cache is cold, so the run stops there.
    const error = await seams
      .flowsAreaSession({ areas: [areaOf([doc])], docs: [doc] })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GenerateStepNotReadyError)
    expect((error as GenerateStepNotReadyError).step).toBe('flows')
    expect((error as GenerateStepNotReadyError).missing).toEqual(['area:cli'])
    expect(constructions).toBe(built)
  })

  it('only: worker refuses the EPIC session too — it belongs to the flows step', async () => {
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

})

// ---------------------------------------------------------------------------
// the estimate gate prices only the chosen step
// ---------------------------------------------------------------------------

describe('the pre-flight estimate', () => {
  const stagesOf = async (r: string, only?: 'flows' | 'worker'): Promise<string[]> =>
    ((await estimateGuardTokens(r, undefined, only ? { only } : {})).stages ?? []).map((s) => s.stage)

  it('quotes exactly the chosen step — the worker step carrying match and its fidelity child', async () => {
    const r = docRepo()
    // The whole pipeline, for contrast: every stage a full generate can spend
    // on (`guardRecipe` quotes nothing — the fixture already has a recipe).
    expect(await stagesOf(r)).toEqual([
      FLOWS_SESSION_KIND,
      'guardMatch',
      FLOW_WORKER_SESSION_KIND,
      FIDELITY_SESSION_KIND,
    ])
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

