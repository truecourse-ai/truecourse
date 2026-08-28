/**
 * THE FLOW-WORKER SEAM AND THE FIDELITY CHILD (plan 04 steps 17 + 18) — core's
 * half: the session def, the `guard/generate` cache (kept name, session prompt
 * fingerprint), the two-wave pool, the settled-sha reject, and the depth-1
 * fidelity child with its `guard/fidelity` cache.
 *
 * The engine half (pre-flight, execution, the done-gate, the fold) is
 * `tests/guard-generator/flow-worker.test.ts`; here the {@link FlowWorkerTask}s
 * are hand-built with scripted closures, so every assertion is about the seam.
 *
 * The production driver path (`createConfiguredSessionDriver`) is mocked with a
 * counter — a cached task must build NO driver — and each case scripts it.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'

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

import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import type { ToolContext, SessionOutcome } from '../../packages/agent-loop/src/index'
import {
  collectWorkDocs,
  planGuardWork,
  workerCacheKey,
  type FlowWorkerTask,
  type GuardDoc,
  type WorkerFidelityInput,
} from '@truecourse/guard-generator'
import type { GuardExpectedRed } from '@truecourse/shared'
import {
  FIDELITY_SESSION_BUDGET,
  FIDELITY_SESSION_CACHE_NAME,
  FIDELITY_SESSION_KIND,
  FLOW_WORKER_API_PROMPT_FINGERPRINT,
  FLOW_WORKER_API_SYSTEM_PROMPT,
  FLOW_WORKER_BUDGET,
  FLOW_WORKER_CACHE_NAME,
  FLOW_WORKER_CLI_PROMPT_FINGERPRINT,
  FLOW_WORKER_CLI_SYSTEM_PROMPT,
  FLOW_WORKER_WEB_SYSTEM_PROMPT,
  FLOW_WORKER_SESSION_KIND,
  buildGuardDocUniverse,
  cacheableWorkerOutcome,
  createGuardGenerateSessionSeams,
  fidelitySessionCacheKey,
  fidelitySessionDef,
  flowWorkerCacheKey,
  flowWorkerPromptFingerprint,
  flowWorkerSessionDef,
  judgeWorkerFidelity,
} from '../../packages/core/src/services/guard-generate/index'
import { memoryPersistence, outcome, stubDriver, type StubCall, type StubScript } from './spec-scan-session-stub'
import { makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe } from '../guard-generator/helpers.js'

const DOC = 'docs/tasks.md'
const CONTENT = ['# Tasks', '', '## Creating tasks', '', '`relkit add <title>` creates a task.'].join('\n')

const repos: string[] = []
let home = ''

beforeEach(() => {
  constructions = 0
  sessionScript = () => {
    throw new Error('no session script installed for this case')
  }
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gg-worker-home-'))
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

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const YAML = 'title: Create a task\nsteps:\n  - run: ["add", "milk"]\n    expect:\n      exit: 0\n    milestone: 1\n'

/** A recording {@link FlowWorkerTask} whose closures answer from a script. */
interface FakeTask {
  task: FlowWorkerTask
  calls: {
    prepare: number
    run: string[]
    submit: { yaml: string; expectedReds: readonly GuardExpectedRed[] }[]
    confirm: { yaml: string; expectedReds: readonly GuardExpectedRed[] }[]
  }
}

function fakeTask(over: Partial<FlowWorkerTask> = {}, flowId = 'create-a-task'): FakeTask {
  const calls: FakeTask['calls'] = { prepare: 0, run: [], submit: [], confirm: [] }
  const stash = new Map<string, string>()
  const task: FlowWorkerTask = {
    workItem: `flow:${flowId}:cli`,
    flowId,
    surface: 'cli',
    epic: false,
    cacheMaterial: {
      flowFingerprint: `fp-${flowId}`,
      sectionKeys: ['docs/tasks.md#tasks/creating-tasks:abc'],
      interfaceFingerprints: ['iface-1'],
      recipeFingerprint: 'recipe-1',
    },
    prepare: async () => {
      calls.prepare++
      return `BRIEFING for ${flowId}`
    },
    runScenario: async (yaml) => {
      calls.run.push(yaml)
      return { content: 'PASS — every step met its expectation (1ms).' }
    },
    submitScenario: async (yaml, expectedReds) => {
      calls.submit.push({ yaml, expectedReds })
      const sha = sha256(yaml)
      stash.set(sha, yaml)
      return { content: `accepted — the engine stashed this exact yaml under sha ${sha}.` }
    },
    hasStash: (sha) => stash.has(sha),
    stashedYaml: (sha) => stash.get(sha),
    confirmCached: async (yaml, expectedReds) => {
      calls.confirm.push({ yaml, expectedReds })
      return true
    },
    ...over,
  }
  return { task, calls }
}

/** Call a session tool the way a driver does. */
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

// ---------------------------------------------------------------------------
// The session def
// ---------------------------------------------------------------------------

describe('flowWorkerSessionDef', () => {
  const def = (surface: 'cli' | 'api' | 'web') =>
    flowWorkerSessionDef({
      task: { ...fakeTask().task, surface },
      judgeWith: () => async () => ({ kind: 'faithful' }),
    })

  it('is the kind, budget and tool surface the plan names', () => {
    const d = def('cli')
    expect(d.kind).toBe(FLOW_WORKER_SESSION_KIND)
    expect(FLOW_WORKER_SESSION_KIND).toBe('guard-generate.flow-worker')
    expect(d.budget).toEqual({ turns: 25, maxResumes: 1, tokenCeiling: 200_000 })
    expect(FLOW_WORKER_BUDGET).toEqual(d.budget)
    // EXACTLY two tools — no filesystem surface: the briefing is the grounding.
    expect(d.tools.map((t) => t.name)).toEqual(['run_scenario', 'submit_scenario'])
  })

  it('refuses an outcome produced before anything was run', () => {
    expect(def('cli').outcomePrecondition?.tool).toBe('run_scenario')
    expect(def('cli').outcomePrecondition?.message).toContain('never ran `run_scenario`')
  })

  it('authors each surface under its own prompt', () => {
    expect(def('cli').systemPrompt).toBe(FLOW_WORKER_CLI_SYSTEM_PROMPT)
    expect(def('api').systemPrompt).toBe(FLOW_WORKER_API_SYSTEM_PROMPT)
    expect(def('web').systemPrompt).toBe(FLOW_WORKER_WEB_SYSTEM_PROMPT)
    expect(new Set([FLOW_WORKER_CLI_SYSTEM_PROMPT, FLOW_WORKER_API_SYSTEM_PROMPT, FLOW_WORKER_WEB_SYSTEM_PROMPT]).size).toBe(3)
    // All three carry the loop's overriding output contract.
    for (const p of [FLOW_WORKER_CLI_SYSTEM_PROMPT, FLOW_WORKER_API_SYSTEM_PROMPT, FLOW_WORKER_WEB_SYSTEM_PROMPT]) {
      expect(p).toContain('YOU ARE THE FLOW WORKER')
      expect(p).toContain('"kind": "settled"')
      expect(p).toContain('"kind": "blocked"')
      expect(p).toContain('"kind": "journey-defect"')
      expect(p).toContain('"kind": "retired"')
      expect(p).toContain('the engine refuses a sha it')
    }
  })

  it('holds the cli and api prompt fingerprints bit-for-bit — the corpus-roll tripwire', () => {
    // These literals are the author-cache keys of every committed cli/api corpus.
    // A prompt edit that moves one re-authors EVERY such flow; fail here first,
    // loudly, so the roll is a decision rather than an accident. The web arm was
    // added with both of these unchanged.
    expect(FLOW_WORKER_CLI_PROMPT_FINGERPRINT).toBe('461564a482560dca')
    expect(FLOW_WORKER_API_PROMPT_FINGERPRINT).toBe('c3f27b81e0bab9b9')
  })

  it('routes both tools to the task’s engine closures', async () => {
    const { task, calls } = fakeTask()
    const d = flowWorkerSessionDef({ task, judgeWith: () => async () => ({ kind: 'faithful' }) })
    const ctx = { workItem: task.workItem, signal: new AbortController().signal, dispatchChild: async () => {
      throw new Error('no child expected')
    } } as unknown as ToolContext

    const ran = await d.tools[0].execute({ yaml: YAML }, ctx)
    expect(ran.content).toContain('PASS')
    expect(calls.run).toEqual([YAML])

    const submitted = await d.tools[1].execute({ yaml: YAML, expectedReds: [] }, ctx)
    expect(submitted.content).toContain('accepted')
    expect(calls.submit).toEqual([{ yaml: YAML, expectedReds: [] }])
  })
})

// ---------------------------------------------------------------------------
// The cache key
// ---------------------------------------------------------------------------

describe('flowWorkerCacheKey', () => {
  const base = fakeTask().task

  it('is the one-shot authorCacheKey recipe with the SESSION prompt fingerprint', () => {
    expect(flowWorkerCacheKey(base)).toBe(
      workerCacheKey(
        FLOW_WORKER_CLI_PROMPT_FINGERPRINT,
        { fingerprint: base.cacheMaterial.flowFingerprint },
        'cli',
        base.cacheMaterial.sectionKeys,
        base.cacheMaterial.interfaceFingerprints,
        base.cacheMaterial.recipeFingerprint,
      ),
    )
    expect(flowWorkerPromptFingerprint('cli')).toBe(FLOW_WORKER_CLI_PROMPT_FINGERPRINT)
    expect(flowWorkerPromptFingerprint('api')).toBe(FLOW_WORKER_API_PROMPT_FINGERPRINT)
    expect(FLOW_WORKER_CLI_PROMPT_FINGERPRINT).not.toBe(FLOW_WORKER_API_PROMPT_FINGERPRINT)
  })

  it('moves with every behavior-affecting input and with nothing else', () => {
    const key = flowWorkerCacheKey(base)
    const move = (over: Partial<FlowWorkerTask['cacheMaterial']>, surface: 'cli' | 'api' = 'cli') =>
      flowWorkerCacheKey({ ...base, surface, cacheMaterial: { ...base.cacheMaterial, ...over } })

    expect(move({ flowFingerprint: 'other' })).not.toBe(key)
    expect(move({ sectionKeys: ['other'] })).not.toBe(key)
    expect(move({ interfaceFingerprints: ['other'] })).not.toBe(key)
    expect(move({ recipeFingerprint: 'other' })).not.toBe(key)
    expect(move({}, 'api')).not.toBe(key)
    // The flow ID and work item are bookkeeping, not key material.
    expect(flowWorkerCacheKey({ ...base, flowId: 'renamed', workItem: 'flow:renamed:cli' })).toBe(key)
  })

  it('is insensitive to the ORDER of the two sorted lists', () => {
    const two = {
      ...base,
      cacheMaterial: { ...base.cacheMaterial, sectionKeys: ['a', 'b'], interfaceFingerprints: ['x', 'y'] },
    }
    const flipped = {
      ...base,
      cacheMaterial: { ...base.cacheMaterial, sectionKeys: ['b', 'a'], interfaceFingerprints: ['y', 'x'] },
    }
    expect(flowWorkerCacheKey(two)).toBe(flowWorkerCacheKey(flipped))
  })
})

describe('cacheableWorkerOutcome', () => {
  it('stores ONLY settled — a block is a per-run world claim, like a retirement or a journey defect', () => {
    expect(cacheableWorkerOutcome({ kind: 'settled', scenarioYamlSha: 'a', expectedReds: [] })).toBe(true)
    // The documenso 13-worker incident (2026-08-24): cached "database
    // unreachable" blocks replayed on every retry with no re-verification
    // path, permanently skipping flows whose world was healthy again.
    expect(cacheableWorkerOutcome({ kind: 'blocked', perMilestone: [{ order: 1, capability: 'stripe' }] })).toBe(false)
    expect(cacheableWorkerOutcome({ kind: 'retired', attempts: 1, lastEvidence: 'e' })).toBe(false)
    expect(cacheableWorkerOutcome({ kind: 'journey-defect', report: { interfaceId: 'i', detail: 'd' } })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The pool: cache hits, the confirmation re-run, waves, rejects
// ---------------------------------------------------------------------------

const workerSeam = (r: string) => createGuardGenerateSessionSeams({ repoRoot: r }).flowWorkerSession

/** Script a driver that submits `YAML` and settles on the accepted sha. */
const settleScript: StubScript = async (call) => {
  await callTool(call, 'run_scenario', { yaml: YAML })
  const accepted = await callTool(call, 'submit_scenario', { yaml: YAML, expectedReds: [] })
  const sha = /under sha ([0-9a-f]{64})/.exec(accepted.content)![1]
  return outcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [] })
}

describe('the flow-worker pool’s cache', () => {
  it('a cached settled entry is CONFIRMED once and then serves the task — no session', async () => {
    const r = docRepo()
    const { task, calls } = fakeTask()
    await setCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task), {
      outcome: { kind: 'settled', scenarioYamlSha: sha256(YAML), expectedReds: [] },
      scenarioYaml: YAML,
    })

    const { byTask, summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ ran: 0, fromCache: 1, failed: 0 })
    expect(byTask.get(task.workItem)).toEqual({
      kind: 'outcome',
      outcome: { kind: 'settled', scenarioYamlSha: sha256(YAML), expectedReds: [] },
      fromCache: true,
    })
    // The confirmation re-run happened exactly once, on the cached yaml.
    expect(calls.confirm).toEqual([{ yaml: YAML, expectedReds: [] }])
    // No session, so no briefing was ever prepared and no driver built.
    expect(calls.prepare).toBe(0)
    expect(constructions).toBe(0)
  })

  it('a cached settled entry whose confirmation FAILS is a miss — the session runs and overwrites it', async () => {
    const r = docRepo()
    const { task, calls } = fakeTask({ confirmCached: async () => false })
    const stale = { outcome: { kind: 'settled' as const, scenarioYamlSha: sha256('stale'), expectedReds: [] }, scenarioYaml: 'stale' }
    await setCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task), stale)
    sessionScript = settleScript

    const { summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ ran: 1, fromCache: 0, failed: 0 })
    expect(constructions).toBe(1)
    expect(calls.prepare).toBe(1)
    // The stale entry was replaced by the fresh one.
    const entry = await getCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task))
    expect(entry).toEqual({
      outcome: { kind: 'settled', scenarioYamlSha: sha256(YAML), expectedReds: [] },
      scenarioYaml: YAML,
    })
  })

  it('a legacy cached BLOCKED entry is a MISS — the session re-attempts the flow (the P1017 replay incident)', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    // Incident-verbatim entry shape (documenso 13-worker run 1): an
    // infra-class block cached by the pre-fix engine. It parses, but a block
    // has no re-verification path (unlike settled's confirmCached), so it
    // must never serve as a hit.
    const blocked = {
      outcome: {
        kind: 'blocked' as const,
        perMilestone: [
          { order: 1, capability: 'working guard seed/database connection (guard-seed failed with Prisma P1017)' },
        ],
      },
    }
    await setCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task), blocked)
    sessionScript = settleScript

    const { byTask, summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ ran: 1, fromCache: 0 })
    const res = byTask.get(task.workItem)
    expect(res).toMatchObject({ kind: 'outcome' })
    if (res?.kind === 'outcome') expect(res.outcome.kind).toBe('settled')
    // The fresh settled outcome overwrote the stale blocked entry.
    const entry = (await getCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task))) as {
      outcome: { kind: string }
    }
    expect(entry.outcome.kind).toBe('settled')
  })

  it('a fresh BLOCKED outcome folds but is never written to the cache', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    sessionScript = async (call) => {
      await callTool(call, 'run_scenario', { yaml: YAML })
      return outcome({ kind: 'blocked', perMilestone: [{ order: 1, capability: 'stripe sandbox account' }] })
    }

    const { byTask, summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })
    expect(summary).toMatchObject({ ran: 1, failed: 0 })
    expect(byTask.get(task.workItem)).toMatchObject({ kind: 'outcome' })
    expect(await getCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task))).toBeNull()
  })

  it('a TAINTED task skips the cache read entirely — the entry still holds the rejected scenario', async () => {
    const r = docRepo()
    const { task, calls } = fakeTask({ taint: { title: 'prior', mismatch: 'asserted nothing' } })
    await setCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task), {
      outcome: { kind: 'settled', scenarioYamlSha: sha256(YAML), expectedReds: [] },
      scenarioYaml: YAML,
    })
    sessionScript = settleScript

    const { summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ ran: 1, fromCache: 0 })
    expect(calls.confirm).toEqual([])
    expect(constructions).toBe(1)
  })

  it('a fresh settled outcome caches the STASHED yaml, keyed by the worker key', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    sessionScript = settleScript

    await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(await getCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task))).toEqual({
      outcome: { kind: 'settled', scenarioYamlSha: sha256(YAML), expectedReds: [] },
      scenarioYaml: YAML,
    })
    // The cache lives under the KEPT one-shot name.
    expect(FLOW_WORKER_CACHE_NAME).toBe('guard/generate')
    expect(fs.existsSync(path.join(r, '.truecourse', '.cache', 'guard', 'generate'))).toBe(true)
  })

  it('a settled outcome naming a sha the engine never accepted becomes MALFORMED and is not cached', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    sessionScript = async (call) => {
      await callTool(call, 'run_scenario', { yaml: YAML })
      return outcome({ kind: 'settled', scenarioYamlSha: 'f'.repeat(64), expectedReds: [] })
    }

    const { byTask, summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ ran: 1, failed: 1, allTransport: false })
    const result = byTask.get(task.workItem)!
    expect(result.kind).toBe('failed')
    if (result.kind !== 'failed') return
    expect(result.reason).toContain('sha the engine never accepted')
    expect(await getCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task))).toBeNull()
  })

  it('an UNREVIEWED green (no stashed yaml) folds but is never cached', async () => {
    const r = docRepo()
    // `stashedYaml` withholds the yaml for a green accepted with its review
    // unavailable — core must then write NO entry.
    const { task } = fakeTask({ stashedYaml: () => undefined, hasStash: () => true })
    sessionScript = settleScript

    const { byTask, summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ ran: 1, failed: 0 })
    expect(byTask.get(task.workItem)).toMatchObject({ kind: 'outcome' })
    expect(await getCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task))).toBeNull()
  })

  it('a retirement is never cached — the ledger, not the cache, is its record', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    sessionScript = async (call) => {
      await callTool(call, 'run_scenario', { yaml: YAML })
      return outcome({ kind: 'retired', attempts: 2, lastEvidence: 'no faithful scenario' })
    }

    const { summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })
    expect(summary).toMatchObject({ ran: 1, failed: 0 })
    expect(await getCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task))).toBeNull()
  })

  it('a FAILED session is never cached and reports its reason', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    sessionScript = () => ({
      kind: 'failure',
      failure: { kind: 'transport', detail: 'gone', class: 'provider', retryability: 'none' },
    })

    const { byTask, summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })
    expect(summary).toMatchObject({ ran: 1, failed: 1, allTransport: true })
    expect(byTask.get(task.workItem)).toMatchObject({ kind: 'failed' })
    expect(await getCacheEntry(r, FLOW_WORKER_CACHE_NAME, flowWorkerCacheKey(task))).toBeNull()
  })
})

describe('the flow-worker pool’s waves and progress', () => {
  it('runs every non-epic task before any epic one, and ticks per settled task', async () => {
    const r = docRepo()
    const order: string[] = []
    const member = fakeTask({}, 'member')
    const epic = fakeTask({ epic: true, workItem: 'flow:epic:cli', flowId: 'epic' }, 'epic')
    sessionScript = async (call) => {
      order.push(call.briefing)
      await callTool(call, 'run_scenario', { yaml: YAML })
      const accepted = await callTool(call, 'submit_scenario', { yaml: YAML, expectedReds: [] })
      const sha = /under sha ([0-9a-f]{64})/.exec(accepted.content)![1]
      return outcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [] })
    }
    const ticks: { done: number; total: number; kind?: string }[] = []

    const { summary } = await workerSeam(r)({
      tasks: [member.task],
      epicTasks: [epic.task],
      docs: docsOf(r),
      onTask: (done, total, kind) => ticks.push({ done, total, ...(kind ? { kind } : {}) }),
    })

    expect(order).toEqual(['BRIEFING for member', 'BRIEFING for epic'])
    expect(summary.ran).toBe(2)
    expect(ticks).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2, kind: 'settled' },
      { done: 2, total: 2, kind: 'settled' },
    ])
    // The epic's briefing is prepared only after the first wave folded.
    expect(epic.calls.prepare).toBe(1)
  })

  it('an unconstructible driver fails every miss transport-class instead of throwing', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    const seams = createGuardGenerateSessionSeams({
      repoRoot: r,
      driver: async () => {
        throw new Error('TRUECOURSE_API_KEY is not set')
      },
    })

    const { byTask, summary } = await seams.flowWorkerSession({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ ran: 1, failed: 1, allTransport: true })
    expect(summary.firstError).toContain('TRUECOURSE_API_KEY is not set')
    expect(byTask.get(task.workItem)).toMatchObject({ kind: 'failed' })
  })

  it('the outcome precondition refuses a worker that never ran anything, exactly once', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    const briefings: string[] = []
    sessionScript = async (call) => {
      briefings.push(call.briefing)
      // The FIRST run produces an outcome without ever running anything; the
      // shell's refusal re-opens the session with its message as the briefing.
      if (!call.briefing.includes('never ran')) {
        return outcome({ kind: 'retired', attempts: 0, lastEvidence: 'gave up immediately' })
      }
      await callTool(call, 'run_scenario', { yaml: YAML })
      return outcome({ kind: 'retired', attempts: 1, lastEvidence: 'ran, then gave up' })
    }

    const { byTask, summary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ ran: 1, failed: 0 })
    expect(byTask.get(task.workItem)).toEqual({
      kind: 'outcome',
      outcome: { kind: 'retired', attempts: 1, lastEvidence: 'ran, then gave up' },
    })
    // Run 1 was the briefing; run 2 opened with the precondition's message.
    expect(briefings[0]).toBe('BRIEFING for create-a-task')
    expect(briefings[1]).toContain('never ran `run_scenario`')
  })

  it('an injected driver runs the session and opens NO sessions-store run record', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    const { driver } = stubDriver(settleScript)
    const { persistence, events } = memoryPersistence()
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, driver: async () => ({ driver, persistence }) })

    const { summary } = await seams.flowWorkerSession({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ ran: 1, failed: 0 })
    expect([...events.values()].flat().some((e) => e.type === 'session-start')).toBe(true)
    expect(constructions).toBe(0)
    expect(seams.runId()).toBeUndefined()
    expect(fs.existsSync(path.join(r, '.truecourse', 'sessions'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Step 18 — the fidelity child
// ---------------------------------------------------------------------------

const FIDELITY_INPUT: WorkerFidelityInput = {
  flowFingerprint: 'flow-fp',
  sectionKeys: ['b', 'a'],
  scenarioBehavior: JSON.stringify({ title: 't', steps: [] }),
  briefing: 'CLAIMS…\n\nCONFIRMATION CAPTURE (the engine ran this scenario in a fresh sandbox just now):\nPASS',
}

function toolCtx(dispatchChild: ToolContext['dispatchChild']): ToolContext {
  return { workItem: 'flow:x:cli', signal: new AbortController().signal, dispatchChild }
}

const emptyTally = () => ({ ran: 0, failed: 0, allTransport: true, spent: { turns: 0, tokens: 0, costUsd: 0 } })

const childOutcome = (value: unknown): SessionOutcome<never> =>
  ({
    status: 'completed',
    output: value,
    pendingQuestions: [],
    spent: { turns: 2, tokens: 500, costUsd: 0.01 },
  }) as unknown as SessionOutcome<never>

describe('fidelitySessionCacheKey', () => {
  it('is insensitive to sectionKeys order and moves with the scenario behavior', () => {
    const key = fidelitySessionCacheKey(FIDELITY_INPUT)
    expect(fidelitySessionCacheKey({ ...FIDELITY_INPUT, sectionKeys: ['a', 'b'] })).toBe(key)
    expect(fidelitySessionCacheKey({ ...FIDELITY_INPUT, scenarioBehavior: 'other' })).not.toBe(key)
    expect(fidelitySessionCacheKey({ ...FIDELITY_INPUT, flowFingerprint: 'other' })).not.toBe(key)
    expect(fidelitySessionCacheKey({ ...FIDELITY_INPUT, sectionKeys: ['a'] })).not.toBe(key)
  })
})

describe('fidelitySessionDef', () => {
  it('is one read tool, the child budget, and the kept kind', () => {
    const r = docRepo()
    const def = fidelitySessionDef(buildGuardDocUniverse(docsOf(r)))
    expect(def.kind).toBe(FIDELITY_SESSION_KIND)
    expect(FIDELITY_SESSION_KIND).toBe('guard-generate.fidelity')
    expect(def.tools.map((t) => t.name)).toEqual(['read_claim_section'])
    expect(def.budget).toEqual({ turns: 5, maxResumes: 0, tokenCeiling: 60_000 })
    expect(FIDELITY_SESSION_BUDGET).toEqual(def.budget)
    // No resume grant, so a failed child is a failed child (`unavailable`).
    expect(def.budget.maxResumes).toBe(0)
  })

  it('read_claim_section returns the briefed section and errors on a bogus doc', async () => {
    const r = docRepo()
    const def = fidelitySessionDef(buildGuardDocUniverse(docsOf(r)))
    const ctx = toolCtx(async () => {
      throw new Error('no child')
    })

    const ok = await def.tools[0].execute({ doc: DOC, heading: 'tasks/creating-tasks' }, ctx)
    expect(ok.isError).toBeUndefined()
    expect(ok.content).toContain('`relkit add <title>` creates a task.')

    const noDoc = await def.tools[0].execute({ doc: 'docs/nope.md', heading: 'x' }, ctx)
    expect(noDoc.isError).toBe(true)
    expect(noDoc.content).toContain('No doc')

    const noSection = await def.tools[0].execute({ doc: DOC, heading: 'nope' }, ctx)
    expect(noSection.isError).toBe(true)
    expect(noSection.content).toContain('has no section')
  })
})

describe('judgeWorkerFidelity', () => {
  it('a CACHED verdict short-circuits the dispatch entirely', async () => {
    const r = docRepo()
    await setCacheEntry(r, FIDELITY_SESSION_CACHE_NAME, fidelitySessionCacheKey(FIDELITY_INPUT), { verdict: 'faithful' })
    const tally = emptyTally()

    const verdict = await judgeWorkerFidelity({
      repoRoot: r,
      universe: buildGuardDocUniverse(docsOf(r)),
      ctx: toolCtx(async () => {
        throw new Error('dispatchChild must not be called on a cache hit')
      }),
      input: FIDELITY_INPUT,
      tally,
    })

    expect(verdict).toEqual({ kind: 'faithful' })
    expect(tally).toEqual(emptyTally())
  })

  it('a MISS dispatches one depth-1 child, caches its verdict, and tallies the spend', async () => {
    const r = docRepo()
    const dispatched: { kind: string; briefing: string }[] = []
    const tally = emptyTally()

    const verdict = await judgeWorkerFidelity({
      repoRoot: r,
      universe: buildGuardDocUniverse(docsOf(r)),
      ctx: toolCtx(async (def, messages) => {
        dispatched.push({ kind: def.kind, briefing: messages[0] })
        return childOutcome({ verdict: 'flagged', mismatch: 'asserts nothing', confidence: 'high' })
      }),
      input: FIDELITY_INPUT,
      tally,
    })

    expect(verdict).toEqual({ kind: 'flagged', mismatch: 'asserts nothing', confidence: 'high' })
    expect(dispatched).toEqual([{ kind: FIDELITY_SESSION_KIND, briefing: FIDELITY_INPUT.briefing }])
    expect(tally).toMatchObject({ ran: 1, failed: 0, spent: { turns: 2, tokens: 500 } })
    expect(await getCacheEntry(r, FIDELITY_SESSION_CACHE_NAME, fidelitySessionCacheKey(FIDELITY_INPUT))).toEqual({
      verdict: 'flagged',
      mismatch: 'asserts nothing',
      confidence: 'high',
    })
  })

  it('a FAILED child is `unavailable`, caches nothing, and the next call re-tries', async () => {
    const r = docRepo()
    const tally = emptyTally()
    let dispatches = 0
    const ctx = toolCtx(async () => {
      dispatches++
      return {
        status: 'failed',
        failure: { kind: 'budget-exhausted', notReached: 'a verdict', retryability: 'none' },
        resumable: false,
        spent: { turns: 5, tokens: 100, costUsd: 0.002 },
      } as unknown as SessionOutcome<never>
    })

    const first = await judgeWorkerFidelity({
      repoRoot: r,
      universe: buildGuardDocUniverse(docsOf(r)),
      ctx,
      input: FIDELITY_INPUT,
      tally,
    })

    expect(first.kind).toBe('unavailable')
    expect(tally).toMatchObject({ ran: 1, failed: 1, allTransport: false })
    expect(tally.firstError).toBeTruthy()
    expect(await getCacheEntry(r, FIDELITY_SESSION_CACHE_NAME, fidelitySessionCacheKey(FIDELITY_INPUT))).toBeNull()

    await judgeWorkerFidelity({
      repoRoot: r,
      universe: buildGuardDocUniverse(docsOf(r)),
      ctx,
      input: FIDELITY_INPUT,
      tally,
    })
    expect(dispatches).toBe(2)
  })

  it('the seam reports the children under their own kind, beside the worker summary', async () => {
    const r = docRepo()
    const { task } = fakeTask({
      submitScenario: async (yaml, _reds, judge) => {
        const verdict = await judge({ ...FIDELITY_INPUT, scenarioBehavior: yaml })
        if (verdict.kind !== 'faithful') return { content: `not accepted: ${verdict.kind}`, isError: true }
        return { content: `accepted — the engine stashed this exact yaml under sha ${sha256(yaml)}.` }
      },
      hasStash: () => true,
      stashedYaml: (sha) => (sha === sha256(YAML) ? YAML : undefined),
    })
    sessionScript = async (call) => {
      if (call.kind === FIDELITY_SESSION_KIND) return outcome({ verdict: 'faithful' })
      await callTool(call, 'run_scenario', { yaml: YAML })
      const accepted = await callTool(call, 'submit_scenario', { yaml: YAML, expectedReds: [] })
      const sha = /under sha ([0-9a-f]{64})/.exec(accepted.content)![1]
      return outcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [] })
    }

    const { summary, fidelitySummary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })

    expect(summary).toMatchObject({ kind: FLOW_WORKER_SESSION_KIND, ran: 1, failed: 0 })
    expect(fidelitySummary).toMatchObject({ kind: FIDELITY_SESSION_KIND, ran: 1, failed: 0 })
  })

  it('no fidelity summary at all when no child was dispatched', async () => {
    const r = docRepo()
    const { task } = fakeTask()
    sessionScript = settleScript
    const { fidelitySummary } = await workerSeam(r)({ tasks: [task], epicTasks: [], docs: docsOf(r) })
    expect(fidelitySummary).toBeUndefined()
  })
})
