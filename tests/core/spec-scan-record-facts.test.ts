/**
 * THE FACT RECORD — `spec-scan.record-facts`, one session per window of a kept
 * doc's sentences, on a scan that finds conflicts by comparing facts.
 *
 * What is under test:
 * - the gate: what it refuses (an uncovered sentence, a sentence both cited and
 *   skipped, a fact outside the window, an area the doc does not have, an
 *   `other` skip with no note), what it accepts, and that a refusal stays
 *   bounded;
 * - the session def: closed tools on the doc alone, the gate enforced on the
 *   outcome, and a wrapping-up outcome accepted with its gaps stamped;
 * - the cache key moves with exactly its named inputs;
 * - window planning, and a doc's ledger folded from its windows;
 * - through the real `runSpecScanSessions` on a scripted driver: the option
 *   runs the record pool, collects each doc's ledger with canonical areas,
 *   counts it into the corpus and the checklist, caches per window, fails
 *   open into `notReached`. What
 *   happens to the ledgers after recording is `spec-scan-settle-subjects` and
 *   `spec-scan-compare-facts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache'
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs'
import { LlmStageFailureError } from '@truecourse/shared/llm'
import { KnownDisplayBlockSchema, RunRecordSchema } from '../../packages/agent-loop/src/index'
import { CURATE_STEPS, curateInProcess } from '../../packages/core/src/commands/spec-in-process'
import { listStoredSessionRuns } from '../../packages/core/src/lib/sessions-store'
import { StepTracker } from '../../packages/core/src/progress'
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run'
import {
  FACT_SENTENCES_MAX,
  FactLedgerWireSchema,
  RECORD_FACTS_SESSION_KIND,
  RECORD_STAGE_VERSION,
  RECORD_WINDOW_SENTENCES,
  checkLedger,
  describeDocLedger,
  docFactLedger,
  ledgerRefusal,
  recordFactsCacheKey,
  recordFactsItems,
  recordFactsSessionDef,
  type FactLedger,
  type FactLedgerWire,
  type LedgerScope,
  type RecordFactsItem,
} from '../../packages/core/src/services/spec-scan/record-facts'
import { CURATE_DOC_SESSION_KIND } from '../../packages/core/src/services/spec-scan/curate-doc'
import { SETTLE_AREAS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-areas'
import { SETTLE_SUBJECTS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-subjects'
import { COMPARE_FACTS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/compare-facts'
import { instructionsFingerprint, scanCacheKey, docLifecycleFingerprint } from '../../packages/core/src/services/spec-scan/tools'
import { writeDecisions, type DecisionsFile, type DocCandidate } from '../../packages/spec-consolidator/src/index.js'
import { SENTENCE_SPLITTER_VERSION, splitDocSentences } from '@truecourse/shared'
import type {
  DriverResult,
  SessionDriver,
  SessionEvent,
  SessionPersistence,
  SessionRunInput,
  TurnUsage,
} from '../../packages/agent-loop/src/index'

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

const SCOPE: LedgerScope = { window: { index: 1, from: 3, to: 8 }, areas: ['core/auth', 'core/exports'] }

const fact = (sentences: number[], areas: string[] = ['core/exports']): FactLedgerWire['facts'][number] => ({
  sentences,
  subject: 'Export my data',
  statement: 'Export my data is under Settings, Account.',
  areas,
})

/** A ledger that accounts for every sentence of SCOPE: 3-5 cited, 6-8 skipped. */
const COMPLETE: FactLedgerWire = {
  facts: [fact([3]), fact([4, 5], ['core/auth', 'core/exports'])],
  skips: [{ from: 6, to: 8, why: 'navigation' }],
}

describe('the record gate', () => {
  it('accepts a ledger that accounts for every sentence of the window', () => {
    const check = checkLedger(COMPLETE, SCOPE)
    expect(check).toEqual({ problems: [], uncovered: [], facts: COMPLETE.facts, skipped: { navigation: 3 } })
    expect(ledgerRefusal(check)).toBeUndefined()
  })

  it('refuses uncovered sentences, naming them as ranges', () => {
    const check = checkLedger({ facts: [fact([4])], skips: [] }, SCOPE)
    expect(check.uncovered).toEqual([3, 5, 6, 7, 8])
    expect(ledgerRefusal(check)).toMatch(/5 sentence\(s\) no fact cites and no skip covers: 3, 5-8\./)
  })

  it('refuses a sentence both cited and skipped, and counts it as cited', () => {
    const check = checkLedger({ ...COMPLETE, skips: [{ from: 5, to: 8, why: 'example' }] }, SCOPE)
    expect(check.problems).toEqual(['sentence 5 is both cited by a fact and skipped; a sentence is one or the other'])
    expect(check.uncovered).toEqual([])
    expect(check.skipped).toEqual({ example: 3 })
  })

  it('refuses a fact citing a sentence outside the window, or too many sentences, or none', () => {
    const check = checkLedger(
      { facts: [fact([3, 9]), fact([3, 4, 5, 6]), fact([])], skips: [{ from: 3, to: 8, why: 'other', note: 'a table of contents' }] },
      SCOPE,
    )
    expect(check.problems).toEqual([
      'facts[0] cites sentence 9, outside this window (3-8)',
      `facts[1] cites 4 sentences; a fact cites 1 to ${FACT_SENTENCES_MAX}`,
      `facts[2] cites 0 sentences; a fact cites 1 to ${FACT_SENTENCES_MAX}`,
    ])
    // A refused fact covers nothing; the skip still covers its sentences.
    expect(check.facts).toEqual([])
    expect(check.uncovered).toEqual([])
  })

  it('refuses an area the doc does not have, and a fact with none', () => {
    const check = checkLedger({ facts: [fact([3], ['core/billing']), fact([4], [])], skips: [{ from: 5, to: 8, why: 'advice' }] }, SCOPE)
    expect(check.problems).toEqual([
      'facts[0] names "core/billing", not an area of this document (core/auth, core/exports)',
      'facts[1] names no area; name one or more of core/auth, core/exports',
    ])
    expect(check.uncovered).toEqual([3, 4])
  })

  it('refuses an "other" skip with no note, and one outside the window', () => {
    const check = checkLedger(
      { facts: [fact([3])], skips: [{ from: 4, to: 6, why: 'other' }, { from: 7, to: 9, why: 'legal' }] },
      SCOPE,
    )
    expect(check.problems).toEqual([
      'skips[0] is for "other" and has no note saying what the sentences are',
      'skips[1] reaches outside this window (3-8)',
    ])
    expect(check.uncovered).toEqual([4, 5, 6, 7, 8])
  })

  it('bounds a refusal: at most 40 sentence ranges and 25 problems are listed', () => {
    const scope: LedgerScope = { window: { index: 1, from: 1, to: 300 }, areas: ['core/x'] }
    const evens = Array.from({ length: 150 }, (_, i) => fact([2 * (i + 1)], ['core/x']))
    const bad = Array.from({ length: 30 }, () => fact([1], ['core/nope']))
    const refusal = ledgerRefusal(checkLedger({ facts: [...evens, ...bad], skips: [] }, scope))!
    expect(refusal).toMatch(/150 sentence\(s\) no fact cites/)
    expect(refusal).toMatch(/, 79, and 110 more\./)
    expect(refusal.match(/^ {2}- facts\[/gm)).toHaveLength(25)
    expect(refusal).toMatch(/- and 5 more/)
  })
})

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function doc(ref: string, content: string, over: Partial<DocCandidate> = {}): DocCandidate {
  return {
    path: ref,
    absPath: '',
    content,
    kind: 'spec',
    preview: content,
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `h-${ref}`,
    size: content.length,
    ...over,
  }
}

const EXPORT_MD = `# Export

## Where

Export my data is under Settings, Account. It runs nightly.

- PDF
- JSON
`

const PRIVACY_MD = `# Privacy

## Where

Export my data is under Settings, Danger Zone. It runs weekly.

- PDF
- Markdown
`

const NOTES_MD = `# Notes

Nothing in particular.
`

// ---------------------------------------------------------------------------
// the session def
// ---------------------------------------------------------------------------

describe('the record session def', () => {
  const exportDoc = doc('docs/export.md', EXPORT_MD)
  const item = recordFactsItems(exportDoc, [{ product: 'core', concern: 'exports' }])[0]!

  it('has closed tools only: the gate, and read_section over the doc itself', async () => {
    const def = recordFactsSessionDef(item)
    expect(def.computer).toBeUndefined()
    expect(def.tools.map((t) => t.name)).toEqual(['read_section', 'check_ledger'])
    expect(def.outcomePrecondition?.tool).toBe('check_ledger')
    const read = def.tools[0]!
    const ctx = { workItem: '', signal: new AbortController().signal, dispatchChild: () => Promise.reject(new Error('unused')) }
    expect((await read.execute({ doc: 'docs/export.md', heading: 'Where' }, ctx)).content).toContain('Settings, Account')
    expect(await read.execute({ doc: 'docs/privacy.md', heading: 'Where' }, ctx)).toMatchObject({ isError: true })
  })

  it('runs the gate in check_ledger', async () => {
    const def = recordFactsSessionDef(item)
    const check = def.tools[1]!
    const ctx = { workItem: '', signal: new AbortController().signal, dispatchChild: () => Promise.reject(new Error('unused')) }
    const draft: FactLedgerWire = { facts: [fact([1], ['core/exports'])], skips: [] }
    expect(await check.execute(draft, ctx)).toMatchObject({ isError: true, content: expect.stringMatching(/2-4\./) })
    const done: FactLedgerWire = { facts: [fact([1, 2], ['core/exports'])], skips: [{ from: 3, to: 4, why: 'example' }] }
    expect((await check.execute(done, ctx)).content).toMatch(/^The ledger is complete: 1 fact\(s\), 2 sentence\(s\) skipped/)
  })

  it('refuses an incomplete outcome, and wrapping up accepts it with its gaps stamped', () => {
    const def = recordFactsSessionDef(item)
    const wire: FactLedgerWire = { facts: [fact([1])], skips: [{ from: 2, to: 2, why: 'other' }] }
    const outcome = def.resolveOutcome!(wire, []) as FactLedger
    expect(outcome.unrecorded).toEqual([2, 3, 4])
    expect(def.validateOutcome!(outcome, { wrappingUp: false })).toMatch(/^Ledger refused\./)
    expect(def.validateOutcome!(outcome, { wrappingUp: true })).toBeUndefined()
    expect(def.outcomeSchema.parse(outcome)).toEqual(outcome)
  })

  it('stamps `unrecorded` itself: the model cannot write it', () => {
    expect(FactLedgerWireSchema.safeParse({ facts: [], skips: [], unrecorded: [] }).success).toBe(false)
    const def = recordFactsSessionDef(item)
    expect(() => def.resolveOutcome!({ facts: [], skips: [], unrecorded: [] }, [])).toThrow()
  })
})

// ---------------------------------------------------------------------------
// cache key — named inputs only
// ---------------------------------------------------------------------------

describe('recordFactsCacheKey', () => {
  const FRONT = `---\ntitle: "Export"\ndescription: "Where exports live."\n---\n\n${EXPORT_MD}`
  const base = (over: Partial<DocCandidate> = {}, body = FRONT): RecordFactsItem =>
    recordFactsItems(doc('docs/export.md', body, over), [{ product: 'core', concern: 'exports' }])[0]!
  const key = (item: RecordFactsItem, instructions: string[] = []): string =>
    recordFactsCacheKey(item, [instructionsFingerprint(instructions)])
  const KEY = key(base())

  it('is the named inputs, in order, and nothing else', () => {
    const item = base()
    expect(KEY).toBe(
      scanCacheKey([
        `record-facts-v${RECORD_STAGE_VERSION}`,
        `sentences-v${SENTENCE_SPLITTER_VERSION}`,
        'docs/export.md',
        'h-docs/export.md',
        docLifecycleFingerprint(item.doc),
        'title=Export\ndescription=Where exports live.',
        'core/exports',
        `${item.window.from}-${item.window.to}`,
        instructionsFingerprint([]),
      ]),
    )
  })

  it('moves with each named input', () => {
    expect(key(base({ path: 'docs/export-2.md' }))).not.toBe(KEY)
    expect(key(base({ contentHash: 'h-edited' }))).not.toBe(KEY)
    expect(key(base({ lastTouched: '2026-02-01T00:00:00Z' }))).not.toBe(KEY)
    expect(key(base({}, FRONT.replace('Where exports live.', 'Where exports go.')))).not.toBe(KEY)
    // Every frontmatter line is a sentence, so an edit to a key beside the title moves it too.
    const SLUGGED = FRONT.replace('---\ntitle', '---\nslug: export\ntitle')
    expect(key(base({}, SLUGGED.replace('slug: export', 'slug: exports')))).not.toBe(key(base({}, SLUGGED)))
    expect(key({ ...base(), areas: ['core/exports', 'core/privacy'] })).not.toBe(KEY)
    expect(key({ ...base(), window: { index: 1, from: 1, to: 3 } })).not.toBe(KEY)
    expect(key(base(), ['be strict'])).not.toBe(KEY)
  })

  it('does not move with the window ordinal, the window count or the area order', () => {
    const item = base()
    expect(key({ ...item, window: { ...item.window, index: 4 }, windows: 9 })).toBe(KEY)
    const two = recordFactsItems(doc('docs/export.md', FRONT), [
      { product: 'core', concern: 'privacy' },
      { product: 'core', concern: 'exports' },
    ])[0]!
    expect(key(two)).toBe(key({ ...item, areas: ['core/privacy', 'core/exports'] }))
  })
})

// ---------------------------------------------------------------------------
// windows, and a doc's ledger
// ---------------------------------------------------------------------------

describe('record windows and the doc ledger', () => {
  it('plans one item per window, and none for a doc with no area tag', () => {
    const many = `# Big\n\n${Array.from({ length: RECORD_WINDOW_SENTENCES + 30 }, (_, i) => `- Item ${i}`).join('\n')}\n`
    const items = recordFactsItems(doc('docs/big.md', many), [{ product: 'core', concern: 'big' }])
    expect(items.map((i) => [i.window.from, i.window.to, i.windows])).toEqual([
      [1, RECORD_WINDOW_SENTENCES, 2],
      [RECORD_WINDOW_SENTENCES + 1, RECORD_WINDOW_SENTENCES + 30, 2],
    ])
    expect(items[0]!.sentences).toHaveLength(RECORD_WINDOW_SENTENCES + 30)
    expect(recordFactsItems(doc('docs/big.md', many), [])).toEqual([])
  })

  it('folds windows into one ledger: standing facts with canonical areas, skips, gaps and failures', () => {
    const sentences = splitDocSentences(EXPORT_MD)
    const ledger = docFactLedger({
      doc: 'docs/export.md',
      sentences,
      areas: ['core/Data Export'],
      windows: [
        { window: { index: 2, from: 3, to: 4 }, ledger: null },
        {
          window: { index: 1, from: 1, to: 2 },
          ledger: { facts: [fact([1], ['core/Data Export']), fact([2], ['core/nope'])], skips: [] },
        },
      ],
      canonicalAreas: (raw) => (raw === 'core/Data Export' ? ['core/exports'] : []),
    })
    expect(ledger.facts).toEqual([
      {
        doc: 'docs/export.md',
        sentences: [sentences[0]],
        subject: 'Export my data',
        statement: 'Export my data is under Settings, Account.',
        areas: ['core/exports'],
      },
    ])
    expect(ledger.unrecorded).toEqual([2])
    expect(ledger.failed).toEqual([{ index: 2, from: 3, to: 4 }])
    expect(describeDocLedger(ledger, 2)).toBe('4 sentences, 1 fact, 0 skipped, 1 unrecorded, 1 of 2 windows not recorded, the session failed')
  })
})

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const usage = (): TurnUsage => ({
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  costUsd: 0,
  costSource: 'unpriced',
})

function messagesOf(input: SessionRunInput): string[] {
  const prior = (input.resume?.events ?? []).flatMap((e) => (e.type === 'user-message' ? [e.content] : []))
  return [...prior, ...input.initialMessages]
}

const briefingOf = (input: SessionRunInput, marker: string): string =>
  messagesOf(input).find((m) => m.includes(marker)) ?? ''

const briefedDoc = (input: SessionRunInput): string =>
  /^PATH \(repo-relative\): (.+)$/m.exec(briefingOf(input, 'PATH (repo-relative)'))?.[1] ?? ''

/** What a record briefing hands the session: its doc, its area tags, its sentences. */
function windowOf(input: SessionRunInput): { doc: string; areas: string[]; sentences: number[] } {
  const briefing = briefingOf(input, 'YOUR WINDOW')
  return {
    doc: /^DOCUMENT: (\S+)/m.exec(briefing)![1]!,
    areas: /^AREA TAGS \(.*?\): (.+)$/m.exec(briefing)![1]!.split(', '),
    sentences: [...briefing.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1])),
  }
}

async function callTool(input: SessionRunInput, name: string, args: unknown): Promise<string> {
  const tool = input.def.tools.find((t) => t.name === name)!
  input.onEvent({ type: 'assistant-turn', toolCall: { name, args }, usage: usage() })
  const result = await tool.execute(args, {
    workItem: '',
    signal: input.signal,
    dispatchChild: () => {
      throw new Error('not used')
    },
  })
  input.onEvent({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError })
  return result.content
}

/** An honest recorder: the window's first sentence skipped as navigation, every other sentence a fact of its own. */
async function honestRecord(input: SessionRunInput): Promise<DriverResult> {
  const { sentences, areas } = windowOf(input)
  const [first, ...rest] = sentences
  const ledger: FactLedgerWire = {
    facts: rest.map((n) => ({ sentences: [n], subject: `sentence ${n}`, statement: `Sentence ${n} states a fact.`, areas: [areas[0]!] })),
    skips: first === undefined ? [] : [{ from: first, to: first, why: 'navigation' }],
  }
  await callTool(input, 'check_ledger', ledger)
  return { kind: 'outcome', value: ledger }
}

type Script = (kind: string, input: SessionRunInput) => Promise<DriverResult>

function scriptedDriver(script: Script): SessionDriver & { runs: Array<{ kind: string; doc?: string }> } {
  const runs: Array<{ kind: string; doc?: string }> = []
  return {
    runs,
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      for (const content of input.initialMessages) input.onEvent({ type: 'user-message', content })
      runs.push({ kind: input.def.kind, ...(input.def.kind === RECORD_FACTS_SESSION_KIND ? { doc: windowOf(input).doc } : {}) })
      const done = (async () => {
        await new Promise((r) => setTimeout(r, 0))
        return script(input.def.kind, input)
      })()
      return { done, status: () => 'running' as const, steer: () => {}, interrupt: async () => {} }
    },
  }
}

function memoryPersistence(): SessionPersistence {
  const events = new Map<string, SessionEvent[]>()
  return {
    appendEvent(sessionId, event) {
      const list = events.get(sessionId) ?? []
      list.push(event)
      events.set(sessionId, list)
    },
    updateIndex() {},
    readEvents: (sessionId) => events.get(sessionId) ?? [],
  }
}

let repo: string
let decisions: DecisionsFile
beforeEach(() => {
  installMemoryKvCache()
  installMemorySessionRuns()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-record-'))
  decisions = {
    version: 2,
    manualIncludes: [],
    manualExcludes: [],
    manualAreas: [],
    conflictResolutions: [],
    scopeVerdicts: [
      { path: '.', verdict: 'keep', reason: 'root', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'user' },
      { path: 'docs', verdict: 'keep', reason: 'docs', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'user' },
    ],
    instructions: [],
  }
  writeDecisions(repo, decisions)
  for (const [rel, content] of Object.entries({ 'docs/export.md': EXPORT_MD, 'docs/privacy.md': PRIVACY_MD, 'docs/notes.md': NOTES_MD })) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
    fs.writeFileSync(path.join(repo, rel), content)
  }
})
afterEach(() => {
  resetKvCacheStore()
  resetSessionRuns()
  fs.rmSync(repo, { recursive: true, force: true })
})

/** Two docs on one concern spelled two ways, settled into one; the notes carry no area. */
const TAGGING: Record<string, Array<{ product: string; concern: string }>> = {
  'docs/export.md': [{ product: 'core', concern: 'Data Export' }],
  'docs/privacy.md': [{ product: 'core', concern: 'exports' }],
  'docs/notes.md': [],
}

/** The driver every scan below runs on: curation per TAGGING, one settling merge, `record` for the record kind. */
function scanDriver(record: (input: SessionRunInput) => Promise<DriverResult> = honestRecord) {
  return scriptedDriver(async (kind, input) => {
    if (kind === CURATE_DOC_SESSION_KIND) {
      return { kind: 'outcome', value: { keep: true, reason: 'spec', areas: TAGGING[briefedDoc(input)] ?? [] } }
    }
    if (kind === SETTLE_AREAS_SESSION_KIND) {
      return {
        kind: 'outcome',
        value: {
          concernMerges: [{ drifted: 'data-export', canonical: 'exports' }],
          productMerges: [],
          productVerdicts: [],
          subdivisions: [],
        },
      }
    }
    if (kind === RECORD_FACTS_SESSION_KIND) return record(input)
    if (kind === SETTLE_SUBJECTS_SESSION_KIND) {
      // Every subject name distinct.
      const settlement = { same: [], distinct: [...messagesOf(input).join('\n').matchAll(/^(S\d+) · /gm)].map((m) => m[1]!) }
      await callTool(input, 'check_subjects', settlement)
      return { kind: 'outcome', value: settlement }
    }
    if (kind === COMPARE_FACTS_SESSION_KIND) {
      // Every fact alone.
      const comparison = { groups: [], alone: [...messagesOf(input).join('\n').matchAll(/^(F\d+) · /gm)].map((m) => m[1]!) }
      await callTool(input, 'check_groups', comparison)
      return { kind: 'outcome', value: comparison }
    }
    throw new Error(`unscripted session kind: ${kind}`)
  })
}

async function runScan(opts: {
  record?: (input: SessionRunInput) => Promise<DriverResult>
}) {
  const driver = scanDriver(opts.record)
  const facts: Array<[string, string]> = []
  const result = await runSpecScanSessions({
    repoRoot: repo,
    driver: async () => driver,
    persistence: memoryPersistence(),
    skipGit: true,
    onFact: (step, line) => facts.push([step, line]),
  })
  return { result, driver, facts }
}

// ---------------------------------------------------------------------------
// the scan
// ---------------------------------------------------------------------------

describe('a scan that finds conflicts by comparing facts', () => {
  it('records every kept doc with an area tag, window by window, and hands the facts on to be compared', async () => {
    const { result, driver, facts } = await runScan({})
    expect(driver.runs.filter((r) => r.kind === RECORD_FACTS_SESSION_KIND).map((r) => r.doc).sort()).toEqual([
      'docs/export.md',
      'docs/privacy.md',
    ])
    expect(result.sessions.map((s) => s.kind)).toContain(RECORD_FACTS_SESSION_KIND)
    expect(result.stats.conflictCount).toBe(0)
    expect(result.corpus.areas.flatMap((a) => a.conflicts)).toEqual([])

    expect(facts).toContainEqual(['record', 'docs/export.md: 4 sentences, 3 facts, 1 skipped'])
    expect(facts).toContainEqual(['record', 'docs/notes.md: not recorded, it has no area tag'])
    // Each sentence its own subject, and every fact alone: nothing conflicts.
    expect(facts).toContainEqual(['compare', 'core/exports: 6 facts, 0 groups, 0 conflicts'])
    // "sentence 2", "sentence 3" and "sentence 4" share the word "sentence": one family, all in one area batch.
    expect(result.corpus.comparison).toEqual({
      subjectNames: 3,
      settledSubjects: 3,
      subjectFamilies: 1,
      subjectBatchFamilies: 0,
      subjectBatchFacts: 0,
      unplacedFacts: 0,
    })
  })

  it('hands on each ledger with its facts filed under the settled areas, and counts it into the corpus', async () => {
    const { result } = await runScan({})
    const ledgers = result.factLedgers!
    expect(ledgers.map((l) => l.doc)).toEqual(['docs/export.md', 'docs/privacy.md'])
    // The session cited the raw tag "core/Data Export"; the fact is filed where the doc landed.
    const exportLedger = ledgers[0]!
    expect(exportLedger.facts.map((f) => [f.sentences.map((u) => u.n), f.areas])).toEqual([
      [[2], ['core/exports']],
      [[3], ['core/exports']],
      [[4], ['core/exports']],
    ])
    expect(exportLedger.facts[0]!.sentences[0]!.text).toBe('It runs nightly.')
    expect(result.corpus.areas.map((a) => a.id)).toEqual(['core/exports'])

    const counts = new Map(result.corpus.docs.map((d) => [d.ref, d.ledger]))
    expect(counts.get('docs/export.md')).toEqual({ sentences: 4, facts: 3, skipped: { navigation: 1 }, unrecorded: 0 })
    expect(counts.get('docs/notes.md')).toBeUndefined()
  })

  it('serves every window from the cache on an unchanged re-run', async () => {
    await runScan({})
    const { result, driver, facts } = await runScan({})
    expect(driver.runs.filter((r) => r.kind === RECORD_FACTS_SESSION_KIND)).toEqual([])
    expect(result.noChanges).toBe(true)
    expect(facts).toContainEqual(['record', 'docs/export.md: 4 sentences, 3 facts, 1 skipped, from cache'])
    expect(result.factLedgers!.map((l) => l.facts.length)).toEqual([3, 3])
  })

  it('fails open: a failed window leaves its doc in its areas\' notReached', async () => {
    const { result, facts } = await runScan({
      method: 'facts',
      record: async (input) =>
        windowOf(input).doc === 'docs/privacy.md'
          ? { kind: 'failure', failure: { kind: 'malformed', detail: 'nope', retryability: 'none' } }
          : honestRecord(input),
    })
    expect(result.corpus.areas.find((a) => a.id === 'core/exports')!.notReached).toEqual(['docs/privacy.md'])
    expect(facts).toContainEqual([
      'record',
      'docs/privacy.md: 4 sentences, 0 facts, 0 skipped, 1 of 1 window not recorded, the session failed',
    ])
    expect(result.stats.llmFailures).toEqual([expect.objectContaining({ stage: RECORD_FACTS_SESSION_KIND, failures: 1 })])
  })

  it('checks off a "Recording facts" step with a fact line per doc', async () => {
    let steps: ReadonlyArray<{ key: string; label: string; status: string; facts?: string[] }> = []
    const tracker = new StepTracker((payload) => {
      if (payload.steps) steps = payload.steps
    }, [...CURATE_STEPS])
    await curateInProcess(repo, {
      skipGit: true,
      skipCorpusWrite: true,
      tracker,
      driver: scanDriver(),
      transportMode: 'api',
      decisions,
    })
    expect(steps.map((s) => [s.key, s.status])).toEqual([
      ['discover', 'done'],
      ['tag', 'done'],
      ['record', 'done'],
      ['subjects', 'done'],
      ['compare', 'done'],
      ['conflicts', 'done'],
      ['verify', 'done'],
    ])
    const record = steps.find((s) => s.key === 'record')!
    expect(record.label).toBe('Recording facts')
    // In the order it happened: what is not recorded is known before any session runs.
    expect(record.facts).toEqual([
      'docs/notes.md: not recorded, it has no area tag',
      'docs/export.md: 4 sentences, 3 facts, 1 skipped',
      'docs/privacy.md: 4 sentences, 3 facts, 1 skipped',
    ])

    const [stored] = await listStoredSessionRuns(repo, 'spec-scan')
    const block = KnownDisplayBlockSchema.parse(RunRecordSchema.parse(stored).display?.blocks[0])
    if (block.kind !== 'checklist') throw new Error('the run stamped no checklist block')
    expect(block.items.map((item) => [item.key, item.sessionKinds])).toEqual([
      ['discover', ['spec-scan.orchestrate']],
      ['tag', ['spec-scan.curate-doc', 'spec-scan.settle-areas']],
      ['record', [RECORD_FACTS_SESSION_KIND]],
      ['subjects', [SETTLE_SUBJECTS_SESSION_KIND]],
      ['compare', [COMPARE_FACTS_SESSION_KIND]],
      ['conflicts', []],
      ['verify', []],
    ])
  })

  it('aborts on the one-abort rule when every record session dies of transport', async () => {
    const error = await runScan({
      method: 'facts',
      record: async () => ({
        kind: 'failure',
        failure: { kind: 'transport', detail: 'provider down', class: 'provider', retryability: 'none' },
      }),
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmStageFailureError)
    expect((error as LlmStageFailureError).tally.stage).toBe(RECORD_FACTS_SESSION_KIND)
  })
})

