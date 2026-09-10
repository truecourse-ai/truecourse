/**
 * THE CLAIM-EXTRACTION SESSION — `guard-generate.extract` (plan 04 step 15).
 *
 * Three layers, deliberately separated:
 *  - the SESSION DEF through the real `runAgentLoop` with a scripted driver
 *    (the `check_claims` snap-refusal loop, the outcome precondition);
 *  - the SEAM (`createGuardGenerateSessionSeams().extractSession`) over a real
 *    on-disk cache — which is where the fold's re-snap and the lazy driver live;
 *  - the ENGINE (`generateGuards`) with a stubbed seam, for the fail-open and
 *    systemic-abort routing extraction feeds.
 *
 * The seam builds its driver through `createConfiguredSessionDriver`, which has
 * no injection point, so "no driver was constructed" is proved the only way the
 * product allows: `transport: 'api'` under an EMPTY `TRUECOURSE_HOME` makes
 * construction throw, so a run that survives is a run that never built one.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { setCacheEntry } from '@truecourse/llm'
import {
  collectWorkDocs,
  generateGuards,
  planGuardWork,
  type ExtractResult,
  type ExtractSessionSeam,
  type FlowClaimInput,
  type GuardDoc,
  type GuardSessionSummary,
} from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import type { ExtractOutcome } from '@truecourse/shared'
import { runAgentLoop, type SessionRunInput } from '../../packages/agent-loop/src/index'
import {
  EXTRACT_SESSION_BUDGET,
  EXTRACT_SESSION_CACHE_NAME,
  EXTRACT_SESSION_KIND,
  EXTRACT_SESSION_SYSTEM_PROMPT,
  createGuardGenerateSessionSeams,
  docChunkCount,
  extractSessionBriefing,
  extractSessionCacheKey,
  extractSessionDef,
  renderDocChunk,
  validateExtractDraft,
  buildGuardDocUniverse,
} from '../../packages/core/src/services/guard-generate/index'
import { memoryPersistence, stubDriver, outcome } from './spec-scan-session-stub'
import {
  DEFAULT_INTERFACES,
  flowPerClaimSession,
  flowsAreaSessionOf,
  makeTempRepo,
  noEpicSessions,
  noWorkerSessions,
  rmrf,
  sessionSummary,
  writeCorpus,
  writeDoc,
  writeRecipe,
} from '../guard-generator/helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

// ---------------------------------------------------------------------------
// Fixtures — real docs through the real planner, so anchors/fingerprints are
// the ones a run binds against.
// ---------------------------------------------------------------------------

const DOC = 'docs/tasks.md'
const CONTENT = [
  '# Tasks',
  '',
  '## Creating tasks',
  '',
  '`relkit add <title>` creates a task and prints its id as `t<N>`.',
  '',
  '## Listing tasks',
  '',
  '`relkit list` prints one line per open task, newest first.',
].join('\n')

/** A repo with one doc, its corpus row and a recipe — the extraction universe. */
function docRepo(content = CONTENT, docPath = DOC): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: docPath }])
  writeDoc(r, docPath, content)
  return r
}

function docsOf(r: string): GuardDoc[] {
  return collectWorkDocs(r, planGuardWork(r))
}

const CREATING = 'tasks/creating-tasks'
const LISTING = 'tasks/listing-tasks'

function claim(sectionAnchor: string, over: Partial<ExtractOutcome['claims'][number]> = {}): ExtractOutcome['claims'][number] {
  return {
    claim: '`relkit add <title>` creates a task and prints its id',
    driver: 'cli',
    sectionAnchor,
    reason: 'stdout carries the new id',
    verification: { method: 'behavior', scope: 'configuration', observable: 'stdout carries the new id', cases: [{ id: 'created-id', claim: 'Print the created task id', method: 'behavior', requires: ['process'], conditions: [] }] },
    needs: [],
    ...over,
  }
}

/** Call a session tool the way a driver does — the tool-result event is what
 *  the shell's outcome precondition reads off the transcript. */
async function callTool(
  input: SessionRunInput,
  name: string,
  args: unknown,
): Promise<{ content: string; isError?: boolean }> {
  const tool = input.def.tools.find((t) => t.name === name)!
  const result = await tool.execute(args, {
    workItem: 'doc',
    signal: input.signal,
    dispatchChild: () => {
      throw new Error('depth-1 children are not part of extraction')
    },
  })
  input.onEvent({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError })
  return result
}

// ---------------------------------------------------------------------------
// 1 + 2 — the session def through the real loop
// ---------------------------------------------------------------------------

describe('guard-generate.extract — the session def through the loop', () => {
  function conversionDraft(method: 'behavior' | 'concurrency'): ExtractOutcome {
    return {
      claims: [claim(CREATING), claim(LISTING, {
        claim: 'An in-flight conversion for a previous amount never replaces the current result.',
        driver: 'web',
        verification: {
          scope: 'web', method,
          observable: 'The visible conversion result after controlling response completion order.',
          cases: [{
            id: 'stale-conversion-response-ignored',
            claim: 'A late conversion response does not replace the current conversion state.',
            method, requires: ['browser', 'request-control'], conditions: ['request-pending'],
          }],
        },
      })],
      untestable: [],
    }
  }

  it('repairs an invalid terminal web claim after check_claims without losing the other claims', async () => {
    const doc = docsOf(docRepo())[0]
    const bad = conversionDraft('concurrency')
    const good = conversionDraft('behavior')
    const stub = stubDriver(async ({ input, emit }) => {
      await emit({ type: 'assistant-turn', text: 'finish', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, costSource: 'unpriced' } })
      if (!input.resume) {
        expect((await callTool(input, 'check_claims', bad)).isError).toBe(true)
        return { ...outcome(bad), resumeCursor: 'extract-cursor' }
      }
      expect(input.resume.cursor).toBe('extract-cursor')
      expect(input.initialMessages[0]).toContain('Outcome schema needs correction')
      expect(input.initialMessages[0]).toContain('An in-flight conversion')
      expect(input.initialMessages[0]).toContain('A web obligation observes the UI')
      expect(input.resume.events.some(e => e.type === 'tool-result' && e.isError)).toBe(true)
      expect((await callTool(input, 'check_claims', good)).isError).toBeUndefined()
      return outcome(good)
    })
    const { persistence } = memoryPersistence()
    const settled = await runAgentLoop<ExtractOutcome>({
      def: extractSessionDef({ doc, universe: buildGuardDocUniverse([doc]) }),
      workItem: `doc:${doc.doc}`,
      initialMessages: [extractSessionBriefing(doc)],
      driver: stub.driver, persistence, sessionId: 'extract-repair',
    }).outcome

    expect(settled).toMatchObject({ status: 'completed', output: good, spent: { turns: 2, tokens: 220 } })
    expect(stub.calls).toHaveLength(2)
    expect(persistence.readEvents('extract-repair').filter(e => e.type === 'outcome')).toHaveLength(1)
  })

  it.each([false, true])('stops invalid outcomes at the repair limit or token ceiling: %s', async ceiling => {
    const doc = docsOf(docRepo())[0]
    const bad = conversionDraft('concurrency')
    const def = extractSessionDef({ doc, universe: buildGuardDocUniverse([doc]) })
    if (ceiling) def.budget = { ...def.budget, tokenCeiling: 100 }
    const stub = stubDriver(async ({ input, emit }) => {
      await callTool(input, 'check_claims', bad)
      await emit({ type: 'assistant-turn', text: 'finish', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, costSource: 'unpriced' } })
      return outcome(bad)
    })
    const { persistence } = memoryPersistence()
    const settled = await runAgentLoop<ExtractOutcome>({
      def, workItem: `doc:${doc.doc}`, initialMessages: [extractSessionBriefing(doc)],
      driver: stub.driver, persistence, sessionId: 'extract-repair-limit',
    }).outcome

    expect(settled).toMatchObject({ status: 'failed', failure: { kind: ceiling ? 'context-exhausted' : 'malformed' } })
    expect(stub.calls).toHaveLength(ceiling ? 1 : 3)
    expect(settled.spent.turns).toBe(stub.calls.length)
    expect(persistence.readEvents('extract-repair-limit').filter(e => e.type === 'outcome')).toHaveLength(0)
  })

  it('bounces a fabricated anchor from `check_claims`, then accepts the fixed draft', async () => {
    const doc = docsOf(docRepo())[0]
    const bad = { claims: [claim('no-such-section')], untestable: [] }
    const good = { claims: [claim(CREATING)], untestable: [] }
    let first: { content: string; isError?: boolean } | null = null
    let second: { content: string; isError?: boolean } | null = null

    const { driver } = stubDriver(async (call) => {
      first = await callTool(call.input, 'check_claims', bad)
      second = await callTool(call.input, 'check_claims', good)
      return outcome(good)
    })
    const { persistence } = memoryPersistence()
    const handle = runAgentLoop<ExtractOutcome>({
      def: extractSessionDef({ doc, universe: buildGuardDocUniverse([doc]) }),
      workItem: `doc:${doc.doc}`,
      initialMessages: [extractSessionBriefing(doc)],
      driver,
      persistence,
      sessionId: 'extract-1',
    })
    const settled = await handle.outcome

    expect(first!.isError).toBe(true)
    expect(first!.content).toContain('no-such-section')
    expect(first!.content).toContain('Copy an anchor from the outline verbatim')
    expect(second!.isError).toBeUndefined()
    expect(second!.content).toContain('Produce it as the outcome')
    expect(settled.status).toBe('completed')
    if (settled.status !== 'completed') return
    expect(settled.output.claims.map((c) => c.sectionAnchor)).toEqual([CREATING])
  })

  it('refuses an outcome produced without `check_claims`, exactly once', async () => {
    const doc = docsOf(docRepo())[0]
    const draft = { claims: [claim(CREATING)], untestable: [] }
    const def = extractSessionDef({ doc, universe: buildGuardDocUniverse([doc]) })
    expect(def.outcomePrecondition?.tool).toBe('check_claims')

    // Never calls the tool: the shell must hand the refusal back and let the
    // session answer again — and must NOT fire a second time.
    const stub = stubDriver(async () => outcome(draft))
    const { persistence } = memoryPersistence()
    const settled = await runAgentLoop<ExtractOutcome>({
      def,
      workItem: `doc:${doc.doc}`,
      initialMessages: [extractSessionBriefing(doc)],
      driver: stub.driver,
      persistence,
      sessionId: 'extract-2',
    }).outcome

    expect(settled.status).toBe('completed')
    expect(stub.calls).toHaveLength(2)
    expect(stub.calls[1].briefing).toBe(def.outcomePrecondition!.message)
    expect(stub.calls[1].briefing).toContain('you never ran `check_claims`')
  })

  it('the budget and kind are the plan’s three numbers', () => {
    expect(EXTRACT_SESSION_KIND).toBe('guard-generate.extract')
    expect(EXTRACT_SESSION_BUDGET).toEqual({ turns: 10, maxResumes: 1, tokenCeiling: 120_000 })
  })
})

// ---------------------------------------------------------------------------
// The validator-as-tool: `check_claims` runs exactly what the fold runs
// ---------------------------------------------------------------------------

describe('validateExtractDraft — the check the fold re-runs', () => {
  it('rechecks the final outcome for missing cases and mixed observation scopes', () => {
    const doc = docsOf(docRepo())[0]
    const def = extractSessionDef({ doc, universe: buildGuardDocUniverse([doc]) })
    const missing = { claims: [claim(CREATING, { verification: undefined })], untestable: [] }
    expect(def.outcomeSchema.safeParse(missing).success).toBe(false)
    const v = claim(CREATING).verification!
    const mixed = { claims: [claim(CREATING, { verification: { ...v, scope: 'web', method: 'datastore' } })], untestable: [] }
    expect(def.outcomeSchema.safeParse(mixed).success).toBe(false)
    expect(def.outcomeSchema.safeParse({ claims: [claim(CREATING)], untestable: [] }).success).toBe(true)
  })

  it('passes a loose-but-snappable anchor and refuses an unsnappable one', () => {
    const doc = docsOf(docRepo())[0]
    expect(validateExtractDraft({ claims: [claim('Creating Tasks')], untestable: [] }, doc)).toEqual([])
    const problems = validateExtractDraft({ claims: [claim('nope/nowhere')], untestable: [] }, doc)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('nope/nowhere')
  })

  it('refuses a second untestable note for the same section', () => {
    const doc = docsOf(docRepo())[0]
    const problems = validateExtractDraft(
      {
        claims: [],
        untestable: [
          { sectionAnchor: LISTING, reason: 'background' },
          { sectionAnchor: 'Listing Tasks', reason: 'background again' },
        ],
      },
      doc,
    )
    expect(problems.some((p) => p.includes('one per section'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The system prompt — the classification rules the retired one-shot pinned
// ---------------------------------------------------------------------------

describe('EXTRACT_SESSION_SYSTEM_PROMPT', () => {
  it('routes SERVER-PROCESS claims to api, not cli', () => {
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('the behavior of the service PROCESS itself')
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('shuts down on SIGTERM/SIGINT')
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('state survives a restart')
  })

  it('keeps LLM-provider-dependent commands out of cli claims', () => {
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('authenticated LLM provider')
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('external AI CLI')
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('llm-provider')
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('Do NOT extract such a command')
  })

  it('classifies programmatic-API claims as library, by consumption form', () => {
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('IMPORTING it from user code')
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('documented consumption form')
    expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('tui/library claims')
  })

  it('states the closed NEEDS vocabulary the outcome schema enforces', () => {
    for (const kind of ['credential', 'fixture', 'state', 'external', 'manual']) {
      expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain(`- ${kind}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 8 — paging. An OpenAPI doc pages per OPERATION, never as one giant chunk.
// ---------------------------------------------------------------------------

const TODOS_OPENAPI = `openapi: 3.0.3
info: { title: Todos, version: 1.0.0 }
paths:
  /todos:
    get:
      operationId: listTodos
      responses: { '200': { description: ok } }
    post:
      operationId: createTodo
      responses: { '201': { description: created } }
  /todos/{id}:
    get:
      operationId: getTodo
      responses: { '200': { description: ok } }
`

describe('doc paging', () => {
  it('pages an OpenAPI doc once per operation section', () => {
    const doc = docsOf(docRepo(TODOS_OPENAPI, 'api/openapi.yaml'))[0]
    expect(doc.sections.map((s) => s.anchor).sort()).toEqual([
      'paths/get-gettodo',
      'paths/get-listtodos',
      'paths/post-createtodo',
    ])
    expect(docChunkCount(doc)).toBe(3)
    const chunk = renderDocChunk(doc, 1)
    expect(chunk.isError).toBeUndefined()
    expect(chunk.content).toContain('chunk 1/3')
    expect(renderDocChunk(doc, 4).isError).toBe(true)
    // The briefing is honest about what it did not show.
    expect(extractSessionBriefing(doc)).toContain('2 more chunk(s)')
  })

  it('pages a short markdown doc as one chunk', () => {
    const doc = docsOf(docRepo())[0]
    expect(docChunkCount(doc)).toBe(1)
    expect(extractSessionBriefing(doc)).not.toContain('more chunk(s)')
  })
})

// ---------------------------------------------------------------------------
// 6 — the suppression key gates the cache, and the briefing says so
// ---------------------------------------------------------------------------

describe('suppression', () => {
  const QUOTE = '`relkit add <title>` creates a task and prints its id as `t<N>`.'

  it('keys an unsuppressed doc off its text alone, and re-keys a suppressed one', () => {
    const doc = docsOf(docRepo())[0]
    const clean = extractSessionCacheKey(doc)
    expect(extractSessionCacheKey({ content: doc.content, suppressedQuotes: [] })).toBe(clean)
    expect(extractSessionCacheKey({ content: doc.content, suppressedQuotes: [QUOTE] })).not.toBe(clean)
    // Order-independent, like the underlying suppression key.
    expect(extractSessionCacheKey({ content: doc.content, suppressedQuotes: ['b', 'a'] })).toBe(
      extractSessionCacheKey({ content: doc.content, suppressedQuotes: ['a', 'b'] }),
    )
  })

  it('carries the RESOLVED — STALE block into the briefing, and nothing when clean', () => {
    const doc = docsOf(docRepo())[0]
    expect(extractSessionBriefing(doc)).not.toContain('RESOLVED — STALE')
    const briefing = extractSessionBriefing({ ...doc, suppressedQuotes: [QUOTE] })
    expect(briefing).toContain('RESOLVED — STALE, DO NOT EXTRACT')
    expect(briefing).toContain(QUOTE)
  })
})

// ---------------------------------------------------------------------------
// 3 + 5 — the SEAM: the fold's re-snap, and the lazy driver
// ---------------------------------------------------------------------------

/** Prime the per-doc session cache with a raw (un-snapped) outcome. */
async function primeExtractCache(r: string, doc: GuardDoc, value: ExtractOutcome): Promise<void> {
  await setCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(doc), value)
}

describe('the extract seam', () => {
  let home = ''
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-extract-home-'))
    process.env.TRUECOURSE_HOME = home
  })
  afterEach(() => {
    delete process.env.TRUECOURSE_HOME
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('a cache hit spends no session and builds no driver', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    await primeExtractCache(r, doc, { claims: [claim(CREATING)], untestable: [] })

    // `transport: 'api'` with an empty TRUECOURSE_HOME makes driver
    // construction throw — so surviving the call proves none was built.
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' })
    const { byDoc, summary } = await seams.extractSession({ docs: [doc] })

    expect(summary).toMatchObject({ kind: EXTRACT_SESSION_KIND, ran: 0, fromCache: 1, failed: 0 })
    expect(seams.runId()).toBeUndefined()
    const result = byDoc.get(doc.doc)!
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.claims).toHaveLength(1)
  })

  it('re-snaps a cached outcome against the LIVE index (model anchors are never trusted)', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    await primeExtractCache(r, doc, {
      // A loose anchor that re-slugs onto the live one, and one that snaps
      // onto nothing at all.
      claims: [claim('Creating Tasks'), claim('a-section-that-was-deleted', { claim: 'ghost claim' })],
      untestable: [{ sectionAnchor: 'Listing Tasks', reason: 'no observable behavior' }],
    })
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' })
    const { byDoc } = await seams.extractSession({ docs: [doc] })
    const result = byDoc.get(doc.doc)!
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.claims.map((c) => c.sectionAnchor)).toEqual([CREATING])
    expect(result.data.untestable.map((n) => n.sectionAnchor)).toEqual([LISTING])
  })

  it('keeps claim needs and proof alternatives through the cached fold', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    await primeExtractCache(r, doc, {
      claims: [claim(CREATING, { alternativeDrivers: ['web'], needs: [{ kind: 'credential', name: 'github-token' }] })],
      untestable: [],
    })
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' })
    const { byDoc } = await seams.extractSession({ docs: [doc] })
    const result = byDoc.get(doc.doc)!
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.claims[0].needs).toEqual([{ kind: 'credential', name: 'github-token' }])
    expect(result.data.claims[0].alternativeDrivers).toEqual(['web'])
  })

  it('ticks progress once per doc, cache hits included', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    await primeExtractCache(r, doc, { claims: [claim(CREATING)], untestable: [] })
    const ticks: [number, number][] = []
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' })
    await seams.extractSession({ docs: [doc], onDoc: (done, total) => ticks.push([done, total]) })
    expect(ticks).toEqual([
      [0, 1],
      [1, 1],
    ])
  })

  // A driver that cannot even be CONSTRUCTED is a transport-class session
  // failure, not a thrown error: the seam stamps it on every pending item so
  // the loss reaches the run through the ordinary channel (a crashed generate
  // would have no stage tally and no per-doc reason at all).
  it('folds an unconstructible driver as a transport-class failure per pending doc', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    const seams = createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' })
    const { byDoc, summary } = await seams.extractSession({ docs: [doc] })

    expect(summary).toMatchObject({ kind: EXTRACT_SESSION_KIND, ran: 1, fromCache: 0, failed: 1, allTransport: true })
    // The tally names the ACTUAL config problem, not a generic driver error.
    expect(summary.firstError).toContain('the session driver could not be constructed')
    expect(summary.firstError).toMatch(/API transport/i)
    const result = byDoc.get(doc.doc)!
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('extraction session failed')
    expect(result.reason).toContain('the session driver could not be constructed')
    // No session ever started, so no run record was completed either.
    expect(seams.runId()).toBeUndefined()
  })

  it('an unconstructible driver aborts the RUN as llm-failed, writing nothing', async () => {
    const r = docRepo()
    const res = await generateGuards({
      repoRoot: r,
      interfaces: DEFAULT_INTERFACES(r),
      extractSession: createGuardGenerateSessionSeams({ repoRoot: r, transport: 'api' }).extractSession,
      flowsAreaSession: flowsAreaSessionOf(() => {
        throw new Error('synthesis must not run after a systemic extraction loss')
      }),
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain(`every session of the \`${EXTRACT_SESSION_KIND}\` kind failed (1 of 1)`)
    expect(res.reason).toContain('the session driver could not be constructed')
    expect(res.llmFailures.find((f) => f.stage === EXTRACT_SESSION_KIND)?.failures).toBe(1)
    expect(res.written).toEqual([])
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'manifest.json'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3 (engine half), 4, 7 — what `generateGuards` does with a seam's answers
// ---------------------------------------------------------------------------

/** A seam answering from a fixed per-doc map, with a summary the caller pins. */
function extractSeamOf(
  byDoc: Map<string, ExtractResult>,
  summary: Partial<GuardSessionSummary> = {},
): ExtractSessionSeam {
  return async () => ({ byDoc, summary: sessionSummary(EXTRACT_SESSION_KIND, { ran: byDoc.size, ...summary }) })
}

describe('generateGuards — what extraction feeds downstream', () => {
  it('carries a claim’s needs into the flow-synthesis seam’s claim input', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    const claims: ExtractOutcome['claims'] = [
      claim(CREATING, { needs: [{ kind: 'credential', name: 'github-token', detail: 'a repo token' }] }),
      claim(LISTING, { claim: '`relkit list` prints one line per open task' }),
    ]
    const seen: FlowClaimInput[] = []
    const res = await generateGuards({
      repoRoot: r,
      interfaces: DEFAULT_INTERFACES(r),
      stopAfterFlows: true,
      extractSession: extractSeamOf(
        new Map([[doc.doc, { ok: true, data: { claims, untestable: [] }, complete: true, failedViews: 0 }]]),
      ),
      flowsAreaSession: flowsAreaSessionOf((area) => {
        seen.push(...area.claims)
        return { flows: [], noFlowClaims: area.claims.map((c) => ({ doc: c.doc, anchor: c.anchor, claimTitle: c.title, reason: 'not composed here' })) }
      }),
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })

    expect(res.status).toBe('ok')
    expect(seen.map((c) => c.anchor).sort()).toEqual([CREATING, LISTING])
    expect(seen.find((c) => c.anchor === CREATING)!.needs).toEqual([
      { kind: 'credential', name: 'github-token', detail: 'a repo token' },
    ])
    // A claim with no needs carries none at all — the one-shot-era serialization.
    expect(seen.find((c) => c.anchor === LISTING)!.needs).toBeUndefined()
  })

  it('settles a section with no claim as a `no-claim` gap, and a noted one as `untestable`', async () => {
    const r = docRepo()
    const [doc] = docsOf(r)
    const res = await generateGuards({
      repoRoot: r,
      interfaces: DEFAULT_INTERFACES(r),
      stopAfterFlows: true,
      extractSession: extractSeamOf(
        new Map([
          [
            doc.doc,
            {
              ok: true,
              data: { claims: [claim(CREATING)], untestable: [{ sectionAnchor: LISTING, reason: 'a heading, nothing more' }] },
              complete: true,
              failedViews: 0,
            },
          ],
        ]),
      ),
      flowsAreaSession: flowPerClaimSession(),
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })
    expect(res.status).toBe('ok')
    const kinds = new Map(res.coverageGaps.map((g) => [g.anchor, g.kind]))
    expect(kinds.get(LISTING)).toBe('untestable')
    // The doc's own root section states nothing and carries no note.
    expect(kinds.get('tasks')).toBe('no-claim')
  })

  it('fails OPEN per doc: one failed session is named, the other doc still generates', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }, { ref: 'docs/other.md' }])
    writeDoc(r, DOC, CONTENT)
    writeDoc(r, 'docs/other.md', '# Other\n\nSomething else entirely.\n')
    const docs = docsOf(r)
    expect(docs).toHaveLength(2)

    const byDoc = new Map<string, ExtractResult>([
      [DOC, { ok: true, data: { claims: [claim(CREATING)], untestable: [] }, complete: true, failedViews: 0 }],
      ['docs/other.md', { ok: false, reason: 'extraction session failed: the provider failed (provider): gone' }],
    ])
    const res = await generateGuards({
      repoRoot: r,
      interfaces: DEFAULT_INTERFACES(r),
      stopAfterFlows: true,
      extractSession: extractSeamOf(byDoc, { ran: 2, failed: 1, firstError: 'the provider failed (provider): gone' }),
      flowsAreaSession: flowPerClaimSession(),
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })

    expect(res.status).toBe('ok')
    expect(res.extractionFailures.map((f) => f.doc)).toEqual(['docs/other.md'])
    expect(res.llmFailures).toContainEqual({
      stage: EXTRACT_SESSION_KIND,
      attempts: 2,
      failures: 1,
      firstError: 'the provider failed (provider): gone',
    })
  })

  it('aborts `llm-failed` and writes nothing when the provider loses EVERY doc', async () => {
    const r = docRepo()
    const before = readManifest(r)
    const res = await generateGuards({
      repoRoot: r,
      interfaces: DEFAULT_INTERFACES(r),
      extractSession: extractSeamOf(
        new Map([[DOC, { ok: false, reason: 'extraction session failed: the provider failed (provider): gone' }]]),
        { ran: 1, failed: 1, allTransport: true, firstError: 'the provider failed (provider): gone' },
      ),
      flowsAreaSession: flowsAreaSessionOf(() => {
        throw new Error('synthesis must not run after a systemic extraction loss')
      }),
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('every session of the `guard-generate.extract` kind failed (1 of 1)')
    expect(res.written).toEqual([])
    expect(readManifest(r)).toEqual(before)
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'flows.json'))).toBe(false)
  })

  it('a NON-transport wipeout (every session malformed) also aborts', async () => {
    const r = docRepo()
    const res = await generateGuards({
      repoRoot: r,
      interfaces: DEFAULT_INTERFACES(r),
      extractSession: extractSeamOf(new Map([[DOC, { ok: false, reason: 'malformed' }]]), {
        ran: 1,
        failed: 1,
        allTransport: false,
      }),
      flowsAreaSession: flowPerClaimSession(),
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })
    // `isSystemicSessionLoss` is transport-only by construction, so this run is
    // NOT a systemic abort — it is a fail-open run with no claims at all.
    expect(res.status).toBe('ok')
    expect(res.extractionFailures).toHaveLength(1)
  })
})

// A guard against the seam and the estimate drifting apart: the key is a pure
// function of the prompt fingerprint + the doc's content (+ suppression).
describe('extractSessionCacheKey', () => {
  it('is a sha256 over content, and moves when the content moves', () => {
    const key = extractSessionCacheKey({ content: 'a', suppressedQuotes: [] })
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(extractSessionCacheKey({ content: 'b', suppressedQuotes: [] })).not.toBe(key)
    expect(createHash('sha256').update('a').digest('hex')).not.toBe(key)
  })
})

describe('source-grounded observation boundaries', () => {
  // These fixtures exercise deterministic metadata validation, not a real model's
  // understanding of prose. The prompt remains responsible for semantic splitting.
  it('keeps UI save/edit/table requirements independent of protocol and invisible metadata', () => {
    const r = docRepo(); const doc = docsOf(r)[0]
    const web = (id: string, text: string): ExtractOutcome['claims'][number] => claim(CREATING, { claim: text, driver: 'web',
      verification: { scope: 'web', method: 'behavior', observable: text,
        cases: [{ id, claim: text, method: 'behavior', requires: ['browser'], conditions: [] }] } })
    const post = web('post-save', 'Save closes the dialog and refreshes totals')
    const edit = web('edit-reload', 'An edit survives reload')
    const table = web('date-order', 'Expense rows descend by date')
    const api = claim(CREATING, { claim: 'POST creates a record and edits preserve createdAt', driver: 'api',
      verification: { scope: 'api', method: 'behavior', observable: 'HTTP response and subsequent read', cases: [
        { id: 'post-contract', claim: 'POST creates the record', method: 'behavior', requires: ['http'], conditions: [] },
        { id: 'created-at', claim: 'An edit preserves createdAt', method: 'behavior', requires: ['http'], conditions: [] },
      ] } })
    expect(validateExtractDraft({ claims: [post, edit, table, api], untestable: [] }, doc)).toEqual([])
    for (const c of [post, edit, table]) {
      const mixed = { ...c, verification: { ...c.verification!, cases: [...c.verification!.cases!, api.verification!.cases![0]] } }
      expect(validateExtractDraft({ claims: [mixed], untestable: [] }, doc).join(' ')).toContain('Move protocol')
    }
    expect(validateExtractDraft({ claims: [{ ...post, alternativeDrivers: ['api'] }], untestable: [] }, doc).join(' ')).toContain('web proof only')
  })
  it('separates pristine empty-state proof from filtered-empty presentation', () => {
    const r = docRepo(); const doc = docsOf(r)[0]
    const empty = claim(CREATING, { claim: 'A pristine empty ledger has a zero total', driver: 'web', verification: {
      scope: 'web', method: 'behavior', observable: 'Empty list and zero total', cases: [{ id: 'empty-ledger', claim: 'Empty ledger total is zero', method: 'behavior', requires: ['browser'], conditions: ['fresh-state'], preparation: 'empty' }],
    } })
    const filtered = claim(CREATING, { claim: 'A filter with no matching records shows no results', driver: 'web', verification: {
      scope: 'web', method: 'behavior', observable: 'Filtered empty list', cases: [{ id: 'filtered-empty', claim: 'No matching rows', method: 'behavior', requires: ['browser'], conditions: [] }],
    } })
    expect(validateExtractDraft({ claims: [empty, filtered], untestable: [] }, doc)).toEqual([])
    const merged = { ...empty, verification: { ...empty.verification!, cases: [...empty.verification!.cases!, ...filtered.verification!.cases!] } }
    expect(validateExtractDraft({ claims: [merged], untestable: [] }, doc).join(' ')).toContain('different starting')
  })
})
