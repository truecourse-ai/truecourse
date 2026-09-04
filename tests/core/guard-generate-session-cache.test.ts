/**
 * THE GUARD-GENERATE SESSION SEAMS' CACHE + LAZY DRIVER (plan 04 steps 15–16),
 * driven against a SCRIPTED session driver.
 *
 * `createGuardGenerateSessionSeams` takes an optional `driver` seam, but the
 * PRODUCTION path is the internal `createConfiguredSessionDriver` one — and it
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
  SESSION_MODEL_CLAUDE_CODE: 'opus',
  assertSessionBackendReady: async () => {},
  createConfiguredSessionDriver: () => {
    constructions++
    const { driver } = stubDriver((call) => sessionScript(call))
    return { driver, mode: 'claude-code', attribution: driver.attribution }
  },
}))

import { getCacheEntry } from '@truecourse/llm'
import {
  collectWorkDocs,
  planGuardWork,
  type FlowSynthesisArea,
  type GuardDoc,
} from '@truecourse/guard-generator'
import {
  EXTRACT_SESSION_CACHE_NAME,
  FLOWS_SESSION_CACHE_NAME,
  createGuardGenerateSessionSeams,
  extractSessionCacheKey,
  flowsSessionCacheKey,
} from '../../packages/core/src/services/guard-generate/index'
import { memoryPersistence, outcome, stubDriver, type StubCall, type StubScript } from './spec-scan-session-stub'
import { makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe } from '../guard-generator/helpers.js'

const DOC = 'docs/tasks.md'
const CONTENT = ['# Tasks', '', '## Creating tasks', '', '`relkit add <title>` creates a task.'].join('\n')
const ANCHOR = 'tasks/creating-tasks'
const CLAIM = '`relkit add <title>` creates a task'

const repos: string[] = []
let home = ''

beforeEach(() => {
  constructions = 0
  sessionScript = () => {
    throw new Error('no session script installed for this case')
  }
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gg-cache-home-'))
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

const EXTRACT_DRAFT = {
  claims: [{ claim: CLAIM, driver: 'cli' as const, sectionAnchor: ANCHOR, reason: 'stdout carries the new id', needs: [] }],
  untestable: [],
}

const transportFailure = { kind: 'failure' as const, failure: { kind: 'transport' as const, detail: 'gone', class: 'provider' as const, retryability: 'none' as const } }

describe('the extract seam’s cache', () => {
  it('runs a session on a miss, writes the entry, and serves the next run from it', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    let ran = 0
    sessionScript = async (call) => {
      ran++
      await callTool(call, 'check_claims', EXTRACT_DRAFT)
      return outcome(EXTRACT_DRAFT)
    }

    const first = await createGuardGenerateSessionSeams({ repoRoot: r }).extractSession({ docs: [doc] })
    expect(first.summary).toMatchObject({ ran: 1, fromCache: 0, failed: 0 })
    expect(ran).toBe(1)
    expect(constructions).toBe(1)
    // Only the OUTPUT is stored, never the envelope.
    expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(doc))).toEqual(EXTRACT_DRAFT)

    const seams = createGuardGenerateSessionSeams({ repoRoot: r })
    const second = await seams.extractSession({ docs: [doc] })
    expect(second.summary).toMatchObject({ ran: 0, fromCache: 1, failed: 0 })
    expect(ran).toBe(1)
    // A fully-cached run builds NO driver and opens NO sessions-store run.
    expect(constructions).toBe(1)
    expect(seams.runId()).toBeUndefined()
  })

  it('opens exactly one sessions-store run for the whole invocation', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    sessionScript = async (call) => {
      await callTool(call, 'check_claims', EXTRACT_DRAFT)
      return outcome(EXTRACT_DRAFT)
    }
    const seams = createGuardGenerateSessionSeams({ repoRoot: r })
    await seams.extractSession({ docs: [doc] })
    const runId = seams.runId()
    expect(runId).toBeTruthy()
    expect(fs.existsSync(path.join(r, '.truecourse', 'sessions', 'guard-generate', runId!, 'run.json'))).toBe(true)
    seams.finish(false)
  })

  // The INJECTED driver seam (`opts.driver`) and its documented convention:
  // whoever owns the driver owns the run record, so an injected one creates
  // none at all — `runId()` stays undefined, `finish()` no-ops, and nothing is
  // written under `sessions/`. The internal `createConfiguredSessionDriver`
  // path is never reached (the mock's counter proves it).
  it('an injected driver runs the sessions and opens NO run record', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    const { driver } = stubDriver(async (call) => {
      await callTool(call, 'check_claims', EXTRACT_DRAFT)
      return outcome(EXTRACT_DRAFT)
    })
    const { persistence, events } = memoryPersistence()

    const seams = createGuardGenerateSessionSeams({
      repoRoot: r,
      driver: async () => ({ driver, persistence }),
    })
    const { byDoc, summary } = await seams.extractSession({ docs: [doc] })

    expect(summary).toMatchObject({ ran: 1, fromCache: 0, failed: 0 })
    expect(byDoc.get(doc.doc)?.ok).toBe(true)
    // The transcript went to the INJECTED persistence, not a store run.
    expect([...events.values()].flat().some((e) => e.type === 'session-start')).toBe(true)
    expect(constructions).toBe(0)
    expect(seams.runId()).toBeUndefined()
    expect(() => seams.finish(false)).not.toThrow()
    expect(fs.existsSync(path.join(r, '.truecourse', 'sessions'))).toBe(false)
  })

  it('never caches a FAILED session — the next run re-attempts it', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    let ran = 0
    sessionScript = () => {
      ran++
      return transportFailure
    }

    const first = await createGuardGenerateSessionSeams({ repoRoot: r }).extractSession({ docs: [doc] })
    expect(first.summary).toMatchObject({ ran: 1, failed: 1, allTransport: true })
    expect(first.byDoc.get(doc.doc)).toEqual({
      ok: false,
      reason: 'extraction session failed: the provider failed (provider): gone',
    })
    expect(await getCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(doc))).toBeNull()

    await createGuardGenerateSessionSeams({ repoRoot: r }).extractSession({ docs: [doc] })
    expect(ran).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// The flows seam: the engine's refusal converts a COMPLETED outcome into a
// malformed failure BEFORE the cache write (plan 04 step 16).
// ---------------------------------------------------------------------------

const AREA = (r: string): FlowSynthesisArea => ({
  areaId: 'tasks',
  claims: [{ doc: DOC, anchor: ANCHOR, title: CLAIM, driver: 'cli' }],
  docs: [
    {
      doc: DOC,
      outline: docsOf(r)[0].sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
    },
  ],
})

const CLEAN_FLOWS = {
  flows: [{ title: 'Create a task', goal: 'a user adds a task', milestones: [{ order: 1, doc: DOC, anchor: ANCHOR, claimTitle: CLAIM }] }],
  noFlowClaims: [],
}
const DIRTY_FLOWS = {
  flows: [{ title: 'Invented', goal: 'g', milestones: [{ order: 1, doc: DOC, anchor: ANCHOR, claimTitle: 'nothing like a claim' }] }],
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

    const second = await createGuardGenerateSessionSeams({ repoRoot: r }).flowsAreaSession({ areas: [area], docs })
    expect(second.summary).toMatchObject({ ran: 0, fromCache: 1 })
    const hit = second.byArea.get('tasks')!
    expect(hit.ok && hit.fromCache).toBe(true)
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
