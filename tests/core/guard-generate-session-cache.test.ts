/**
 * THE GUARD-GENERATE SESSION SEAMS' CACHE + LAZY DRIVER,
 * driven against a SCRIPTED session driver.
 *
 * `createGuardGenerateSessionSeams` takes an optional `driver` seam, but the
 * PRODUCTION path is the internal `createClaudeCodeSessionDriver` one — and it
 * is the lazy path a cache test has to prove (a fully-cached run must build no
 * driver and open no run record). So that module is mocked with a COUNTER and
 * each case scripts it; the injected seam gets one case of its own, for the
 * convention it carries (an injected driver owns its own run record, so the
 * seams create none).
 *
 * The rules under test are the ones the cache module states: only COMPLETED
 * outcomes are written; a failure is never cached; and a completed outcome the
 * ENGINE refuses (`rejectOutput`) becomes a malformed failure BEFORE the write,
 * so a refusal costs a re-run next time instead of poisoning the entry.
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

import { getCacheEntry } from '@truecourse/llm'
import { parseDocTree, sentenceKey } from '@truecourse/shared'
import {
  planGuardWork,
  type FlowSynthesisArea,
  type GuardDoc,
} from '@truecourse/guard-generator'
import {
  FLOWS_SESSION_CACHE_NAME,
  createGuardGenerateSessionSeams,
  flowsSessionCacheKey,
} from '../../packages/core/src/services/guard-generate/index'
import { listStoredSessionRuns } from '../../packages/core/src/lib/sessions-store.js'
import { memoryPersistence, outcome, stubDriver, type StubCall, type StubScript } from './spec-scan-session-stub'
import { makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe } from '../guard-generator/helpers.js'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache'
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs'

const DOC = 'docs/tasks.md'
const CONTENT = ['# Tasks', '', '## Creating tasks', '', '`relkit add <title>` creates a task.'].join('\n')
const CLAIM = '`relkit add <title>` creates a task'
const CLAIM_ID = 'claim::tasks::create'

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

const docsOf = (r: string): GuardDoc[] => planGuardWork(r).docs

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

const transportFailure = { kind: 'failure' as const, failure: { kind: 'transport' as const, detail: 'gone', class: 'provider' as const, retryability: 'none' as const } }

// ---------------------------------------------------------------------------
// The flows seam: the engine's refusal converts a COMPLETED outcome into a
// malformed failure BEFORE the cache write.
// ---------------------------------------------------------------------------

const AREA = (r: string): FlowSynthesisArea => ({
  areaId: 'tasks',
  claims: [{ id: CLAIM_ID, doc: DOC, title: CLAIM, sentences: [sentenceKey(parseDocTree(DOC, CONTENT).sentences.find((s) => s.text.includes(CLAIM))!.text)] }],
  docs: [
    {
      doc: DOC,
      outline: docsOf(r)[0].sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
    },
  ],
})

const CLEAN_FLOWS = {
  flows: [{ title: 'Create a task', goal: 'a user adds a task', milestones: [{ order: 1, claimId: CLAIM_ID }] }],
  noFlowClaims: [],
}
const DIRTY_FLOWS = {
  flows: [{ title: 'Invented', goal: 'g', milestones: [{ order: 1, claimId: 'claim::tasks::invented' }] }],
  noFlowClaims: [],
}

describe('the flows seam’s cache', () => {
  it('caches a clean outcome and stamps its key as the inputsKey', async () => {
    const r = docRepo()
    const area = AREA(r)
    const docs = docsOf(r)
    sessionScript = async (call) => {
      await callTool(call, 'check_flows', CLEAN_FLOWS)
      return outcome(CLEAN_FLOWS)
    }

    const first = await createGuardGenerateSessionSeams({ repoRoot: r }).flowsAreaSession({ areas: [area], docs })
    expect(first.summary).toMatchObject({ ran: 1, fromCache: 0, failed: 0 })
    const result = first.byArea.get('tasks')!
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inputsKey).toBe(flowsSessionCacheKey(area))
    expect(await getCacheEntry(r, FLOWS_SESSION_CACHE_NAME, flowsSessionCacheKey(area))).toEqual(CLEAN_FLOWS)

    const resumed = createGuardGenerateSessionSeams({ repoRoot: r, replaySteps: ['extract', 'flows'] })
    const second = await resumed.flowsAreaSession({ areas: [area], docs })
    expect(second.summary).toMatchObject({ ran: 0, fromCache: 1 })
    const hit = second.byArea.get('tasks')!
    expect(hit.ok && hit.fromCache).toBe(true)
    const before = constructions
    await expect(resumed.flowsAreaSession({ areas: [{ ...area, areaId: 'uncached-area' }], docs }))
      .rejects.toMatchObject({ name: 'GenerateStepNotReadyError', step: 'flows' })
    expect(constructions).toBe(before)
  })

  // The session had its chance in-session: `check_flows` told it. An outcome the
  // fold's re-run still refuses is a FAILED item, one re-run away — never a
  // cache entry that would refuse forever.
  it('converts a refused outcome to a failure, caches nothing, and re-runs next time', async () => {
    const r = docRepo()
    const area = AREA(r)
    const docs = docsOf(r)
    let ran = 0
    const errors: boolean[] = []
    sessionScript = async (call) => {
      ran++
      // The session sees the defect in-session…
      const tool = call.def.tools.find((t) => t.name === 'check_flows')!
      const checked = await tool.execute(DIRTY_FLOWS, {
        workItem: call.input.workItem,
        signal: call.input.signal,
        dispatchChild: call.input.dispatchChild,
      })
      errors.push(checked.isError === true)
      await call.emit({ type: 'tool-result', toolName: 'check_flows', content: checked.content, isError: checked.isError })
      // …and produces it anyway.
      return outcome(DIRTY_FLOWS)
    }

    const first = await createGuardGenerateSessionSeams({ repoRoot: r }).flowsAreaSession({ areas: [area], docs })
    expect(errors).toEqual([true])
    expect(first.summary).toMatchObject({ ran: 1, failed: 1 })
    // A refusal is NOT transport-class, so it never reads as a provider outage.
    expect(first.summary.allTransport).toBe(false)
    const result = first.byArea.get('tasks')!
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('malformed')
    expect(result.reason).toContain('flow synthesis refused')
    expect(await getCacheEntry(r, FLOWS_SESSION_CACHE_NAME, flowsSessionCacheKey(area))).toBeNull()

    await createGuardGenerateSessionSeams({ repoRoot: r }).flowsAreaSession({ areas: [area], docs })
    expect(ran).toBe(2)
  })
})
